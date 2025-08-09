/**
 * RetryPolicy
 * - Exponential backoff with jitter and attempt limits.
 * - Provides a simple execute() helper to wrap async operations.
 */

import { ErrorPolicy } from './error_policy.js';

export const RetryPolicy = {
  defaultOptions: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 12000, multiplier: 2, jitter: 'full' },

  getOptions(provider, overrides) { 
    return { ...this.defaultOptions, ...(overrides || {}) };
  },

  computeDelay(attempt, prevDelay = null, options = this.defaultOptions) {
    const base = options.baseDelayMs;
    const mult = options.multiplier;
    const max = options.maxDelayMs;
    let delay = Math.min(max, Math.round(base * Math.pow(mult, Math.max(0, attempt - 1))));
    switch (options.jitter) {
      case 'none':
        break;
      case 'full':
        delay = Math.round(Math.random() * delay);
        break;
      case 'equal':
        delay = Math.round(delay / 2 + Math.random() * (delay / 2));
        break;
      case 'decorrelated': {
        const prev = prevDelay ?? base;
        const min = base;
        const maxRange = Math.max(min + 1, Math.round(prev * mult));
        const r = min + Math.random() * (maxRange - min);
        delay = Math.min(max, Math.round(r));
        break;
      }
      default:
        delay = Math.round(Math.random() * delay);
    }
    return Math.max(0, delay);
  },

  async execute(fn, provider, options = {}, onAttempt) {
    const opt = this.getOptions(provider, options);
    let attempt = 0;
    let prevDelay = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt++;
      try {
        if (onAttempt) {
          try { await onAttempt({ attempt, options: opt }); } catch (_) {}
        }
        return await fn(attempt);
      } catch (err) {
        const classification = ErrorPolicy.classify(provider, err);
        const canRetry = classification.retryable && attempt < opt.maxAttempts;
        if (!canRetry) {
          throw err;
        }
        const delay = this.computeDelay(attempt, prevDelay, opt);
        prevDelay = delay;
        await this.sleep(delay);
      }
    }
  },

  sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
};

export async function runWithRetries(fn, provider, options = {}, onAttempt) {
  return RetryPolicy.execute(fn, provider, options, onAttempt);
}