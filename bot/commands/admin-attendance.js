const {
  isAdmin,
  getCurrentDate,
  getCurrentTime,
  formatDate,
  timeToMinutes,
  calculateDepartureTime,
  getWorkHoursForToday,
  hasEventForDate,
  isRecurringHomeOfficeDay
} = require('../utils/helpers');

/**
 * /admincheckin command - Admin manually checks in an employee
 */
async function adminCheckin(ctx) {
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
      where: {
        archived: false
      },
      include: {
        attendanceCheckIns: {
          where: { date: todayDate }
        }
      },
      orderBy: { name: 'asc' }
    });

    // Filter employees who haven't checked in yet
    const notCheckedIn = [];
    for (const emp of employees) {
      // Skip exempt employees
      if (emp.exemptFromTracking) continue;

      // Skip if recurring home office
      if (isRecurringHomeOfficeDay(emp)) continue;

      // Skip if has event today
      const hasEvent = await hasEventForDate(
        prisma,
        emp.id,
        today,
        ['VACATION', 'SICK_DAY', 'HOLIDAY', 'HOME_OFFICE']
      );
      if (hasEvent) continue;

      const checkIn = emp.attendanceCheckIns[0];

      // Include if no check-in or still waiting for arrival
      if (!checkIn || checkIn.status === 'WAITING_ARRIVAL' || checkIn.status === 'WAITING_ARRIVAL_REMINDER') {
        notCheckedIn.push(emp);
      }
    }

    if (notCheckedIn.length === 0) {
      await ctx.reply('✅ All employees have checked in today!');
      return;
    }

    // Create buttons for employees (max 5 per row)
    const buttons = [];
    let currentRow = [];

    for (const emp of notCheckedIn) {
      currentRow.push({
        text: emp.name,
        callback_data: `admin_checkin_emp_${emp.id}`
      });

      if (currentRow.length === 2) {
        buttons.push([...currentRow]);
        currentRow = [];
      }
    }

    if (currentRow.length > 0) {
      buttons.push(currentRow);
    }

    buttons.push([{ text: '❌ Cancel', callback_data: 'admin_checkin_cancel' }]);

    await ctx.reply(
      `👤 Select employee to check in (${notCheckedIn.length} not checked in):`,
      {
        reply_markup: {
          inline_keyboard: buttons
        }
      }
    );

  } catch (error) {
    console.error('Admin checkin command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
}

/**
 * /admincheckout command - Admin manually checks out an employee
 */
async function adminCheckout(ctx) {
  const telegramUserId = BigInt(ctx.from.id);
  const prisma = ctx.prisma || require('@prisma/client').prisma;

  try {
    if (!await isAdmin(prisma, telegramUserId)) {
      await ctx.reply('This command is only available to admins.');
      return;
    }

    const today = getCurrentDate();
    const todayDate = new Date(today);

    // Get all employees currently ARRIVED
    const checkIns = await prisma.attendanceCheckIn.findMany({
      where: {
        date: todayDate,
        status: {
          in: ['ARRIVED', 'WAITING_DEPARTURE', 'WAITING_DEPARTURE_REMINDER']
        }
      },
      include: { employee: true },
      orderBy: {
        employee: {
          name: 'asc'
        }
      }
    });

    if (checkIns.length === 0) {
      await ctx.reply('✅ No employees currently checked in.');
      return;
    }

    // Create buttons for employees
    const buttons = [];
    let currentRow = [];

    for (const checkIn of checkIns) {
      const emp = checkIn.employee;

      currentRow.push({
        text: emp.name,
        callback_data: `admin_checkout_emp_${emp.id}`
      });

      if (currentRow.length === 2) {
        buttons.push([...currentRow]);
        currentRow = [];
      }
    }

    if (currentRow.length > 0) {
      buttons.push(currentRow);
    }

    buttons.push([{ text: '❌ Cancel', callback_data: 'admin_checkout_cancel' }]);

    await ctx.reply(
      `👤 Select employee to check out (${checkIns.length} currently in office):`,
      {
        reply_markup: {
          inline_keyboard: buttons
        }
      }
    );

  } catch (error) {
    console.error('Admin checkout command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
}

/**
 * Handle admin attendance callbacks
 */
async function handleCallback(ctx, prisma) {
  const data = ctx.callbackQuery.data;
  const telegramUserId = BigInt(ctx.from.id);

  try {
    // Verify admin
    if (!await isAdmin(prisma, telegramUserId)) {
      await ctx.answerCbQuery('Only admins can use this feature');
      return;
    }

    if (data === 'admin_checkin_cancel' || data === 'admin_checkout_cancel') {
      await ctx.answerCbQuery();
      await ctx.editMessageText('Cancelled.');
      return;
    }

    // Handle employee selection for check-in
    if (data.startsWith('admin_checkin_emp_')) {
      const employeeId = parseInt(data.replace('admin_checkin_emp_', ''));

      // Store employee ID in session
      if (!ctx.session) ctx.session = {};
      ctx.session.adminCheckInEmployeeId = employeeId;

      const employee = await prisma.employee.findUnique({
        where: { id: employeeId }
      });

      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `Check in ${employee.name}\n\nWhat time did they arrive?`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Now', callback_data: 'admin_checkin_time_0' },
                { text: '15 min ago', callback_data: 'admin_checkin_time_15' }
              ],
              [
                { text: '30 min ago', callback_data: 'admin_checkin_time_30' },
                { text: '1 hour ago', callback_data: 'admin_checkin_time_60' }
              ],
              [
                { text: '2 hours ago', callback_data: 'admin_checkin_time_120' },
                { text: 'Custom time', callback_data: 'admin_checkin_time_custom' }
              ],
              [
                { text: '❌ Cancel', callback_data: 'admin_checkin_cancel' }
              ]
            ]
          }
        }
      );
      return;
    }

    // Handle employee selection for check-out
    if (data.startsWith('admin_checkout_emp_')) {
      const employeeId = parseInt(data.replace('admin_checkout_emp_', ''));

      // Store employee ID in session
      if (!ctx.session) ctx.session = {};
      ctx.session.adminCheckOutEmployeeId = employeeId;

      const employee = await prisma.employee.findUnique({
        where: { id: employeeId }
      });

      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `Check out ${employee.name}\n\nWhat time did they leave?`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Now', callback_data: 'admin_checkout_time_0' },
                { text: '15 min ago', callback_data: 'admin_checkout_time_15' }
              ],
              [
                { text: '30 min ago', callback_data: 'admin_checkout_time_30' },
                { text: '1 hour ago', callback_data: 'admin_checkout_time_60' }
              ],
              [
                { text: '2 hours ago', callback_data: 'admin_checkout_time_120' },
                { text: 'Custom time', callback_data: 'admin_checkout_time_custom' }
              ],
              [
                { text: '❌ Cancel', callback_data: 'admin_checkout_cancel' }
              ]
            ]
          }
        }
      );
      return;
    }

    // Handle check-in time selection
    if (data.startsWith('admin_checkin_time_')) {
      const employeeId = ctx.session?.adminCheckInEmployeeId;
      if (!employeeId) {
        await ctx.answerCbQuery('Session expired, please start again');
        return;
      }

      if (data === 'admin_checkin_time_custom') {
        await ctx.answerCbQuery();
        await ctx.editMessageText('Please reply with the arrival time in HH:MM format (e.g., "10:30")');
        return;
      }

      const minutesAgo = parseInt(data.replace('admin_checkin_time_', ''));
      await processAdminCheckIn(ctx, prisma, employeeId, minutesAgo);
      return;
    }

    // Handle check-out time selection
    if (data.startsWith('admin_checkout_time_')) {
      const employeeId = ctx.session?.adminCheckOutEmployeeId;
      if (!employeeId) {
        await ctx.answerCbQuery('Session expired, please start again');
        return;
      }

      if (data === 'admin_checkout_time_custom') {
        await ctx.answerCbQuery();
        await ctx.editMessageText('Please reply with the departure time in HH:MM format (e.g., "18:30")');
        return;
      }

      const minutesAgo = parseInt(data.replace('admin_checkout_time_', ''));
      await processAdminCheckOut(ctx, prisma, employeeId, minutesAgo);
      return;
    }

  } catch (error) {
    console.error('Admin attendance callback error:', error);
    await ctx.answerCbQuery('An error occurred');
  }
}

