import { ErrorCategory, ErrorSeverity } from '../core/error_handler.js';
import { ErrorPolicy } from './error_policy.js';
import { RetryPolicy } from './retry_policy.js';
import { KeyRotation } from './key_rotation.js';

/**
 * Enhanced abstract base class for all LLM services
 * Provides consistent error handling, configuration management, and monitoring
 */
export class BaseLLMService {
    constructor(apiKeyManager, model, options = {}) {
        if (this.constructor === BaseLLMService) {
            throw new Error("Abstract classes can't be instantiated.");
        }
        
        this.apiKeyManager = apiKeyManager;
        this.model = model;
        this.options = {
            timeout: 300000, // 5 minutes
            retryAttempts: 3,
            retryDelay: 1000,
            rateLimit: {
                requestsPerMinute: 60,
                tokensPerMinute: 1000000
            },
            circuitBreaker: {
                failureThreshold: 5,
                cooldownMs: 30000,
                halfOpenMaxAttempts: 1
            },
            ...options
        };
        
        // Service state
        this.isHealthy = true;
        this.lastError = null;
        this.requestCount = 0;
        this.successfulRequests = 0;
        this.failedRequests = 0;
        this.averageResponseTime = 0;
        this.totalResponseTime = 0;
        
        // Rate limiting
        this.requestHistory = [];
        this.tokenUsage = [];
        
        // Circuit breaker state
        this.breakerState = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
        this.failureCount = 0;
        this.lastFailureTime = 0;
        this.halfOpenAttempts = 0;

        // Rolling windows
        this.recentRequests = []; // { ts, success, latencyMs }
        this.recentErrors = [];   // { ts, message }

        // DEBUG: synthetic failure injection
        this._debugNextAttemptErrorType = null;
        this._debugFailuresRemaining = 0;
        this._debugFailureType = 'rate_limit';

        // Provider-specific configuration
        this.providerConfig = this.getDefaultConfig();
    }

    /**
     * Get default configuration for the provider
     * @abstract
     * @returns {Object} Default configuration
     */
    getDefaultConfig() {
        return {
            maxTokens: 4096,
            temperature: 0.7,
            topP: 1.0,
            safetySettings: []
        };
    }

    /**
     * Update provider configuration
     */
    updateConfig(config) {
        this.providerConfig = { ...this.providerConfig, ...config };
        if (this.options?.debugLLM) {
            console.log(`[${this.constructor.name}] Configuration updated:`, config);
        }
    }

