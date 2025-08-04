// Monaco Model Manager - Prevents memory leaks and optimizes performance
export class MonacoModelManager {
    constructor(maxModels = 20) {
        this.models = new Map(); // filename -> { model, lastAccessed, size, isLarge, strategy }
        this.maxModels = maxModels;
        this.totalMemoryUsage = 0;
        this.maxMemoryUsage = 100 * 1024 * 1024; // Increased to 100MB limit
        this.largeFileThreshold = 5 * 1024 * 1024; // 5MB threshold for large files
        this.hibernatedModels = new Map(); // filename -> { content, lastAccessed, language }
        this.memoryPressureCallbacks = new Set();
        this.createModelFn = null;
        this.initializationPromise = new Promise(resolve => {
            this.resolveInitialization = resolve;
        });
    }

    setCreateModelFunction(fn) {
        this.createModelFn = fn;
        this.resolveInitialization();
    }

    /**
     * Get or create a Monaco model for a file
     * @param {string} filename - The file path
     * @param {string} content - The file content
     * @param {string} language - The Monaco language identifier
     * @param {Object} options - Additional options (strategy, truncated, etc.)
     * @returns {Promise<monaco.editor.ITextModel>}
     */
    async getModel(filename, content, language, options = {}) {
        // Check if model already exists
        if (this.models.has(filename)) {
            const modelInfo = this.models.get(filename);
            modelInfo.lastAccessed = Date.now();
            
            // Update content if it has changed
            if (modelInfo.model.getValue() !== content) {
                modelInfo.model.setValue(content);
                modelInfo.size = content.length;
                this.updateMemoryUsage();
            }
            
            return modelInfo.model;
        }

        // Check if we have a hibernated model
        if (this.hibernatedModels.has(filename)) {
            return this.restoreHibernatedModel(filename, content, language, options);
        }

        // Check if we need to free up space
        this.ensureCapacity(content.length);

        // Determine if this is a large file
        const isLarge = content.length > this.largeFileThreshold;
        const strategy = options.strategy || (isLarge ? 'large' : 'standard');

        // Create new model with special handling for large files
        const model = await this.createModelWithStrategy(content, language, strategy, options, filename);
        
        // Store model info
        this.models.set(filename, {
            model,
            lastAccessed: Date.now(),
            size: content.length,
            isLarge,
            strategy,
            truncated: options.truncated || false
        });

        this.totalMemoryUsage += content.length;
        
        console.log(`Created Monaco model for ${filename} (${strategy}, ${this.models.size}/${this.maxModels} models, ${Math.round(this.totalMemoryUsage/1024)}KB memory)`);
        
        // Check for memory pressure
        this.checkMemoryPressure();
        
        return model;
    }

    /**
     * Create a Monaco model with the appropriate strategy
     */
    async createModelWithStrategy(content, language, strategy, options, filename) {
        // Wait for Monaco to be fully initialized
        await this.initializationPromise;

        if (typeof monaco === 'undefined' || !monaco.editor) {
            throw new Error('Monaco editor is not available. Ensure it is loaded before creating models.');
        }

        const uri = filename ? monaco.Uri.parse(`file://${filename}`) : undefined;
        let model;

        try {
            // Use the provided createModel function which is now guaranteed to be set
            if (typeof this.createModelFn !== 'function') {
                 throw new Error('monaco.editor.createModel is not a function. Monaco may not be fully initialized.');
            }
            model = this.createModelFn(content, language, uri);

        } catch (error) {
            console.error(`Failed to create Monaco model for ${filename} (strategy: ${strategy}).`, error);
            // Provide a more descriptive error to help diagnose initialization issues
            if (error.message.includes('not a function')) {
                throw new Error(`Model creation failed. This often indicates a problem with Monaco Editor's initialization. Please ensure all components are loaded. Original error: ${error.message}`);
            }
            throw error;
        }

        // Apply strategy-specific optimizations
        switch (strategy) {
            case 'large':
                if (content.length > this.largeFileThreshold) {
                    this.optimizeModelForLargeFile(model, language);
                }
                break;
            case 'truncated':
                // Future: Add a marker or warning about truncation
                break;
        }

        return model;
    }

