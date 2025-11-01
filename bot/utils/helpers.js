/**
 * Utility functions for the Telegram bot
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Default timezone offset for GMT+3 (will be overridden by settings)
let TIMEZONE_OFFSET = 3 * 60 * 60 * 1000;

/**
 * Load timezone offset from database settings
 */
async function loadTimezoneOffset() {
  try {
    const settings = await prisma.botSettings.findFirst();
    if (settings && settings.timezoneOffset) {
      TIMEZONE_OFFSET = settings.timezoneOffset * 60 * 60 * 1000;
    }
  } catch (error) {
    console.error('Failed to load timezone settings:', error);
  }
}

// Load timezone on module init
loadTimezoneOffset();

/**
 * Get current date/time in GMT+3
 */
function getCurrentDateTime() {
  return new Date(Date.now() + TIMEZONE_OFFSET);
}

/**
 * Get current date in YYYY-MM-DD format (GMT+3)
 */
function getCurrentDate() {
  const now = getCurrentDateTime();
  return now.toISOString().split('T')[0];
}

/**
 * Get current time in HH:MM format (GMT+3)
 */
function getCurrentTime() {
  const now = getCurrentDateTime();
  return now.toISOString().split('T')[1].substring(0, 5);
}

/**
 * Parse time string to minutes since midnight
 */
function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Add minutes to a time string
 */
