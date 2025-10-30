const { isAdmin, getCurrentDate, formatDate, getEmployeeByTelegramId } = require('../utils/helpers');

/**
 * /teamstatus command - Show current team presence (Admin only)
 */
async function teamStatus(ctx) {
  const telegramUserId = BigInt(ctx.from.id);
  const prisma = ctx.prisma || require('@prisma/client').prisma;

  try {
    if (!await isAdmin(prisma, telegramUserId)) {
      await ctx.reply('This command is only available to admins.');
      return;
    }

    const today = getCurrentDate();
    const todayDate = new Date(today);

    // Get all active employees
    const employees = await prisma.employee.findMany({
      where: { archived: false },
      include: {
        events: {
          where: {
            startDate: { lte: todayDate },
            OR: [
              { endDate: { gte: todayDate } },
              { endDate: null }
            ],
            moderated: true
          }
        },
        attendanceCheckIns: {
          where: { date: todayDate }
        }
      }
    });

    let inOffice = [];
    let homeOffice = [];
    let onVacation = [];
    let sick = [];
    let notArrived = [];

    for (const emp of employees) {
      const todayEvents = emp.events.filter(e => {
        const start = new Date(e.startDate);
        const end = e.endDate ? new Date(e.endDate) : start;
        return start <= todayDate && end >= todayDate;
      });

      if (todayEvents.some(e => e.type === 'VACATION')) {
        onVacation.push(emp.name);
      } else if (todayEvents.some(e => e.type === 'SICK_DAY')) {
        sick.push(emp.name);
      } else if (todayEvents.some(e => e.type === 'HOME_OFFICE')) {
        homeOffice.push(emp.name);
      } else {
        const checkIn = emp.attendanceCheckIns[0];
        if (checkIn && checkIn.status === 'ARRIVED') {
          inOffice.push(`${emp.name} (${checkIn.actualArrivalTime})`);
        } else {
          notArrived.push(emp.name);
        }
      }
    }

    let message = `📊 Team Status - ${formatDate(today)}\n\n`;
    message += `🏢 In Office: ${inOffice.length}\n`;
    if (inOffice.length > 0) message += inOffice.map(n => `   • ${n}`).join('\n') + '\n';

    message += `\n🏠 Home Office: ${homeOffice.length}\n`;
    if (homeOffice.length > 0) message += homeOffice.map(n => `   • ${n}`).join('\n') + '\n';

    message += `\n🏖 On Vacation: ${onVacation.length}\n`;
    if (onVacation.length > 0) message += onVacation.map(n => `   • ${n}`).join('\n') + '\n';

    message += `\n🤒 Sick: ${sick.length}\n`;
    if (sick.length > 0) message += sick.map(n => `   • ${n}`).join('\n') + '\n';

    message += `\n⏳ Not Arrived: ${notArrived.length}\n`;
    if (notArrived.length > 0) message += notArrived.map(n => `   • ${n}`).join('\n');

    await ctx.reply(message);
  } catch (error) {
    console.error('Team status command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
}

/**
 * /pending command - Show pending events for moderation (Admin only)
 */
async function pending(ctx) {
  const telegramUserId = BigInt(ctx.from.id);
  const prisma = ctx.prisma || require('@prisma/client').prisma;

  try {
    if (!await isAdmin(prisma, telegramUserId)) {
      await ctx.reply('This command is only available to admins.');
      return;
    }

    const pendingEvents = await prisma.event.findMany({
      where: { moderated: false },
      include: { employee: true },
      orderBy: { createdAt: 'asc' }
    });

    if (pendingEvents.length === 0) {
      await ctx.reply('No pending events to review. ✅');
      return;
    }

    let message = `📝 Pending Events (${pendingEvents.length})\n\n`;

    for (const event of pendingEvents) {
      const typeEmoji = {
        'HOME_OFFICE': '🏠',
        'VACATION': '🏖',
        'SICK_DAY': '🤒',
        'HOLIDAY': '🎉'
      }[event.type] || '📅';

      message += `${typeEmoji} ${event.employee.name}\n`;
      message += `   Type: ${event.type.replace('_', ' ')}\n`;
      message += `   Date: ${formatDate(event.startDate)}`;
      if (event.endDate && event.startDate.getTime() !== event.endDate.getTime()) {
        message += ` - ${formatDate(event.endDate)}`;
      }
      message += '\n\n';
    }

    await ctx.reply(message);

    // Send approval buttons for each event
    for (const event of pendingEvents) {
      const dateStr = formatDate(event.startDate);
      const endStr = event.endDate && event.startDate.getTime() !== event.endDate.getTime()
        ? ` - ${formatDate(event.endDate)}`
        : '';

      await ctx.reply(
        `${event.employee.name} - ${event.type.replace('_', ' ')}\n${dateStr}${endStr}`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Approve', callback_data: `moderate_approve_${event.id}` },
              { text: '❌ Reject', callback_data: `moderate_reject_${event.id}` }
            ]]
          }
        }
      );
    }
  } catch (error) {
    console.error('Pending command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
}

/**
 * /weekreport command - Show weekly report (Admin only)
 */
async function weekReport(ctx) {
  const telegramUserId = BigInt(ctx.from.id);
  const prisma = ctx.prisma || require('@prisma/client').prisma;

  try {
    if (!await isAdmin(prisma, telegramUserId)) {
      await ctx.reply('This command is only available to admins.');
      return;
    }

    // Calculate week start (Monday) and end (Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    // Get all check-ins for the week
    const checkIns = await prisma.attendanceCheckIn.findMany({
      where: {
        date: {
          gte: monday,
          lte: sunday
        }
      },
      include: { employee: true }
    });

    // Get all events for the week
    const events = await prisma.event.findMany({
      where: {
        moderated: true,
        startDate: { lte: sunday },
        OR: [
          { endDate: { gte: monday } },
          { endDate: null }
        ]
      },
      include: { employee: true }
    });

    // Calculate statistics
    let totalCheckIns = checkIns.length;
    let arrivedOnTime = checkIns.filter(c => c.status === 'ARRIVED').length;
    let lateArrivals = events.filter(e => e.type === 'LATE_LEFT_EARLY').length;
    let homeOfficeDays = events.filter(e => e.type === 'HOME_OFFICE').length;
    let vacationDays = events.filter(e => e.type === 'VACATION').length;
    let sickDays = events.filter(e => e.type === 'SICK_DAY').length;

    let message = `📊 Weekly Report\n`;
    message += `${formatDate(monday)} - ${formatDate(sunday)}\n\n`;
    message += `📈 Attendance:\n`;
    message += `   Total check-ins: ${totalCheckIns}\n`;
    message += `   On time: ${arrivedOnTime}\n`;
    message += `   Late arrivals: ${lateArrivals}\n\n`;
    message += `📅 Events:\n`;
    message += `   Home office days: ${homeOfficeDays}\n`;
    message += `   Vacation days: ${vacationDays}\n`;
    message += `   Sick days: ${sickDays}\n`;

    await ctx.reply(message);
  } catch (error) {
    console.error('Week report command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
}

/**
 * /broadcast command - Send message to all employees (Admin only)
 * Usage: /broadcast Your message here
 */
async function broadcast(ctx) {
  const telegramUserId = BigInt(ctx.from.id);
  const prisma = ctx.prisma || require('@prisma/client').prisma;

  try {
    if (!await isAdmin(prisma, telegramUserId)) {
      await ctx.reply('This command is only available to admins.');
      return;
    }

    const message = ctx.message.text.replace('/broadcast', '').trim();

    if (!message) {
      await ctx.reply('Usage: /broadcast Your message here');
      return;
    }

    const employees = await prisma.employee.findMany({
      where: {
        telegramUserId: { not: null }
      }
    });

    let sent = 0;
    let failed = 0;

    for (const emp of employees) {
      try {
        await ctx.telegram.sendMessage(
          emp.telegramUserId.toString(),
          `📢 Announcement:\n\n${message}`
        );
        sent++;
      } catch (error) {
        console.error(`Failed to send to ${emp.name}:`, error);
        failed++;
      }
    }

    await ctx.reply(`✅ Broadcast sent to ${sent} employees. ${failed > 0 ? `Failed: ${failed}` : ''}`);
  } catch (error) {
    console.error('Broadcast command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
}

/**
 * /admins command - Show list of all admins (Admin only)
 */
async function admins(ctx) {
  const telegramUserId = BigInt(ctx.from.id);
  const prisma = ctx.prisma || require('@prisma/client').prisma;

  try {
    if (!await isAdmin(prisma, telegramUserId)) {
      await ctx.reply('This command is only available to admins.');
      return;
    }

    // Get all users with ADMIN role
    const adminUsers = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: { name: 'asc' }
    });

    if (adminUsers.length === 0) {
      await ctx.reply('No admins found in the system.');
      return;
    }

    let message = `👑 System Admins (${adminUsers.length})\n\n`;

    for (const admin of adminUsers) {
      // Try to find linked employee
      const employee = await prisma.employee.findFirst({
        where: { email: admin.email }
      });

      message += `• ${admin.name}\n`;
      message += `  Email: ${admin.email}\n`;

      if (employee) {
        if (employee.telegramUserId) {
          message += `  Telegram: ✅ Connected\n`;
        } else {
          message += `  Telegram: ❌ Not connected\n`;
        }
      } else {
        message += `  Employee Profile: ❌ Not linked\n`;
      }
      message += '\n';
    }

    await ctx.reply(message);
  } catch (error) {
    console.error('Admins command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
}

module.exports = {
  teamStatus,
  pending,
  weekReport,
  broadcast,
  admins
};
