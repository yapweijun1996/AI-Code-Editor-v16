/**
 * Operation Cache System
 * Provides intelligent caching for expensive operations like AST parsing,
 * symbol resolution, and code analysis with LRU eviction and cache invalidation
 */

/**
 * Cache entry with metadata
 */
class CacheEntry {
    constructor(key, value, options = {}) {
        this.key = key;
        this.value = value;
        this.timestamp = Date.now();
        this.lastAccessed = Date.now();
        this.accessCount = 1;
        this.size = this.calculateSize(value);
        this.ttl = options.ttl || 0; // Time to live in milliseconds (0 = no expiry)
        this.dependencies = options.dependencies || []; // File paths this cache depends on
        this.computationTime = options.computationTime || 0;
        this.tags = options.tags || []; // Tags for batch invalidation
    }

    /**
     * Calculate approximate size of cached value
     */
    calculateSize(value) {
        if (typeof value === 'string') {
            return value.length * 2; // UTF-16 encoding
        }
        
        if (typeof value === 'object' && value !== null) {
            try {
                return JSON.stringify(value).length * 2;
            } catch (error) {
                return 1024; // Fallback estimate
            }
        }
        
        return 64; // Default size for primitives
    }

    /**
     * Check if entry is expired
     */
    isExpired() {
        if (this.ttl === 0) return false;
        return Date.now() - this.timestamp > this.ttl;
    }

    /**
     * Update access information
     */
    touch() {
        this.lastAccessed = Date.now();
        this.accessCount++;
    }

    /**
     * Get cache efficiency score (higher = more valuable to keep)
     */
    getEfficiencyScore() {
        const age = Date.now() - this.timestamp;
        const timeSinceLast = Date.now() - this.lastAccessed;
        
        // Factors: access frequency, recency, computation time saved, size penalty
        const frequencyScore = this.accessCount / (age / (1000 * 60 * 60)); // accesses per hour
        const recencyScore = Math.max(0, 100 - (timeSinceLast / (1000 * 60))); // minutes since last access
        const computationScore = Math.min(this.computationTime / 1000, 10); // computation time in seconds, capped at 10
        const sizePenalty = this.size / (1024 * 1024); // Size in MB
        
        return frequencyScore * 10 + recencyScore + computationScore - sizePenalty;
    }
}

/**
 * Advanced LRU Cache with dependency tracking and intelligent eviction
 */
export class OperationCache {
    constructor(options = {}) {
        this.maxSize = options.maxSize || 100 * 1024 * 1024; // 100MB default
        this.maxEntries = options.maxEntries || 1000;
        this.cache = new Map();
        this.fileModTimes = new Map(); // Track file modification times
        this.currentSize = 0;
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            invalidations: 0,
            computationTimeSaved: 0
        };
        
