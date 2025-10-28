const { Telegraf, session } = require('telegraf');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();
let bot = null; // Will be initialized in startBot()

// Import commands
const startCommand = require('./commands/start');
const balanceCommand = require('./commands/balance');
const mystatusCommand = require('./commands/mystatus');
const checkinCommand = require('./commands/checkin');
const checkoutCommand = require('./commands/checkout');
const homeofficeCommand = require('./commands/homeoffice');
const vacationCommand = require('./commands/vacation');
const sickCommand = require('./commands/sick');
const helpCommand = require('./commands/help');
const adminCommands = require('./commands/admin');

// Import flows
const arrivalFlow = require('./flows/arrival');
const departureFlow = require('./flows/departure');
const moderationFlow = require('./flows/moderation');

// Import schedulers
const { startSchedulers } = require('./schedulers');

// Import helpers
const { getEmployeeByTelegramId } = require('./utils/helpers');

// Function to configure bot commands and handlers
function configureBot(bot) {
  // Use session middleware
  bot.use(session());

  // Inject prisma into context
  bot.use((ctx, next) => {
    ctx.prisma = prisma;
    return next();
  });

  // Register commands
  bot.command('start', startCommand);
  bot.command('balance', balanceCommand);
  bot.command('mystatus', mystatusCommand);
  bot.command('checkin', checkinCommand);
  bot.command('checkout', checkoutCommand);
  bot.command('homeoffice', homeofficeCommand);
  bot.command('vacation', vacationCommand);
  bot.command('sick', sickCommand);
  bot.command('help', helpCommand);

  // Admin commands
  bot.command('teamstatus', adminCommands.teamStatus);
  bot.command('pending', adminCommands.pending);
  bot.command('weekreport', adminCommands.weekReport);
  bot.command('broadcast', adminCommands.broadcast);

  // Handle text messages (for email linking, time responses, etc.)
  bot.on('text', async (ctx) => {
    const text = ctx.message.text;

    // Skip if it's a command
    if (text.startsWith('/')) return;

    const telegramUserId = BigInt(ctx.from.id);

    // Check if awaiting email for account linking
    const existingEmployee = await getEmployeeByTelegramId(prisma, telegramUserId);

    // Handle custom arrival time (HH:MM format or "in X minutes")
    if (existingEmployee) {
      const today = new Date().toISOString().split('T')[0];
      const todayDate = new Date(today);

      // Check if user has a pending check-in waiting for time
      const checkIn = await prisma.attendanceCheckIn.findUnique({
        where: {
          employeeId_date: {
            employeeId: existingEmployee.id,
            date: todayDate
          }
        }
      });

      if (checkIn && checkIn.status === 'WAITING_ARRIVAL_REMINDER') {
        // User is expected to provide a time - parse various formats
        let expectedTime = null;
        let parsedMinutes = null;
        let parsedHours = null;
        let parsedMinutesValue = null;

        // Try to parse: "in X min/mins/minutes"
        const inMinutesMatch = text.match(/in\s+(\d+)\s*(?:min|mins|minute|minutes)?$/i);
        if (inMinutesMatch) {
          parsedMinutes = parseInt(inMinutesMatch[1]);
          expectedTime = new Date(Date.now() + parsedMinutes * 60 * 1000);
        }

        // Try to parse: "in X hour/hours"
        const inHoursMatch = text.match(/in\s+(\d+)\s*(?:hour|hours)$/i);
        if (!expectedTime && inHoursMatch) {
          parsedHours = parseInt(inHoursMatch[1]);
          parsedMinutes = parsedHours * 60;
          expectedTime = new Date(Date.now() + parsedMinutes * 60 * 1000);
        }

        // Try to parse: "in X hour Y min" or "in X hours Y minutes"
        const inHoursMinutesMatch = text.match(/in\s+(\d+)\s*(?:hour|hours)\s+(?:and\s+)?(\d+)\s*(?:min|mins|minute|minutes)?$/i);
        if (!expectedTime && inHoursMinutesMatch) {
          parsedHours = parseInt(inHoursMinutesMatch[1]);
          parsedMinutesValue = parseInt(inHoursMinutesMatch[2]);
          parsedMinutes = parsedHours * 60 + parsedMinutesValue;
          expectedTime = new Date(Date.now() + parsedMinutes * 60 * 1000);
        }

        // Try to parse: HH:MM format (e.g., "14:42")
        const timeMatch = text.match(/^(\d{1,2}):(\d{2})$/);
        if (!expectedTime && timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);

          if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
            const now = new Date();
            expectedTime = new Date(now);
            expectedTime.setHours(hours, minutes, 0, 0);

            // If time is in the past today, assume they mean later today
            if (expectedTime <= now) {
              expectedTime.setDate(expectedTime.getDate() + 1);
            }
            parsedMinutes = Math.round((expectedTime - now) / (60 * 1000));
          }
        }

        // Try to parse: just a number (assume minutes)
        const justNumberMatch = text.match(/^(\d+)$/);
        if (!expectedTime && justNumberMatch) {
          parsedMinutes = parseInt(justNumberMatch[1]);
          if (parsedMinutes >= 1 && parsedMinutes <= 300) { // Max 5 hours
            expectedTime = new Date(Date.now() + parsedMinutes * 60 * 1000);
          }
        }

        if (expectedTime) {
          await prisma.attendanceCheckIn.update({
            where: { id: checkIn.id },
            data: { expectedArrivalAt: expectedTime }
          });

          // Format the expected time
          const expectedHour = expectedTime.getHours();
          const expectedMin = expectedTime.getMinutes();
          const timeStr = `${expectedHour}:${String(expectedMin).padStart(2, '0')}`;

          // Check if this will be a late arrival
          const { timeToMinutes, getCurrentTime } = require('./utils/helpers');
          const expectedTimeStr = `${expectedHour}:${String(expectedMin).padStart(2, '0')}`;
          const windowEnd = existingEmployee.arrivalWindowEnd;

          const willBeLate = timeToMinutes(expectedTimeStr) > timeToMinutes(windowEnd);

          let response = `Got it! I'll check with you `;
          if (parsedMinutes < 120) {
            response += `in ${parsedMinutes} minutes (at ${timeStr}). 👍`;
          } else {
            response += `at ${timeStr}. 👍`;
          }

          if (willBeLate) {
            response += `\n\n⚠️ Note: Your arrival window is ${existingEmployee.arrivalWindowStart}-${windowEnd}. ` +
                       `Arriving at ${timeStr} will be marked as a late arrival.`;
          }

          await ctx.reply(response);
          return;
        } else {
          // Failed to parse
          await ctx.reply(
            `⚠️ I didn't understand that time format.\n\n` +
            `Please use one of these formats:\n` +
            `• "in 15 mins" or "in 15 minutes"\n` +
            `• "in 1 hour" or "in 2 hours"\n` +
            `• "in 1 hour 30 mins"\n` +
            `• "14:30" (time in HH:MM)\n` +
            `• "45" (just minutes)`
          );
          return;
        }
      }
    }

    // Handle email linking for unlinked accounts
    if (!existingEmployee && text.includes('@')) {
      // Try to link account with email
      const email = text.trim().toLowerCase();

      const employee = await prisma.employee.findUnique({
        where: { email }
      });

      if (employee) {
        if (employee.telegramUserId) {
          await ctx.reply('This email is already linked to another Telegram account.');
          return;
        }

        // Link the account
        await prisma.employee.update({
          where: { id: employee.id },
          data: { telegramUserId }
        });

        await ctx.reply(
          `✅ Account linked successfully!\n\n` +
          `Welcome, ${employee.name}! 👋\n\n` +
          `Available commands:\n` +
          `/balance - View your vacation balance\n` +
          `/homeoffice - Request home office for tomorrow\n` +
          `/vacation - Request vacation days\n` +
          `/sick - Report sick day for tomorrow`
        );
      } else {
        await ctx.reply(
          `❌ No employee found with email: ${email}\n\n` +
          `Please check your email or contact an admin.`
        );
      }
    }
  });

  // Handle callback queries (inline keyboard buttons)
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data.startsWith('arrival_')) {
      await arrivalFlow.handleCallback(ctx, prisma);
    } else if (data.startsWith('departure_')) {
      await departureFlow.handleCallback(ctx, prisma);
    } else if (data.startsWith('moderate_')) {
      await moderationFlow.handleCallback(ctx, prisma);
    } else if (data.startsWith('homeoffice_')) {
      await homeofficeCommand.handleCallback(ctx, prisma);
    } else if (data.startsWith('vacation_')) {
      await vacationCommand.handleCallback(ctx, prisma);
    } else if (data.startsWith('sick_')) {
      await sickCommand.handleCallback(ctx, prisma);
    }
  });

  // Error handling
  bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx.reply('Sorry, something went wrong. Please try again.');
  });
}

// Start bot
async function startBot(token) {
  try {
    console.log('Starting Telegram bot...');

    // Create bot instance with provided token
    bot = new Telegraf(token);

    // Configure bot with commands and handlers
    configureBot(bot);

    // Start schedulers
    startSchedulers(bot, prisma);

    // Launch bot
    await bot.launch();
    console.log('Telegram bot is running!');

    // Graceful shutdown
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (error) {
    console.error('Failed to start bot:', error);
    throw error; // Don't exit process, let server.js handle it
  }
}

// Export for external use
module.exports = { bot, prisma, startBot };
