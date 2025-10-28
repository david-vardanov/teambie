const { getEmployeeByTelegramId, getCurrentDate, getWorkHoursForToday, formatDate } = require('../utils/helpers');

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
