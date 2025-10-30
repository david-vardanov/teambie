const { getEmployeeByTelegramId, getTomorrowDate, formatDate, getDateInDays, daysBetween, notifyAdmins } = require('../utils/helpers');
const { calculateVacationBalance } = require('../../utils/vacationHelper');

/**
 * /vacation command - Request vacation days
 * Format: /vacation 2025-12-25 2025-12-27
 * Or: /vacation 2025-12-25 (single day)
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

    // Parse command arguments
    const args = ctx.message.text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.reply(
        `📅 Request Vacation\n\n` +
        `Usage:\n` +
        `/vacation YYYY-MM-DD [YYYY-MM-DD]\n\n` +
        `Examples:\n` +
        `/vacation 2025-12-25 (single day)\n` +
        `/vacation 2025-12-25 2025-12-27 (3 days)\n\n` +
        `Note: Must be requested at least 1 day in advance (earliest: day after tomorrow).`
      );
      return;
    }

    const startDate = args[0];
    const endDate = args[1] || startDate;

    // Validate dates
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      await ctx.reply('Invalid date format. Please use YYYY-MM-DD format.');
      return;
    }

    // Check if dates are valid
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      await ctx.reply('Invalid dates. Please check your input.');
      return;
    }

    if (start > end) {
      await ctx.reply('Start date must be before or equal to end date.');
      return;
    }

    // Check if start date is at least 1 day in advance (not tomorrow, but day after tomorrow or later)
    const tomorrow = getTomorrowDate();
    if (startDate <= tomorrow) {
      await ctx.reply('❌ Vacation must be requested at least 1 day in advance. Earliest date you can request is the day after tomorrow.');
      return;
    }

    // Calculate days
    const days = daysBetween(startDate, endDate);

    // Check balance based on work anniversary
    // Fetch employee with events for balance calculation
    const employeeWithEvents = await prisma.employee.findUnique({
      where: { id: employee.id },
      include: {
        events: {
          where: {
            type: 'VACATION',
            moderated: true
          }
        }
      }
    });

    const vacationBalance = calculateVacationBalance(employeeWithEvents);
    const remaining = vacationBalance.daysLeft;

    if (days > remaining) {
      await ctx.reply(
        `❌ Insufficient balance!\n\n` +
        `Requested: ${days} days\n` +
        `Available: ${remaining} days\n\n` +
        `Use /balance to check your full balance.`
      );
      return;
    }

    // Check for conflicts
    const conflicts = await prisma.event.findMany({
      where: {
        employeeId: employee.id,
        startDate: { lte: end },
        OR: [
          { endDate: { gte: start } },
          { endDate: null, startDate: { gte: start, lte: end } }
        ]
      }
    });

    let conflictWarning = '';
    if (conflicts.length > 0) {
      conflictWarning = `\n\n⚠️ Warning: You have ${conflicts.length} existing event(s) during this period. Admin will review.`;
    }

    // Create confirmation message
    await ctx.reply(
      `📅 Request vacation?\n\n` +
      `From: ${formatDate(startDate)}\n` +
      `To: ${formatDate(endDate)}\n` +
      `Days: ${days}\n` +
      `Remaining after: ${remaining - days}${conflictWarning}`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, request', callback_data: `vacation_confirm_${startDate}_${endDate}` },
              { text: '❌ Cancel', callback_data: 'vacation_cancel' }
            ]
          ]
        }
      }
    );
  } catch (error) {
    console.error('Vacation command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
};

/**
 * Handle vacation confirmation callback
 */
async function handleCallback(ctx, prisma) {
  const data = ctx.callbackQuery.data;

  if (data === 'vacation_cancel') {
    await ctx.answerCbQuery();
    await ctx.editMessageText('Request cancelled.');
    return;
  }

  if (data.startsWith('vacation_confirm_')) {
    const parts = data.replace('vacation_confirm_', '').split('_');
    const startDate = parts[0];
    const endDate = parts[1];
    const telegramUserId = BigInt(ctx.from.id);

    try {
      const employee = await getEmployeeByTelegramId(prisma, telegramUserId);

      if (!employee) {
        await ctx.answerCbQuery('Error: Employee not found');
        return;
      }

      // Create vacation event (unmoderated)
      const event = await prisma.event.create({
        data: {
          employeeId: employee.id,
          type: 'VACATION',
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          moderated: false,
          notes: 'Requested via Telegram bot'
        }
      });

      const days = daysBetween(startDate, endDate);

      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `✅ Vacation request sent!\n\n` +
        `${formatDate(startDate)} - ${formatDate(endDate)}\n` +
        `${days} day(s)\n\n` +
        `Waiting for admin approval... ⏳`
      );

      // Notify admins
      await notifyAdmins(
        ctx.telegram,
        prisma,
        `📝 New Vacation Request\n\n` +
        `👤 ${employee.name}\n` +
        `📅 ${formatDate(startDate)} - ${formatDate(endDate)}\n` +
        `Days: ${days}`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Approve', callback_data: `moderate_approve_${event.id}` },
              { text: '❌ Reject', callback_data: `moderate_reject_${event.id}` }
            ]]
          }
        }
      );
    } catch (error) {
      console.error('Vacation confirmation error:', error);
      await ctx.answerCbQuery('An error occurred');
      await ctx.reply('Failed to create request. Please try again.');
    }
  }
}

module.exports.handleCallback = handleCallback;
