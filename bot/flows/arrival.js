const {
  getEmployeeByTelegramId,
  getCurrentDate,
  getCurrentTime,
  isWithinArrivalWindow,
  isLate,
  calculateDepartureTime,
  getWorkHoursForToday,
  notifyAdmins,
  formatDate
} = require('../utils/helpers');

/**
 * Ask employee if they arrived
 */
async function askArrival(bot, prisma, employee) {
  if (!employee.telegramUserId) return;

  const today = getCurrentDate();
  const todayDate = new Date(today);

  try {
    // Check if already has check-in for today
    let checkIn = await prisma.attendanceCheckIn.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: todayDate
        }
      }
    });

    if (!checkIn) {
      checkIn = await prisma.attendanceCheckIn.create({
        data: {
          employeeId: employee.id,
          date: todayDate,
          status: 'WAITING_ARRIVAL',
          askedArrivalAt: new Date()
        }
      });
    }

    await bot.telegram.sendMessage(
      employee.telegramUserId.toString(),
      `Good morning, ${employee.name}! 👋\n\nDid you arrive at the office?`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Yes, I\'m here', callback_data: 'arrival_yes' },
            { text: '⏳ Not yet', callback_data: 'arrival_not_yet' }
          ]]
        }
      }
    );
  } catch (error) {
    console.error(`Error asking arrival for ${employee.name}:`, error);
  }
}

/**
 * Handle arrival callback
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

    if (data === 'arrival_yes') {
      // Employee confirmed arrival
      const workHours = getWorkHoursForToday(employee);
      const departureTime = calculateDepartureTime(currentTime, workHours);

      await prisma.attendanceCheckIn.update({
        where: { id: checkIn.id },
        data: {
          status: 'ARRIVED',
          confirmedArrivalAt: new Date(),
          actualArrivalTime: currentTime
        }
      });

      // Check if late BEFORE sending confirmation message
      const isLateArrival = isLate(currentTime, employee.arrivalWindowEnd);

      await ctx.answerCbQuery();

      let confirmMessage = `✅ Great! You arrived at ${currentTime}.\n\n` +
        `Expected departure: ${departureTime}\n`;

      if (isLateArrival) {
        const minutesLate = require('../utils/helpers').timeToMinutes(currentTime) -
                           require('../utils/helpers').timeToMinutes(employee.arrivalWindowEnd);
        confirmMessage += `\n⚠️ Note: You arrived ${minutesLate} minutes after your window (${employee.arrivalWindowStart}-${employee.arrivalWindowEnd}).\n` +
                         `This has been recorded as a late arrival.\n\n`;
      }

      confirmMessage += `I'll check with you at ${departureTime}. Have a productive day! 💪`;

      await ctx.editMessageText(confirmMessage);

      // Create late arrival event if needed (check if not already exists)
      if (isLateArrival) {
        const existingLateEvent = await prisma.event.findFirst({
          where: {
            employeeId: employee.id,
            type: 'LATE_LEFT_EARLY',
            startDate: todayDate,
            notes: {
              contains: 'Late arrival'
            }
          }
        });

        if (!existingLateEvent) {
          await prisma.event.create({
            data: {
              employeeId: employee.id,
              type: 'LATE_LEFT_EARLY',
              startDate: todayDate,
              endDate: todayDate,
              moderated: true,
              notes: `Late arrival: ${currentTime} (window: ${employee.arrivalWindowStart}-${employee.arrivalWindowEnd})`
            }
          });

          // Notify admins
          await notifyAdmins(
            ctx.telegram,
            prisma,
            `⚠️ Late Arrival Confirmed\n\n` +
            `👤 ${employee.name}\n` +
            `⏰ Arrived: ${currentTime}\n` +
            `📅 Window: ${employee.arrivalWindowStart}-${employee.arrivalWindowEnd}\n` +
            `📆 Date: ${formatDate(today)}`
          );
        }
      }

    } else if (data === 'arrival_not_yet') {
      // Ask when they will arrive
      await prisma.attendanceCheckIn.update({
        where: { id: checkIn.id },
        data: { status: 'WAITING_ARRIVAL_REMINDER' }
      });

      await ctx.answerCbQuery();
      await ctx.editMessageText(
        'When will you arrive?',
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '15 minutes', callback_data: 'arrival_in_15' },
                { text: '30 minutes', callback_data: 'arrival_in_30' }
              ],
              [
                { text: '1 hour', callback_data: 'arrival_in_60' },
                { text: 'Other', callback_data: 'arrival_other' }
              ]
            ]
          }
        }
      );

    } else if (data.startsWith('arrival_in_')) {
      // Employee said when they'll arrive
      const minutes = parseInt(data.replace('arrival_in_', ''));
      const expectedTime = new Date(Date.now() + minutes * 60 * 1000);

      await prisma.attendanceCheckIn.update({
        where: { id: checkIn.id },
        data: { expectedArrivalAt: expectedTime }
      });

      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `Got it! I'll check with you in ${minutes} minutes. 👍`
      );

    } else if (data === 'arrival_other') {
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        'Please reply with the time you expect to arrive (e.g., "10:30" or "in 45 minutes")'
      );
    }

  } catch (error) {
    console.error('Arrival callback error:', error);
    await ctx.answerCbQuery('An error occurred');
  }
}

/**
 * Follow up with employees who haven't arrived
 */
async function followUpArrival(bot, prisma, checkIn, employee) {
  try {
    const currentTime = getCurrentTime();

    await bot.telegram.sendMessage(
      employee.telegramUserId.toString(),
      `Hi ${employee.name}! 👋\n\nAre you in the office now?`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Yes', callback_data: 'arrival_yes' },
            { text: '⏳ Not yet', callback_data: 'arrival_not_yet' }
          ]]
        }
      }
    );
  } catch (error) {
    console.error(`Error following up arrival for ${employee.name}:`, error);
  }
}

module.exports = {
  askArrival,
  handleCallback,
  followUpArrival
};
