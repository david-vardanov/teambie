# Team Management Telegram Bot

Automated attendance tracking and leave management bot for your team.

## Features

### For Employees

- **Automated Attendance Tracking**
  - Morning check-in at configured arrival time
  - Flexible arrival window (customizable per employee)
  - Follow-up reminders if not arrived yet
  - Evening check-out at expected departure time
  - Automatic late/early leave event creation

- **Leave Requests**
  - `/homeoffice` - Request home office for tomorrow (1 day advance)
  - `/vacation` - Request vacation days (up to 1 week advance)
  - `/sick` - Report sick day for tomorrow (1 day advance)
  - Real-time approval/rejection notifications

- **Balance Queries**
  - `/balance` - View vacation and holiday balance
  - Shows days taken and remaining

### For Admins

- **Moderation Interface**
  - One-tap approve/reject with inline keyboards
  - `/pending` - View all pending requests
  - Employees get instant notifications

- **Reports**
  - Daily morning report (9:00 AM) - Team presence for the day
  - Daily end-of-day report (7:00 PM) - Attendance stats, late arrivals, early leaves
  - Weekly report (Monday 9:00 AM) - Previous week statistics
  - `/teamstatus` - Current team presence
  - `/weekreport` - On-demand weekly report

- **Alerts**
  - Late arrivals (after arrival window)
  - Early departures (more than 15 min early)
  - Missed check-ins (by 12:00 PM)
  - Pending events waiting for moderation

- **Broadcasting**
  - `/broadcast <message>` - Send announcement to all employees

## Setup

### 1. Create Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow instructions
3. Copy the bot token

### 2. Configure Bot in Admin Panel

The easiest way to configure the bot is through the admin panel:

1. Log in as an admin
2. Go to **Settings → Telegram Bot**
3. Paste your bot token
4. Configure timezone and report times
5. Enable the bot
6. Click "Test Bot Connection" to verify
7. Save settings

Alternatively, you can add the token directly to `.env`:
```
TELEGRAM_BOT_TOKEN="your_token_here"
```

### 3. Configure Employee Settings

Each employee needs the following settings configured in the database:

```javascript
{
  telegramUserId: null,              // Linked when employee runs /start
  arrivalWindowStart: "10:00",       // Start of arrival window
  arrivalWindowEnd: "11:00",         // End of arrival window (1 hour)
  workHoursPerDay: 8,                // Work hours per day
  halfDayOnFridays: false,           // Half day on Fridays?
  workHoursOnFriday: 8,              // Hours on Friday (4 if half day)
  recurringHomeOfficeDays: []        // [5] = Every Friday home office
}
```

**Examples:**

- Employee works 10:00-18:00, full Fridays:
  ```javascript
  arrivalWindowStart: "10:00",
  arrivalWindowEnd: "11:00",
  workHoursPerDay: 8,
  halfDayOnFridays: false,
  workHoursOnFriday: 8
  ```

- Employee works 11:00-19:00, half-day Fridays:
  ```javascript
  arrivalWindowStart: "11:00",
  arrivalWindowEnd: "12:00",
  workHoursPerDay: 8,
  halfDayOnFridays: true,
  workHoursOnFriday: 4
  ```

- Employee works 12:00-20:00, always home office on Fridays:
  ```javascript
  arrivalWindowStart: "12:00",
  arrivalWindowEnd: "13:00",
  workHoursPerDay: 8,
  recurringHomeOfficeDays: [5]  // 5 = Friday
  ```

### 4. Link Employee Accounts

Each employee must link their Telegram account:

1. Start a chat with your bot
2. Send `/start`
3. Reply with their registered email address
4. Bot confirms linking

### 5. Start the Bot

```bash
npm run bot        # Production
npm run bot:dev    # Development with auto-reload
```

## How It Works

### Attendance Flow

**Morning (Arrival Window Start - e.g., 10:00 AM):**

1. Bot: "Good morning! Did you arrive at the office?"
   - ✅ Yes → Records arrival time, calculates departure time
   - ⏳ Not yet → Asks when they'll arrive (15 min, 30 min, 1 hour, other)

2. If "Not yet":
   - Bot follows up at specified time
   - If arrive after window end (e.g., 11:00), creates LATE event and notifies admins

**Evening (Expected Departure Time):**

1. Bot: "Your expected departure is 18:30. Are you still in the office?"
   - ✅ Still here → Acknowledged
   - 👋 Already left → Asks what time they left

2. If left early (>15 min):
   - Creates LATE_LEFT_EARLY event
   - Notifies admins with time difference

**Rules:**
- Employees can arrive anywhere in their window (e.g., 10:00-11:00) without penalty
- Work hours calculated from actual arrival time
- Late = arrive after window end
- Early leave = depart >15 min before expected time

### Leave Request Flow

**Employee:**
1. `/homeoffice` or `/vacation` or `/sick`
2. Confirms with inline keyboard
3. Request sent to admins

**Admin:**
1. Receives notification with approve/reject buttons
2. One-tap moderation
3. Employee gets instant notification

**Conflict Handling:**
- Bot warns if employee already has event for that date
- Admin can still approve if needed

## Timezone

