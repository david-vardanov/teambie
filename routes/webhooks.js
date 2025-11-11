const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

/**
 * ClickUp webhook endpoint
 * Receives events from ClickUp when tasks are created, updated, or status changed
 */
router.post('/clickup', async (req, res) => {
  try {
    console.log('ClickUp webhook received:', JSON.stringify(req.body, null, 2));

    const { event, task_id, history_items, webhook_id } = req.body;

    if (!event || !task_id) {
      console.log('Invalid webhook payload - missing event or task_id');
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    // Find employee by webhook ID
    const employee = await prisma.employee.findFirst({
      where: { clickupWebhookId: webhook_id }
    });

    if (!employee || !employee.telegramUserId) {
      console.log('Employee not found for webhook_id:', webhook_id);
      return res.status(200).json({ message: 'Webhook received but no employee linked' });
    }

    // Get bot settings for Telegram
    const botSettings = await prisma.botSettings.findFirst();
    if (!botSettings?.telegramBotToken) {
      console.log('Telegram bot not configured');
      return res.status(200).json({ message: 'Webhook received but Telegram not configured' });
    }

    // Load Telegram bot dynamically
    const { Telegraf } = require('telegraf');
    const bot = new Telegraf(botSettings.telegramBotToken);

    // Parse event type and build notification message
    let message = '';

    if (event === 'taskCreated') {
      message = `📋 *New Task Created!*\n\n`;
      message += `📝 ${req.body.task?.name || 'Untitled Task'}\n`;
      message += `🔗 ${req.body.task?.url || ''}\n\n`;

      if (req.body.task?.status) {
        message += `📊 Status: ${req.body.task.status.status}\n`;
      }

      if (req.body.task?.assignees && req.body.task.assignees.length > 0) {
        const assigneeNames = req.body.task.assignees.map(a => a.username).join(', ');
        message += `👤 Assigned to: ${assigneeNames}\n`;
      }

      if (req.body.task?.due_date) {
        const dueDate = new Date(parseInt(req.body.task.due_date));
        message += `⏰ Due: ${dueDate.toLocaleDateString()}\n`;
      }

    } else if (event === 'taskUpdated') {
      message = `🔄 *Task Updated!*\n\n`;
      message += `📝 ${req.body.task?.name || 'Untitled Task'}\n`;
      message += `🔗 ${req.body.task?.url || ''}\n\n`;

      // Parse history items to show what changed
      if (history_items && history_items.length > 0) {
        message += `*Changes:*\n`;
        for (const item of history_items.slice(0, 5)) { // Show max 5 changes
          if (item.field === 'status') {
            message += `📊 Status: ${item.before?.status || 'None'} → ${item.after?.status || 'None'}\n`;
          } else if (item.field === 'assignee_add') {
            message += `👤 Assigned: ${item.after?.username || 'Someone'}\n`;
          } else if (item.field === 'assignee_rem') {
            message += `👤 Unassigned: ${item.before?.username || 'Someone'}\n`;
          } else if (item.field === 'name') {
            message += `📝 Name changed\n`;
          } else if (item.field === 'description') {
            message += `📄 Description updated\n`;
          } else if (item.field === 'due_date') {
            message += `⏰ Due date changed\n`;
          } else if (item.field === 'priority') {
            message += `⚠️ Priority changed\n`;
          } else {
            message += `✏️ ${item.field} updated\n`;
          }
        }
      }

    } else if (event === 'taskStatusUpdated') {
      message = `📊 *Task Status Changed!*\n\n`;
      message += `📝 ${req.body.task?.name || 'Untitled Task'}\n`;
      message += `🔗 ${req.body.task?.url || ''}\n\n`;

      if (history_items && history_items.length > 0) {
        const statusChange = history_items.find(item => item.field === 'status');
        if (statusChange) {
          message += `Status: ${statusChange.before?.status || 'None'} → *${statusChange.after?.status || 'None'}*\n`;
        }
      }

    } else if (event === 'taskDeleted') {
      message = `🗑️ *Task Deleted!*\n\n`;
      message += `📝 ${req.body.task?.name || 'A task'} was deleted\n`;

    } else if (event === 'taskCommentPosted') {
      message = `💬 *New Comment on Task!*\n\n`;
      message += `📝 ${req.body.task?.name || 'Untitled Task'}\n`;
      message += `🔗 ${req.body.task?.url || ''}\n\n`;

      if (req.body.comment) {
        const commentText = req.body.comment.comment_text || req.body.comment.text_content || '';
        const commentPreview = commentText.substring(0, 200);
        message += `💬 "${commentPreview}${commentText.length > 200 ? '...' : ''}"\n`;
        message += `👤 By: ${req.body.comment.user?.username || 'Someone'}\n`;
      }

    } else {
      // Unknown event type
      message = `🔔 *Task Notification*\n\n`;
      message += `📝 ${req.body.task?.name || 'A task'}\n`;
      message += `🔗 ${req.body.task?.url || ''}\n\n`;
      message += `Event: ${event}\n`;
    }

    // Send notification to employee via Telegram
    await bot.telegram.sendMessage(
      employee.telegramUserId.toString(),
      message,
      { parse_mode: 'Markdown' }
    );

    console.log(`Notification sent to employee ${employee.name} (${employee.telegramUserId})`);

    return res.status(200).json({ message: 'Webhook processed successfully' });

  } catch (error) {
    console.error('Error processing ClickUp webhook:', error);
    console.error('Error stack:', error.stack);

    // Return 200 anyway to avoid ClickUp retrying
    return res.status(200).json({ error: error.message });
  }
});

module.exports = router;
