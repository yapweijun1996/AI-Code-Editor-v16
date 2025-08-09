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

    // Force initial breakdown
    await chatService._performApiCall(chatService.currentHistory, chatMessages, { singleTurn: true });

    let nextTask = taskManager.getNextTask();
    let executionAttempts = 0;
    const maxExecutionAttempts = 10;

    while (nextTask && !chatService.isCancelled && executionAttempts < maxExecutionAttempts) {
      executionAttempts++;
      UI.appendMessage(chatMessages, `Executing subtask ${executionAttempts}: "${nextTask.title}"`, 'ai');
      await taskManager.updateTask(nextTask.id, { status: 'in_progress' });

      const contextInfo = chatService._buildTaskContext(nextTask);
      const prompt = `Current subtask: "${nextTask.title}"${nextTask.description ? ` - ${nextTask.description}` : ''}.
Context: ${contextInfo}
Execute this task step by step. When completed, call the task_update tool to mark it as completed. Task ID: ${nextTask.id}`;

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
      if (failedSubtasks.length > 0) {
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
  }
};