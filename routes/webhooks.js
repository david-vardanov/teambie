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

    if (!event) {
      console.log('Invalid webhook payload - missing event');
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    // task_id might not always be present in all events
    if (!task_id && event !== 'ping') {
      console.log('Warning: webhook event without task_id:', event);
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

    // Fetch task details from ClickUp API instead of relying on webhook payload
    let task = null;
    if (task_id && employee.clickupApiToken) {
      try {
        const ClickUpService = require('../services/clickup');
        const clickup = new ClickUpService(employee.clickupApiToken);
        task = await clickup.getTask(task_id, false);
        console.log('Fetched task from API:', task.name);
      } catch (error) {
        console.error('Failed to fetch task from API:', error.message);
        // Continue with webhook payload data as fallback
        task = req.body.task;
      }
    } else {
      task = req.body.task;
    }

    // Load Telegram bot dynamically
    const { Telegraf } = require('telegraf');
    const bot = new Telegraf(botSettings.telegramBotToken);

    // Escape Markdown special characters
    const escapeMarkdown = (text) => {
      if (!text) return '';
      return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
    };

    // Parse event type and build notification message
    let message = '';

    if (event === 'taskCreated') {
      message = `📋 *New Task Created!*\n\n`;
      message += `📝 ${escapeMarkdown(task?.name || 'Untitled Task')}\n`;
      if (task?.url) {
        message += `🔗 ${task.url}\n`;
      }
      message += `\n`;

      if (task?.status) {
        message += `📊 Status: ${escapeMarkdown(task.status.status || task.status)}\n`;
      }

      if (task?.assignees && task.assignees.length > 0) {
        const assigneeNames = task.assignees.map(a => a.username).join(', ');
        message += `👤 Assigned to: ${escapeMarkdown(assigneeNames)}\n`;
      }

      if (task?.due_date) {
        const dueDate = new Date(parseInt(task.due_date));
        message += `⏰ Due: ${dueDate.toLocaleDateString()}\n`;
      }

    } else if (event === 'taskUpdated') {
      message = `🔄 *Task Updated!*\n\n`;
      message += `📝 ${escapeMarkdown(task?.name || 'Untitled Task')}\n`;
      if (task?.url) {
        message += `🔗 ${task.url}\n`;
      }
      message += `\n`;

      // Parse history items to show what changed
      if (history_items && history_items.length > 0) {
        message += `*Changes:*\n`;
        for (const item of history_items.slice(0, 5)) { // Show max 5 changes
          if (item.field === 'status') {
            message += `📊 Status: ${escapeMarkdown(item.before?.status || 'None')} → ${escapeMarkdown(item.after?.status || 'None')}\n`;
          } else if (item.field === 'assignee_add') {
            message += `👤 Assigned: ${escapeMarkdown(item.after?.username || 'Someone')}\n`;
          } else if (item.field === 'assignee_rem') {
            message += `👤 Unassigned: ${escapeMarkdown(item.before?.username || 'Someone')}\n`;
          } else if (item.field === 'name') {
            message += `📝 Name changed\n`;
          } else if (item.field === 'description') {
            message += `📄 Description updated\n`;
          } else if (item.field === 'due_date') {
            message += `⏰ Due date changed\n`;
          } else if (item.field === 'priority') {
            message += `⚠️ Priority changed\n`;
          } else if (item.field === 'content') {
            message += `📝 Content updated\n`;
          } else {
            message += `✏️ ${escapeMarkdown(item.field)} updated\n`;
          }
        }
      }

    } else if (event === 'taskStatusUpdated') {
      message = `📊 *Task Status Changed!*\n\n`;
      message += `📝 ${escapeMarkdown(task?.name || 'Untitled Task')}\n`;
      if (task?.url) {
        message += `🔗 ${task.url}\n`;
      }
      message += `\n`;

      if (history_items && history_items.length > 0) {
        const statusChange = history_items.find(item => item.field === 'status');
        if (statusChange) {
          message += `Status: ${escapeMarkdown(statusChange.before?.status || 'None')} → *${escapeMarkdown(statusChange.after?.status || 'None')}*\n`;
        }
      }

    } else if (event === 'taskDeleted') {
      message = `🗑️ *Task Deleted!*\n\n`;
      message += `📝 ${escapeMarkdown(task?.name || 'A task')} was deleted\n`;

    } else if (event === 'taskCommentPosted') {
      message = `💬 *New Comment on Task!*\n\n`;
      message += `📝 ${escapeMarkdown(task?.name || 'Untitled Task')}\n`;
      if (task?.url) {
        message += `🔗 ${task.url}\n`;
      }
      message += `\n`;

      if (req.body.comment) {
        const commentText = req.body.comment.comment_text || req.body.comment.text_content || '';
        const commentPreview = commentText.substring(0, 200);
        message += `💬 "${escapeMarkdown(commentPreview)}${commentText.length > 200 ? '...' : ''}"\n`;
        message += `👤 By: ${escapeMarkdown(req.body.comment.user?.username || 'Someone')}\n`;
      }

    } else {
      // Unknown event type
      message = `🔔 *Task Notification*\n\n`;
      message += `📝 ${escapeMarkdown(task?.name || 'A task')}\n`;
      if (task?.url) {
        message += `🔗 ${task.url}\n`;
      }
      message += `\n`;
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
