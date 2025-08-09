import { ToolRegistry } from '../tool_registry.js';
import * as FileSystem from '../file_system.js';
import { codeComprehension } from '../code_comprehension.js';
import { syntaxValidator } from '../syntax_validator.js';
import { symbolResolver } from '../symbol_resolver.js';
import { dataFlowAnalyzer } from '../data_flow_analyzer.js';
import { debuggingIntelligence } from '../debugging_intelligence.js';
import { codeQualityAnalyzer } from '../code_quality_analyzer.js';
import { seniorEngineerAI } from '../senior_engineer_ai.js';
import { operationCache } from '../cache_manager.js';
import { workerManager, ensureWorkersInitialized } from '../worker_manager.js';

async function _analyzeCode({ filename }, rootHandle) {
    if (!filename.endsWith('.js') && !filename.endsWith('.ts') && !filename.endsWith('.jsx') && !filename.endsWith('.tsx')) {
        throw new Error('This tool can only analyze JavaScript/TypeScript files. Use read_file for others.');
    }
    
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    const file = await fileHandle.getFile();
    const content = await file.text();
    
    try {
        const analysis = await operationCache.cacheAST(filename, content, async (content, filename) => {
            return await workerManager.parseAST(content, filename, {
                ecmaVersion: 'latest',
                sourceType: 'module',
                locations: true
            });
        });
        
        return { analysis };
    } catch (error) {
        console.warn(`AST analysis failed for ${filename}, falling back to basic analysis:`, error.message);
        
        const basicAnalysis = {
            functions: [],
            classes: [],
            imports: [],
            variables: []
        };
        
        const functionMatches = content.match(/(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g) || [];
        functionMatches.forEach(match => {
            const name = match.match(/(?:function\s+(\w+)|const\s+(\w+))/)?.[1] || match.match(/(?:function\s+(\w+)|const\s+(\w+))/)?.[2];
            if (name) {
                basicAnalysis.functions.push({ name, type: 'function' });
            }
        });
        
        const classMatches = content.match(/class\s+(\w+)/g) || [];
        classMatches.forEach(match => {
            const name = match.replace('class ', '');
            basicAnalysis.classes.push({ name, type: 'class' });
        });
        
        const importMatches = content.match(/import\s+.*from\s+['"]([^'"]+)['"]/g) || [];
        importMatches.forEach(match => {
            const source = match.match(/from\s+['"]([^'"]+)['"]/)?.[1];
            if (source) {
                basicAnalysis.imports.push({ source });
            }
        });
        
        return { analysis: basicAnalysis };
    }
}

async function _validateSyntax({ file_path }, rootHandle) {
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, file_path);
    const file = await fileHandle.getFile();
    const content = await file.text();
    
    const validation = await syntaxValidator.validateSyntax(file_path, content);
    
    return {
        file: file_path,
        valid: validation.valid,
        language: validation.language,
        errors: validation.errors || [],
        warnings: validation.warnings || [],
        suggestions: validation.suggestions || []
    };
}

async function _analyzeSymbol({ symbol_name, file_path }, rootHandle) {
    if (!symbol_name) throw new Error("The 'symbol_name' parameter is required.");
    if (!file_path) throw new Error("The 'file_path' parameter is required.");

    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, file_path);
    const file = await fileHandle.getFile();
    const content = await file.text();
    
    const symbolTable = await symbolResolver.buildSymbolTable(content, file_path);
    const analysis = {
        symbol: symbol_name,
        definitions: symbolTable.symbols.get(symbol_name) || [],
        usages: symbolTable.symbols.get(symbol_name) || [],
        type: 'unknown',
        scope: 'unknown',
        relatedFiles: new Set(),
        dataFlow: [],
        documentation: null
    };

    return { analysis };
}

