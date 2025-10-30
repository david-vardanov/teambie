const {
  getEmployeeByTelegramId,
  getCurrentDate,
  getDateInDays,
  formatDate,
  isPastDate,
  hasEventForDate,
  notifyAdmins
} = require('../utils/helpers');

/**
 * /dayoff command - Request a single day off
 */
async function dayoff(ctx) {
  const telegramUserId = BigInt(ctx.from.id);
  const prisma = ctx.prisma || require('@prisma/client').prisma;

  try {
    const employee = await getEmployeeByTelegramId(prisma, telegramUserId);

    if (!employee) {
      await ctx.reply('Please link your account first with /start');
      return;
    }

    // Show calendar for next 30 days
    const today = getCurrentDate();
    const buttons = [];
    let currentRow = [];

    for (let i = 1; i <= 30; i++) {
      const date = getDateInDays(i);
      const dateObj = new Date(date);
      const day = dateObj.getDate();
      const month = dateObj.getMonth() + 1;

      currentRow.push({
        text: `${month}/${day}`,
        callback_data: `dayoff_date_${date}`
      });

      if (currentRow.length === 5 || i === 30) {
        buttons.push([...currentRow]);
        currentRow = [];
      }
    }

    buttons.push([{ text: '❌ Cancel', callback_data: 'dayoff_cancel' }]);

    await ctx.reply(
      '📅 Request Day Off\n\n' +
      'Select a date (only 1 day allowed):\n' +
      'Note: Day off requests require admin approval.',
      {
        reply_markup: {
          inline_keyboard: buttons
        }
      }
    );

  } catch (error) {
    console.error('Day off command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
}

/**
 * Handle day off callbacks
 */
async function handleCallback(ctx, prisma) {
  const data = ctx.callbackQuery.data;
  const telegramUserId = BigInt(ctx.from.id);

  try {
    const employee = await getEmployeeByTelegramId(prisma, telegramUserId);
    if (!employee) {
      await ctx.answerCbQuery('Employee not found');
      return;
    }

    if (data === 'dayoff_cancel') {
      await ctx.answerCbQuery();
      await ctx.editMessageText('Day off request cancelled.');
      return;
    }

    if (data.startsWith('dayoff_date_')) {
      const dateStr = data.replace('dayoff_date_', '');
      const date = new Date(dateStr);

      // Validate date is not in the past
      if (isPastDate(dateStr)) {
        await ctx.answerCbQuery('Cannot request day off for past dates');
        return;
      }

      // Check if employee already has an event on this day
      const hasEvent = await hasEventForDate(prisma, employee.id, dateStr);
      if (hasEvent) {
        await ctx.answerCbQuery();
        await ctx.editMessageText(
          `⚠️ You already have an approved event on ${formatDate(date)}.\n\n` +
          `Please choose a different date or cancel existing event first.`
        );
        return;
      }

      // Check if there's already a pending day off request for this date
      const pendingDayOff = await prisma.event.findFirst({
        where: {
          employeeId: employee.id,
          moderated: false,
          startDate: date,
          type: {
            in: ['DAY_OFF_PAID', 'DAY_OFF_UNPAID']
          }
        }
      });

      if (pendingDayOff) {
        await ctx.answerCbQuery();
        await ctx.editMessageText(
          `⚠️ You already have a pending day off request for ${formatDate(date)}.\n\n` +
          `Please wait for admin approval.`
        );
        return;
      }

      // Ask for reason (optional)
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `Request day off on ${formatDate(date)}?\n\n` +
        `You can provide a reason (optional) by replying to this message, or confirm without reason.`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Confirm (no reason)', callback_data: `dayoff_confirm_${dateStr}_` },
              { text: '❌ Cancel', callback_data: 'dayoff_cancel' }
            ]]
          }
        }
      );

      // Store date in session for potential reason input
      if (ctx.session) {
        ctx.session.dayOffDate = dateStr;
      }

      return;
    }

    if (data.startsWith('dayoff_confirm_')) {
      const parts = data.replace('dayoff_confirm_', '').split('_');
      const dateStr = parts[0];
      const reason = parts.slice(1).join('_') || 'Day off request';

      const date = new Date(dateStr);

      // Create day off event (defaults to PAID, admin will decide)
      const event = await prisma.event.create({
        data: {
          employeeId: employee.id,
          type: 'DAY_OFF_PAID', // Default, admin will change if needed
          startDate: date,
          endDate: date,
          notes: reason,
          moderated: false
        }
      });

      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `✅ Day Off Request Submitted!\n\n` +
        `📅 Date: ${formatDate(date)}\n` +
        `📝 Reason: ${reason}\n\n` +
        `Your request is pending admin approval.\n` +
        `You'll be notified once it's reviewed.`
      );

      // Notify admins
      await notifyAdmins(
        ctx.telegram,
        prisma,
        `📅 New Day Off Request\n\n` +
        `👤 ${employee.name}\n` +
        `📅 Date: ${formatDate(date)}\n` +
        `📝 Reason: ${reason}\n\n` +
        `Use /pending to review and approve as paid/unpaid.`
      );

      console.log(`Day off request created for ${employee.name} on ${dateStr}`);
    }

  } catch (error) {
    console.error('Day off callback error:', error);
    await ctx.answerCbQuery('An error occurred');
  }
}

module.exports = {
  dayoff,
  handleCallback
};
