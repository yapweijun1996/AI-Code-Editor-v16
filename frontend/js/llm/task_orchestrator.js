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
import { TaskStateManager } from '../task_state_manager.js';
import { OutputEvaluator } from './output_evaluator.js';
import { SubjectExtractor } from './subject_extractor.js';

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
    const tsm = new TaskStateManager();
    tsm.initialize(mainTask);

    // Seed conversation with task context
    // Use internal AI-driven breakdown directly (no global chat-history usage)
    chatService.activePlan = { id: mainTask.id };
    try {
      const created = await taskManager.breakdownGoal(mainTask);
      UI.appendMessage(chatMessages, `Planned ${created.length} subtask(s).`, 'ai');
      try { tsm.registerSubtasks(created.map(t => t.id)); } catch (e) { console.warn('[TaskOrchestrator] State registration failed:', e.message); }
    } catch (fallbackErr) {
      console.warn('[TaskOrchestrator] Internal breakdown failed:', fallbackErr);
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
    let lastExecutedTaskId = null;
    let stallCounter = 0;
    const maxStalls = 3;

    while (nextTask && !chatService.isCancelled && executionAttempts < maxExecutionAttempts) {
        executionAttempts++;

        // --- Stall Detection ---
        if (lastExecutedTaskId === nextTask.id) {
            stallCounter++;
        } else {
            stallCounter = 0;
        }
        lastExecutedTaskId = nextTask.id;

        if (stallCounter >= maxStalls) {
            UI.appendMessage(chatMessages, `Execution stalled: Task "${nextTask.title}" was repeated without progress. Forcing failure to encourage a new approach.`, 'ai');
            await taskManager.updateTask(nextTask.id, { status: 'failed', results: { reason: 'execution_stalled', timestamp: Date.now() } });
            try { tsm.setSubtaskStatus(nextTask.id, 'failed', { note: 'Execution stalled' }); } catch (e) { console.warn('[TaskOrchestrator] State update (stalled) failed:', e.message); }
            nextTask = taskManager.getNextTask();
            continue; // Skip to the next iteration
        }
        // --- End Stall Detection ---

        UI.appendMessage(chatMessages, `Executing subtask ${executionAttempts}: "${nextTask.title}"`, 'ai');
        await taskManager.updateTask(nextTask.id, { status: 'in_progress' });
        try { tsm.setSubtaskStatus(nextTask.id, 'in_progress'); } catch (e) { console.warn('[TaskOrchestrator] State update (in_progress) failed:', e.message); }

      const contextInfo = chatService._buildTaskContext(nextTask);
      const rawHints = TaskOrchestrator._buildToolHints(nextTask);
      const limitedHints = TaskOrchestrator._limitHints(rawHints);

      // Build compact system prompt context using slots to reduce token usage
      const planOutlineHash =
        (taskManager.tasks.get(mainTask.id)?.context?.planOutlineHash) ||
        (mainTask.context?.planOutlineHash) ||
        '';

      // Build baseline prompt context from TaskManager to include cross-task artifacts and guidance
      const basePromptContext = (() => {
        try {
          return taskManager.buildPromptContext(nextTask.id, { tools_context: limitedHints });
        } catch (e) {
          console.warn('[TaskOrchestrator] buildPromptContext failed; falling back to local slots:', e.message);
          return { slots: {} };
        }
      })();

      // Merge our overlays (task summary/current focus/plan hash) with the baseline that already
      // includes available_artifacts and execution_guidance from TaskManager.
      const promptContext = {
        ...(basePromptContext || {}),
        compact: true,
        slots: {
          ...(basePromptContext?.slots || {}),
          task_summary: `Main Task: ${mainTask.title}`,
          plan_outline_hash: planOutlineHash,
          current_focus: `Subtask: ${nextTask.title}${nextTask.description ? ' - ' + nextTask.description : ''}`,
          // Prefer explicit hints, fallback to any pre-filled tools_context from base
          tools_context: limitedHints || basePromptContext?.slots?.tools_context || ''
        }
      };

      const prompt = `Current subtask: "${nextTask.title}"${nextTask.description ? ` - ${nextTask.description}` : ''}.
Context: ${contextInfo}
Execute this task using available tools if needed. Provide only the necessary steps.
Stop when the work is finished.`;
      
      const ephemeralHistory = [{ role: 'user', parts: [{ text: prompt }] }];

      let executionResult = null;
      try {
        const startTime = Date.now();
        await chatService._performApiCall(ephemeralHistory, chatMessages, { singleTurn: false, promptContext });
        const endTime = Date.now();

        // Refresh task state after model/tool calls
        const updatedTask = taskManager.tasks.get(nextTask.id);

        // Determine whether this subtask actually produced reusable outputs
        const { producedValue, nextStepHint } = OutputEvaluator.evaluate(updatedTask);

        // Only auto-complete if tangible outputs exist or the tool explicitly set status
        if (updatedTask && updatedTask.status === 'in_progress') {
          if (producedValue) {
            await taskManager.updateTask(nextTask.id, {
              status: 'completed',
              results: {
                ...(updatedTask.results || {}),
                completedAutomatically: true,
                timestamp: Date.now(),
                executionTime: endTime - startTime
              }
            });
            try { tsm.setSubtaskStatus(nextTask.id, 'completed', { results: { completedAutomatically: true, executionTime: endTime - startTime } }); } catch (e) { console.warn('[TaskOrchestrator] State update (completed) failed:', e.message); }
            executionResult = { success: true, executionTime: endTime - startTime, producedValue: true };
          } else {
            // No tangible outputs produced; do not claim completion
            await taskManager.updateTask(nextTask.id, {
              status: 'pending',
              results: {
                ...(updatedTask.results || {}),
                needsMoreInfo: true,
                reason: 'no_artifacts_or_summary',
                timestamp: Date.now()
              },
              context: {
                ...updatedTask.context,
                reuseHint: 'Check Available Artifacts first; only call tools to fill specific gaps.'
              }
            });
            try { tsm.setSubtaskStatus(nextTask.id, 'pending', { note: 'No tangible outputs produced; will re-queue' }); } catch (e) { console.warn('[TaskOrchestrator] State update (pending) failed:', e.message); }
            executionResult = { success: false, producedValue: false, reason: 'no_outputs' };

            // Auto-advance: if this subtask is an inventory/inspection and produced no outputs,
            // enqueue a targeted web research subtask (once) to avoid repeated inventory loops.
            try {
              const isInventoryTask = /(^|\s)(inventory|inspect|audit)(\s|$)/i.test(nextTask.title || '') || (nextTask.tags || []).includes('inventory');
              if (isInventoryTask && nextStepHint !== 'proceed') {
                const mainTaskContext = taskManager.tasks.get(mainTask.id)?.context || {};
                
                if (!mainTaskContext.autoQueuedWebResearch) {
                  const subject = SubjectExtractor.extract(mainTask.title);
                  if (subject) {
                    const researchTask = await taskManager.createTask({
                      title: `Perform targeted web research for "${subject}"`,
                      description: `The initial local inventory check for "${nextTask.title}" found no relevant artifacts. This task is to perform a web search to find external information, profiles, or repositories related to the main goal.`,
                      priority: 'high',
                      parentId: mainTask.id,
                      listId: mainTask.listId,
                      tags: ['auto', 'web_research']
                    });
                    
                    await taskManager.updateTask(mainTask.id, {
                      context: { ...mainTaskContext, autoQueuedWebResearch: true }
                    });

                    UI.appendMessage(chatMessages, `Queued new subtask: "${researchTask.title}"`, 'ai');
                  }
                }
              }
            } catch (autoQueueErr) {
              console.warn('[TaskOrchestrator] Auto-queue web research failed:', autoQueueErr?.message || autoQueueErr);
            }
          }
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

        // Task state tracking
        try { tsm.recordError(nextTask.id, error); } catch (e) { console.warn('[TaskOrchestrator] State error record failed:', e.message); }
        try { tsm.incrementAttempt(nextTask.id); } catch (e) { console.warn('[TaskOrchestrator] State attempt increment failed:', e.message); }

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
          try { tsm.setSubtaskStatus(nextTask.id, 'pending', { note: 'recoverable error, will retry' }); } catch (e) { console.warn('[TaskOrchestrator] State update (pending) failed:', e.message); }
          await taskManager.replanBasedOnResults(nextTask.id, executionResult);
        } else {
          await taskManager.updateTask(nextTask.id, { status: 'failed', results: executionResult });
          try { tsm.setSubtaskStatus(nextTask.id, 'failed', { note: error.message }); } catch (e) { console.warn('[TaskOrchestrator] State update (failed) failed:', e.message); }
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
        await taskManager.updateTask(mainTask.id, {
            status: 'failed',
            results: { reason: 'max_attempts_reached', timestamp: Date.now() }
        });
    } else if (chatService.isCancelled) {
        UI.appendMessage(chatMessages, 'Execution cancelled by user.', 'ai');
        await taskManager.updateTask(mainTask.id, { status: 'failed', results: { cancelled: true, timestamp: Date.now() } });
    } else {
        const allSubtasks = mainTask.subtasks.map(id => taskManager.tasks.get(id)).filter(Boolean);
        const completedSubtasks = allSubtasks.filter(t => t.status === 'completed');
        const failedSubtasks = allSubtasks.filter(t => t.status === 'failed');

        // Finalize state tracking and add execution summary note
        try {
            const summary = tsm.finalize();
            await taskManager.addNote(
                mainTask.id,
                `Execution summary: completed=${summary.metrics.completed}, failed=${summary.metrics.failed}, attempts=${summary.metrics.totalAttempts}`,
                'system'
            );
        } catch (e) {
            console.warn('[TaskOrchestrator] Could not add execution summary note:', e.message);
        }

        if (allSubtasks.length === 0) {
            await taskManager.updateTask(mainTask.id, {
                status: 'failed',
                results: { reason: 'no_subtasks_planned', timestamp: Date.now() }
            });
            UI.appendMessage(chatMessages, `Main task "${mainTask.title}" could not proceed: no subtasks were planned. A fallback breakdown will be used next time to prevent this.`, 'ai');
        } else if (failedSubtasks.length > 0 || completedSubtasks.length === 0) {
            // If any subtask failed OR if no subtasks were completed, the main task has failed.
            await taskManager.updateTask(mainTask.id, {
                status: 'failed',
                results: { completedSubtasks: completedSubtasks.length, failedSubtasks: failedSubtasks.length, timestamp: Date.now() }
            });
            UI.appendMessage(chatMessages, `Main task "${mainTask.title}" failed. ${completedSubtasks.length}/${allSubtasks.length} subtasks completed.`, 'ai');
        } else {
            await taskManager.updateTask(mainTask.id, {
                status: 'completed',
                results: { completedSubtasks: completedSubtasks.length, timestamp: Date.now() }
            });
            UI.appendMessage(chatMessages, `Main task "${mainTask.title}" completed successfully! All ${completedSubtasks.length} subtasks finished.`, 'ai');
        }
    }

    await DbManager.saveChatHistory(chatService.currentHistory);
    chatService.activePlan = null;
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
  },

  _limitHints(hintsText) {
    try {
      if (!hintsText) return '';
      const lines = hintsText.split('\n').filter(l => l.trim().startsWith('-'));
      const top2 = lines.slice(0, 2).join('\n');
      return top2.length > 220 ? `${top2.slice(0, 217)}...` : top2;
    } catch (_) {
      return '';
    }
  }
};