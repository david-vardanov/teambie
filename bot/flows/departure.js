const {
  getEmployeeByTelegramId,
  getCurrentDate,
  getCurrentTime,
  calculateDepartureTime,
  getWorkHoursForToday,
  timeToMinutes,
  notifyAdmins,
  formatDate
} = require('../utils/helpers');

/**
 * Ask employee if they left early
 */
async function askDeparture(bot, prisma, employee) {
  if (!employee.telegramUserId) return;

  const today = getCurrentDate();
  const todayDate = new Date(today);

  try {
    const checkIn = await prisma.attendanceCheckIn.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: todayDate
        }
      }
    });

    if (!checkIn || checkIn.status !== 'ARRIVED' || !checkIn.actualArrivalTime) {
      return; // Only ask if they actually arrived
    }

    const workHours = getWorkHoursForToday(employee);
    const expectedDeparture = calculateDepartureTime(checkIn.actualArrivalTime, workHours);

    // Calculate expected departure as datetime for auto-checkout
    const [hours, minutes] = expectedDeparture.split(':').map(Number);
    const expectedDepartureDate = new Date(todayDate);
    expectedDepartureDate.setHours(hours, minutes, 0, 0);

    await prisma.attendanceCheckIn.update({
      where: { id: checkIn.id },
      data: {
        status: 'WAITING_DEPARTURE',
        askedDepartureAt: new Date(),
        expectedDepartureAt: expectedDepartureDate
      }
    });

    await bot.telegram.sendMessage(
      employee.telegramUserId.toString(),
      `Hi ${employee.name}! 👋\n\n` +
      `Your expected departure time is ${expectedDeparture}.\n` +
      `Are you still in the office?`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Still here', callback_data: 'departure_still_here' },
            { text: '👋 Already left', callback_data: 'departure_left' }
          ]]
        }
      }
    );
  } catch (error) {
    console.error(`Error asking departure for ${employee.name}:`, error);
  }
}

/**
 * Handle departure callback
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

    const today = getCurrentDate();
    const todayDate = new Date(today);
    const currentTime = getCurrentTime();

    let checkIn = await prisma.attendanceCheckIn.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: todayDate
        }
      }
    });

    if (!checkIn) {
      await ctx.answerCbQuery('Check-in not found');
      return;
    }

    if (data === 'departure_still_here') {
      console.log(`${employee.name} clicked "still here"`);

      try {
        await prisma.attendanceCheckIn.update({
          where: { id: checkIn.id },
          data: { status: 'WAITING_DEPARTURE_REMINDER' }
        });

        await ctx.answerCbQuery('Got it! 👍');
        await ctx.editMessageText(
          `Great! Thanks for confirming. ✅\n\n` +
          `You'll be automatically checked out if you don't respond. Use /checkout when leaving.`
        );

        console.log(`${employee.name} marked as still here successfully`);
      } catch (err) {
        console.error(`Error updating status for ${employee.name}:`, err);
        await ctx.answerCbQuery('Error occurred, please try again');
        throw err;
      }

    } else if (data === 'departure_left') {
      // Ask what time they left
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        'What time did you leave?',
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '15 min ago', callback_data: 'departure_left_15' },
                { text: '30 min ago', callback_data: 'departure_left_30' }
              ],
              [
                { text: '1 hour ago', callback_data: 'departure_left_60' },
                { text: 'Other', callback_data: 'departure_left_other' }
              ]
            ]
          }
        }
      );

    } else if (data.startsWith('departure_left_')) {
      const minutes = parseInt(data.replace('departure_left_', ''));

      if (!isNaN(minutes)) {
        // Calculate actual departure time
        const currentMinutes = timeToMinutes(currentTime);
        const departureMinutes = currentMinutes - minutes;
        const hours = Math.floor(departureMinutes / 60);
        const mins = departureMinutes % 60;
        const departureTime = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

        await processDeparture(ctx, prisma, employee, checkIn, departureTime, todayDate);
      }

    } else if (data === 'departure_left_other') {
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        'Please reply with the time you left (e.g., "18:30")'
      );
    }

  } catch (error) {
    console.error('Departure callback error:', error);
    await ctx.answerCbQuery('An error occurred');
  }
}

/**
 * Process departure and check if left early
 */
async function processDeparture(ctx, prisma, employee, checkIn, departureTime, todayDate) {
  const workHours = getWorkHoursForToday(employee);
  const expectedDeparture = calculateDepartureTime(checkIn.actualArrivalTime, workHours);

  await prisma.attendanceCheckIn.update({
    where: { id: checkIn.id },
    data: {
      status: 'LEFT',
      confirmedDepartureAt: new Date(),
      actualDepartureTime: departureTime
    }
  });

  // Check if left early (more than 15 minutes before expected)
  const actualMinutes = timeToMinutes(departureTime);
  const expectedMinutes = timeToMinutes(expectedDeparture);
  const difference = expectedMinutes - actualMinutes;

  if (difference > 15) {
    // Left early - create event
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

    await ctx.editMessageText(
      `✅ Thanks! Departure recorded: ${departureTime}\n\n` +
      `Note: You left ${earlyText.trim()} before your expected time (${expectedDeparture}).`
    );

    // Notify admins
    await notifyAdmins(
      ctx.telegram,
      prisma,
      `⚠️ Early Departure\n\n` +
      `👤 ${employee.name}\n` +
      `⏰ Left: ${departureTime}\n` +
      `📅 Expected: ${expectedDeparture}\n` +
      `⏱ ${earlyText.trim()} early\n` +
      `📆 Date: ${formatDate(todayDate)}`
    );
  } else {
    await ctx.editMessageText(
      `✅ Thanks! Departure recorded: ${departureTime}\n\n` +
      `Have a great evening! 👋`
    );
  }
}

module.exports = {
  askDeparture,
  handleCallback
};
