const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const prisma = require('../lib/prisma');
const { calculateVacationBalance, calculateHolidayBalance, getEventsInCurrentPeriod, calculateEventDays } = require('../utils/vacationHelper');

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

// Export calendar as CSV (admin only)
router.get('/calendar/export', requireAdmin, async (req, res) => {
  try {
    const today = new Date();
    const year = req.query.year ? parseInt(req.query.year) : today.getFullYear();

    // Get all employees with their events
    const employees = await prisma.employee.findMany({
      where: { archived: false },
      include: {
        events: {
          where: {
            moderated: true,
            startDate: {
              gte: new Date(year, 0, 1),
              lte: new Date(year, 11, 31)
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    // Get global holidays
    const globalHolidays = await prisma.event.findMany({
      where: {
        isGlobal: true,
        type: 'HOLIDAY',
        startDate: {
          gte: new Date(year, 0, 1),
          lte: new Date(year, 11, 31)
        }
      }
    });

    // Generate all dates for the year
    const dates = [];
    for (let month = 0; month < 12; month++) {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        dates.push(new Date(year, month, day));
      }
    }

    // Event type abbreviations
    const eventAbbreviations = {
      'VACATION': 'V',
      'HOLIDAY': 'H',
      'SICK_DAY': 'S',
      'HOME_OFFICE': 'HO',
      'LATE_LEFT_EARLY': 'L',
      'DAY_OFF_PAID': 'DP',
      'DAY_OFF_UNPAID': 'DU',
      'START_WORKING': 'SW',
      'PROBATION_FINISHED': 'PF',
      'STOP_WORKING': 'END'
    };

    // Build header row: Employee name + all dates
    const headerRow = ['Employee'];
    dates.forEach(date => {
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      headerRow.push(`${month}/${day}`);
    });

    const csvRows = [headerRow.join(',')];

    // Helper function to check if event occurs on a specific date
    const getEventForDate = (events, date) => {
      const dateStr = date.toDateString();
      const matching = events.filter(event => {
        const start = new Date(event.startDate);
        start.setHours(0, 0, 0, 0);
        const end = event.endDate ? new Date(event.endDate) : start;
        end.setHours(0, 0, 0, 0);
        const checkDate = new Date(date);
        checkDate.setHours(0, 0, 0, 0);
        return checkDate >= start && checkDate <= end;
      });

      // If multiple events, join them with +
      if (matching.length === 0) return '';
      return matching.map(e => eventAbbreviations[e.type] || e.type.substring(0, 2)).join('+');
    };

    // For each employee, create a row
    for (const emp of employees) {
      const row = [`"${emp.name}"`];

      // Combine employee events with global holidays
      const allEvents = [...emp.events];

      // Add global holidays to every employee
      globalHolidays.forEach(holiday => {
        allEvents.push({
          type: 'HOLIDAY',
          startDate: holiday.startDate,
          endDate: holiday.endDate
        });
      });

      // For each date, check if there's an event
      dates.forEach(date => {
        const eventLabel = getEventForDate(allEvents, date);
        row.push(eventLabel);
      });

      csvRows.push(row.join(','));
    }

    const csv = csvRows.join('\n');

    // Set headers for download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="calendar-${year}.csv"`);
    res.send(csv);

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

    // Get all events for the entire year
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    const events = await prisma.event.findMany({
      where: {
        startDate: {
          gte: yearStart,
          lte: yearEnd
        }
      },
      include: {
        employee: true
      },
      orderBy: {
        startDate: 'asc'
      }
    });

    // Generate data for all 12 months
    const monthsData = [];
    for (let m = 0; m < 12; m++) {
      const { firstDay, lastDay, daysInMonth, startingDayOfWeek } = getMonthData(year, m);
      monthsData.push({
        month: m,
        firstDay,
        lastDay,
        daysInMonth,
        startingDayOfWeek
      });
    }

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
      // Calculate vacation and holiday based on work anniversary
      const vacationBalance = calculateVacationBalance(emp);
      const holidayBalance = calculateHolidayBalance(emp);

      // Calculate other event types for current year
      let sickDays = 0;
      let homeOfficeDays = 0;
      let lateDays = 0;
      let paidDaysOff = 0;
      let unpaidDaysOff = 0;

      emp.events.forEach(event => {
        if (new Date(event.startDate).getFullYear() !== currentYear) return;

        const days = calculateEventDays(event.startDate, event.endDate);

        switch (event.type) {
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
      const totalHolidayDays = holidayBalance.daysTaken + globalHolidayDays;
      const totalHolidayRemaining = emp.holidayDaysPerYear - totalHolidayDays;

      return {
        id: emp.id,
        name: emp.name,
        vacationDays: vacationBalance.daysTaken,
        vacationAllowance: emp.vacationDaysPerYear,
        vacationRemaining: vacationBalance.daysLeft,
        holidayDays: totalHolidayDays,
        holidayAllowance: emp.holidayDaysPerYear,
        holidayRemaining: totalHolidayRemaining,
        sickDays,
        homeOfficeDays,
        lateDays,
        paidDaysOff,
        unpaidDaysOff
      };
    });

    // Today's events
    const endOfToday = new Date(today);
    endOfToday.setHours(23, 59, 59, 999);
    const todaysEvents = await prisma.event.findMany({
      where: {
        OR: [
          {
            startDate: {
              gte: today,
              lte: endOfToday
            }
          },
          {
            AND: [
              { startDate: { lte: endOfToday } },
              {
                OR: [
                  { endDate: { gte: today } },
                  { endDate: null }
                ]
              }
            ]
          }
        ]
      },
      include: {
        employee: true
      },
      orderBy: {
        startDate: 'asc'
      }
    });

    // Upcoming events (next 7 days, excluding today)
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    const upcomingEvents = await prisma.event.findMany({
      where: {
        startDate: {
          gte: tomorrow,
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
      monthsData,
      monthNames,
      events,
      employees,
      today,
      employeeStats,
      todaysEvents,
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
    const event = await prisma.event.create({
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

    // Notify all employees via Telegram bot (if bot is running)
    try {
      const { bot } = require('../bot');
      if (bot) {
        const { notifyAllEmployees } = require('../bot/utils/helpers');
        const { formatDate } = require('../bot/utils/helpers');

        const holidayStart = new Date(startDate);
        const holidayEnd = endDate ? new Date(endDate) : null;

        let dateText = formatDate(holidayStart);
        if (holidayEnd && holidayStart.getTime() !== holidayEnd.getTime()) {
          dateText += ` - ${formatDate(holidayEnd)}`;
        }

        const notificationMessage =
          `🎉 New Holiday Announced!\n\n` +
          `📅 Date: ${dateText}\n` +
          `🎊 ${notes}\n\n` +
          `This is a company-wide holiday.\n` +
          `Enjoy your day off! 🌟`;

        await notifyAllEmployees(bot, prisma, notificationMessage);
        console.log('✅ Global holiday notification sent to all employees');
      }
    } catch (botError) {
      console.error('Failed to send holiday notification:', botError);
      // Don't fail the request if notification fails
    }

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
