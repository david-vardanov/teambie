const cron = require('node-cron');
const {
  getCurrentDate,
  getCurrentDateTime,
  getCurrentTime,
  isRecurringHomeOfficeDay,
  hasEventForDate,
  getAdminTelegramIds,
  notifyAdmins,
  formatDate,
  timeToMinutes,
  calculateDepartureTime,
  getWorkHoursForToday
} = require('../utils/helpers');
const { askArrival, followUpArrival } = require('../flows/arrival');
const { askDeparture } = require('../flows/departure');
const { isWorkAnniversary, getYearsOfService } = require('../../utils/vacationHelper');

/**
 * Start all schedulers
 */
async function startSchedulers(bot, prisma) {
  console.log('Starting schedulers...');

  // Load settings for report times
  let settings = await prisma.botSettings.findFirst();
  if (!settings) {
    // Create default settings
    settings = await prisma.botSettings.create({
      data: {
        botEnabled: false,
        timezoneOffset: 3,
        morningReportTime: "09:00",
        endOfDayReportTime: "19:00",
        missedCheckInTime: "12:00"
      }
    });
  }

  const morningTime = settings.morningReportTime.split(':');
  const endOfDayTime = settings.endOfDayReportTime.split(':');
  const missedCheckInTime = settings.missedCheckInTime.split(':');

  // Check every minute for arrival/departure checks
  cron.schedule('* * * * *', () => checkArrivalTimes(bot, prisma));
  cron.schedule('* * * * *', () => checkDepartureTimes(bot, prisma));

  // Follow up on pending arrivals every minute
  cron.schedule('* * * * *', () => followUpPendingArrivals(bot, prisma));

  // Morning report for admins (configurable)
  cron.schedule(`${morningTime[1]} ${morningTime[0]} * * *`, () => sendMorningReport(bot, prisma));

  // End of day report for admins (configurable)
  cron.schedule(`${endOfDayTime[1]} ${endOfDayTime[0]} * * *`, () => sendEndOfDayReport(bot, prisma));

  // Weekly report for admins on Monday (uses morning time)
  cron.schedule(`${morningTime[1]} ${morningTime[0]} * * 1`, () => sendWeeklyReport(bot, prisma));

  // Check for missed check-ins (configurable)
  cron.schedule(`${missedCheckInTime[1]} ${missedCheckInTime[0]} * * *`, () => checkMissedCheckIns(bot, prisma));

  // Check for work anniversaries daily at morning report time
  cron.schedule(`${morningTime[1]} ${morningTime[0]} * * *`, () => checkWorkAnniversaries(bot, prisma));

  console.log('All schedulers started!');
  console.log(`- Morning report: ${settings.morningReportTime}`);
  console.log(`- End of day report: ${settings.endOfDayReportTime}`);
  console.log(`- Missed check-in alert: ${settings.missedCheckInTime}`);
  console.log(`- Work anniversary check: ${settings.morningReportTime}`);
}

/**
 * Check if it's time to ask any employees about arrival
 */
async function checkArrivalTimes(bot, prisma) {
  try {
    const currentTime = getCurrentTime();
    const today = getCurrentDate();
    const todayDate = new Date(today);

    // Get all active employees
    const employees = await prisma.employee.findMany({
      where: {
        archived: false,
        telegramUserId: { not: null }
      }
    });

    for (const employee of employees) {
      // Skip if exempt from tracking
      if (employee.exemptFromTracking) {
        continue;
      }

      // Skip if today is recurring home office day
      if (isRecurringHomeOfficeDay(employee)) {
        continue;
      }

      // Skip if has event for today (vacation, sick, etc.)
      const hasEvent = await hasEventForDate(
        prisma,
        employee.id,
        today,
        ['VACATION', 'SICK_DAY', 'HOLIDAY', 'HOME_OFFICE']
      );
      if (hasEvent) continue;

      // Check if it's their arrival window start time
      if (currentTime === employee.arrivalWindowStart) {
        // Check if already asked
        const existingCheckIn = await prisma.attendanceCheckIn.findUnique({
          where: {
            employeeId_date: {
              employeeId: employee.id,
              date: todayDate
            }
          }
        });

        if (!existingCheckIn) {
          await askArrival(bot, prisma, employee);
        }
      }
    }
  } catch (error) {
    console.error('Check arrival times error:', error);
  }
}

/**
 * Check if it's time to ask any employees about departure
 */
