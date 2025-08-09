/**
 * KeyRotation
 * - Request-scoped helper to manage API key rotation consistently.
 * - Policy: rotate on retryable error before next attempt; optional rotate on success.
 *
 * Typical usage:
 *   const session = KeyRotation.createSession(apiKeyManager, { rotateOnSuccess: false });
 *   await RetryPolicy.execute(async (attempt) => {
 *     session.onBeforeAttempt(attempt); // rotates on attempts > 1
 *     // ... perform provider request using apiKeyManager.getCurrentKey()
 *   }, provider, retryOptions);
 *   // On final success (after streaming completes), caller may optionally:
 *   if (rotateOnSuccessDesired) session.onSuccess();
 */

export const KeyRotation = {
  /**
   * Create a request-scoped rotation session.
   * @param {object} apiKeyManager - The shared ApiKeyManager instance
   * @param {{ rotateOnSuccess?: boolean }} options
   * @returns {KeyRotationSession}
   */
  createSession(apiKeyManager, options = {}) {
    return new KeyRotationSession(apiKeyManager, options);
  }
};

export class KeyRotationSession {
  /**
   * @param {object} apiKeyManager
   * @param {{ rotateOnSuccess?: boolean }} options
   */
  constructor(apiKeyManager, { rotateOnSuccess = false } = {}) {
    this.mgr = apiKeyManager;
    this.startIndex = typeof apiKeyManager.currentIndex === 'number' ? apiKeyManager.currentIndex : 0;
    this.rotateOnSuccess = !!rotateOnSuccess;
    this.rotationsDuringRetries = 0;
  }

  /**
   * Should be called at the start of each attempt.
   * Rotates the key if attempt > 1 (i.e., after a retryable error).
   * @param {number} attempt
   */
  onBeforeAttempt(attempt) {
    if (attempt > 1) {
      this._rotate();
    }
  }

  /**
   * Optional: caller can invoke this when an error is classified retryable
   * and before scheduling the next attempt. If you also call onBeforeAttempt
   * at the next attempt, avoid double-rotating (choose one).
   */
  onRetryableError() {
    this._rotate();
  }

  /**
   * Optionally rotate on success for round-robin policy across requests.
   * This is disabled by default to prevent double-rotation when providers
   * already rotate on success internally.
   */
  onSuccess() {
    if (this.rotateOnSuccess) {
      this._rotate();
    }
  }

  getCurrentKey() {
    return this.mgr.getCurrentKey ? this.mgr.getCurrentKey() : null;
  }

  hasTriedAllKeys() {
    return this.mgr.hasTriedAllKeys ? this.mgr.hasTriedAllKeys() : false;
  }

  resetTried() {
    if (this.mgr.resetTriedKeys) this.mgr.resetTriedKeys();
  }

  _rotate() {
    if (this.mgr && typeof this.mgr.rotateKey === 'function') {
      this.mgr.rotateKey();
      this.rotationsDuringRetries++;
    }
  }
}

/**
 * Convenience wrapper that composes RetryPolicy with KeyRotation in a single call.
 * Note: This is optional; integrators can wire sessions manually for more control.
 *
 * @param {object} apiKeyManager
 * @param {('gemini'|'openai'|'ollama'|string)} provider
 * @param {Function} fn - async (attempt, session) => any
 * @param {object} RetryPolicy - the imported RetryPolicy module
 * @param {object} retryOptions - overrides for RetryPolicy
 * @param {{ rotateOnSuccess?: boolean }} rotationOptions
 */
export async function runWithKeyRotation(apiKeyManager, provider, fn, RetryPolicy, retryOptions = {}, rotationOptions = {}) {
  const session = KeyRotation.createSession(apiKeyManager, rotationOptions);
  return await RetryPolicy.execute(
    async (attempt) => {
      session.onBeforeAttempt(attempt);
      const result = await fn(attempt, session);
      // The caller may choose to call session.onSuccess() after full stream completion instead.
      return result;
    },
    provider,
    retryOptions
  );
}