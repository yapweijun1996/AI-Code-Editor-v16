/**
 * Context Builder - Extracts and formats file context for AI
 * Works with ContextAnalyzer to provide intelligent context injection
 */

import * as Editor from './editor.js';

export class ContextBuilder {
    constructor() {
        this.maxContextLines = 100;
        this.contextPadding = 5; // Lines around cursor/selection
    }

    /**
     * Build context information based on analysis recommendations
     * @param {Object} contextSuggestion - Suggestion from ContextAnalyzer
     * @param {Object} fileInfo - Current file information
     * @returns {Object} Formatted context ready for AI
     */
    buildContext(contextSuggestion, fileInfo = null) {
        if (!contextSuggestion || !contextSuggestion.includeFileOverview) {
            return null;
        }

        // Get current file info if not provided
        if (!fileInfo) {
            fileInfo = this._getCurrentFileInfo();
        }

        if (!fileInfo) {
            return null;
        }

        const context = {
            file: {
                path: fileInfo.path,
                name: fileInfo.name,
                language: fileInfo.language,
                totalLines: fileInfo.totalLines
            },
            content: null,
            cursor: fileInfo.cursor,
            selection: fileInfo.selection,
            errors: null,
            summary: ''
        };

        // Build content based on context type
        if (contextSuggestion.includeSelection && fileInfo.selection && fileInfo.selection.text) {
            context.content = this._buildSelectionContext(fileInfo, contextSuggestion);
        } else if (contextSuggestion.includeCursorArea) {
            context.content = this._buildCursorContext(fileInfo, contextSuggestion);
        } else if (contextSuggestion.lineRange) {
            context.content = this._buildLineRangeContext(fileInfo, contextSuggestion);
        } else {
            context.content = this._buildSmartContext(fileInfo, contextSuggestion);
        }

        // Add error information if requested
        if (contextSuggestion.includeErrors) {
            context.errors = this._getFileErrors(fileInfo);
        }

        // Generate summary
        context.summary = this._generateContextSummary(context, contextSuggestion);

        return context;
    }

    /**
     * Get current file information from editor
     */
    _getCurrentFileInfo() {
        const activeFile = Editor.getActiveFile();
        const activeFilePath = Editor.getActiveFilePath();
        const editorInstance = Editor.getEditorInstance();

        if (!activeFile || !editorInstance) {
            return null;
        }

        const model = activeFile.model;
        const position = editorInstance.getPosition();
        const selection = editorInstance.getSelection();

        return {
            path: activeFilePath,
            name: activeFile.name,
            language: model.getLanguageId(),
            totalLines: model.getLineCount(),
            content: model.getValue(),
            cursor: {
                line: position ? position.lineNumber : 1,
                column: position ? position.column : 1
            },
            selection: selection && !selection.isEmpty() ? {
                startLine: selection.startLineNumber,
                startColumn: selection.startColumn,
                endLine: selection.endLineNumber,
                endColumn: selection.endColumn,
                text: model.getValueInRange(selection)
            } : null
        };
    }

    /**
     * Build context around selected text
     */
    _buildSelectionContext(fileInfo, suggestion) {
        if (!fileInfo.selection) {
            return this._buildCursorContext(fileInfo, suggestion);
        }

        const lines = fileInfo.content.split('\n');
        const startLine = Math.max(0, fileInfo.selection.startLine - this.contextPadding - 1);
        const endLine = Math.min(lines.length - 1, fileInfo.selection.endLine + this.contextPadding - 1);

        const contextLines = [];
        for (let i = startLine; i <= endLine; i++) {
            const lineNum = i + 1;
            const isSelected = lineNum >= fileInfo.selection.startLine && lineNum <= fileInfo.selection.endLine;
            contextLines.push({
                number: lineNum,
                content: lines[i],
                isSelected: isSelected,
                isCursor: lineNum === fileInfo.cursor.line
            });
        }

        return {
            type: 'selection',
            lines: contextLines,
            selectedText: fileInfo.selection.text,
            totalLines: contextLines.length
        };
    }

    /**
     * Build context around cursor position
     */
    _buildCursorContext(fileInfo, suggestion) {
        const lines = fileInfo.content.split('\n');
        const cursorLine = fileInfo.cursor.line;
        const contextRadius = Math.floor(suggestion.maxLines / 2);
        
        const startLine = Math.max(0, cursorLine - contextRadius - 1);
        const endLine = Math.min(lines.length - 1, cursorLine + contextRadius - 1);

        const contextLines = [];
        for (let i = startLine; i <= endLine; i++) {
            const lineNum = i + 1;
            contextLines.push({
                number: lineNum,
                content: lines[i],
                isCursor: lineNum === cursorLine,
                isSelected: false
            });
        }

        return {
            type: 'cursor',
            lines: contextLines,
            cursorLine: cursorLine,
            totalLines: contextLines.length
        };
    }

    /**
     * Build context for specific line range
     */
    _buildLineRangeContext(fileInfo, suggestion) {
        const lines = fileInfo.content.split('\n');
        const [startLine, endLine] = suggestion.lineRange;
        
        const actualStart = Math.max(0, startLine - 1);
        const actualEnd = Math.min(lines.length - 1, endLine - 1);

        const contextLines = [];
        for (let i = actualStart; i <= actualEnd; i++) {
            const lineNum = i + 1;
            contextLines.push({
                number: lineNum,
                content: lines[i],
                isCursor: lineNum === fileInfo.cursor.line,
                isSelected: false
            });
        }

        return {
            type: 'range',
            lines: contextLines,
            requestedRange: suggestion.lineRange,
            totalLines: contextLines.length
        };
    }

