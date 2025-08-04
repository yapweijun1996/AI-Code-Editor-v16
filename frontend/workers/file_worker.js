/**
 * File Worker - Handles file processing operations in background
 */

/**
 * Process file content with various operations
 */
class FileProcessor {
    constructor() {
        this.cache = new Map();
        this.maxCacheSize = 50;
    }

    /**
     * Validate file syntax
     */
    validateSyntax(content, filename) {
        const extension = filename.split('.').pop().toLowerCase();
        const validation = {
            valid: true,
            errors: [],
            warnings: [],
            language: extension
        };

        try {
            switch (extension) {
                case 'js':
                case 'jsx':
                case 'ts':
                case 'tsx':
                    return this.validateJavaScript(content, validation);
                
                case 'json':
                    return this.validateJSON(content, validation);
                
                case 'css':
                case 'scss':
                case 'sass':
                    return this.validateCSS(content, validation);
                
                case 'html':
                case 'htm':
                    return this.validateHTML(content, validation);
                
                default:
                    validation.warnings.push(`Syntax validation not supported for .${extension} files`);
                    return validation;
            }
        } catch (error) {
            validation.valid = false;
            validation.errors.push({
                line: 1,
                column: 1,
                message: `Validation error: ${error.message}`
            });
            return validation;
        }
    }

