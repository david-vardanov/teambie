const ClickUpService = require('../../services/clickup');

/**
 * Task creation flow
 */
async function startTaskCreationFlow(ctx, prisma) {
  const employee = await prisma.employee.findUnique({
    where: { telegramUserId: BigInt(ctx.from.id) }
  });

  if (!employee) {
    return ctx.reply('❌ You need to link your account first. Use /start');
  }

  // Initialize session for task creation
  ctx.session.taskCreation = {
    step: 'name',
    data: {}
  };

  return ctx.reply(
    '📝 Let\'s create a new task!\n\n' +
    'What is the task name?',
    { reply_markup: { force_reply: true } }
  );
}

/**
 * Handle task creation steps
 */
async function handleTaskCreationStep(ctx, prisma) {
  if (!ctx.session.taskCreation) {
    return;
  }

  const { step, data } = ctx.session.taskCreation;
  const message = ctx.message.text;

  switch (step) {
    case 'name':
      data.name = message;
      ctx.session.taskCreation.step = 'description';
      return ctx.reply(
        `✅ Task name: "${message}"\n\n` +
        'Now, provide a description for the task:\n' +
        '(Send "skip" to skip)',
        { reply_markup: { force_reply: true } }
      );

    case 'description':
      data.description = message === 'skip' ? '' : message;
      ctx.session.taskCreation.step = 'status';
      return ctx.reply(
        'Choose the initial status:',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 To Do', callback_data: 'task_status_to do' }],
              [{ text: '▶️ In Progress', callback_data: 'task_status_in progress' }],
              [{ text: '✅ Completed', callback_data: 'task_status_complete' }]
            ]
          }
        }
      );

    case 'duration':
      const duration = parseDuration(message);
      if (!duration && message !== 'skip') {
        return ctx.reply(
          '❌ Invalid duration format.\n' +
          'Use format like: "2h", "30m", "2h 30m", or "skip"',
          { reply_markup: { force_reply: true } }
        );
      }
      data.duration = duration;
      ctx.session.taskCreation.step = 'startDate';
      return ctx.reply(
        `✅ Duration: ${duration ? formatDuration(duration) : 'Not set'}\n\n` +
        'When should this task start?\n' +
        'Format: YYYY-MM-DD (e.g., 2025-01-15) or "today", "tomorrow", or "skip"',
        { reply_markup: { force_reply: true } }
      );

    case 'startDate':
      const startDate = parseDate(message);
      if (!startDate && message !== 'skip') {
        return ctx.reply(
          '❌ Invalid date format.\n' +
          'Use: YYYY-MM-DD, "today", "tomorrow", or "skip"',
          { reply_markup: { force_reply: true } }
        );
      }
      data.startDate = startDate;
      ctx.session.taskCreation.step = 'assignee';

      // Get workspace members for assignee selection
      try {
        const settings = await prisma.botSettings.findFirst();
        if (!settings?.clickupApiToken || !settings?.clickupWorkspaceId) {
          return ctx.reply('❌ ClickUp is not configured properly. Contact admin.');
        }

        const clickup = new ClickUpService(settings.clickupApiToken);
        const members = await clickup.getWorkspaceMembers(settings.clickupWorkspaceId);

        // Get employees with ClickUp IDs
        const employees = await prisma.employee.findMany({
          where: { clickupUserId: { not: null } }
        });

        const keyboard = [];
        for (const emp of employees) {
          const member = members.find(m => m.user.id.toString() === emp.clickupUserId);
          if (member) {
            keyboard.push([{
              text: emp.name,
              callback_data: `task_assign_${emp.clickupUserId}`
            }]);
          }
        }
        keyboard.push([{ text: '⏭️ Skip (Unassigned)', callback_data: 'task_assign_skip' }]);

        return ctx.reply(
          `✅ Start date: ${startDate ? new Date(startDate).toLocaleDateString() : 'Not set'}\n\n` +
          'Who should be assigned to this task?',
          { reply_markup: { inline_keyboard: keyboard } }
        );
      } catch (error) {
        console.error('Error fetching members:', error);
        return ctx.reply('❌ Error fetching team members. Try again later.');
      }
  }
}

/**
 * Handle status selection callback
 */
async function handleTaskStatusCallback(ctx, prisma) {
  const status = ctx.match[1]; // Extracted from callback_data
  ctx.session.taskCreation.data.status = status;
  ctx.session.taskCreation.step = 'duration';

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `✅ Status: ${status}\n\n` +
    'How long will this task take?\n' +
    'Format: "2h", "30m", "2h 30m" or "skip"'
  );
  return ctx.reply('Enter duration:', { reply_markup: { force_reply: true } });
}

