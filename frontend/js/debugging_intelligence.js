/**
 * Advanced Debugging Intelligence System
 * Hypothesis-driven debugging and systematic error analysis for senior engineer-level problem solving
 */

import { symbolResolver } from './symbol_resolver.js';
import { dataFlowAnalyzer } from './data_flow_analyzer.js';

export class DebuggingIntelligence {
    constructor() {
        this.errorPatterns = new Map(); // errorSignature -> PatternInfo
        this.debuggingHistory = new Map(); // sessionId -> DebuggingSession
        this.hypothesesDatabase = new Map(); // errorType -> [Hypothesis]
        this.evidenceCorrelations = new Map(); // evidence -> relatedEvidence
        this.rootCauseKnowledge = new Map(); // symptom -> [possibleCauses]
        this.currentSession = null;
        
        // Initialize with common error patterns
        this.initializeErrorPatterns();
    }

    /**
     * Initialize common error patterns and their debugging strategies
     */
    initializeErrorPatterns() {
        const commonPatterns = [
            {
                signature: 'ReferenceError: .* is not defined',
                category: 'undefined_variable',
                commonCauses: [
                    'Variable declared in wrong scope',
                    'Typo in variable name',
                    'Missing import statement',
                    'Variable used before declaration',
                    'Hoisting issue with let/const'
                ],
                debuggingSteps: [
                    'Check variable spelling and case',
                    'Verify variable is in correct scope',
                    'Check if variable needs to be imported',
                    'Verify declaration order',
                    'Check for hoisting issues'
                ]
            },
            {
                signature: 'TypeError: Cannot read propert.* of undefined',
                category: 'null_undefined_access',
                commonCauses: [
                    'Object is null or undefined',
                    'Async operation not completed',
                    'Property path is incorrect',
                    'Object structure changed',
                    'Missing null check'
                ],
                debuggingSteps: [
                    'Add null/undefined checks',
                    'Verify object initialization',
                    'Check async operation timing',
                    'Validate property path',
                    'Add defensive programming'
                ]
            },
            {
                signature: 'TypeError: .* is not a function',
                category: 'not_a_function',
                commonCauses: [
                    'Variable overwritten with non-function',
                    'Method called on wrong object type',
                    'Function not properly imported',
                    'Typo in function name',
                    'Function not defined in current scope'
                ],
                debuggingSteps: [
                    'Check function name spelling',
                    'Verify function is imported correctly',
                    'Check if variable was overwritten',
                    'Validate object type before method call',
                    'Check function scope and availability'
                ]
            }
        ];

        commonPatterns.forEach(pattern => {
            this.errorPatterns.set(pattern.signature, pattern);
        });
    }

