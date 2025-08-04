/**
 * Batch Worker - Handles batch processing of multiple operations
 */

/**
 * Batch processor for handling multiple operations efficiently
 */
class BatchProcessor {
    constructor() {
        this.maxBatchSize = 100;
        this.maxConcurrency = 4;
        this.cache = new Map();
        this.stats = {
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
            averageTime: 0,
            batchesProcessed: 0
        };
    }

    /**
     * Process a batch of operations
     */
    async processBatch(operations) {
        const startTime = Date.now();
        const results = [];
        const errors = [];
        
        // Validate batch size
        if (operations.length > this.maxBatchSize) {
            throw new Error(`Batch size ${operations.length} exceeds maximum ${this.maxBatchSize}`);
        }

        // Group operations by type for optimization
        const groupedOps = this.groupOperationsByType(operations);
        
        // Process each group
        for (const [type, ops] of groupedOps.entries()) {
            try {
                const groupResults = await this.processOperationGroup(type, ops);
                results.push(...groupResults);
            } catch (error) {
                errors.push({
                    type,
                    operations: ops.length,
                    error: error.message
                });
            }
        }

        // Update statistics
        const endTime = Date.now();
        const duration = endTime - startTime;
        this.updateStats(operations.length, results.length, duration);

        return {
            results,
            errors,
            stats: {
                totalOperations: operations.length,
                successfulOperations: results.length,
                failedOperations: errors.length,
                duration,
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Group operations by type for efficient processing
     */
    groupOperationsByType(operations) {
        const groups = new Map();
        
        operations.forEach((op, index) => {
            const type = op.type || 'unknown';
            if (!groups.has(type)) {
                groups.set(type, []);
            }
            groups.get(type).push({ ...op, originalIndex: index });
        });

        return groups;
    }

    /**
     * Process a group of operations of the same type
     */
    async processOperationGroup(type, operations) {
        switch (type) {
            case 'file_read':
                return this.processFileReads(operations);
            
            case 'file_validate':
                return this.processFileValidations(operations);
            
            case 'file_analyze':
                return this.processFileAnalyses(operations);
            
            case 'symbol_resolve':
                return this.processSymbolResolutions(operations);
            
            case 'ast_parse':
                return this.processASTParses(operations);
            
            case 'search':
                return this.processSearches(operations);
            
            default:
                return this.processGenericOperations(operations);
        }
    }

    /**
     * Process multiple file read operations
     */
    async processFileReads(operations) {
        const results = [];
        
        // Process in chunks to avoid overwhelming the system
        const chunks = this.chunkArray(operations, this.maxConcurrency);
        
        for (const chunk of chunks) {
            const chunkPromises = chunk.map(async (op) => {
                try {
                    // Simulate file reading (in real implementation, this would use FileSystem API)
                    const result = {
                        originalIndex: op.originalIndex,
                        type: 'file_read',
                        filename: op.filename,
                        success: true,
                        size: op.content?.length || 0,
                        timestamp: new Date().toISOString()
                    };
                    
                    return result;
                } catch (error) {
                    return {
                        originalIndex: op.originalIndex,
                        type: 'file_read',
                        filename: op.filename,
                        success: false,
                        error: error.message,
                        timestamp: new Date().toISOString()
                    };
                }
            });
            
            const chunkResults = await Promise.allSettled(chunkPromises);
            results.push(...chunkResults.map(r => r.status === 'fulfilled' ? r.value : r.reason));
        }
        
        return results;
    }

    /**
     * Process multiple file validation operations
     */
    async processFileValidations(operations) {
        const results = [];
        
        for (const op of operations) {
            try {
                const validation = this.validateFileSyntax(op.content, op.filename);
                results.push({
                    originalIndex: op.originalIndex,
                    type: 'file_validate',
                    filename: op.filename,
                    success: true,
                    validation,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                results.push({
                    originalIndex: op.originalIndex,
                    type: 'file_validate',
                    filename: op.filename,
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        return results;
    }

    /**
     * Process multiple file analysis operations
     */
    async processFileAnalyses(operations) {
        const results = [];
        
        for (const op of operations) {
            try {
                const analysis = this.analyzeFile(op.content, op.filename);
                results.push({
                    originalIndex: op.originalIndex,
                    type: 'file_analyze',
                    filename: op.filename,
                    success: true,
                    analysis,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                results.push({
                    originalIndex: op.originalIndex,
                    type: 'file_analyze',
                    filename: op.filename,
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        return results;
    }

    /**
     * Process multiple symbol resolution operations
     */
    async processSymbolResolutions(operations) {
        const results = [];
        
        for (const op of operations) {
            try {
                const symbols = this.resolveSymbols(op.content, op.filename);
                results.push({
                    originalIndex: op.originalIndex,
                    type: 'symbol_resolve',
                    filename: op.filename,
                    success: true,
                    symbols,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                results.push({
                    originalIndex: op.originalIndex,
                    type: 'symbol_resolve',
                    filename: op.filename,
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        return results;
    }

    /**
     * Process multiple AST parsing operations
     */
    async processASTParses(operations) {
        const results = [];
        
        for (const op of operations) {
            try {
                const ast = this.parseAST(op.content, op.filename);
                results.push({
                    originalIndex: op.originalIndex,
                    type: 'ast_parse',
                    filename: op.filename,
                    success: true,
                    ast,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                results.push({
                    originalIndex: op.originalIndex,
                    type: 'ast_parse',
                    filename: op.filename,
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        return results;
    }

    /**
     * Process multiple search operations
     */
    async processSearches(operations) {
        const results = [];
        
        for (const op of operations) {
            try {
                const searchResults = this.searchInContent(op.content, op.pattern, op.filename);
                results.push({
                    originalIndex: op.originalIndex,
                    type: 'search',
                    filename: op.filename,
                    pattern: op.pattern,
                    success: true,
                    matches: searchResults,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                results.push({
                    originalIndex: op.originalIndex,
                    type: 'search',
                    filename: op.filename,
                    pattern: op.pattern,
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        return results;
    }

    /**
     * Process generic operations
     */
    async processGenericOperations(operations) {
        const results = [];
        
        for (const op of operations) {
            results.push({
                originalIndex: op.originalIndex,
                type: op.type || 'unknown',
                success: true,
                data: op,
                timestamp: new Date().toISOString()
            });
        }
        
        return results;
    }

    /**
     * Utility: Split array into chunks
     */
    chunkArray(array, chunkSize) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    /**
     * Basic file syntax validation
     */
    validateFileSyntax(content, filename) {
        const extension = filename.split('.').pop().toLowerCase();
        const validation = { valid: true, errors: [], warnings: [] };

        switch (extension) {
            case 'json':
                try {
                    JSON.parse(content);
                } catch (error) {
                    validation.valid = false;
                    validation.errors.push(error.message);
                }
                break;
            
            case 'js':
            case 'jsx':
            case 'ts':
            case 'tsx':
                // Basic bracket matching
                const openBrackets = (content.match(/[{[(]/g) || []).length;
                const closeBrackets = (content.match(/[}\])]/g) || []).length;
                if (openBrackets !== closeBrackets) {
                    validation.valid = false;
                    validation.errors.push('Mismatched brackets');
                }
                break;
        }

        return validation;
    }

    /**
     * Basic file analysis
     */
    analyzeFile(content, filename) {
        const lines = content.split('\n');
        return {
            filename,
            size: content.length,
            lines: lines.length,
            nonEmptyLines: lines.filter(line => line.trim()).length,
            extension: filename.split('.').pop().toLowerCase()
        };
    }

    /**
     * Basic symbol resolution
     */
    resolveSymbols(content, filename) {
        const symbols = [];
        
        // Find function declarations
        const functionMatches = content.match(/function\s+(\w+)/g) || [];
        functionMatches.forEach(match => {
            const name = match.replace('function ', '');
            symbols.push({ name, type: 'function' });
        });

        // Find variable declarations
        const variableMatches = content.match(/(?:const|let|var)\s+(\w+)/g) || [];
        variableMatches.forEach(match => {
            const name = match.replace(/(?:const|let|var)\s+/, '');
            symbols.push({ name, type: 'variable' });
        });

        return symbols;
    }

    /**
     * Basic AST parsing (simplified)
     */
    parseAST(content, filename) {
        return {
            type: 'Program',
            filename,
            body: [],
            functions: (content.match(/function\s+\w+/g) || []).length,
            variables: (content.match(/(?:const|let|var)\s+\w+/g) || []).length
        };
    }

    /**
     * Search in content
     */
    searchInContent(content, pattern, filename) {
        const matches = [];
        const lines = content.split('\n');
        const regex = new RegExp(pattern, 'gi');

        lines.forEach((line, index) => {
            let match;
            while ((match = regex.exec(line)) !== null) {
                matches.push({
                    line: index + 1,
                    column: match.index + 1,
                    match: match[0],
                    context: line.trim()
                });
            }
            regex.lastIndex = 0; // Reset for next line
        });

        return matches;
    }

    /**
     * Update processing statistics
     */
    updateStats(totalOps, successfulOps, duration) {
        this.stats.totalOperations += totalOps;
        this.stats.successfulOperations += successfulOps;
        this.stats.failedOperations += (totalOps - successfulOps);
        this.stats.batchesProcessed++;
        
        // Update average time
        const totalTime = (this.stats.averageTime * (this.stats.batchesProcessed - 1)) + duration;
        this.stats.averageTime = totalTime / this.stats.batchesProcessed;
    }

    /**
     * Get processing statistics
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
            averageTime: 0,
            batchesProcessed: 0
        };
    }
}

// Create processor instance
const batchProcessor = new BatchProcessor();

// Message handler
self.addEventListener('message', async (event) => {
    const { jobId, data, type } = event.data;
    
    try {
        let result;
        
        switch (data.action) {
            case 'batch':
                result = await batchProcessor.processBatch(data.operations);
                break;
                
            case 'stats':
                result = batchProcessor.getStats();
                break;
                
            case 'reset_stats':
                batchProcessor.resetStats();
                result = { message: 'Statistics reset successfully' };
                break;
                
            default:
                throw new Error(`Unknown action: ${data.action}`);
        }
        
        self.postMessage({ jobId, result, type });
        
    } catch (error) {
        self.postMessage({ 
            jobId, 
            error: error.message, 
            type,
            stack: error.stack 
        });
    }
});

// Signal that worker is ready
self.postMessage({ type: 'ready' });