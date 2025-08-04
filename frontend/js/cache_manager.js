 /**
 * Comprehensive caching system for expensive operations
 * Supports multiple cache strategies and automatic cleanup
 */

/**
 * Cache entry with metadata
 */
class CacheEntry {
    constructor(key, value, options = {}) {
        this.key = key;
        this.value = value;
        this.timestamp = Date.now();
        this.accessCount = 0;
        this.lastAccessed = Date.now();
        this.ttl = options.ttl || 300000; // 5 minutes default
        this.priority = options.priority || 1;
        this.size = this.calculateSize(value);
        this.tags = options.tags || [];
    }

    calculateSize(value) {
        if (typeof value === 'string') {
            return value.length * 2; // UTF-16 encoding
        }
        if (typeof value === 'object') {
            return JSON.stringify(value).length * 2;
        }
        return 64; // Default size for primitives
    }

    isExpired() {
        return Date.now() - this.timestamp > this.ttl;
    }

    access() {
        this.accessCount++;
        this.lastAccessed = Date.now();
        return this.value;
    }

    getAge() {
        return Date.now() - this.timestamp;
    }

    getIdleTime() {
        return Date.now() - this.lastAccessed;
    }
}

/**
 * Multi-level cache manager with different eviction strategies
 */
class CacheManager {
    constructor(options = {}) {
        this.maxSize = options.maxSize || 50 * 1024 * 1024; // 50MB default
        this.maxEntries = options.maxEntries || 1000;
        this.defaultTTL = options.defaultTTL || 300000; // 5 minutes
        this.cleanupInterval = options.cleanupInterval || 60000; // 1 minute
        
        // Cache storage
        this.cache = new Map();
        this.currentSize = 0;
        
        // Statistics
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            cleanups: 0,
            totalSize: 0,
            entries: 0
        };

        // Cache levels with different strategies
        this.levels = {
            memory: { maxSize: this.maxSize * 0.7, strategy: 'lru' },
            persistent: { maxSize: this.maxSize * 0.3, strategy: 'lfu' }
        };

