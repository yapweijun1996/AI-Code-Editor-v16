/**
 * Centralized State Management System
 * Provides immutable state updates with observer pattern and validation
 */

export class StateManager {
    constructor() {
        this.state = {};
        this.observers = new Map();
        this.validators = new Map();
        this.middleware = [];
        this.history = [];
        this.maxHistorySize = 50;
        this.frozen = false;
        
        console.log('[StateManager] Initialized with immutable state management');
    }

    /**
     * Get current state (immutable copy)
     */
    getState(path = null) {
        if (path) {
            return this.getNestedValue(this.state, path);
        }
        return this.deepFreeze(this.deepClone(this.state));
    }

    /**
     * Update state with immutable operations
     */
    setState(updates, metadata = {}) {
        if (this.frozen) {
            throw new Error('StateManager is frozen - cannot update state');
        }

        const oldState = this.deepClone(this.state);
        let newState;

        if (typeof updates === 'function') {
            // Functional update
            newState = updates(this.deepClone(this.state));
        } else {
            // Object merge update
            newState = this.deepMerge(this.state, updates);
        }

        // Validate new state
        this.validateState(newState, oldState);

        // Apply middleware
        newState = this.applyMiddleware(newState, oldState, metadata);

        // Store in history
        this.addToHistory(oldState, newState, metadata);

        // Update state
        this.state = newState;

        // Notify observers
        this.notifyObservers(newState, oldState, metadata);

        return this.getState();
    }

    /**
     * Subscribe to state changes
     */
    subscribe(observer, path = null) {
        if (typeof observer !== 'function') {
            throw new Error('Observer must be a function');
        }

        const observerId = `observer_${Date.now()}_${Math.random()}`;
        
        this.observers.set(observerId, {
            callback: observer,
            path: path,
            id: observerId
        });

        // Return unsubscribe function
        return () => this.unsubscribe(observerId);
    }

    /**
     * Unsubscribe from state changes
     */
    unsubscribe(observerId) {
        return this.observers.delete(observerId);
    }

    /**
     * Add middleware for state updates
     */
    addMiddleware(middleware) {
        if (typeof middleware !== 'function') {
            throw new Error('Middleware must be a function');
        }
        this.middleware.push(middleware);
    }

    /**
     * Add state validator
     */
    addValidator(path, validator) {
        if (typeof validator !== 'function') {
            throw new Error('Validator must be a function');
        }
        
        if (!this.validators.has(path)) {
            this.validators.set(path, []);
        }
        
        this.validators.get(path).push(validator);
    }

    /**
     * Get state history
     */
    getHistory() {
        return [...this.history];
    }

    /**
     * Undo last state change
     */
    undo() {
        if (this.history.length === 0) {
            console.warn('[StateManager] No state history to undo');
            return this.getState();
        }

        const lastEntry = this.history[this.history.length - 1];
        this.state = this.deepClone(lastEntry.oldState);
        this.history.pop();

        // Notify observers of undo
        this.notifyObservers(this.state, lastEntry.newState, { 
            action: 'undo',
            originalMetadata: lastEntry.metadata 
        });

        return this.getState();
    }

    /**
     * Reset state to initial values
     */
    reset(initialState = {}) {
        const oldState = this.deepClone(this.state);
        this.state = this.deepClone(initialState);
        this.history = [];
        
        this.notifyObservers(this.state, oldState, { action: 'reset' });
        return this.getState();
    }

    /**
     * Freeze state manager (prevent further updates)
     */
    freeze() {
        this.frozen = true;
        console.log('[StateManager] State manager frozen - no further updates allowed');
    }

    /**
     * Unfreeze state manager
     */
    unfreeze() {
        this.frozen = false;
        console.log('[StateManager] State manager unfrozen');
    }

    /**
     * Batch multiple state updates
     */
    batch(updateFn) {
        const oldState = this.deepClone(this.state);
        let tempState = this.deepClone(this.state);
        
        const batchUpdater = (updates) => {
            if (typeof updates === 'function') {
                tempState = updates(tempState);
            } else {
                tempState = this.deepMerge(tempState, updates);
            }
        };

        updateFn(batchUpdater);

        // Validate final state
        this.validateState(tempState, oldState);

        // Apply middleware
        tempState = this.applyMiddleware(tempState, oldState, { action: 'batch' });

        // Store in history
        this.addToHistory(oldState, tempState, { action: 'batch' });

        // Update state
        this.state = tempState;

        // Notify observers once
        this.notifyObservers(this.state, oldState, { action: 'batch' });

        return this.getState();
    }

    /**
     * Create a scoped state manager for a specific path
     */
    createScope(path) {
        return new ScopedStateManager(this, path);
    }