    /**
     * Enhanced message streaming with error handling and monitoring
     */
    async *sendMessageStream(history, toolDefinition, customRules = '', abortSignal = null) {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = performance.now();

        this.requestCount++;

        // Centralized retry/rotation configuration
        const providerKey = (this.getProviderKey ? this.getProviderKey() : this.constructor.name.replace('Service', '').toLowerCase());
        const retryOptions = {
            maxAttempts: this.options?.retryAttempts ?? 3,
            baseDelayMs: this.options?.retryDelay ?? 1000,
            multiplier: 2,
            maxDelayMs: 12000,
            jitter: 'full'
        };
        const debug = this.options?.debugLLM === true;

        // Reset tried keys for a clean attempt set per user request
        if (this.apiKeyManager?.resetTriedKeys) {
            this.apiKeyManager.resetTriedKeys();
        }
        const rotationSession = KeyRotation.createSession(this.apiKeyManager, { rotateOnSuccess: true, debug });

        let hasYieldedAnything = false;
        let attempt = 0;
        let prevDelay = null;
        let wasSuccessful = false;

        try {
            // Retry loop for request-level failures
            while (attempt < retryOptions.maxAttempts) {
                attempt++;

                try {
                    // Rate limit gate
                    await this.checkRateLimit();

                    // Provider configuration validation
                    if (!(await this.isConfigured())) {
                        throw new Error(`${this.constructor.name} is not properly configured`);
                    }

                    // Service health gate
                    if (!this.isHealthy) {
                        throw new Error(`${this.constructor.name} is currently unhealthy`);
                    }

                    // Circuit breaker gate
                    const nowTs = Date.now();
                    const cb = this.options?.circuitBreaker || {};
                    if (this.breakerState === 'OPEN') {
                        const sinceOpen = nowTs - (this.lastFailureTime || 0);
                        if (sinceOpen < (cb.cooldownMs ?? 30000)) {
                            const openErr = new Error('Circuit breaker is OPEN; requests temporarily blocked');
                            openErr.name = 'CircuitBreakerOpen';
                            throw openErr;
                        } else {
                            // Cooldown elapsed; enter HALF_OPEN to probe
                            this.breakerState = 'HALF_OPEN';
                            this.halfOpenAttempts = 0;
                            if (debug) console.info(`[${this.constructor.name}] Circuit breaker transitioning to HALF_OPEN`);
                        }
                    }
                    if (this.breakerState === 'HALF_OPEN') {
                        this.halfOpenAttempts++;
                        if (this.halfOpenAttempts > (cb.halfOpenMaxAttempts ?? 1)) {
                            // Too many probes; re-open
                            this.breakerState = 'OPEN';
                            this.lastFailureTime = nowTs;
                            if (debug) console.warn(`[${this.constructor.name}] HALF_OPEN probe limit reached → OPEN`);
                            const halfErr = new Error('Circuit breaker probe limit reached');
                            halfErr.name = 'CircuitBreakerOpen';
                            throw halfErr;
                        }
                    }
                    
                    // Abort early if caller already aborted
                    if (abortSignal?.aborted) {
                        const abortErr = new Error('Request aborted');
                        abortErr.name = 'AbortError';
                        throw abortErr;
                    }

                    // DEBUG: fail this attempt with a synthetic, policy-classified error if scheduled
                    if (this._debugFailuresRemaining > 0 || this._debugNextAttemptErrorType) {
                        const t = this._debugNextAttemptErrorType || this._debugFailureType || 'rate_limit';
                        // consume one failure token if using multi-attempt mode
                        if (this._debugFailuresRemaining > 0) this._debugFailuresRemaining--;
                        // clear single-shot flag
                        this._debugNextAttemptErrorType = null;

                        let emsg = 'synthetic error';
                        switch (t) {
                            case 'rate_limit': emsg = '429 rate limit'; break;
                            case 'server': emsg = '503 service unavailable'; break;
                            case 'network': emsg = 'network failure'; break;
                            case 'timeout': emsg = 'timeout exceeded'; break;
                            default: emsg = String(t);
                        }
                        const synthetic = new Error(emsg);
                        synthetic.name = 'SyntheticError';
                        throw synthetic;
                    }

                    // Rotate key before attempts after the first one
                    rotationSession.onBeforeAttempt(attempt);

                    if (debug) {
                        console.log(`[${this.constructor.name}] Starting request ${requestId} (attempt ${attempt}/${retryOptions.maxAttempts})`);
                    }
                    if (debug) {
                        console.info(`[${this.constructor.name}] keyIndex=${this.apiKeyManager?.currentIndex ?? 'n/a'} attempt=${attempt}`);
                    }

                    // Delegate to provider for streaming
                    const streamGenerator = this._sendMessageStreamImpl(history, toolDefinition, customRules, abortSignal);

                    for await (const chunk of streamGenerator) {
                        hasYieldedAnything = true;
                        yield chunk;
                    }

                    // Success path
                    this.successfulRequests++;
                    this.isHealthy = true;
                    this.lastError = null;
                    wasSuccessful = true;

                    // Reset circuit breaker on success
                    if (this.breakerState !== 'CLOSED') {
                        this.breakerState = 'CLOSED';
                        this.failureCount = 0;
                        this.halfOpenAttempts = 0;
                        if (debug) console.info(`[${this.constructor.name}] Circuit breaker CLOSED (success)`);
                    }
                    
                    // Rotate on success for strict round-robin across requests
                    rotationSession.onSuccess();
                    if (debug) {
                        console.info(
                            `[${this.constructor.name}] success: current keyIndex=${this.apiKeyManager?.currentIndex ?? 'n/a'}`
                        );
                    }
                    
                    // Exit retry loop on success
                    break;

                } catch (error) {
                    // If aborted, do not retry
                    if (abortSignal?.aborted) {
                        const abortErr = error instanceof Error ? error : new Error(String(error));
                        this.failedRequests++;
                        this.lastError = abortErr;
                        throw abortErr;
                    }

                    // Classify error
                    const classified = ErrorPolicy.classify(providerKey, error);
                    const triedAllKeys = this.apiKeyManager?.hasTriedAllKeys ? this.apiKeyManager.hasTriedAllKeys() : false;
                    const canRetry = classified.retryable && attempt < retryOptions.maxAttempts && !triedAllKeys;

                    // Record recent error (bounded)
                    try {
                        this.recentErrors.push({ ts: Date.now(), message: error?.message || String(error) });
                        if (this.recentErrors.length > 10) this.recentErrors.shift();
                    } catch (_) {}

                    console.warn(
                        `[${this.constructor.name}] Request ${requestId} attempt ${attempt} failed [${classified.type}] retryable=${classified.retryable} ` +
                        `status=${classified.httpStatus ?? 'n/a'} triedAllKeys=${triedAllKeys}:`,
                        error
                    );

                    if (!canRetry) {
                        // Final failure: rethrow enhanced error
                        this.failedRequests++;
                        this.lastError = error;

                        // Circuit breaker escalation
                        const cb = this.options?.circuitBreaker || {};
                        this.failureCount++;
                        if (this.breakerState === 'HALF_OPEN' || this.failureCount >= (cb.failureThreshold ?? 5)) {
                            this.breakerState = 'OPEN';
                            this.lastFailureTime = Date.now();
                            if (debug) console.warn(`[${this.constructor.name}] Circuit breaker OPEN (failures=${this.failureCount})`);
                        }
                        
                        const categorizedError = this.categorizeError(error);
                        if (categorizedError.severity === ErrorSeverity.CRITICAL) {
                            this.isHealthy = false;
                        }
                        
                        const enhancedError = new Error(categorizedError.message);
                        enhancedError.originalError = error;
                        enhancedError.category = categorizedError.category;
                        enhancedError.severity = categorizedError.severity;
                        enhancedError.provider = this.constructor.name;
                        enhancedError.requestId = requestId;
                        throw enhancedError;
                    }

                    // Prepare next attempt: backoff (key will rotate at next attempt via onBeforeAttempt)
                    const delay = RetryPolicy.computeDelay(attempt, prevDelay, retryOptions);
                    prevDelay = delay;

                    if (debug) console.log(`[${this.constructor.name}] Retrying in ${delay}ms...`);
                    await new Promise(res => setTimeout(res, delay));
                }
            }
        } finally {
            // Update timing metrics
            const responseTime = performance.now() - startTime;
            this.totalResponseTime += responseTime;
            this.averageResponseTime = this.totalResponseTime / this.requestCount;

            // Rolling window metrics (5 minutes)
            try {
                const now = Date.now();
                const windowMs = 5 * 60 * 1000;
                this.recentRequests.push({ ts: now, success: wasSuccessful, latencyMs: responseTime });
                // Trim window and cap size
                this.recentRequests = this.recentRequests.filter(r => now - r.ts < windowMs);
                if (this.recentRequests.length > 200) {
                    this.recentRequests = this.recentRequests.slice(-200);
                }
                // Trim recent errors window too
                this.recentErrors = this.recentErrors.filter(e => now - e.ts < windowMs);
                if (this.recentErrors.length > 10) {
                    this.recentErrors = this.recentErrors.slice(-10);
                }
            } catch (_) {}

            if (this.options?.debugLLM) {
                console.log(
                    `[${this.constructor.name}] Request ${requestId} ` +
                    `${hasYieldedAnything ? 'completed' : 'finished without output'} in ${responseTime.toFixed(2)}ms`
                );
            }
        }
    }

