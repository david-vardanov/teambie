const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const prisma = require('../lib/prisma');
const { calculateVacationBalance } = require('../utils/vacationHelper');

// List all active employees
router.get('/', async (req, res) => {
  try {
    const employees = await prisma.employee.findMany({
      where: {
        archived: false
      },
      include: {
        events: true
      },
      orderBy: {
        name: 'asc'
      }
    });
    res.render('employees/index', { employees });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// List archived employees
router.get('/archived', requireAdmin, async (req, res) => {
  try {
    const employees = await prisma.employee.findMany({
      where: {
        archived: true
      },
      include: {
        events: true
      },
      orderBy: {
        archivedAt: 'desc'
      }
    });
    res.render('employees/archived', { employees });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// New employee form
router.get('/new', (req, res) => {
  res.render('employees/new');
});

// Create employee
router.post('/', async (req, res) => {
  try {
    const {
      name,
      email,
      startDate,
      vacationDaysPerYear,
      holidayDaysPerYear,
      exemptFromTracking,
      arrivalWindowStart,
      arrivalWindowEnd,
      workHoursPerDay,
      halfDayOnFridays,
      workHoursOnFriday,
      recurringHomeOfficeDays,
      createUserAccount,
      password,
      userRole
    } = req.body;

    // Handle recurringHomeOfficeDays - can be array or single value
    let homeOfficeDays = [];
    if (recurringHomeOfficeDays) {
      if (Array.isArray(recurringHomeOfficeDays)) {
        homeOfficeDays = recurringHomeOfficeDays.map(d => parseInt(d));
      } else {
        homeOfficeDays = [parseInt(recurringHomeOfficeDays)];
      }
    }

    const employee = await prisma.employee.create({
      data: {
        name,
        email,
        startDate: new Date(startDate),
        vacationDaysPerYear: parseInt(vacationDaysPerYear) || 28,
        holidayDaysPerYear: parseInt(holidayDaysPerYear) || 14,
        exemptFromTracking: (createUserAccount === 'on' && userRole === 'ADMIN') ? true : (exemptFromTracking === 'on' || exemptFromTracking === true),
        arrivalWindowStart: arrivalWindowStart || '10:00',
        arrivalWindowEnd: arrivalWindowEnd || '11:00',
        workHoursPerDay: parseInt(workHoursPerDay) || 8,
        halfDayOnFridays: halfDayOnFridays === 'on' || halfDayOnFridays === true,
        workHoursOnFriday: parseInt(workHoursOnFriday) || 8,
        recurringHomeOfficeDays: homeOfficeDays
      }
    });

    // Auto-create START_WORKING event
    await prisma.event.create({
      data: {
        employeeId: employee.id,
        type: 'START_WORKING',
        startDate: new Date(startDate),
        notes: 'Employee started working',
        moderated: true, // Auto-moderated system event
        createdById: req.session?.userId
      }
    });

    // Auto-create PROBATION_FINISHED event (3 months after start date)
    const probationEndDate = new Date(startDate);
    probationEndDate.setMonth(probationEndDate.getMonth() + 3);
    await prisma.event.create({
      data: {
        employeeId: employee.id,
        type: 'PROBATION_FINISHED',
        startDate: probationEndDate,
        notes: 'Probation period ends (can be extended)',
        moderated: true, // Auto-moderated system event
        createdById: req.session?.userId
      }
    });

    // Create user account if checkbox was checked and password provided
    if (createUserAccount === 'on' && password) {
      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: email }
      });

      if (!existingUser) {
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.user.create({
          data: {
            email: email,
            name: name,
            password: hashedPassword,
            role: userRole || 'EMPLOYEE'
          }
        });
      }
    }

    res.redirect('/employees');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Show employee details with vacation summary
router.get('/:id', async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        events: {
          orderBy: {
            startDate: 'desc'
          }
        }
      }
    });

    if (!employee) {
      return res.status(404).send('Employee not found');
    }

    // Find linked user account by email
    const linkedUser = await prisma.user.findUnique({
      where: { email: employee.email }
    });

    // Calculate vacation balance based on work anniversary
    const vacationBalance = calculateVacationBalance(employee);

    res.render('employees/show', {
      employee,
      linkedUser,
      vacationDaysTaken: vacationBalance.daysTaken,
      vacationDaysLeft: vacationBalance.daysLeft,
      vacationPeriodStart: vacationBalance.periodStart,
      vacationPeriodEnd: vacationBalance.periodEnd
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Edit employee form
router.get('/:id/edit', async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) }
    });
    if (!employee) {
      return res.status(404).send('Employee not found');
    }

    // Find linked user account by email
    const linkedUser = await prisma.user.findUnique({
      where: { email: employee.email }
    });

    // Get ClickUp settings
    const botSettings = await prisma.botSettings.findFirst();
    const clickupEnabled = botSettings?.clickupEnabled || false;
    const clickupApiToken = botSettings?.clickupApiToken || null;

    res.render('employees/edit', {
      employee,
      linkedUser,
      clickupEnabled,
      clickupApiToken
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Update employee
router.put('/:id', async (req, res) => {
  try {
    const {
      name,
      email,
      startDate,
      vacationDaysPerYear,
      holidayDaysPerYear,
      exemptFromTracking,
      arrivalWindowStart,
      arrivalWindowEnd,
      workHoursPerDay,
      halfDayOnFridays,
      workHoursOnFriday,
      recurringHomeOfficeDays,
      role,
      clickupApiToken,
      clickupUserId,
      clickupWorkspaceId,
      clickupSpaceId,
      clickupListId,
      clickupListIds,
      clickupFolderIds
    } = req.body;

    // Handle recurringHomeOfficeDays - can be array or single value
    let homeOfficeDays = [];
    if (recurringHomeOfficeDays) {
      if (Array.isArray(recurringHomeOfficeDays)) {
        homeOfficeDays = recurringHomeOfficeDays.map(d => parseInt(d));
      } else {
        homeOfficeDays = [parseInt(recurringHomeOfficeDays)];
      }
    }

    // Get existing employee for token masking logic
    const existingEmployee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    // Don't save masked token - keep existing if token contains "..."
    const isMaskedClickUp = clickupApiToken && clickupApiToken.includes('...');

    // Handle clickupListIds - can be array or single value or comma-separated string
    let listIds = [];
    if (clickupListIds) {
      if (Array.isArray(clickupListIds)) {
        listIds = clickupListIds.filter(id => id);
      } else if (typeof clickupListIds === 'string') {
        listIds = clickupListIds.split(',').map(id => id.trim()).filter(id => id);
      }
    }

    // Handle clickupFolderIds - can be array or single value or comma-separated string
    let folderIds = [];
    if (clickupFolderIds) {
      if (Array.isArray(clickupFolderIds)) {
        folderIds = clickupFolderIds.filter(id => id);
      } else if (typeof clickupFolderIds === 'string') {
        folderIds = clickupFolderIds.split(',').map(id => id.trim()).filter(id => id);
      }
    }

    // Update employee
    const employee = await prisma.employee.update({
      where: { id: parseInt(req.params.id) },
      data: {
        name,
        email,
        startDate: new Date(startDate),
        vacationDaysPerYear: parseInt(vacationDaysPerYear),
        holidayDaysPerYear: parseInt(holidayDaysPerYear),
        exemptFromTracking: exemptFromTracking === 'on' || exemptFromTracking === true,
        arrivalWindowStart: arrivalWindowStart || '10:00',
        arrivalWindowEnd: arrivalWindowEnd || '11:00',
        workHoursPerDay: parseInt(workHoursPerDay) || 8,
        halfDayOnFridays: halfDayOnFridays === 'on' || halfDayOnFridays === true,
        workHoursOnFriday: parseInt(workHoursOnFriday) || 8,
        recurringHomeOfficeDays: homeOfficeDays,
        clickupApiToken: isMaskedClickUp ? existingEmployee.clickupApiToken : (clickupApiToken || null),
        clickupUserId: clickupUserId || null,
        clickupWorkspaceId: clickupWorkspaceId || null,
        clickupSpaceId: clickupSpaceId || null,
        clickupListId: clickupListId || null,
        clickupListIds: listIds,
        clickupFolderIds: folderIds
      }
    });

    // Update user role if role was provided and user exists
    if (role) {
      const user = await prisma.user.findUnique({
        where: { email: employee.email }
      });

      if (user) {
        // Prevent user from demoting themselves
        if (user.id === req.session.userId && role === 'EMPLOYEE' && user.role === 'ADMIN') {
          req.session.message = {
            type: 'error',
            text: 'You cannot demote yourself from admin'
          };
          return res.redirect(`/employees/${req.params.id}/edit`);
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { role: role }
        });

        // If promoted to admin, auto-exempt from tracking
        if (role === 'ADMIN') {
          await prisma.employee.update({
            where: { id: parseInt(req.params.id) },
            data: { exemptFromTracking: true }
          });
        }
      }
    }

    res.redirect(`/employees/${req.params.id}`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Delete employee (admin only, archived employees only)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    // Check if employee is archived before deleting
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!employee) {
      return res.status(404).send('Employee not found');
    }

    if (!employee.archived) {
      return res.status(403).send('Can only delete archived employees. Archive them first.');
    }

    // Cascade delete - will delete employee and all associated events
    await prisma.employee.delete({
      where: { id: parseInt(req.params.id) }
    });

    res.redirect('/employees/archived');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Archive employee (admin only)
router.post('/:id/archive', requireAdmin, async (req, res) => {
  try {
    await prisma.employee.update({
      where: { id: parseInt(req.params.id) },
      data: {
        archived: true,
        archivedAt: new Date()
      }
    });
    res.redirect('/employees');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Unarchive employee (admin only)
router.post('/:id/unarchive', requireAdmin, async (req, res) => {
  try {
    await prisma.employee.update({
      where: { id: parseInt(req.params.id) },
      data: {
        archived: false,
        archivedAt: null
      }
    });
    res.redirect('/employees/archived');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Create user account for employee (admin only)
router.post('/:id/create-user', requireAdmin, async (req, res) => {
  try {
    const { password, role } = req.body;
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!employee) {
      return res.status(404).send('Employee not found');
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: employee.email }
    });

    if (existingUser) {
      req.session.message = {
        type: 'error',
        text: 'User account already exists for this email'
      };
      return res.redirect(`/employees/${req.params.id}`);
    }

    // Create user account
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: {
        email: employee.email,
        name: employee.name,
        password: hashedPassword,
        role: role || 'EMPLOYEE'
      }
    });

    req.session.message = {
      type: 'success',
      text: 'User account created successfully'
    };
    res.redirect(`/employees/${req.params.id}`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Promote employee to admin (admin only)
router.post('/:id/promote', requireAdmin, async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!employee) {
      return res.status(404).send('Employee not found');
    }

    const user = await prisma.user.findUnique({
      where: { email: employee.email }
    });

    if (!user) {
      req.session.message = {
        type: 'error',
        text: 'No user account found. Create one first.'
      };
      return res.redirect(`/employees/${req.params.id}`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN' }
    });

    req.session.message = {
      type: 'success',
      text: `${employee.name} promoted to admin successfully`
    };
    res.redirect(`/employees/${req.params.id}`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Demote employee from admin (admin only)
router.post('/:id/demote', requireAdmin, async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!employee) {
      return res.status(404).send('Employee not found');
    }

    const user = await prisma.user.findUnique({
      where: { email: employee.email }
    });

    if (!user) {
      req.session.message = {
        type: 'error',
        text: 'No user account found'
      };
      return res.redirect(`/employees/${req.params.id}`);
    }

    // Prevent demoting yourself
    if (user.id === req.session.userId) {
      req.session.message = {
        type: 'error',
        text: 'You cannot demote yourself'
      };
      return res.redirect(`/employees/${req.params.id}`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { role: 'EMPLOYEE' }
    });

    req.session.message = {
      type: 'success',
      text: `${employee.name} demoted to employee successfully`
    };
    res.redirect(`/employees/${req.params.id}`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Register ClickUp webhooks for employee's lists
router.post('/:id/clickup/register-webhook', async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!employee || !employee.clickupWorkspaceId) {
      return res.status(400).json({ error: 'Employee ClickUp configuration incomplete' });
    }

    // Get all list IDs (from array or legacy single field)
    const listIds = employee.clickupListIds.length > 0
      ? employee.clickupListIds
      : (employee.clickupListId ? [employee.clickupListId] : []);

    if (listIds.length === 0) {
      return res.status(400).json({ error: 'No ClickUp lists configured for employee' });
    }

    if (!employee.clickupApiToken) {
      return res.status(400).json({ error: 'Employee ClickUp API token not configured' });
    }

    const ClickUpService = require('../services/clickup');
    const clickup = new ClickUpService(employee.clickupApiToken);

    // Delete existing webhooks
    const existingWebhookIds = employee.clickupWebhookIds.length > 0
      ? employee.clickupWebhookIds
      : (employee.clickupWebhookId ? [employee.clickupWebhookId] : []);

    for (const webhookId of existingWebhookIds) {
      try {
        await clickup.deleteWebhook(webhookId);
      } catch (error) {
        console.log('Failed to delete existing webhook:', error.message);
      }
    }

    // Get the webhook URL
    const webhookUrl = `${process.env.WEBHOOK_BASE_URL || 'http://localhost:3000'}/webhooks/clickup`;

    // Create webhooks for all lists
    const events = [
      'taskCreated',
      'taskUpdated',
      'taskDeleted',
      'taskCommentPosted',
      'taskStatusUpdated',
      'taskAssigneeUpdated',
      'taskDueDateUpdated',
      'taskPriorityUpdated'
    ];

    const newWebhookIds = [];
    for (const listId of listIds) {
      try {
        const webhook = await clickup.createWebhook(
          employee.clickupWorkspaceId,
          webhookUrl,
          listId,
          events
        );
        newWebhookIds.push(webhook.id);
      } catch (error) {
        console.error(`Failed to create webhook for list ${listId}:`, error.message);
      }
    }

    // Update employee with webhook IDs
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        clickupWebhookIds: newWebhookIds,
        clickupWebhookId: newWebhookIds[0] || null // Keep legacy field updated
      }
    });

    res.json({ success: true, webhookIds: newWebhookIds, count: newWebhookIds.length });
  } catch (error) {
    console.error('Error registering webhooks:', error);
    res.status(500).json({ error: error.message });
  }
});

// Unregister ClickUp webhooks for employee
router.post('/:id/clickup/unregister-webhook', async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    // Get all webhook IDs (from array or legacy single field)
    const webhookIds = employee.clickupWebhookIds.length > 0
      ? employee.clickupWebhookIds
      : (employee.clickupWebhookId ? [employee.clickupWebhookId] : []);

    if (webhookIds.length === 0) {
      return res.status(400).json({ error: 'No webhooks registered' });
    }

    if (!employee.clickupApiToken) {
      return res.status(400).json({ error: 'Employee ClickUp API token not configured' });
    }

    const ClickUpService = require('../services/clickup');
    const clickup = new ClickUpService(employee.clickupApiToken);

    // Delete all webhooks
    for (const webhookId of webhookIds) {
      try {
        await clickup.deleteWebhook(webhookId);
      } catch (error) {
        console.log('Failed to delete webhook:', error.message);
      }
    }

    // Remove webhook IDs from employee
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        clickupWebhookIds: [],
        clickupWebhookId: null
      }
    });

    res.json({ success: true, deletedCount: webhookIds.length });
  } catch (error) {
    console.error('Error unregistering webhooks:', error);
    res.status(500).json({ error: error.message });
  }
});

// Auto-detect ClickUp User ID by email
router.post('/:id/clickup/auto-detect-userid', async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!employee?.clickupApiToken || !employee?.clickupWorkspaceId) {
      return res.status(400).json({ error: 'ClickUp API token and workspace ID required' });
    }

    const ClickUpService = require('../services/clickup');
    const clickup = new ClickUpService(employee.clickupApiToken);

    // Get workspace members
    const members = await clickup.getWorkspaceMembers(employee.clickupWorkspaceId);

    // Find member by email
    const member = members.find(m =>
      m.user.email && m.user.email.toLowerCase() === employee.email.toLowerCase()
    );

    if (!member) {
      return res.status(404).json({
        error: 'No ClickUp user found with email: ' + employee.email,
        hint: 'Make sure your employee email matches your ClickUp account email'
      });
    }

    // Update employee with the user ID
    await prisma.employee.update({
      where: { id: employee.id },
      data: { clickupUserId: member.user.id.toString() }
    });

    res.json({
      success: true,
      userId: member.user.id.toString(),
      username: member.user.username
    });
  } catch (error) {
    console.error('Error auto-detecting user ID:', error);
    res.status(500).json({ error: error.message });
  }
});

