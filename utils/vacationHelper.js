/**
 * Vacation Helper Utilities
 * Handles vacation balance calculations based on employee work anniversary
 */

/**
 * Get the current vacation year period for an employee
 * based on their start date (work anniversary)
 *
 * @param {Date} startDate - Employee's start date
 * @returns {Object} { periodStart: Date, periodEnd: Date }
 *
 * Example: If employee started Aug 1, 2024:
 * - On July 31, 2025 -> period is Aug 1, 2024 to July 31, 2025
 * - On Aug 1, 2025 -> period is Aug 1, 2025 to July 31, 2026
 */
function getCurrentVacationPeriod(startDate) {
  const today = new Date();
  const empStartDate = new Date(startDate);

  // Get the month and day from employee's start date
  const startMonth = empStartDate.getMonth();
  const startDay = empStartDate.getDate();

  // Calculate current period start (anniversary date for current year)
  let periodStart = new Date(today.getFullYear(), startMonth, startDay);

  // If today is before this year's anniversary, use last year's anniversary
  if (today < periodStart) {
    periodStart = new Date(today.getFullYear() - 1, startMonth, startDay);
  }

  // Period end is one day before next year's anniversary
  const periodEnd = new Date(periodStart);
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  periodEnd.setDate(periodEnd.getDate() - 1);
  periodEnd.setHours(23, 59, 59, 999);

  return { periodStart, periodEnd };
}

/**
 * Filter events within the current vacation period
 *
 * @param {Array} events - Array of event objects
 * @param {Date} startDate - Employee's start date
 * @param {String} eventType - Event type to filter (e.g., 'VACATION', 'HOLIDAY')
 * @returns {Array} Filtered events
 */
function getEventsInCurrentPeriod(events, startDate, eventType) {
  const { periodStart, periodEnd } = getCurrentVacationPeriod(startDate);

  return events.filter(event => {
    const eventDate = new Date(event.startDate);
    return event.type === eventType &&
           eventDate >= periodStart &&
           eventDate <= periodEnd;
  });
}

/**
 * Calculate number of days for an event
 *
 * @param {Date} startDate - Event start date
 * @param {Date} endDate - Event end date (optional, defaults to startDate)
 * @returns {Number} Number of days
 */
function calculateEventDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : start;
  const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
  return days;
}

/**
 * Calculate vacation balance for an employee
 *
 * @param {Object} employee - Employee object with events, startDate, vacationDaysPerYear
 * @returns {Object} { daysTaken, daysLeft, periodStart, periodEnd }
 */
function calculateVacationBalance(employee) {
  const vacationEvents = getEventsInCurrentPeriod(
    employee.events || [],
    employee.startDate,
    'VACATION'
  );

  let daysTaken = 0;
  vacationEvents.forEach(event => {
    daysTaken += calculateEventDays(event.startDate, event.endDate);
  });

  const daysLeft = employee.vacationDaysPerYear - daysTaken;
  const { periodStart, periodEnd } = getCurrentVacationPeriod(employee.startDate);

  return {
    daysTaken,
    daysLeft,
    periodStart,
    periodEnd
  };
}

/**
 * Calculate holiday balance for an employee
 *
 * @param {Object} employee - Employee object with events, startDate, holidayDaysPerYear
 * @returns {Object} { daysTaken, daysLeft, periodStart, periodEnd }
 */
function calculateHolidayBalance(employee) {
  const holidayEvents = getEventsInCurrentPeriod(
    employee.events || [],
    employee.startDate,
    'HOLIDAY'
  );

  let daysTaken = 0;
  holidayEvents.forEach(event => {
    daysTaken += calculateEventDays(event.startDate, event.endDate);
  });

  const daysLeft = employee.holidayDaysPerYear - daysTaken;
  const { periodStart, periodEnd } = getCurrentVacationPeriod(employee.startDate);

  return {
    daysTaken,
    daysLeft,
    periodStart,
    periodEnd
  };
}

/**
 * Check if today is an employee's work anniversary
 *
 * @param {Date} startDate - Employee's start date
 * @returns {Boolean} True if today is their anniversary
 */
function isWorkAnniversary(startDate) {
  const today = new Date();
  const empStartDate = new Date(startDate);

  return today.getMonth() === empStartDate.getMonth() &&
         today.getDate() === empStartDate.getDate();
}

/**
 * Calculate years of service
 *
 * @param {Date} startDate - Employee's start date
 * @returns {Number} Years of service
 */
function getYearsOfService(startDate) {
  const today = new Date();
  const empStartDate = new Date(startDate);

  let years = today.getFullYear() - empStartDate.getFullYear();

  // Adjust if anniversary hasn't occurred this year
  const anniversaryThisYear = new Date(today.getFullYear(), empStartDate.getMonth(), empStartDate.getDate());
  if (today < anniversaryThisYear) {
    years--;
  }

  return years;
}

module.exports = {
  getCurrentVacationPeriod,
  getEventsInCurrentPeriod,
  calculateEventDays,
  calculateVacationBalance,
  calculateHolidayBalance,
  isWorkAnniversary,
  getYearsOfService
};
