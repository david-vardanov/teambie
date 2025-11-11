const ClickUpService = require('../../services/clickup');
const {
  startTaskCreationFlow,
  startTaskEditFlow
} = require('../flows/tasks');

/**
 * /newtask - Create a new task
 */
async function newTask(ctx) {
  const prisma = ctx.prisma;
  const settings = await prisma.botSettings.findFirst();

  if (!settings?.clickupEnabled) {
    return ctx.reply('❌ ClickUp integration is not enabled. Contact your admin.');
  }

  const employee = await prisma.employee.findUnique({
    where: { telegramUserId: BigInt(ctx.from.id) }
  });

  if (!employee) {
    return ctx.reply('❌ You need to link your account first. Use /start');
  }

  if (!employee.clickupApiToken) {
    return ctx.reply('❌ Your ClickUp API token is not configured. Contact your admin to set it up in your employee profile.');
  }

  return startTaskCreationFlow(ctx, prisma);
}

/**
 * /tasks - List all tasks in the employee's configured list
 */
async function listTasks(ctx) {
  const prisma = ctx.prisma;
  try {
    console.log('/tasks command called');
    const settings = await prisma.botSettings.findFirst();

    if (!settings?.clickupEnabled) {
      console.log('ClickUp not enabled');
      return ctx.reply('❌ ClickUp integration is not enabled. Contact your admin.');
    }

    const employee = await prisma.employee.findUnique({
      where: { telegramUserId: BigInt(ctx.from.id) }
    });

    if (!employee?.clickupApiToken) {
      return ctx.reply('❌ Your ClickUp API token is not configured. Contact your admin.');
    }

    if (!employee?.clickupListId) {
      console.log('ClickUp list ID not configured for employee');
      return ctx.reply('❌ Your ClickUp list is not configured. Contact your admin to set it in your employee profile.');
    }

    console.log('Fetching tasks from ClickUp list:', employee.clickupListId);
    const clickup = new ClickUpService(employee.clickupApiToken);
    const tasks = await clickup.getTasks(employee.clickupListId, {
      includeSubtasks: false, // Don't include subtasks in main list
      includeClosed: false
    });
    console.log(`Found ${tasks.length} tasks`);

    if (tasks.length === 0) {
      return ctx.reply('📋 No tasks found.');
    }

    // Group tasks by status
    const grouped = tasks.reduce((acc, task) => {
      const status = task.status?.status || 'No Status';
      if (!acc[status]) acc[status] = [];
      acc[status].push(task);
      return acc;
    }, {});

    let message = '📋 *Tasks Overview*\n\n';

    for (const [status, taskList] of Object.entries(grouped)) {
      message += `*${getStatusEmoji(status)} ${status}* (${taskList.length})\n`;
      for (const task of taskList.slice(0, 5)) { // Limit to 5 per status
        const assignee = task.assignees?.[0]?.username || 'Unassigned';
        message += `  • ${task.name} - ${assignee}\n    /task_${task.id}\n`;
      }
      if (taskList.length > 5) {
        message += `  ... and ${taskList.length - 5} more\n`;
      }
      message += '\n';
    }

    message += `Total: ${tasks.length} task(s)\n`;
    message += `\nUse /task_[id] to view details\n`;
    message += `Use /mytasks to see only your tasks`;

    return ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error listing tasks:', error);
    console.error('Error stack:', error.stack);
    try {
      return await ctx.reply('❌ Error fetching tasks: ' + error.message);
    } catch (replyError) {
      console.error('Failed to send error message:', replyError);
    }
  }
}

/**
 * /mytasks - List tasks assigned to current user
 */
async function myTasks(ctx) {
  const prisma = ctx.prisma;
  try {
    const employee = await prisma.employee.findUnique({
      where: { telegramUserId: BigInt(ctx.from.id) }
    });

    if (!employee?.clickupUserId) {
      return ctx.reply('❌ Your ClickUp account is not linked. Contact admin.');
    }

    if (!employee?.clickupApiToken) {
      return ctx.reply('❌ Your ClickUp API token is not configured. Contact admin.');
    }

    if (!employee?.clickupListId) {
      return ctx.reply('❌ Your ClickUp list is not configured. Contact admin.');
    }

    const settings = await prisma.botSettings.findFirst();
    if (!settings?.clickupEnabled) {
      return ctx.reply('❌ ClickUp integration is not enabled.');
    }

    const clickup = new ClickUpService(employee.clickupApiToken);
    const tasks = await clickup.getTasks(employee.clickupListId, {
      assignees: [employee.clickupUserId],
      includeSubtasks: true,
      includeClosed: false
    });

    if (tasks.length === 0) {
      return ctx.reply('📋 No tasks assigned to you.');
    }

    let message = `📋 *Your Tasks* (${tasks.length})\n\n`;

    const grouped = tasks.reduce((acc, task) => {
      const status = task.status?.status || 'No Status';
      if (!acc[status]) acc[status] = [];
      acc[status].push(task);
      return acc;
    }, {});

    for (const [status, taskList] of Object.entries(grouped)) {
      message += `*${getStatusEmoji(status)} ${status}* (${taskList.length})\n`;
      for (const task of taskList) {
        const dueDate = task.due_date
          ? ` - Due: ${new Date(parseInt(task.due_date)).toLocaleDateString()}`
          : '';
        const parentMark = task.parent ? '  ↳ ' : '  • ';
        message += `${parentMark}${task.name}${dueDate}\n    /task_${task.id}\n`;
      }
      message += '\n';
    }

    return ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error fetching my tasks:', error);
    return ctx.reply('❌ Error fetching your tasks: ' + error.message);
  }
}

