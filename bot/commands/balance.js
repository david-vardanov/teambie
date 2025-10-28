const { getEmployeeByTelegramId, getCurrentDate } = require('../utils/helpers');

/**
 * /balance command - Show vacation and holiday balance
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

    // Calculate vacation days taken this year
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const vacationEvents = await prisma.event.findMany({
      where: {
        employeeId: employee.id,
        type: 'VACATION',
        moderated: true,
        startDate: { gte: yearStart }
      }
    });

    let vacationDaysTaken = 0;
    for (const event of vacationEvents) {
      const start = new Date(event.startDate);
      const end = event.endDate ? new Date(event.endDate) : start;
      const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
      vacationDaysTaken += days;
    }

    // Calculate holiday days taken this year
    const holidayEvents = await prisma.event.findMany({
      where: {
        employeeId: employee.id,
        type: 'HOLIDAY',
        moderated: true,
        startDate: { gte: yearStart }
      }
    });

    let holidayDaysTaken = 0;
    for (const event of holidayEvents) {
      const start = new Date(event.startDate);
      const end = event.endDate ? new Date(event.endDate) : start;
      const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
      holidayDaysTaken += days;
    }

    const vacationRemaining = employee.vacationDaysPerYear - vacationDaysTaken;
    const holidayRemaining = employee.holidayDaysPerYear - holidayDaysTaken;

    await ctx.reply(
      `📊 Your Balance\n\n` +
      `🏖 Vacation Days:\n` +
      `   Used: ${vacationDaysTaken} / ${employee.vacationDaysPerYear}\n` +
      `   Remaining: ${vacationRemaining}\n\n` +
      `🎉 Holiday Days:\n` +
      `   Used: ${holidayDaysTaken} / ${employee.holidayDaysPerYear}\n` +
      `   Remaining: ${holidayRemaining}`
    );
  } catch (error) {
    console.error('Balance command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
};