    /**
     * Provider-specific message streaming implementation
     * @abstract
     */
    async *_sendMessageStreamImpl(history, toolDefinition, customRules, abortSignal) {
        throw new Error("Method '_sendMessageStreamImpl()' must be implemented.");
    }

    /**
     * Enhanced configuration check with detailed validation
     */
    async isConfigured() {
        try {
            // Check API key
            await this.apiKeyManager.loadKeys(this.getProviderKey());
            const currentApiKey = this.apiKeyManager.getCurrentKey();
            if (!currentApiKey) {
                return false;
            }
            
            // Check model configuration
            if (!this.model) {
                return false;
            }
            
            // Provider-specific validation
            return await this._validateConfiguration();
        } catch (error) {
            console.warn(`[${this.constructor.name}] Configuration validation failed:`, error);
            return false;
        }
    }

    /**
     * Provider-specific configuration validation
     * @abstract
     */
    async _validateConfiguration() {
        return true; // Default implementation
    }

    /**
     * Get provider key for API key manager
     * @abstract
     */
    getProviderKey() {
        throw new Error("Method 'getProviderKey()' must be implemented.");
    }

    /**
     * Categorize errors for consistent handling
     */
    categorizeError(error) {
        const errorMessage = error?.message?.toLowerCase() || '';
        
        // API key errors
        if (errorMessage.includes('api key') || errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
            return {
                category: ErrorCategory.AI_SERVICE,
                severity: ErrorSeverity.HIGH,
                message: 'API key is invalid or missing. Please check your configuration.',
                recoverable: true
            };
        }
        
        // Rate limit errors
        if (errorMessage.includes('rate limit') || errorMessage.includes('quota') || errorMessage.includes('too many requests')) {
            return {
                category: ErrorCategory.AI_SERVICE,
                severity: ErrorSeverity.MEDIUM,
                message: 'Rate limit exceeded. Please wait before making more requests.',
                recoverable: true
            };
        }
        
        // Network errors
        if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('timeout')) {
            return {
                category: ErrorCategory.NETWORK,
                severity: ErrorSeverity.MEDIUM,
                message: 'Network error occurred. Please check your connection and try again.',
                recoverable: true
            };
        }
        
