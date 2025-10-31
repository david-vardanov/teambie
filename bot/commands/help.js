const { getEmployeeByTelegramId, isAdmin } = require('../utils/helpers');

/**
 * /help command - Show available bot commands
 */
module.exports = async (ctx) => {
  const telegramUserId = BigInt(ctx.from.id);
  const prisma = ctx.prisma || require('@prisma/client').prisma;

  try {
    const employee = await getEmployeeByTelegramId(prisma, telegramUserId);

    if (!employee) {
      await ctx.reply(
        `👋 Welcome to Team Management Bot!\n\n` +
        `To get started, use /start to link your account with your email address.\n\n` +
        `After linking, you'll have access to all bot features.`
      );
      return;
    }

    // Check if user is admin
    const userIsAdmin = await isAdmin(prisma, telegramUserId);

    // Build help message based on role
    let helpMessage = `📋 Available Commands\n\n`;

    // Employee commands
    helpMessage += `👤 Employee Commands:\n\n`;
    helpMessage += `⏰ Attendance:\n`;
    helpMessage += `/checkin - Check in when you arrive\n`;
    helpMessage += `/checkout - Check out when you leave\n`;
    helpMessage += `/mystatus - View your schedule & settings\n\n`;
    helpMessage += `📅 Leave Requests:\n`;
    helpMessage += `/balance - View your vacation balance\n`;
    helpMessage += `/homeoffice [date] - Request home office\n`;
    helpMessage += `   Example: /homeoffice (tomorrow)\n`;
    helpMessage += `   Example: /homeoffice 2025-12-15\n\n`;
    helpMessage += `/vacation start [end] - Request vacation\n`;
    helpMessage += `   Example: /vacation 2025-12-20 (single day)\n`;
    helpMessage += `   Example: /vacation 2025-12-20 2025-12-25\n\n`;
    helpMessage += `/sick - Report sick day for tomorrow\n`;
    helpMessage += `/dayoff - Request a single day off\n\n`;
    helpMessage += `/help - Show this help message\n`;

    // Admin commands (only show if user is admin)
    if (userIsAdmin) {
      helpMessage += `\n👑 Admin Commands:\n\n`;
      helpMessage += `/teamstatus - View current team presence\n`;
      helpMessage += `/pending - View and moderate pending events\n`;
      helpMessage += `/weekreport - View weekly statistics\n`;
      helpMessage += `/broadcast - Send announcement to all employees\n`;
      helpMessage += `/admins - View list of system admins\n`;
      helpMessage += `/globalholiday YYYY-MM-DD Name - Create global holiday\n`;
      helpMessage += `/admincheckin - Manually check in an employee\n`;
      helpMessage += `/admincheckout - Manually check out an employee\n`;
    }

    helpMessage += `\n💡 Tip: All leave requests require admin approval.`;

    await ctx.reply(helpMessage);
  } catch (error) {
    console.error('Help command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
};