/**
 * Handle assignee selection callback
 */
async function handleTaskAssigneeCallback(ctx, prisma) {
  const assigneeId = ctx.match[1] === 'skip' ? null : ctx.match[1];
  ctx.session.taskCreation.data.assigneeId = assigneeId;

  await ctx.answerCbQuery();

  // Now create the task
  try {
    const settings = await prisma.botSettings.findFirst();
    const clickup = new ClickUpService(settings.clickupApiToken);
    const { data } = ctx.session.taskCreation;

    const taskData = {
      name: data.name,
      description: data.description || undefined,
      status: data.status,
      assignees: assigneeId ? [assigneeId] : undefined,
      startDate: data.startDate || undefined,
      timeEstimate: data.duration || undefined
    };

    const task = await clickup.createTask(settings.clickupListId, taskData);

    await ctx.editMessageText(
      `✅ Task created successfully!\n\n` +
      `📝 ${task.name}\n` +
      `🔗 ${task.url}\n\n` +
      `Status: ${data.status}\n` +
      `Assignee: ${assigneeId ? 'Assigned' : 'Unassigned'}\n` +
      `Duration: ${data.duration ? formatDuration(data.duration) : 'Not set'}\n` +
      `Start: ${data.startDate ? new Date(data.startDate).toLocaleDateString() : 'Not set'}`
    );

    // Notify assignee if someone else created the task
    if (assigneeId && assigneeId !== ctx.session.taskCreation.data.creatorClickupId) {
      const assignee = await prisma.employee.findUnique({
        where: { clickupUserId: assigneeId }
      });
      if (assignee?.telegramUserId) {
        try {
          await ctx.telegram.sendMessage(
            assignee.telegramUserId.toString(),
            `📋 New task assigned to you!\n\n` +
            `📝 ${task.name}\n` +
            `👤 Created by: ${ctx.from.first_name}\n` +
            `🔗 ${task.url}`
          );
        } catch (e) {
          console.error('Failed to notify assignee:', e);
        }
      }
    }

    // Clear session
    delete ctx.session.taskCreation;
  } catch (error) {
    console.error('Error creating task:', error);
    await ctx.editMessageText('❌ Error creating task: ' + error.message);
    delete ctx.session.taskCreation;
  }
}

/**
 * Task editing flow
 */
async function startTaskEditFlow(ctx, prisma, taskId) {
  try {
    const settings = await prisma.botSettings.findFirst();
    if (!settings?.clickupApiToken) {
      return ctx.reply('❌ ClickUp is not configured properly.');
    }

    const clickup = new ClickUpService(settings.clickupApiToken);
    const task = await clickup.getTask(taskId, false);

    ctx.session.taskEdit = {
      taskId,
      task,
      step: 'menu'
    };

    return ctx.reply(
      `✏️ Editing task: ${task.name}\n\n` +
      'What would you like to update?',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📝 Name', callback_data: `edit_${taskId}_name` }],
            [{ text: '📄 Description', callback_data: `edit_${taskId}_description` }],
            [{ text: '🔄 Status', callback_data: `edit_${taskId}_status` }],
            [{ text: '👤 Assignee', callback_data: `edit_${taskId}_assignee` }],
            [{ text: '⏱️ Duration', callback_data: `edit_${taskId}_duration` }],
            [{ text: '📅 Start Date', callback_data: `edit_${taskId}_startdate` }],
            [{ text: '✅ Done Editing', callback_data: `edit_${taskId}_done` }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('Error starting edit flow:', error);
    return ctx.reply('❌ Error loading task: ' + error.message);
  }
}

/**
 * Handle edit field selection
 */
async function handleTaskEditCallback(ctx, prisma) {
  const [_, taskId, field] = ctx.match;

  if (field === 'done') {
    delete ctx.session.taskEdit;
    await ctx.answerCbQuery('✅ Editing completed');
    return ctx.editMessageText('✅ Task editing completed!');
  }

  ctx.session.taskEdit.field = field;

  await ctx.answerCbQuery();

  switch (field) {
    case 'name':
      await ctx.editMessageText('Enter new task name:');
      return ctx.reply('New name:', { reply_markup: { force_reply: true } });

    case 'description':
      await ctx.editMessageText(
        'Enter update to add to description:\n' +
        '(This will be appended with timestamp)'
      );
      return ctx.reply('Update:', { reply_markup: { force_reply: true } });

    case 'status':
      return ctx.editMessageText(
        'Choose new status:',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 To Do', callback_data: `editstatus_${taskId}_to do` }],
              [{ text: '▶️ In Progress', callback_data: `editstatus_${taskId}_in progress` }],
              [{ text: '✅ Completed', callback_data: `editstatus_${taskId}_complete` }],
              [{ text: '⬅️ Back', callback_data: `edit_${taskId}_menu` }]
            ]
          }
        }
      );

    case 'duration':
      await ctx.editMessageText('Enter new duration (e.g., "2h 30m"):');
      return ctx.reply('Duration:', { reply_markup: { force_reply: true } });

    case 'startdate':
      await ctx.editMessageText('Enter new start date (YYYY-MM-DD, "today", "tomorrow"):');
      return ctx.reply('Start date:', { reply_markup: { force_reply: true } });

    case 'assignee':
      try {
        const settings = await prisma.botSettings.findFirst();
        const clickup = new ClickUpService(settings.clickupApiToken);
        const members = await clickup.getWorkspaceMembers(settings.clickupWorkspaceId);
        const employees = await prisma.employee.findMany({
          where: { clickupUserId: { not: null } }
        });

        const keyboard = [];
        for (const emp of employees) {
          const member = members.find(m => m.user.id.toString() === emp.clickupUserId);
          if (member) {
            keyboard.push([{
              text: emp.name,
              callback_data: `editassign_${taskId}_${emp.clickupUserId}`
            }]);
          }
        }
        keyboard.push([{ text: '❌ Unassign', callback_data: `editassign_${taskId}_unassign` }]);
        keyboard.push([{ text: '⬅️ Back', callback_data: `edit_${taskId}_menu` }]);

        return ctx.editMessageText(
          'Choose new assignee:',
          { reply_markup: { inline_keyboard: keyboard } }
        );
      } catch (error) {
        console.error('Error fetching members:', error);
        return ctx.editMessageText('❌ Error fetching team members.');
      }
  }
}