async function _buildSymbolTable({ file_path }, rootHandle) {
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, file_path);
    const file = await fileHandle.getFile();
    const content = await file.text();
    
    try {
        const symbolTable = await operationCache.cacheSymbolResolution(file_path, content, async (content, filePath) => {
            return await workerManager.resolveSymbols(content, filePath, {
                includeTypes: true,
                includeDependencies: true,
                includeComplexity: true
            });
        });
        
        return {
            message: `Symbol table built for ${file_path}`,
            symbolTable: {
                symbols: symbolTable.symbols?.size || symbolTable.symbolCount || 0,
                functions: symbolTable.functions?.length || 0,
                classes: symbolTable.classes?.length || 0,
                imports: symbolTable.imports?.length || 0,
                exports: symbolTable.exports?.length || 0,
                variables: symbolTable.variables?.length || 0,
                dependencies: symbolTable.dependencies?.length || 0
            },
            performance: {
                cached: symbolTable._cached || false,
                processingTime: symbolTable._processingTime || 0
            }
        };
    } catch (error) {
        console.warn(`Worker-based symbol resolution failed for ${file_path}, falling back to basic analysis:`, error.message);
        
        const symbolTable = await symbolResolver.buildSymbolTable(content, file_path);
        
        return {
            message: `Symbol table built for ${file_path} (fallback mode)`,
            symbolTable: {
                symbols: symbolTable.symbols?.size || 0,
                functions: symbolTable.functions?.length || 0,
                classes: symbolTable.classes?.length || 0,
                imports: symbolTable.imports?.length || 0,
                exports: symbolTable.exports?.length || 0
            },
            fallback: true
        };
    }
}

async function _traceDataFlow({ variable_name, file_path, line }, rootHandle) {
    if (!variable_name) throw new Error("The 'variable_name' parameter is required.");
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    
    const startLine = line || 1;
    
    try {
        const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, file_path);
        const file = await fileHandle.getFile();
        const content = await file.text();
        
        const flowInfo = await operationCache.cacheSymbolResolution(`${file_path}:${variable_name}:flow`, content, async (content, cacheKey) => {
            return await workerManager.resolveSymbols(content, file_path, {
                targetVariable: variable_name,
                startLine: startLine,
                includeDataFlow: true,
                includeCrossFileAnalysis: true
            });
        });
        
        return {
            message: `Data flow traced for variable '${variable_name}'`,
            flow: {
                definitions: flowInfo.definitions?.length || 0,
                usages: flowInfo.usages?.length || 0,
                mutations: flowInfo.mutations?.length || 0,
                crossFileFlows: flowInfo.crossFileFlows?.length || 0,
                dataTypes: Array.from(flowInfo.dataTypes || []),
                complexity: flowInfo.complexity || 'N/A',
                scope: flowInfo.scope || 'unknown'
            },
            details: flowInfo,
            performance: {
                cached: flowInfo._cached || false,
                processingTime: flowInfo._processingTime || 0
            }
        };
    } catch (error) {
        console.warn(`Worker-based data flow analysis failed for ${variable_name}, falling back:`, error.message);
        
        const flowInfo = await dataFlowAnalyzer.traceVariableFlow(variable_name, file_path, startLine);
        
        return {
            message: `Data flow traced for variable '${variable_name}' (fallback mode)`,
            flow: {
                definitions: flowInfo.definitions?.length || 0,
                usages: flowInfo.usages?.length || 0,
                mutations: flowInfo.mutations?.length || 0,
                crossFileFlows: flowInfo.crossFileFlows?.length || 0,
                dataTypes: Array.from(flowInfo.dataTypes || []),
                complexity: dataFlowAnalyzer.calculateFlowComplexity ?
                           dataFlowAnalyzer.calculateFlowComplexity(flowInfo) : 'N/A'
            },
            details: flowInfo,
            fallback: true
        };
    }
}

async function _debugSystematically({ error_message, file_path, line, stack_trace }, rootHandle) {
    if (!error_message) throw new Error("The 'error_message' parameter is required.");
    
    const error = new Error(error_message);
    if (stack_trace) error.stack = stack_trace;
    
    const codeContext = {
        filePath: file_path,
        line: line || 1
    };
    
    const debuggingResult = await debuggingIntelligence.debugSystematically(error, codeContext);
    
    return {
        message: `Systematic debugging completed for: ${error_message}`,
        session: {
            id: debuggingResult.session.id,
            status: debuggingResult.session.status,
            rootCause: debuggingResult.rootCause,
            hypothesesTested: debuggingResult.hypotheses.length,
            solution: debuggingResult.solution
        },
        recommendation: debuggingResult.recommendation
    };
}

