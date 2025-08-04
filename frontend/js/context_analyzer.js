/**
 * Context Analyzer - Intelligent Auto-Context Injection
 * Analyzes user queries to determine when current file context should be included
 */

export class ContextAnalyzer {
    constructor() {
        // Keywords that suggest the user is referring to current code
        this.codeReferenceKeywords = [
            'this', 'here', 'current', 'above', 'below', 'line', 'function', 'method', 'class',
            'variable', 'code', 'file', 'script', 'component', 'module', 'fix', 'debug',
            'optimize', 'refactor', 'improve', 'change', 'modify', 'update', 'add', 'remove',
            'error', 'bug', 'issue', 'problem', 'warning', 'syntax', 'logic', 'performance'
        ];

        // Question patterns that typically need code context
        this.contextRequiredPatterns = [
            /what\s+(is|does|should)\s+(this|it)/i,
            /how\s+(can|do|should)\s+i\s+(fix|improve|optimize|change)/i,
            /why\s+(is|does|doesn't)\s+(this|it)/i,
            /where\s+(is|should)\s+(this|it)/i,
            /can\s+you\s+(fix|improve|optimize|refactor)/i,
            /help\s+(me\s+)?(fix|debug|improve)/i,
            /what's\s+wrong\s+with/i,
            /how\s+to\s+(fix|improve|optimize)/i,
            /explain\s+(this|it)/i,
            /review\s+(this|my)/i,
            /check\s+(this|my)/i,
            /analyze\s+(this|my)/i
        ];

        // Patterns that suggest general questions (don't need context)
        this.generalQuestionPatterns = [
            /how\s+to\s+create/i,
            /what\s+is\s+the\s+best\s+way\s+to/i,
            /can\s+you\s+explain\s+\w+\s+in\s+general/i,
            /tell\s+me\s+about/i,
            /what\s+are\s+the\s+differences\s+between/i,
            /compare\s+\w+\s+and\s+\w+/i,
            /tutorial\s+for/i,
            /example\s+of/i
        ];
    }

    /**
     * Analyze user query to determine if current file context should be included
     * @param {string} userQuery - The user's message
     * @param {Object} currentFileInfo - Information about the currently opened file
     * @returns {Object} Analysis result with recommendation and confidence
     */
    analyzeQuery(userQuery, currentFileInfo) {
        if (!userQuery || !currentFileInfo) {
            return {
                shouldIncludeContext: false,
                confidence: 0,
                reason: 'No query or file available'
            };
        }

        const analysis = {
            shouldIncludeContext: false,
            confidence: 0,
            reason: '',
            contextType: 'none',
            suggestedContext: null
        };

        // Check for explicit file references
        if (this._hasExplicitFileReference(userQuery)) {
            analysis.shouldIncludeContext = false;
            analysis.confidence = 0.9;
            analysis.reason = 'User explicitly mentioned files - likely using read_file tool';
            return analysis;
        }

        // Check for general questions that don't need context
        if (this._isGeneralQuestion(userQuery)) {
            analysis.shouldIncludeContext = false;
            analysis.confidence = 0.8;
            analysis.reason = 'General question - context not needed';
            return analysis;
        }

        // Check for context-required patterns
        const patternMatch = this._matchesContextPattern(userQuery);
        if (patternMatch.matches) {
            analysis.shouldIncludeContext = true;
            analysis.confidence = patternMatch.confidence;
            analysis.reason = `Query matches pattern: ${patternMatch.pattern}`;
            analysis.contextType = this._determineContextType(userQuery, currentFileInfo);
            analysis.suggestedContext = this._buildSuggestedContext(userQuery, currentFileInfo, analysis.contextType);
            return analysis;
        }

        // Check for code reference keywords
        const keywordScore = this._calculateKeywordScore(userQuery);
        if (keywordScore > 0.3) {
            analysis.shouldIncludeContext = true;
            analysis.confidence = Math.min(keywordScore, 0.85);
            analysis.reason = `High keyword relevance score: ${keywordScore.toFixed(2)}`;
            analysis.contextType = this._determineContextType(userQuery, currentFileInfo);
            analysis.suggestedContext = this._buildSuggestedContext(userQuery, currentFileInfo, analysis.contextType);
            return analysis;
        }

        // Default: don't include context for ambiguous queries
        analysis.reason = 'Query appears to be general or ambiguous';
        return analysis;
    }

    /**
     * Check if user explicitly mentioned files or paths
     */
    _hasExplicitFileReference(query) {
        const filePatterns = [
            /read\s+file/i,
            /open\s+file/i,
            /in\s+file\s+[\w\/\.\-]+/i,
            /[\w\/\.\-]+\.(js|ts|html|css|py|java|cpp|c|php|rb|go|rs)/i,
            /from\s+[\w\/\.\-]+/i,
            /check\s+[\w\/\.\-]+/i
        ];
        
        return filePatterns.some(pattern => pattern.test(query));
    }

    /**
     * Check if query is a general question that doesn't need current file context
     */
    _isGeneralQuestion(query) {
        return this.generalQuestionPatterns.some(pattern => pattern.test(query));
    }

    /**
     * Check if query matches patterns that typically require context
     */
    _matchesContextPattern(query) {
        for (const pattern of this.contextRequiredPatterns) {
            if (pattern.test(query)) {
                return {
                    matches: true,
                    pattern: pattern.source,
                    confidence: 0.85
                };
            }
        }
        return { matches: false, confidence: 0 };
    }

    /**
     * Calculate relevance score based on code reference keywords
     */
    _calculateKeywordScore(query) {
        const words = query.toLowerCase().split(/\s+/);
        const matchedKeywords = words.filter(word => 
            this.codeReferenceKeywords.some(keyword => 
                word.includes(keyword) || keyword.includes(word)
            )
        );
        
        return matchedKeywords.length / Math.max(words.length, 5); // Normalize by query length
    }

    /**
     * Determine what type of context to include
     */
    _determineContextType(query, fileInfo) {
        const lowerQuery = query.toLowerCase();
        
        // Check for specific context needs
        if (lowerQuery.includes('error') || lowerQuery.includes('bug') || lowerQuery.includes('debug')) {
            return 'error_context';
        }
        
        if (lowerQuery.includes('function') || lowerQuery.includes('method')) {
            return 'function_context';
        }
        
        if (lowerQuery.includes('line') || /line\s+\d+/i.test(query)) {
            return 'line_context';
        }
        
        if (lowerQuery.includes('selected') || lowerQuery.includes('highlighted')) {
            return 'selection_context';
        }
        
        // Default to smart context (cursor area + file overview)
        return 'smart_context';
    }

    /**
     * Build suggested context based on analysis
     */
    _buildSuggestedContext(query, fileInfo, contextType) {
        const context = {
            includeFileOverview: true,
            includeSelection: false,
            includeCursorArea: true,
            includeErrors: false,
            lineRange: null,
            maxLines: 50
        };

        switch (contextType) {
            case 'error_context':
                context.includeErrors = true;
                context.includeCursorArea = true;
                context.maxLines = 30;
                break;
                
            case 'function_context':
                context.includeCursorArea = true;
                context.maxLines = 40;
                break;
                
            case 'line_context':
                context.includeCursorArea = true;
                context.maxLines = 20;
                // Extract line number if mentioned
                const lineMatch = query.match(/line\s+(\d+)/i);
                if (lineMatch) {
                    const lineNum = parseInt(lineMatch[1]);
                    context.lineRange = [Math.max(1, lineNum - 10), lineNum + 10];
                }
                break;
                
            case 'selection_context':
                context.includeSelection = true;
                context.includeCursorArea = false;
                context.maxLines = 30;
                break;
                
            case 'smart_context':
            default:
                context.includeCursorArea = true;
                context.maxLines = 40;
                break;
        }

        return context;
    }

    /**
     * Generate context summary for logging/debugging
     */
    generateContextSummary(analysis, fileInfo) {
        if (!analysis.shouldIncludeContext) {
            return `No context needed: ${analysis.reason}`;
        }

        const parts = [];
        parts.push(`File: ${fileInfo.name || 'Unknown'}`);
        parts.push(`Type: ${analysis.contextType}`);
        parts.push(`Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);
        parts.push(`Reason: ${analysis.reason}`);

        return parts.join(' | ');
    }
}

// Export singleton instance
export const contextAnalyzer = new ContextAnalyzer();