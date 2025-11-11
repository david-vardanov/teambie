const { getEmployeeByTelegramId, getCurrentDate, formatDate, hasEventForDate, notifyAdmins } = require('../utils/helpers');

/**
 * /sick command - Report sick day for today
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

    const todayDate = getCurrentDate();

    // Check if already has an event for today
    const hasEvent = await hasEventForDate(prisma, employee.id, todayDate);

    if (hasEvent) {
      await ctx.reply(
        `You already have an event scheduled for today (${formatDate(todayDate)}).\n` +
        `Please contact an admin if you need to make changes.`
      );
      return;
    }

    // Create inline keyboard for confirmation
    await ctx.reply(
      `🤒 Report sick day for today (${formatDate(todayDate)})?`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, report', callback_data: `sick_confirm_${todayDate}` },
              { text: '❌ Cancel', callback_data: 'sick_cancel' }
            ]
          ]
        }
      }
    );
  } catch (error) {
    console.error('Sick command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
};

/**
 * Handle sick day confirmation callback
 */
async function handleCallback(ctx, prisma) {
  const data = ctx.callbackQuery.data;

  if (data === 'sick_cancel') {
    await ctx.answerCbQuery();
    await ctx.editMessageText('Request cancelled.');
    return;
  }

  if (data.startsWith('sick_confirm_')) {
    const date = data.replace('sick_confirm_', '');
    const telegramUserId = BigInt(ctx.from.id);

    try {
      const employee = await getEmployeeByTelegramId(prisma, telegramUserId);

      if (!employee) {
        await ctx.answerCbQuery('Error: Employee not found');
        return;
      }

      // Create sick day event (unmoderated)
      const event = await prisma.event.create({
        data: {
          employeeId: employee.id,
          type: 'SICK_DAY',
          startDate: new Date(date),
          endDate: new Date(date),
          moderated: false,
          notes: 'Reported via Telegram bot'
        }
      });

      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `✅ Sick day reported for ${formatDate(date)}!\n` +
        `Waiting for admin approval... ⏳\n\n` +
        `Get well soon! 🙏`
      );

      // Notify admins
      await notifyAdmins(
        ctx.telegram,
        prisma,
        `🤒 New Sick Day Report\n\n` +
        `👤 ${employee.name}\n` +
        `📅 ${formatDate(date)}`,
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
      console.error('Sick day confirmation error:', error);
      await ctx.answerCbQuery('An error occurred');
      await ctx.reply('Failed to create report. Please try again.');
    }
  }
}

module.exports.handleCallback = handleCallback;