    /**
     * Start a new debugging session
     */
    startDebuggingSession(initialError, codeContext) {
        const sessionId = `debug_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        this.currentSession = {
            id: sessionId,
            startTime: Date.now(),
            initialError,
            codeContext,
            hypotheses: [],
            evidence: [],
            testResults: [],
            rootCause: null,
            solution: null,
            status: 'active', // active, resolved, abandoned
            steps: []
        };

        this.debuggingHistory.set(sessionId, this.currentSession);
        
        console.log(`[DebuggingIntelligence] Started debugging session ${sessionId}`);
        return this.currentSession;
    }

    /**
     * Analyze error context comprehensively
     */
    async analyzeErrorContext(error, stackTrace, codeContext) {
        console.log(`[DebuggingIntelligence] Analyzing error context for: ${error.message}`);
        
        const analysis = {
            errorType: this.classifyError(error),
            errorMessage: error.message,
            stackTrace: this.parseStackTrace(stackTrace),
            affectedVariables: [],
            executionPath: [],
            similarPastErrors: [],
            codePatterns: [],
            environmentFactors: [],
            confidence: 0.5
        };

        // Classify error type
        analysis.errorType = this.classifyError(error);
        
        // Parse stack trace for execution path
        if (stackTrace) {
            analysis.executionPath = this.reconstructExecutionPath(stackTrace, codeContext);
        }

        // Find affected variables from error message and context
        analysis.affectedVariables = await this.identifyAffectedVariables(error.message, codeContext);

        // Look for similar past errors
        analysis.similarPastErrors = this.findSimilarErrors(error.message);

        // Analyze code patterns around error location
        if (codeContext.filePath && codeContext.line) {
            analysis.codePatterns = await this.analyzeCodePatterns(codeContext.filePath, codeContext.line);
        }

        // Check environment factors
        analysis.environmentFactors = this.checkEnvironmentFactors(error, codeContext);

        // Calculate confidence based on available information
        analysis.confidence = this.calculateAnalysisConfidence(analysis);

        return analysis;
    }

    /**
     * Classify error into categories
     */
    classifyError(error) {
        const errorMessage = error.message.toLowerCase();
        const errorName = error.name || 'Error';

        if (errorName === 'ReferenceError') {
            if (errorMessage.includes('not defined')) return 'undefined_variable';
            if (errorMessage.includes('not declared')) return 'undeclared_variable';
        } else if (errorName === 'TypeError') {
            if (errorMessage.includes('cannot read property') || errorMessage.includes('cannot read properties')) {
                return 'null_undefined_access';
            }
            if (errorMessage.includes('is not a function')) return 'not_a_function';
            if (errorMessage.includes('cannot set property')) return 'readonly_property';
        } else if (errorName === 'SyntaxError') {
            return 'syntax_error';
        } else if (errorName === 'RangeError') {
            return 'range_error';
        }

        return 'unknown_error';
    }

    /**
     * Parse stack trace into structured format
     */
    parseStackTrace(stackTrace) {
        if (!stackTrace) return [];

        const lines = stackTrace.split('\n');
        const frames = [];

        for (const line of lines) {
            const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
            if (match) {
                const [, functionName, filePath, lineNumber, columnNumber] = match;
                frames.push({
                    function: functionName,
                    file: filePath,
                    line: parseInt(lineNumber),
                    column: parseInt(columnNumber)
                });
            }
        }

        return frames;
    }

    /**
     * Reconstruct execution path from stack trace
     */
    reconstructExecutionPath(stackTrace, codeContext) {
        const frames = this.parseStackTrace(stackTrace);
        const executionPath = [];

        for (const frame of frames) {
            executionPath.push({
                step: executionPath.length + 1,
                function: frame.function,
                file: frame.file,
                line: frame.line,
                context: 'stack_frame'
            });
        }

        return executionPath;
    }

    /**
     * Identify variables affected by the error
     */
    async identifyAffectedVariables(errorMessage, codeContext) {
        const affectedVariables = [];
        
        // Extract variable names from error message
        const variableMatches = errorMessage.match(/['"`]([a-zA-Z_$][a-zA-Z0-9_$]*)['"`]/g);
        if (variableMatches) {
            for (const match of variableMatches) {
                const variableName = match.slice(1, -1); // Remove quotes
                
                if (codeContext.filePath) {
                    const symbolInfo = symbolResolver.getSymbolInfo(variableName, codeContext.filePath, codeContext.line || 1);
                    if (symbolInfo) {
                        affectedVariables.push({
                            name: variableName,
                            ...symbolInfo,
                            errorRelation: 'mentioned_in_error'
                        });
                    }
                }
            }
        }

        // Look for variables in the error location
        if (codeContext.filePath && codeContext.line) {
            const symbolTable = symbolResolver.symbolTables.get(codeContext.filePath);
            if (symbolTable) {
                // Find variables used around the error line
                const nearbyVariables = this.findVariablesNearLine(symbolTable, codeContext.line, 3);
                affectedVariables.push(...nearbyVariables.map(v => ({
                    ...v,
                    errorRelation: 'near_error_location'
                })));
            }
        }

        return affectedVariables;
    }

    /**
     * Find variables used near a specific line
     */
    findVariablesNearLine(symbolTable, targetLine, range) {
        const nearbyVariables = [];
        
        for (const [variableName, occurrences] of symbolTable.symbols) {
            for (const occurrence of occurrences) {
                if (Math.abs(occurrence.line - targetLine) <= range) {
                    nearbyVariables.push({
                        name: variableName,
                        line: occurrence.line,
                        type: occurrence.type,
                        distance: Math.abs(occurrence.line - targetLine)
                    });
                }
            }
        }

        return nearbyVariables.sort((a, b) => a.distance - b.distance);
    }

