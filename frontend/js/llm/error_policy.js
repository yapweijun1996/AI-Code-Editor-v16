/**
 * ErrorPolicy
 * - Classifies provider errors into categories and determines retryability.
 * - Normalizes heterogeneous error shapes (HTTP Responses, Fetch errors, SDK errors, etc.).
 *
 * Usage:
 *   import { ErrorPolicy } from './error_policy.js';
 *   const classification = ErrorPolicy.classify('gemini', err);
 *   if (classification.retryable) { ... }
 */

export const ErrorPolicy = {
  /**
   * Classify an error into a normalized shape.
   * @param {('gemini'|'openai'|'ollama'|string)} provider
   * @param {any} error
   * @returns {{
   *   provider: string,
   *   retryable: boolean,
   *   type: 'rate_limit'|'auth'|'quota'|'network'|'timeout'|'server'|'stream_parse'|'abort'|'client'|'unknown',
   *   httpStatus?: number,
   *   reason: string,
   *   raw?: any
   * }}
   */
  classify(provider, error) {
    const info = _extractErrorInfo(error);
    const p = String(provider || '').toLowerCase();

    // Heuristics by content
    const msg = info.messageLower;
    const status = info.httpStatus;

    // Abort
    if (info.isAbort || msg.includes('request aborted') || msg.includes('aborted')) {
      return _result(p, false, 'abort', status, 'Request aborted by caller/user', error);
    }

    // Timeout
    if (info.isTimeout || msg.includes('timeout')) {
      return _result(p, true, 'timeout', status, 'Operation timed out', error);
    }

    // Rate limit / quota
    if (status === 429 || msg.includes('rate limit') || msg.includes('quota') || msg.includes('exceeded')) {
      return _result(p, true, 'rate_limit', status, 'Rate limited or quota exceeded', error);
    }

    // Auth / key errors
    if (status === 401 || status === 403 ||
        msg.includes('unauthorized') || msg.includes('forbidden') ||
        msg.includes('invalid api key') || msg.includes('api key')) {
      // Retryable if multiple keys available (caller may rotate); otherwise not
      // Here we mark as retryable true to allow rotation policy to decide; callers can override.
      return _result(p, true, 'auth', status, 'Authentication/authorization error (likely bad/expired key)', error);
    }

    // Server overload / 5xx
    if ((status && status >= 500) ||
        msg.includes('service unavailable') || msg.includes('overloaded') || msg.includes('server error')) {
      return _result(p, true, 'server', status, 'Server-side error or overload', error);
    }

    // Network errors
    if (msg.includes('network') || msg.includes('failed to fetch') || msg.includes('connection')) {
      return _result(p, true, 'network', status, 'Network connectivity failure', error);
    }

    // Streaming/parse errors (often transient)
    if (msg.includes('failed to parse stream') ||
        msg.includes('stream error') ||
        msg.includes('parsing error') ||
        msg.includes('malformed response')) {
      return _result(p, true, 'stream_parse', status, 'Streaming/parse error (often transient)', error);
    }

    // Client errors (4xx except auth/rate)
    if (status && status >= 400 && status < 500) {
      return _result(p, false, 'client', status, `Client error ${status}`, error);
    }

    // Default unknown - conservatively retryable false
    return _result(p, false, 'unknown', status, info.message || 'Unknown error', error);
  },

  /**
   * True if error is retryable per policy.
   * @param {('gemini'|'openai'|'ollama'|string)} provider
   * @param {any} error
   * @returns {boolean}
   */
  isRetryable(provider, error) {
    const c = this.classify(provider, error);
    return c.retryable;
  }
};

// Helpers

function _result(provider, retryable, type, httpStatus, reason, raw) {
  return { provider, retryable, type, httpStatus, reason, raw };
}

function _extractErrorInfo(error) {
  // Normalize different error shapes
  let message = '';
  let httpStatus;

  // Fetch Response-like
  if (error && typeof error === 'object' && 'ok' in error && 'status' in error && 'statusText' in error) {
    httpStatus = Number(error.status);
    message = `${error.status} ${error.statusText}`.trim();
  }

  // Error instance
  if (!message && error instanceof Error) {
    message = error.message || String(error);
  }

  // SDK-specific shapes
  if (!message && error && typeof error === 'object') {
    if (error.error && typeof error.error === 'object') {
      message = error.error.message || JSON.stringify(error.error);
      if (typeof error.error.status === 'number') httpStatus = error.error.status;
      if (!httpStatus && typeof error.status === 'number') httpStatus = error.status;
    } else if (typeof error.message === 'string') {
      message = error.message;
      if (typeof error.status === 'number') httpStatus = error.status;
    } else {
      try { message = JSON.stringify(error); } catch { message = String(error); }
    }
  }

  // Extract status code from message when present (e.g., "OpenAI API Error: 429 ...")
  if (!httpStatus) {
    const statusFromMsg = _parseHttpStatusFromText(message);
    if (statusFromMsg) httpStatus = statusFromMsg;
  }

  const isAbort = !!(error && (error.name === 'AbortError' || message.toLowerCase().includes('abort')));
  const isTimeout = !!(error && (message.toLowerCase().includes('timeout')));

  return {
    message,
    messageLower: (message || '').toLowerCase(),
    httpStatus,
    isAbort,
    isTimeout
  };
}

function _parseHttpStatusFromText(text) {
  if (!text) return undefined;
  const m = String(text).match(/\b(4\d{2}|5\d{2})\b/); // 4xx or 5xx
  if (!m) return undefined;
  const n = Number(m[1]);
  if (Number.isFinite(n)) return n;
  return undefined;
}