async function checkDepartureTimes(bot, prisma) {
  try {
    const currentTime = getCurrentTime();
    const today = getCurrentDate();
    const todayDate = new Date(today);

    // Get all check-ins that are in ARRIVED status
    const checkIns = await prisma.attendanceCheckIn.findMany({
      where: {
        date: todayDate,
        status: 'ARRIVED',
        actualArrivalTime: { not: null }
      },
      include: { employee: true }
    });

    for (const checkIn of checkIns) {
      const employee = checkIn.employee;
      const workHours = getWorkHoursForToday(employee);
      const expectedDeparture = calculateDepartureTime(checkIn.actualArrivalTime, workHours);

      // Ask at expected departure time
      if (currentTime === expectedDeparture) {
        await askDeparture(bot, prisma, employee);
      }
    }
  } catch (error) {
    console.error('Check departure times error:', error);
  }
}

/**
 * Follow up with employees who said they'll arrive later
 */
async function followUpPendingArrivals(bot, prisma) {
  try {
    const now = new Date();
    const today = getCurrentDate();
    const todayDate = new Date(today);
    const currentTime = getCurrentTime();

    // Get check-ins waiting for follow-up
    const checkIns = await prisma.attendanceCheckIn.findMany({
      where: {
        date: todayDate,
        status: 'WAITING_ARRIVAL_REMINDER',
        expectedArrivalAt: {
          lte: now
        }
      },
      include: { employee: true }
    });

    for (const checkIn of checkIns) {
      const employee = checkIn.employee;

      // Skip if exempt from tracking
      if (employee.exemptFromTracking) {
        continue;
      }

      // Check if this is a late arrival (expected time > window end)
      const expectedTime = new Date(checkIn.expectedArrivalAt);
      const expectedTimeStr = `${expectedTime.getHours()}:${String(expectedTime.getMinutes()).padStart(2, '0')}`;

      if (timeToMinutes(expectedTimeStr) > timeToMinutes(employee.arrivalWindowEnd)) {
        // Check if late event already exists for today
        const existingLateEvent = await prisma.event.findFirst({
          where: {
            employeeId: employee.id,
            type: 'LATE_LEFT_EARLY',
            startDate: todayDate,
            notes: {
              contains: 'Late arrival'
            }
          }
        });

        // Create late arrival event if not already created
        if (!existingLateEvent) {
          console.log(`⚠️ Auto-creating late arrival for ${employee.name} - expected ${expectedTimeStr}, window ended at ${employee.arrivalWindowEnd}`);

          await prisma.event.create({
            data: {
              employeeId: employee.id,
              type: 'LATE_LEFT_EARLY',
              startDate: todayDate,
              endDate: todayDate,
              moderated: true,
              notes: `Late arrival: Expected ${expectedTimeStr} (window: ${employee.arrivalWindowStart}-${employee.arrivalWindowEnd})`
            }
          });

          // Notify admins
          await notifyAdmins(
            bot,
            prisma,
            `⚠️ Late Arrival (Auto-detected)\n\n` +
            `👤 ${employee.name}\n` +
            `⏰ Expected: ${expectedTimeStr}\n` +
            `📅 Window: ${employee.arrivalWindowStart}-${employee.arrivalWindowEnd}\n` +
            `📆 Date: ${formatDate(today)}\n\n` +
            `Employee has not confirmed arrival yet.`
          );
        }
      }

      // Still ask if they arrived
      await followUpArrival(bot, prisma, checkIn, employee);
    }
  } catch (error) {
    console.error('Follow up pending arrivals error:', error);
  }
}

/**
 * Check for employees who missed their check-in
 */
async function checkMissedCheckIns(bot, prisma) {
  try {
    const today = getCurrentDate();
    const todayDate = new Date(today);

    // Get all active employees
    const employees = await prisma.employee.findMany({
      where: {
        archived: false,
        telegramUserId: { not: null }
      },
      include: {
        attendanceCheckIns: {
          where: { date: todayDate }
        }
      }
    });

    let missedEmployees = [];

    for (const employee of employees) {
      // Skip if exempt from tracking
      if (employee.exemptFromTracking) continue;

      // Skip if recurring home office or has event
      if (isRecurringHomeOfficeDay(employee)) continue;

      const hasEvent = await hasEventForDate(
        prisma,
        employee.id,
        today,
        ['VACATION', 'SICK_DAY', 'HOLIDAY', 'HOME_OFFICE']
      );
      if (hasEvent) continue;

      const checkIn = employee.attendanceCheckIns[0];

      // If no check-in or not arrived yet
      if (!checkIn || checkIn.status === 'WAITING_ARRIVAL' || checkIn.status === 'WAITING_ARRIVAL_REMINDER') {
        missedEmployees.push(employee.name);

        // Update status to MISSED
        if (checkIn) {
          await prisma.attendanceCheckIn.update({
            where: { id: checkIn.id },
            data: { status: 'MISSED' }
          });
        } else {
          await prisma.attendanceCheckIn.create({
            data: {
              employeeId: employee.id,
              date: todayDate,
              status: 'MISSED'
            }
          });
        }
      }
    }

    // Notify admins if there are missed check-ins
    if (missedEmployees.length > 0) {
      await notifyAdmins(
        bot,
        prisma,
        `❌ Missed Check-ins (as of 12:00 PM)\n\n` +
        missedEmployees.map(name => `• ${name}`).join('\n')
      );
    }
  } catch (error) {
    console.error('Check missed check-ins error:', error);
  }
}