    // Private methods

    validateState(newState, oldState) {
        for (const [path, validators] of this.validators) {
            const newValue = this.getNestedValue(newState, path);
            const oldValue = this.getNestedValue(oldState, path);
            
            for (const validator of validators) {
                try {
                    const isValid = validator(newValue, oldValue, newState);
                    if (!isValid) {
                        throw new Error(`State validation failed for path: ${path}`);
                    }
                } catch (error) {
                    console.error(`[StateManager] Validation error for ${path}:`, error);
                    throw error;
                }
            }
        }
    }

    applyMiddleware(newState, oldState, metadata) {
        return this.middleware.reduce((state, middleware) => {
            try {
                return middleware(state, oldState, metadata) || state;
            } catch (error) {
                console.error('[StateManager] Middleware error:', error);
                return state;
            }
        }, newState);
    }

    addToHistory(oldState, newState, metadata) {
        this.history.push({
            timestamp: Date.now(),
            oldState: this.deepClone(oldState),
            newState: this.deepClone(newState),
            metadata: { ...metadata }
        });

        // Maintain history size
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
    }

    notifyObservers(newState, oldState, metadata) {
        for (const observer of this.observers.values()) {
            try {
                if (observer.path) {
                    const newValue = this.getNestedValue(newState, observer.path);
                    const oldValue = this.getNestedValue(oldState, observer.path);
                    
                    // Only notify if the specific path changed
                    if (!this.deepEqual(newValue, oldValue)) {
                        observer.callback(newValue, oldValue, metadata);
                    }
                } else {
                    // Notify for all changes
                    observer.callback(newState, oldState, metadata);
                }
            } catch (error) {
                console.error('[StateManager] Observer error:', error);
            }
        }
    }

    getNestedValue(obj, path) {
        if (!path) return obj;
        
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }

    setNestedValue(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((current, key) => {
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            return current[key];
        }, obj);
        
        target[lastKey] = value;
        return obj;
    }

    deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj);
        if (obj instanceof Array) return obj.map(item => this.deepClone(item));
        if (typeof obj === 'object') {
            const cloned = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    cloned[key] = this.deepClone(obj[key]);
                }
            }
            return cloned;
        }
        return obj;
    }

    deepMerge(target, source) {
        const result = this.deepClone(target);
        
        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    result[key] = this.deepMerge(result[key] || {}, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
        }
        
        return result;
    }

    deepEqual(a, b) {
        if (a === b) return true;
        if (a == null || b == null) return false;
        if (typeof a !== typeof b) return false;
        
        if (typeof a === 'object') {
            if (Array.isArray(a) !== Array.isArray(b)) return false;
            
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;
            
            for (const key of keysA) {
                if (!keysB.includes(key)) return false;
                if (!this.deepEqual(a[key], b[key])) return false;
            }
            
            return true;
        }
        
        return false;
    }

    deepFreeze(obj) {
        if (obj && typeof obj === 'object') {
            Object.freeze(obj);
            Object.getOwnPropertyNames(obj).forEach(prop => {
                if (obj[prop] !== null && typeof obj[prop] === 'object') {
                    this.deepFreeze(obj[prop]);
                }
            });
        }
        return obj;
    }
}

/**
 * Scoped State Manager for managing nested state
 */
class ScopedStateManager {
    constructor(parentManager, path) {
        this.parent = parentManager;
        this.path = path;
    }

    getState() {
        return this.parent.getNestedValue(this.parent.getState(), this.path);
    }

    setState(updates, metadata = {}) {
        const currentValue = this.getState();
        let newValue;

        if (typeof updates === 'function') {
            newValue = updates(this.parent.deepClone(currentValue));
        } else {
            newValue = this.parent.deepMerge(currentValue || {}, updates);
        }

        const fullUpdate = {};
        this.parent.setNestedValue(fullUpdate, this.path, newValue);

        return this.parent.setState(fullUpdate, { ...metadata, scope: this.path });
    }

    subscribe(observer) {
        return this.parent.subscribe(observer, this.path);
    }
}

