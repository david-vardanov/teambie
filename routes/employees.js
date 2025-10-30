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

    res.render('employees/edit', { employee, linkedUser });
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
      role
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
        recurringHomeOfficeDays: homeOfficeDays
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

module.exports = router;