    /**
     * Build smart context (overview + cursor area)
     */
    _buildSmartContext(fileInfo, suggestion) {
        const lines = fileInfo.content.split('\n');
        
        // For small files, include everything
        if (lines.length <= suggestion.maxLines) {
            const contextLines = lines.map((line, index) => ({
                number: index + 1,
                content: line,
                isCursor: (index + 1) === fileInfo.cursor.line,
                isSelected: false
            }));

            return {
                type: 'full',
                lines: contextLines,
                totalLines: contextLines.length
            };
        }

        // For larger files, show cursor area + file structure
        const cursorContext = this._buildCursorContext(fileInfo, {
            ...suggestion,
            maxLines: Math.floor(suggestion.maxLines * 0.7)
        });

        // Add file structure overview
        const structure = this._extractFileStructure(fileInfo);

        return {
            type: 'smart',
            lines: cursorContext.lines,
            structure: structure,
            totalLines: cursorContext.lines.length
        };
    }

    /**
     * Extract file structure (functions, classes, etc.)
     */
    _extractFileStructure(fileInfo) {
        const lines = fileInfo.content.split('\n');
        const structure = [];

        // Simple pattern matching for common structures
        const patterns = {
            javascript: [
                /^\s*(function|const|let|var)\s+(\w+)/,
                /^\s*class\s+(\w+)/,
                /^\s*(\w+)\s*[:=]\s*(function|\()/
            ],
            typescript: [
                /^\s*(function|const|let|var)\s+(\w+)/,
                /^\s*class\s+(\w+)/,
                /^\s*(interface|type)\s+(\w+)/,
                /^\s*(\w+)\s*[:=]\s*(function|\()/
            ],
            python: [
                /^\s*def\s+(\w+)/,
                /^\s*class\s+(\w+)/,
                /^\s*(\w+)\s*=\s*lambda/
            ],
            java: [
                /^\s*(public|private|protected)?\s*(static)?\s*(class|interface)\s+(\w+)/,
                /^\s*(public|private|protected)?\s*(static)?\s*\w+\s+(\w+)\s*\(/
            ]
        };

        const langPatterns = patterns[fileInfo.language] || patterns.javascript;

        lines.forEach((line, index) => {
            for (const pattern of langPatterns) {
                const match = line.match(pattern);
                if (match) {
                    structure.push({
                        line: index + 1,
                        name: match[match.length - 1], // Last capture group is usually the name
                        type: this._determineStructureType(line),
                        content: line.trim()
                    });
                    break;
                }
            }
        });

        return structure.slice(0, 10); // Limit to top 10 items
    }

    /**
     * Determine structure type from line content
     */
    _determineStructureType(line) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('class')) return 'class';
        if (lowerLine.includes('function') || lowerLine.includes('def')) return 'function';
        if (lowerLine.includes('interface')) return 'interface';
        if (lowerLine.includes('type')) return 'type';
        return 'variable';
    }

    /**
     * Get error information for the file
     */
    _getFileErrors(fileInfo) {
        const errors = Editor.getFormattedErrors(fileInfo.path);
        if (!errors) return null;

        return {
            count: errors.split('\n').length,
            details: errors,
            hasErrors: true
        };
    }

    /**
     * Generate a summary of the context
     */
    _generateContextSummary(context, suggestion) {
        const parts = [];
        
        parts.push(`📁 ${context.file.name} (${context.file.language})`);
        parts.push(`📊 ${context.content.totalLines}/${context.file.totalLines} lines`);
        
        if (context.cursor) {
            parts.push(`📍 Cursor: Line ${context.cursor.line}`);
        }
        
        if (context.selection) {
            parts.push(`🎯 Selection: Lines ${context.selection.startLine}-${context.selection.endLine}`);
        }
        
        if (context.errors && context.errors.hasErrors) {
            parts.push(`⚠️ ${context.errors.count} error(s)`);
        }
        
        if (context.content.structure && context.content.structure.length > 0) {
            parts.push(`🏗️ ${context.content.structure.length} structure items`);
        }

        return parts.join(' | ');
    }

    /**
     * Format context for AI consumption
     */
    formatContextForAI(context) {
        if (!context) return '';

        const parts = [];
        
        // File header
        parts.push(`## Current File Context: ${context.file.name}`);
        parts.push(`**Language:** ${context.file.language} | **Total Lines:** ${context.file.totalLines}`);
        
        if (context.cursor) {
            parts.push(`**Cursor Position:** Line ${context.cursor.line}, Column ${context.cursor.column}`);
        }

        // Add errors if present
        if (context.errors && context.errors.hasErrors) {
            parts.push(`\n**⚠️ Errors Detected:**`);
            parts.push('```');
            parts.push(context.errors.details);
            parts.push('```');
        }

        // Add file structure if available
        if (context.content.structure && context.content.structure.length > 0) {
            parts.push(`\n**📋 File Structure:**`);
            context.content.structure.forEach(item => {
                parts.push(`- Line ${item.line}: ${item.type} \`${item.name}\``);
            });
        }

        // Add main content
        parts.push(`\n**📄 Code Context (${context.content.type}):**`);
        parts.push('```' + context.file.language);
        
        context.content.lines.forEach(line => {
            let prefix = `${line.number.toString().padStart(3, ' ')} | `;
            if (line.isCursor) prefix = `${line.number.toString().padStart(3, ' ')} >`;
            if (line.isSelected) prefix = `${line.number.toString().padStart(3, ' ')} *`;
            parts.push(prefix + line.content);
        });
        
        parts.push('```');

        // Add selection details if present
        if (context.selection) {
            parts.push(`\n**🎯 Selected Text:**`);
            parts.push('```' + context.file.language);
            parts.push(context.selection.text);
            parts.push('```');
        }

        return parts.join('\n');
    }
}

// Export singleton instance
export const contextBuilder = new ContextBuilder();