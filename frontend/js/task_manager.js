/**
 * Unified Task Management System
 * Merges AI-driven task breakdown with a user-facing todo list.
 * This system serves as the single source of truth for all tasks,
 * whether created by the user or the AI.
 */
import { DbManager } from './db.js';

class TaskManager {
    constructor() {
        this.tasks = new Map();
        this.lists = new Map();
        this.currentListId = 'default';
        this.activeTask = null; // The task the AI is currently focused on
        this.listeners = [];
        this.isInitialized = false;
        this.cleanupConfig = {
            enabled: true,
            inactivityThreshold: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
            checkInterval: 60 * 60 * 1000, // 1 hour in milliseconds
            action: 'complete' // 'complete', 'fail', or 'delete'
        };
        this.cleanupTimerId = null;
    }

    /**
     * Initialize the system from storage.
     */
    async initialize() {
        if (this.isInitialized) return;

        await this.loadFromStorage();

        // Ensure default list exists
        if (!this.lists.has('default')) {
            this.lists.set('default', {
                id: 'default',
                name: 'My Tasks',
                createdTime: Date.now()
            });
        }

        this.isInitialized = true;
        console.log('[TaskManager] System initialized');
        
        // Start the automated cleanup if enabled
        if (this.cleanupConfig.enabled) {
            this.startAutomatedCleanup();
        }
    }
    
    /**
     * Starts the automated cleanup process based on the cleanup configuration
     */
    startAutomatedCleanup() {
        // Clear any existing timer
        if (this.cleanupTimerId) {
            clearInterval(this.cleanupTimerId);
        }
        
        // Set up a new interval for cleanup
        this.cleanupTimerId = setInterval(() => {
            this.cleanupStaleTasks();
        }, this.cleanupConfig.checkInterval);
        
        console.log(`[TaskManager] Automated cleanup started. Will check every ${this.cleanupConfig.checkInterval / (60 * 1000)} minutes.`);
    }
    
    /**
     * Stops the automated cleanup process
     */
    stopAutomatedCleanup() {
        if (this.cleanupTimerId) {
            clearInterval(this.cleanupTimerId);
            this.cleanupTimerId = null;
            console.log('[TaskManager] Automated cleanup stopped.');
        }
    }
    
    /**
     * Updates the cleanup configuration
     * @param {Object} config - New configuration values
     */
    updateCleanupConfig(config = {}) {
        // Update only the provided configuration values
        this.cleanupConfig = {
            ...this.cleanupConfig,
            ...config
        };
        
        // Restart the cleanup process if it's enabled
        if (this.cleanupConfig.enabled) {
            this.startAutomatedCleanup();
        } else {
            this.stopAutomatedCleanup();
        }
        
        console.log('[TaskManager] Cleanup configuration updated:', this.cleanupConfig);
    }
    
    /**
     * Identifies and cleans up stale tasks based on inactivity
     */
    async cleanupStaleTasks() {
        console.log('[TaskManager] Running scheduled cleanup of stale tasks...');
        const now = Date.now();
        const staleThreshold = now - this.cleanupConfig.inactivityThreshold;
        let cleanupCount = 0;
        
        // Find tasks that haven't been updated for longer than the threshold
        // and are not in a terminal state (completed or failed)
        const staleTasks = Array.from(this.tasks.values())
            .filter(task => {
                return (task.status === 'pending' || task.status === 'in_progress') &&
                       task.updatedTime < staleThreshold;
            });
            
        if (staleTasks.length === 0) {
            console.log('[TaskManager] No stale tasks found.');
            return;
        }
        
        console.log(`[TaskManager] Found ${staleTasks.length} stale tasks. Cleanup action: ${this.cleanupConfig.action}`);
        
        // Process each stale task according to the configured action
        for (const task of staleTasks) {
            const inactiveDays = ((now - task.updatedTime) / (1000 * 60 * 60 * 24)).toFixed(1);
            console.log(`[TaskManager] Cleaning up task "${task.title}" (inactive for ${inactiveDays} days)`);
            
            try {
                if (this.cleanupConfig.action === 'delete') {
                    await this.deleteTask(task.id);
                } else {
                    // Add a note about the automated action
                    const actionType = this.cleanupConfig.action === 'complete' ? 'completed' : 'failed';
                    const note = {
                        id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        content: `Task automatically marked as ${actionType} due to inactivity (${inactiveDays} days).`,
                        type: 'system',
                        timestamp: Date.now()
                    };
                    
                    if (!task.notes) task.notes = [];
                    task.notes.push(note);
                    
                    // Update the task status
                    await this.updateTask(task.id, {
                        status: this.cleanupConfig.action === 'complete' ? 'completed' : 'failed',
                        completedTime: now,
                        context: {
                            ...task.context,
                            cleanedUp: true,
                            cleanupReason: 'inactivity',
                            inactiveDays: parseFloat(inactiveDays)
                        }
                    });
                }
                
                cleanupCount++;
            } catch (error) {
                console.error(`[TaskManager] Error cleaning up task ${task.id}:`, error);
            }
        }
        
        console.log(`[TaskManager] Cleanup completed. Processed ${cleanupCount} tasks.`);
    }