async function _analyzeCodeQuality({ file_path }, rootHandle) {
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, file_path);
    const file = await fileHandle.getFile();
    const content = await file.text();
    
    try {
        const qualityMetrics = await operationCache.cacheValidation(`${file_path}:quality`, content, async (content, filePath) => {
            await ensureWorkersInitialized();
            
            return await workerManager.processFile('analyze_quality', {
                filename: file_path,
                content: content,
                includeComplexity: true,
                includeSecurity: true,
                includePerformance: true,
                includeMaintainability: true
            });
        });
        
        return {
            message: `Code quality analysis completed for ${file_path}`,
            quality: {
                overallScore: qualityMetrics.overallScore || 0,
                category: qualityMetrics.category || 'unknown',
                complexity: {
                    average: qualityMetrics.complexity?.averageComplexity || 0,
                    max: qualityMetrics.complexity?.maxComplexity || 0,
                    functions: qualityMetrics.complexity?.functions?.length || 0,
                    distribution: qualityMetrics.complexity?.distribution || {}
                },
                maintainability: {
                    index: qualityMetrics.maintainability?.index || 0,
                    category: qualityMetrics.maintainability?.category || 'unknown',
                    factors: qualityMetrics.maintainability?.factors || []
                },
                issues: {
                    codeSmells: qualityMetrics.codeSmells?.length || 0,
                    security: qualityMetrics.security?.length || 0,
                    performance: qualityMetrics.performance?.length || 0,
                    total: (qualityMetrics.codeSmells?.length || 0) +
                           (qualityMetrics.security?.length || 0) +
                           (qualityMetrics.performance?.length || 0)
                },
                metrics: {
                    linesOfCode: qualityMetrics.linesOfCode || 0,
                    cyclomaticComplexity: qualityMetrics.cyclomaticComplexity || 0,
                    cognitiveComplexity: qualityMetrics.cognitiveComplexity || 0,
                    technicalDebt: qualityMetrics.technicalDebt || 0
                }
            },
            recommendations: qualityMetrics.recommendations || [],
            performance: {
                cached: qualityMetrics._cached || false,
                processingTime: qualityMetrics._processingTime || 0
            }
        };
    } catch (error) {
        console.warn(`Worker-based quality analysis failed for ${file_path}, falling back:`, error.message);
        
        const qualityMetrics = await codeQualityAnalyzer.analyzeCodeQuality(file_path, content);
        
        return {
            message: `Code quality analysis completed for ${file_path} (fallback mode)`,
            quality: {
                overallScore: qualityMetrics.overallScore || 0,
                category: codeQualityAnalyzer.categorizeQualityScore ?
                         codeQualityAnalyzer.categorizeQualityScore(qualityMetrics.overallScore) : 'unknown',
                complexity: {
                    average: qualityMetrics.complexity?.averageComplexity || 0,
                    max: qualityMetrics.complexity?.maxComplexity || 0,
                    functions: qualityMetrics.complexity?.functions?.length || 0
                },
                maintainability: {
                    index: qualityMetrics.maintainability?.index || 0,
                    category: qualityMetrics.maintainability?.category || 'unknown'
                },
                issues: {
                    codeSmells: qualityMetrics.codeSmells?.length || 0,
                    security: qualityMetrics.security?.length || 0,
                    performance: qualityMetrics.performance?.length || 0
                }
            },
            recommendations: codeQualityAnalyzer.getTopRecommendations ?
                           codeQualityAnalyzer.getTopRecommendations(qualityMetrics) : [],
            fallback: true
        };
    }
}

async function _solveEngineeringProblem({ problem_description, file_path, priority, constraints }, rootHandle) {
    if (!problem_description) throw new Error("The 'problem_description' parameter is required.");
    
    const problem = {
        description: problem_description,
        priority: priority || 'medium',
        constraints: constraints || []
    };
    
    const codeContext = {
        filePath: file_path
    };
    
    if (file_path) {
        try {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, file_path);
            const file = await fileHandle.getFile();
            codeContext.content = await file.text();
        } catch (error) {
            console.warn(`Could not read file ${file_path}:`, error.message);
        }
    }
    
    const solutionSession = await seniorEngineerAI.solveProblemSystematically(problem, codeContext);
    
    return {
        message: `Engineering problem analysis completed: ${problem_description}`,
        solution: {
            sessionId: solutionSession.id,
            status: solutionSession.status,
            problemType: solutionSession.analysis?.problemType,
            complexity: solutionSession.analysis?.complexity?.category,
            selectedApproach: solutionSession.selectedSolution?.approach,
            feasibility: solutionSession.selectedSolution?.evaluation?.feasibility,
            riskLevel: solutionSession.selectedSolution?.evaluation?.riskLevel,
            estimatedTime: solutionSession.implementation?.detailedSteps?.length || 0
        },
        recommendations: solutionSession.selectedSolution?.evaluation?.reasoning || [],
        implementation: solutionSession.implementation ? {
            phases: solutionSession.implementation.detailedSteps.map(step => step.phase).filter((phase, index, arr) => arr.indexOf(phase) === index),
            totalSteps: solutionSession.implementation.detailedSteps.length,
            testingRequired: solutionSession.implementation.testingPlan.length > 0
        } : null
    };
}