        // Start cleanup timer
        this.startCleanupTimer();
    }

    /**
     * Generate cache key from parameters
     */
    generateKey(namespace, operation, params) {
        const paramString = typeof params === 'object' ? 
            JSON.stringify(params, Object.keys(params).sort()) : 
            String(params);
        return `${namespace}:${operation}:${this.hashString(paramString)}`;
    }

    /**
     * Simple hash function for cache keys
     */
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * Set cache entry
     */
    set(key, value, options = {}) {
        // Remove existing entry if present
        if (this.cache.has(key)) {
            this.delete(key);
        }

        const entry = new CacheEntry(key, value, {
            ttl: options.ttl || this.defaultTTL,
            priority: options.priority || 1,
            tags: options.tags || []
        });

        // Check if we need to make space
        this.ensureSpace(entry.size);

        // Add entry
        this.cache.set(key, entry);
        this.currentSize += entry.size;
        this.updateStats();

        return true;
    }

    /**
     * Get cache entry
     */
    get(key) {
        const entry = this.cache.get(key);
        
        if (!entry) {
            this.stats.misses++;
            return null;
        }

        if (entry.isExpired()) {
            this.delete(key);
            this.stats.misses++;
            return null;
        }

        this.stats.hits++;
        return entry.access();
    }

    /**
     * Check if key exists and is valid
     */
    has(key) {
        const entry = this.cache.get(key);
        return entry && !entry.isExpired();
    }

    /**
     * Delete cache entry
     */
    delete(key) {
        const entry = this.cache.get(key);
        if (entry) {
            this.cache.delete(key);
            this.currentSize -= entry.size;
            this.updateStats();
            return true;
        }
        return false;
    }

    /**
     * Clear cache by tags
     */
    clearByTags(tags) {
        const tagsSet = new Set(Array.isArray(tags) ? tags : [tags]);
        let cleared = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (entry.tags.some(tag => tagsSet.has(tag))) {
                this.delete(key);
                cleared++;
            }
        }

        return cleared;
    }

    /**
     * Clear all cache entries
     */
    clear() {
        const count = this.cache.size;
        this.cache.clear();
        this.currentSize = 0;
        this.updateStats();
        return count;
    }

    /**
     * Clear cache by a specific key
     */
    clearByKey(key) {
        if (this.cache.has(key)) {
            this.delete(key);
            return true;
        }
        return false;
    }

    /**
     * Ensure there's enough space for new entry
     */
    ensureSpace(requiredSize) {
        // Check entry count limit
        if (this.cache.size >= this.maxEntries) {
            this.evictEntries(Math.ceil(this.maxEntries * 0.1)); // Remove 10%
        }

        // Check size limit
        while (this.currentSize + requiredSize > this.maxSize && this.cache.size > 0) {
            this.evictLeastValuable();
        }
    }

    /**
     * Evict least valuable entries
     */
    evictEntries(count) {
        const entries = Array.from(this.cache.entries())
            .map(([key, entry]) => ({ key, entry }))
            .sort((a, b) => this.calculateValue(a.entry) - this.calculateValue(b.entry));

        for (let i = 0; i < Math.min(count, entries.length); i++) {
            this.delete(entries[i].key);
            this.stats.evictions++;
        }
    }

    /**
     * Evict single least valuable entry
     */
    evictLeastValuable() {
        let leastValuable = null;
        let lowestValue = Infinity;

        for (const [key, entry] of this.cache.entries()) {
            const value = this.calculateValue(entry);
            if (value < lowestValue) {
                lowestValue = value;
                leastValuable = key;
            }
        }

        if (leastValuable) {
            this.delete(leastValuable);
            this.stats.evictions++;
        }
    }

    /**
     * Calculate entry value for eviction decisions
     */
    calculateValue(entry) {
        const age = entry.getAge();
        const idleTime = entry.getIdleTime();
        const frequency = entry.accessCount;
        const priority = entry.priority;

        // Higher value = more valuable = less likely to be evicted
        // Factors: frequency of access, priority, recency of access, age
        return (frequency * priority * 1000) / (Math.sqrt(age) + Math.sqrt(idleTime));
    }

    /**
     * Cleanup expired entries
     */
    cleanup() {
        let cleaned = 0;
        const now = Date.now();

        for (const [key, entry] of this.cache.entries()) {
            if (entry.isExpired()) {
                this.delete(key);
                cleaned++;
            }
        }

        this.stats.cleanups++;
        return cleaned;
    }

    /**
     * Start automatic cleanup timer
     */
    startCleanupTimer() {
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.cleanupInterval);
    }

    /**
     * Stop cleanup timer
     */
    stopCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /**
     * Update statistics
     */
    updateStats() {
        this.stats.totalSize = this.currentSize;
        this.stats.entries = this.cache.size;
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const hitRate = this.stats.hits + this.stats.misses > 0 ? 
            (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100 : 0;

        return {
            ...this.stats,
            hitRate: hitRate.toFixed(2) + '%',
            averageEntrySize: this.cache.size > 0 ? Math.round(this.currentSize / this.cache.size) : 0,
            memoryUsage: ((this.currentSize / this.maxSize) * 100).toFixed(2) + '%',
            entryUsage: ((this.cache.size / this.maxEntries) * 100).toFixed(2) + '%'
        };
    }

    /**
     * Get cache entries by pattern
     */
    getByPattern(pattern) {
        const regex = new RegExp(pattern);
        const matches = [];

        for (const [key, entry] of this.cache.entries()) {
            if (regex.test(key) && !entry.isExpired()) {
                matches.push({
                    key,
                    value: entry.value,
                    metadata: {
                        timestamp: entry.timestamp,
                        accessCount: entry.accessCount,
                        lastAccessed: entry.lastAccessed,
                        size: entry.size,
                        tags: entry.tags
                    }
                });
            }
        }

        return matches;
    }

    /**
     * Warm up cache with common operations
     */
    async warmUp(operations = []) {
        const promises = operations.map(async (op) => {
            try {
                const key = this.generateKey(op.namespace, op.operation, op.params);
                if (!this.has(key) && op.generator) {
                    const value = await op.generator();
                    this.set(key, value, { 
                        ttl: op.ttl,
                        priority: op.priority || 2,
                        tags: ['warmup', ...(op.tags || [])]
                    });
                }
            } catch (error) {
                console.warn(`Cache warmup failed for ${op.namespace}:${op.operation}:`, error);
            }
        });

        await Promise.allSettled(promises);
    }

    /**
     * Export cache data for persistence
     */
    export() {
        const data = [];
        
        for (const [key, entry] of this.cache.entries()) {
            if (!entry.isExpired()) {
                data.push({
                    key,
                    value: entry.value,
                    timestamp: entry.timestamp,
                    ttl: entry.ttl,
                    priority: entry.priority,
                    tags: entry.tags,
                    accessCount: entry.accessCount
                });
            }
        }

        return {
            data,
            stats: this.getStats(),
            exportTime: new Date().toISOString()
        };
    }

    /**
     * Import cache data from persistence
     */
    import(exportData) {
        if (!exportData || !exportData.data) {
            return false;
        }

        let imported = 0;
        const now = Date.now();

        for (const item of exportData.data) {
            // Check if entry is still valid
            const age = now - item.timestamp;
            if (age < item.ttl) {
                const remainingTTL = item.ttl - age;
                this.set(item.key, item.value, {
                    ttl: remainingTTL,
                    priority: item.priority,
                    tags: item.tags
                });
                
                // Restore access count
                const entry = this.cache.get(item.key);
                if (entry) {
                    entry.accessCount = item.accessCount;
                }
                
                imported++;
            }
        }

        return imported;
    }

    /**
     * Destroy cache manager
     */
    destroy() {
        this.stopCleanupTimer();
        this.clear();
    }
}