/**
 * Process admin check-in
 */
async function processAdminCheckIn(ctx, prisma, employeeId, minutesAgo) {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId }
    });

    const today = getCurrentDate();
    const todayDate = new Date(today);
    const currentTime = getCurrentTime();

    // Calculate arrival time
    const currentMinutes = timeToMinutes(currentTime);
    const arrivalMinutes = currentMinutes - minutesAgo;
    const hours = Math.floor(arrivalMinutes / 60);
    const mins = arrivalMinutes % 60;
    const arrivalTime = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

    // Check if late
    const windowEnd = employee.arrivalWindowEnd;
    const isLate = timeToMinutes(arrivalTime) > timeToMinutes(windowEnd);

    // Create or update check-in
    const existingCheckIn = await prisma.attendanceCheckIn.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: todayDate
        }
      }
    });

    if (existingCheckIn) {
      await prisma.attendanceCheckIn.update({
        where: { id: existingCheckIn.id },
        data: {
          status: 'ARRIVED',
          confirmedArrivalAt: new Date(),
          actualArrivalTime: arrivalTime
        }
      });
    } else {
      await prisma.attendanceCheckIn.create({
        data: {
          employeeId: employee.id,
          date: todayDate,
          status: 'ARRIVED',
          askedArrivalAt: new Date(),
          confirmedArrivalAt: new Date(),
          actualArrivalTime: arrivalTime
        }
      });
    }

    let message = `✅ Checked in ${employee.name} at ${arrivalTime}`;

    // Create late arrival event if necessary
    if (isLate) {
      const lateMinutes = timeToMinutes(arrivalTime) - timeToMinutes(windowEnd);
      const lateHours = Math.floor(lateMinutes / 60);
      const lateMins = lateMinutes % 60;
      let lateText = '';
      if (lateHours > 0) lateText += `${lateHours}h `;
      if (lateMins > 0) lateText += `${lateMins}m`;

      await prisma.event.create({
        data: {
          employeeId: employee.id,
          type: 'LATE_LEFT_EARLY',
          startDate: todayDate,
          endDate: todayDate,
          moderated: true,
          notes: `Late arrival: ${arrivalTime} (window ends at ${windowEnd}, ${lateText.trim()} late)`
        }
      });

      message += `\n\n⚠️ Late by ${lateText.trim()} (window: ${employee.arrivalWindowStart}-${windowEnd})`;
    }

    await ctx.answerCbQuery('Check-in recorded');
    await ctx.editMessageText(message);

    // Clear session
    if (ctx.session) {
      delete ctx.session.adminCheckInEmployeeId;
    }

    console.log(`Admin checked in ${employee.name} at ${arrivalTime}${isLate ? ' (LATE)' : ''}`);

  } catch (error) {
    console.error('Process admin check-in error:', error);
    await ctx.answerCbQuery('Error occurred');
    await ctx.editMessageText('Failed to check in. Please try again.');
  }
}

