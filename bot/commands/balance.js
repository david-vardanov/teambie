const { getEmployeeByTelegramId, getCurrentDate, formatDate } = require('../utils/helpers');
const { calculateVacationBalance, calculateHolidayBalance } = require('../../utils/vacationHelper');

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

    // Fetch employee with events for balance calculation
    const employeeWithEvents = await prisma.employee.findUnique({
      where: { id: employee.id },
      include: {
        events: {
          where: {
            moderated: true
          }
        }
      }
    });

    // Calculate balances based on work anniversary
    const vacationBalance = calculateVacationBalance(employeeWithEvents);
    const holidayBalance = calculateHolidayBalance(employeeWithEvents);

    // Format period dates
    const periodStart = vacationBalance.periodStart.toISOString().split('T')[0];
    const periodEnd = vacationBalance.periodEnd.toISOString().split('T')[0];

    await ctx.reply(
      `📊 Your Balance\n\n` +
      `🏖 Vacation Days:\n` +
      `   Used: ${vacationBalance.daysTaken} / ${employeeWithEvents.vacationDaysPerYear}\n` +
      `   Remaining: ${vacationBalance.daysLeft}\n\n` +
      `🎉 Holiday Days:\n` +
      `   Used: ${holidayBalance.daysTaken} / ${employeeWithEvents.holidayDaysPerYear}\n` +
      `   Remaining: ${holidayBalance.daysLeft}\n\n` +
      `📅 Current Period:\n` +
      `   ${periodStart} to ${periodEnd}\n` +
      `   (Based on your work anniversary)`
    );
  } catch (error) {
    console.error('Balance command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
};
