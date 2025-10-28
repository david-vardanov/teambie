const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const prisma = require('../lib/prisma');

// Helper function to get month calendar data
function getMonthData(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  return { firstDay, lastDay, daysInMonth, startingDayOfWeek };
}

// List all events (admin only)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const events = await prisma.event.findMany({
      include: {
        employee: true,
        createdBy: true
      },
      orderBy: {
        startDate: 'desc'
      }
    });
    res.render('events/index', { events });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Calendar view
router.get('/calendar', async (req, res) => {
  try {
    const today = new Date();
    const year = req.query.year ? parseInt(req.query.year) : today.getFullYear();
    const month = req.query.month ? parseInt(req.query.month) : today.getMonth();

    const { firstDay, lastDay, daysInMonth, startingDayOfWeek } = getMonthData(year, month);

    // Get all events for this month
    const events = await prisma.event.findMany({
      where: {
        startDate: {
          gte: firstDay,
          lte: lastDay
        }
      },
      include: {
        employee: true
      },
      orderBy: {
        startDate: 'asc'
      }
    });

    // Get all employees for the add event form and stats
    const employees = await prisma.employee.findMany({
      include: {
        events: true
      },
      orderBy: { name: 'asc' }
    });

    // Calculate stats for each employee
    const currentYear = today.getFullYear();

    // Get global holidays for the current year
    const globalHolidays = await prisma.event.findMany({
      where: {
        isGlobal: true,
        type: 'HOLIDAY',
        startDate: {
          gte: new Date(currentYear, 0, 1),
          lte: new Date(currentYear, 11, 31)
        }
      }
    });

    // Calculate total global holiday days
    let globalHolidayDays = 0;
    globalHolidays.forEach(holiday => {
      const start = new Date(holiday.startDate);
      const end = holiday.endDate ? new Date(holiday.endDate) : start;
      const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
      globalHolidayDays += days;
    });

    const employeeStats = employees.map(emp => {
      let vacationDays = 0;
      let holidayDays = 0;
      let sickDays = 0;
      let homeOfficeDays = 0;
      let lateDays = 0;
      let paidDaysOff = 0;
      let unpaidDaysOff = 0;

      emp.events.forEach(event => {
        if (new Date(event.startDate).getFullYear() !== currentYear) return;

        const start = new Date(event.startDate);
        const end = event.endDate ? new Date(event.endDate) : start;
        const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

        switch (event.type) {
          case 'VACATION':
            vacationDays += days;
            break;
          case 'HOLIDAY':
            holidayDays += days;
            break;
          case 'SICK_DAY':
            sickDays += days;
            break;
          case 'HOME_OFFICE':
            homeOfficeDays += days;
            break;
          case 'LATE_LEFT_EARLY':
            lateDays += days;
            break;
          case 'DAY_OFF_PAID':
            paidDaysOff += days;
            break;
          case 'DAY_OFF_UNPAID':
            unpaidDaysOff += days;
            break;
        }
      });

      // Add global holidays to employee's holiday count
      const totalHolidayDays = holidayDays + globalHolidayDays;

      return {
        id: emp.id,
        name: emp.name,
        vacationDays,
        vacationAllowance: emp.vacationDaysPerYear,
        vacationRemaining: emp.vacationDaysPerYear - vacationDays,
        holidayDays: totalHolidayDays,
        holidayAllowance: emp.holidayDaysPerYear,
        holidayRemaining: emp.holidayDaysPerYear - totalHolidayDays,
        sickDays,
        homeOfficeDays,
        lateDays,
        paidDaysOff,
        unpaidDaysOff
      };
    });

    // Upcoming events (next 7 days)
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    const upcomingEvents = await prisma.event.findMany({
      where: {
        startDate: {
          gte: today,
          lte: nextWeek
        }
      },
      include: {
        employee: true
      },
      orderBy: {
        startDate: 'asc'
      },
      take: 5
    });

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    res.render('events/calendar', {
      year,
      month,
      monthName: monthNames[month],
      daysInMonth,
      startingDayOfWeek,
      events,
      employees,
      today,
      employeeStats,
      upcomingEvents
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// New event form
router.get('/new', async (req, res) => {
  try {
    const employees = await prisma.employee.findMany({
      orderBy: { name: 'asc' }
    });
    res.render('events/new', { employees });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Create event
router.post('/', async (req, res) => {
  try {
    const { employeeId, type, startDate, endDate, notes } = req.body;
    const isAdmin = req.session.userRole === 'ADMIN';

    await prisma.event.create({
      data: {
        employeeId: parseInt(employeeId),
        type,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        notes: notes || null,
        moderated: isAdmin, // Auto-approve if admin
        createdById: req.session.userId
      }
    });

    // Auto-archive employee if LAST_DAY event and date has passed
    if (type === 'LAST_DAY' && isAdmin) {
      const lastDayDate = new Date(startDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      lastDayDate.setHours(0, 0, 0, 0);

      if (lastDayDate <= today) {
        await prisma.employee.update({
          where: { id: parseInt(employeeId) },
          data: {
            archived: true,
            archivedAt: new Date()
          }
        });
      }
    }

    res.redirect('/events/calendar');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Moderation page (admin only)
router.get('/moderate', requireAdmin, async (req, res) => {
  try {
    const pendingEvents = await prisma.event.findMany({
      where: {
        moderated: false,
        isGlobal: false
      },
      include: {
        employee: true,
        createdBy: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    res.render('events/moderate', { pendingEvents });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Approve event
router.post('/moderate/:id/approve', requireAdmin, async (req, res) => {
  try {
    await prisma.event.update({
      where: { id: parseInt(req.params.id) },
      data: { moderated: true }
    });
    res.redirect('/events/moderate');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Reject event (delete)
router.post('/moderate/:id/reject', requireAdmin, async (req, res) => {
  try {
    await prisma.event.delete({
      where: { id: parseInt(req.params.id) }
    });
    res.redirect('/events/moderate');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Global holidays management (must be before /:id routes)
router.get('/global-holidays', requireAdmin, async (req, res) => {
  try {
    const globalHolidays = await prisma.event.findMany({
      where: {
        isGlobal: true,
        type: 'HOLIDAY'
      },
      orderBy: {
        startDate: 'asc'
      }
    });
    res.render('events/global-holidays', { globalHolidays });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Create global holiday
router.post('/global-holidays', requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate, notes } = req.body;
    await prisma.event.create({
      data: {
        type: 'HOLIDAY',
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        notes,
        isGlobal: true,
        moderated: true,
        createdById: req.session.userId
      }
    });
    res.redirect('/events/global-holidays');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Delete global holiday
router.delete('/global-holidays/:id', async (req, res) => {
  try {
    await prisma.event.delete({
      where: { id: parseInt(req.params.id) }
    });
    res.redirect('/events/global-holidays');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Show event details
router.get('/:id', async (req, res) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { employee: true }
    });
    if (!event) {
      return res.status(404).send('Event not found');
    }
    res.render('events/show', { event });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Edit event form
router.get('/:id/edit', async (req, res) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { employee: true }
    });
    const employees = await prisma.employee.findMany({
      orderBy: { name: 'asc' }
    });
    if (!event) {
      return res.status(404).send('Event not found');
    }
    res.render('events/edit', { event, employees });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Update event
router.put('/:id', async (req, res) => {
  try {
    const { employeeId, type, startDate, endDate, notes } = req.body;
    await prisma.event.update({
      where: { id: parseInt(req.params.id) },
      data: {
        employeeId: parseInt(employeeId),
        type,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        notes: notes || null
      }
    });
    res.redirect('/events/calendar');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// Delete event
router.delete('/:id', async (req, res) => {
  try {
    await prisma.event.delete({
      where: { id: parseInt(req.params.id) }
    });
    res.redirect('/events/calendar');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
