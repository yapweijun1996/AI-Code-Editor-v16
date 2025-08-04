/**
 * Advanced Performance Profiler
 * Provides comprehensive performance monitoring and baseline metrics
 */
export class PerformanceProfiler {
    constructor() {
        this.metrics = new Map();
        this.baselines = new Map();
        this.observers = [];
        this.config = {
            enableMemoryTracking: true,
            enableRenderTracking: true,
            sampleRate: 1.0, // Sample 100% of events by default
            alertThresholds: {
                slowOperation: 1000, // 1 second
                memoryLeak: 100 * 1024 * 1024, // 100MB (more reasonable for this app)
                renderDelay: 16.67 // > 60fps
            }
        };
        
        this.initialize();
    }

    initialize() {
        // Set up performance observers
        if ('PerformanceObserver' in window) {
            this.setupPerformanceObserver();
        }
        
        // Set up memory monitoring
        if (performance.memory) {
            this.startMemoryMonitoring();
        }
        
        // Monitor long tasks
        this.setupLongTaskMonitoring();
        
        console.log('[PerformanceProfiler] Initialized with comprehensive monitoring');
    }

    setupPerformanceObserver() {
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    this.recordEntry(entry);
                }
            });
            
            observer.observe({ entryTypes: ['measure', 'navigation', 'resource', 'paint'] });
            this.observers.push(observer);
        } catch (error) {
            console.warn('[PerformanceProfiler] PerformanceObserver not fully supported:', error);
        }
    }

    setupLongTaskMonitoring() {
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    this.recordLongTask(entry);
                }
            });
            
            observer.observe({ entryTypes: ['longtask'] });
            this.observers.push(observer);
        } catch (error) {
            console.warn('[PerformanceProfiler] Long task monitoring not supported:', error);
        }
    }

    startMemoryMonitoring() {
        setInterval(() => {
            if (Math.random() < this.config.sampleRate) {
                this.recordMemoryUsage();
            }
        }, 5000); // Every 5 seconds
    }

    /**
     * Start timing an operation
     */
    startTimer(operationName, metadata = {}) {
        const startTime = performance.now();
        const timerId = `${operationName}_${Date.now()}_${Math.random()}`;
        
        this.metrics.set(timerId, {
            operation: operationName,
            startTime,
            metadata,
            type: 'timer'
        });
        
        return timerId;
    }

    /**
     * End timing an operation
     */
    endTimer(timerId) {
        const metric = this.metrics.get(timerId);
        if (!metric) {
            console.warn(`[PerformanceProfiler] Timer ${timerId} not found`);
            return null;
        }

        const endTime = performance.now();
        const duration = endTime - metric.startTime;
        
        metric.endTime = endTime;
        metric.duration = duration;
        
        // Record the measurement
        this.recordMetric(metric.operation, 'duration', duration, metric.metadata);
        
        // Check for performance alerts
        this.checkPerformanceAlert(metric.operation, duration);
        
        this.metrics.delete(timerId);
        return duration;
    }

    /**
     * Record a custom metric
     */
    recordMetric(category, metricName, value, metadata = {}) {
        const key = `${category}.${metricName}`;
        
        if (!this.metrics.has(key)) {
            this.metrics.set(key, {
                category,
                name: metricName,
                values: [],
                count: 0,
                sum: 0,
                min: Infinity,
                max: -Infinity,
                average: 0
            });
        }
        
        const metric = this.metrics.get(key);
        metric.values.push({ value, timestamp: Date.now(), metadata });
        metric.count++;
        metric.sum += value;
        metric.min = Math.min(metric.min, value);
        metric.max = Math.max(metric.max, value);
        metric.average = metric.sum / metric.count;
        
        // Keep only last 1000 values to prevent memory issues
        if (metric.values.length > 1000) {
            metric.values.shift();
        }
    }

    recordEntry(entry) {
        const category = `browser.${entry.entryType}`;
        
        switch (entry.entryType) {
            case 'navigation':
                this.recordMetric(category, 'domContentLoaded', entry.domContentLoadedEventEnd - entry.domContentLoadedEventStart);
                this.recordMetric(category, 'loadComplete', entry.loadEventEnd - entry.loadEventStart);
                break;
            case 'resource':
                this.recordMetric(category, 'resourceLoad', entry.duration, { name: entry.name });
                break;
            case 'paint':
                this.recordMetric(category, entry.name, entry.startTime);
                break;
            case 'measure':
                this.recordMetric('custom', entry.name, entry.duration);
                break;
        }
    }

    recordLongTask(entry) {
        this.recordMetric('performance', 'longTask', entry.duration, {
            startTime: entry.startTime,
            attribution: entry.attribution
        });
        
        console.warn(`[PerformanceProfiler] Long task detected: ${entry.duration}ms`);
    }

    recordMemoryUsage() {
        if (!performance.memory) return;
        
        const memory = performance.memory;
        this.recordMetric('memory', 'usedJSHeapSize', memory.usedJSHeapSize);
        this.recordMetric('memory', 'totalJSHeapSize', memory.totalJSHeapSize);
        this.recordMetric('memory', 'jsHeapSizeLimit', memory.jsHeapSizeLimit);
        
        // Check for memory alerts
        if (memory.usedJSHeapSize > this.config.alertThresholds.memoryLeak) {
            console.warn(`[PerformanceProfiler] High memory usage: ${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`);
        }
    }

    checkPerformanceAlert(operation, duration) {
        if (duration > this.config.alertThresholds.slowOperation) {
            console.warn(`[PerformanceProfiler] Slow operation detected: ${operation} took ${duration.toFixed(2)}ms`);
        }
    }

    /**
     * Set baseline metrics for comparison
     */
    setBaseline(category, values) {
        this.baselines.set(category, {
            timestamp: Date.now(),
            values: { ...values }
        });
        console.log(`[PerformanceProfiler] Baseline set for ${category}:`, values);
    }

    /**
     * Compare current metrics against baseline
     */
    compareToBaseline(category) {
        const baseline = this.baselines.get(category);
        if (!baseline) {
            console.warn(`[PerformanceProfiler] No baseline found for ${category}`);
            return null;
        }

        const comparison = {};
        for (const [key, baselineValue] of Object.entries(baseline.values)) {
            const currentMetric = this.metrics.get(`${category}.${key}`);
            if (currentMetric) {
                const currentValue = currentMetric.average;
                const improvement = ((baselineValue - currentValue) / baselineValue * 100);
                comparison[key] = {
                    baseline: baselineValue,
                    current: currentValue,
                    improvement: improvement.toFixed(2) + '%',
                    better: improvement > 0
                };
            }
        }
        
        return comparison;
    }

    /**
     * Generate comprehensive performance report
     */
    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalMetrics: this.metrics.size,
                totalBaselines: this.baselines.size,
                memoryUsage: performance.memory ? {
                    used: (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + 'MB',
                    total: (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + 'MB',
                    limit: (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + 'MB'
                } : 'Not available'
            },
            metrics: {},
            baselines: {},
            comparisons: {}
        };

        // Add metrics
        for (const [key, metric] of this.metrics.entries()) {
            if (metric.values) {
                report.metrics[key] = {
                    count: metric.count,
                    average: metric.average.toFixed(2),
                    min: metric.min.toFixed(2),
                    max: metric.max.toFixed(2),
                    latest: metric.values[metric.values.length - 1]?.value.toFixed(2)
                };
            }
        }

        // Add baseline comparisons
        for (const category of this.baselines.keys()) {
            const comparison = this.compareToBaseline(category);
            if (comparison) {
                report.comparisons[category] = comparison;
            }
        }

        return report;
    }

    /**
     * Export metrics for external analysis
     */
    exportMetrics() {
        return {
            metrics: Array.from(this.metrics.entries()).map(([key, value]) => ({
                key,
                ...value
            })),
            baselines: Array.from(this.baselines.entries()).map(([key, value]) => ({
                key,
                ...value
            }))
        };
    }

    /**
     * Clear all metrics (useful for testing)
     */
    clear() {
        this.metrics.clear();
        this.baselines.clear();
        console.log('[PerformanceProfiler] All metrics cleared');
    }

    /**
     * Cleanup observers
     */
    destroy() {
        this.observers.forEach(observer => observer.disconnect());
        this.observers = [];
        this.clear();
        console.log('[PerformanceProfiler] Destroyed');
    }
}

// Create global instance
export const performanceProfiler = new PerformanceProfiler();

// Auto-create baseline on load
window.addEventListener('load', () => {
    setTimeout(() => {
        // Establish initial baseline metrics
        performanceProfiler.setBaseline('initial', {
            loadTime: performance.timing.loadEventEnd - performance.timing.navigationStart,
            domContentLoaded: performance.timing.domContentLoadedEventEnd - performance.timing.domContentLoadedEventStart,
            memoryUsed: performance.memory ? performance.memory.usedJSHeapSize : 0
        });
    }, 1000);
});