/**
 * /task_[id] - View task details (used as command)
 */
async function viewTask(ctx) {
  const prisma = ctx.prisma;
  const taskId = ctx.message.text.replace('/task_', '').trim();

  if (!taskId) {
    return ctx.reply('❌ Usage: /task_[task_id]');
  }

  try {
    const employee = await prisma.employee.findUnique({
      where: { telegramUserId: BigInt(ctx.from.id) }
    });

    if (!employee?.clickupApiToken) {
      return ctx.reply('❌ Your ClickUp API token is not configured. Contact admin.');
    }

    const clickup = new ClickUpService(employee.clickupApiToken);
    const task = await clickup.getTask(taskId, true);
    const formatted = clickup.formatTaskForDisplay(task);

    let message = `📝 *${formatted.name}*\n\n`;
    message += `🔗 ${formatted.url}\n\n`;
    message += `📊 Status: *${formatted.status}*\n`;
    message += `👤 Assignee: ${formatted.assignees}\n`;
    message += `📅 Start: ${formatted.startDate}\n`;
    message += `⏱️ Duration: ${formatted.duration}\n`;

    if (formatted.dueDate !== 'No due date') {
      message += `⏰ Due: ${formatted.dueDate}\n`;
    }

    if (formatted.description && formatted.description !== 'No description') {
      message += `\n📄 *Description:*\n${formatted.description.substring(0, 500)}`;
      if (formatted.description.length > 500) {
        message += '...\n(See full description in ClickUp)';
      }
    }

    if (formatted.subtaskCount > 0) {
      message += `\n\n*Subtasks (${formatted.subtaskCount}):*\n`;
      for (const subtask of formatted.subtasks.slice(0, 5)) {
        const status = subtask.status?.status || 'todo';
        const emoji = getStatusEmoji(status);
        message += `  ${emoji} ${subtask.name}\n`;
      }
      if (formatted.subtasks.length > 5) {
        message += `  ... and ${formatted.subtasks.length - 5} more\n`;
      }
    }

    const keyboard = [
      [{ text: '✏️ Edit Task', callback_data: `edittask_${taskId}` }],
      [{ text: '➕ Add Subtask', callback_data: `addsubtask_${taskId}` }],
      [{ text: '🗑️ Delete Task', callback_data: `deletetask_${taskId}_confirm` }]
    ];

    return ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (error) {
    console.error('Error viewing task:', error);
    return ctx.reply('❌ Error loading task: ' + error.message);
  }
}

/**
 * Handle edit task callback
 */
async function handleEditTaskCallback(ctx) {
  const prisma = ctx.prisma;
  const taskId = ctx.match[1];
  await ctx.answerCbQuery();
  return startTaskEditFlow(ctx, prisma, taskId);
}

/**
 * Handle add subtask callback
 */
async function handleAddSubtaskCallback(ctx) {
  const prisma = ctx.prisma;
  const parentId = ctx.match[1];
  await ctx.answerCbQuery();

  ctx.session.subtaskCreation = {
    parentId,
    step: 'name'
  };

  await ctx.editMessageText('Creating a new subtask...');
  return ctx.reply(
    '📝 What is the subtask name?',
    { reply_markup: { force_reply: true } }
  );
}

/**
 * Handle subtask creation steps
 */
async function handleSubtaskCreationStep(ctx) {
  const prisma = ctx.prisma;
  if (!ctx.session.subtaskCreation) return;

  const { parentId, step, data = {} } = ctx.session.subtaskCreation;
  const message = ctx.message.text;

  if (step === 'name') {
    data.name = message;
    ctx.session.subtaskCreation.data = data;
    ctx.session.subtaskCreation.step = 'assignee';

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
            callback_data: `subtask_assign_${parentId}_${emp.clickupUserId}`
          }]);
        }
      }
      keyboard.push([{
        text: '⏭️ Skip (Unassigned)',
        callback_data: `subtask_assign_${parentId}_skip`
      }]);

      return ctx.reply(
        `✅ Subtask name: "${message}"\n\n` +
        'Who should be assigned?',
        { reply_markup: { inline_keyboard: keyboard } }
      );
    } catch (error) {
      console.error('Error in subtask creation:', error);
      return ctx.reply('❌ Error: ' + error.message);
    }
  }
}

