const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

/**
 * Message batching system
 * Queues webhook events and combines them into a single message after a delay
 */
const messageBatches = new Map(); // task_id -> { events: [], timeout: timeoutId, employee, botSettings }
const BATCH_DELAY_MS = 3500; // Wait 3.5 seconds for more events before sending

/**
 * Escape Markdown special characters
 */
const escapeMarkdown = (text) => {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
};

/**
 * Process a batch of events and send a combined notification
 */
async function processBatch(batchKey, batch) {
  const { events, employee, botSettings } = batch;

  console.log(`Processing batch for task ${batchKey} with ${events.length} events`);

  // Fetch fresh task data
  let task = null;
  const firstEvent = events[0];

  if (firstEvent.task_id && employee.clickupApiToken) {
    try {
      const ClickUpService = require('../services/clickup');
      const clickup = new ClickUpService(employee.clickupApiToken);
      task = await clickup.getTask(firstEvent.task_id, false);
    } catch (error) {
      console.error('Failed to fetch task from API:', error.message);
      task = firstEvent.payload.task;
    }
  } else {
    task = firstEvent.payload.task;
  }

  // Analyze events and collect changes
  const changes = {
    created: false,
    deleted: false,
    statusChanges: [],
    assigneeAdded: [],
    assigneeRemoved: [],
    otherChanges: [],
    comments: []
  };

  for (const evt of events) {
    if (evt.event === 'taskCreated') {
      changes.created = true;
    } else if (evt.event === 'taskDeleted') {
      changes.deleted = true;
    } else if (evt.event === 'taskCommentPosted') {
      changes.comments.push(evt.payload.comment);
    } else if (evt.event === 'taskStatusUpdated' || evt.event === 'taskUpdated') {
      // Parse history items
      if (evt.history_items && evt.history_items.length > 0) {
        for (const item of evt.history_items) {
          if (item.field === 'status') {
            // Only add if we don't already have this exact status change
            const statusChange = `${item.before?.status || 'None'} → ${item.after?.status || 'None'}`;
            if (!changes.statusChanges.includes(statusChange)) {
              changes.statusChanges.push(statusChange);
            }
          } else if (item.field === 'assignee_add') {
            changes.assigneeAdded.push(item.after?.username || 'Someone');
          } else if (item.field === 'assignee_rem') {
            changes.assigneeRemoved.push(item.before?.username || 'Someone');
          } else if (item.field !== 'status') {
            // Track other changes
            const changeDesc = formatFieldChange(item);
            if (changeDesc && !changes.otherChanges.includes(changeDesc)) {
              changes.otherChanges.push(changeDesc);
            }
          }
        }
      }
    }
  }

  // Build combined message with better hierarchy
  const message = formatCombinedMessage(task, changes);

  // Send to Telegram
  const { Telegraf } = require('telegraf');
  const bot = new Telegraf(botSettings.telegramBotToken);

  await bot.telegram.sendMessage(
    employee.telegramUserId.toString(),
    message,
    { parse_mode: 'Markdown' }
  );

  console.log(`Combined notification sent to ${employee.name} (${employee.telegramUserId})`);
}

/**
 * Format a field change into a readable string
 */
function formatFieldChange(item) {
  const field = item.field;

  const fieldNames = {
    name: 'Name',
    description: 'Description',
    due_date: 'Due date',
    priority: 'Priority',
    content: 'Content',
    tag: 'Tags'
  };

  return fieldNames[field] || field;
}

/**
 * Format a combined message with better hierarchy
 */
function formatCombinedMessage(task, changes) {
  let message = '';

  // Header - determine what happened
  if (changes.deleted) {
    message = `🗑 *Task Deleted*\n`;
  } else if (changes.created) {
    message = `✅ *Task Created*\n`;
  } else {
    message = `📝 *Task Updated*\n`;
  }

  // Task name and link (always on same line for compactness)
  const taskName = escapeMarkdown(task?.name || 'Untitled Task');
  if (task?.url) {
    message += `[${taskName}](${task.url})\n\n`;
  } else {
    message += `${taskName}\n\n`;
  }

  // Changes section
  const hasChanges = changes.statusChanges.length > 0 ||
                     changes.assigneeAdded.length > 0 ||
                     changes.assigneeRemoved.length > 0 ||
                     changes.otherChanges.length > 0 ||
                     changes.comments.length > 0;

  if (hasChanges) {
    // Status changes (most important, show first)
    if (changes.statusChanges.length > 0) {
      for (const statusChange of changes.statusChanges) {
        message += `▸ Status: ${escapeMarkdown(statusChange)}\n`;
      }
    }

    // Assignee changes
    if (changes.assigneeAdded.length > 0) {
      message += `▸ Assigned: ${escapeMarkdown(changes.assigneeAdded.join(', '))}\n`;
    }
    if (changes.assigneeRemoved.length > 0) {
      message += `▸ Unassigned: ${escapeMarkdown(changes.assigneeRemoved.join(', '))}\n`;
    }

    // Other changes
    if (changes.otherChanges.length > 0) {
      for (const change of changes.otherChanges) {
        message += `▸ ${escapeMarkdown(change)} updated\n`;
      }
    }

    // Comments
    if (changes.comments.length > 0) {
      for (const comment of changes.comments) {
        const commentText = comment.comment_text || comment.text_content || '';
        const preview = commentText.substring(0, 100);
        const username = comment.user?.username || 'Someone';
        message += `▸ Comment by ${escapeMarkdown(username)}: "${escapeMarkdown(preview)}${commentText.length > 100 ? '...' : ''}"\n`;
      }
    }
  } else if (changes.created && task?.status) {
    // For new tasks, show initial status
    message += `▸ Status: ${escapeMarkdown(task.status.status || task.status)}\n`;
  }

  return message;
}

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

    // Add event to batch queue
    const batchKey = task_id || `webhook_${webhook_id}_${Date.now()}`;

    if (!messageBatches.has(batchKey)) {
      messageBatches.set(batchKey, {
        events: [],
        employee,
        botSettings,
        timeout: null
      });
    }

    const batch = messageBatches.get(batchKey);

    // Clear existing timeout
    if (batch.timeout) {
      clearTimeout(batch.timeout);
    }

    // Add event to queue
    batch.events.push({
      event,
      task_id,
      history_items,
      webhook_id,
      payload: req.body
    });

    // Set new timeout to process batch
    batch.timeout = setTimeout(async () => {
      try {
        await processBatch(batchKey, batch);
      } catch (error) {
        console.error('Error processing batch:', error);
      } finally {
        messageBatches.delete(batchKey);
      }
    }, BATCH_DELAY_MS);

    console.log(`Event queued for task ${batchKey}. Current batch size: ${batch.events.length}`);

    return res.status(200).json({ message: 'Webhook queued for processing' });

  } catch (error) {
    console.error('Error processing ClickUp webhook:', error);
    console.error('Error stack:', error.stack);

    // Return 200 anyway to avoid ClickUp retrying
    return res.status(200).json({ error: error.message });
  }
});

module.exports = router;
