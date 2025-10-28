const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const prisma = require('../lib/prisma');

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
    const { name, email, startDate, vacationDaysPerYear, holidayDaysPerYear } = req.body;
    const employee = await prisma.employee.create({
      data: {
        name,
        email,
        startDate: new Date(startDate),
        vacationDaysPerYear: parseInt(vacationDaysPerYear) || 28,
        holidayDaysPerYear: parseInt(holidayDaysPerYear) || 14
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

    // Calculate vacation days taken this year
    const currentYear = new Date().getFullYear();
    const vacationEvents = employee.events.filter(event => {
      const eventYear = new Date(event.startDate).getFullYear();
      return event.type === 'VACATION' && eventYear === currentYear;
    });

    let vacationDaysTaken = 0;
    vacationEvents.forEach(event => {
      const start = new Date(event.startDate);
      const end = event.endDate ? new Date(event.endDate) : start;
      const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
      vacationDaysTaken += days;
    });

    const vacationDaysLeft = employee.vacationDaysPerYear - vacationDaysTaken;

    res.render('employees/show', { employee, vacationDaysTaken, vacationDaysLeft });
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
    res.render('employees/edit', { employee });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Update employee
router.put('/:id', async (req, res) => {
  try {
    const { name, email, startDate, vacationDaysPerYear, holidayDaysPerYear } = req.body;
    await prisma.employee.update({
      where: { id: parseInt(req.params.id) },
      data: {
        name,
        email,
        startDate: new Date(startDate),
        vacationDaysPerYear: parseInt(vacationDaysPerYear),
        holidayDaysPerYear: parseInt(holidayDaysPerYear)
      }
    });
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

module.exports = router;
