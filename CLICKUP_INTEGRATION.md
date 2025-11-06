# ClickUp Integration Guide

## Overview

The team management bot now includes full ClickUp task management integration. This allows you to create, view, edit, and manage tasks directly through Telegram, with all data living in ClickUp.

## Features

### Task Management
- **Create tasks** with name, description, status, assignee, duration, and start date
- **View all tasks** or filter by assignee
- **Edit tasks** with interactive menus
- **Delete tasks** with confirmation
- **Subtasks** support (one level deep)
- **Status tracking**: To Do, In Progress, Completed
- **Automatic notifications** for task assignments and updates

### Simplified Structure
- No activity log (updates appended to description with timestamps)
- Comments stored in task description
- Three main statuses: To Do, In Progress, Completed
- Duration and start date tracking
- Employee-to-ClickUp user mapping

## Setup Instructions

### 1. Get ClickUp API Token

1. Log in to ClickUp
2. Click your avatar → **Settings**
3. Navigate to **Apps**
4. Click **API Token** → **Generate**
5. Copy the token (starts with `pk_`)

### 2. Configure in Settings

1. Navigate to `/config/bot` in the web interface
2. Scroll to **ClickUp Integration** section
3. Paste your API token
4. Click **Test ClickUp Connection** to verify
5. Click **Load Workspaces** and select your workspace
6. Click **Load Spaces** and select your space
7. Click **Load Lists** and select the list where tasks will be created
8. Check **Enable ClickUp Task Management**
9. Click **Save Settings**

### 3. Link Employees to ClickUp

Each employee needs their ClickUp user ID linked in the database:

```sql
-- Update employee with ClickUp user ID
UPDATE "Employee"
SET "clickupUserId" = 'CLICKUP_USER_ID_HERE'
WHERE email = 'employee@example.com';
```

To find ClickUp user IDs:
1. Use the ClickUp API to get workspace members
2. Or check the Network tab when viewing a user's profile in ClickUp

## Bot Commands

### For All Users

- `/newtask` - Create a new task with interactive flow
- `/tasks` - View all tasks grouped by status
- `/mytasks` - View only your assigned tasks
- `/task_[id]` - View detailed task information
- `/help` - Show available commands (includes task commands when enabled)

### Task Creation Flow

When you use `/newtask`, the bot will guide you through:

1. **Task Name**: Enter the task title
2. **Description**: Add description or skip
3. **Status**: Choose initial status (To Do, In Progress, Completed)
4. **Duration**: Enter time estimate (e.g., "2h", "30m", "2h 30m") or skip
5. **Start Date**: Enter date (YYYY-MM-DD, "today", "tomorrow") or skip
6. **Assignee**: Select from team members or skip

### Task Editing

Use `/task_[id]` to view a task, then click **✏️ Edit Task** to access:

- **Name**: Update task name
- **Description**: Add update (appended with timestamp)
- **Status**: Change status
- **Assignee**: Reassign or unassign
- **Duration**: Update time estimate
- **Start Date**: Change start date

### Subtasks

1. View a task with `/task_[id]`
2. Click **➕ Add Subtask**
3. Enter subtask name
4. Select assignee or skip
5. Subtask is created and linked to parent

## Notifications

Users receive Telegram notifications for:

- **Task assigned** to them
- **Subtask assigned** to them
- Notifications include task name, creator, and link

## Technical Details

### Database Schema

```prisma
model Employee {
  // ... existing fields
  clickupUserId String? @unique  // ClickUp user ID for mapping
}

model BotSettings {
  // ... existing fields
  clickupApiToken     String?
  clickupWorkspaceId  String?
  clickupSpaceId      String?
  clickupListId       String?
  clickupEnabled      Boolean @default(false)
}
```

### API Integration

The integration uses direct ClickUp API v2 calls:

- **GET /task/:id** - Fetch task details
- **POST /list/:id/task** - Create task
- **PUT /task/:id** - Update task
- **DELETE /task/:id** - Delete task
- **GET /list/:id/task** - List tasks with filters

### Task Structure

Tasks in ClickUp include:

