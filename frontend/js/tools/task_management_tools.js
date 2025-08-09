import { ToolRegistry } from '../tool_registry.js';
import { TaskTools } from '../task_manager.js';

async function _taskCreate({ title, description = '', priority = 'medium', parentId = null, listId = null }) {
    if (!title) throw new Error("The 'title' parameter is required.");
    if (typeof title !== 'string') throw new Error("The 'title' parameter must be a string.");
    if (priority && !['low', 'medium', 'high', 'urgent'].includes(priority)) {
        throw new Error("The 'priority' parameter must be one of: low, medium, high, urgent.");
    }
    
    try {
        const task = await TaskTools.create({ title, description, priority, parentId, listId });
        return {
            message: `Task "${title}" created with ID ${task.id}.`,
            details: task
        };
    } catch (error) {
        throw new Error(`Failed to create task: ${error.message}`);
    }
}

async function _taskUpdate({ taskId, updates }) {
    if (!taskId || !updates) {
        throw new Error("The 'task_update' tool is missing required parameters. You MUST provide both a 'taskId' (string) and an 'updates' (object). For example: { taskId: 'task_123', updates: { status: 'in_progress', notes: 'Started working on the task.' } }");
    }
    if (typeof taskId !== 'string') throw new Error("The 'taskId' parameter must be a string.");
    if (typeof updates !== 'object' || updates === null) throw new Error("The 'updates' parameter must be an object.");
    
    try {
        const task = await TaskTools.update(taskId, updates);
        return {
            message: `Task "${task.title}" (ID: ${taskId}) updated.`,
            details: task
        };
    } catch (error) {
        throw new Error(`Failed to update task ${taskId}: ${error.message}`);
    }
}

async function _taskDelete({ taskId }) {
    if (!taskId) throw new Error("The 'taskId' parameter is required.");
    if (typeof taskId !== 'string') throw new Error("The 'taskId' parameter must be a string.");
    
    try {
        const task = await TaskTools.delete(taskId);
        return {
            message: `Task "${task.title}" (ID: ${taskId}) and all its subtasks have been deleted.`,
            details: task
        };
    } catch (error) {
        throw new Error(`Failed to delete task ${taskId}: ${error.message}`);
    }
}

async function _taskBreakdown({ taskId }) {
    if (!taskId) throw new Error("The 'taskId' parameter is required.");
    if (typeof taskId !== 'string') throw new Error("The 'taskId' parameter must be a string.");
    
    try {
        const mainTask = TaskTools.getById(taskId);
        if (!mainTask) throw new Error(`Task with ID ${taskId} not found.`);
        
        const subtasks = await TaskTools.breakdown(mainTask);
        return {
            message: `Goal "${mainTask.title}" has been broken down into ${subtasks.length} subtasks.`,
            details: {
                mainTask,
                subtasks
            }
        };
    } catch (error) {
        throw new Error(`Failed to breakdown task ${taskId}: ${error.message}`);
    }
}

async function _taskGetNext() {
    try {
        const nextTask = TaskTools.getNext();
        if (!nextTask) {
            return {
                message: "No actionable tasks are currently available. All tasks may be completed or blocked by dependencies.",
                details: null
            };
        }
        return {
            message: `The next actionable task is "${nextTask.title}".`,
            details: nextTask
        };
    } catch (error) {
        throw new Error(`Failed to get next task: ${error.message}`);
    }
}