    /**
     * Create a new task. Can be a main goal or a subtask.
     */
    async createTask(data) {
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const targetListId = data.listId || this.currentListId;

        const task = {
            id: taskId,
            listId: targetListId,
            title: data.title.trim(),
            description: (data.description || '').trim(),
            status: data.status || 'pending', // pending, in_progress, completed, failed
            priority: data.priority || 'medium', // low, medium, high, urgent
            confidence: data.confidence || 1.0, // 0.0 to 1.0
            dependencies: data.dependencies || [],
            subtasks: [],
            parentId: data.parentId || null,
            createdTime: Date.now(),
            updatedTime: Date.now(),
            startTime: null,
            completedTime: null,
            dueDate: data.dueDate || null,
            estimatedTime: data.estimatedTime || null,
            actualTime: null,
            tags: data.tags || [],
            notes: [],
            results: {}, // To store outcomes
            context: data.context || {} // To store original query and other context
        };

        this.tasks.set(taskId, task);

        if (task.parentId && this.tasks.has(task.parentId)) {
            const parent = this.tasks.get(task.parentId);
            parent.subtasks.push(taskId);
        }

        await this.saveToStorage();
        this.notifyListeners('task_created', task);
        console.log(`[TaskManager] Created: "${task.title}"`);
        return task;
    }

    /**
     * Update an existing task.
     */
    async updateTask(taskId, updates) {
        const task = this.tasks.get(taskId);
        if (!task) throw new Error(`Task not found: ${taskId}`);

        const oldStatus = task.status;
        Object.assign(task, updates, { updatedTime: Date.now() });

        if (updates.status && updates.status !== oldStatus) {
            this.handleStatusChange(task, oldStatus);
        }

        await this.saveToStorage();
        this.notifyListeners('task_updated', task);
        return task;
    }

    /**
     * Handles the logic when a task's status changes.
     */
    handleStatusChange(task, oldStatus) {
        if (task.status === 'in_progress' && oldStatus !== 'in_progress') {
            task.startTime = Date.now();
            this.activeTask = task.id;
        } else if (task.status === 'completed' || task.status === 'failed') {
            task.completedTime = Date.now();
            if (this.activeTask === task.id) {
                this.activeTask = null;
            }
        }
    }

