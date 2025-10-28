const {
  getEmployeeByTelegramId,
  getCurrentDate,
  getCurrentTime,
  isLate,
  calculateDepartureTime,
  getWorkHoursForToday,
  notifyAdmins,
  formatDate,
  hasEventForDate,
  isRecurringHomeOfficeDay
} = require('../utils/helpers');

/**
 * /checkin command - Manual check-in for arrival
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

    // Check if today is recurring home office day
    if (isRecurringHomeOfficeDay(employee)) {
      await ctx.reply('⚠️ Today is your recurring home office day. You don\'t need to check in.');
      return;
    }

    // Check if has event for today (vacation, sick, home office, etc.)
    const hasEvent = await hasEventForDate(
      prisma,
      employee.id,
      today,
      ['VACATION', 'SICK_DAY', 'HOLIDAY', 'HOME_OFFICE']
    );

    if (hasEvent) {
      await ctx.reply('⚠️ You have an event scheduled for today (vacation, sick, or home office). No check-in needed.');
      return;
    }

    // Check if already checked in
    let checkIn = await prisma.attendanceCheckIn.findUnique({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: todayDate
        }
      }
    });

    if (checkIn && checkIn.status === 'ARRIVED') {
      await ctx.reply(
        `⚠️ You're already checked in at ${checkIn.actualArrivalTime}.\n\n` +
        `Expected departure: ${calculateDepartureTime(checkIn.actualArrivalTime, getWorkHoursForToday(employee))}`
      );
      return;
    }

    // Create or update check-in
    const workHours = getWorkHoursForToday(employee);
    const departureTime = calculateDepartureTime(currentTime, workHours);

    if (checkIn) {
      await prisma.attendanceCheckIn.update({
        where: { id: checkIn.id },
        data: {
          status: 'ARRIVED',
          confirmedArrivalAt: new Date(),
          actualArrivalTime: currentTime
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
          actualArrivalTime: currentTime
        }
      });
    }

    console.log(`✅ ${employee.name} checked in at ${currentTime}`);
    console.log(`   Arrival window: ${employee.arrivalWindowStart}-${employee.arrivalWindowEnd}`);
    console.log(`   Checking if late: ${currentTime} > ${employee.arrivalWindowEnd}`);

    // Check if late
    const isLateArrival = isLate(currentTime, employee.arrivalWindowEnd);
    let message = `✅ Checked in successfully!\n\n` +
      `⏰ Arrival time: ${currentTime}\n` +
      `📆 Date: ${formatDate(today)}\n` +
      `🏁 Expected departure: ${departureTime}\n`;

    if (isLateArrival) {
      console.log(`⚠️ LATE ARRIVAL DETECTED for ${employee.name}`);
      const minutesLate = timeToMinutes(currentTime) - timeToMinutes(employee.arrivalWindowEnd);
      message += `\n⚠️ Note: You arrived ${minutesLate} minutes after your window (${employee.arrivalWindowStart}-${employee.arrivalWindowEnd}).\n` +
                 `This has been recorded as a late arrival.\n`;
    }

    message += `\nHave a productive day! 💪`;

    await ctx.reply(message);

    if (isLateArrival) {
      // Check if late event already exists (might have been auto-created)
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
        // Create LATE_LEFT_EARLY event
        const lateEvent = await prisma.event.create({
          data: {
            employeeId: employee.id,
            type: 'LATE_LEFT_EARLY',
            startDate: todayDate,
            endDate: todayDate,
            moderated: true,
            notes: `Late arrival: ${currentTime} (window: ${employee.arrivalWindowStart}-${employee.arrivalWindowEnd})`
          }
        });
        console.log(`✅ Created LATE_LEFT_EARLY event with ID: ${lateEvent.id}`);

        // Notify admins
        await notifyAdmins(
          ctx.telegram,
          prisma,
          `⚠️ Late Arrival\n\n` +
          `👤 ${employee.name}\n` +
          `⏰ Arrived: ${currentTime}\n` +
          `📅 Window: ${employee.arrivalWindowStart}-${employee.arrivalWindowEnd}\n` +
          `📆 Date: ${formatDate(today)}`
        );
      } else {
        console.log(`ℹ️ Late event already exists for ${employee.name}, skipping duplicate`);
      }
    }

  } catch (error) {
    console.error('Check-in command error:', error);
    await ctx.reply('An error occurred. Please try again.');
  }
};