All times are in **GMT+3**. This is configured in `bot/utils/helpers.js`:

```javascript
const TIMEZONE_OFFSET = 3 * 60 * 60 * 1000; // GMT+3
```

To change timezone, modify this value:
- GMT+2: `2 * 60 * 60 * 1000`
- GMT+4: `4 * 60 * 60 * 1000`
- etc.

## Schedule Jobs

The bot runs these cron jobs:

- **Every minute**: Check arrival/departure times
- **Every 5 minutes**: Follow up pending arrivals
- **9:00 AM daily**: Morning report to admins
- **12:00 PM daily**: Check for missed check-ins
- **7:00 PM daily**: End-of-day report to admins
- **9:00 AM Monday**: Weekly report to admins

## Database Models

### AttendanceCheckIn

Tracks daily check-in state for each employee:

```javascript
{
  employeeId: int,
  date: date,
  askedArrivalAt: datetime,
  confirmedArrivalAt: datetime,
  expectedArrivalAt: datetime,      // If said "in 15 min"
  actualArrivalTime: string,        // "10:35"
  askedDepartureAt: datetime,
  confirmedDepartureAt: datetime,
  actualDepartureTime: string,      // "18:45"
  status: AttendanceStatus
}
```

**Status values:**
- `WAITING_ARRIVAL` - Asked, waiting for response
- `WAITING_ARRIVAL_REMINDER` - Said "not yet", waiting for follow-up
- `ARRIVED` - Confirmed arrival
- `WAITING_DEPARTURE` - Asked about departure
- `LEFT` - Confirmed departure
- `MISSED` - Didn't respond by 12 PM
- `HOME_OFFICE` - Home office day
- `VACATION` - On vacation
- `SICK` - Sick day
- `HOLIDAY` - Holiday

### Events

Existing events table now used for:
- `LATE_LEFT_EARLY` - Late arrivals and early departures (auto-created)
- `HOME_OFFICE` - Home office requests
- `VACATION` - Vacation requests
- `SICK_DAY` - Sick day reports
- Other existing event types

## Admin Rights

Admin detection:
1. Bot checks employee's email
2. Queries User table for role
3. If `role === 'ADMIN'`, grants admin commands

Make sure employees have corresponding User records with correct roles.

## Troubleshooting

**Bot not responding:**
- Check if bot is running: `ps aux | grep node`
- Check logs for errors
- Verify `TELEGRAM_BOT_TOKEN` in `.env`

**Employee can't link account:**
- Verify employee email exists in database
- Check if email is already linked to another Telegram account
- Email comparison is case-insensitive

**Check-ins not triggered:**
- Verify employee has `telegramUserId` set
- Check `arrivalWindowStart` and `arrivalWindowEnd` are set correctly
- Check if employee has event for today (vacation, sick, etc.)
- Check if today is in `recurringHomeOfficeDays`

**Admin not receiving reports:**
- Verify admin has `role: 'ADMIN'` in User table
- Verify admin's employee record has `telegramUserId` linked
- Check bot logs for notification errors

## Development

**File Structure:**
```
bot/
├── index.js                  # Main bot file
├── commands/                 # Command handlers
│   ├── start.js
│   ├── balance.js
│   ├── homeoffice.js
│   ├── vacation.js
│   ├── sick.js
│   └── admin.js
├── flows/                    # Conversation flows
│   ├── arrival.js
│   ├── departure.js
│   └── moderation.js
├── schedulers/               # Cron jobs
│   └── index.js
└── utils/                    # Helper functions
    └── helpers.js
```

**Key Helpers:**

- `getCurrentDate()` - Today in GMT+3
- `getCurrentTime()` - Current time in GMT+3
- `isRecurringHomeOfficeDay(employee)` - Check if today is home office
- `hasEventForDate(prisma, employeeId, date, types)` - Check events
- `isLate(arrivalTime, windowEnd)` - Check if late
- `calculateDepartureTime(arrivalTime, hours)` - Calculate expected leave
- `notifyAdmins(bot, prisma, message)` - Send to all admins

## Running Alongside Web Server

The bot and web server can run simultaneously:

**Terminal 1 (Web Server):**
```bash
npm run dev
```

**Terminal 2 (Bot):**
```bash
npm run bot:dev
```

Both share the same Prisma database connection.

## Security Notes

- Bot token is sensitive - never commit `.env` to git
- Only admins can moderate events and see reports
- Employees can only access their own data
- Email linking is one-time per employee

## Future Enhancements

Possible additions:
- Manual departure time input via text
- Multi-day sick leave requests
- Vacation balance expiration reminders
- Birthday notifications
- Probation period reminders
- Custom work schedule per day of week
- Overtime tracking
- Integration with calendar apps

## Support

For issues or questions, check:
1. Bot logs: `tail -f bot.log` (if you set up logging)
2. Database state: Check `AttendanceCheckIn` and `Event` tables
3. Telegram bot status: Message bot with `/start` to test

---

**Built with:**
- [Telegraf](https://telegraf.js.org/) - Telegram Bot Framework
- [node-cron](https://www.npmjs.com/package/node-cron) - Job Scheduling
- [Prisma](https://www.prisma.io/) - Database ORM
