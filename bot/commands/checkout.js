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
 * /checkout command - Manual checkout for departure
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

    const today = getCurrentDate();
    const todayDate = new Date(today);
    const currentTime = getCurrentTime();

    // Check if checked in today
    let checkIn = await prisma.attendanceCheckIn.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: todayDate
        }
      }
    });

    if (!checkIn || checkIn.status !== 'ARRIVED') {
      await ctx.reply('⚠️ You need to check in first before checking out.\n\nUse /checkin to check in.');
      return;
    }

    // Check if already checked out
    if (checkIn.status === 'LEFT') {
      await ctx.reply(
        `⚠️ You already checked out at ${checkIn.actualDepartureTime}.`
      );
      return;
    }

    // Update check-in to LEFT status
    await prisma.attendanceCheckIn.update({
      where: { id: checkIn.id },
      data: {
        status: 'LEFT',
        confirmedDepartureAt: new Date(),
        actualDepartureTime: currentTime
      }
    });

    const arrivalTime = checkIn.actualArrivalTime;
    const workHours = getWorkHoursForToday(employee);
    const expectedDeparture = calculateDepartureTime(arrivalTime, workHours);

    // Calculate actual work hours
    const arrivalMinutes = timeToMinutes(arrivalTime);
    const departureMinutes = timeToMinutes(currentTime);
    const minutesWorked = departureMinutes - arrivalMinutes;
    const hoursWorked = (minutesWorked / 60).toFixed(1);

    await ctx.reply(
      `✅ Checked out successfully!\n\n` +
      `⏰ Departure time: ${currentTime}\n` +
      `📆 Date: ${formatDate(today)}\n` +
      `⏱ Hours worked: ${hoursWorked}h\n` +
      `👋 See you tomorrow!`
    );

    // Check if left early
    if (timeToMinutes(currentTime) < timeToMinutes(expectedDeparture)) {
      const minutesEarly = timeToMinutes(expectedDeparture) - timeToMinutes(currentTime);

      // Create LATE_LEFT_EARLY event if left more than 15 minutes early
      if (minutesEarly > 15) {
        await prisma.event.create({
          data: {
            employeeId: employee.id,
            type: 'LATE_LEFT_EARLY',
            startDate: todayDate,
            endDate: todayDate,
            moderated: true,
            notes: `Left early: ${currentTime} (expected: ${expectedDeparture}, ${minutesEarly} min early)`
          }
        });

        await ctx.reply(
          `⚠️ Note: You left ${minutesEarly} minutes before expected departure (${expectedDeparture}).\n` +
          `This has been recorded as an early departure.`
        );

        // Notify admins
        await notifyAdmins(
          ctx.telegram,
          prisma,
          `⚠️ Early Departure\n\n` +
          `👤 ${employee.name}\n` +
          `⏰ Left: ${currentTime}\n` +
          `📅 Expected: ${expectedDeparture}\n` +
          `⏱ Early by: ${minutesEarly} minutes\n` +
          `📆 Date: ${formatDate(today)}`
        );
      }
    }

  } catch (error) {
    console.error('Checkout command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
};