async function _getEngineeringInsights({ file_path }, rootHandle) {
    const insights = {
        symbolResolution: symbolResolver.getStatistics(),
        dataFlowAnalysis: dataFlowAnalyzer.getStatistics(),
        debuggingIntelligence: debuggingIntelligence.getDebuggingStatistics(),
        engineeringDecisions: seniorEngineerAI.getEngineeringStatistics()
    };
    
    if (file_path) {
        const qualitySummary = codeQualityAnalyzer.getQualitySummary(file_path);
        if (qualitySummary) {
            insights.fileQuality = qualitySummary;
        }
    } else {
        insights.projectQuality = codeQualityAnalyzer.getProjectQualityStatistics();
    }
    
    return {
        message: file_path ? `Engineering insights for ${file_path}` : 'Project-wide engineering insights',
        insights
    };
}

async function _optimizeCodeArchitecture({ file_path, optimization_goals }, rootHandle) {
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    
    const goals = optimization_goals || ['maintainability', 'performance', 'readability'];
    
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, file_path);
    const file = await fileHandle.getFile();
    const content = await file.text();
    
    const qualityMetrics = await codeQualityAnalyzer.analyzeCodeQuality(file_path, content);
    const symbolTable = await symbolResolver.buildSymbolTable(content, file_path);
    
    const optimizations = [];
    
    const complexFunctions = qualityMetrics.complexity.functions.filter(f => f.category === 'high' || f.category === 'critical');
    if (complexFunctions.length > 0) {
        optimizations.push({
            type: 'complexity_reduction',
            priority: 'high',
            description: `${complexFunctions.length} functions have high complexity`,
            recommendations: complexFunctions.flatMap(f => f.recommendations || [])
        });
    }
    
    const criticalSmells = qualityMetrics.codeSmells.filter(smell => smell.severity === 'critical' || smell.severity === 'high');
    if (criticalSmells.length > 0) {
        optimizations.push({
            type: 'code_smell_removal',
            priority: 'medium',
            description: `${criticalSmells.length} critical code smells detected`,
            recommendations: criticalSmells.map(smell => smell.recommendation)
        });
    }
    
    if (qualityMetrics.architecture.detected.length === 0 && symbolTable.classes.length > 0) {
        optimizations.push({
            type: 'architectural_patterns',
            priority: 'medium',
            description: 'No design patterns detected - consider implementing appropriate patterns',
            recommendations: qualityMetrics.architecture.recommendations
        });
    }
    
    return {
        message: `Architecture optimization analysis completed for ${file_path}`,
        currentState: {
            qualityScore: qualityMetrics.overallScore,
            complexity: qualityMetrics.complexity.averageComplexity,
            maintainability: qualityMetrics.maintainability.index,
            issues: qualityMetrics.codeSmells.length + qualityMetrics.security.length + qualityMetrics.performance.length
        },
        optimizations,
        estimatedImpact: {
            qualityImprovement: optimizations.length * 10,
            maintenanceReduction: optimizations.filter(o => o.type === 'complexity_reduction').length * 20,
            riskReduction: optimizations.filter(o => o.priority === 'high').length * 15
        }
    };
}

async function _explainCodeSection({ file_path, start_line, end_line }, rootHandle) {
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    if (typeof start_line !== 'number') throw new Error("The 'start_line' parameter is required and must be a number.");
    if (typeof end_line !== 'number') throw new Error("The 'end_line' parameter is required and must be a number.");
    
    const explanation = await codeComprehension.explainCodeSection(file_path, start_line, end_line, rootHandle);
    return { explanation };
}

