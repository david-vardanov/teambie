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

// Export calendar as Excel with colors (admin only)
router.get('/calendar/export', requireAdmin, async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const today = new Date();
    const year = req.query.year ? parseInt(req.query.year) : today.getFullYear();

    // Get all employees with their events (excluding admins/exempt)
    const employees = await prisma.employee.findMany({
      where: {
        archived: false,
        exemptFromTracking: false
      },
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

    // Event type abbreviations and colors
    const eventConfig = {
      'VACATION': { abbr: 'V', color: 'FF3498DB', name: 'Vacation' },
      'HOLIDAY': { abbr: 'H', color: 'FF9B59B6', name: 'Holiday' },
      'SICK_DAY': { abbr: 'S', color: 'FFE74C3C', name: 'Sick Day' },
      'HOME_OFFICE': { abbr: 'HO', color: 'FF16A085', name: 'Home Office' },
      'LATE_LEFT_EARLY': { abbr: 'L', color: 'FFF39C12', name: 'Late/Left Early' },
      'DAY_OFF_PAID': { abbr: 'DP', color: 'FF27AE60', name: 'Day Off Paid' },
      'DAY_OFF_UNPAID': { abbr: 'DU', color: 'FF95A5A6', name: 'Day Off Unpaid' },
      'START_WORKING': { abbr: 'SW', color: 'FF9B59B6', name: 'Start Working' },
      'PROBATION_FINISHED': { abbr: 'PF', color: 'FF9B59B6', name: 'Probation Finished' },
      'STOP_WORKING': { abbr: 'END', color: 'FF95A5A6', name: 'Stop Working' }
    };

    // Helper function to check if event occurs on a specific date
    const getEventsForDate = (events, date) => {
      const matching = events.filter(event => {
        const start = new Date(event.startDate);
        start.setHours(0, 0, 0, 0);
        const end = event.endDate ? new Date(event.endDate) : start;
        end.setHours(0, 0, 0, 0);
        const checkDate = new Date(date);
        checkDate.setHours(0, 0, 0, 0);
        return checkDate >= start && checkDate <= end;
      });
      return matching;
    };

    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Calendar ${year}`);

    // Build header row
    const headerRow = ['Employee'];
    dates.forEach(date => {
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      headerRow.push(`${month}/${day}`);
    });

    const header = worksheet.addRow(headerRow);
    header.font = { bold: true };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Set column widths
    worksheet.getColumn(1).width = 20; // Employee name column
    for (let i = 2; i <= dates.length + 1; i++) {
      worksheet.getColumn(i).width = 4; // Date columns
    }

    // For each employee, create a row
    for (const emp of employees) {
      const rowData = [emp.name];

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

      // Store event info for each date to color cells
      const dateEvents = [];
      dates.forEach(date => {
        const eventsOnDate = getEventsForDate(allEvents, date);
        dateEvents.push(eventsOnDate);

        // Add abbreviated text (for multiple events, join with +)
        if (eventsOnDate.length === 0) {
          rowData.push('');
        } else {
          const abbrs = eventsOnDate.map(e => eventConfig[e.type]?.abbr || e.type.substring(0, 2));
          rowData.push(abbrs.join('+'));
        }
      });

      const row = worksheet.addRow(rowData);

      // Apply colors to cells
      dateEvents.forEach((eventsOnDate, idx) => {
        if (eventsOnDate.length > 0) {
          const cellIndex = idx + 2; // +2 because column 1 is employee name, and ExcelJS is 1-indexed
          const cell = row.getCell(cellIndex);

          // Use the color of the first event if multiple events
          const eventType = eventsOnDate[0].type;
          const config = eventConfig[eventType];

          if (config) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: config.color }
            };
            cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          }
        }
      });
    }

    // Add legend worksheet
    const legendSheet = workbook.addWorksheet('Legend');
    legendSheet.addRow(['Event Type', 'Abbreviation', 'Color']);
    legendSheet.getRow(1).font = { bold: true };

    Object.entries(eventConfig).forEach(([type, config]) => {
      const row = legendSheet.addRow([config.name, config.abbr, '']);
      row.getCell(3).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: config.color }
      };
    });

    legendSheet.getColumn(1).width = 20;
    legendSheet.getColumn(2).width = 15;
    legendSheet.getColumn(3).width = 15;

    // Generate Excel file
    const buffer = await workbook.xlsx.writeBuffer();

    // Set headers for download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="calendar-${year}.xlsx"`);
    res.send(buffer);

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

    // Get all employees for the add event form and stats (excluding admins/exempt)
    const employees = await prisma.employee.findMany({
      where: {
        archived: false,
        exemptFromTracking: false
      },
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
        lateLeftEarlyDays: lateDays,
        paidDayOffDays: paidDaysOff,
        unpaidDayOffDays: unpaidDaysOff
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