/**
 * Send morning report to admins
 */
async function sendMorningReport(bot, prisma) {
  try {
    const today = getCurrentDate();
    const todayDate = new Date(today);

    // Get all active employees
    const employees = await prisma.employee.findMany({
      where: { archived: false }
    });

    let expectedInOffice = 0;
    let homeOffice = [];
    let onVacation = [];
    let sick = [];

    for (const employee of employees) {
      if (isRecurringHomeOfficeDay(employee)) {
        homeOffice.push(employee.name);
        continue;
      }

      // Check for events today
      const events = await prisma.event.findMany({
        where: {
          employeeId: employee.id,
          moderated: true,
          startDate: { lte: todayDate },
          OR: [
            { endDate: { gte: todayDate } },
            { endDate: null }
          ]
        }
      });

      const todayEvents = events.filter(e => {
        const start = new Date(e.startDate);
        const end = e.endDate ? new Date(e.endDate) : start;
        return start <= todayDate && end >= todayDate;
      });

      if (todayEvents.some(e => e.type === 'VACATION')) {
        onVacation.push(employee.name);
      } else if (todayEvents.some(e => e.type === 'SICK_DAY')) {
        sick.push(employee.name);
      } else if (todayEvents.some(e => e.type === 'HOME_OFFICE')) {
        homeOffice.push(employee.name);
      } else {
        expectedInOffice++;
      }
    }

    let message = `📅 Daily Report - ${formatDate(today)}\n\n`;
    message += `Expected in office: ${expectedInOffice} employees\n`;

    if (homeOffice.length > 0) {
      message += `\n🏠 Home office: ${homeOffice.length}\n`;
      message += homeOffice.map(n => `   • ${n}`).join('\n');
    }

    if (onVacation.length > 0) {
      message += `\n\n🏖 On vacation: ${onVacation.length}\n`;
      message += onVacation.map(n => `   • ${n}`).join('\n');
    }

    if (sick.length > 0) {
      message += `\n\n🤒 Sick: ${sick.length}\n`;
      message += sick.map(n => `   • ${n}`).join('\n');
    }

    message += `\n\nTotal team: ${employees.length}`;

    await notifyAdmins(bot, prisma, message);
  } catch (error) {
    console.error('Morning report error:', error);
  }
}

/**
 * Send end of day report to admins
 */
async function sendEndOfDayReport(bot, prisma) {
  try {
    const today = getCurrentDate();
    const todayDate = new Date(today);

    // Get all check-ins for today
    const checkIns = await prisma.attendanceCheckIn.findMany({
      where: { date: todayDate },
      include: { employee: true }
    });

    // Get late/early leave events for today
    const lateEarlyEvents = await prisma.event.findMany({
      where: {
        type: 'LATE_LEFT_EARLY',
        startDate: todayDate
      },
      include: { employee: true }
    });

    const totalExpected = checkIns.length;
    const arrived = checkIns.filter(c => c.status === 'ARRIVED' || c.status === 'LEFT').length;
    const missed = checkIns.filter(c => c.status === 'MISSED').length;
    const lateArrivals = lateEarlyEvents.filter(e => e.notes.includes('Late arrival')).length;
    const earlyLeaves = lateEarlyEvents.filter(e => e.notes.includes('Left early')).length;

    let message = `📊 End of Day Report - ${formatDate(today)}\n\n`;
    message += `✅ Present: ${arrived}/${totalExpected}`;
    if (totalExpected > 0) {
      message += ` (${Math.round(arrived / totalExpected * 100)}%)`;
    }
    message += `\n`;

    if (lateArrivals > 0) {
      message += `⚠️ Late arrivals: ${lateArrivals}\n`;
      const lateEvents = lateEarlyEvents.filter(e => e.notes.includes('Late arrival'));
      message += lateEvents.map(e => {
        const match = e.notes.match(/Late arrival: (\d+:\d+)/);
        const time = match ? match[1] : 'unknown';
        return `   • ${e.employee.name} (${time})`;
      }).join('\n') + '\n';
    }

    if (earlyLeaves > 0) {
      message += `⏰ Early leaves: ${earlyLeaves}\n`;
      const earlyEvents = lateEarlyEvents.filter(e => e.notes.includes('Left early'));
      message += earlyEvents.map(e => {
        const match = e.notes.match(/Left early: (\d+:\d+)/);
        const time = match ? match[1] : 'unknown';
        return `   • ${e.employee.name} (${time})`;
      }).join('\n') + '\n';
    }

    if (missed > 0) {
      message += `❌ Missed check-ins: ${missed}\n`;
      const missedCheckIns = checkIns.filter(c => c.status === 'MISSED');
      message += missedCheckIns.map(c => `   • ${c.employee.name}`).join('\n');
    }

    message += `\n\nEvents created: ${lateEarlyEvents.length}`;

    await notifyAdmins(bot, prisma, message);
  } catch (error) {
    console.error('End of day report error:', error);
  }
}