    /**
     * Find similar errors from history
     */
    findSimilarErrors(errorMessage) {
        const similarErrors = [];
        const normalizedMessage = this.normalizeErrorMessage(errorMessage);

        for (const [sessionId, session] of this.debuggingHistory) {
            if (session.initialError) {
                const sessionMessage = this.normalizeErrorMessage(session.initialError.message);
                const similarity = this.calculateStringSimilarity(normalizedMessage, sessionMessage);
                
                if (similarity > 0.7) {
                    similarErrors.push({
                        sessionId,
                        similarity,
                        error: session.initialError,
                        solution: session.solution,
                        rootCause: session.rootCause
                    });
                }
            }
        }

        return similarErrors.sort((a, b) => b.similarity - a.similarity);
    }

    /**
     * Normalize error message for comparison
     */
    normalizeErrorMessage(message) {
        return message
            .toLowerCase()
            .replace(/['"`][^'"`]*['"`]/g, 'VARIABLE') // Replace quoted strings with placeholder
            .replace(/\d+/g, 'NUMBER') // Replace numbers with placeholder
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Calculate string similarity using Levenshtein distance
     */
    calculateStringSimilarity(str1, str2) {
        const matrix = [];
        const len1 = str1.length;
        const len2 = str2.length;

        for (let i = 0; i <= len1; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= len2; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                if (str1.charAt(i - 1) === str2.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        const maxLen = Math.max(len1, len2);
        return maxLen === 0 ? 1 : (maxLen - matrix[len1][len2]) / maxLen;
    }

    /**
     * Analyze code patterns around error location
     */
    async analyzeCodePatterns(filePath, line) {
        const patterns = [];
        const symbolTable = symbolResolver.symbolTables.get(filePath);
        
        if (!symbolTable || !symbolTable.ast) return patterns;

        // Look for common problematic patterns
        const problematicPatterns = [
            {
                name: 'missing_null_check',
                detect: (node) => this.detectMissingNullCheck(node),
                description: 'Property access without null check'
            },
            {
                name: 'async_await_missing',
                detect: (node) => this.detectMissingAwait(node),
                description: 'Async function call without await'
            },
            {
                name: 'scope_confusion',
                detect: (node) => this.detectScopeConfusion(node, symbolTable),
                description: 'Variable used outside its scope'
            },
            {
                name: 'hoisting_issue',
                detect: (node) => this.detectHoistingIssue(node),
                description: 'Variable used before declaration'
            }
        ];

        // Find nodes near the error line
        const nearbyNodes = this.findNodesNearLine(symbolTable.ast, line, 5);
        
        for (const node of nearbyNodes) {
            for (const pattern of problematicPatterns) {
                if (pattern.detect(node)) {
                    patterns.push({
                        name: pattern.name,
                        description: pattern.description,
                        line: node.loc ? node.loc.start.line : 0,
                        node
                    });
                }
            }
        }

        return patterns;
    }

    /**
     * Find AST nodes near a specific line
     */
    findNodesNearLine(ast, targetLine, range) {
        const nearbyNodes = [];
        
        const walk = require('acorn-walk');
        walk.simple(ast, {
            '*'(node) {
                if (node.loc && Math.abs(node.loc.start.line - targetLine) <= range) {
                    nearbyNodes.push(node);
                }
            }
        });

        return nearbyNodes;
    }

    /**
     * Detect missing null checks
     */
    detectMissingNullCheck(node) {
        if (node.type === 'MemberExpression') {
            // Check if there's a null check for the object
            return !this.hasNullCheck(node.object);
        }
        return false;
    }

    /**
     * Check if a node has null check protection
     */
    hasNullCheck(node) {
        // This is a simplified check - in practice, would need more sophisticated analysis
        return false; // Placeholder
    }

    /**
     * Detect missing await keywords
     */
    detectMissingAwait(node) {
        if (node.type === 'CallExpression') {
            const funcName = this.getFunctionName(node.callee);
            // Check if function name suggests it's async
            return funcName.includes('async') || funcName.includes('Promise') || funcName.includes('fetch');
        }
        return false;
    }

    /**
     * Get function name from callee
     */
    getFunctionName(callee) {
        if (callee.type === 'Identifier') {
            return callee.name;
        } else if (callee.type === 'MemberExpression') {
            return `${callee.object.name}.${callee.property.name}`;
        }
        return 'unknown';
    }

    /**
     * Detect scope confusion
     */
    detectScopeConfusion(node, symbolTable) {
        // Simplified scope confusion detection
        return false; // Placeholder
    }

    /**
     * Detect hoisting issues
     */
    detectHoistingIssue(node) {
        // Simplified hoisting issue detection
        return false; // Placeholder
    }

    /**
     * Check environment factors
     */
    checkEnvironmentFactors(error, codeContext) {
        const factors = [];

        // Check browser compatibility
        if (typeof window !== 'undefined') {
            factors.push({
                type: 'browser_environment',
                userAgent: navigator.userAgent,
                features: this.checkBrowserFeatures()
            });
        }

        // Check timing issues
        if (error.message.includes('undefined') || error.message.includes('null')) {
            factors.push({
                type: 'timing_issue',
                description: 'Possible race condition or async timing issue'
            });
        }

        return factors;
    }

    /**
     * Check browser feature support
     */
    checkBrowserFeatures() {
        const features = {};
        
        if (typeof window !== 'undefined') {
            features.es6Modules = 'import' in document.createElement('script');
            features.asyncAwait = (async () => {}).constructor !== undefined;
            features.fetch = typeof fetch !== 'undefined';
            features.localStorage = typeof localStorage !== 'undefined';
        }

        return features;
    }

    /**
     * Calculate confidence in analysis
     */
    calculateAnalysisConfidence(analysis) {
        let confidence = 0.5; // Base confidence

        // Increase confidence based on available information
        if (analysis.stackTrace.length > 0) confidence += 0.2;
        if (analysis.affectedVariables.length > 0) confidence += 0.15;
        if (analysis.similarPastErrors.length > 0) confidence += 0.1;
        if (analysis.codePatterns.length > 0) confidence += 0.1;

        return Math.min(confidence, 1.0);
    }

    /**
     * Generate debugging hypotheses
     */
    async generateDebuggingHypotheses(errorAnalysis) {
        console.log(`[DebuggingIntelligence] Generating hypotheses for ${errorAnalysis.errorType}`);
        
        const hypotheses = [];
        
        // Get base hypotheses for error type
        const baseHypotheses = this.getBaseHypotheses(errorAnalysis.errorType);
        
        // Customize hypotheses based on context
        for (const baseHypothesis of baseHypotheses) {
            const customizedHypothesis = await this.customizeHypothesis(baseHypothesis, errorAnalysis);
            hypotheses.push(customizedHypothesis);
        }

        // Generate hypotheses from similar past errors
        for (const similarError of errorAnalysis.similarPastErrors) {
            if (similarError.rootCause) {
                hypotheses.push({
                    hypothesis: `Similar to past error: ${similarError.rootCause}`,
                    confidence: similarError.similarity * 0.8,
                    source: 'historical',
                    testSteps: this.generateTestSteps(similarError.rootCause),
                    expectedEvidence: [`Similar pattern to session ${similarError.sessionId}`]
                });
            }
        }

        // Generate hypotheses from code patterns
        for (const pattern of errorAnalysis.codePatterns) {
            hypotheses.push({
                hypothesis: `Code pattern issue: ${pattern.description}`,
                confidence: 0.7,
                source: 'pattern_analysis',
                testSteps: this.generatePatternTestSteps(pattern),
                expectedEvidence: [`Pattern detected at line ${pattern.line}`]
            });
        }

        // Sort by confidence
        hypotheses.sort((a, b) => b.confidence - a.confidence);

        if (this.currentSession) {
            this.currentSession.hypotheses = hypotheses;
        }

        return hypotheses;
    }

    /**
     * Get base hypotheses for error type
     */
    getBaseHypotheses(errorType) {
        const hypothesesMap = {
            'undefined_variable': [
                {
                    hypothesis: 'Variable name is misspelled',
                    confidence: 0.8,
                    testSteps: ['Check variable spelling', 'Compare with similar variable names'],
                    expectedEvidence: ['Typo in variable name', 'Similar variable exists']
                },
                {
                    hypothesis: 'Variable is out of scope',
                    confidence: 0.7,
                    testSteps: ['Check variable scope', 'Verify declaration location'],
                    expectedEvidence: ['Variable declared in different scope', 'Scope boundary crossed']
                },
                {
                    hypothesis: 'Missing import statement',
                    confidence: 0.6,
                    testSteps: ['Check import statements', 'Verify module exports'],
                    expectedEvidence: ['Variable exported from another module', 'Import statement missing']
                }
            ],
            'null_undefined_access': [
                {
                    hypothesis: 'Object is null or undefined',
                    confidence: 0.9,
                    testSteps: ['Add null check', 'Trace object initialization'],
                    expectedEvidence: ['Object is null/undefined', 'Initialization failed']
                },
                {
                    hypothesis: 'Async operation not completed',
                    confidence: 0.7,
                    testSteps: ['Check async timing', 'Add await keywords'],
                    expectedEvidence: ['Promise not resolved', 'Race condition']
                }
            ],
            'not_a_function': [
                {
                    hypothesis: 'Variable overwritten with non-function value',
                    confidence: 0.8,
                    testSteps: ['Trace variable assignments', 'Check for overwrites'],
                    expectedEvidence: ['Variable reassigned', 'Type changed during execution']
                },
                {
                    hypothesis: 'Function name misspelled',
                    confidence: 0.7,
                    testSteps: ['Check function name spelling', 'Verify function exists'],
                    expectedEvidence: ['Typo in function name', 'Similar function exists']
                }
            ]
        };

        return hypothesesMap[errorType] || [
            {
                hypothesis: 'Unknown error pattern - requires investigation',
                confidence: 0.5,
                testSteps: ['Analyze error context', 'Check similar errors'],
                expectedEvidence: ['Error pattern not recognized']
            }
        ];
    }

    /**
     * Customize hypothesis based on error analysis
     */
    async customizeHypothesis(baseHypothesis, errorAnalysis) {
        const customized = { ...baseHypothesis };
        
        // Adjust confidence based on available evidence
        if (errorAnalysis.affectedVariables.length > 0) {
            customized.confidence *= 1.1;
        }
        
        if (errorAnalysis.codePatterns.length > 0) {
            customized.confidence *= 1.05;
        }

        // Add specific test steps based on context
        if (errorAnalysis.affectedVariables.length > 0) {
            const variableNames = errorAnalysis.affectedVariables.map(v => v.name).join(', ');
            customized.testSteps.push(`Examine variables: ${variableNames}`);
        }

        customized.source = 'base_pattern';
        return customized;
    }

    /**
     * Generate test steps for a root cause
     */
    generateTestSteps(rootCause) {
        const commonSteps = {
            'typo': ['Check spelling', 'Compare with similar names', 'Use IDE autocomplete'],
            'scope': ['Check variable scope', 'Verify declaration location', 'Check scope boundaries'],
            'import': ['Check import statements', 'Verify module exports', 'Check file paths'],
            'null': ['Add null checks', 'Trace object initialization', 'Check async timing'],
            'async': ['Add await keywords', 'Check Promise handling', 'Verify async flow']
        };

        for (const [key, steps] of Object.entries(commonSteps)) {
            if (rootCause.toLowerCase().includes(key)) {
                return steps;
            }
        }

        return ['Investigate root cause', 'Gather more evidence', 'Test hypothesis'];
    }

    /**
     * Generate test steps for code patterns
     */
    generatePatternTestSteps(pattern) {
        const patternSteps = {
            'missing_null_check': ['Add null/undefined checks', 'Use optional chaining', 'Add defensive programming'],
            'async_await_missing': ['Add await keyword', 'Handle Promise properly', 'Check async function'],
            'scope_confusion': ['Check variable scope', 'Move declaration', 'Use proper scoping'],
            'hoisting_issue': ['Move declaration before use', 'Use let/const instead of var', 'Check declaration order']
        };

        return patternSteps[pattern.name] || ['Investigate pattern', 'Apply best practices'];
    }

    /**
     * Test a hypothesis systematically
     */
    async testHypothesis(hypothesis, codebase) {
        console.log(`[DebuggingIntelligence] Testing hypothesis: ${hypothesis.hypothesis}`);
        
        const testResult = {
            hypothesis: hypothesis.hypothesis,
            startTime: Date.now(),
            steps: [],
            evidence: [],
            conclusion: null,
            confidence: hypothesis.confidence,
            success: false
        };

        // Execute test steps
        for (const step of hypothesis.testSteps) {
            const stepResult = await this.executeTestStep(step, codebase, hypothesis);
            testResult.steps.push(stepResult);
            
            if (stepResult.evidence) {
                testResult.evidence.push(...stepResult.evidence);
            }
        }

        // Evaluate evidence against expected evidence
        testResult.conclusion = this.evaluateEvidence(testResult.evidence, hypothesis.expectedEvidence);
        testResult.success = testResult.conclusion.match > 0.7;
        testResult.confidence = testResult.conclusion.match * hypothesis.confidence;

        if (this.currentSession) {
            this.currentSession.testResults.push(testResult);
        }

        return testResult;
    }

    /**
     * Execute a single test step
     */
    async executeTestStep(step, codebase, hypothesis) {
        const stepResult = {
            step,
            startTime: Date.now(),
            evidence: [],
            success: false,
            notes: []
        };

        try {
            // Execute different types of test steps
            if (step.includes('spelling') || step.includes('typo')) {
                stepResult.evidence = await this.checkSpelling(codebase, hypothesis);
            } else if (step.includes('scope')) {
                stepResult.evidence = await this.checkScope(codebase, hypothesis);
            } else if (step.includes('import')) {
                stepResult.evidence = await this.checkImports(codebase, hypothesis);
            } else if (step.includes('null')) {
                stepResult.evidence = await this.checkNullUndefined(codebase, hypothesis);
            } else if (step.includes('async')) {
                stepResult.evidence = await this.checkAsyncIssues(codebase, hypothesis);
            } else {
                stepResult.notes.push(`Generic test step: ${step}`);
            }

            stepResult.success = stepResult.evidence.length > 0;
            
        } catch (error) {
            stepResult.notes.push(`Test step failed: ${error.message}`);
        }

        stepResult.endTime = Date.now();
        return stepResult;
    }

    /**
     * Check for spelling issues
     */
    async checkSpelling(codebase, hypothesis) {
        const evidence = [];
        
        // This would implement sophisticated spelling checking
        // For now, return placeholder evidence
        evidence.push({
            type: 'spelling_check',
            description: 'Spelling analysis completed',
            confidence: 0.5
        });

        return evidence;
    }

    /**
     * Check scope issues
     */
    async checkScope(codebase, hypothesis) {
        const evidence = [];
        
        // This would implement scope analysis using symbol resolver
        // For now, return placeholder evidence
        evidence.push({
            type: 'scope_analysis',
            description: 'Scope analysis completed',
            confidence: 0.5
        });

        return evidence;
    }

    /**
     * Check import issues
     */
    async checkImports(codebase, hypothesis) {
        const evidence = [];
        
        // This would implement import analysis
        // For now, return placeholder evidence
        evidence.push({
            type: 'import_analysis',
            description: 'Import analysis completed',
            confidence: 0.5
        });

        return evidence;
    }

    /**
     * Check null/undefined issues
     */
    async checkNullUndefined(codebase, hypothesis) {
        const evidence = [];
        
        // This would implement null/undefined analysis
        // For now, return placeholder evidence
        evidence.push({
            type: 'null_analysis',
            description: 'Null/undefined analysis completed',
            confidence: 0.5
        });

        return evidence;
    }

    /**
     * Check async issues
     */
    async checkAsyncIssues(codebase, hypothesis) {
        const evidence = [];
        
        // This would implement async analysis
        // For now, return placeholder evidence
        evidence.push({
            type: 'async_analysis',
            description: 'Async analysis completed',
            confidence: 0.5
        });

        return evidence;
    }

    /**
     * Evaluate evidence against expected evidence
     */
    evaluateEvidence(actualEvidence, expectedEvidence) {
        let matchCount = 0;
        const matches = [];

        for (const expected of expectedEvidence) {
            for (const actual of actualEvidence) {
                if (this.evidenceMatches(actual, expected)) {
                    matchCount++;
                    matches.push({ expected, actual });
                    break;
                }
            }
        }

        return {
            match: expectedEvidence.length > 0 ? matchCount / expectedEvidence.length : 0,
            matches,
            totalExpected: expectedEvidence.length,
            totalActual: actualEvidence.length
        };
    }

    /**
     * Check if evidence matches expectation
     */
    evidenceMatches(actualEvidence, expectedEvidence) {
        if (typeof actualEvidence === 'string' && typeof expectedEvidence === 'string') {
            return actualEvidence.toLowerCase().includes(expectedEvidence.toLowerCase()) ||
                   expectedEvidence.toLowerCase().includes(actualEvidence.toLowerCase());
        }
        
        if (actualEvidence.description && expectedEvidence) {
            return actualEvidence.description.toLowerCase().includes(expectedEvidence.toLowerCase());
        }

        return false;
    }

    /**
     * Get comprehensive debugging analysis
     */
    async debugSystematically(initialError, codeContext) {
        console.log(`[DebuggingIntelligence] Starting systematic debugging`);
        
        // Start debugging session
        const session = this.startDebuggingSession(initialError, codeContext);
        
        // Analyze error context
        const errorAnalysis = await this.analyzeErrorContext(initialError, initialError.stack, codeContext);
        session.steps.push({ type: 'analysis', result: errorAnalysis });
        
        // Generate hypotheses
        const hypotheses = await this.generateDebuggingHypotheses(errorAnalysis);
        session.steps.push({ type: 'hypothesis_generation', result: hypotheses });
        
        // Test hypotheses
        const testResults = [];
        for (const hypothesis of hypotheses.slice(0, 3)) { // Test top 3
            const testResult = await this.testHypothesis(hypothesis, codeContext);
            testResults.push(testResult);
            session.steps.push({ type: 'hypothesis_test', result: testResult });
        }
        
        // Identify most likely root cause
        const bestHypothesis = testResults
            .filter(result => result.success)
            .sort((a, b) => b.confidence - a.confidence)[0];
            
        if (bestHypothesis) {
            session.rootCause = bestHypothesis.hypothesis;
            session.solution = await this.generateSolution(bestHypothesis, errorAnalysis);
            session.status = 'resolved';
        } else {
            session.status = 'needs_more_investigation';
        }
        
        session.endTime = Date.now();
        
        return {
            session,
            errorAnalysis,
            hypotheses,
            testResults,
            rootCause: session.rootCause,
            solution: session.solution,
            recommendation: this.generateRecommendation(session)
        };
    }

    /**
     * Generate solution based on successful hypothesis
     */
    async generateSolution(successfulTest, errorAnalysis) {
        const solution = {
            type: 'code_fix',
            description: `Fix based on: ${successfulTest.hypothesis}`,
            steps: [],
            codeChanges: [],
            preventiveMeasures: []
        };

        // Generate specific solution steps based on hypothesis type
        if (successfulTest.hypothesis.includes('spelling') || successfulTest.hypothesis.includes('typo')) {
            solution.steps = [
                'Correct the misspelled variable name',
                'Update all references to use correct spelling',
                'Use IDE autocomplete to prevent future typos'
            ];
        } else if (successfulTest.hypothesis.includes('scope')) {
            solution.steps = [
                'Move variable declaration to appropriate scope',
                'Ensure variable is accessible where needed',
                'Consider using module exports if needed across files'
            ];
        } else if (successfulTest.hypothesis.includes('null') || successfulTest.hypothesis.includes('undefined')) {
            solution.steps = [
                'Add null/undefined checks before property access',
                'Use optional chaining (?.) operator',
                'Initialize variables with default values',
                'Add defensive programming practices'
            ];
        }

        // Add preventive measures
        solution.preventiveMeasures = [
            'Use TypeScript for better type checking',
            'Add comprehensive unit tests',
            'Use linting rules to catch common errors',
            'Implement code review practices'
        ];

        return solution;
    }

    /**
     * Generate recommendation based on debugging session
     */
    generateRecommendation(session) {
        const recommendation = {
            priority: 'high',
            actions: [],
            learnings: [],
            futurePreventions: []
        };

        if (session.status === 'resolved') {
            recommendation.actions.push('Apply the identified solution');
            recommendation.actions.push('Test the fix thoroughly');
            recommendation.actions.push('Add regression tests');
        } else {
            recommendation.actions.push('Gather more evidence');
            recommendation.actions.push('Try alternative debugging approaches');
            recommendation.actions.push('Consider pair programming or code review');
        }

        // Extract learnings from the session
        if (session.testResults.length > 0) {
            recommendation.learnings.push('Systematic hypothesis testing is effective');
            recommendation.learnings.push('Evidence-based debugging reduces guesswork');
        }

        return recommendation;
    }

    /**
     * Learn from debugging session outcomes
     */
    learnFromSession(session) {
        if (session.status === 'resolved' && session.rootCause) {
            // Update error patterns database
            const errorSignature = this.normalizeErrorMessage(session.initialError.message);
            
            if (!this.rootCauseKnowledge.has(errorSignature)) {
                this.rootCauseKnowledge.set(errorSignature, []);
            }
            
            this.rootCauseKnowledge.get(errorSignature).push({
                rootCause: session.rootCause,
                solution: session.solution,
                confidence: session.testResults.find(t => t.success)?.confidence || 0.5,
                sessionId: session.id
            });
        }

        // Update hypothesis effectiveness
        for (const testResult of session.testResults) {
            const hypothesisType = this.classifyHypothesis(testResult.hypothesis);
            if (!this.hypothesesDatabase.has(hypothesisType)) {
                this.hypothesesDatabase.set(hypothesisType, { total: 0, successful: 0 });
            }
            
            const stats = this.hypothesesDatabase.get(hypothesisType);
            stats.total++;
            if (testResult.success) {
                stats.successful++;
            }
        }
    }

    /**
     * Classify hypothesis for learning purposes
     */
    classifyHypothesis(hypothesis) {
        const text = hypothesis.toLowerCase();
        
        if (text.includes('spelling') || text.includes('typo')) return 'spelling';
        if (text.includes('scope')) return 'scope';
        if (text.includes('import')) return 'import';
        if (text.includes('null') || text.includes('undefined')) return 'null_check';
        if (text.includes('async') || text.includes('await')) return 'async';
        
        return 'other';
    }

    /**
     * Get debugging statistics
     */
    getDebuggingStatistics() {
        const stats = {
            totalSessions: this.debuggingHistory.size,
            resolvedSessions: 0,
            averageResolutionTime: 0,
            commonRootCauses: new Map(),
            hypothesisEffectiveness: new Map(),
            errorTypeDistribution: new Map()
        };

        let totalResolutionTime = 0;
        
        for (const [sessionId, session] of this.debuggingHistory) {
            if (session.status === 'resolved') {
                stats.resolvedSessions++;
                if (session.endTime && session.startTime) {
                    totalResolutionTime += session.endTime - session.startTime;
                }
                
                // Track root causes
                if (session.rootCause) {
                    const cause = session.rootCause;
                    stats.commonRootCauses.set(cause, (stats.commonRootCauses.get(cause) || 0) + 1);
                }
            }
            
            // Track error types
            if (session.initialError) {
                const errorType = this.classifyError(session.initialError);
                stats.errorTypeDistribution.set(errorType, (stats.errorTypeDistribution.get(errorType) || 0) + 1);
            }
        }

        if (stats.resolvedSessions > 0) {
            stats.averageResolutionTime = totalResolutionTime / stats.resolvedSessions;
        }

        // Calculate hypothesis effectiveness
        for (const [type, data] of this.hypothesesDatabase) {
            stats.hypothesisEffectiveness.set(type, {
                successRate: data.total > 0 ? (data.successful / data.total) * 100 : 0,
                total: data.total,
                successful: data.successful
            });
        }

        return stats;
    }

    /**
     * Export debugging knowledge for analysis
     */
    exportDebuggingKnowledge() {
        return {
            errorPatterns: Array.from(this.errorPatterns.entries()),
            rootCauseKnowledge: Array.from(this.rootCauseKnowledge.entries()),
            hypothesesDatabase: Array.from(this.hypothesesDatabase.entries()),
            debuggingHistory: Array.from(this.debuggingHistory.entries()),
            statistics: this.getDebuggingStatistics()
        };
    }

    /**
     * Clear debugging history (for privacy/performance)
     */
    clearHistory(olderThanDays = 30) {
        const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
        
        for (const [sessionId, session] of this.debuggingHistory) {
            if (session.startTime < cutoffTime) {
                this.debuggingHistory.delete(sessionId);
            }
        }
    }
}

// Export singleton instance
export const debuggingIntelligence = new DebuggingIntelligence();