```javascript
{
  name: "Task name",
  description: "Description with timestamped updates",
  status: "to do" | "in progress" | "complete",
  assignees: ["clickup_user_id"],
  start_date: 1234567890000,  // Unix timestamp in ms
  time_estimate: 7200000,     // Duration in ms (2h)
  parent: "parent_task_id"    // For subtasks
}
```

### Files Created

- `services/clickup.js` - ClickUp API service
- `bot/commands/tasks.js` - Task bot commands
- `bot/flows/tasks.js` - Interactive task flows
- `routes/settings.js` - Updated with ClickUp routes
- `views/settings/bot-settings.ejs` - Updated with ClickUp UI

## Usage Examples

### Create a Task

```
User: /newtask
Bot: What is the task name?
User: Implement user authentication
Bot: Provide a description (or "skip"):
User: Add JWT-based authentication to the API
Bot: [Shows status buttons]
User: [Clicks "In Progress"]
Bot: Enter duration (e.g., "2h 30m"):
User: 4h
Bot: When should this task start?
User: today
Bot: [Shows assignee list]
User: [Selects assignee]
Bot: ✅ Task created successfully!
     🔗 https://app.clickup.com/t/abc123
```

### View Tasks

```
User: /tasks
Bot: 📋 Tasks Overview

     ✅ Completed (2)
       • Deploy to production - John
         /task_abc123
       • Fix login bug - Sarah
         /task_abc456

     ▶️ In Progress (3)
       • Implement auth - Mike
         /task_abc789
       ...

     Total: 5 task(s)
```

### Edit a Task

```
User: /task_abc123
Bot: 📝 Implement user authentication
     🔗 https://app.clickup.com/t/abc123
     📊 Status: In Progress
     👤 Assignee: Mike
     ...
     [Shows Edit, Add Subtask, Delete buttons]

User: [Clicks Edit]
Bot: What would you like to update?
     [Shows: Name, Description, Status, Assignee, Duration, Start Date, Done]

User: [Clicks Status]
Bot: Choose new status:
     [Shows: To Do, In Progress, Completed]

User: [Clicks Completed]
Bot: ✅ Status updated to: complete
```

## Advanced Features

### Duration Parsing

Supports multiple formats:
- `"2h"` - 2 hours
- `"30m"` - 30 minutes
- `"2h 30m"` - 2 hours 30 minutes
- `"2.5h"` - 2.5 hours

### Date Parsing

Supports:
- `"2025-11-15"` - Specific date
- `"today"` - Current date
- `"tomorrow"` - Next day

### Update Tracking

All description updates are appended with timestamps:

```
Original description

---
Update (Nov 6, 2025, 10:30 AM):
Added new requirement for 2FA

---
Update (Nov 7, 2025, 2:45 PM):
Completed basic auth, working on 2FA
```

## Troubleshooting

### ClickUp Connection Failed

- Verify API token is correct
- Ensure token has not expired
- Check workspace permissions

### Tasks Not Showing

- Verify `clickupListId` is correctly configured
- Check if list is archived in ClickUp
- Ensure bot user has access to the list

### Employee Not Found

- Verify employee's `clickupUserId` is set in database
- Check that ClickUp user is active in workspace
- Ensure email matches between systems

### Notifications Not Received

- Verify employee has linked Telegram account (`/start`)
- Check employee's `telegramUserId` is set
- Ensure bot is running and enabled

## Future Enhancements

Potential additions (not currently implemented):

- **Webhook integration** for real-time task updates
- **Due date reminders** via scheduled jobs
- **Task templates** for common task types
- **Bulk operations** (assign multiple tasks)
- **Custom fields** support
- **Time tracking** integration
- **Task dependencies** visualization
- **Web interface** for task management

## Support

For issues or questions:
1. Check the console logs for error messages
2. Verify ClickUp API status: https://status.clickup.com
3. Review bot settings at `/config/bot`
4. Check employee ClickUp linkage in database

## API Rate Limits

ClickUp has rate limits:
- **100 requests per minute** per token
- The bot caches some data to minimize API calls
- Heavy usage may require rate limit handling

## Security Notes

- ClickUp API token is stored in database
- Token provides full access to ClickUp workspace
- Restrict admin access to settings page
- Consider using environment variables for sensitive tokens
- Regularly rotate API tokens for security
