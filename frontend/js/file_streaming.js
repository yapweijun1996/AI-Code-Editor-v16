/**
 * Advanced File Streaming System for Large File Handling
 * Provides chunked reading, progress tracking, and memory-efficient processing
 */

// Configuration constants
const DEFAULT_CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB threshold for streaming
const MAX_PREVIEW_SIZE = 100 * 1024; // 100KB for file preview
const PROGRESS_UPDATE_INTERVAL = 100; // Update progress every 100ms

/**
 * File information and metadata
 */
export class FileInfo {
    constructor(file, handle) {
        this.file = file;
        this.handle = handle;
        this.name = file.name;
        this.size = file.size;
        this.lastModified = file.lastModified;
        this.type = file.type;
        this.isLarge = file.size > LARGE_FILE_THRESHOLD;
        this.extension = this.name.split('.').pop()?.toLowerCase() || '';
    }

    formatFileSize(bytes = this.size) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    isBinary() {
        // Common binary file extensions
        const binaryExtensions = new Set([
            'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'ico',
            'mp3', 'mp4', 'avi', 'mkv', 'wav', 'flac',
            'zip', 'rar', '7z', 'tar', 'gz',
            'exe', 'dll', 'so', 'dylib',
            'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'
        ]);
        
        return binaryExtensions.has(this.extension) || 
               (this.type && this.type.startsWith('image/')) ||
               (this.type && this.type.startsWith('video/')) ||
               (this.type && this.type.startsWith('audio/'));
    }

    isText() {
        // Common text file extensions
        const textExtensions = new Set([
            // JavaScript/TypeScript and frontend
            'js', 'ts', 'jsx', 'tsx', 'vue', 'html', 'css', 'scss', 'sass', 'less', 'svelte', 'astro',
            // Data formats
            'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'properties',
            // Documentation/text
            'md', 'txt', 'log', 'csv', 'tsv', 'rst', 'adoc', 'tex',
            // Programming languages
            'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb', 'go', 'rs', 'swift',
            'kt', 'scala', 'groovy', 'dart', 'lua', 'pl', 'pm', 'ex', 'exs', 'erl', 'hrl',
            // SQL and database
            'sql', 'prisma', 'graphql', 'gql',
            // Shell/scripts
            'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
            // Template files
            'ejs', 'hbs', 'mustache', 'twig', 'liquid', 'pug', 'jade', 'haml',
            // ColdFusion file extensions
            'cfm', 'cfc', 'cfml',
            // Config files
            'env', 'gitignore', 'editorconfig', 'htaccess',
            // Other web technologies
            'wasm', 'wat', 'webmanifest'
        ]);
        
        return textExtensions.has(this.extension) || 
               (this.type && this.type.startsWith('text/')) ||
               this.type === 'application/json' ||
               this.type === 'application/javascript' ||
               this.type === 'application/xml';
    }
}

/**
 * Streaming file reader with progress tracking and chunked processing
 */
export class StreamingFileReader {
    constructor(fileInfo, options = {}) {
        this.fileInfo = fileInfo;
        this.chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
        this.onProgress = options.onProgress || (() => {});
        this.onChunk = options.onChunk || (() => {});
        this.abortController = new AbortController();
        this.isReading = false;
        this.bytesRead = 0;
    }