    /**
     * Delete a task and all its subtasks recursively.
     */
    async deleteTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) throw new Error(`Task not found: ${taskId}`);

        // Recursively delete subtasks
        for (const subtask_id of task.subtasks) {
            await this.deleteTask(subtask_id);
        }

        // Remove from parent's subtask list
        if (task.parentId && this.tasks.has(task.parentId)) {
            const parent = this.tasks.get(task.parentId);
            parent.subtasks = parent.subtasks.filter(id => id !== taskId);
        }

        this.tasks.delete(taskId);
        await this.saveToStorage();
        this.notifyListeners('task_deleted', task);
        console.log(`[TaskManager] Deleted: "${task.title}"`);
        return task;
    }

    /**
     * AI-driven function to break a main goal into subtasks using LLM intelligence.
     */
    async breakdownGoal(mainTask) {
        console.log(`[TaskManager] Breaking down goal: "${mainTask.title}"`);
        
        try {
            // Use AI to intelligently break down the task
            const subtasks = await this._aiDrivenTaskBreakdown(mainTask);
            
            // Enhanced breakdown note with metadata
            const breakdownNote = {
                id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                content: `Task broken down into ${subtasks.length} subtasks using AI-driven analysis (estimated time: ${subtasks.reduce((sum, t) => sum + (t.estimatedTime || 30), 0)}min)`,
                type: 'system',
                timestamp: Date.now(),
                metadata: {
                    method: 'ai-driven',
                    subtaskCount: subtasks.length,
                    totalEstimatedTime: subtasks.reduce((sum, t) => sum + (t.estimatedTime || 30), 0)
                }
            };
            
            mainTask.notes = mainTask.notes || [];
            mainTask.notes.push(breakdownNote);
            
            const totalEstimatedTime = subtasks.reduce((sum, t) => sum + (t.estimatedTime || 30), 0);
            const planOutline = subtasks.map(st => ({
                id: st.id,
                title: st.title,
                priority: st.priority,
                estimatedTime: st.estimatedTime
            }));
            const planOutlineHash = this._computePlanOutlineHash(planOutline);
            
            await this.updateTask(mainTask.id, {
                status: 'in_progress',
                estimatedTime: totalEstimatedTime,
                context: {
                    ...mainTask.context,
                    planOutlineHash,
                    breakdown: {
                        method: 'ai-driven',
                        subtaskCount: subtasks.length,
                        totalEstimatedTime: totalEstimatedTime
                    }
                }
            });

            this.notifyListeners('tasks_updated', { mainTask, subtasks });
            console.log(`[TaskManager] Created ${subtasks.length} subtasks for "${mainTask.title}" (${totalEstimatedTime}min estimated)`);
            return subtasks;
        } catch (error) {
            console.error('[TaskManager] AI-driven breakdown failed:', error);
            // Fallback to simple breakdown
            return await this._fallbackTaskBreakdown(mainTask);
        }
    }

    /**
     * AI-driven task breakdown using LLM intelligence
     */
    async _aiDrivenTaskBreakdown(mainTask) {
        // Use external TaskPlanner to generate plan (LLM-based)
        const { TaskPlanner } = await import('./task_planner.js');
        const planner = new TaskPlanner();

        try {
            const aiSubtasks = await planner.generatePlan(mainTask);

            // Validate and create actual subtasks
            const subtasks = [];

            // Ensure aiSubtasks is actually an array
            if (!Array.isArray(aiSubtasks)) {
                console.error('[TaskManager] Planner response is not an array:', aiSubtasks);
                throw new Error('Planner response must be a JSON array of tasks');
            }

            if (aiSubtasks.length === 0) {
                console.warn('[TaskManager] Planner returned empty task array');
                throw new Error('Planner returned no subtasks');
            }

            for (const [index, aiSubtask] of aiSubtasks.entries()) {
                // Validate required fields
                if (!aiSubtask.title) {
                    console.error(`[TaskManager] Subtask ${index} missing title:`, aiSubtask);
                    continue; // Skip invalid tasks
                }

                try {
                    const subtask = await this.createTask({
                        title: aiSubtask.title,
                        description: aiSubtask.description || '',
                        priority: aiSubtask.priority || 'medium',
                        parentId: mainTask.id,
                        listId: mainTask.listId,
                        dependencies: [],
                        estimatedTime: aiSubtask.estimatedTime || 30,
                        tags: ['ai-generated', 'subtask', 'ai-driven'],
                        context: {
                            ...mainTask.context,
                            method: 'ai-driven',
                            aiGenerated: true
                        }
                    });
                    subtasks.push(subtask);
                } catch (taskError) {
                    console.error(`[TaskManager] Failed to create subtask ${index}:`, taskError);
                    // Continue with other tasks even if one fails
                }
            }

            return subtasks;
        } catch (error) {
            console.error('[TaskManager] Planner failed:', error);
            throw error;
        }
    }

    /**
     * Fallback task breakdown when AI fails
     */
    async _fallbackTaskBreakdown(mainTask) {
        console.log('[TaskManager] Using fallback breakdown method');

        const contextClues = this._analyzeTaskContext(mainTask);

        // Domain-specific fallback (e.g., Tailwind + JS modules + ideas) before generic steps
        let steps = this._createDomainSpecificFallbackSteps(mainTask);
        if (!steps || steps.length === 0) {
            steps = this._createContextualGenericSteps(mainTask, contextClues);
        }

        const subtasks = [];
        let prevTaskId = null;

        for (const step of steps) {
            const baseTags = ['ai-generated', 'subtask', 'fallback'];
            const tags = Array.isArray(step.tags) ? [...baseTags, ...step.tags] : baseTags;

            const subtask = await this.createTask({
                title: step.title,
                description: step.description || '',
                priority: step.priority || 'medium',
                parentId: mainTask.id,
                listId: mainTask.listId,
                dependencies: [],
                estimatedTime: step.estimatedTime || 30,
                tags,
                context: {
                    ...mainTask.context,
                    method: 'fallback',
                    riskLevel: contextClues.riskLevel,
                    complexity: contextClues.complexity
                }
            });
            subtasks.push(subtask);
            
        }

        return subtasks;
    }

    /**
     * Analyze task context to provide better fallback patterns
     */
    _analyzeTaskContext(task) {
        const title = task.title.toLowerCase();
        const description = (task.description || '').toLowerCase();
        const combined = `${title} ${description}`;
        
        // Risk level analysis
        let riskLevel = 'low';
        if (combined.match(/delete|remove|drop|destroy|critical|production|live/)) {
            riskLevel = 'high';
        } else if (combined.match(/modify|change|update|edit|refactor/)) {
            riskLevel = 'medium';
        }
        
        // Complexity analysis
        let complexity = 'low';
        if (combined.match(/system|architecture|framework|integration|complex|advanced/)) {
            complexity = 'high';
        } else if (combined.match(/multiple|several|various|different|across/)) {
            complexity = 'medium';
        }
        
        return { riskLevel, complexity };
    }

    /**
     * Create contextual generic steps based on task analysis
     */
    _createContextualGenericSteps(task, contextClues) {
        const title = task.title.toLowerCase();
        const isFileOperation = title.includes('file') || title.includes('review all');
        const isUIOperation = title.includes('color') || title.includes('design') || title.includes('style') || title.includes('dashboard');
        const isCodeOperation = title.includes('code') || title.includes('implement') || title.includes('function');
        
        if (isUIOperation) {
            return [
                { title: 'Locate relevant style and design files', priority: 'high', description: 'Find CSS, HTML, and related files for the UI component', estimatedTime: 15 },
                { title: 'Analyze current design implementation', priority: 'high', description: 'Review existing styles and design patterns', estimatedTime: 20 },
                { title: 'Apply requested design changes', priority: 'high', description: 'Implement the specific design modifications', estimatedTime: 30 },
                { title: 'Test and verify visual changes', priority: 'medium', description: 'Ensure the design changes work correctly', estimatedTime: 15 }
            ];
        } else if (isFileOperation) {
            return [
                { title: 'Scan and identify relevant project files', priority: 'high', description: 'Locate all files related to the task', estimatedTime: 20 },
                { title: 'Analyze file contents and structure', priority: 'high', description: 'Review the code and understand the current implementation', estimatedTime: 30 },
                { title: 'Implement required changes', priority: 'high', description: 'Make the necessary modifications to the files', estimatedTime: 45 },
                { title: 'Validate changes work correctly', priority: 'medium', description: 'Test that all changes function as expected', estimatedTime: 15 }
            ];
        } else if (isCodeOperation) {
            return [
                { title: 'Understand code requirements', priority: 'high', description: 'Analyze what needs to be implemented', estimatedTime: 15 },
                { title: 'Design implementation approach', priority: 'high', description: 'Plan the code structure and logic', estimatedTime: 20 },
                { title: 'Write and implement code', priority: 'high', description: 'Create the required functionality', estimatedTime: 60 },
                { title: 'Test implementation', priority: 'medium', description: 'Verify the code works correctly', estimatedTime: 20 }
            ];
        } else {
            // True generic fallback
            return [
                { title: 'Analyze the task requirements', priority: 'high', description: 'Understand what needs to be done', estimatedTime: 15 },
                { title: 'Plan execution approach', priority: 'high', description: 'Determine the best way to accomplish the task', estimatedTime: 20 },
                { title: 'Execute the main task', priority: 'high', description: 'Perform the requested work', estimatedTime: 60 },
                { title: 'Verify completion', priority: 'medium', description: 'Ensure the task was completed successfully', estimatedTime: 10 }
            ];
        }
    }

    /**
     * Domain-specific fallback for common multi-intent prompts like:
     * "use tailwindcss, several .js, list 10 ideas to improve this project"
     */
    _createDomainSpecificFallbackSteps(task) {
        const text = `${task.title} ${task.description || ''}`.toLowerCase();
        const wantsTailwind =
            text.includes('tailwind');
        const wantsJsModules =
            text.includes('several .js') ||
            text.includes('multiple js') ||
            text.includes('create js') ||
            text.includes('scaffold') ||
            text.includes('modules');
        const wantsIdeas =
            text.includes('idea') ||
            text.includes('improve') ||
            text.includes('suggestion') ||
            text.includes('ideas');

        if (!(wantsTailwind || wantsJsModules || wantsIdeas)) {
            return null;
        }

        const steps = [];

        if (wantsTailwind) {
            steps.push({
                title: 'Inject Tailwind via CDN in frontend/index.html',
                description: 'Use read_file with include_line_numbers=true on frontend/index.html, then apply_diff to insert <script src="https://cdn.tailwindcss.com"></script> before </head>. Add a small utility usage (e.g., <div class="p-2 text-sm">Tailwind OK</div>) to verify.',
                priority: 'high',
                estimatedTime: 10
            });
        }

        if (wantsJsModules) {
            steps.push({
                title: 'Create JS modules under frontend/js/modules',
                description: 'Use create_file to create: frontend/js/modules/dom_utils.js, frontend/js/modules/api_client.js, frontend/js/modules/state_store.js. Each should export at least one function with placeholder implementation and JSDoc.',
                priority: 'high',
                estimatedTime: 15
            });
            steps.push({
                title: 'Link JS modules in index.html',
                description: 'Use read_file with include_line_numbers=true on frontend/index.html, then apply_diff to add <script type="module" src="js/modules/dom_utils.js"></script>, <script type="module" src="js/modules/api_client.js"></script>, and <script type="module" src="js/modules/state_store.js"></script> before </body>.',
                priority: 'medium',
                estimatedTime: 10
            });
        }

        if (wantsIdeas) {
            steps.push({
                title: 'Produce 10 concrete improvement ideas for this project',
                description: 'Advisory output: actionable enhancements across reliability, UX, performance, and developer experience.',
                priority: 'medium',
                estimatedTime: 10,
                tags: ['advisory']
            });
        }

        return steps;
    }

    /**
     * Find the next logical task for the AI to execute with intelligent prioritization.
     */
    getNextTask() {
        const pendingTasks = Array.from(this.tasks.values()).filter(t => t.status === 'pending');
        
        if (pendingTasks.length === 0) return null;
        
        // Enhanced sorting with multiple criteria
        const sortedTasks = pendingTasks.sort((a, b) => {
            const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
            const priorityA = priorityOrder[a.priority] || 0;
            const priorityB = priorityOrder[b.priority] || 0;
            
            // Primary: Priority
            if (priorityB !== priorityA) return priorityB - priorityA;
            
            // Secondary: Confidence (higher confidence first)
            const confidenceA = a.confidence || 0.5;
            const confidenceB = b.confidence || 0.5;
            if (confidenceB !== confidenceA) return confidenceB - confidenceA;
            
            // Tertiary: Risk level (lower risk first for equal priority)
            const riskOrder = { low: 1, medium: 2, high: 3 };
            const riskA = riskOrder[a.context?.riskLevel] || 2;
            const riskB = riskOrder[b.context?.riskLevel] || 2;
            if (riskA !== riskB) return riskA - riskB;
            
            // Quaternary: Creation time
            return a.createdTime - b.createdTime;
        });

        // Find the first task with all dependencies met
        for (const task of sortedTasks) {
            const deps = task.dependencies || [];
            const depsMet = deps.every(depId => {
                const depTask = this.tasks.get(depId);
                return depTask && depTask.status === 'completed';
            });

            if (depsMet) {
                // Check if task needs re-evaluation based on context changes
                if (this._shouldReEvaluateTask(task)) {
                    console.log(`[TaskManager] Task "${task.title}" needs re-evaluation`);
                    this._reEvaluateTask(task);
                }
                return task;
            }
        }
        return null;
    }

    /**
     * Check if a task should be re-evaluated based on execution context
     */
    _shouldReEvaluateTask(task) {
        if (!task.context) return false;
        
        // Re-evaluate if parent task has failed subtasks
        if (task.parentId) {
            const parent = this.tasks.get(task.parentId);
            if (parent) {
                const failedSiblings = parent.subtasks
                    .map(id => this.tasks.get(id))
                    .filter(t => t && t.status === 'failed');
                
                if (failedSiblings.length > 0) {
                    return true;
                }
            }
        }
        
        // Re-evaluate if task has been pending for too long
        const now = Date.now();
        const pendingTime = now - task.createdTime;
        const maxPendingTime = (task.estimatedTime || 30) * 60 * 1000 * 2; // 2x estimated time
        
        return pendingTime > maxPendingTime;
    }

    /**
     * Re-evaluate and potentially modify a task based on current context
     */
    async _reEvaluateTask(task) {
        const context = task.context || {};
        const updates = {};
        
        // Adjust priority based on failures
        if (task.parentId) {
            const parent = this.tasks.get(task.parentId);
            if (parent) {
                const failedSiblings = parent.subtasks
                    .map(id => this.tasks.get(id))
                    .filter(t => t && t.status === 'failed');
                
                if (failedSiblings.length > 0) {
                    // Increase priority if siblings have failed
                    const priorityOrder = { low: 'medium', medium: 'high', high: 'urgent' };
                    updates.priority = priorityOrder[task.priority] || task.priority;
                    
                    // Add note about re-evaluation
                    const note = {
                        id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        content: `Task re-evaluated due to ${failedSiblings.length} failed sibling task(s). Priority increased to ${updates.priority}.`,
                        type: 'system',
                        timestamp: Date.now()
                    };
                    
                    task.notes = task.notes || [];
                    task.notes.push(note);
                }
            }
        }
        
        if (Object.keys(updates).length > 0) {
            await this.updateTask(task.id, updates);
            console.log(`[TaskManager] Re-evaluated task "${task.title}":`, updates);
        }
    }

    /**
     * Dynamic re-planning: Analyze execution results and adapt the plan
     */
    async replanBasedOnResults(taskId, executionResult) {
        const task = this.tasks.get(taskId);
        if (!task || !task.parentId) return;
        
        const parent = this.tasks.get(task.parentId);
        if (!parent) return;
        
        console.log(`[TaskManager] Analyzing execution results for re-planning: ${task.title}`);
        
        // Analyze the execution result
        const analysis = this._analyzeExecutionResult(task, executionResult);
        
        if (analysis.shouldReplan) {
            console.log(`[TaskManager] Re-planning required for parent task: ${parent.title}`);
            
            // Get remaining subtasks
            const remainingSubtasks = parent.subtasks
                .map(id => this.tasks.get(id))
                .filter(t => t && t.status === 'pending');
            
            // Generate new subtasks based on the analysis
            const newSubtasks = await this._generateAdaptiveSubtasks(parent, analysis, remainingSubtasks);
            
            if (newSubtasks.length > 0) {
                // Add re-planning note to parent
                const replanNote = {
                    id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    content: `Plan adapted based on execution results. Added ${newSubtasks.length} new subtask(s). Reason: ${analysis.reason}`,
                    type: 'system',
                    timestamp: Date.now(),
                    metadata: {
                        triggerTask: taskId,
                        analysisReason: analysis.reason,
                        newSubtaskCount: newSubtasks.length
                    }
                };
                
                parent.notes = parent.notes || [];
                parent.notes.push(replanNote);
                
                await this.updateTask(parent.id, {
                    context: {
                        ...parent.context,
                        replanned: true,
                        replanCount: (parent.context?.replanCount || 0) + 1,
                        lastReplanReason: analysis.reason
                    }
                });
                
                this.notifyListeners('tasks_replanned', { parent, newSubtasks, analysis });
            }
        }
    }

    /**
     * Analyze execution results to determine if re-planning is needed
     */
    _analyzeExecutionResult(task, result) {
        const analysis = {
            shouldReplan: false,
            reason: '',
            confidence: 0.5,
            suggestedActions: []
        };
        
        // Check for error patterns that suggest need for re-planning
        if (result.error) {
            const errorMessage = result.error.toLowerCase();
            
            if (errorMessage.includes('file not found') || errorMessage.includes('path does not exist')) {
                analysis.shouldReplan = true;
                analysis.reason = 'File structure exploration needed';
                analysis.suggestedActions.push('Add file discovery subtask');
                analysis.confidence = 0.8;
            } else if (errorMessage.includes('permission denied') || errorMessage.includes('access denied')) {
                analysis.shouldReplan = true;
                analysis.reason = 'Permission issues detected';
                analysis.suggestedActions.push('Add permission verification subtask');
                analysis.confidence = 0.9;
            } else if (errorMessage.includes('dependency') || errorMessage.includes('import') || errorMessage.includes('module')) {
                analysis.shouldReplan = true;
                analysis.reason = 'Dependency issues detected';
                analysis.suggestedActions.push('Add dependency analysis subtask');
                analysis.confidence = 0.85;
            }
        }
        
        // Check for incomplete results
        if (result.incomplete || (result.message && result.message.includes('partial'))) {
            analysis.shouldReplan = true;
            analysis.reason = 'Task completed partially, additional steps needed';
            analysis.suggestedActions.push('Add completion verification subtask');
            analysis.confidence = 0.7;
        }
        
        return analysis;
    }

    /**
     * Generate adaptive subtasks based on execution analysis
     */
    async _generateAdaptiveSubtasks(parentTask, analysis, remainingSubtasks) {
        const newSubtasks = [];
        
        for (const action of analysis.suggestedActions) {
            let subtaskData = null;
            
            switch (action) {
                case 'Add file discovery subtask':
                    subtaskData = {
                        title: 'Discover and analyze file structure',
                        description: 'Explore the project structure to understand file organization and locate required files',
                        priority: 'high',
                        confidence: 0.9,
                        estimatedTime: 15,
                        tags: ['adaptive', 'file-discovery']
                    };
                    break;
                    
                case 'Add permission verification subtask':
                    subtaskData = {
                        title: 'Verify and resolve permission issues',
                        description: 'Check file permissions and resolve access issues',
                        priority: 'high',
                        confidence: 0.8,
                        estimatedTime: 10,
                        tags: ['adaptive', 'permissions']
                    };
                    break;
                    
                case 'Add dependency analysis subtask':
                    subtaskData = {
                        title: 'Analyze and resolve dependencies',
                        description: 'Review project dependencies and resolve import/module issues',
                        priority: 'high',
                        confidence: 0.85,
                        estimatedTime: 25,
                        tags: ['adaptive', 'dependencies']
                    };
                    break;
                    
                case 'Add completion verification subtask':
                    subtaskData = {
                        title: 'Verify task completion',
                        description: 'Ensure all aspects of the task have been properly completed',
                        priority: 'medium',
                        confidence: 0.9,
                        estimatedTime: 10,
                        tags: ['adaptive', 'verification']
                    };
                    break;
            }
            
            if (subtaskData) {
                // Insert before remaining subtasks
                const insertIndex = remainingSubtasks.length > 0 ?
                    parentTask.subtasks.indexOf(remainingSubtasks[0].id) :
                    parentTask.subtasks.length;
                
                const newSubtask = await this.createTask({
                    ...subtaskData,
                    parentId: parentTask.id,
                    listId: parentTask.listId,
                    context: {
                        ...parentTask.context,
                        adaptive: true,
                        generatedBy: analysis.reason,
                        insertIndex: insertIndex
                    }
                });
                
                // Insert into parent's subtask list at the correct position
                parentTask.subtasks.splice(insertIndex, 0, newSubtask.id);
                newSubtasks.push(newSubtask);
            }
        }
        
        return newSubtasks;
    }

    /**
     * Performance monitoring for task execution
     */
    getExecutionMetrics() {
        const allTasks = Array.from(this.tasks.values());
        const now = Date.now();
        
        const metrics = {
            totalTasks: allTasks.length,
            completionRate: 0,
            averageExecutionTime: 0,
            failureRate: 0,
            adaptiveTasksGenerated: 0,
            replanningEvents: 0,
            patternEffectiveness: {}
        };
        
        const completedTasks = allTasks.filter(t => t.status === 'completed');
        const failedTasks = allTasks.filter(t => t.status === 'failed');
        const adaptiveTasks = allTasks.filter(t => t.tags?.includes('adaptive'));
        
        metrics.completionRate = allTasks.length > 0 ? (completedTasks.length / allTasks.length) * 100 : 0;
        metrics.failureRate = allTasks.length > 0 ? (failedTasks.length / allTasks.length) * 100 : 0;
        metrics.adaptiveTasksGenerated = adaptiveTasks.length;
        
        // Calculate average execution time for completed tasks
        const executionTimes = completedTasks
            .filter(t => t.startTime && t.completedTime)
            .map(t => t.completedTime - t.startTime);
        
        if (executionTimes.length > 0) {
            metrics.averageExecutionTime = executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length;
        }
        
        // Count replanning events
        metrics.replanningEvents = allTasks.filter(t => t.context?.replanned).length;
        
        // Analyze pattern effectiveness
        const patternStats = {};
        allTasks.forEach(task => {
            const pattern = task.context?.patternUsed;
            if (pattern) {
                if (!patternStats[pattern]) {
                    patternStats[pattern] = { total: 0, completed: 0, failed: 0 };
                }
                patternStats[pattern].total++;
                if (task.status === 'completed') patternStats[pattern].completed++;
                if (task.status === 'failed') patternStats[pattern].failed++;
            }
        });
        
        // Calculate effectiveness percentages
        for (const [pattern, stats] of Object.entries(patternStats)) {
            metrics.patternEffectiveness[pattern] = {
                ...stats,
                successRate: stats.total > 0 ? (stats.completed / stats.total) * 100 : 0,
                failureRate: stats.total > 0 ? (stats.failed / stats.total) * 100 : 0
            };
        }
        
        return metrics;
    }
    
    /**
     * Hash plan outline to a compact fingerprint for drift detection and prompt references
     */
    _computePlanOutlineHash(planOutline) {
        try {
            const src = JSON.stringify(planOutline.map(i => ({ t: i.title, p: i.priority, e: i.estimatedTime })));
            return this._hashString(src);
        } catch (e) {
            return String(Date.now());
        }
    }

    _hashString(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
        }
        return (hash >>> 0).toString(36);
    }

    /**
     * Storage operations
     */
    async saveToStorage() {
        try {
            const data = {
                tasks: Array.from(this.tasks.entries()),
                lists: Array.from(this.lists.entries()),
                currentListId: this.currentListId,
            };
            await DbManager.saveSetting('taskManager_data', data);
        } catch (error) {
            console.error('[TaskManager] Save failed:', error);
        }
    }

    async loadFromStorage() {
        try {
            const data = await DbManager.getSetting('taskManager_data');
            if (!data) return;

            if (data.tasks) {
                this.tasks = new Map(data.tasks);
                // Ensure all tasks have required properties for backward compatibility
                for (const [taskId, task] of this.tasks) {
                    if (!task.tags) task.tags = [];
                    if (!task.notes) task.notes = [];
                    if (task.dueDate === undefined) task.dueDate = null;
                    if (task.estimatedTime === undefined) task.estimatedTime = null;
                    if (task.actualTime === undefined) task.actualTime = null;
                }
            }
            if (data.lists) this.lists = new Map(data.lists);
            if (data.currentListId) this.currentListId = data.currentListId;

            console.log(`[TaskManager] Loaded ${this.tasks.size} tasks and ${this.lists.size} lists.`);
        } catch (error) {
            console.error('[TaskManager] Load failed:', error);
        }
    }

    /**
     * Event listener management
     */
    addEventListener(callback) {
        this.listeners.push(callback);
    }

    removeEventListener(callback) {
        const index = this.listeners.indexOf(callback);
        if (index > -1) this.listeners.splice(index, 1);
    }

    notifyListeners(event, data) {
        this.listeners.forEach(callback => {
            try {
                callback(event, data);
            } catch (error) {
                console.error('[TaskManager] Listener error:', error);
            }
        });
    }

    // --- Getters for UI ---
    getAllTasks(listId = null) {
        const targetListId = listId || this.currentListId;
        return Array.from(this.tasks.values()).filter(t => t.listId === targetListId);
    }
    
    getAllLists() {
        return Array.from(this.lists.values());
    }

    /**
     * Get statistics for current tasks
     */
    getStats(listId = null) {
        const tasks = this.getAllTasks(listId);
        const now = Date.now();
        
        return {
            total: tasks.length,
            pending: tasks.filter(t => t.status === 'pending').length,
            in_progress: tasks.filter(t => t.status === 'in_progress').length,
            completed: tasks.filter(t => t.status === 'completed').length,
            failed: tasks.filter(t => t.status === 'failed').length,
            overdue: tasks.filter(t => t.dueDate && t.dueDate < now && t.status !== 'completed').length
        };
    }

    /**
     * Create a new list
     */
    async createList(data) {
        const listId = `list_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const list = {
            id: listId,
            name: data.name.trim(),
            description: (data.description || '').trim(),
            color: data.color || '#3498db',
            createdTime: Date.now(),
            updatedTime: Date.now()
        };

        this.lists.set(listId, list);
        await this.saveToStorage();
        this.notifyListeners('list_created', list);
        console.log(`[TaskManager] Created list: "${list.name}"`);
        return list;
    }

    /**
     * Set the current active list
     */
    async setCurrentList(listId) {
        if (!this.lists.has(listId)) {
            throw new Error(`List not found: ${listId}`);
        }
        
        this.currentListId = listId;
        await this.saveToStorage();
        this.notifyListeners('current_list_changed', { listId });
        console.log(`[TaskManager] Switched to list: ${listId}`);
    }

    /**
     * Add a note to a task
     */
    async addNote(taskId, content, type = 'user') {
        const task = this.tasks.get(taskId);
        if (!task) throw new Error(`Task not found: ${taskId}`);

        const note = {
            id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            content: content.trim(),
            type: type, // user, system, ai
            timestamp: Date.now()
        };

        if (!task.notes) task.notes = [];
        task.notes.push(note);
        task.updatedTime = Date.now();

        await this.saveToStorage();
        this.notifyListeners('task_updated', task);
        return note;
    }

    /**
     * Bulk update multiple tasks
     */
    async bulkUpdateTasks(taskIds, updates) {
        const updatedTasks = [];
        
        for (const taskId of taskIds) {
            const task = this.tasks.get(taskId);
            if (task) {
                const oldStatus = task.status;
                Object.assign(task, updates, { updatedTime: Date.now() });
                
                if (updates.status && updates.status !== oldStatus) {
                    this.handleStatusChange(task, oldStatus);
                }
                
                updatedTasks.push(task);
            }
        }

        await this.saveToStorage();
        this.notifyListeners('tasks_updated', updatedTasks);
        console.log(`[TaskManager] Bulk updated ${updatedTasks.length} tasks`);
        return updatedTasks;
    }

    /**
     * Bulk delete multiple tasks
     */
    async bulkDeleteTasks(taskIds) {
        const deletedTasks = [];
        
        for (const taskId of taskIds) {
            const task = this.tasks.get(taskId);
            if (task) {
                // Recursively delete subtasks
                for (const subtaskId of task.subtasks) {
                    await this.deleteTask(subtaskId);
                }

                // Remove from parent's subtask list
                if (task.parentId && this.tasks.has(task.parentId)) {
                    const parent = this.tasks.get(task.parentId);
                    parent.subtasks = parent.subtasks.filter(id => id !== taskId);
                }

                this.tasks.delete(taskId);
                deletedTasks.push(task);
            }
        }

        await this.saveToStorage();
        this.notifyListeners('tasks_deleted', deletedTasks);
        console.log(`[TaskManager] Bulk deleted ${deletedTasks.length} tasks`);
        return deletedTasks;
    }

    /**
     * Clears all pending and in-progress tasks.
     */
    async clearActiveTasks() {
        const activeTaskIds = Array.from(this.tasks.values())
            .filter(task => task.status === 'pending' || task.status === 'in_progress')
            .map(task => task.id);

        if (activeTaskIds.length > 0) {
            console.log(`[TaskManager] Clearing ${activeTaskIds.length} active tasks.`);
            await this.bulkDeleteTasks(activeTaskIds);
            this.notifyListeners('active_tasks_cleared', { count: activeTaskIds.length });
        }
    }
 
    /**
     * Export tasks in various formats
     */
    exportTasks(format = 'json', listId = null) {
        const tasks = this.getAllTasks(listId);
        
        if (format === 'json') {
            return JSON.stringify({
                exportDate: new Date().toISOString(),
                listId: listId || this.currentListId,
                tasks: tasks
            }, null, 2);
        } else if (format === 'markdown') {
            let md = `# Tasks Export\n\nExported on: ${new Date().toLocaleString()}\n\n`;
            
            const groupedTasks = {
                pending: tasks.filter(t => t.status === 'pending'),
                in_progress: tasks.filter(t => t.status === 'in_progress'),
                completed: tasks.filter(t => t.status === 'completed'),
                failed: tasks.filter(t => t.status === 'failed')
            };

            for (const [status, statusTasks] of Object.entries(groupedTasks)) {
                if (statusTasks.length > 0) {
                    md += `## ${status.replace('_', ' ').toUpperCase()}\n\n`;
                    
                    for (const task of statusTasks) {
                        const checkbox = status === 'completed' ? '[x]' : '[ ]';
                        md += `- ${checkbox} **${task.title}**\n`;
                        
                        if (task.description) {
                            md += `  ${task.description}\n`;
                        }
                        
                        const meta = [];
                        if (task.priority !== 'medium') meta.push(`Priority: ${task.priority}`);
                        if (task.dueDate) meta.push(`Due: ${new Date(task.dueDate).toLocaleDateString()}`);
                        if ((task.tags || []).length > 0) meta.push(`Tags: ${(task.tags || []).map(t => `#${t}`).join(' ')}`);
                        
                        if (meta.length > 0) {
                            md += `  *${meta.join(' • ')}*\n`;
                        }
                        
                        md += '\n';
                    }
                }
            }
            
            return md;
        }
        
        throw new Error(`Unsupported export format: ${format}`);
    }

    /**
     * Import tasks from various formats
     */
    async importTasks(data, format = 'json') {
        const importedTasks = [];
        
        if (format === 'json') {
            try {
                const parsed = JSON.parse(data);
                const tasks = parsed.tasks || parsed; // Handle both wrapped and direct arrays
                
                for (const taskData of tasks) {
                    // Generate new IDs to avoid conflicts
                    const newTask = {
                        ...taskData,
                        id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        listId: this.currentListId,
                        createdTime: Date.now(),
                        updatedTime: Date.now(),
                        parentId: null, // Reset parent relationships for now
                        subtasks: [],
                        notes: taskData.notes || []
                    };
                    
                    this.tasks.set(newTask.id, newTask);
                    importedTasks.push(newTask);
                }
            } catch (error) {
                throw new Error(`Invalid JSON format: ${error.message}`);
            }
        } else if (format === 'markdown') {
            // Basic markdown parsing - extract tasks from lines starting with - [ ] or - [x]
            const lines = data.split('\n');
            
            for (const line of lines) {
                const match = line.match(/^-\s*\[([ x])\]\s*(.+)$/i);
                if (match) {
                    const [, checked, title] = match;
                    const status = checked.toLowerCase() === 'x' ? 'completed' : 'pending';
                    
                    const newTask = await this.createTask({
                        title: title.trim(),
                        status: status,
                        priority: 'medium'
                    });
                    
                    importedTasks.push(newTask);
                }
            }
        } else {
            throw new Error(`Unsupported import format: ${format}`);
        }

        await this.saveToStorage();
        this.notifyListeners('tasks_imported', importedTasks);
        console.log(`[TaskManager] Imported ${importedTasks.length} tasks`);
        return importedTasks;
    }
}