/**
 * Handle subtask assignee callback
 */
async function handleSubtaskAssigneeCallback(ctx) {
  const prisma = ctx.prisma;
  const [parentId, assigneeId] = ctx.match.slice(1);
  await ctx.answerCbQuery();

  try {
    const employee = await prisma.employee.findUnique({
      where: { telegramUserId: BigInt(ctx.from.id) }
    });

    if (!employee?.clickupListId) {
      return ctx.editMessageText('❌ Your ClickUp list is not configured. Contact admin.');
    }

    const settings = await prisma.botSettings.findFirst();
    const clickup = new ClickUpService(settings.clickupApiToken);
    const { data } = ctx.session.subtaskCreation;

    const taskData = {
      name: data.name,
      parent: parentId,
      assignees: assigneeId === 'skip' ? undefined : [assigneeId]
    };

    const subtask = await clickup.createTask(employee.clickupListId, taskData);

    await ctx.editMessageText(
      `✅ Subtask created successfully!\n\n` +
      `📝 ${subtask.name}\n` +
      `🔗 ${subtask.url}`
    );

    delete ctx.session.subtaskCreation;

    // Notify assignee
    if (assigneeId !== 'skip') {
      const assignee = await prisma.employee.findUnique({
        where: { clickupUserId: assigneeId }
      });
      if (assignee?.telegramUserId) {
        try {
          await ctx.telegram.sendMessage(
            assignee.telegramUserId.toString(),
            `📋 New subtask assigned to you!\n\n` +
            `📝 ${subtask.name}\n` +
            `👤 Created by: ${ctx.from.first_name}\n` +
            `🔗 ${subtask.url}`
          );
        } catch (e) {
          console.error('Failed to notify assignee:', e);
        }
      }
    }
  } catch (error) {
    console.error('Error creating subtask:', error);
    await ctx.editMessageText('❌ Error creating subtask: ' + error.message);
    delete ctx.session.subtaskCreation;
  }
}

/**
 * Handle delete task callback
 */
async function handleDeleteTaskCallback(ctx) {
  const prisma = ctx.prisma;
  const [taskId, action] = ctx.match.slice(1);

  if (action === 'confirm') {
    await ctx.answerCbQuery();
    return ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [
          { text: '✅ Yes, Delete', callback_data: `deletetask_${taskId}_yes` },
          { text: '❌ Cancel', callback_data: `deletetask_${taskId}_cancel` }
        ]
      ]
    });
  }

  if (action === 'cancel') {
    await ctx.answerCbQuery('Cancelled');
    return ctx.editMessageText('❌ Task deletion cancelled.');
  }

  if (action === 'yes') {
    try {
      const employee = await prisma.employee.findUnique({
        where: { telegramUserId: BigInt(ctx.from.id) }
      });

      if (!employee?.clickupApiToken) {
        await ctx.answerCbQuery('❌ Not configured');
        return ctx.editMessageText('❌ Your ClickUp API token is not configured.');
      }

      const clickup = new ClickUpService(employee.clickupApiToken);
      await clickup.deleteTask(taskId);

      await ctx.answerCbQuery('✅ Task deleted');
      return ctx.editMessageText('✅ Task deleted successfully!');
    } catch (error) {
      console.error('Error deleting task:', error);
      await ctx.answerCbQuery('❌ Error');
      return ctx.editMessageText('❌ Error deleting task: ' + error.message);
    }
  }
}

/**
 * Helper: Get status emoji
 */
function getStatusEmoji(status) {
  const statusLower = status.toLowerCase();
  if (statusLower.includes('complete') || statusLower.includes('done')) return '✅';
  if (statusLower.includes('progress') || statusLower.includes('doing')) return '▶️';
  if (statusLower.includes('review')) return '👀';
  if (statusLower.includes('blocked')) return '🚫';
  return '📋';
}

module.exports = {
  newTask,
  listTasks,
  myTasks,
  viewTask,
  handleEditTaskCallback,
  handleAddSubtaskCallback,
  handleSubtaskCreationStep,
  handleSubtaskAssigneeCallback,
  handleDeleteTaskCallback
};
