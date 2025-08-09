/**
 * TaskOrchestrator
 * - Extracted from ChatService._handleTaskCreation
 * - Coordinates multi-step task execution with taskManager, using ChatService for LLM calls and helpers.
 *
 * Usage:
 *   await TaskOrchestrator.run({ chatService: this, userPrompt, chatMessages });
 */

import { taskManager } from '../task_manager.js';
import * as UI from '../ui.js';
import { DbManager } from '../db.js';

export const TaskOrchestrator = {
  /**
   * Run a complex, multi-step task flow.
   * @param {object} params
   * @param {any} params.chatService - Reference to ChatService instance to reuse helpers and state
   * @param {string} params.userPrompt - The user's initial task prompt
   * @param {HTMLElement} params.chatMessages - Chat UI container
   */
  async run({ chatService, userPrompt, chatMessages }) {
    // Clear previous tasks and create a main task
    await taskManager.clearActiveTasks();
    UI.appendMessage(chatMessages, `Task created: "${userPrompt}"`, 'ai');
    const mainTask = await taskManager.createTask({ title: userPrompt, priority: 'high' });

    // Seed conversation with task context
    chatService.currentHistory.push({ role: 'user', parts: [{ text: userPrompt }] });
    chatService.currentHistory.push({
      role: 'user',
      parts: [{ text: `The main task ID is ${mainTask.id}. Your first step is to call the "task_breakdown" tool with this ID.` }]
    });

    // Force initial breakdown (tool: task_breakdown)
    // If the model fails to call the tool, we fall back to internal breakdown to avoid empty plans.
    await chatService._performApiCall(chatService.currentHistory, chatMessages, { singleTurn: true, overrideMode: 'plan' });

    // Fallback: ensure we have subtasks to run
    try {
      const currentMain = taskManager.tasks.get(mainTask.id);
      if (!currentMain || !Array.isArray(currentMain.subtasks) || currentMain.subtasks.length === 0) {
        UI.appendMessage(chatMessages, 'No subtasks created by model. Using internal breakdown fallback...', 'ai');
        const created = await taskManager.breakdownGoal(mainTask);
        UI.appendMessage(chatMessages, `Added ${created.length} subtask(s) via internal breakdown.`, 'ai');
      }
    } catch (fallbackErr) {
      console.warn('[TaskOrchestrator] Fallback breakdown failed:', fallbackErr);
      // Last-resort advisory subtask so flow can produce value
      const advisory = await taskManager.createTask({
        title: 'Produce 10 concrete improvement ideas for this project',
        description: 'Cover TailwindCSS adoption (via CDN first), JS module scaffolding, and reliability fixes for the agent planning/execution.',
        priority: 'high',
        parentId: mainTask.id,
        listId: mainTask.listId,
        tags: ['fallback', 'advisory']
      });
      UI.appendMessage(chatMessages, `Created advisory subtask: "${advisory.title}"`, 'ai');
    }

    let nextTask = taskManager.getNextTask();
    let executionAttempts = 0;
    const maxExecutionAttempts = 10;

    while (nextTask && !chatService.isCancelled && executionAttempts < maxExecutionAttempts) {
      executionAttempts++;
      UI.appendMessage(chatMessages, `Executing subtask ${executionAttempts}: "${nextTask.title}"`, 'ai');
      await taskManager.updateTask(nextTask.id, { status: 'in_progress' });

      const contextInfo = chatService._buildTaskContext(nextTask);
      const toolHints = TaskOrchestrator._buildToolHints(nextTask);
      const prompt = `Current subtask: "${nextTask.title}"${nextTask.description ? ` - ${nextTask.description}` : ''}.
Context: ${contextInfo}${toolHints ? `

Helpful tool hints:
${toolHints}` : ''}
Execute this task step by step using available tools if needed.
Task ID: ${nextTask.id}.
When the work is finished, stop. The system will mark the task as completed.`;
      
      chatService.currentHistory.push({ role: 'user', parts: [{ text: prompt }] });

      let executionResult = null;
      try {
        const startTime = Date.now();
        await chatService._performApiCall(chatService.currentHistory, chatMessages, { singleTurn: false });
        const endTime = Date.now();
        const updatedTask = taskManager.tasks.get(nextTask.id);
        if (updatedTask && updatedTask.status === 'in_progress') {
          await taskManager.updateTask(nextTask.id, {
            status: 'completed',
            results: { completedAutomatically: true, timestamp: Date.now(), executionTime: endTime - startTime }
          });
          executionResult = { success: true, executionTime: endTime - startTime };
        } else {
          executionResult = {
            success: updatedTask?.status === 'completed',
            status: updatedTask?.status,
            results: updatedTask?.results
          };
        }
      } catch (error) {
        console.error(`[TaskOrchestrator] Error executing task ${nextTask.id}:`, error);
        const errorAnalysis = chatService._analyzeTaskError(nextTask, error);
        executionResult = { error: error.message, timestamp: Date.now(), analysis: errorAnalysis };
        if (errorAnalysis.canRecover && errorAnalysis.retryCount < 2) {
          UI.appendMessage(chatMessages, `Task "${nextTask.title}" encountered an error. Attempting recovery...`, 'ai');
          await taskManager.updateTask(nextTask.id, {
            status: 'pending',
            context: {
              ...nextTask.context,
              errorHistory: [...(nextTask.context?.errorHistory || []), {
                error: error.message, timestamp: Date.now(), retryCount: errorAnalysis.retryCount + 1
              }]
            }
          });
          await taskManager.replanBasedOnResults(nextTask.id, executionResult);
        } else {
          await taskManager.updateTask(nextTask.id, { status: 'failed', results: executionResult });
          UI.appendMessage(chatMessages, `Task "${nextTask.title}" failed after recovery attempts: ${error.message}`, 'ai');
          await taskManager.replanBasedOnResults(nextTask.id, executionResult);
        }
      }

      if (executionResult && !executionResult.error) {
        await taskManager.replanBasedOnResults(nextTask.id, executionResult);
      }

      nextTask = taskManager.getNextTask();
      if (nextTask && nextTask.status === 'failed' && executionAttempts > 3) {
        console.warn(`[TaskOrchestrator] Breaking execution loop - repeated failed task: ${nextTask.title}`);
        break;
      }
    }

    if (executionAttempts >= maxExecutionAttempts) {
      UI.appendMessage(chatMessages, 'Execution stopped: Maximum attempts reached.', 'ai');
    }

    if (chatService.isCancelled) {
      UI.appendMessage(chatMessages, 'Execution cancelled by user.', 'ai');
      await taskManager.updateTask(mainTask.id, { status: 'failed', results: { cancelled: true, timestamp: Date.now() } });
    } else {
      const allSubtasks = mainTask.subtasks.map(id => taskManager.tasks.get(id)).filter(Boolean);
      const completedSubtasks = allSubtasks.filter(t => t.status === 'completed');
      const failedSubtasks = allSubtasks.filter(t => t.status === 'failed');

      if (allSubtasks.length === 0) {
        await taskManager.updateTask(mainTask.id, {
          status: 'failed',
          results: { reason: 'no_subtasks_planned', timestamp: Date.now() }
        });
        UI.appendMessage(chatMessages, `Main task "${mainTask.title}" could not proceed: no subtasks were planned. A fallback breakdown will be used next time to prevent this.`, 'ai');
      } else if (failedSubtasks.length > 0) {
        await taskManager.updateTask(mainTask.id, {
          status: 'failed',
          results: { completedSubtasks: completedSubtasks.length, failedSubtasks: failedSubtasks.length, timestamp: Date.now() }
        });
        UI.appendMessage(chatMessages, `Main task "${mainTask.title}" partially completed. ${completedSubtasks.length}/${allSubtasks.length} subtasks successful.`, 'ai');
      } else {
        await taskManager.updateTask(mainTask.id, {
          status: 'completed',
          results: { completedSubtasks: completedSubtasks.length, timestamp: Date.now() }
        });
        UI.appendMessage(chatMessages, `Main task "${mainTask.title}" completed successfully! All ${completedSubtasks.length} subtasks finished.`, 'ai');
      }
    }

    await DbManager.saveChatHistory(chatService.currentHistory);
  },

  /**
   * Provide deterministic tool usage hints for common patterns to increase reliability.
   * Returns a bullet list string or empty string.
   */
  _buildToolHints(task) {
    try {
      const text = `${task.title} ${task.description || ''}`.toLowerCase();
      const hints = [];

      if (text.includes('tailwind')) {
        hints.push(
          '- To add Tailwind via CDN, edit frontend/index.html: use read_file with include_line_numbers=true, then apply_diff to insert <script src="https://cdn.tailwindcss.com"></script> right before </head>. Optionally add a small utility class (e.g., <div class="p-2">) to verify styling.'
        );
      }

      const wantsModules =
        text.includes('several .js') ||
        text.includes('multiple js') ||
        text.includes('scaffold') ||
        text.includes('create js') ||
        text.includes('create file') ||
        text.includes('modules');
      if (wantsModules) {
        hints.push(
          '- Use create_file to scaffold modules under frontend/js/modules/: dom_utils.js, api_client.js, state_store.js. Each should export at least one function.'
        );
        hints.push(
          '- After creating files, update frontend/index.html: use read_file with include_line_numbers=true and apply_diff to add <script src="js/modules/dom_utils.js"></script> etc. before </body>.'
        );
      }

      if (text.includes('idea') || text.includes('improve') || text.includes('suggestion')) {
        hints.push(
          '- No tools required. Produce 10 concrete improvement ideas with short justifications.'
        );
      }

      return hints.length ? hints.join('\n') : '';
    } catch (_) {
      return '';
    }
  }
};