// Create global instance
export const taskManager = new TaskManager();

// Export convenience methods for tool integration
export const TaskTools = {
    create: (data) => taskManager.createTask(data),
    update: (id, updates) => taskManager.updateTask(id, updates),
    delete: (id) => taskManager.deleteTask(id),
    breakdown: (task) => taskManager.breakdownGoal(task),
    getNext: () => taskManager.getNextTask(),
    getById: (id) => taskManager.tasks.get(id),
    getAll: (listId) => taskManager.getAllTasks(listId),
    replan: async (newTasks) => {
        for (const taskData of newTasks) {
            await taskManager.createTask(taskData);
        }
        return `Replanned and added ${newTasks.length} new tasks.`;
    },
    cleanupStale: () => taskManager.cleanupStaleTasks(),
    updateCleanupConfig: (config) => taskManager.updateCleanupConfig(config),
    startSession: async (taskId, options = {}) => {
        const task = taskManager.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task not found: ${taskId}`);
        }
        
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const session = {
            id: sessionId,
            taskId: taskId,
            description: options.description || '',
            startTime: Date.now(),
            endTime: null,
            duration: options.duration || null,
            active: true
        };
        
        // Store session in task context
        if (!task.context.sessions) {
            task.context.sessions = [];
        }
        task.context.sessions.push(session);
        
        // Update task status if not already in progress
        if (task.status !== 'in_progress') {
            await taskManager.updateTask(taskId, {
                status: 'in_progress',
                startTime: Date.now()
            });
        }
        
        // Add session note to task
        await taskManager.addNote(
            taskId,
            `Started work session${options.description ? `: ${options.description}` : ''}${options.duration ? ` (planned duration: ${options.duration} minutes)` : ''}`,
            'system'
        );
        
        console.log(`[TaskManager] Started session for task "${task.title}"`);
        
        await taskManager.saveToStorage();
        taskManager.notifyListeners('session_started', { taskId, session });
        
        return session;
    }
};
