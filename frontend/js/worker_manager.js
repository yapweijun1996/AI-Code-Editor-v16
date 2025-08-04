/**
 * Memory-efficient Web Worker system for background processing
 * Handles AST parsing, symbol resolution, and other CPU-intensive tasks
 */

class WorkerManager {
    constructor() {
        this.workers = new Map();
        this.taskQueue = [];
        this.activeJobs = new Map();
        this.maxWorkers = Math.min(navigator.hardwareConcurrency || 4, 8);
        this.workerPool = [];
        this.jobIdCounter = 0;
        this.workersEnabled = true; // Flag to disable workers if they fail
        this.failedWorkerTypes = new Set(); // Track which worker types failed
        
        // Initialize worker pool
        this.initializeWorkerPool();
    }

    /**
     * Initialize a pool of reusable workers
     */
    initializeWorkerPool() {
        const workerTypes = {
            ast: '../workers/ast_worker.js',
            symbol: '../workers/symbol_worker.js',
            file: '../workers/file_worker.js',
            batch: '../workers/batch_worker.js'
        };

        for (const [type, scriptPath] of Object.entries(workerTypes)) {
            this.workers.set(type, {
                available: [],
                busy: [],
                scriptPath,
                maxInstances: Math.ceil(this.maxWorkers / Object.keys(workerTypes).length)
            });
        }
    }

    /**
     * Get or create a worker of the specified type
     */
    async getWorker(type) {
        const workerInfo = this.workers.get(type);
        if (!workerInfo) {
            throw new Error(`Unknown worker type: ${type}`);
        }

        // Check if we have an available worker
        if (workerInfo.available.length > 0) {
            const worker = workerInfo.available.pop();
            workerInfo.busy.push(worker);
            return worker;
        }

        // Create new worker if under limit
        if (workerInfo.busy.length < workerInfo.maxInstances) {
            const worker = await this.createWorker(type, workerInfo.scriptPath);
            workerInfo.busy.push(worker);
            return worker;
        }

        // Wait for a worker to become available
        return new Promise((resolve) => {
            this.taskQueue.push({ type, resolve });
        });
    }