/**
 * Handle edit field value update
 */
async function handleTaskEditValueUpdate(ctx, prisma) {
  if (!ctx.session.taskEdit) return;

  const { taskId, field } = ctx.session.taskEdit;
  const value = ctx.message.text;

  try {
    const settings = await prisma.botSettings.findFirst();
    const clickup = new ClickUpService(settings.clickupApiToken);
    const updates = {};

    switch (field) {
      case 'name':
        updates.name = value;
        break;

      case 'description':
        await clickup.appendToDescription(taskId, value);
        await ctx.reply('✅ Description updated!');
        return startTaskEditFlow(ctx, prisma, taskId);

      case 'duration':
        const duration = parseDuration(value);
        if (!duration) {
          return ctx.reply('❌ Invalid duration format. Try again.');
        }
        updates.timeEstimate = duration;
        break;

      case 'startdate':
        const startDate = parseDate(value);
        if (!startDate) {
          return ctx.reply('❌ Invalid date format. Try again.');
        }
        updates.startDate = startDate;
        break;
    }

    if (Object.keys(updates).length > 0) {
      await clickup.updateTask(taskId, updates);
      await ctx.reply(`✅ Task ${field} updated!`);
      return startTaskEditFlow(ctx, prisma, taskId);
    }
  } catch (error) {
    console.error('Error updating task:', error);
    return ctx.reply('❌ Error updating task: ' + error.message);
  }
}

/**
 * Helper: Parse duration string
 */
function parseDuration(str) {
  const hourMatch = str.match(/(\d+\.?\d*)\s*h/);
  const minMatch = str.match(/(\d+)\s*m/);

  let totalMs = 0;
  if (hourMatch) totalMs += parseFloat(hourMatch[1]) * 60 * 60 * 1000;
  if (minMatch) totalMs += parseInt(minMatch[1]) * 60 * 1000;

  return totalMs || null;
}

/**
 * Helper: Format duration
 */
function formatDuration(ms) {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Helper: Parse date string
 */
function parseDate(str) {
  if (str === 'today') {
    return Date.now();
  }
  if (str === 'tomorrow') {
    return Date.now() + 24 * 60 * 60 * 1000;
  }

  const dateMatch = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) {
    const date = new Date(dateMatch[0]);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  return null;
}

module.exports = {
  startTaskCreationFlow,
  handleTaskCreationStep,
  handleTaskStatusCallback,
  handleTaskAssigneeCallback,
  startTaskEditFlow,
  handleTaskEditCallback,
  handleTaskEditValueUpdate
};