/**
 * Specialized cache for different operation types
 */
class OperationCache {
    constructor(cacheManager) {
        this.cache = cacheManager;
    }

    /**
     * Cache AST parsing results
     */
    async cacheAST(filename, content, parser) {
        const key = this.cache.generateKey('ast', 'parse', { filename, contentHash: this.cache.hashString(content) });
        
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }

        const ast = await parser(content, filename);
        this.cache.set(key, ast, {
            ttl: 600000, // 10 minutes
            priority: 3,
            tags: ['ast', 'parse', filename.split('.').pop()]
        });

        return ast;
    }

    /**
     * Cache symbol resolution results
     */
    async cacheSymbols(filename, content, resolver) {
        const key = this.cache.generateKey('symbols', 'resolve', { filename, contentHash: this.cache.hashString(content) });
        
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }

        const symbols = await resolver(content, filename);
        this.cache.set(key, symbols, {
            ttl: 300000, // 5 minutes
            priority: 2,
            tags: ['symbols', 'resolve', filename.split('.').pop()]
        });

        return symbols;
    }

    /**
     * Cache file validation results
     */
    async cacheValidation(filename, content, validator) {
        const key = this.cache.generateKey('validation', 'validate', { filename, contentHash: this.cache.hashString(content) });
        
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }

        const validation = await validator(content, filename);
        this.cache.set(key, validation, {
            ttl: 180000, // 3 minutes
            priority: 1,
            tags: ['validation', filename.split('.').pop()]
        });

        return validation;
    }

    /**
     * Cache search results
     */
    async cacheSearch(pattern, files, searcher) {
        const key = this.cache.generateKey('search', 'pattern', { pattern, files: files.length });
        
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }

        const results = await searcher(pattern, files);
        this.cache.set(key, results, {
            ttl: 120000, // 2 minutes
            priority: 1,
            tags: ['search', 'pattern']
        });

        return results;
    }

    /**
     * Invalidate cache by file
     */
    invalidateFile(filename) {
        const astKey = this.cache.generateKey('ast', 'parse', { filename, contentHash: this.cache.hashString('') });
        const symbolsKey = this.cache.generateKey('symbols', 'resolve', { filename, contentHash: this.cache.hashString('') });
        const validationKey = this.cache.generateKey('validation', 'validate', { filename, contentHash: this.cache.hashString('') });
        
        // Invalidate by tags first
        const clearedByTags = this.cache.clearByTags([filename, filename.split('.').pop()]);

        // Also clear by known key patterns for this file
        this.cache.clearByKey(astKey);
        this.cache.clearByKey(symbolsKey);
        this.cache.clearByKey(validationKey);

        return clearedByTags;
    }

    /**
     * Invalidate cache by operation type
     */
    invalidateOperation(operation) {
        return this.cache.clearByTags([operation]);
    }
}

// Create singleton instances
export const cacheManager = new CacheManager({
    maxSize: 100 * 1024 * 1024, // 100MB
    maxEntries: 2000,
    defaultTTL: 300000, // 5 minutes
    cleanupInterval: 30000 // 30 seconds
});

export const operationCache = new OperationCache(cacheManager);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    cacheManager.destroy();
});

// Export cache data periodically for persistence
setInterval(() => {
    try {
        const exportData = cacheManager.export();
        localStorage.setItem('cacheSnapshot', JSON.stringify(exportData));
    } catch (error) {
        console.warn('Failed to save cache snapshot:', error);
    }
}, 300000); // Every 5 minutes

// Import cache data on startup
try {
    const savedData = localStorage.getItem('cacheSnapshot');
    if (savedData) {
        const exportData = JSON.parse(savedData);
        const imported = cacheManager.import(exportData);
        console.log(`Restored ${imported} cache entries from previous session`);
    }
} catch (error) {
    console.warn('Failed to restore cache from previous session:', error);
}