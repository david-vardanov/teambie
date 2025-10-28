const { getEmployeeByTelegramId, getTomorrowDate, formatDate, hasEventForDate, notifyAdmins, isPastDate, getDateInDays } = require('../utils/helpers');

/**
 * /homeoffice command - Request home office
 * Format: /homeoffice [YYYY-MM-DD] (defaults to tomorrow if no date provided)
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

    // Parse date argument or default to tomorrow
    const args = ctx.message.text.split(' ').slice(1);
    let requestDate;

    if (args.length > 0) {
      // User provided a date
      const dateArg = args[0];
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

      if (!dateRegex.test(dateArg)) {
        await ctx.reply(
          `❌ Invalid date format. Use YYYY-MM-DD\n\n` +
          `Examples:\n` +
          `/homeoffice (for tomorrow)\n` +
          `/homeoffice 2025-11-15 (for specific date)`
        );
        return;
      }

      requestDate = dateArg;

      // Check if date is in the past or today
      if (isPastDate(requestDate) || requestDate === new Date().toISOString().split('T')[0]) {
        await ctx.reply('❌ Cannot request home office for past dates or today. Please request at least 1 day in advance.');
        return;
      }
    } else {
      // Default to tomorrow
      requestDate = getTomorrowDate();
    }

    // Check if already has an event for that date
    const hasEvent = await hasEventForDate(prisma, employee.id, requestDate);

    if (hasEvent) {
      await ctx.reply(
        `You already have an event scheduled for ${formatDate(requestDate)}.\n` +
        `Please contact an admin if you need to make changes.`
      );
      return;
    }

    // Create inline keyboard for confirmation
    await ctx.reply(
      `📅 Request home office for ${formatDate(requestDate)}?`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, request', callback_data: `homeoffice_confirm_${requestDate}` },
              { text: '❌ Cancel', callback_data: 'homeoffice_cancel' }
            ]
          ]
        }
      }
    );
  } catch (error) {
    console.error('Home office command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
};

/**
 * Handle home office confirmation callback
 */
async function handleCallback(ctx, prisma) {
  const data = ctx.callbackQuery.data;

  if (data === 'homeoffice_cancel') {
    await ctx.answerCbQuery();
    await ctx.editMessageText('Request cancelled.');
    return;
  }

  if (data.startsWith('homeoffice_confirm_')) {
    const date = data.replace('homeoffice_confirm_', '');
    const telegramUserId = BigInt(ctx.from.id);

    try {
      const employee = await getEmployeeByTelegramId(prisma, telegramUserId);

      if (!employee) {
        await ctx.answerCbQuery('Error: Employee not found');
        return;
      }

      // Create home office event (unmoderated)
      const event = await prisma.event.create({
        data: {
          employeeId: employee.id,
          type: 'HOME_OFFICE',
          startDate: new Date(date),
          endDate: new Date(date),
          moderated: false,
          notes: 'Requested via Telegram bot'
        }
      });

      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `✅ Home office request sent for ${formatDate(date)}!\n` +
        `Waiting for admin approval... ⏳`
      );

      // Notify admins
      await notifyAdmins(
        ctx.telegram,
        prisma,
        `📝 New home office request:\n\n` +
        `👤 ${employee.name}\n` +
        `📅 ${formatDate(date)}\n\n` +
        `Use /pending to review.`,
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
      console.error('Home office confirmation error:', error);
      await ctx.answerCbQuery('An error occurred');
      await ctx.reply('Failed to create request. Please try again.');
    }
  }
}

module.exports.handleCallback = handleCallback;
