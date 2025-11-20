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
const dayoffCommand = require('./commands/dayoff');
const helpCommand = require('./commands/help');
const adminCommands = require('./commands/admin');
const adminAttendanceCommands = require('./commands/admin-attendance');
const taskCommands = require('./commands/tasks');

// Import flows
const arrivalFlow = require('./flows/arrival');
const departureFlow = require('./flows/departure');
const moderationFlow = require('./flows/moderation');
const taskFlows = require('./flows/tasks');

// Import schedulers
const { startSchedulers } = require('./schedulers');

// Import helpers
const { getEmployeeByTelegramId } = require('./utils/helpers');

// Function to configure bot commands and handlers
function configureBot(bot) {
  // Use session middleware with default empty object
  bot.use(session({ defaultSession: () => ({}) }));

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
  bot.command('dayoff', dayoffCommand.dayoff);
  bot.command('help', helpCommand);

  // Task management commands
  bot.command('newtask', taskCommands.newTask);
  bot.command('tasks', taskCommands.listTasks);
  bot.command('mytasks', taskCommands.myTasks);
  bot.hears(/^\/task_(.+)/, taskCommands.viewTask);

  // Admin commands
  bot.command('teamstatus', adminCommands.teamStatus);
  bot.command('pending', adminCommands.pending);
  bot.command('weekreport', adminCommands.weekReport);
  bot.command('broadcast', adminCommands.broadcast);
  bot.command('admins', adminCommands.admins);
  bot.command('globalholiday', adminCommands.holiday);
  bot.command('admincheckin', adminAttendanceCommands.adminCheckin);
  bot.command('admincheckout', adminAttendanceCommands.adminCheckout);

  // Handle text messages (for email linking, time responses, etc.)
  bot.on('text', async (ctx) => {
    const text = ctx.message.text;

    // Skip if it's a command
    if (text.startsWith('/')) return;

    // Handle task creation/editing flows
    if (ctx.session.taskCreation) {
      return taskFlows.handleTaskCreationStep(ctx, prisma);
    }
    if (ctx.session.taskEdit && ctx.session.taskEdit.field) {
      return taskFlows.handleTaskEditValueUpdate(ctx, prisma);
    }
    if (ctx.session.subtaskCreation) {
      return taskCommands.handleSubtaskCreationStep(ctx, prisma);
    }

    const telegramUserId = BigInt(ctx.from.id);

    // Check if awaiting email for account linking
    const existingEmployee = await getEmployeeByTelegramId(prisma, telegramUserId);

    // Handle custom arrival time (HH:MM format or "in X minutes")
    if (existingEmployee) {
      // Check if admin is providing custom check-in/checkout time
      if (ctx.session) {
        const timeMatch = text.match(/^(\d{1,2}):(\d{2})$/);

        if (timeMatch && ctx.session.adminCheckInEmployeeId) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);

          if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
            const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            const currentTime = require('./utils/helpers').getCurrentTime();
            const currentMinutes = require('./utils/helpers').timeToMinutes(currentTime);
            const targetMinutes = hours * 60 + minutes;
            const minutesAgo = currentMinutes - targetMinutes;

            if (minutesAgo >= 0 && minutesAgo <= 720) { // Max 12 hours ago
              const { processAdminCheckIn } = require('./commands/admin-attendance');
              const adminAttendanceCommands = require('./commands/admin-attendance');

              // Calculate and process
              await adminAttendanceCommands.handleCallback(ctx, prisma);

              // Create a mock callback context with the time
              const mockCtx = {
                ...ctx,
                answerCbQuery: async (msg) => {},
                editMessageText: async (msg) => { await ctx.reply(msg); }
              };

              // Process the check-in with custom time
              const employeeId = ctx.session.adminCheckInEmployeeId;
              await require('./commands/admin-attendance').processAdminCheckIn(
                mockCtx, prisma, employeeId, minutesAgo
              );

              delete ctx.session.adminCheckInEmployeeId;
              return;
            }
          }

          await ctx.reply('Invalid time format. Please use HH:MM (e.g., "10:30")');
          return;
        }

        if (timeMatch && ctx.session.adminCheckOutEmployeeId) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);

          if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
            const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            const currentTime = require('./utils/helpers').getCurrentTime();
            const currentMinutes = require('./utils/helpers').timeToMinutes(currentTime);
            const targetMinutes = hours * 60 + minutes;
            const minutesAgo = currentMinutes - targetMinutes;

            if (minutesAgo >= 0 && minutesAgo <= 720) { // Max 12 hours ago
              // Create a mock callback context
              const mockCtx = {
                ...ctx,
                answerCbQuery: async (msg) => {},
                editMessageText: async (msg) => { await ctx.reply(msg); }
              };

              // Process the check-out with custom time
              const employeeId = ctx.session.adminCheckOutEmployeeId;
              await require('./commands/admin-attendance').processAdminCheckOut(
                mockCtx, prisma, employeeId, minutesAgo
              );

              delete ctx.session.adminCheckOutEmployeeId;
              return;
            }
          }

          await ctx.reply('Invalid time format. Please use HH:MM (e.g., "18:30")');
          return;
        }
      }

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

        // Trim and clean the input
        const cleanText = text.trim();

        // Try to parse: "in X min/mins/minutes"
        const inMinutesMatch = cleanText.match(/in\s+(\d+)\s*(?:min|mins|minute|minutes)?$/i);
        if (inMinutesMatch) {
          parsedMinutes = parseInt(inMinutesMatch[1]);
          expectedTime = new Date(Date.now() + parsedMinutes * 60 * 1000);
        }

        // Try to parse: "in X hour/hours"
        const inHoursMatch = cleanText.match(/in\s+(\d+)\s*(?:hour|hours)$/i);
        if (!expectedTime && inHoursMatch) {
          parsedHours = parseInt(inHoursMatch[1]);
          parsedMinutes = parsedHours * 60;
          expectedTime = new Date(Date.now() + parsedMinutes * 60 * 1000);
        }

        // Try to parse: "in X hour Y min" or "in X hours Y minutes"
        const inHoursMinutesMatch = cleanText.match(/in\s+(\d+)\s*(?:hour|hours)\s+(?:and\s+)?(\d+)\s*(?:min|mins|minute|minutes)?$/i);
        if (!expectedTime && inHoursMinutesMatch) {
          parsedHours = parseInt(inHoursMinutesMatch[1]);
          parsedMinutesValue = parseInt(inHoursMinutesMatch[2]);
          parsedMinutes = parsedHours * 60 + parsedMinutesValue;
          expectedTime = new Date(Date.now() + parsedMinutes * 60 * 1000);
        }

        // Try to parse: HH:MM format (e.g., "14:42")
        const timeMatch = cleanText.match(/^(\d{1,2}):(\d{2})$/);
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
        const justNumberMatch = cleanText.match(/^(\d+)$/);
        if (!expectedTime && justNumberMatch) {
          parsedMinutes = parseInt(justNumberMatch[1]);
          if (parsedMinutes >= 1 && parsedMinutes <= 300) { // Max 5 hours
            expectedTime = new Date(Date.now() + parsedMinutes * 60 * 1000);
          }
        }

        if (expectedTime) {
          try {
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
          } catch (error) {
            console.error('Error updating expected arrival time:', error);
            await ctx.reply('Sorry, something went wrong while saving your arrival time. Please try again.');
            return;
          }
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
          `🎯 Quick Start:\n` +
          `/checkin - Check in when you arrive\n` +
          `/checkout - Check out when you leave\n` +
          `/balance - View your vacation balance\n\n` +
          `📅 Request Time Off:\n` +
          `/homeoffice - Request home office\n` +
          `/vacation - Request vacation days\n` +
          `/sick - Report sick day\n` +
          `/dayoff - Request a single day off\n\n` +
          `Type /help to see all available commands.`
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
  bot.action(/^task_status_(.+)/, (ctx) => taskFlows.handleTaskStatusCallback(ctx, prisma));
  bot.action(/^task_assign_(.+)/, (ctx) => taskFlows.handleTaskAssigneeCallback(ctx, prisma));
  bot.action(/^task_list_(.+)/, (ctx) => taskFlows.handleTaskListCallback(ctx, prisma));
  bot.action(/^edittask_(.+)/, (ctx) => taskCommands.handleEditTaskCallback(ctx, prisma));
  bot.action(/^edit_(.+)_(.+)/, (ctx) => taskFlows.handleTaskEditCallback(ctx, prisma));
  bot.action(/^editstatus_(.+)_(.+)/, async (ctx) => {
    const [taskId, status] = ctx.match.slice(1);
    await ctx.answerCbQuery();
    const ClickUpService = require('../services/clickup');
    const settings = await prisma.botSettings.findFirst();
    const clickup = new ClickUpService(settings.clickupApiToken);
    await clickup.updateTask(taskId, { status });
    await ctx.editMessageText(`✅ Status updated to: ${status}`);
    const { startTaskEditFlow } = require('./flows/tasks');
    return startTaskEditFlow(ctx, prisma, taskId);
  });
  bot.action(/^editassign_(.+)_(.+)/, async (ctx) => {
    const [taskId, assigneeId] = ctx.match.slice(1);
    await ctx.answerCbQuery();
    const ClickUpService = require('../services/clickup');
    const settings = await prisma.botSettings.findFirst();
    const clickup = new ClickUpService(settings.clickupApiToken);
    if (assigneeId === 'unassign') {
      await clickup.updateTask(taskId, { assignees: { add: [], rem: [] } });
      await ctx.editMessageText('✅ Task unassigned');
    } else {
      await clickup.updateTask(taskId, { assignees: { add: [assigneeId], rem: [] } });
      await ctx.editMessageText('✅ Assignee updated');
    }
    const { startTaskEditFlow } = require('./flows/tasks');
    return startTaskEditFlow(ctx, prisma, taskId);
  });
  bot.action(/^addsubtask_(.+)/, (ctx) => taskCommands.handleAddSubtaskCallback(ctx, prisma));
  bot.action(/^subtask_assign_(.+)_(.+)/, (ctx) => taskCommands.handleSubtaskAssigneeCallback(ctx, prisma));
  bot.action(/^deletetask_(.+)_(.+)/, (ctx) => taskCommands.handleDeleteTaskCallback(ctx, prisma));

  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    console.log(`Callback received: ${data}`);

    if (data.startsWith('arrival_')) {
      await arrivalFlow.handleCallback(ctx, prisma);
    } else if (data.startsWith('departure_')) {
      console.log('Routing to departure flow');
      await departureFlow.handleCallback(ctx, prisma);
    } else if (data.startsWith('moderate_')) {
      await moderationFlow.handleCallback(ctx, prisma);
    } else if (data.startsWith('homeoffice_')) {
      await homeofficeCommand.handleCallback(ctx, prisma);
    } else if (data.startsWith('vacation_')) {
      await vacationCommand.handleCallback(ctx, prisma);
    } else if (data.startsWith('sick_')) {
      await sickCommand.handleCallback(ctx, prisma);
    } else if (data.startsWith('dayoff_')) {
      await dayoffCommand.handleCallback(ctx, prisma);
    } else if (data.startsWith('admin_checkin_') || data.startsWith('admin_checkout_')) {
      await adminAttendanceCommands.handleCallback(ctx, prisma);
    }
  });

  // Error handling
  bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    console.error('Error stack:', err.stack);
    console.error('Context update:', ctx.update);
    try {
      ctx.reply('Sorry, something went wrong. Please try again.');
    } catch (replyError) {
      console.error('Failed to send error reply:', replyError);
    }
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
