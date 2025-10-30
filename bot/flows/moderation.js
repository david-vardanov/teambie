const { isAdmin, formatDate } = require('../utils/helpers');

/**
 * Handle moderation callback
 */
async function handleCallback(ctx, prisma) {
  const data = ctx.callbackQuery.data;
  const telegramUserId = BigInt(ctx.from.id);

  try {
    // Check if user is admin
    if (!await isAdmin(prisma, telegramUserId)) {
      await ctx.answerCbQuery('Only admins can moderate events');
      return;
    }

    if (data.startsWith('moderate_approve_paid_')) {
      const eventId = parseInt(data.replace('moderate_approve_paid_', ''));
      await approveDayOffEvent(ctx, prisma, eventId, 'PAID');

    } else if (data.startsWith('moderate_approve_unpaid_')) {
      const eventId = parseInt(data.replace('moderate_approve_unpaid_', ''));
      await approveDayOffEvent(ctx, prisma, eventId, 'UNPAID');

    } else if (data.startsWith('moderate_approve_')) {
      const eventId = parseInt(data.replace('moderate_approve_', ''));
      await approveEvent(ctx, prisma, eventId);

    } else if (data.startsWith('moderate_reject_')) {
      const eventId = parseInt(data.replace('moderate_reject_', ''));
      await rejectEvent(ctx, prisma, eventId);
    }

  } catch (error) {
    console.error('Moderation callback error:', error);
    await ctx.answerCbQuery('An error occurred');
  }
}

/**
 * Approve an event
 */
async function approveEvent(ctx, prisma, eventId) {
  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { employee: true }
    });

    if (!event) {
      await ctx.answerCbQuery('Event not found');
      return;
    }

    if (event.moderated) {
      await ctx.answerCbQuery('Event already moderated');
      return;
    }

    // Update event to moderated
    await prisma.event.update({
      where: { id: eventId },
      data: { moderated: true }
    });

    await ctx.answerCbQuery('Approved!');

    const dateStr = formatDate(event.startDate);
    const endStr = event.endDate && event.startDate.getTime() !== event.endDate.getTime()
      ? ` - ${formatDate(event.endDate)}`
      : '';

    await ctx.editMessageText(
      `✅ APPROVED\n\n` +
      `${event.employee.name} - ${event.type.replace('_', ' ')}\n` +
      `${dateStr}${endStr}`
    );

    // Notify employee
    if (event.employee.telegramUserId) {
      const typeEmoji = {
        'HOME_OFFICE': '🏠',
        'VACATION': '🏖',
        'SICK_DAY': '🤒',
        'HOLIDAY': '🎉'
      }[event.type] || '📅';

      try {
        await ctx.telegram.sendMessage(
          event.employee.telegramUserId.toString(),
          `✅ Your ${event.type.replace('_', ' ').toLowerCase()} request was approved!\n\n` +
          `${typeEmoji} ${dateStr}${endStr}`
        );
      } catch (error) {
        console.error(`Failed to notify employee ${event.employee.name}:`, error);
      }
    }

  } catch (error) {
    console.error('Approve event error:', error);
    await ctx.answerCbQuery('Failed to approve');
  }
}

/**
 * Reject an event
 */
async function rejectEvent(ctx, prisma, eventId) {
  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { employee: true }
    });

    if (!event) {
      await ctx.answerCbQuery('Event not found');
      return;
    }

    if (event.moderated) {
      await ctx.answerCbQuery('Event already moderated');
      return;
    }

    // Delete the event
    await prisma.event.delete({
      where: { id: eventId }
    });

    await ctx.answerCbQuery('Rejected!');

    const dateStr = formatDate(event.startDate);
    const endStr = event.endDate && event.startDate.getTime() !== event.endDate.getTime()
      ? ` - ${formatDate(event.endDate)}`
      : '';

    await ctx.editMessageText(
      `❌ REJECTED\n\n` +
      `${event.employee.name} - ${event.type.replace('_', ' ')}\n` +
      `${dateStr}${endStr}`
    );

    // Notify employee
    if (event.employee.telegramUserId) {
      const typeEmoji = {
        'HOME_OFFICE': '🏠',
        'VACATION': '🏖',
        'SICK_DAY': '🤒',
        'HOLIDAY': '🎉'
      }[event.type] || '📅';

      try {
        await ctx.telegram.sendMessage(
          event.employee.telegramUserId.toString(),
          `❌ Your ${event.type.replace('_', ' ').toLowerCase()} request was rejected.\n\n` +
          `${typeEmoji} ${dateStr}${endStr}\n\n` +
          `Please contact an admin if you have questions.`
        );
      } catch (error) {
        console.error(`Failed to notify employee ${event.employee.name}:`, error);
      }
    }

  } catch (error) {
    console.error('Reject event error:', error);
    await ctx.answerCbQuery('Failed to reject');
  }
}

/**
 * Approve a day off event (paid or unpaid)
 */
async function approveDayOffEvent(ctx, prisma, eventId, paymentType) {
  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { employee: true }
    });

    if (!event) {
      await ctx.answerCbQuery('Event not found');
      return;
    }

    if (event.moderated) {
      await ctx.answerCbQuery('Event already moderated');
      return;
    }

    // Determine the event type based on payment type
    const eventType = paymentType === 'PAID' ? 'DAY_OFF_PAID' : 'DAY_OFF_UNPAID';

    // Update event
    await prisma.event.update({
      where: { id: eventId },
      data: {
        type: eventType,
        moderated: true
      }
    });

    await ctx.answerCbQuery(`Approved as ${paymentType}!`);

    const dateStr = formatDate(event.startDate);

    await ctx.editMessageText(
      `✅ APPROVED AS ${paymentType}\n\n` +
      `${event.employee.name} - Day Off (${paymentType})\n` +
      `${dateStr}`
    );

    // Notify employee
    if (event.employee.telegramUserId) {
      try {
        await ctx.telegram.sendMessage(
          event.employee.telegramUserId.toString(),
          `✅ Your day off request was approved!\n\n` +
          `📅 Date: ${dateStr}\n` +
          `💵 Type: ${paymentType}\n\n` +
          `Enjoy your day off!`
        );
      } catch (error) {
        console.error(`Failed to notify employee ${event.employee.name}:`, error);
      }
    }

  } catch (error) {
    console.error('Approve day off error:', error);
    await ctx.answerCbQuery('Failed to approve');
  }
}

module.exports = {
  handleCallback
};