    /**
     * Optimize Monaco model settings for large files
     */
    optimizeModelForLargeFile(model, language) {
        try {
            // Disable some expensive features for large files
            if (typeof monaco !== 'undefined' && monaco.languages) {
                // Reduce validation and suggestions for very large files
                const uri = model.uri;
                
                // This is language-specific optimization
                // No longer disabling diagnostics globally.
                // This is now handled by default settings in editor.js
                // and should not be changed on a per-file basis to avoid state bugs.
            }
        } catch (error) {
            console.warn('Failed to optimize model for large file:', error);
        }
    }

    /**
     * Restore a hibernated model
     */
    restoreHibernatedModel(filename, content, language, options) {
        const hibernated = this.hibernatedModels.get(filename);
        this.hibernatedModels.delete(filename);
        
        console.log(`Restoring hibernated model for ${filename}`);
        
        // Create the model with the current content
        return this.getModel(filename, content, language, options);
    }

    /**
     * Dispose of a specific model
     * @param {string} filename - The file path
     * @param {boolean} hibernate - Whether to hibernate instead of fully disposing
     */
    disposeModel(filename, hibernate = false) {
        if (this.models.has(filename)) {
            const modelInfo = this.models.get(filename);
            
            if (hibernate && !modelInfo.isLarge) {
                // Hibernate smaller models to allow quick restoration
                this.hibernateModel(filename, modelInfo);
            } else {
                // Fully dispose large models or when not hibernating
                modelInfo.model.dispose();
                this.totalMemoryUsage -= modelInfo.size;
                this.models.delete(filename);
                
                console.log(`Disposed Monaco model for ${filename}`);
            }
        }
    }

    /**
     * Hibernate a model (save metadata but dispose model)
     */
    hibernateModel(filename, modelInfo) {
        // Save basic info for quick restoration
        this.hibernatedModels.set(filename, {
            language: modelInfo.model.getLanguageId(),
            lastAccessed: modelInfo.lastAccessed,
            size: modelInfo.size,
            strategy: modelInfo.strategy,
            truncated: modelInfo.truncated
        });

        // Dispose the actual model
        modelInfo.model.dispose();
        this.totalMemoryUsage -= modelInfo.size;
        this.models.delete(filename);
        
        console.log(`Hibernated Monaco model for ${filename}`);
    }

    /**
     * Renames a model in the manager
     * @param {string} oldFilename - The old file path
     * @param {string} newFilename - The new file path
     */
    renameModel(oldFilename, newFilename) {
        if (this.models.has(oldFilename)) {
            const modelInfo = this.models.get(oldFilename);
            this.models.delete(oldFilename);
            this.models.set(newFilename, modelInfo);
            console.log(`Renamed Monaco model from ${oldFilename} to ${newFilename}`);
        }
    }

    /**
     * Ensure we have capacity for a new model
     * @param {number} newContentSize - Size of the new content
     */
    ensureCapacity(newContentSize) {
        // Check model count limit
        while (this.models.size >= this.maxModels) {
            this.disposeOldestModel(true); // Hibernate when possible
        }

        // Check memory usage limit - more aggressive for large files
        const memoryThreshold = newContentSize > this.largeFileThreshold ? 0.7 : 0.9;
        while (this.totalMemoryUsage + newContentSize > this.maxMemoryUsage * memoryThreshold && this.models.size > 1) {
            this.disposeOldestModel(newContentSize <= this.largeFileThreshold);
        }
    }

    /**
     * Check for memory pressure and trigger callbacks
     */
    checkMemoryPressure() {
        const pressureLevel = this.totalMemoryUsage / this.maxMemoryUsage;
        
        if (pressureLevel > 0.8) {
            console.warn(`Memory pressure detected: ${Math.round(pressureLevel * 100)}%`);
            
            // Notify callbacks about memory pressure
            this.memoryPressureCallbacks.forEach(callback => {
                try {
                    callback(pressureLevel, this.getMemoryStats());
                } catch (error) {
                    console.error('Memory pressure callback error:', error);
                }
            });
            
            // Aggressive cleanup at high pressure
            if (pressureLevel > 0.9) {
                this.performAggressiveCleanup();
            }
        }
    }

    /**
     * Register callback for memory pressure events
     */
    onMemoryPressure(callback) {
        this.memoryPressureCallbacks.add(callback);
        return () => this.memoryPressureCallbacks.delete(callback);
    }