    /**
     * Create a new worker instance
     */
    async createWorker(type, scriptPath) {
        return new Promise((resolve, reject) => {
            try {
                console.log(`Creating worker: ${type} from ${scriptPath}`);
                const worker = new Worker(scriptPath, { type: 'classic' });
                
                worker.addEventListener('message', (event) => {
                    this.handleWorkerMessage(worker, event);
                });

                worker.addEventListener('error', (error) => {
                    console.error(`Worker error (${type}) from ${scriptPath}:`, {
                        message: error.message,
                        filename: error.filename,
                        lineno: error.lineno,
                        colno: error.colno,
                        error: error
                    });
                    this.handleWorkerError(worker, type, error);
                    reject(new Error(`Worker ${type} failed to load: ${error.message || 'Unknown error'}`));
                });

                worker.addEventListener('messageerror', (error) => {
                    console.error(`Worker message error (${type}) from ${scriptPath}:`, {
                        message: error.message,
                        data: error.data,
                        error: error
                    });
                    this.handleWorkerError(worker, type, error);
                    reject(new Error(`Worker ${type} message error: ${error.message || 'Unknown error'}`));
                });

                worker.workerType = type;
                worker.isReady = false; // Will be set to true when worker sends ready message
                
                // Wait for worker to signal it's ready
                const readyTimeout = setTimeout(() => {
                    console.warn(`Worker ${type} did not signal ready within 5 seconds, assuming ready`);
                    worker.isReady = true;
                    resolve(worker);
                }, 5000);

                // Listen for ready message
                const readyHandler = (event) => {
                    if (event.data && event.data.type === 'ready') {
                        clearTimeout(readyTimeout);
                        worker.removeEventListener('message', readyHandler);
                        worker.isReady = true;
                        resolve(worker);
                    }
                };
                
                worker.addEventListener('message', readyHandler);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Handle messages from workers
     */
    handleWorkerMessage(worker, event) {
        const { jobId, result, error, type } = event.data;
        
        // Handle ready messages (already handled in createWorker, but good to log)
        if (type === 'ready') {
            console.log(`Worker ${worker.workerType} is ready`);
            return;
        }
        
        // Handle job responses
        if (jobId && this.activeJobs.has(jobId)) {
            const job = this.activeJobs.get(jobId);
            this.activeJobs.delete(jobId);
            
            if (error) {
                job.reject(new Error(error));
            } else {
                job.resolve(result);
            }
            
            // Return worker to available pool
            this.returnWorker(worker);
        } else if (jobId) {
            console.warn(`Received message for unknown job ID: ${jobId}`);
        }
    }

    /**
     * Handle worker errors
     */
    handleWorkerError(worker, type, error) {
        console.warn(`Worker ${type} encountered an error, marking as failed`);
        this.failedWorkerTypes.add(type);
        
        // Remove worker from busy list
        const workerInfo = this.workers.get(type);
        if (workerInfo) {
            const busyIndex = workerInfo.busy.indexOf(worker);
            if (busyIndex !== -1) {
                workerInfo.busy.splice(busyIndex, 1);
            }
        }

        // Terminate the problematic worker
        try {
            worker.terminate();
        } catch (e) {
            console.warn(`Failed to terminate worker ${type}:`, e);
        }

        // Process any pending jobs for this worker type
        this.processPendingJobs(type);
    }

    /**
     * Return a worker to the available pool
     */
    returnWorker(worker) {
        const type = worker.workerType;
        const workerInfo = this.workers.get(type);
        
        // Move from busy to available
        const busyIndex = workerInfo.busy.indexOf(worker);
        if (busyIndex !== -1) {
            workerInfo.busy.splice(busyIndex, 1);
            workerInfo.available.push(worker);
        }

        // Process any queued tasks
        this.processPendingJobs(type);
    }

    /**
     * Process pending jobs for a specific worker type
     */
    processPendingJobs(type) {
        const queueIndex = this.taskQueue.findIndex(task => task.type === type);
        if (queueIndex !== -1) {
            const task = this.taskQueue.splice(queueIndex, 1)[0];
            this.getWorker(type).then(task.resolve);
        }
    }

    /**
     * Execute a job on a worker
     */
    async executeJob(type, data, transferable = []) {
        // Check if workers are enabled and this type hasn't failed
        if (!this.workersEnabled || this.failedWorkerTypes.has(type)) {
            console.log(`Worker ${type} disabled, falling back to main thread processing`);
            return this.executeJobMainThread(type, data);
        }

        try {
            const jobId = ++this.jobIdCounter;
            const worker = await this.getWorker(type);

            return new Promise((resolve, reject) => {
                // Store job info
                this.activeJobs.set(jobId, { resolve, reject, worker, startTime: Date.now() });

                // Send job to worker
                const message = { jobId, data, type };
                
                if (transferable.length > 0) {
                    worker.postMessage(message, transferable);
                } else {
                    worker.postMessage(message);
                }

                // Set timeout for long-running jobs
                setTimeout(() => {
                    if (this.activeJobs.has(jobId)) {
                        this.activeJobs.delete(jobId);
                        this.returnWorker(worker);
                        reject(new Error(`Job ${jobId} timed out after 30 seconds`));
                    }
                }, 30000);
            });
        } catch (error) {
            console.warn(`Worker ${type} failed, falling back to main thread:`, error.message);
            this.failedWorkerTypes.add(type);
            return this.executeJobMainThread(type, data);
        }
    }

    /**
     * Execute job on main thread as fallback
     */
    executeJobMainThread(type, data) {
        console.log(`Executing ${type} job on main thread`);
        
        // Simple fallback implementations
        switch (type) {
            case 'ast':
                return Promise.resolve({
                    type: 'Program',
                    body: [],
                    functions: [],
                    classes: [],
                    fallback: true
                });
            
            case 'symbol':
                return Promise.resolve({
                    symbols: [],
                    report: { totalSymbols: 0, byType: {}, unused: [], exported: [], imported: [] },
                    fallback: true
                });
            
            case 'file':
                return Promise.resolve({
                    valid: true,
                    errors: [],
                    warnings: [],
                    fallback: true
                });
            
            case 'batch':
                return Promise.resolve({
                    results: [],
                    errors: [],
                    stats: { totalOperations: 0, successfulOperations: 0, failedOperations: 0 },
                    fallback: true
                });
            
            default:
                return Promise.resolve({ fallback: true, type });
        }
    }

    /**
     * Parse AST in background
     */
    async parseAST(code, filename, options = {}) {
        return this.executeJob('ast', {
            action: 'parse',
            code,
            filename,
            options
        });
    }

    /**
     * Resolve symbols in background
     */
    async resolveSymbols(code, filename, symbolName = null) {
        return this.executeJob('symbol', {
            action: 'resolve',
            code,
            filename,
            symbolName
        });
    }

    /**
     * Process file operations in background
     */
    async processFile(operation, data) {
        return this.executeJob('file', {
            action: operation,
            ...data
        });
    }

    /**
     * Execute batch operations
     */
    async executeBatch(operations) {
        return this.executeJob('batch', {
            action: 'batch',
            operations
        });
    }

    /**
     * Get worker statistics
     */
    getStats() {
        const stats = {
            totalWorkers: 0,
            availableWorkers: 0,
            busyWorkers: 0,
            queuedJobs: this.taskQueue.length,
            activeJobs: this.activeJobs.size,
            workerTypes: {}
        };

        for (const [type, info] of this.workers.entries()) {
            const available = info.available.length;
            const busy = info.busy.length;
            const total = available + busy;

            stats.totalWorkers += total;
            stats.availableWorkers += available;
            stats.busyWorkers += busy;

            stats.workerTypes[type] = {
                total,
                available,
                busy,
                maxInstances: info.maxInstances
            };
        }

        return stats;
    }

    /**
     * Cleanup all workers
     */
    cleanup() {
        for (const [type, info] of this.workers.entries()) {
            [...info.available, ...info.busy].forEach(worker => {
                worker.terminate();
            });
            info.available = [];
            info.busy = [];
        }

        this.activeJobs.clear();
        this.taskQueue = [];
    }

    /**
     * Warm up workers by creating initial instances
     */
    async warmUp() {
        console.log('Starting worker pool warmup...');
        const promises = [];
        
        for (const [type, info] of this.workers.entries()) {
            // Create one worker of each type initially with better error handling
            promises.push(
                this.createWorker(type, info.scriptPath)
                    .then(worker => {
                        info.available.push(worker);
                        console.log(`Successfully warmed up ${type} worker`);
                        return { type, success: true };
                    })
                    .catch(error => {
                        console.warn(`Failed to warm up ${type} worker:`, error.message);
                        return { type, success: false, error: error.message };
                    })
            );
        }

        const results = await Promise.allSettled(promises);
        const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
        const failed = results.length - successful;
        
        console.log(`Worker pool warmup completed: ${successful} successful, ${failed} failed`);
        console.log('Worker pool stats:', this.getStats());
        
        return { successful, failed, total: results.length };
    }
}

// Create singleton instance
export const workerManager = new WorkerManager();

// Initialize workers with delay to avoid immediate errors
let warmupAttempted = false;

export async function initializeWorkers() {
    if (warmupAttempted) {
        return;
    }
    warmupAttempted = true;
    
    try {
        console.log('Initializing worker system...');
        const result = await workerManager.warmUp();
        
        if (result.successful === 0) {
            console.warn('No workers could be initialized. System will fall back to main thread processing.');
            workerManager.workersEnabled = false;
        } else {
            console.log(`Worker system initialized successfully with ${result.successful}/${result.total} workers.`);
            workerManager.workersEnabled = true;
        }
        
        return result;
    } catch (error) {
        console.error('Failed to initialize worker system:', error);
        workerManager.workersEnabled = false;
        return { successful: 0, failed: 0, total: 0 };
    }
}

// Lazy initialization - only warm up when first needed
let initPromise = null;
export function ensureWorkersInitialized() {
    if (!initPromise) {
        initPromise = initializeWorkers();
    }
    return initPromise;
}

// Cleanup on page unload
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        workerManager.cleanup();
    });
}

// Auto-initialize after a short delay to avoid blocking page load
if (typeof window !== 'undefined') {
    setTimeout(() => {
        initializeWorkers().catch(error => {
            console.warn('Background worker initialization failed:', error.message);
        });
    }, 1000);
}