    /**
     * Validate JavaScript/TypeScript syntax
     */
    validateJavaScript(content, validation) {
        const lines = content.split('\n');
        
        // Basic syntax checks
        const checks = [
            {
                regex: /\{[^}]*$/m,
                message: 'Unclosed curly brace'
            },
            {
                regex: /\([^)]*$/m,
                message: 'Unclosed parenthesis'
            },
            {
                regex: /\[[^\]]*$/m,
                message: 'Unclosed square bracket'
            },
            {
                regex: /['"][^'"]*$/m,
                message: 'Unclosed string literal'
            },
            {
                regex: /\/\*(?!.*\*\/)/s,
                message: 'Unclosed block comment'
            }
        ];

        lines.forEach((line, index) => {
            const lineNumber = index + 1;
            
            // Check for common syntax errors
            checks.forEach(check => {
                if (check.regex.test(line)) {
                    validation.errors.push({
                        line: lineNumber,
                        column: 1,
                        message: check.message
                    });
                    validation.valid = false;
                }
            });

            // Check for potential issues
            if (line.includes('console.log') && !line.includes('//')) {
                validation.warnings.push({
                    line: lineNumber,
                    column: line.indexOf('console.log') + 1,
                    message: 'Consider removing console.log in production code'
                });
            }

            if (line.includes('debugger') && !line.includes('//')) {
                validation.warnings.push({
                    line: lineNumber,
                    column: line.indexOf('debugger') + 1,
                    message: 'Remove debugger statement before production'
                });
            }
        });

        return validation;
    }

    /**
     * Validate JSON syntax
     */
    validateJSON(content, validation) {
        try {
            JSON.parse(content);
        } catch (error) {
            validation.valid = false;
            const match = error.message.match(/position (\d+)/);
            const position = match ? parseInt(match[1]) : 0;
            const lines = content.substring(0, position).split('\n');
            
            validation.errors.push({
                line: lines.length,
                column: lines[lines.length - 1].length + 1,
                message: error.message
            });
        }
        
        return validation;
    }

    /**
     * Validate CSS syntax
     */
    validateCSS(content, validation) {
        const lines = content.split('\n');
        let braceCount = 0;
        
        lines.forEach((line, index) => {
            const lineNumber = index + 1;
            const trimmedLine = line.trim();
            
            // Count braces
            braceCount += (line.match(/\{/g) || []).length;
            braceCount -= (line.match(/\}/g) || []).length;
            
            // Check for common CSS issues
            if (trimmedLine.includes(':') && !trimmedLine.includes(';') && 
                !trimmedLine.endsWith('{') && !trimmedLine.startsWith('/*')) {
                validation.warnings.push({
                    line: lineNumber,
                    column: 1,
                    message: 'Missing semicolon'
                });
            }
        });

        if (braceCount !== 0) {
            validation.valid = false;
            validation.errors.push({
                line: lines.length,
                column: 1,
                message: `Unmatched braces: ${braceCount > 0 ? 'missing closing' : 'extra closing'} brace(s)`
            });
        }

        return validation;
    }

    /**
     * Validate HTML syntax
     */
    validateHTML(content, validation) {
        const tagStack = [];
        const selfClosingTags = new Set([
            'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
            'link', 'meta', 'param', 'source', 'track', 'wbr'
        ]);

        // Simple HTML tag matching
        const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
        let match;
        
        while ((match = tagRegex.exec(content)) !== null) {
            const tagName = match[1].toLowerCase();
            const isClosing = match[0].startsWith('</');
            const isSelfClosing = selfClosingTags.has(tagName) || match[0].endsWith('/>');
            
            if (isClosing) {
                if (tagStack.length === 0 || tagStack[tagStack.length - 1] !== tagName) {
                    validation.valid = false;
                    validation.errors.push({
                        line: content.substring(0, match.index).split('\n').length,
                        column: 1,
                        message: `Unexpected closing tag: ${tagName}`
                    });
                } else {
                    tagStack.pop();
                }
            } else if (!isSelfClosing) {
                tagStack.push(tagName);
            }
        }

        // Check for unclosed tags
        if (tagStack.length > 0) {
            validation.valid = false;
            validation.errors.push({
                line: content.split('\n').length,
                column: 1,
                message: `Unclosed tags: ${tagStack.join(', ')}`
            });
        }

        return validation;
    }

    /**
     * Format file content
     */
    formatContent(content, filename, options = {}) {
        const extension = filename.split('.').pop().toLowerCase();
        
        switch (extension) {
            case 'js':
            case 'jsx':
            case 'ts':
            case 'tsx':
                return this.formatJavaScript(content, options);
            
            case 'json':
                return this.formatJSON(content, options);
            
            case 'css':
            case 'scss':
                return this.formatCSS(content, options);
            
            case 'html':
            case 'htm':
                return this.formatHTML(content, options);
            
            default:
                return content; // No formatting for unknown types
        }
    }

    /**
     * Basic JavaScript formatting
     */
    formatJavaScript(content, options) {
        const indent = options.indent || '    ';
        let formatted = '';
        let indentLevel = 0;
        let inString = false;
        let stringChar = '';
        
        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            const prevChar = content[i - 1];
            
            // Handle strings
            if ((char === '"' || char === "'") && prevChar !== '\\') {
                if (!inString) {
                    inString = true;
                    stringChar = char;
                } else if (char === stringChar) {
                    inString = false;
                    stringChar = '';
                }
            }
            
            if (!inString) {
                if (char === '{') {
                    formatted += char + '\n';
                    indentLevel++;
                    formatted += indent.repeat(indentLevel);
                    continue;
                } else if (char === '}') {
                    if (formatted.endsWith(indent)) {
                        formatted = formatted.slice(0, -indent.length);
                    }
                    indentLevel = Math.max(0, indentLevel - 1);
                    formatted += char;
                    if (i < content.length - 1) {
                        formatted += '\n' + indent.repeat(indentLevel);
                    }
                    continue;
                } else if (char === ';') {
                    formatted += char + '\n' + indent.repeat(indentLevel);
                    continue;
                }
            }
            
            formatted += char;
        }
        
        return formatted;
    }

    /**
     * Format JSON content
     */
    formatJSON(content, options) {
        try {
            const parsed = JSON.parse(content);
            const indent = options.indent || 2;
            return JSON.stringify(parsed, null, indent);
        } catch (error) {
            return content; // Return original if parsing fails
        }
    }