    /**
     * Read file in chunks with progress tracking
     */
    async readChunked() {
        if (this.isReading) {
            throw new Error('File is already being read');
        }

        this.isReading = true;
        this.bytesRead = 0;
        const chunks = [];
        let lastProgressUpdate = 0;

        try {
            const reader = this.fileInfo.file.stream().getReader();
            
            while (true) {
                if (this.abortController.signal.aborted) {
                    throw new Error('File reading was aborted');
                }

                const { done, value } = await reader.read();
                
                if (done) break;

                chunks.push(value);
                this.bytesRead += value.byteLength;

                // Call chunk callback
                if (this.onChunk) {
                    await this.onChunk(value, this.bytesRead, this.fileInfo.size);
                }

                // Update progress periodically
                const now = Date.now();
                if (now - lastProgressUpdate > PROGRESS_UPDATE_INTERVAL) {
                    const progress = (this.bytesRead / this.fileInfo.size) * 100;
                    this.onProgress(progress, this.bytesRead, this.fileInfo.size);
                    lastProgressUpdate = now;
                }

                // Yield control to prevent UI blocking
                if (chunks.length % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            reader.releaseLock();
            this.onProgress(100, this.bytesRead, this.fileInfo.size);

            return chunks;
        } finally {
            this.isReading = false;
        }
    }

    /**
     * Read file as text with streaming
     */
    async readAsText() {
        const chunks = await this.readChunked();
        const uint8Array = new Uint8Array(this.bytesRead);
        let offset = 0;
        
        for (const chunk of chunks) {
            uint8Array.set(chunk, offset);
            offset += chunk.byteLength;
        }

        const decoder = new TextDecoder('utf-8', { fatal: false });
        return decoder.decode(uint8Array);
    }

    /**
     * Read only a preview of the file for large files
     */
    async readPreview(previewSize = MAX_PREVIEW_SIZE) {
        if (this.fileInfo.size <= previewSize) {
            return await this.readAsText();
        }

        const slice = this.fileInfo.file.slice(0, previewSize);
        const text = await slice.text();
        return text + '\n\n... [File truncated. Total size: ' + this.formatFileSize(this.fileInfo.size) + ']';
    }

    /**
     * Abort the current reading operation
     */
    abort() {
        this.abortController.abort();
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

/**
 * File loading strategy manager
 */
export class FileLoadStrategy {
    /**
     * Determine the best loading strategy for a file
     */
    static getBestStrategy(fileInfo) {
        // Prioritize known text extensions. If it's a known text type, treat it as text.
        if (fileInfo.isText()) {
            if (fileInfo.size > LARGE_FILE_THRESHOLD) {
                return 'streaming';
            }
            if (fileInfo.size > MAX_PREVIEW_SIZE) {
                return 'chunked';
            }
            return 'standard';
        }

        // If it's not a known text type, then check if it's a known binary type.
        if (fileInfo.isBinary()) {
            return 'binary';
        }

        // For unknown types, default to standard text reading.
        // This is a safe fallback as TextDecoder will handle most things gracefully.
        return 'standard';
    }

    /**
     * Load file with appropriate strategy
     */
    static async loadFile(fileInfo, options = {}) {
        const strategy = this.getBestStrategy(fileInfo);
        
        switch (strategy) {
            case 'binary':
                return await this.loadBinaryFile(fileInfo, options);
            case 'streaming':
                return await this.loadStreamingFile(fileInfo, options);
            case 'chunked':
                return await this.loadChunkedFile(fileInfo, options);
            default:
                return await this.loadStandardFile(fileInfo, options);
        }
    }

    static async loadStandardFile(fileInfo, options) {
        const content = await fileInfo.file.text();
        return {
            content,
            strategy: 'standard',
            size: fileInfo.size,
            truncated: false
        };
    }

    static async loadChunkedFile(fileInfo, options) {
        const reader = new StreamingFileReader(fileInfo, options);
        const content = await reader.readAsText();
        
        return {
            content,
            strategy: 'chunked',
            size: fileInfo.size,
            truncated: false
        };
    }

    static async loadStreamingFile(fileInfo, options) {
        const reader = new StreamingFileReader(fileInfo, options);
        
        if (options.previewOnly) {
            const content = await reader.readPreview(options.previewSize);
            return {
                content,
                strategy: 'streaming',
                size: fileInfo.size,
                truncated: true,
                previewSize: options.previewSize || MAX_PREVIEW_SIZE
            };
        }

        const chunks = await reader.readChunked();
        const content = new TextDecoder().decode(
            new Uint8Array(chunks.reduce((acc, chunk) => [...acc, ...chunk], []))
        );

        return {
            content,
            strategy: 'streaming', 
            size: fileInfo.size,
            truncated: false
        };
    }

    static async loadBinaryFile(fileInfo, options) {
        return {
            content: null,
            strategy: 'binary',
            size: fileInfo.size,
            truncated: false,
            message: `Binary file (${fileInfo.formatFileSize(fileInfo.size)}). Cannot display content.`
        };
    }
}

/**
 * Progress tracking utilities
 */
export class ProgressTracker {
    constructor(total) {
        this.total = total;
        this.current = 0;
        this.startTime = Date.now();
        this.callbacks = new Set();
    }

    update(current) {
        this.current = current;
        const progress = (current / this.total) * 100;
        const elapsed = Date.now() - this.startTime;
        const rate = current / (elapsed / 1000); // bytes per second
        const eta = current > 0 ? (this.total - current) / rate : 0;

        const progressData = {
            progress: Math.min(100, progress),
            current,
            total: this.total,
            elapsed,
            rate,
            eta,
            formatted: {
                progress: `${progress.toFixed(1)}%`,
                current: this.formatBytes(current),
                total: this.formatBytes(this.total),
                rate: `${this.formatBytes(rate)}/s`,
                eta: this.formatTime(eta)
            }
        };

        this.callbacks.forEach(callback => callback(progressData));
    }

    onProgress(callback) {
        this.callbacks.add(callback);
        return () => this.callbacks.delete(callback);
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatTime(seconds) {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.round(seconds % 60);
        return `${minutes}m ${remainingSeconds}s`;
    }
}

/**
 * File cache for recently accessed files
 */
export class FileCache {
    constructor(maxSize = 50 * 1024 * 1024) { // 50MB default cache
        this.cache = new Map();
        this.maxSize = maxSize;
        this.currentSize = 0;
        this.accessOrder = new Map(); // LRU tracking
    }

    get(filePath) {
        if (this.cache.has(filePath)) {
            // Update access time for LRU
            this.accessOrder.set(filePath, Date.now());
            return this.cache.get(filePath);
        }
        return null;
    }

    set(filePath, content, size) {
        // Remove if already exists to update size
        if (this.cache.has(filePath)) {
            this.currentSize -= this.cache.get(filePath).size;
        }

        // Evict LRU items if needed
        while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
            this.evictLRU();
        }

        const cacheEntry = {
            content,
            size,
            timestamp: Date.now(),
            accessCount: 1
        };

        this.cache.set(filePath, cacheEntry);
        this.accessOrder.set(filePath, Date.now());
        this.currentSize += size;
    }

    evictLRU() {
        let oldestPath = null;
        let oldestTime = Infinity;

        for (const [path, time] of this.accessOrder) {
            if (time < oldestTime) {
                oldestTime = time;
                oldestPath = path;
            }
        }

        if (oldestPath) {
            const entry = this.cache.get(oldestPath);
            this.currentSize -= entry.size;
            this.cache.delete(oldestPath);
            this.accessOrder.delete(oldestPath);
        }
    }

    clear() {
        this.cache.clear();
        this.accessOrder.clear();
        this.currentSize = 0;
    }

    getStats() {
        return {
            entries: this.cache.size,
            currentSize: this.currentSize,
            maxSize: this.maxSize,
            utilization: (this.currentSize / this.maxSize) * 100
        };
    }
}

// Global file cache instance
export const globalFileCache = new FileCache();

/**
 * Enhanced file reader with caching and streaming support
 */
export async function readFileWithStrategy(fileHandle, filePath, options = {}) {
    // Check cache first
    const cached = globalFileCache.get(filePath);
    if (cached && !options.skipCache && cached.content) {
        return {
            content: cached.content,
            strategy: cached.strategy,
            size: cached.size,
            truncated: cached.truncated || false,
            fromCache: true
        };
    }
    
    // Clear invalid cache entries
    if (cached && (!cached.content || cached.content.length === 0)) {
        globalFileCache.cache.delete(filePath);
        globalFileCache.accessOrder.delete(filePath);
        if (cached.size) {
            globalFileCache.currentSize -= cached.size;
        }
    }

    try {
        const file = await fileHandle.getFile();
        const fileInfo = new FileInfo(file, fileHandle);
        
        const result = await FileLoadStrategy.loadFile(fileInfo, options);
        
        // Cache the result if it's not too large and not binary
        if (result.content && result.size < globalFileCache.maxSize / 4) {
            const cacheData = {
                content: result.content,
                strategy: result.strategy,
                size: result.size,
                truncated: result.truncated
            };
            globalFileCache.set(filePath, cacheData, result.size);
        }

        return {
            ...result,
            fromCache: false
        };
    } catch (error) {
        console.error(`Failed to read file ${filePath}:`, error);
        throw new Error(`Failed to read file: ${error.message}`);
    }
}