// Application-specific state manager with predefined structure
export class AppStateManager extends StateManager {
    constructor() {
        super();
        
        // Initialize with application-specific state structure
        this.state = {
            // UI State
            ui: {
                fileTreeCollapsed: false,
                activeTab: null,
                openTabs: [],
                resizablePanelSizes: [15, 55, 30],
                theme: 'dark'
            },
            
            // File System State
            fileSystem: {
                rootDirectoryHandle: null,
                currentProjectPath: null,
                recentProjects: []
            },
            
            // Editor State
            editor: {
                activeFile: null,
                openFiles: {},
                editorInstance: null,
                cursorPosition: null,
                selection: null
            },
            
            // Chat/AI State
            ai: {
                selectedProvider: 'gemini',
                selectedModel: null,
                chatHistory: [],
                isProcessing: false,
                lastError: null
            },
            
            // Settings State
            settings: {
                llmProvider: 'gemini',
                apiKeys: {},
                customRules: {},
                performance: {
                    enableProfiling: true,
                    sampleRate: 1.0
                }
            },
            
            // Application State
            app: {
                initialized: false,
                loading: false,
                error: null,
                version: '1.0.0'
            }
        };

        this.setupValidators();
        this.setupMiddleware();
    }

    setupValidators() {
        // Validate UI state
        this.addValidator('ui.resizablePanelSizes', (newSizes) => {
            return Array.isArray(newSizes) && newSizes.length === 3 && 
                   newSizes.every(size => typeof size === 'number' && size >= 0);
        });

        // Validate editor state - handle both Map and plain objects
        this.addValidator('editor.openFiles', (newFiles) => {
            return newFiles instanceof Map || newFiles === null || typeof newFiles === 'object';
        });

        // Validate AI state
        this.addValidator('ai.selectedProvider', (provider) => {
            return ['gemini', 'openai', 'ollama'].includes(provider);
        });
    }

    setupMiddleware() {
        // Performance monitoring middleware
        this.addMiddleware((newState, oldState, metadata) => {
            if (window.performanceProfiler && metadata.performanceTrack !== false) {
                const timerId = window.performanceProfiler.startTimer('state.update');
                Promise.resolve().then(() => {
                    window.performanceProfiler.endTimer(timerId);
                });
            }
            return newState;
        });

        // Persistence middleware for certain state paths
        this.addMiddleware((newState, oldState, metadata) => {
            if (metadata.persist !== false) {
                // Persist UI preferences
                if (newState.ui !== oldState.ui) {
                    this.persistUIState(newState.ui);
                }
                
                // Persist settings
                if (newState.settings !== oldState.settings) {
                    this.persistSettings(newState.settings);
                }
            }
            return newState;
        });
    }

    persistUIState(uiState) {
        try {
            localStorage.setItem('app_ui_state', JSON.stringify({
                fileTreeCollapsed: uiState.fileTreeCollapsed,
                resizablePanelSizes: uiState.resizablePanelSizes,
                theme: uiState.theme
            }));
        } catch (error) {
            console.warn('[AppStateManager] Failed to persist UI state:', error);
        }
    }

    persistSettings(settings) {
        try {
            // Only persist safe settings (not API keys)
            const safeToPersist = {
                llmProvider: settings.llmProvider,
                performance: settings.performance
            };
            localStorage.setItem('app_settings', JSON.stringify(safeToPersist));
        } catch (error) {
            console.warn('[AppStateManager] Failed to persist settings:', error);
        }
    }

    // Helper methods for common state operations
    updateUI(updates) {
        return this.setState({ ui: updates });
    }

    updateEditor(updates) {
        return this.setState({ editor: updates });
    }

    updateAI(updates) {
        return this.setState({ ai: updates });
    }

    updateFileSystem(updates) {
        return this.setState({ fileSystem: updates });
    }

    updateSettings(updates) {
        return this.setState({ settings: updates });
    }

    updateApp(updates) {
        return this.setState({ app: updates });
    }

    // Get scoped managers for specific areas
    getUIManager() {
        return this.createScope('ui');
    }

    getEditorManager() {
        return this.createScope('editor');
    }

    getAIManager() {
        return this.createScope('ai');
    }

    getFileSystemManager() {
        return this.createScope('fileSystem');
    }

    getSettingsManager() {
        return this.createScope('settings');
    }
}

// Create and export global app state manager
export const appStateManager = new AppStateManager();

// Migration helper to replace old appState usage
export const migrateFromOldAppState = (oldAppState) => {
    try {
        const migratedState = {
            ui: {
                fileTreeCollapsed: oldAppState.isFileTreeCollapsed || false
            },
            fileSystem: {
                rootDirectoryHandle: oldAppState.rootDirectoryHandle || null
            },
            editor: {
                editorInstance: oldAppState.editor || null,
                openFiles: {} // Initialize as empty object instead of Map
            },
            app: {
                uploadedImage: oldAppState.uploadedImage || null
            }
        };
        
        appStateManager.setState(migratedState, { action: 'migration', performanceTrack: false });
        console.log('[AppStateManager] Migrated from old appState object');
    } catch (error) {
        console.error('[AppStateManager] Migration failed:', error);
        // Continue with default state if migration fails
    }
};