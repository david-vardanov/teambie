const { isAdmin, getCurrentDate, formatDate, getEmployeeByTelegramId, notifyAllEmployees } = require('../utils/helpers');

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

    // Get all active employees (excluding exempt from tracking)
    const employees = await prisma.employee.findMany({
      where: {
        archived: false,
        exemptFromTracking: false
      },
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

      let inlineKeyboard;

      // For day off requests, show paid/unpaid options
      if (event.type === 'DAY_OFF_PAID' || event.type === 'DAY_OFF_UNPAID') {
        inlineKeyboard = [[
          { text: '✅ Paid', callback_data: `moderate_approve_paid_${event.id}` },
          { text: '💵 Unpaid', callback_data: `moderate_approve_unpaid_${event.id}` },
          { text: '❌ Reject', callback_data: `moderate_reject_${event.id}` }
        ]];
      } else {
        // For other events, show standard approve/reject
        inlineKeyboard = [[
          { text: '✅ Approve', callback_data: `moderate_approve_${event.id}` },
          { text: '❌ Reject', callback_data: `moderate_reject_${event.id}` }
        ]];
      }

      const displayType = event.type === 'DAY_OFF_PAID' || event.type === 'DAY_OFF_UNPAID'
        ? 'Day Off Request'
        : event.type.replace('_', ' ');

      await ctx.reply(
        `${event.employee.name} - ${displayType}\n${dateStr}${endStr}${event.notes ? `\n📝 ${event.notes}` : ''}`,
        {
          reply_markup: {
            inline_keyboard: inlineKeyboard
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

    // Get admin emails to exclude them (normalize to lowercase)
    const adminUsers = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { email: true }
    });
    const adminEmails = adminUsers.map(a => a.email.toLowerCase().trim());

    // Get all check-ins for the week
    const allCheckIns = await prisma.attendanceCheckIn.findMany({
      where: {
        date: {
          gte: monday,
          lte: sunday
        }
      },
      include: { employee: true }
    });

    // Filter out admins by comparing emails (case-insensitive)
    const checkIns = allCheckIns.filter(c =>
      !adminEmails.includes(c.employee.email.toLowerCase().trim())
    );

    // Get all events for the week
    const allEvents = await prisma.event.findMany({
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

    // Filter out admins by comparing emails (case-insensitive)
    const events = allEvents.filter(e =>
      e.employee && !adminEmails.includes(e.employee.email.toLowerCase().trim())
    );

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

/**
 * /globalholiday command - Create global holiday (Admin only)
 * Usage: /globalholiday YYYY-MM-DD Holiday Name
 * Example: /globalholiday 2025-12-25 Christmas Day
 */
async function holiday(ctx) {
  const telegramUserId = BigInt(ctx.from.id);
  const prisma = ctx.prisma || require('@prisma/client').prisma;

  try {
    if (!await isAdmin(prisma, telegramUserId)) {
      await ctx.reply('This command is only available to admins.');
      return;
    }

    const text = ctx.message.text.replace('/globalholiday', '').trim();

    if (!text) {
      await ctx.reply(
        '📅 Create Global Holiday\n\n' +
        'Usage: /globalholiday YYYY-MM-DD Holiday Name\n\n' +
        'Example:\n' +
        '/globalholiday 2025-12-25 Christmas Day'
      );
      return;
    }

    // Parse input: first word is date, rest is holiday name
    const parts = text.split(' ');
    if (parts.length < 2) {
      await ctx.reply('⚠️ Please provide both date and holiday name.\n\nExample: /globalholiday 2025-12-25 Christmas Day');
      return;
    }

    const dateStr = parts[0];
    const holidayName = parts.slice(1).join(' ');

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateStr)) {
      await ctx.reply('⚠️ Invalid date format. Please use YYYY-MM-DD\n\nExample: 2025-12-25');
      return;
    }

    const holidayDate = new Date(dateStr);
    if (isNaN(holidayDate.getTime())) {
      await ctx.reply('⚠️ Invalid date. Please check the date and try again.');
      return;
    }

    // Check if holiday already exists for this date
    const existingHoliday = await prisma.event.findFirst({
      where: {
        isGlobal: true,
        type: 'HOLIDAY',
        startDate: holidayDate
      }
    });

    if (existingHoliday) {
      await ctx.reply(`⚠️ A global holiday already exists for ${formatDate(holidayDate)}:\n"${existingHoliday.notes}"`);
      return;
    }

    // Create the global holiday
    const event = await prisma.event.create({
      data: {
        type: 'HOLIDAY',
        startDate: holidayDate,
        endDate: holidayDate,
        notes: holidayName,
        isGlobal: true,
        moderated: true,
        employeeId: null
      }
    });

    console.log(`✅ Global holiday created: ${holidayName} on ${dateStr}`);

    // Confirm to admin
    await ctx.reply(
      `✅ Global Holiday Created!\n\n` +
      `🎉 ${holidayName}\n` +
      `📅 ${formatDate(holidayDate)}\n\n` +
      `Notifying all employees...`
    );

    // Notify all employees
    const notificationMessage =
      `🎉 New Holiday Announced!\n\n` +
      `📅 Date: ${formatDate(holidayDate)}\n` +
      `🎊 ${holidayName}\n\n` +
      `This is a company-wide holiday.\n` +
      `Enjoy your day off! 🌟`;

    const result = await notifyAllEmployees(ctx.telegram, prisma, notificationMessage);

    // Report back to admin
    await ctx.reply(`📊 Notification sent to ${result.success} employee(s).${result.failed > 0 ? ` Failed: ${result.failed}` : ''}`);

  } catch (error) {
    console.error('Holiday command error:', error);
    await ctx.reply('An error occurred while creating the holiday. Please try again.');
  }
}

/**
 * /report command - Generate custom monthly report (Admin only)
 * Usage: /report december january february
 * Shows events grouped by employee for specified months
 */
async function report(ctx) {
  const telegramUserId = BigInt(ctx.from.id);
  const prisma = ctx.prisma || require('@prisma/client').prisma;

  try {
    if (!await isAdmin(prisma, telegramUserId)) {
      await ctx.reply('This command is only available to admins.');
      return;
    }

    const text = ctx.message.text.replace('/report', '').trim().toLowerCase();

    if (!text) {
      await ctx.reply(
        '📊 Custom Monthly Report\n\n' +
        'Usage: /report <month1> [month2] [month3]...\n\n' +
        'Examples:\n' +
        '/report december\n' +
        '/report december january\n' +
        '/report nov dec jan feb\n\n' +
        'Supported formats: full names (december) or abbreviations (dec)'
      );
      return;
    }

    // Month name mappings
    const monthMap = {
      'january': 0, 'jan': 0,
      'february': 1, 'feb': 1,
      'march': 2, 'mar': 2,
      'april': 3, 'apr': 3,
      'may': 4,
      'june': 5, 'jun': 5,
      'july': 6, 'jul': 6,
      'august': 7, 'aug': 7,
      'september': 8, 'sep': 8, 'sept': 8,
      'october': 9, 'oct': 9,
      'november': 10, 'nov': 10,
      'december': 11, 'dec': 11
    };

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // Parse requested months
    const words = text.split(/[\s,]+/).filter(w => w.length > 0);
    const requestedMonths = [];

    for (const word of words) {
      if (monthMap.hasOwnProperty(word)) {
        if (!requestedMonths.includes(monthMap[word])) {
          requestedMonths.push(monthMap[word]);
        }
      } else {
        await ctx.reply(`⚠️ Unknown month: "${word}"\n\nPlease use month names like "december" or "dec"`);
        return;
      }
    }

    if (requestedMonths.length === 0) {
      await ctx.reply('⚠️ No valid months specified. Please try again.');
      return;
    }

    // Sort months in order
    requestedMonths.sort((a, b) => a - b);

    // Determine the year (current year, or if months are in the future relative to now, might span years)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Calculate date ranges for each month
    const dateRanges = requestedMonths.map(month => {
      // If requesting a month that's after current month, assume previous year
      // Otherwise use current year
      let year = currentYear;
      if (month > currentMonth) {
        // Could be previous year (e.g., requesting December in January)
        // But for simplicity, we'll use current year and let admin specify
        // For now, assume current year
      }

      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999); // Last day of month

      return { month, year, startDate, endDate, monthName: monthNames[month] };
    });

    // Get overall date range
    const overallStart = dateRanges[0].startDate;
    const overallEnd = dateRanges[dateRanges.length - 1].endDate;

    // Get all non-archived employees
    const employees = await prisma.employee.findMany({
      where: { archived: false },
      orderBy: { name: 'asc' }
    });

    // Get all events in the date range
    const events = await prisma.event.findMany({
      where: {
        moderated: true,
        OR: [
          {
            // Event starts within range
            startDate: { gte: overallStart, lte: overallEnd }
          },
          {
            // Event ends within range
            endDate: { gte: overallStart, lte: overallEnd }
          },
          {
            // Event spans the entire range
            startDate: { lte: overallStart },
            endDate: { gte: overallEnd }
          }
        ]
      },
      include: { employee: true },
      orderBy: { startDate: 'asc' }
    });

    // Build report header
    const monthsLabel = dateRanges.map(d => d.monthName).join(', ');
    let message = `📊 ${monthsLabel} ${currentYear}\n\n`;

    // Event type info with emoji and label
    const eventInfo = {
      'VACATION': { emoji: '🏖', label: 'Vacation' },
      'SICK_DAY': { emoji: '🤒', label: 'Sick' },
      'HOME_OFFICE': { emoji: '🏠', label: 'Home Office' },
      'HOLIDAY': { emoji: '🎉', label: 'Holiday' },
      'LATE_LEFT_EARLY': { emoji: '⏰', label: 'Late/Early' },
      'DAY_OFF_PAID': { emoji: '💰', label: 'Day Off Paid' },
      'DAY_OFF_UNPAID': { emoji: '📅', label: 'Day Off Unpaid' }
    };

    // Helper to format a single date compactly
    const formatDateShort = (date) => {
      return `${date.getDate()} ${monthNames[date.getMonth()].slice(0, 3)}`;
    };

    // Helper to check if event falls within requested months
    const isEventInRequestedMonths = (event) => {
      const eventStart = new Date(event.startDate);
      const eventEnd = event.endDate ? new Date(event.endDate) : eventStart;

      for (const range of dateRanges) {
        if (eventStart <= range.endDate && eventEnd >= range.startDate) {
          return true;
        }
      }
      return false;
    };

    // Helper to merge consecutive single-day events into ranges
    const mergeConsecutiveEvents = (eventsList) => {
      if (eventsList.length === 0) return [];

      // Sort by start date
      const sorted = [...eventsList].sort((a, b) =>
        new Date(a.startDate) - new Date(b.startDate)
      );

      const merged = [];
      let currentRange = {
        start: new Date(sorted[0].startDate),
        end: sorted[0].endDate ? new Date(sorted[0].endDate) : new Date(sorted[0].startDate)
      };

      for (let i = 1; i < sorted.length; i++) {
        const eventStart = new Date(sorted[i].startDate);
        const eventEnd = sorted[i].endDate ? new Date(sorted[i].endDate) : eventStart;

        // Check if this event is consecutive (within 1 day of current range end)
        const dayAfterCurrentEnd = new Date(currentRange.end);
        dayAfterCurrentEnd.setDate(dayAfterCurrentEnd.getDate() + 1);

        if (eventStart <= dayAfterCurrentEnd) {
          // Extend the current range
          if (eventEnd > currentRange.end) {
            currentRange.end = eventEnd;
          }
        } else {
          // Save current range and start a new one
          merged.push(currentRange);
          currentRange = { start: eventStart, end: eventEnd };
        }
      }
      merged.push(currentRange);

      return merged;
    };

    // Helper to format merged ranges compactly
    const formatMergedRanges = (ranges) => {
      return ranges.map(r => {
        if (r.start.getTime() === r.end.getTime()) {
          return formatDateShort(r.start);
        } else {
          return `${formatDateShort(r.start)}-${formatDateShort(r.end)}`;
        }
      }).join(', ');
    };

    // Group events by employee
    const employeeEvents = {};
    let hasAnyEvents = false;

    for (const emp of employees) {
      const empEvents = events.filter(e =>
        e.employee && e.employee.id === emp.id && isEventInRequestedMonths(e)
      );

      if (empEvents.length > 0) {
        employeeEvents[emp.id] = {
          name: emp.name,
          events: empEvents
        };
        hasAnyEvents = true;
      }
    }

    // Also include global holidays
    const globalHolidays = events.filter(e => e.isGlobal && isEventInRequestedMonths(e));

    if (!hasAnyEvents && globalHolidays.length === 0) {
      message += `No events found.\n`;
      await ctx.reply(message);
      return;
    }

    // Add global holidays section if any
    if (globalHolidays.length > 0) {
      const holidayRanges = mergeConsecutiveEvents(globalHolidays);
      message += `🎉 Holidays: ${formatMergedRanges(holidayRanges)}\n\n`;
    }

    // Build employee sections - compact format
    for (const empId of Object.keys(employeeEvents)) {
      const empData = employeeEvents[empId];

      // Group events by type
      const eventsByType = {};
      for (const event of empData.events) {
        const type = event.type;
        if (!eventsByType[type]) {
          eventsByType[type] = [];
        }
        eventsByType[type].push(event);
      }

      // Build lines for each employee with labels
      const eventParts = [];
      for (const type of Object.keys(eventsByType)) {
        const typeEvents = eventsByType[type];
        const info = eventInfo[type] || { emoji: '📅', label: type };
        const mergedRanges = mergeConsecutiveEvents(typeEvents);
        eventParts.push(`${info.emoji} ${info.label}: ${formatMergedRanges(mergedRanges)}`);
      }

      message += `👤 ${empData.name}\n   ${eventParts.join('\n   ')}\n\n`;
    }

    // Telegram has a message limit of 4096 characters
    // Split message if needed
    if (message.length > 4000) {
      const chunks = [];
      let currentChunk = '';

      const lines = message.split('\n');
      for (const line of lines) {
        if ((currentChunk + line + '\n').length > 4000) {
          chunks.push(currentChunk);
          currentChunk = line + '\n';
        } else {
          currentChunk += line + '\n';
        }
      }
      if (currentChunk) {
        chunks.push(currentChunk);
      }

      for (let i = 0; i < chunks.length; i++) {
        if (i === 0) {
          await ctx.reply(chunks[i]);
        } else {
          await ctx.reply(`(continued...)\n${chunks[i]}`);
        }
      }
    } else {
      await ctx.reply(message);
    }

  } catch (error) {
    console.error('Report command error:', error);
    await ctx.reply('An error occurred generating the report. Please try again.');
  }
}

module.exports = {
  teamStatus,
  pending,
  weekReport,
  broadcast,
  admins,
  holiday,
  report
};