// ClickUp API routes for employee configuration
router.get('/:id/clickup/workspaces', async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!employee?.clickupApiToken) {
      return res.status(400).json({ error: 'Employee ClickUp API token not configured' });
    }

    const ClickUpService = require('../services/clickup');
    const clickup = new ClickUpService(employee.clickupApiToken);
    const workspaces = await clickup.getWorkspaces();
    res.json(workspaces);
  } catch (error) {
    console.error('Error fetching ClickUp workspaces:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/clickup/spaces/:workspaceId', async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!employee?.clickupApiToken) {
      return res.status(400).json({ error: 'Employee ClickUp API token not configured' });
    }

    const ClickUpService = require('../services/clickup');
    const clickup = new ClickUpService(employee.clickupApiToken);
    const spaces = await clickup.getSpaces(req.params.workspaceId);
    res.json(spaces);
  } catch (error) {
    console.error('Error fetching ClickUp spaces:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/clickup/lists/:spaceId', async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!employee?.clickupApiToken) {
      return res.status(400).json({ error: 'Employee ClickUp API token not configured' });
    }

    const ClickUpService = require('../services/clickup');
    const clickup = new ClickUpService(employee.clickupApiToken);
    const lists = await clickup.getSpaceLists(req.params.spaceId);
    res.json(lists);
  } catch (error) {
    console.error('Error fetching ClickUp lists:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get folders in a space for employee
router.get('/:id/clickup/folders/:spaceId', async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!employee?.clickupApiToken) {
      return res.status(400).json({ error: 'Employee ClickUp API token not configured' });
    }

    const ClickUpService = require('../services/clickup');
    const clickup = new ClickUpService(employee.clickupApiToken);
    const folders = await clickup.getFolders(req.params.spaceId);
    res.json(folders);
  } catch (error) {
    console.error('Error fetching ClickUp folders:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get lists in a folder for employee
router.get('/:id/clickup/folder/:folderId/lists', async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!employee?.clickupApiToken) {
      return res.status(400).json({ error: 'Employee ClickUp API token not configured' });
    }

    const ClickUpService = require('../services/clickup');
    const clickup = new ClickUpService(employee.clickupApiToken);
    const lists = await clickup.getLists(req.params.folderId);
    res.json(lists);
  } catch (error) {
    console.error('Error fetching ClickUp folder lists:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
