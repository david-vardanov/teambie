const { getEmployeeByTelegramId } = require('../utils/helpers');

/**
 * /start command - Link Telegram account to employee
 */
module.exports = async (ctx) => {
  const telegramUserId = BigInt(ctx.from.id);
  const prisma = ctx.prisma || require('@prisma/client').prisma;

  try {
    // Check if already linked
    const existingEmployee = await getEmployeeByTelegramId(prisma, telegramUserId);

    if (existingEmployee) {
      await ctx.reply(
        `Welcome back, ${existingEmployee.name}! 👋\n\n` +
        `Available commands:\n` +
        `/balance - View your vacation balance\n` +
        `/homeoffice - Request home office for tomorrow\n` +
        `/vacation - Request vacation days\n` +
        `/sick - Report sick day for today`
      );
      return;
    }

    // Ask for email to link account
    await ctx.reply(
      `Welcome to Team Management Bot! 👋\n\n` +
      `To get started, please reply with your registered email address.\n` +
      `Example: john@company.com`
    );

    // Store state to expect email
    ctx.session = ctx.session || {};
    ctx.session.awaitingEmail = true;
  } catch (error) {
    console.error('Start command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
};