/**
 * Send weekly report to admins
 */
async function sendWeeklyReport(bot, prisma) {
  try {
    // Calculate last week's Monday to Sunday
    const now = new Date();
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - 7);
    lastMonday.setHours(0, 0, 0, 0);

    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    lastSunday.setHours(23, 59, 59, 999);

    // Get check-ins for last week
    const checkIns = await prisma.attendanceCheckIn.findMany({
      where: {
        date: {
          gte: lastMonday,
          lte: lastSunday
        }
      }
    });

    // Get events for last week
    const events = await prisma.event.findMany({
      where: {
        moderated: true,
        startDate: { lte: lastSunday },
        OR: [
          { endDate: { gte: lastMonday } },
          { endDate: null }
        ]
      }
    });

    const totalCheckIns = checkIns.length;
    const arrived = checkIns.filter(c => c.status === 'ARRIVED' || c.status === 'LEFT').length;
    const lateArrivals = events.filter(e =>
      e.type === 'LATE_LEFT_EARLY' && e.notes.includes('Late arrival')
    ).length;
    const homeOfficeDays = events.filter(e => e.type === 'HOME_OFFICE').length;
    const vacationDays = events.filter(e => e.type === 'VACATION').length;
    const sickDays = events.filter(e => e.type === 'SICK_DAY').length;

    const attendanceRate = totalCheckIns > 0 ? Math.round(arrived / totalCheckIns * 100) : 0;

    let message = `📊 Weekly Report\n`;
    message += `${formatDate(lastMonday)} - ${formatDate(lastSunday)}\n\n`;
    message += `📈 Attendance:\n`;
    message += `   Total check-ins: ${totalCheckIns}\n`;
    message += `   Attendance rate: ${attendanceRate}%\n`;
    message += `   Late arrivals: ${lateArrivals}\n\n`;
    message += `📅 Events:\n`;
    message += `   Home office days: ${homeOfficeDays}\n`;
    message += `   Vacation days: ${vacationDays}\n`;
    message += `   Sick days: ${sickDays}`;

    await notifyAdmins(bot, prisma, message);
  } catch (error) {
    console.error('Weekly report error:', error);
  }
}

/**
 * Check for work anniversaries and send notifications
 */
async function checkWorkAnniversaries(bot, prisma) {
  try {
    // Get all active employees
    const employees = await prisma.employee.findMany({
      where: {
        archived: false
      }
    });

    for (const employee of employees) {
      // Check if today is their work anniversary
      if (isWorkAnniversary(employee.startDate)) {
        const yearsOfService = getYearsOfService(employee.startDate);

        // Send notification to the employee (if they have telegram connected)
        if (employee.telegramUserId) {
          try {
            await bot.telegram.sendMessage(
              employee.telegramUserId.toString(),
              `🎉 Happy Work Anniversary!\n\n` +
              `Today marks ${yearsOfService} year${yearsOfService !== 1 ? 's' : ''} with the company!\n\n` +
              `🏖 Your vacation balance has been reset to ${employee.vacationDaysPerYear} days\n` +
              `🎉 Your holiday balance has been reset to ${employee.holidayDaysPerYear} days\n\n` +
              `Thank you for your dedication and hard work! 🌟\n\n` +
              `Use /balance to see your updated balance.`
            );
          } catch (error) {
            console.error(`Failed to send anniversary message to ${employee.name}:`, error);
          }
        }

        // Notify admins about the anniversary
        const adminMessage =
          `🎂 Work Anniversary Alert\n\n` +
          `${employee.name} celebrates ${yearsOfService} year${yearsOfService !== 1 ? 's' : ''} with the company today!\n\n` +
          `Their vacation and holiday balances have been automatically reset.`;

        await notifyAdmins(bot, prisma, adminMessage);

        console.log(`Work anniversary notification sent for ${employee.name} (${yearsOfService} years)`);
      }
    }
  } catch (error) {
    console.error('Work anniversary check error:', error);
  }
}

module.exports = {
  startSchedulers
};
