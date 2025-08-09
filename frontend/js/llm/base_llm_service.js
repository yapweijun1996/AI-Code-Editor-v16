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
        console.log(`[${this.constructor.name}] Configuration updated:`, config);
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

        // Reset tried keys for a clean attempt set per user request
        if (this.apiKeyManager?.resetTriedKeys) {
            this.apiKeyManager.resetTriedKeys();
        }
        const rotationSession = KeyRotation.createSession(this.apiKeyManager, { rotateOnSuccess: false });

        let hasYieldedAnything = false;
        let attempt = 0;
        let prevDelay = null;

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

                    // Abort early if caller already aborted
                    if (abortSignal?.aborted) {
                        const abortErr = new Error('Request aborted');
                        abortErr.name = 'AbortError';
                        throw abortErr;
                    }

                    // Rotate key before attempts after the first one
                    rotationSession.onBeforeAttempt(attempt);

                    console.log(`[${this.constructor.name}] Starting request ${requestId} (attempt ${attempt}/${retryOptions.maxAttempts})`);

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

                    // Optional: rotate on success for strict round-robin across requests
                    // rotationSession.onSuccess();

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

                    console.warn(
                        `[${this.constructor.name}] Request ${requestId} attempt ${attempt} failed [${classified.type}] retryable=${classified.retryable} ` +
                        `status=${classified.httpStatus ?? 'n/a'} triedAllKeys=${triedAllKeys}:`,
                        error
                    );

                    if (!canRetry) {
                        // Final failure: rethrow enhanced error
                        this.failedRequests++;
                        this.lastError = error;

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

                    // Prepare next attempt: rotate and backoff
                    rotationSession.onRetryableError();

                    const delay = RetryPolicy.computeDelay(attempt, prevDelay, retryOptions);
                    prevDelay = delay;

                    console.log(`[${this.constructor.name}] Retrying in ${delay}ms...`);
                    await new Promise(res => setTimeout(res, delay));
                }
            }
        } finally {
            // Update timing metrics
            const responseTime = performance.now() - startTime;
            this.totalResponseTime += responseTime;
            this.averageResponseTime = this.totalResponseTime / this.requestCount;

            console.log(
                `[${this.constructor.name}] Request ${requestId} ` +
                `${hasYieldedAnything ? 'completed' : 'finished without output'} in ${responseTime.toFixed(2)}ms`
            );
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
        const successRate = this.requestCount > 0 ?
            (this.successfulRequests / this.requestCount * 100).toFixed(2) : 0;
            
        return {
            provider: this.constructor.name,
            model: this.model,
            isHealthy: this.isHealthy,
            requestCount: this.requestCount,
            successfulRequests: this.successfulRequests,
            failedRequests: this.failedRequests,
            successRate: `${successRate}%`,
            averageResponseTime: `${this.averageResponseTime.toFixed(2)}ms`,
            lastError: this.lastError?.message || null,
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
}