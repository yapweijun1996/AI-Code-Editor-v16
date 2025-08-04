/**
 * File Processing Web Worker
 * Handles CPU-intensive file operations in the background
 */

// Worker message types
const MESSAGE_TYPES = {
    PARSE_FILE: 'parse_file',
    BATCH_PROCESS: 'batch_process',
    INDEX_PROJECT: 'index_project',
    ANALYZE_CODE: 'analyze_code',
    SEARCH_FILES: 'search_files',
    CALCULATE_METRICS: 'calculate_metrics'
};

// Import necessary libraries for parsing
// Note: In a real environment, you'd import the actual parser libraries
// For now, we'll create simplified versions

/**
 * Simple AST-like parser for JavaScript/TypeScript
 */
class SimpleParser {
    static parse(content, filePath) {
        const result = {
            filePath,
            symbols: [],
            imports: [],
            exports: [],
            functions: [],
            classes: [],
            variables: [],
            errors: []
        };

        try {
            // Split into lines for analysis
            const lines = content.split('\n');
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                const lineNumber = i + 1;
                
                // Extract functions
                const functionMatch = line.match(/^\s*(?:async\s+)?function\s+(\w+)\s*\(/);
                if (functionMatch) {
                    result.functions.push({
                        name: functionMatch[1],
                        line: lineNumber,
                        type: 'function',
                        async: line.includes('async')
                    });
                }
                
                // Extract arrow functions
                const arrowFunctionMatch = line.match(/^\s*(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/);
                if (arrowFunctionMatch) {
                    result.functions.push({
                        name: arrowFunctionMatch[1],
                        line: lineNumber,
                        type: 'arrow_function',
                        async: line.includes('async')
                    });
                }
                
                // Extract classes 
                const classMatch = line.match(/^\s*(?:export\s+)?class\s+(\w+)/);
                if (classMatch) {
                    result.classes.push({
                        name: classMatch[1],
                        line: lineNumber,
                        exported: line.includes('export')
                    });
                }
                
                // Extract imports
                const importMatch = line.match(/^\s*import\s+.*\s+from\s+['"`]([^'"`]+)['"`]/);
                if (importMatch) {
                    result.imports.push({
                        module: importMatch[1],
                        line: lineNumber,
                        statement: line
                    });
                }
                
                // Extract exports
                const exportMatch = line.match(/^\s*export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/);
                if (exportMatch) {
                    result.exports.push({
                        name: exportMatch[1],
                        line: lineNumber,
                        isDefault: line.includes('default')
                    });
                }
                
                // Extract variables
                const variableMatch = line.match(/^\s*(?:const|let|var)\s+(\w+)/);
                if (variableMatch && !arrowFunctionMatch) {
                    result.variables.push({
                        name: variableMatch[1],
                        line: lineNumber,
                        type: line.includes('const') ? 'const' : line.includes('let') ? 'let' : 'var'
                    });
                }
            }
            
            // Combine all symbols
            result.symbols = [
                ...result.functions.map(f => ({ ...f, symbolType: 'function' })),
                ...result.classes.map(c => ({ ...c, symbolType: 'class' })),
                ...result.variables.map(v => ({ ...v, symbolType: 'variable' }))
            ];
            
        } catch (error) {
            result.errors.push({
                message: error.message,
                line: 0,
                type: 'parse_error'
            });
        }
        
        return result;
    }
}

/**
 * Code metrics calculator
 */
class CodeMetrics {
    static calculate(content, filePath) {
        const lines = content.split('\n');
        const metrics = {
            filePath,
            linesOfCode: 0,
            commentLines: 0,
            blankLines: 0,
            complexity: 0,
            functions: 0,
            classes: 0,
            maintainabilityIndex: 0
        };
        
        let inBlockComment = false;
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine === '') {
                metrics.blankLines++;
                continue;
            }
            
            // Handle block comments
            if (trimmedLine.includes('/*')) {
                inBlockComment = true;
            }
            if (inBlockComment) {
                metrics.commentLines++;
                if (trimmedLine.includes('*/')) {
                    inBlockComment = false;
                }
                continue;
            }
            
            // Handle single-line comments
            if (trimmedLine.startsWith('//')) {
                metrics.commentLines++;
                continue;
            }
            
            metrics.linesOfCode++;
            
            // Calculate cyclomatic complexity (simplified)
            const complexityKeywords = ['if', 'else if', 'for', 'while', 'switch', 'case', 'catch', '&&', '||', '?'];
            for (const keyword of complexityKeywords) {
                if (trimmedLine.includes(keyword)) {
                    metrics.complexity++;
                }
            }
            
            // Count functions and classes
            if (/^\s*(?:async\s+)?function\s+/.test(line) || /\s*=>\s*/.test(line)) {
                metrics.functions++;
            }
            if (/^\s*(?:export\s+)?class\s+/.test(line)) {
                metrics.classes++;
            }
        }
        
        // Calculate maintainability index (simplified)
        const totalLines = lines.length;
        const codeRatio = metrics.linesOfCode / totalLines;
        const commentRatio = metrics.commentLines / totalLines;
        const complexityPenalty = Math.min(metrics.complexity / metrics.linesOfCode * 100, 50);
        
        metrics.maintainabilityIndex = Math.max(0, 100 * codeRatio + 50 * commentRatio - complexityPenalty);
        
        return metrics;
    }
}

/**
 * File indexer for search functionality
 */
class FileIndexer {
    static buildIndex(files) {
        const index = {
            symbols: new Map(),
            content: new Map(),
            metadata: new Map()
        };
        
        for (const fileData of files) {
            const { filePath, content } = fileData;
            
            // Parse file for symbols
            const parseResult = SimpleParser.parse(content, filePath);
            
            // Index symbols
            for (const symbol of parseResult.symbols) {
                const key = symbol.name.toLowerCase();
                if (!index.symbols.has(key)) {
                    index.symbols.set(key, []);
                }
                index.symbols.get(key).push({
                    filePath,
                    ...symbol
                });
            }
            
            // Index content for text search
            const words = content.toLowerCase().match(/\w+/g) || [];
            const wordMap = new Map();
            
            words.forEach((word, position) => {
                if (!wordMap.has(word)) {
                    wordMap.set(word, []);
                }
                wordMap.get(word).push(position);
            });
            
            index.content.set(filePath, wordMap);
            
            // Store metadata
            index.metadata.set(filePath, {
                size: content.length,
                lastModified: Date.now(),
                symbols: parseResult.symbols.length,
                functions: parseResult.functions.length,
                classes: parseResult.classes.length
            });
        }
        
        return {
            symbols: Object.fromEntries(index.symbols),
            content: Object.fromEntries(index.content),
            metadata: Object.fromEntries(index.metadata)
        };
    }
}

/**
 * Batch processor for multiple operations
 */
class BatchProcessor {
    static async processFiles(files, operations) {
        const results = [];
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileResults = {
                filePath: file.filePath,
                results: {}
            };
            
            for (const operation of operations) {
                try {
                    switch (operation.type) {
                        case 'parse':
                            fileResults.results.parse = SimpleParser.parse(file.content, file.filePath);
                            break;
                        case 'metrics':
                            fileResults.results.metrics = CodeMetrics.calculate(file.content, file.filePath);
                            break;
                        case 'search':
                            fileResults.results.search = this.searchInContent(file.content, operation.query);
                            break;
                    }
                } catch (error) {
                    fileResults.results[operation.type] = { error: error.message };
                }
            }
            
            results.push(fileResults);
            
            // Send progress update
            if (i % 10 === 0) {
                self.postMessage({
                    type: 'progress',
                    progress: (i / files.length) * 100,
                    processed: i,
                    total: files.length
                });
            }
        }
        
        return results;
    }
    
    static searchInContent(content, query) {
        const matches = [];
        const lines = content.split('\n');
        const regex = new RegExp(query, 'gi');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = regex.exec(line);
            if (match) {
                matches.push({
                    lineNumber: i + 1,
                    line: line.trim(),
                    position: match.index
                });
            }
        }
        
        return matches;
    }
}

// Main message handler
self.onmessage = async function(e) {
    const { type, id, data } = e.data;
    
    try {
        let result;
        
        switch (type) {
            case MESSAGE_TYPES.PARSE_FILE:
                result = SimpleParser.parse(data.content, data.filePath);
                break;
                
            case MESSAGE_TYPES.BATCH_PROCESS:
                result = await BatchProcessor.processFiles(data.files, data.operations);
                break;
                
            case MESSAGE_TYPES.INDEX_PROJECT:
                result = FileIndexer.buildIndex(data.files);
                break;
                
            case MESSAGE_TYPES.ANALYZE_CODE:
                result = {
                    parse: SimpleParser.parse(data.content, data.filePath),
                    metrics: CodeMetrics.calculate(data.content, data.filePath)
                };
                break;
                
            case MESSAGE_TYPES.SEARCH_FILES:
                result = data.files.map(file => ({
                    filePath: file.filePath,
                    matches: BatchProcessor.searchInContent(file.content, data.query)
                })).filter(file => file.matches.length > 0);
                break;
                
            case MESSAGE_TYPES.CALCULATE_METRICS:
                result = data.files.map(file => 
                    CodeMetrics.calculate(file.content, file.filePath)
                );
                break;
                
            default:
                throw new Error(`Unknown message type: ${type}`);
        }
        
        // Send successful result
        self.postMessage({
            type: 'result',
            id,
            success: true,
            result
        });
        
    } catch (error) {
        // Send error result
        self.postMessage({
            type: 'result',
            id,
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
};

// Worker initialization
self.postMessage({
    type: 'ready',
    message: 'File processor worker initialized'
});