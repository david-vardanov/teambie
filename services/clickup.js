const axios = require('axios');

/**
 * ClickUp API Service
 * Handles all ClickUp API interactions for task management
 */
class ClickUpService {
  constructor(apiToken) {
    this.apiToken = apiToken;
    this.baseUrl = 'https://api.clickup.com/api/v2';
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': apiToken,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Get authorized user info
   */
  async getUser() {
    try {
      const response = await this.client.get('/user');
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get workspaces (teams)
   */
  async getWorkspaces() {
    try {
      const response = await this.client.get('/team');
      return response.data.teams;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get spaces in a workspace
   */
  async getSpaces(workspaceId) {
    try {
      const response = await this.client.get(`/team/${workspaceId}/space?archived=false`);
      return response.data.spaces;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get folders in a space
   */
  async getFolders(spaceId) {
    try {
      const response = await this.client.get(`/space/${spaceId}/folder?archived=false`);
      return response.data.folders;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get lists (can be in folder or space)
   */
  async getLists(folderId) {
    try {
      const response = await this.client.get(`/folder/${folderId}/list?archived=false`);
      return response.data.lists;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get lists directly from a space (folderless)
   */
  async getSpaceLists(spaceId) {
    try {
      const response = await this.client.get(`/space/${spaceId}/list?archived=false`);
      return response.data.lists;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get tasks from a list with filters
   */
  async getTasks(listId, options = {}) {
    try {
      const params = new URLSearchParams();

      if (options.assignees) {
        options.assignees.forEach(id => params.append('assignees[]', id));
      }
      if (options.statuses) {
        options.statuses.forEach(status => params.append('statuses[]', status));
      }
      if (options.includeSubtasks !== false) {
        params.append('subtasks', 'true');
      }
      if (options.includeClosed) {
        params.append('include_closed', 'true');
      }

      const response = await this.client.get(`/list/${listId}/task?${params.toString()}`);
      return response.data.tasks;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get a specific task by ID
   */
  async getTask(taskId, includeSubtasks = true) {
    try {
      const params = includeSubtasks ? '?include_subtasks=true' : '';
      const response = await this.client.get(`/task/${taskId}${params}`);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get tasks from a team/workspace filtered by assignee
   * This searches across all lists in the workspace
   */
  async getTeamTasks(workspaceId, options = {}) {
    try {
      const params = new URLSearchParams();

      if (options.assignees) {
        options.assignees.forEach(id => params.append('assignees[]', id));
      }
      if (options.statuses) {
        options.statuses.forEach(status => params.append('statuses[]', status));
      }
      if (options.includeSubtasks !== false) {
        params.append('subtasks', 'true');
      }
      if (options.includeClosed) {
        params.append('include_closed', 'true');
      }

      const response = await this.client.get(`/team/${workspaceId}/task?${params.toString()}`);
      return response.data.tasks;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Create a new task
   * @param {string} listId - The list ID where task will be created
   * @param {Object} taskData - Task data
   * @param {string} taskData.name - Task name (required)
   * @param {string} [taskData.description] - Task description
   * @param {Array<string>} [taskData.assignees] - Array of ClickUp user IDs
   * @param {string} [taskData.status] - Status name (e.g., "to do", "in progress", "completed")
   * @param {number} [taskData.dueDate] - Due date in milliseconds
   * @param {number} [taskData.startDate] - Start date in milliseconds
   * @param {number} [taskData.timeEstimate] - Time estimate in milliseconds
   * @param {string} [taskData.parent] - Parent task ID for subtasks
   */
  async createTask(listId, taskData) {
    try {
      const payload = {
        name: taskData.name,
      };

      if (taskData.description) {
        payload.description = taskData.description;
      }
      if (taskData.assignees && taskData.assignees.length > 0) {
        payload.assignees = taskData.assignees;
      }
      if (taskData.status) {
        payload.status = taskData.status;
      }
      if (taskData.dueDate) {
        payload.due_date = taskData.dueDate;
      }
      if (taskData.startDate) {
        payload.start_date = taskData.startDate;
      }
      if (taskData.timeEstimate) {
        payload.time_estimate = taskData.timeEstimate;
      }
      if (taskData.parent) {
        payload.parent = taskData.parent;
      }

      const response = await this.client.post(`/list/${listId}/task`, payload);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update a task
   */
  async updateTask(taskId, updates) {
    try {
      const payload = {};

      if (updates.name !== undefined) {
        payload.name = updates.name;
      }
      if (updates.description !== undefined) {
        payload.description = updates.description;
      }
      if (updates.status !== undefined) {
        payload.status = updates.status;
      }
      if (updates.assignees !== undefined) {
        payload.assignees = {
          add: updates.assignees.add || [],
          rem: updates.assignees.remove || []
        };
      }
      if (updates.dueDate !== undefined) {
        payload.due_date = updates.dueDate;
      }
      if (updates.startDate !== undefined) {
        payload.start_date = updates.startDate;
      }
      if (updates.timeEstimate !== undefined) {
        payload.time_estimate = updates.timeEstimate;
      }

      const response = await this.client.put(`/task/${taskId}`, payload);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId) {
    try {
      await this.client.delete(`/task/${taskId}`);
      return { success: true };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Add description update to task (append to description)
   */
  async appendToDescription(taskId, updateText) {
    try {
      const task = await this.getTask(taskId, false);
      const currentDescription = task.description || '';
      const timestamp = new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const newDescription = currentDescription +
        `\n\n---\n**Update (${timestamp}):**\n${updateText}`;

      return await this.updateTask(taskId, { description: newDescription });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get workspace members
   */
  async getWorkspaceMembers(workspaceId) {
    try {
      const response = await this.client.get(`/team/${workspaceId}`);
      return response.data.team.members;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get available statuses for a list
   */
  async getListStatuses(listId) {
    try {
      const response = await this.client.get(`/list/${listId}`);
      return response.data.statuses;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Format task for display
   */
  formatTaskForDisplay(task) {
    const assignees = task.assignees?.map(a => a.username).join(', ') || 'Unassigned';
    const status = task.status?.status || 'No status';
    const dueDate = task.due_date ? new Date(parseInt(task.due_date)).toLocaleDateString() : 'No due date';
    const startDate = task.start_date ? new Date(parseInt(task.start_date)).toLocaleDateString() : 'No start date';
    const duration = task.time_estimate ? this.formatDuration(task.time_estimate) : 'No estimate';
    const subtaskCount = task.subtasks?.length || 0;

    return {
      id: task.id,
      name: task.name,
      status,
      assignees,
      dueDate,
      startDate,
      duration,
      description: task.description || 'No description',
      url: task.url,
      subtaskCount,
      subtasks: task.subtasks || []
    };
  }

  /**
   * Format duration from milliseconds to human readable
   */
  formatDuration(milliseconds) {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));

    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  }

  /**
   * Convert duration string to milliseconds
   * Supports: "2h", "30m", "2h 30m", "2.5h"
   */
  parseDuration(durationStr) {
    const hourMatch = durationStr.match(/(\d+\.?\d*)\s*h/);
    const minMatch = durationStr.match(/(\d+)\s*m/);

    let totalMs = 0;
    if (hourMatch) {
      totalMs += parseFloat(hourMatch[1]) * 60 * 60 * 1000;
    }
    if (minMatch) {
      totalMs += parseInt(minMatch[1]) * 60 * 1000;
    }

    return totalMs || null;
  }

  /**
   * Create a webhook for a list
   * @param {string} workspaceId - The workspace ID
   * @param {string} endpoint - The webhook endpoint URL
   * @param {string} listId - The list ID to watch
   * @param {string[]} events - Array of events to listen for
   * @returns {Promise<object>} - The created webhook object with id
   */
  async createWebhook(workspaceId, endpoint, listId, events = ['*']) {
    try {
      const response = await this.client.post(`/team/${workspaceId}/webhook`, {
        endpoint: endpoint,
        events: events,
        list_id: listId
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete a webhook
   * @param {string} webhookId - The webhook ID to delete
   */
  async deleteWebhook(webhookId) {
    try {
      await this.client.delete(`/webhook/${webhookId}`);
      return true;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get all webhooks for a workspace
   * @param {string} workspaceId - The workspace ID
   */
  async getWebhooks(workspaceId) {
    try {
      const response = await this.client.get(`/team/${workspaceId}/webhook`);
      return response.data.webhooks;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Error handler
   */
  handleError(error) {
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.err || error.response.data?.error || error.message;

      switch (status) {
        case 401:
          return new Error('ClickUp authentication failed. Check your API token.');
        case 403:
          return new Error('Permission denied. Check your ClickUp access rights.');
        case 404:
          return new Error('Resource not found in ClickUp.');
        case 429:
          return new Error('Rate limit exceeded. Please try again later.');
        default:
          return new Error(`ClickUp API error: ${message}`);
      }
    }
    return new Error(`ClickUp service error: ${error.message}`);
  }
}

module.exports = ClickUpService;