    /**
     * Perform aggressive memory cleanup
     */
    performAggressiveCleanup() {
        const modelsToHibernate = [];
        const now = Date.now();
        const RECENT_THRESHOLD = 5 * 60 * 1000; // 5 minutes
        
        // Find models that can be hibernated (not recently accessed, not large)
        for (const [filename, modelInfo] of this.models) {
            if (now - modelInfo.lastAccessed > RECENT_THRESHOLD && !modelInfo.isLarge) {
                modelsToHibernate.push(filename);
            }
        }
        
        // Hibernate up to half of eligible models
        const toHibernate = modelsToHibernate.slice(0, Math.ceil(modelsToHibernate.length / 2));
        for (const filename of toHibernate) {
            this.disposeModel(filename, true);
        }
        
        console.log(`Aggressive cleanup: hibernated ${toHibernate.length} models`);
    }

    /**
     * Dispose of the least recently used model
     * @param {boolean} hibernate - Whether to hibernate instead of fully disposing
     */
    disposeOldestModel(hibernate = false) {
        if (this.models.size === 0) return;

        let oldestFilename = null;
        let oldestTime = Date.now();

        for (const [filename, modelInfo] of this.models) {
            if (modelInfo.lastAccessed < oldestTime) {
                oldestTime = modelInfo.lastAccessed;
                oldestFilename = filename;
            }
        }

        if (oldestFilename) {
            this.disposeModel(oldestFilename, hibernate);
        }
    }

    /**
     * Update total memory usage calculation
     */
    updateMemoryUsage() {
        this.totalMemoryUsage = 0;
        for (const modelInfo of this.models.values()) {
            this.totalMemoryUsage += modelInfo.size;
        }
    }

    /**
     * Get memory usage statistics
     * @returns {Object} Memory usage stats
     */
    getMemoryStats() {
        const hibernatedSize = Array.from(this.hibernatedModels.values())
            .reduce((total, model) => total + model.size, 0);
        
        const largeModelCount = Array.from(this.models.values())
            .filter(model => model.isLarge).length;
        
        return {
            activeModels: this.models.size,
            hibernatedModels: this.hibernatedModels.size,
            largeModels: largeModelCount,
            maxModels: this.maxModels,
            memoryUsage: this.totalMemoryUsage,
            maxMemoryUsage: this.maxMemoryUsage,
            hibernatedSize,
            memoryPressure: (this.totalMemoryUsage / this.maxMemoryUsage) * 100,
            memoryUsageFormatted: `${Math.round(this.totalMemoryUsage / 1024)}KB / ${Math.round(this.maxMemoryUsage / 1024 / 1024)}MB`,
            hibernatedSizeFormatted: `${Math.round(hibernatedSize / 1024)}KB`,
            efficiency: {
                modelsPerMB: this.models.size / (this.totalMemoryUsage / 1024 / 1024),
                avgModelSize: this.models.size > 0 ? this.totalMemoryUsage / this.models.size : 0
            }
        };
    }

    /**
     * Cleanup all models (call when shutting down)
     */
    dispose() {
        for (const [filename] of this.models) {
            this.disposeModel(filename);
        }
        console.log('Monaco Model Manager disposed');
    }

    /**
     * Perform maintenance tasks (call periodically)
     */
    performMaintenance() {
        const now = Date.now();
        const MAX_IDLE_TIME = 10 * 60 * 1000; // 10 minutes
        const modelsToDispose = [];

        // Find models that haven't been accessed recently
        for (const [filename, modelInfo] of this.models) {
            if (now - modelInfo.lastAccessed > MAX_IDLE_TIME) {
                modelsToDispose.push(filename);
            }
        }

        // Dispose of idle models (but keep at least 5 models)
        for (const filename of modelsToDispose) {
            if (this.models.size > 5) {
                this.disposeModel(filename);
            }
        }

        if (modelsToDispose.length > 0) {
            console.log(`Maintenance: Disposed ${modelsToDispose.length} idle Monaco models`);
        }
    }
}

// Global instance
export const monacoModelManager = new MonacoModelManager();

// Perform maintenance every 5 minutes
setInterval(() => {
    monacoModelManager.performMaintenance();
}, 5 * 60 * 1000);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    monacoModelManager.dispose();
});