        // Start periodic maintenance
        this.maintenanceInterval = setInterval(() => {
            this.performMaintenance();
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    /**
     * Generate cache key from operation parameters
     */
    generateKey(operation, params) {
        const keyData = {
            operation,
            params: this.normalizeParams(params)
        };
        
        return JSON.stringify(keyData);
    }

    /**
     * Normalize parameters for consistent key generation
     */
    normalizeParams(params) {
        if (typeof params !== 'object' || params === null) {
            return params;
        }
        
        const normalized = {};
        const keys = Object.keys(params).sort();
        
        for (const key of keys) {
            if (typeof params[key] === 'object' && params[key] !== null) {
                normalized[key] = this.normalizeParams(params[key]);
            } else {
                normalized[key] = params[key];
            }
        }
        
        return normalized;
    }

    /**
     * Get cached value
     */
    get(operation, params) {
        const key = this.generateKey(operation, params);
        const entry = this.cache.get(key);
        
        if (!entry) {
            this.stats.misses++;
            return null;
        }
        
        // Check if expired
        if (entry.isExpired()) {
            this.delete(key);
            this.stats.misses++;
            return null;
        }
        
        // Check if dependencies are still valid
        if (!this.areDependenciesValid(entry)) {
            this.delete(key);
            this.stats.invalidations++;
            this.stats.misses++;
            return null;
        }
        
        // Update access information
        entry.touch();
        this.stats.hits++;
        this.stats.computationTimeSaved += entry.computationTime;
        
        return entry.value;
    }

    /**
     * Set cached value
     */
    set(operation, params, value, options = {}) {
        const key = this.generateKey(operation, params);
        const startTime = options.computationStartTime || Date.now();
        const computationTime = Date.now() - startTime;
        
        const entry = new CacheEntry(key, value, {
            ...options,
            computationTime
        });
        
        // Track file dependencies
        if (options.dependencies) {
            for (const filePath of options.dependencies) {
                this.trackFileDependency(filePath);
            }
        }
        
        // Remove existing entry if present
        if (this.cache.has(key)) {
            const oldEntry = this.cache.get(key);
            this.currentSize -= oldEntry.size;
        }
        
        // Ensure capacity
        this.ensureCapacity(entry.size);
        
        // Add new entry
        this.cache.set(key, entry);
        this.currentSize += entry.size;
        
        return value;
    }

    /**
     * Track file modification time for dependency checking
     */
    trackFileDependency(filePath) {
        // In a browser environment, we can't directly access file system
        // This would need integration with the File System Access API
        // For now, we'll use a simple timestamp approach
        if (!this.fileModTimes.has(filePath)) {
            this.fileModTimes.set(filePath, Date.now());
        }
    }

    /**
     * Check if file dependencies are still valid
     */
    areDependenciesValid(entry) {
        for (const filePath of entry.dependencies) {
            const cachedModTime = this.fileModTimes.get(filePath);
            if (!cachedModTime) {
                return false; // Dependency no longer tracked
            }
            
            // In a real implementation, you'd check actual file modification time
            // For now, we assume dependencies are valid for 10 minutes
            if (Date.now() - cachedModTime > 10 * 60 * 1000) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Invalidate cache entries by file path
     */
    invalidateByFile(filePath) {
        let invalidated = 0;
        
        for (const [key, entry] of this.cache) {
            if (entry.dependencies.includes(filePath)) {
                this.delete(key);
                invalidated++;
            }
        }
        
        // Update file modification time
        this.fileModTimes.set(filePath, Date.now());
        this.stats.invalidations += invalidated;
        
        return invalidated;
    }

    /**
     * Invalidate cache entries by tags
     */
    invalidateByTags(tags) {
        let invalidated = 0;
        
        for (const [key, entry] of this.cache) {
            if (tags.some(tag => entry.tags.includes(tag))) {
                this.delete(key);
                invalidated++;
            }
        }
        
        this.stats.invalidations += invalidated;
        return invalidated;
    }

    /**
     * Delete cache entry
     */
    delete(key) {
        const entry = this.cache.get(key);
        if (entry) {
            this.cache.delete(key);
            this.currentSize -= entry.size;
            return true;
        }
        return false;
    }

    /**
     * Ensure cache has capacity for new entry
     */
    ensureCapacity(newEntrySize) {
        // Check size limit
        while (this.currentSize + newEntrySize > this.maxSize && this.cache.size > 0) {
            this.evictLeastEfficient();
        }
        
        // Check entry count limit
        while (this.cache.size >= this.maxEntries) {
            this.evictLeastEfficient();
        }
    }

    /**
     * Evict least efficient cache entry
     */
    evictLeastEfficient() {
        if (this.cache.size === 0) return;
        
        let leastEfficient = null;
        let lowestScore = Infinity;
        
        for (const [key, entry] of this.cache) {
            const score = entry.getEfficiencyScore();
            if (score < lowestScore) {
                lowestScore = score;
                leastEfficient = key;
            }
        }
        
        if (leastEfficient) {
            this.delete(leastEfficient);
            this.stats.evictions++;
        }
    }

    /**
     * Perform periodic maintenance
     */
    performMaintenance() {
        const before = this.cache.size;
        
        // Remove expired entries
        for (const [key, entry] of this.cache) {
            if (entry.isExpired()) {
                this.delete(key);
            }
        }
        
        // Clean up old file modification times
        const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
        for (const [filePath, modTime] of this.fileModTimes) {
            if (modTime < cutoff) {
                this.fileModTimes.delete(filePath);
            }
        }
        
        const after = this.cache.size;
        if (before !== after) {
            console.log(`Cache maintenance: removed ${before - after} expired entries`);
        }
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const hitRate = this.stats.hits / (this.stats.hits + this.stats.misses) * 100;
        
        return {
            ...this.stats,
            hitRate: isNaN(hitRate) ? 0 : hitRate,
            entries: this.cache.size,
            currentSize: this.currentSize,
            maxSize: this.maxSize,
            utilization: (this.currentSize / this.maxSize) * 100,
            avgEntrySize: this.cache.size > 0 ? this.currentSize / this.cache.size : 0
        };
    }

    /**
     * Clear all cache entries
     */
    clear() {
        this.cache.clear();
        this.fileModTimes.clear();
        this.currentSize = 0;
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            invalidations: 0,
            computationTimeSaved: 0
        };
    }

    /**
     * Dispose of cache and stop maintenance
     */
    dispose() {
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
            this.maintenanceInterval = null;
        }
        this.clear();
    }
}

/**
 * Specialized caches for different types of operations
 */
export class SpecializedCaches {
    constructor() {
        this.parseCache = new OperationCache({
            maxSize: 50 * 1024 * 1024, // 50MB for AST parsing
            maxEntries: 500
        });
        
        this.symbolCache = new OperationCache({
            maxSize: 25 * 1024 * 1024, // 25MB for symbol resolution
            maxEntries: 1000
        });
        
        this.metricsCache = new OperationCache({
            maxSize: 10 * 1024 * 1024, // 10MB for code metrics
            maxEntries: 2000
        });
        
        this.searchCache = new OperationCache({
            maxSize: 15 * 1024 * 1024, // 15MB for search results
            maxEntries: 500
        });
    }

    /**
     * Cache parsed AST
     */
    cacheParseResult(filePath, fileContent, parseResult) {
        const contentHash = this.hashContent(fileContent);
        return this.parseCache.set('parse', { filePath, contentHash }, parseResult, {
            dependencies: [filePath],
            tags: ['parse', 'ast'],
            ttl: 30 * 60 * 1000 // 30 minutes
        });
    }

    /**
     * Get cached parse result
     */
    getCachedParseResult(filePath, fileContent) {
        const contentHash = this.hashContent(fileContent);
        return this.parseCache.get('parse', { filePath, contentHash });
    }

    /**
     * Cache symbol resolution result
     */
    cacheSymbolResult(filePath, symbolName, resolutionResult) {
        return this.symbolCache.set('symbol', { filePath, symbolName }, resolutionResult, {
            dependencies: [filePath],
            tags: ['symbol', 'resolution'],
            ttl: 20 * 60 * 1000 // 20 minutes
        });
    }

    /**
     * Get cached symbol result
     */
    getCachedSymbolResult(filePath, symbolName) {
        return this.symbolCache.get('symbol', { filePath, symbolName });
    }

    /**
     * Cache metrics calculation
     */
    cacheMetricsResult(filePath, fileContent, metricsResult) {
        const contentHash = this.hashContent(fileContent);
        return this.metricsCache.set('metrics', { filePath, contentHash }, metricsResult, {
            dependencies: [filePath],
            tags: ['metrics', 'analysis'],
            ttl: 60 * 60 * 1000 // 1 hour
        });
    }

    /**
     * Get cached metrics result
     */
    getCachedMetricsResult(filePath, fileContent) {
        const contentHash = this.hashContent(fileContent);
        return this.metricsCache.get('metrics', { filePath, contentHash });
    }

    /**
     * Cache search results
     */
    cacheSearchResult(query, searchScope, searchResult) {
        return this.searchCache.set('search', { query, searchScope }, searchResult, {
            tags: ['search'],
            ttl: 10 * 60 * 1000 // 10 minutes
        });
    }

    /**
     * Get cached search result
     */
    getCachedSearchResult(query, searchScope) {
        return this.searchCache.get('search', { query, searchScope });
    }

    /**
     * Simple content hashing for cache keys
     */
    hashContent(content) {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(36);
    }

    /**
     * Invalidate all caches for a file
     */
    invalidateFile(filePath) {
        let total = 0;
        total += this.parseCache.invalidateByFile(filePath);
        total += this.symbolCache.invalidateByFile(filePath);
        total += this.metricsCache.invalidateByFile(filePath);
        
        // Search cache doesn't depend on specific files, so we clear it entirely
        this.searchCache.clear();
        
        return total;
    }

    /**
     * Get combined statistics
     */
    getStats() {
        return {
            parse: this.parseCache.getStats(),
            symbol: this.symbolCache.getStats(),
            metrics: this.metricsCache.getStats(),
            search: this.searchCache.getStats()
        };
    }

    /**
     * Clear all caches
     */
    clearAll() {
        this.parseCache.clear();
        this.symbolCache.clear();
        this.metricsCache.clear();
        this.searchCache.clear();
    }

    /**
     * Dispose of all caches
     */
    dispose() {
        this.parseCache.dispose();
        this.symbolCache.dispose();
        this.metricsCache.dispose();
        this.searchCache.dispose();
    }
}

// Global cache instances
export const operationCache = new OperationCache();
export const specializedCaches = new SpecializedCaches();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    operationCache.dispose();
    specializedCaches.dispose();
});