        // Model/input errors
        if (errorMessage.includes('model') || errorMessage.includes('input') || errorMessage.includes('token')) {
            return {
                category: ErrorCategory.AI_SERVICE,
                severity: ErrorSeverity.LOW,
                message: 'Invalid model or input parameters. Please check your request.',
                recoverable: false
            };
        }
        
        // Default categorization
        return {
            category: ErrorCategory.AI_SERVICE,
            severity: ErrorSeverity.MEDIUM,
            message: error?.message || 'An unexpected error occurred with the AI service.',
            recoverable: false
        };
    }

    /**
     * Check rate limits before making requests
     */
    async checkRateLimit() {
        const now = Date.now();
        const oneMinute = 60 * 1000;
        
        // Clean old requests
        this.requestHistory = this.requestHistory.filter(timestamp => now - timestamp < oneMinute);
        
        // Check request rate limit
        if (this.requestHistory.length >= this.options.rateLimit.requestsPerMinute) {
            const waitTime = oneMinute - (now - this.requestHistory[0]);
            if (waitTime > 0) {
                console.log(`[${this.constructor.name}] Rate limit reached, waiting ${waitTime}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        
        // Add current request
        this.requestHistory.push(now);
    }

    /**
     * Get service health status
     */
    getHealthStatus() {
        const overallSuccessRate = this.requestCount > 0 ?
            (this.successfulRequests / this.requestCount * 100).toFixed(2) : '0.00';

        // Rolling window (last 5 minutes)
        const now = Date.now();
        const windowMs = 5 * 60 * 1000;
        const window = (this.recentRequests || []).filter(r => now - r.ts < windowMs);
        const windowCount = window.length;
        const windowSuccess = window.filter(r => r.success).length;
        const windowLatencyAvg = windowCount > 0
            ? (window.reduce((s, r) => s + r.latencyMs, 0) / windowCount).toFixed(2)
            : '0.00';

        const windowSuccessRate = windowCount > 0
            ? (windowSuccess / windowCount * 100).toFixed(2)
            : '0.00';

        const recentErrors = (this.recentErrors || []).slice(-3).map(e => ({
            message: e.message,
            time: new Date(e.ts).toISOString()
        }));

        return {
            provider: this.constructor.name,
            model: this.model,
            isHealthy: this.isHealthy,
            requestCount: this.requestCount,
            successfulRequests: this.successfulRequests,
            failedRequests: this.failedRequests,
            successRate: `${overallSuccessRate}%`,
            averageResponseTime: `${this.averageResponseTime.toFixed(2)}ms`,
            rollingWindow: {
                durationMinutes: 5,
                requests: windowCount,
                successRate: `${windowSuccessRate}%`,
                averageLatencyMs: Number(windowLatencyAvg)
            },
            breaker: {
                state: this.breakerState,
                failureCount: this.failureCount,
                cooldownMs: this.options?.circuitBreaker?.cooldownMs ?? 30000,
                halfOpenAttempts: this.halfOpenAttempts
            },
            lastError: this.lastError?.message || null,
            recentErrors,
            configuration: {
                hasApiKey: !!this.apiKeyManager?.getCurrentKey?.(),
                model: this.model,
                ...this.providerConfig
            }
        };
    }

    /**
     * Report provider capabilities for upstream consumers (Chat/Facade/Optimizers)
     * Providers should override to supply accurate values.
     */
    getCapabilities() {
        return {
            provider: this.constructor.name.replace('Service', '').toLowerCase(),
            supportsFunctionCalling: false,
            supportsSystemInstruction: true,
            nativeToolProtocol: 'none', // e.g., 'gemini_tools' | 'openai_tools' | 'none'
            maxContext: 128000,
            maxTokens: this.providerConfig?.maxTokens ?? 4096,
            rateLimits: {
                requestsPerMinute: this.options?.rateLimit?.requestsPerMinute ?? null,
                tokensPerMinute: this.options?.rateLimit?.tokensPerMinute ?? null
            }
        };
    }

    /**
     * Reset service metrics
     */
    resetMetrics() {
        this.requestCount = 0;
        this.successfulRequests = 0;
        this.failedRequests = 0;
        this.averageResponseTime = 0;
        this.totalResponseTime = 0;
        this.requestHistory = [];
        this.tokenUsage = [];
        this.lastError = null;
        this.isHealthy = true;
        
        console.log(`[${this.constructor.name}] Metrics reset`);
    }

    /**
     * Get system prompt for the provider
     */
    _getSystemInstruction(mode, customRules = '') {
        const baseInstructions = this.getBaseSystemInstructions();
        const modeInstructions = this.getModeInstructions(mode);
        
        return [
            baseInstructions,
            modeInstructions,
            customRules
        ].filter(Boolean).join('\n\n');
    }

    /**
     * Get base system instructions
     * @abstract
     */
    getBaseSystemInstructions() {
        return "You are an AI assistant helping with code development and analysis.";
    }

    /**
     * Get mode-specific instructions
     */
    getModeInstructions(mode) {
        const modeInstructions = {
            'code': 'Focus on code analysis, generation, and debugging. Provide precise, working code solutions.',
            'plan': 'Focus on planning and strategy. Break down complex tasks into actionable steps.',
            'search': 'Focus on finding and analyzing information. Provide comprehensive search results and insights.'
        };
        
        return modeInstructions[mode] || modeInstructions['code'];
    }

    /**
     * Prepare messages with enhanced validation
     */
    _prepareMessages(history) {
        if (!Array.isArray(history)) {
            throw new Error('History must be an array');
        }
        
        // Delegate to provider-specific implementation
        return this._prepareMessagesImpl(history);
    }

    /**
     * Provider-specific message preparation
     * @abstract
     */
    _prepareMessagesImpl(history) {
        throw new Error("Method '_prepareMessagesImpl()' must be implemented.");
    }

    /**
     * Cleanup resources when service is no longer needed
     */
    dispose() {
        this.requestHistory = [];
        this.tokenUsage = [];
        console.log(`[${this.constructor.name}] Service disposed`);
    }

    /**
     * DEBUG: Force circuit breaker to OPEN state immediately.
     * Useful for validating UI/metrics behavior without making a failing request.
     * @internal
     */
    debugTripCircuitBreaker() {
        this.breakerState = 'OPEN';
        this.lastFailureTime = Date.now();
        console.warn(`[${this.constructor.name}] [DEBUG] Circuit breaker set to OPEN manually`);
    }

    /**
     * DEBUG: Reset circuit breaker and health to a clean CLOSED state.
     * @internal
     */
    debugResetCircuitBreaker() {
        this.breakerState = 'CLOSED';
        this.failureCount = 0;
        this.halfOpenAttempts = 0;
        this.isHealthy = true;
        this.lastError = null;
        console.info(`[${this.constructor.name}] [DEBUG] Circuit breaker reset to CLOSED`);
    }

    /**
     * DEBUG: Inject a synthetic failure into rolling metrics and breaker logic.
     * Increments failedRequests and updates breaker state based on thresholds.
     * @param {string} message
     * @param {import('../core/error_handler.js').ErrorSeverity} severity
     * @internal
     */
    debugFailOnce(message = 'Synthetic failure (debug)', severity = ErrorSeverity.MEDIUM) {
        const now = Date.now();
        const err = new Error(message);
        this.failedRequests++;
        this.lastError = err;

        // Push into recent windows
        try {
            this.recentErrors.push({ ts: now, message });
            if (this.recentErrors.length > 10) this.recentErrors.shift();
            this.recentRequests.push({ ts: now, success: false, latencyMs: 0 });
            // keep last 5 minutes only; in debug context this trim is fine without precise timestamps
            const windowMs = 5 * 60 * 1000;
            this.recentRequests = this.recentRequests.filter(r => now - r.ts < windowMs);
        } catch (_) {}

        // Health and breaker logic
        if (severity === ErrorSeverity.CRITICAL) {
            this.isHealthy = false;
        }
        this.failureCount++;
        const cb = this.options?.circuitBreaker || {};
        if (this.breakerState === 'HALF_OPEN' || this.failureCount >= (cb.failureThreshold ?? 5)) {
            this.breakerState = 'OPEN';
            this.lastFailureTime = now;
            console.warn(`[${this.constructor.name}] [DEBUG] Circuit breaker OPEN due to debugFailOnce (failures=${this.failureCount})`);
        }
        console.warn(`[${this.constructor.name}] [DEBUG] Failure injected: ${message} (severity=${severity})`);
    }

    /**
     * DEBUG: Inject a synthetic successful request into rolling metrics.
     * @param {number} latencyMs
     * @internal
     */
    debugMarkSuccess(latencyMs = 120) {
        const now = Date.now();
        this.requestCount++;
        this.successfulRequests++;
        this.totalResponseTime += latencyMs;
        this.averageResponseTime = this.totalResponseTime / Math.max(1, this.requestCount);
        this.isHealthy = true;

        try {
            this.recentRequests.push({ ts: now, success: true, latencyMs });
            const windowMs = 5 * 60 * 1000;
            this.recentRequests = this.recentRequests.filter(r => now - r.ts < windowMs);
            if (this.recentRequests.length > 200) {
                this.recentRequests = this.recentRequests.slice(-200);
            }
        } catch (_) {}

        // If breaker was HALF_OPEN, a success should close it
        if (this.breakerState !== 'CLOSED') {
            this.breakerState = 'CLOSED';
            this.failureCount = 0;
            this.halfOpenAttempts = 0;
            console.info(`[${this.constructor.name}] [DEBUG] Circuit breaker CLOSED due to debugMarkSuccess`);
        }
        console.info(`[${this.constructor.name}] [DEBUG] Success injected (latency=${latencyMs}ms)`);
    }

    /**
     * DEBUG: Schedule a retryable error to be thrown on the next attempt before contacting provider.
     * @param {'rate_limit'|'server'|'network'|'timeout'|string} type
     */
    debugFailNextAttempt(type = 'rate_limit') {
        this._debugNextAttemptErrorType = type;
        console.warn(`[${this.constructor.name}] [DEBUG] Will fail next attempt with synthetic '${type}' error`);
    }

    /**
     * DEBUG: Schedule N consecutive attempt failures before contacting provider.
     * Useful for chaos testing retries, backoff, and key rotation.
     * @param {number} attempts
     * @param {'rate_limit'|'server'|'network'|'timeout'|string} type
     */
    debugFailAttempts(attempts = 2, type = 'rate_limit') {
        const n = Number(attempts) || 0;
        this._debugFailuresRemaining = Math.max(0, n);
        this._debugFailureType = type || 'rate_limit';
        console.warn(`[${this.constructor.name}] [DEBUG] Will fail next ${this._debugFailuresRemaining} attempt(s) with '${this._debugFailureType}'`);
    }

}