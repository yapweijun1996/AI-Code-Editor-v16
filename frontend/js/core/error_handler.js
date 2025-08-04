/**
 * Global Error Handling System
 * Provides centralized error handling, user-friendly messages, and structured logging
 */

export const ErrorSeverity = {
    LOW: 'low',
    MEDIUM: 'medium', 
    HIGH: 'high',
    CRITICAL: 'critical'
};

export const ErrorCategory = {
    SYSTEM: 'system',
    USER_INPUT: 'user_input',
    NETWORK: 'network',
    FILE_SYSTEM: 'file_system',
    AI_SERVICE: 'ai_service',
    VALIDATION: 'validation',
    PERFORMANCE: 'performance',
    SECURITY: 'security'
};

export class ErrorHandler {
    constructor() {
        this.errorLog = [];
        this.errorCounts = new Map();
        this.suppressedErrors = new Set();
        this.errorListeners = [];
        this.userMessageHandlers = new Map();
        this.fallbackStrategies = new Map();
        this.maxLogSize = 1000;
        
        this.setupGlobalHandlers();
        this.setupUserMessageHandlers();
        this.setupFallbackStrategies();
        
        console.log('[ErrorHandler] Global error handling system initialized');
    }

    setupGlobalHandlers() {
        // Unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            this.handleError(event.reason, {
                category: ErrorCategory.SYSTEM,
                severity: ErrorSeverity.HIGH,
                context: 'unhandledPromiseRejection',
                originalEvent: event
            });
        });

        // Global JavaScript errors
        window.addEventListener('error', (event) => {
            this.handleError(event.error || new Error(event.message), {
                category: ErrorCategory.SYSTEM,
                severity: ErrorSeverity.HIGH,
                context: 'globalError',
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                originalEvent: event
            });
        });

        // Resource loading errors
        window.addEventListener('error', (event) => {
            if (event.target !== window) {
                this.handleError(new Error(`Resource failed to load: ${event.target.src || event.target.href}`), {
                    category: ErrorCategory.NETWORK,
                    severity: ErrorSeverity.MEDIUM,
                    context: 'resourceError',
                    resource: event.target.tagName,
                    url: event.target.src || event.target.href
                });
            }
        }, true);
    }

    setupUserMessageHandlers() {
        // Map error categories to user-friendly messages
        this.userMessageHandlers.set(ErrorCategory.NETWORK, (error, context) => ({
            title: 'Connection Problem',
            message: 'There was a problem connecting to the service. Please check your internet connection and try again.',
            action: 'Retry',
            icon: '🌐'
        }));

        this.userMessageHandlers.set(ErrorCategory.FILE_SYSTEM, (error, context) => ({
            title: 'File Access Error',
            message: 'Unable to access the file. Please ensure you have the necessary permissions and the file exists.',
            action: 'Choose Different File',
            icon: '📁'
        }));

        this.userMessageHandlers.set(ErrorCategory.AI_SERVICE, (error, context) => {
            if (error.message?.includes('API key')) {
                return {
                    title: 'API Configuration Issue',
                    message: 'Please check your AI service API key configuration in settings.',
                    action: 'Open Settings',
                    icon: '🔑'
                };
            }
            if (error.message?.includes('rate limit') || error.message?.includes('quota')) {
                return {
                    title: 'Service Limit Reached',
                    message: 'The AI service is temporarily unavailable due to usage limits. Please try again later.',
                    action: 'Try Later',
                    icon: '⏱️'
                };
            }
            return {
                title: 'AI Service Error',
                message: 'The AI service encountered an error. Please try again or switch to a different provider.',
                action: 'Retry',
                icon: '🤖'
            };
        });

        this.userMessageHandlers.set(ErrorCategory.USER_INPUT, (error, context) => ({
            title: 'Input Error',
            message: 'Please check your input and try again.',
            action: 'Fix Input',
            icon: '✏️'
        }));

        this.userMessageHandlers.set(ErrorCategory.VALIDATION, (error, context) => ({
            title: 'Validation Error',
            message: error.message || 'The provided data is not valid.',
            action: 'Correct Data',
            icon: '⚠️'
        }));

        this.userMessageHandlers.set(ErrorCategory.PERFORMANCE, (error, context) => ({
            title: 'Performance Issue',
            message: 'The operation is taking longer than expected. You can continue working while it completes.',
            action: 'Continue',
            icon: '🐌'
        }));

        this.userMessageHandlers.set(ErrorCategory.SECURITY, (error, context) => ({
            title: 'Security Restriction',
            message: 'This action is not allowed due to security restrictions.',
            action: 'Understood',
            icon: '🔒'
        }));

        // Default handler
        this.userMessageHandlers.set('default', (error, context) => ({
            title: 'Unexpected Error',
            message: 'An unexpected error occurred. Please try again or refresh the page.',
            action: 'Retry',
            icon: '❌'
        }));
    }

    setupFallbackStrategies() {
        // Network errors: Try alternative endpoints or cached data
        this.fallbackStrategies.set(ErrorCategory.NETWORK, async (error, context, originalOperation) => {
            console.log('[ErrorHandler] Attempting network fallback strategy');
            
            // Try to use cached data if available
            if (context.cacheKey && window.localStorage) {
                const cached = localStorage.getItem(context.cacheKey);
                if (cached) {
                    console.log('[ErrorHandler] Using cached data as fallback');
                    return JSON.parse(cached);
                }
            }
            
            // Try alternative API endpoint if configured
            if (context.alternativeEndpoint && originalOperation) {
                try {
                    console.log('[ErrorHandler] Trying alternative endpoint');
                    return await originalOperation(context.alternativeEndpoint);
                } catch (fallbackError) {
                    console.warn('[ErrorHandler] Alternative endpoint also failed');
                }
            }
            
            throw error; // No fallback available
        });

        // AI Service errors: Switch to alternative provider
        this.fallbackStrategies.set(ErrorCategory.AI_SERVICE, async (error, context, originalOperation) => {
            console.log('[ErrorHandler] Attempting AI service fallback strategy');
            
            if (context.alternativeProvider && originalOperation) {
                try {
                    console.log(`[ErrorHandler] Switching to alternative AI provider: ${context.alternativeProvider}`);
                    return await originalOperation(context.alternativeProvider);
                } catch (fallbackError) {
                    console.warn('[ErrorHandler] Alternative AI provider also failed');
                }
            }
            
            throw error; // No fallback available
        });

        // File system errors: Try alternative paths or prompt user
        this.fallbackStrategies.set(ErrorCategory.FILE_SYSTEM, async (error, context, originalOperation) => {
            console.log('[ErrorHandler] Attempting file system fallback strategy');
            
            if (context.alternativePath && originalOperation) {
                try {
                    console.log('[ErrorHandler] Trying alternative file path');
                    return await originalOperation(context.alternativePath);
                } catch (fallbackError) {
                    console.warn('[ErrorHandler] Alternative path also failed');
                }
            }
            
            throw error; // No fallback available
        });
    }

    /**
     * Main error handling method
     */
    handleError(error, options = {}) {
        const errorInfo = this.processError(error, options);
        
        // Log the error
        this.logError(errorInfo);
        
        // Update error statistics
        this.updateErrorStats(errorInfo);
        
        // Notify listeners
        this.notifyListeners(errorInfo);
        
        // Show user message if not suppressed
        if (!this.shouldSuppress(errorInfo)) {
            this.showUserMessage(errorInfo);
        }
        
        // Attempt recovery if strategy available
        if (options.originalOperation && this.fallbackStrategies.has(errorInfo.category)) {
            return this.attemptRecovery(errorInfo, options.originalOperation);
        }
        
        return errorInfo;
    }

    processError(error, options) {
        const errorInfo = {
            id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
            error: error,
            message: error?.message || 'Unknown error',
            stack: error?.stack,
            category: options.category || ErrorCategory.SYSTEM,
            severity: options.severity || ErrorSeverity.MEDIUM,
            context: options.context || 'unknown',
            metadata: {
                userAgent: navigator.userAgent,
                url: window.location.href,
                timestamp: Date.now(),
                ...options
            }
        };

        // Enhance error info based on error type
        if (error instanceof TypeError) {
            errorInfo.category = ErrorCategory.SYSTEM;
            errorInfo.severity = ErrorSeverity.HIGH;
        } else if (error instanceof ReferenceError) {
            errorInfo.category = ErrorCategory.SYSTEM;
            errorInfo.severity = ErrorSeverity.CRITICAL;
        } else if (error?.name === 'NetworkError' || error?.message?.includes('fetch')) {
            errorInfo.category = ErrorCategory.NETWORK;
            errorInfo.severity = ErrorSeverity.MEDIUM;
        }

        return errorInfo;
    }

    logError(errorInfo) {
        // Add to error log
        this.errorLog.unshift(errorInfo);
        
        // Maintain log size
        if (this.errorLog.length > this.maxLogSize) {
            this.errorLog = this.errorLog.slice(0, this.maxLogSize);
        }

        // Console logging with appropriate level
        const logMethod = this.getLogMethod(errorInfo.severity);
        logMethod(`[ErrorHandler] ${errorInfo.category}:${errorInfo.severity}`, {
            id: errorInfo.id,
            message: errorInfo.message,
            context: errorInfo.context,
            stack: errorInfo.stack
        });

        // Send to external logging service if configured
        this.sendToExternalLogging(errorInfo);
    }

    getLogMethod(severity) {
        switch (severity) {
            case ErrorSeverity.CRITICAL:
                return console.error.bind(console);
            case ErrorSeverity.HIGH:
                return console.error.bind(console);
            case ErrorSeverity.MEDIUM:
                return console.warn.bind(console);
            case ErrorSeverity.LOW:
            default:
                return console.log.bind(console);
        }
    }

    updateErrorStats(errorInfo) {
        const key = `${errorInfo.category}:${errorInfo.severity}`;
        const count = this.errorCounts.get(key) || 0;
        this.errorCounts.set(key, count + 1);
    }

    shouldSuppress(errorInfo) {
        const suppressionKey = `${errorInfo.category}:${errorInfo.message}`;
        return this.suppressedErrors.has(suppressionKey);
    }

    showUserMessage(errorInfo) {
        const handler = this.userMessageHandlers.get(errorInfo.category) || 
                      this.userMessageHandlers.get('default');
        
        const userMessage = handler(errorInfo.error, errorInfo.context);
        
        // Dispatch custom event for UI to handle
        window.dispatchEvent(new CustomEvent('user-error-message', {
            detail: {
                ...userMessage,
                errorId: errorInfo.id,
                severity: errorInfo.severity,
                category: errorInfo.category
            }
        }));
    }

    async attemptRecovery(errorInfo, originalOperation) {
        const strategy = this.fallbackStrategies.get(errorInfo.category);
        if (!strategy) return null;

        try {
            console.log(`[ErrorHandler] Attempting recovery for ${errorInfo.category} error`);
            const result = await strategy(errorInfo.error, errorInfo.metadata, originalOperation);
            
            // Log successful recovery
            console.log(`[ErrorHandler] Successfully recovered from ${errorInfo.category} error`);
            this.logError({
                ...errorInfo,
                id: `recovery_${errorInfo.id}`,
                message: `Recovered from: ${errorInfo.message}`,
                severity: ErrorSeverity.LOW,
                category: 'recovery'
            });
            
            return result;
        } catch (recoveryError) {
            console.error(`[ErrorHandler] Recovery failed for ${errorInfo.category}:`, recoveryError);
            return null;
        }
    }

    notifyListeners(errorInfo) {
        this.errorListeners.forEach(listener => {
            try {
                listener(errorInfo);
            } catch (listenerError) {
                console.error('[ErrorHandler] Error in error listener:', listenerError);
            }
        });
    }

    sendToExternalLogging(errorInfo) {
        // Placeholder for external logging integration
        // Could send to services like Sentry, LogRocket, etc.
        if (window.externalLogger) {
            try {
                window.externalLogger.captureException(errorInfo.error, {
                    tags: {
                        category: errorInfo.category,
                        severity: errorInfo.severity
                    },
                    extra: errorInfo.metadata
                });
            } catch (loggingError) {
                console.error('[ErrorHandler] Failed to send to external logging:', loggingError);
            }
        }
    }

    /**
     * Add error listener
     */
    addListener(listener) {
        if (typeof listener === 'function') {
            this.errorListeners.push(listener);
        }
    }

    /**
     * Remove error listener
     */
    removeListener(listener) {
        const index = this.errorListeners.indexOf(listener);
        if (index > -1) {
            this.errorListeners.splice(index, 1);
        }
    }

    /**
     * Suppress specific error patterns
     */
    suppressError(category, message) {
        const suppressionKey = `${category}:${message}`;
        this.suppressedErrors.add(suppressionKey);
    }

    /**
     * Get error statistics
     */
    getErrorStats() {
        return {
            totalErrors: this.errorLog.length,
            errorsByCategory: Array.from(this.errorCounts.entries()).reduce((acc, [key, count]) => {
                const [category, severity] = key.split(':');
                if (!acc[category]) acc[category] = {};
                acc[category][severity] = count;
                return acc;
            }, {}),
            recentErrors: this.errorLog.slice(0, 10)
        };
    }

    /**
     * Clear error log
     */
    clearLog() {
        this.errorLog = [];
        this.errorCounts.clear();
        console.log('[ErrorHandler] Error log cleared');
    }

    /**
     * Export error log
     */
    exportLog() {
        return {
            timestamp: new Date().toISOString(),
            errors: this.errorLog.map(error => ({
                ...error,
                // Remove circular references and large objects
                error: {
                    name: error.error?.name,
                    message: error.error?.message,
                    stack: error.error?.stack
                }
            }))
        };
    }
}

// Create global instance
export const errorHandler = new ErrorHandler();

// Convenience methods for different error types
export const logError = (error, options = {}) => errorHandler.handleError(error, options);
export const logNetworkError = (error, context = {}) => errorHandler.handleError(error, { 
    ...context, 
    category: ErrorCategory.NETWORK 
});
export const logFileSystemError = (error, context = {}) => errorHandler.handleError(error, { 
    ...context, 
    category: ErrorCategory.FILE_SYSTEM 
});
export const logAIServiceError = (error, context = {}) => errorHandler.handleError(error, { 
    ...context, 
    category: ErrorCategory.AI_SERVICE 
});
export const logValidationError = (error, context = {}) => errorHandler.handleError(error, { 
    ...context, 
    category: ErrorCategory.VALIDATION 
});

// Setup error boundary for UI components
window.addEventListener('user-error-message', (event) => {
    const { detail } = event;
    
    // Create user-friendly error notification
    // This would integrate with your existing UI notification system
    console.log('[ErrorHandler] User message:', detail);
    
    // You can integrate this with your existing UI.showError method
    if (window.UI && window.UI.showError) {
        window.UI.showError(`${detail.icon} ${detail.title}: ${detail.message}`);
    }
});