async function _taskGetStatus({ taskId }) {
    try {
        if (taskId) {
            if (typeof taskId !== 'string') throw new Error("The 'taskId' parameter must be a string.");
            
            const task = TaskTools.getById(taskId);
            if (!task) {
                return {
                    message: `Task with ID ${taskId} not found.`,
                    details: null
                };
            }
            return {
                message: `Task "${task.title}" is currently ${task.status}.`,
                details: task
            };
        } else {
            // Get overall status of all tasks
            const allTasks = TaskTools.getAll();
            const stats = {
                total: allTasks.length,
                pending: allTasks.filter(t => t.status === 'pending').length,
                in_progress: allTasks.filter(t => t.status === 'in_progress').length,
                completed: allTasks.filter(t => t.status === 'completed').length,
                failed: allTasks.filter(t => t.status === 'failed').length
            };
            
            const activeTasks = allTasks.filter(t => t.status === 'in_progress');
            const nextTask = TaskTools.getNext();
            
            return {
                message: `Task Status Overview: ${stats.total} total, ${stats.pending} pending, ${stats.in_progress} in progress, ${stats.completed} completed, ${stats.failed} failed.`,
                details: {
                    stats,
                    activeTasks,
                    nextTask,
                    recentTasks: allTasks.sort((a, b) => (b.updatedTime || b.createdTime) - (a.updatedTime || a.createdTime)).slice(0, 5)
                }
            };
        }
    } catch (error) {
        throw new Error(`Failed to get task status: ${error.message}`);
    }
}
async function _startTaskSession({ taskId, description = '', duration = null }) {
    if (!taskId) throw new Error("The 'taskId' parameter is required.");
    if (typeof taskId !== 'string') throw new Error("The 'taskId' parameter must be a string.");
    
    try {
        const task = TaskTools.getById(taskId);
        if (!task) {
            throw new Error(`Task with ID ${taskId} not found.`);
        }
        
        const session = await TaskTools.startSession(taskId, { description, duration });
        return {
            message: `Task session started for "${task.title}" (ID: ${taskId})`,
            details: session
        };
    } catch (error) {
        throw new Error(`Failed to start task session: ${error.message}`);
    }
}

export function registerTaskManagerTools() {
    ToolRegistry.register('task_create', {
        handler: _taskCreate,
        requiresProject: false,
        createsCheckpoint: true,
        description: "Creates a new task. This is the starting point for any new goal.",
        parameters: {
            title: { type: 'string', required: true },
            description: { type: 'string' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
            parentId: { type: 'string' },
            listId: { type: 'string' }
        }
    });

    ToolRegistry.register('task_update', {
        handler: _taskUpdate,
        requiresProject: false,
        createsCheckpoint: true,
        description: "🔄 Updates an existing task. CRITICAL: You MUST provide both 'taskId' and 'updates'. The 'updates' object MUST contain the properties to be changed. For example, to mark a task as complete, the tool call would be: `task_update({ taskId: 'task_123', updates: { status: 'completed' } })`.",
        parameters: {
            taskId: { type: 'string', required: true, description: "REQUIRED: The ID of the task to update (e.g., 'task_123')" },
            updates: { type: 'object', required: true, description: "REQUIRED: An object with the fields to update (e.g., { status: 'completed', progress: 100 })" }
        }
    });

    ToolRegistry.register('task_delete', {
        handler: _taskDelete,
        requiresProject: false,
        createsCheckpoint: true,
        description: "Deletes a task and all of its subtasks.",
        parameters: { taskId: { type: 'string', required: true } }
    });

    ToolRegistry.register('task_breakdown', {
        handler: _taskBreakdown,
        requiresProject: false,
        createsCheckpoint: true,
        description: "🎯 CRITICAL: Analyzes a high-level task and breaks it down into SPECIFIC, ACTIONABLE subtasks. DO NOT create generic tasks like 'Analyze requirements' or 'Plan approach'. Instead, create concrete tasks like 'Locate CSS files containing dashboard styles', 'Identify color variables in style.css', 'Update background-color properties to blue theme'. Each subtask should be a specific action that can be executed immediately.",
        parameters: { taskId: { type: 'string', required: true } }
    });

    ToolRegistry.register('task_get_next', {
        handler: _taskGetNext,
        requiresProject: false,
        createsCheckpoint: false,
        description: "Fetches the next logical task for the AI to work on, based on priority and dependencies."
    });

    ToolRegistry.register('task_get_status', {
        handler: _taskGetStatus,
        requiresProject: false,
        createsCheckpoint: false,
        description: "Gets status information about tasks. Can check a specific task by ID or get overall task statistics.",
        parameters: { taskId: { type: 'string', description: 'Optional specific task ID to check. If omitted, returns overview of all tasks.' } }
    });

    ToolRegistry.register('start_task_session', {
        handler: _startTaskSession,
        requiresProject: false,
        createsCheckpoint: true,
        description: "Starts a new work session for a specific task, tracking time spent and progress. Useful for focused work periods on complex tasks.",
        parameters: {
            taskId: { type: 'string', required: true, description: 'The ID of the task to start a session for' },
            description: { type: 'string', description: 'Optional description of this work session' },
            duration: { type: 'number', description: 'Optional planned duration in minutes' }
        }
    });
}