    /**
     * Basic CSS formatting
     */
    formatCSS(content, options) {
        const indent = options.indent || '    ';
        let formatted = '';
        let indentLevel = 0;
        
        const lines = content.split('\n');
        
        lines.forEach(line => {
            const trimmed = line.trim();
            
            if (trimmed.includes('}')) {
                indentLevel = Math.max(0, indentLevel - 1);
            }
            
            if (trimmed) {
                formatted += indent.repeat(indentLevel) + trimmed + '\n';
            }
            
            if (trimmed.includes('{')) {
                indentLevel++;
            }
        });
        
        return formatted;
    }

    /**
     * Basic HTML formatting
     */
    formatHTML(content, options) {
        const indent = options.indent || '    ';
        let formatted = '';
        let indentLevel = 0;
        
        const lines = content.split('\n');
        
        lines.forEach(line => {
            const trimmed = line.trim();
            
            if (trimmed.startsWith('</')) {
                indentLevel = Math.max(0, indentLevel - 1);
            }
            
            if (trimmed) {
                formatted += indent.repeat(indentLevel) + trimmed + '\n';
            }
            
            if (trimmed.startsWith('<') && !trimmed.startsWith('</') && 
                !trimmed.endsWith('/>') && !trimmed.includes('</')) {
                indentLevel++;
            }
        });
        
        return formatted;
    }

    /**
     * Analyze file metrics
     */
    analyzeMetrics(content, filename) {
        const lines = content.split('\n');
        const extension = filename.split('.').pop().toLowerCase();
        
        const metrics = {
            filename,
            extension,
            size: content.length,
            lines: lines.length,
            nonEmptyLines: lines.filter(line => line.trim()).length,
            characters: content.length,
            words: content.split(/\s+/).filter(word => word).length
        };

        // Language-specific metrics
        if (['js', 'jsx', 'ts', 'tsx'].includes(extension)) {
            metrics.functions = (content.match(/function\s+\w+|=>\s*{|\w+\s*=\s*function/g) || []).length;
            metrics.classes = (content.match(/class\s+\w+/g) || []).length;
            metrics.imports = (content.match(/import\s+.*from/g) || []).length;
            metrics.exports = (content.match(/export\s+/g) || []).length;
        }

        return metrics;
    }

    /**
     * Cache management
     */
    getCached(key) {
        return this.cache.get(key);
    }

    setCached(key, value) {
        if (this.cache.size >= this.maxCacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }
}

// Create processor instance
const fileProcessor = new FileProcessor();

// Message handler
self.addEventListener('message', async (event) => {
    const { jobId, data, type } = event.data;
    
    try {
        let result;
        const cacheKey = `${data.action}_${data.filename}_${data.content?.substring(0, 100)}`;
        
        // Check cache for expensive operations
        if (['validate', 'format', 'analyze'].includes(data.action)) {
            const cached = fileProcessor.getCached(cacheKey);
            if (cached) {
                self.postMessage({ jobId, result: cached, type, cached: true });
                return;
            }
        }
        
        switch (data.action) {
            case 'validate':
                result = fileProcessor.validateSyntax(data.content, data.filename);
                break;
                
            case 'format':
                result = {
                    formatted: fileProcessor.formatContent(data.content, data.filename, data.options),
                    original: data.content
                };
                break;
                
            case 'analyze':
                result = fileProcessor.analyzeMetrics(data.content, data.filename);
                break;
                
            case 'process':
                // Generic file processing
                const validation = fileProcessor.validateSyntax(data.content, data.filename);
                const metrics = fileProcessor.analyzeMetrics(data.content, data.filename);
                result = {
                    validation,
                    metrics,
                    filename: data.filename
                };
                break;
                
            default:
                throw new Error(`Unknown action: ${data.action}`);
        }
        
        // Cache the result
        if (['validate', 'format', 'analyze'].includes(data.action)) {
            fileProcessor.setCached(cacheKey, result);
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