function addMinutesToTime(timeStr, minutesToAdd) {
  const totalMinutes = timeToMinutes(timeStr) + minutesToAdd;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Check if employee is within arrival window
 */
function isWithinArrivalWindow(arrivalTime, windowStart, windowEnd) {
  const arrival = timeToMinutes(arrivalTime);
  const start = timeToMinutes(windowStart);
  const end = timeToMinutes(windowEnd);
  return arrival >= start && arrival <= end;
}

/**
 * Check if employee is late
 */
function isLate(arrivalTime, windowEnd) {
  return timeToMinutes(arrivalTime) > timeToMinutes(windowEnd);
}

/**
 * Calculate expected departure time based on arrival
 */
function calculateDepartureTime(arrivalTime, workHours) {
  return addMinutesToTime(arrivalTime, workHours * 60);
}

/**
 * Check if today is a recurring home office day for employee
 */
function isRecurringHomeOfficeDay(employee) {
  const today = getCurrentDateTime().getDay(); // 0 = Sunday, 6 = Saturday
  return employee.recurringHomeOfficeDays.includes(today);
}

/**
 * Check if today is Friday
 */
function isFriday() {
  return getCurrentDateTime().getDay() === 5;
}

/**
 * Check if today is a weekend (Saturday or Sunday)
 */
function isWeekend() {
  const day = getCurrentDateTime().getDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
}

/**
 * Get work hours for today
 */
function getWorkHoursForToday(employee) {
  if (isFriday() && employee.halfDayOnFridays) {
    return employee.workHoursOnFriday;
  }
  return employee.workHoursPerDay;
}

/**
 * Format date for display
 */
function formatDate(date) {
  const d = new Date(date);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Get tomorrow's date
 */
function getTomorrowDate() {
  const tomorrow = new Date(getCurrentDateTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

/**
 * Get date N days from now
 */
function getDateInDays(days) {
  const future = new Date(getCurrentDateTime());
  future.setDate(future.getDate() + days);
  return future.toISOString().split('T')[0];
}

/**
 * Check if date is in the past
 */
function isPastDate(dateStr) {
  const date = new Date(dateStr);
  const today = new Date(getCurrentDate());
  return date < today;
}

/**
 * Calculate days between two dates
 */
function daysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diff = end - start;
  return Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Check if employee has an event for a specific date
 */
async function hasEventForDate(prisma, employeeId, date, eventTypes = []) {
  // Parse date string (YYYY-MM-DD) and create date at start of day
  const [year, month, day] = date.split('-').map(Number);
  const checkDate = new Date(year, month - 1, day);
  const startOfDay = new Date(checkDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(checkDate);
  endOfDay.setHours(23, 59, 59, 999);

  const events = await prisma.event.findMany({
    where: {
      employeeId,
      moderated: true, // Only check moderated events
      startDate: { lte: endOfDay },
      OR: [
        { endDate: { gte: startOfDay } },
        { endDate: null, startDate: { gte: startOfDay, lte: endOfDay } }
      ],
      ...(eventTypes.length > 0 ? { type: { in: eventTypes } } : {})
    }
  });
  return events.length > 0;
}

/**
 * Get employee by telegram user ID
 */
async function getEmployeeByTelegramId(prisma, telegramUserId) {
  return await prisma.employee.findUnique({
    where: { telegramUserId: BigInt(telegramUserId) }
  });
}

/**
 * Check if user is admin
 */
async function isAdmin(prisma, telegramUserId) {
  const employee = await getEmployeeByTelegramId(prisma, telegramUserId);
  if (!employee) return false;

  const user = await prisma.user.findUnique({
    where: { email: employee.email }
  });

  return user && user.role === 'ADMIN';
}

/**
 * Get all admin telegram IDs
 */
async function getAdminTelegramIds(prisma) {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' }
  });
  console.log(`📊 Found ${admins.length} admin users:`, admins.map(a => a.email));

  const adminEmails = admins.map(a => a.email);
  const employees = await prisma.employee.findMany({
    where: {
      email: { in: adminEmails },
      telegramUserId: { not: null }
    }
  });
  console.log(`📊 Found ${employees.length} admin employees with Telegram:`, employees.map(e => ({ email: e.email, telegramId: e.telegramUserId.toString() })));

  return employees.map(e => e.telegramUserId.toString());
}

/**
 * Send message to all admins
 */
async function notifyAdmins(bot, prisma, message, extra = {}) {
  try {
    const adminIds = await getAdminTelegramIds(prisma);
    console.log(`Notifying ${adminIds.length} admin(s):`, adminIds);

    if (adminIds.length === 0) {
      console.warn('No admins found to notify!');
      return;
    }

    for (const adminId of adminIds) {
      try {
        // bot might be ctx.telegram or bot, handle both
        const telegram = bot.telegram || bot;
        await telegram.sendMessage(adminId, message, extra);
        console.log(`✅ Notified admin ${adminId}`);
      } catch (error) {
        console.error(`❌ Failed to notify admin ${adminId}:`, error.message);
      }
    }
  } catch (error) {
    console.error('❌ Error in notifyAdmins:', error);
  }
}

/**
 * Send message to all employees
 */
async function notifyAllEmployees(bot, prisma, message, extra = {}) {
  try {
    const employees = await prisma.employee.findMany({
      where: {
        archived: false,
        telegramUserId: { not: null }
      }
    });

    console.log(`Notifying ${employees.length} employee(s)`);

    if (employees.length === 0) {
      console.warn('No employees with Telegram found to notify!');
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const employee of employees) {
      try {
        // bot might be ctx.telegram or bot, handle both
        const telegram = bot.telegram || bot;
        await telegram.sendMessage(employee.telegramUserId.toString(), message, extra);
        console.log(`✅ Notified ${employee.name}`);
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to notify ${employee.name}:`, error.message);
        failCount++;
      }
    }

    console.log(`📊 Notification summary: ${successCount} succeeded, ${failCount} failed`);
    return { success: successCount, failed: failCount };
  } catch (error) {
    console.error('❌ Error in notifyAllEmployees:', error);
    return { success: 0, failed: 0, error: error.message };
  }
}

module.exports = {
  getCurrentDateTime,
  getCurrentDate,
  getCurrentTime,
  timeToMinutes,
  addMinutesToTime,
  isWithinArrivalWindow,
  isLate,
  calculateDepartureTime,
  isRecurringHomeOfficeDay,
  isFriday,
  isWeekend,
  getWorkHoursForToday,
  formatDate,
  getTomorrowDate,
  getDateInDays,
  isPastDate,
  daysBetween,
  hasEventForDate,
  getEmployeeByTelegramId,
  isAdmin,
  getAdminTelegramIds,
  notifyAdmins,
  notifyAllEmployees
};
