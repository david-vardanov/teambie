const { getEmployeeByTelegramId, getCurrentDate, getWorkHoursForToday, formatDate, isRecurringHomeOfficeDay } = require('../utils/helpers');

/**
 * /mystatus command - Show employee's current settings and status
 */
module.exports = async (ctx) => {
  const telegramUserId = BigInt(ctx.from.id);
  const prisma = ctx.prisma || require('@prisma/client').prisma;

  try {
    const employee = await getEmployeeByTelegramId(prisma, telegramUserId);

    if (!employee) {
      await ctx.reply('Please use /start to link your account first.');
      return;
    }

    const today = getCurrentDate();
    const todayDate = new Date(today);
    const workHours = getWorkHoursForToday(employee);

    // Get today's check-in if exists
    const checkIn = await prisma.attendanceCheckIn.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: todayDate
        }
      }
    });

    // Check for current/upcoming events
    const startOfDay = new Date(todayDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(todayDate);
    endOfDay.setHours(23, 59, 59, 999);

    const currentEvents = await prisma.event.findMany({
      where: {
        employeeId: employee.id,
        moderated: true,
        startDate: { lte: endOfDay },
        OR: [
          { endDate: { gte: startOfDay } },
          { endDate: null, startDate: { gte: startOfDay, lte: endOfDay } }
        ]
      },
      orderBy: { startDate: 'asc' }
    });

    // Check for late arrival/early checkout events
    const lateEarlyEvents = await prisma.event.findMany({
      where: {
        employeeId: employee.id,
        moderated: true,
        type: 'LATE_LEFT_EARLY',
        startDate: { lte: endOfDay },
        OR: [
          { endDate: { gte: startOfDay } },
          { endDate: null, startDate: { gte: startOfDay, lte: endOfDay } }
        ]
      },
      orderBy: { startDate: 'asc' }
    });

    // Build status message
    let message = `📊 Your Status - ${formatDate(today)}\n\n`;
    message += `👤 Name: ${employee.name}\n`;
    message += `📧 Email: ${employee.email}\n\n`;

    message += `⏰ Schedule:\n`;
    message += `   Arrival window: ${employee.arrivalWindowStart} - ${employee.arrivalWindowEnd}\n`;
    message += `   Work hours today: ${workHours}h\n`;
    if (employee.halfDayOnFridays) {
      message += `   Friday work hours: ${employee.workHoursOnFriday}h\n`;
    }

    if (employee.recurringHomeOfficeDays && employee.recurringHomeOfficeDays.length > 0) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const homeDays = employee.recurringHomeOfficeDays.map(d => dayNames[d]).join(', ');
      message += `   Recurring home office: ${homeDays}\n`;
    }

    message += `\n📅 Leave Balance:\n`;
    message += `   Vacation days/year: ${employee.vacationDaysPerYear}\n`;
    message += `   Holiday days/year: ${employee.holidayDaysPerYear}\n`;

    // Display current status
    const todayEvents = currentEvents.filter(event => {
      const eventStart = new Date(event.startDate);
      const eventEnd = event.endDate ? new Date(event.endDate) : eventStart;
      return eventStart <= endOfDay && eventEnd >= startOfDay;
    });

    if (todayEvents.length > 0 || isRecurringHomeOfficeDay(employee)) {
      message += `\n📍 Current Status:\n`;

      // Check for recurring home office
      if (isRecurringHomeOfficeDay(employee)) {
        message += `   🏠 Home Office (recurring)\n`;
      }

      // Display other events
      for (const event of todayEvents) {
        const eventStart = new Date(event.startDate);
        const eventEnd = event.endDate ? new Date(event.endDate) : null;

        let statusIcon = '📌';
        let statusText = event.type.replace(/_/g, ' ').toLowerCase();

        switch (event.type) {
          case 'VACATION':
            statusIcon = '🏖️';
            statusText = 'Vacation';
            break;
          case 'SICK_DAY':
            statusIcon = '🤒';
            statusText = 'Sick Day';
            break;
          case 'HOLIDAY':
            statusIcon = '🎉';
            statusText = 'Holiday';
            break;
          case 'HOME_OFFICE':
            statusIcon = '🏠';
            statusText = 'Home Office';
            break;
          case 'DAY_OFF_PAID':
            statusIcon = '🌴';
            statusText = 'Day Off (Paid)';
            break;
          case 'DAY_OFF_UNPAID':
            statusIcon = '🌴';
            statusText = 'Day Off (Unpaid)';
            break;
        }

        message += `   ${statusIcon} ${statusText}`;

        // Add duration if multi-day
        if (eventEnd && eventEnd > eventStart) {
          const duration = Math.ceil((eventEnd - eventStart) / (1000 * 60 * 60 * 24)) + 1;
          message += ` (${duration} days)`;
        }

        // Add location for holidays
        if (event.type === 'HOLIDAY' && event.notes) {
          message += ` - ${event.notes}`;
        }

        message += `\n`;
      }
    }

    // Display late arrival/early checkout
    if (lateEarlyEvents.length > 0) {
      message += `\n⏱️ Schedule Adjustments:\n`;
      for (const event of lateEarlyEvents) {
        const eventStart = new Date(event.startDate);
        const eventEnd = event.endDate ? new Date(event.endDate) : null;

        message += `   🕐 Late Arrival/Early Checkout`;

        if (eventEnd && eventEnd > eventStart) {
          const duration = Math.ceil((eventEnd - eventStart) / (1000 * 60 * 60 * 24)) + 1;
          message += ` (${duration} days)`;
        }

        if (event.notes) {
          message += ` - ${event.notes}`;
        }

        message += `\n`;
      }
    }

    if (checkIn) {
      message += `\n✅ Today's Check-in:\n`;
      message += `   Status: ${checkIn.status}\n`;
      if (checkIn.actualArrivalTime) {
        message += `   Arrived: ${checkIn.actualArrivalTime}\n`;
      }
      if (checkIn.actualDepartureTime) {
        message += `   Left: ${checkIn.actualDepartureTime}\n`;
      }
    } else {
      message += `\n⏳ No check-in yet today`;
    }

    await ctx.reply(message);
  } catch (error) {
    console.error('My status command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
};
