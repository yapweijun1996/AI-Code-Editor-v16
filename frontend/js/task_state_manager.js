/**
 * TaskStateManager - Execution context and lifecycle tracking for a main task and its subtasks.
 * Built on top of the generic StateManager to provide task-focused helpers.
 */

import { StateManager } from './core/state_manager.js';

export class TaskStateManager extends StateManager {
  constructor() {
    super();
    this.reset({
      mainTaskId: null,
      createdAt: null,
      completedAt: null,
      metrics: {
        totalSubtasks: 0,
        completed: 0,
        failed: 0,
        in_progress: 0,
        pending: 0,
        totalAttempts: 0
      },
      subtasks: {
        // [taskId]: { status, attempts, lastError, errorHistory: [], results: {}, timestamps: { created, started, completed } }
      },
      notes: []
    });
  }

  initialize(mainTask) {
    const initial = {
      mainTaskId: mainTask?.id || null,
      createdAt: Date.now(),
      completedAt: null,
      metrics: {
        totalSubtasks: 0,
        completed: 0,
        failed: 0,
        in_progress: 0,
        pending: 0,
        totalAttempts: 0
      },
      subtasks: {},
      notes: []
    };
    this.reset(initial);
    return this.getState();
  }

  registerSubtasks(subtaskIds = []) {
    if (!Array.isArray(subtaskIds)) return;
    this.setState(state => {
      const next = { ...state };
      for (const id of subtaskIds) {
        if (!next.subtasks[id]) {
          next.subtasks[id] = {
            status: 'pending',
            attempts: 0,
            lastError: null,
            errorHistory: [],
            results: {},
            timestamps: { created: Date.now(), started: null, completed: null }
          };
          next.metrics.pending += 1;
          next.metrics.totalSubtasks += 1;
        }
      }
      return next;
    }, { action: 'register_subtasks' });
  }

  setSubtaskStatus(taskId, status, extra = {}) {
    if (!taskId) return;
    const valid = ['pending', 'in_progress', 'completed', 'failed'];
    const newStatus = valid.includes(status) ? status : 'pending';

    this.setState(state => {
      const next = { ...state };
      if (!next.subtasks[taskId]) {
        next.subtasks[taskId] = {
          status: 'pending',
          attempts: 0,
          lastError: null,
          errorHistory: [],
          results: {},
          timestamps: { created: Date.now(), started: null, completed: null }
        };
        next.metrics.pending += 1;
        next.metrics.totalSubtasks += 1;
      }

      const prevStatus = next.subtasks[taskId].status;
      if (prevStatus !== newStatus) {
        // Adjust metrics counters
        if (prevStatus && next.metrics[prevStatus] !== undefined) {
          next.metrics[prevStatus] = Math.max(0, next.metrics[prevStatus] - 1);
        }
        if (next.metrics[newStatus] !== undefined) {
          next.metrics[newStatus] += 1;
        }

        // Update timestamps
        if (newStatus === 'in_progress') {
          next.subtasks[taskId].timestamps.started = Date.now();
        }
        if (newStatus === 'completed' || newStatus === 'failed') {
          next.subtasks[taskId].timestamps.completed = Date.now();
        }

        next.subtasks[taskId].status = newStatus;
      }

      if (extra?.results) {
        next.subtasks[taskId].results = { ...(next.subtasks[taskId].results || {}), ...extra.results };
      }
      if (extra?.note) {
        next.notes.push({ t: Date.now(), taskId, note: String(extra.note) });
      }

      return next;
    }, { action: 'set_subtask_status', taskId, status: newStatus });
  }

  incrementAttempt(taskId) {
    if (!taskId) return;
    this.setState(state => {
      const next = { ...state };
      if (!next.subtasks[taskId]) return state;
      next.subtasks[taskId].attempts += 1;
      next.metrics.totalAttempts += 1;
      return next;
    }, { action: 'increment_attempt', taskId });
  }

  recordError(taskId, error) {
    if (!taskId) return;
    const errInfo = typeof error === 'string' ? { message: error } : (error || {});
    this.setState(state => {
      const next = { ...state };
      if (!next.subtasks[taskId]) return state;
      const entry = {
        t: Date.now(),
        message: errInfo.message || 'Unknown error',
        stack: errInfo.stack || null,
        details: errInfo.details || null
      };
      next.subtasks[taskId].lastError = entry;
      next.subtasks[taskId].errorHistory.push(entry);
      return next;
    }, { action: 'record_error', taskId });
  }

  finalize() {
    this.setState({ completedAt: Date.now() }, { action: 'finalize' });
    return this.getSummary();
  }

  getSummary() {
    const s = this.getState();
    const durationMs = (s.completedAt || Date.now()) - (s.createdAt || Date.now());
    return {
      mainTaskId: s.mainTaskId,
      duration_ms: durationMs,
      metrics: { ...s.metrics },
      totals: {
        subtasks: s.metrics.totalSubtasks,
        completed: s.metrics.completed,
        failed: s.metrics.failed
      }
    };
  }
}