export function registerCodeAnalysisTools() {
    ToolRegistry.register('analyze_code', {
        handler: _analyzeCode,
        requiresProject: true,
        createsCheckpoint: false,
        description: "Analyzes a JavaScript file's structure. CRITICAL: Do NOT include the root directory name in the path.",
        parameters: { filename: { type: 'string', required: true } }
    });

    ToolRegistry.register('validate_syntax', {
        handler: _validateSyntax,
        requiresProject: true,
        createsCheckpoint: false,
        description: 'Validates the syntax of a file and provides detailed errors, warnings, and suggestions.',
        parameters: { file_path: { type: 'string', required: true } }
    });

    ToolRegistry.register('analyze_symbol', {
        handler: _analyzeSymbol,
        requiresProject: true,
        createsCheckpoint: false,
        description: 'Analyzes a symbol (variable, function, class) across the entire codebase to understand its usage, definition, and relationships.',
        parameters: {
            symbol_name: { type: 'string', required: true, description: 'The name of the symbol to analyze' },
            file_path: { type: 'string', required: true, description: 'The file path where the symbol is used or defined' }
        }
    });

    ToolRegistry.register('build_symbol_table', {
        handler: _buildSymbolTable,
        requiresProject: true,
        createsCheckpoint: false,
        description: '🧠 SENIOR ENGINEER: Build comprehensive symbol table for advanced code analysis. Creates detailed mapping of all symbols, functions, classes, imports, and exports in a file.',
        parameters: { file_path: { type: 'string', required: true, description: 'Path to the file to analyze' } }
    });

    ToolRegistry.register('trace_data_flow', {
        handler: _traceDataFlow,
        requiresProject: true,
        createsCheckpoint: false,
        description: '🧠 SENIOR ENGINEER: Advanced data flow analysis that traces how variables flow through the codebase. Identifies definitions, usages, mutations, and cross-file dependencies.',
        parameters: {
            variable_name: { type: 'string', required: true, description: 'Name of the variable to trace' },
            file_path: { type: 'string', required: true, description: 'Starting file path' },
            line: { type: 'number', description: 'Starting line number (optional)' }
        }
    });

    ToolRegistry.register('debug_systematically', {
        handler: _debugSystematically,
        requiresProject: false,
        createsCheckpoint: false,
        description: '🧠 SENIOR ENGINEER: Systematic debugging using hypothesis-driven approach. Analyzes errors, generates hypotheses, tests them systematically, and provides root cause analysis.',
        parameters: {
            error_message: { type: 'string', required: true, description: 'The error message to debug' },
            file_path: { type: 'string', description: 'File where error occurred (optional)' },
            line: { type: 'number', description: 'Line number where error occurred (optional)' },
            stack_trace: { type: 'string', description: 'Full stack trace (optional)' }
        }
    });

    ToolRegistry.register('analyze_code_quality', {
        handler: _analyzeCodeQuality,
        requiresProject: true,
        createsCheckpoint: false,
        description: '🧠 SENIOR ENGINEER: Comprehensive code quality analysis including complexity, maintainability, code smells, security vulnerabilities, and performance issues.',
        parameters: { file_path: { type: 'string', required: true, description: 'Path to the file to analyze' } }
    });

    ToolRegistry.register('solve_engineering_problem', {
        handler: _solveEngineeringProblem,
        requiresProject: false,
        createsCheckpoint: false,
        description: '🧠 SENIOR ENGINEER: Holistic engineering problem solving. Analyzes problems comprehensively, generates multiple solutions, evaluates trade-offs, and provides implementation plans.',
        parameters: {
            problem_description: { type: 'string', required: true, description: 'Detailed description of the engineering problem' },
            file_path: { type: 'string', description: 'Related file path (optional)' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Problem priority' },
            constraints: { type: 'array', items: { type: 'string' }, description: 'Any constraints or limitations (optional)' }
        }
    });

    ToolRegistry.register('get_engineering_insights', {
        handler: _getEngineeringInsights,
        requiresProject: false,
        createsCheckpoint: false,
        description: '🧠 SENIOR ENGINEER: Get comprehensive engineering insights and statistics about code quality, debugging patterns, and decision-making effectiveness.',
        parameters: { file_path: { type: 'string', description: 'Specific file to analyze (optional - if omitted, provides project-wide insights)' } }
    });

    ToolRegistry.register('optimize_code_architecture', {
        handler: _optimizeCodeArchitecture,
        requiresProject: true,
        createsCheckpoint: false,
        description: '🧠 SENIOR ENGINEER: Analyze and optimize code architecture. Identifies architectural issues, suggests design patterns, and provides optimization recommendations.',
        parameters: {
            file_path: { type: 'string', required: true, description: 'Path to the file to optimize' },
            optimization_goals: { type: 'array', items: { type: 'string' }, description: 'Optimization goals: maintainability, performance, readability, security (optional)' }
        }
    });

    ToolRegistry.register('explain_code_section', {
        handler: _explainCodeSection,
        requiresProject: true,
        createsCheckpoint: false,
        description: 'Provides detailed explanation of a complex code section including complexity analysis, symbols, and control flow.',
        parameters: {
            file_path: { type: 'string', required: true },
            start_line: { type: 'number', required: true },
            end_line: { type: 'number', required: true }
        }
    });
}