/**
 * Process admin check-out
 */
async function processAdminCheckOut(ctx, prisma, employeeId, minutesAgo) {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId }
    });

    const today = getCurrentDate();
    const todayDate = new Date(today);
    const currentTime = getCurrentTime();

    // Calculate departure time
    const currentMinutes = timeToMinutes(currentTime);
    const departureMinutes = currentMinutes - minutesAgo;
    const hours = Math.floor(departureMinutes / 60);
    const mins = departureMinutes % 60;
    const departureTime = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

    // Get check-in record
    const checkIn = await prisma.attendanceCheckIn.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: todayDate
        }
      }
    });

    if (!checkIn || !checkIn.actualArrivalTime) {
      await ctx.answerCbQuery('No check-in record found');
      await ctx.editMessageText('❌ Cannot check out: No check-in record found for today.');
      return;
    }

    // Calculate expected departure
    const workHours = getWorkHoursForToday(employee);
    const expectedDeparture = calculateDepartureTime(checkIn.actualArrivalTime, workHours);

    // Check if left early (more than 15 minutes before expected)
    const actualMinutes = timeToMinutes(departureTime);
    const expectedMinutes = timeToMinutes(expectedDeparture);
    const difference = expectedMinutes - actualMinutes;
    const leftEarly = difference > 15;

    // Update check-in record
    await prisma.attendanceCheckIn.update({
      where: { id: checkIn.id },
      data: {
        status: 'LEFT',
        confirmedDepartureAt: new Date(),
        actualDepartureTime: departureTime
      }
    });

    let message = `✅ Checked out ${employee.name} at ${departureTime}`;

    // Create early departure event if necessary
    if (leftEarly) {
      const hoursEarly = Math.floor(difference / 60);
      const minutesEarly = difference % 60;
      let earlyText = '';
      if (hoursEarly > 0) earlyText += `${hoursEarly}h `;
      if (minutesEarly > 0) earlyText += `${minutesEarly}m`;

      await prisma.event.create({
        data: {
          employeeId: employee.id,
          type: 'LATE_LEFT_EARLY',
          startDate: todayDate,
          endDate: todayDate,
          moderated: true,
          notes: `Left early: ${departureTime} (expected: ${expectedDeparture}, ${earlyText.trim()} early)`
        }
      });

      message += `\n\n⚠️ Left ${earlyText.trim()} early (expected: ${expectedDeparture})`;
    }

    await ctx.answerCbQuery('Check-out recorded');
    await ctx.editMessageText(message);

    // Clear session
    if (ctx.session) {
      delete ctx.session.adminCheckOutEmployeeId;
    }

    console.log(`Admin checked out ${employee.name} at ${departureTime}${leftEarly ? ' (EARLY)' : ''}`);

  } catch (error) {
    console.error('Process admin check-out error:', error);
    await ctx.answerCbQuery('Error occurred');
    await ctx.editMessageText('Failed to check out. Please try again.');
  }
}

module.exports = {
  adminCheckin,
  adminCheckout,
  handleCallback,
  processAdminCheckIn,
  processAdminCheckOut
};
