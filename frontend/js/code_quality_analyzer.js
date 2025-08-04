/**
 * Code Quality & Architecture Intelligence System
 * Comprehensive code analysis for senior engineer-level quality assessment
 */

import { symbolResolver } from './symbol_resolver.js';
import { dataFlowAnalyzer } from './data_flow_analyzer.js';

// Dynamic imports for browser compatibility - will be loaded when needed
let acorn, walk;

async function loadDependencies() {
    if (!acorn || !walk) {
        acorn = await import('https://cdn.skypack.dev/acorn@8.11.3');
        walk = await import('https://cdn.skypack.dev/acorn-walk@8.3.2');
    }
}

export class CodeQualityAnalyzer {
    constructor() {
        this.qualityMetrics = new Map(); // filePath -> QualityMetrics
        this.architecturePatterns = new Map(); // pattern -> PatternInfo
        this.codeSmells = new Map(); // filePath -> [CodeSmell]
        this.complexityAnalysis = new Map(); // filePath -> ComplexityInfo
        this.maintainabilityScores = new Map(); // filePath -> MaintainabilityScore
        this.securityIssues = new Map(); // filePath -> [SecurityIssue]
        this.performanceIssues = new Map(); // filePath -> [PerformanceIssue]
        
        // Initialize quality standards
        this.initializeQualityStandards();
    }

    /**
     * Initialize quality standards and thresholds
     */
    initializeQualityStandards() {
        this.qualityThresholds = {
            cyclomaticComplexity: {
                low: 5,
                medium: 10,
                high: 15,
                critical: 20
            },
            functionLength: {
                ideal: 20,
                acceptable: 50,
                problematic: 100,
                critical: 200
            },
            classSize: {
                ideal: 200,
                acceptable: 500,
                problematic: 1000,
                critical: 2000
            },
            parameterCount: {
                ideal: 3,
                acceptable: 5,
                problematic: 7,
                critical: 10
            },
            nestingDepth: {
                ideal: 3,
                acceptable: 4,
                problematic: 5,
                critical: 6
            }
        };

        this.codeSmellPatterns = [
            {
                name: 'long_method',
                description: 'Method is too long and should be broken down',
                severity: 'medium',
                detector: this.detectLongMethod.bind(this)
            },
            {
                name: 'large_class',
                description: 'Class is too large and has too many responsibilities',
                severity: 'high',
                detector: this.detectLargeClass.bind(this)
            },
            {
                name: 'long_parameter_list',
                description: 'Function has too many parameters',
                severity: 'medium',
                detector: this.detectLongParameterList.bind(this)
            },
            {
                name: 'duplicated_code',
                description: 'Code duplication detected',
                severity: 'high',
                detector: this.detectDuplicatedCode.bind(this)
            },
            {
                name: 'god_object',
                description: 'Object knows too much or does too much',
                severity: 'critical',
                detector: this.detectGodObject.bind(this)
            },
            {
                name: 'feature_envy',
                description: 'Method uses more features of another class than its own',
                severity: 'medium',
                detector: this.detectFeatureEnvy.bind(this)
            },
            {
                name: 'data_clumps',
                description: 'Same group of data items appear together frequently',
                severity: 'low',
                detector: this.detectDataClumps.bind(this)
            },
            {
                name: 'magic_numbers',
                description: 'Numeric literals without explanation',
                severity: 'low',
                detector: this.detectMagicNumbers.bind(this)
            }
        ];
    }

    /**
     * Analyze comprehensive code quality for a file
     */
    async analyzeCodeQuality(filePath, fileContent) {
        console.log(`[CodeQualityAnalyzer] Analyzing code quality for ${filePath}`);
        
        const symbolTable = await symbolResolver.buildSymbolTable(fileContent, filePath);
        if (!symbolTable) {
            console.warn(`[CodeQualityAnalyzer] Could not build symbol table for ${filePath}`);
            return null;
        }

        const qualityMetrics = {
            filePath,
            timestamp: Date.now(),
            complexity: await this.analyzeCyclomaticComplexity(symbolTable),
            maintainability: await this.calculateMaintainabilityIndex(symbolTable),
            codeSmells: await this.detectCodeSmells(symbolTable),
            architecture: await this.analyzeArchitecturalPatterns(symbolTable),
            security: await this.scanSecurityVulnerabilities(symbolTable),
            performance: await this.identifyPerformanceIssues(symbolTable),
            testability: await this.assessTestability(symbolTable),
            documentation: await this.analyzeDocumentation(symbolTable),
            overallScore: 0
        };

        // Calculate overall quality score
        qualityMetrics.overallScore = this.calculateOverallQualityScore(qualityMetrics);

        // Store results
        this.qualityMetrics.set(filePath, qualityMetrics);
        this.complexityAnalysis.set(filePath, qualityMetrics.complexity);
        this.maintainabilityScores.set(filePath, qualityMetrics.maintainability);
        this.codeSmells.set(filePath, qualityMetrics.codeSmells);
        this.securityIssues.set(filePath, qualityMetrics.security);
        this.performanceIssues.set(filePath, qualityMetrics.performance);

        return qualityMetrics;
    }

    /**
     * Analyze cyclomatic complexity
     */
    async analyzeCyclomaticComplexity(symbolTable) {
        const complexityInfo = {
            fileComplexity: 0,
            functions: [],
            classes: [],
            averageComplexity: 0,
            maxComplexity: 0,
            complexityDistribution: { low: 0, medium: 0, high: 0, critical: 0 }
        };

        if (!symbolTable.ast) return complexityInfo;

        // Analyze each function
        for (const func of symbolTable.functions) {
            const complexity = await this.calculateFunctionComplexity(func.node);
            const funcComplexity = {
                name: func.name,
                complexity,
                line: func.line,
                category: this.categorizeComplexity(complexity),
                recommendations: this.getComplexityRecommendations(complexity)
            };
            
            complexityInfo.functions.push(funcComplexity);
            complexityInfo.fileComplexity += complexity;
            complexityInfo.maxComplexity = Math.max(complexityInfo.maxComplexity, complexity);
            
            // Update distribution
            complexityInfo.complexityDistribution[funcComplexity.category]++;
        }

        // Analyze each class method
        for (const cls of symbolTable.classes) {
            const classComplexity = {
                name: cls.name,
                methods: [],
                totalComplexity: 0,
                averageComplexity: 0
            };

            if (cls.methods) {
                for (const method of cls.methods) {
                    const complexity = await this.calculateFunctionComplexity(method.node);
                    const methodComplexity = {
                        name: method.name,
                        complexity,
                        line: method.line,
                        category: this.categorizeComplexity(complexity)
                    };
                    
                    classComplexity.methods.push(methodComplexity);
                    classComplexity.totalComplexity += complexity;
                }
                
                if (classComplexity.methods.length > 0) {
                    classComplexity.averageComplexity = classComplexity.totalComplexity / classComplexity.methods.length;
                }
            }
            
            complexityInfo.classes.push(classComplexity);
        }

        // Calculate averages
        const totalFunctions = complexityInfo.functions.length;
        if (totalFunctions > 0) {
            complexityInfo.averageComplexity = complexityInfo.fileComplexity / totalFunctions;
        }

        return complexityInfo;
    }

    /**
     * Calculate cyclomatic complexity for a function
     */
    async calculateFunctionComplexity(functionNode) {
        await loadDependencies();
        let complexity = 1; // Base complexity

        walk.simple(functionNode, {
            IfStatement() { complexity++; },
            ConditionalExpression() { complexity++; },
            SwitchCase(node) { 
                if (node.test) complexity++; // Don't count default case
            },
            WhileStatement() { complexity++; },
            DoWhileStatement() { complexity++; },
            ForStatement() { complexity++; },
            ForInStatement() { complexity++; },
            ForOfStatement() { complexity++; },
            CatchClause() { complexity++; },
            LogicalExpression(node) {
                if (node.operator === '&&' || node.operator === '||') {
                    complexity++;
                }
            }
        });

        return complexity;
    }

    /**
     * Categorize complexity level
     */
    categorizeComplexity(complexity) {
        const thresholds = this.qualityThresholds.cyclomaticComplexity;
        
        if (complexity <= thresholds.low) return 'low';
        if (complexity <= thresholds.medium) return 'medium';
        if (complexity <= thresholds.high) return 'high';
        return 'critical';
    }

    /**
     * Get recommendations for complexity reduction
     */
    getComplexityRecommendations(complexity) {
        const recommendations = [];
        
        if (complexity > this.qualityThresholds.cyclomaticComplexity.medium) {
            recommendations.push('Consider breaking this function into smaller functions');
            recommendations.push('Extract complex conditional logic into separate methods');
        }
        
        if (complexity > this.qualityThresholds.cyclomaticComplexity.high) {
            recommendations.push('This function is too complex and should be refactored immediately');
            recommendations.push('Consider using strategy pattern or state pattern');
        }
        
        if (complexity > this.qualityThresholds.cyclomaticComplexity.critical) {
            recommendations.push('CRITICAL: This function is extremely complex and poses maintenance risks');
            recommendations.push('Urgent refactoring required');
        }

        return recommendations;
    }

    /**
     * Calculate maintainability index
     */
    async calculateMaintainabilityIndex(symbolTable) {
        const maintainability = {
            index: 0,
            category: 'poor',
            factors: {
                complexity: 0,
                linesOfCode: 0,
                documentation: 0,
                testCoverage: 0,
                codeSmells: 0
            },
            recommendations: []
        };

        if (!symbolTable.ast) return maintainability;

        // Calculate lines of code
        const loc = this.calculateLinesOfCode(symbolTable);
        maintainability.factors.linesOfCode = loc;

        // Get complexity metrics
        const complexity = this.complexityAnalysis.get(symbolTable.filePath) || 
                          await this.analyzeCyclomaticComplexity(symbolTable);
        maintainability.factors.complexity = complexity.averageComplexity;

        // Analyze documentation coverage
        const docCoverage = this.calculateDocumentationCoverage(symbolTable);
        maintainability.factors.documentation = docCoverage;

        // Count code smells
        const smells = await this.detectCodeSmells(symbolTable);
        maintainability.factors.codeSmells = smells.length;

        // Calculate maintainability index using Microsoft's formula (adapted)
        const MI = Math.max(0, 
            171 - 
            5.2 * Math.log(maintainability.factors.complexity || 1) - 
            0.23 * (maintainability.factors.complexity || 1) - 
            16.2 * Math.log(loc || 1) +
            50 * Math.sin(Math.sqrt(2.4 * docCoverage))
        );

        maintainability.index = Math.round(MI);

        // Categorize maintainability
        if (maintainability.index >= 85) {
            maintainability.category = 'excellent';
        } else if (maintainability.index >= 70) {
            maintainability.category = 'good';
        } else if (maintainability.index >= 50) {
            maintainability.category = 'moderate';
        } else if (maintainability.index >= 25) {
            maintainability.category = 'poor';
        } else {
            maintainability.category = 'critical';
        }

        // Generate recommendations
        maintainability.recommendations = this.generateMaintainabilityRecommendations(maintainability);

        return maintainability;
    }

    /**
     * Calculate lines of code
     */
    calculateLinesOfCode(symbolTable) {
        if (!symbolTable.ast || !symbolTable.ast.loc) return 0;
        return symbolTable.ast.loc.end.line - symbolTable.ast.loc.start.line + 1;
    }

    /**
     * Calculate documentation coverage
     */
    calculateDocumentationCoverage(symbolTable) {
        let totalFunctions = symbolTable.functions.length;
        let documentedFunctions = 0;

        // This is a simplified check - in practice would analyze JSDoc comments
        for (const func of symbolTable.functions) {
            // Check if function has preceding comment
            if (this.hasPrecedingComment(func.node, symbolTable.ast)) {
                documentedFunctions++;
            }
        }

        return totalFunctions > 0 ? (documentedFunctions / totalFunctions) * 100 : 0;
    }

    /**
     * Check if function has preceding comment
     */
    hasPrecedingComment(functionNode, ast) {
        // Simplified check - would need more sophisticated comment analysis
        return false; // Placeholder
    }

    /**
     * Generate maintainability recommendations
     */
    generateMaintainabilityRecommendations(maintainability) {
        const recommendations = [];

        if (maintainability.factors.complexity > 10) {
            recommendations.push('Reduce cyclomatic complexity by breaking down complex functions');
        }

        if (maintainability.factors.documentation < 50) {
            recommendations.push('Improve documentation coverage with JSDoc comments');
        }

        if (maintainability.factors.codeSmells > 5) {
            recommendations.push('Address code smells to improve code quality');
        }

        if (maintainability.category === 'critical' || maintainability.category === 'poor') {
            recommendations.push('Consider major refactoring to improve maintainability');
        }

        return recommendations;
    }

    /**
     * Detect code smells
     */
    async detectCodeSmells(symbolTable) {
        const codeSmells = [];

        for (const smellPattern of this.codeSmellPatterns) {
            try {
                const detectedSmells = await smellPattern.detector(symbolTable);
                codeSmells.push(...detectedSmells.map(smell => ({
                    ...smell,
                    type: smellPattern.name,
                    description: smellPattern.description,
                    severity: smellPattern.severity
                })));
            } catch (error) {
                console.warn(`[CodeQualityAnalyzer] Error detecting ${smellPattern.name}:`, error);
            }
        }

        return codeSmells;
    }

    /**
     * Detect long methods
     */
    async detectLongMethod(symbolTable) {
        const longMethods = [];
        const threshold = this.qualityThresholds.functionLength;

        for (const func of symbolTable.functions) {
            const length = this.calculateFunctionLength(func.node);
            
            if (length > threshold.acceptable) {
                longMethods.push({
                    name: func.name,
                    line: func.line,
                    length,
                    severity: length > threshold.critical ? 'critical' : 
                             length > threshold.problematic ? 'high' : 'medium',
                    recommendation: `Function is ${length} lines long. Consider breaking it down into smaller functions.`
                });
            }
        }

        return longMethods;
    }

    /**
     * Calculate function length in lines
     */
    calculateFunctionLength(functionNode) {
        if (!functionNode.loc) return 0;
        return functionNode.loc.end.line - functionNode.loc.start.line + 1;
    }

    /**
     * Detect large classes
     */
    async detectLargeClass(symbolTable) {
        const largeClasses = [];
        const threshold = this.qualityThresholds.classSize;

        for (const cls of symbolTable.classes) {
            const size = this.calculateClassSize(cls.node);
            
            if (size > threshold.acceptable) {
                largeClasses.push({
                    name: cls.name,
                    line: cls.line,
                    size,
                    methodCount: cls.methods ? cls.methods.length : 0,
                    severity: size > threshold.critical ? 'critical' : 
                             size > threshold.problematic ? 'high' : 'medium',
                    recommendation: `Class is ${size} lines long with ${cls.methods?.length || 0} methods. Consider splitting responsibilities.`
                });
            }
        }

        return largeClasses;
    }

    /**
     * Calculate class size in lines
     */
    calculateClassSize(classNode) {
        if (!classNode.loc) return 0;
        return classNode.loc.end.line - classNode.loc.start.line + 1;
    }

    /**
     * Detect long parameter lists
     */
    async detectLongParameterList(symbolTable) {
        const longParameterLists = [];
        const threshold = this.qualityThresholds.parameterCount;

        for (const func of symbolTable.functions) {
            const paramCount = func.params ? func.params.length : 0;
            
            if (paramCount > threshold.acceptable) {
                longParameterLists.push({
                    name: func.name,
                    line: func.line,
                    parameterCount: paramCount,
                    severity: paramCount > threshold.critical ? 'critical' : 
                             paramCount > threshold.problematic ? 'high' : 'medium',
                    recommendation: `Function has ${paramCount} parameters. Consider using parameter objects or builder pattern.`
                });
            }
        }

        return longParameterLists;
    }

    /**
     * Detect duplicated code (simplified)
     */
    async detectDuplicatedCode(symbolTable) {
        const duplicatedCode = [];
        
        // This would implement sophisticated duplicate detection
        // For now, return placeholder
        return duplicatedCode;
    }

    /**
     * Detect god objects
     */
    async detectGodObject(symbolTable) {
        const godObjects = [];

        for (const cls of symbolTable.classes) {
            const methodCount = cls.methods ? cls.methods.length : 0;
            const size = this.calculateClassSize(cls.node);
            
            // God object criteria: too many methods AND too large
            if (methodCount > 20 && size > 1000) {
                godObjects.push({
                    name: cls.name,
                    line: cls.line,
                    methodCount,
                    size,
                    severity: 'critical',
                    recommendation: `Class has ${methodCount} methods and ${size} lines. This is a god object that should be broken down into multiple classes.`
                });
            }
        }

        return godObjects;
    }

    /**
     * Detect feature envy
     */
    async detectFeatureEnvy(symbolTable) {
        const featureEnvy = [];
        
        // This would implement sophisticated feature envy detection
        // For now, return placeholder
        return featureEnvy;
    }

    /**
     * Detect data clumps
     */
    async detectDataClumps(symbolTable) {
        const dataClumps = [];
        
        // This would implement data clump detection
        // For now, return placeholder
        return dataClumps;
    }

    /**
     * Detect magic numbers
     */
    async detectMagicNumbers(symbolTable) {
        const magicNumbers = [];

        if (!symbolTable.ast) return magicNumbers;

        walk.simple(symbolTable.ast, {
            Literal(node) {
                if (typeof node.value === 'number' && 
                    node.value !== 0 && 
                    node.value !== 1 && 
                    node.value !== -1 &&
                    !this.isInConstantDeclaration(node)) {
                    
                    magicNumbers.push({
                        value: node.value,
                        line: node.loc ? node.loc.start.line : 0,
                        severity: 'low',
                        recommendation: `Replace magic number ${node.value} with a named constant.`
                    });
                }
            }
        });

        return magicNumbers;
    }

    /**
     * Check if literal is in constant declaration
     */
    isInConstantDeclaration(node) {
        // Simplified check - would need more sophisticated analysis
        return false;
    }

    /**
     * Analyze architectural patterns
     */
    async analyzeArchitecturalPatterns(symbolTable) {
        const patterns = {
            detected: [],
            antiPatterns: [],
            recommendations: []
        };

        // Detect common design patterns
        patterns.detected = await this.detectDesignPatterns(symbolTable);
        
        // Detect anti-patterns
        patterns.antiPatterns = await this.detectAntiPatterns(symbolTable);
        
        // Generate architectural recommendations
        patterns.recommendations = this.generateArchitecturalRecommendations(patterns);

        return patterns;
    }

    /**
     * Detect design patterns
     */
    async detectDesignPatterns(symbolTable) {
        const patterns = [];

        // Singleton pattern detection
        const singletons = this.detectSingletonPattern(symbolTable);
        patterns.push(...singletons);

        // Factory pattern detection
        const factories = this.detectFactoryPattern(symbolTable);
        patterns.push(...factories);

        // Observer pattern detection
        const observers = this.detectObserverPattern(symbolTable);
        patterns.push(...observers);

        return patterns;
    }

    /**
     * Detect singleton pattern
     */
    detectSingletonPattern(symbolTable) {
        const singletons = [];
        
        for (const cls of symbolTable.classes) {
            // Look for singleton characteristics
            if (this.hasSingletonCharacteristics(cls)) {
                singletons.push({
                    pattern: 'singleton',
                    name: cls.name,
                    line: cls.line,
                    confidence: 0.8,
                    description: 'Singleton pattern detected'
                });
            }
        }

        return singletons;
    }

    /**
     * Check if class has singleton characteristics
     */
    hasSingletonCharacteristics(cls) {
        // Simplified check for singleton pattern
        if (!cls.methods) return false;
        
        const hasGetInstance = cls.methods.some(m => m.name.toLowerCase().includes('instance'));
        const hasPrivateConstructor = cls.methods.some(m => m.name === 'constructor' && m.static === false);
        
        return hasGetInstance;
    }

    /**
     * Detect factory pattern
     */
    detectFactoryPattern(symbolTable) {
        const factories = [];
        
        for (const func of symbolTable.functions) {
            if (this.hasFactoryCharacteristics(func)) {
                factories.push({
                    pattern: 'factory',
                    name: func.name,
                    line: func.line,
                    confidence: 0.7,
                    description: 'Factory pattern detected'
                });
            }
        }

        return factories;
    }

    /**
     * Check if function has factory characteristics
     */
    hasFactoryCharacteristics(func) {
        const name = func.name.toLowerCase();
        return name.includes('create') || name.includes('make') || name.includes('build') || name.includes('factory');
    }

    /**
     * Detect observer pattern
     */
    detectObserverPattern(symbolTable) {
        const observers = [];
        
        // Look for event-related methods
        for (const cls of symbolTable.classes) {
            if (this.hasObserverCharacteristics(cls)) {
                observers.push({
                    pattern: 'observer',
                    name: cls.name,
                    line: cls.line,
                    confidence: 0.6,
                    description: 'Observer pattern detected'
                });
            }
        }

        return observers;
    }

    /**
     * Check if class has observer characteristics
     */
    hasObserverCharacteristics(cls) {
        if (!cls.methods) return false;
        
        const hasEventMethods = cls.methods.some(m => {
            const name = m.name.toLowerCase();
            return name.includes('addeventlistener') || 
                   name.includes('removeeventlistener') || 
                   name.includes('notify') || 
                   name.includes('subscribe') || 
                   name.includes('unsubscribe');
        });

        return hasEventMethods;
    }

    /**
     * Detect anti-patterns
     */
    async detectAntiPatterns(symbolTable) {
        const antiPatterns = [];

        // Spaghetti code detection
        const spaghettiCode = await this.detectSpaghettiCode(symbolTable);
        antiPatterns.push(...spaghettiCode);

        // Copy-paste code detection
        const copyPasteCode = this.detectCopyPasteCode(symbolTable);
        antiPatterns.push(...copyPasteCode);

        return antiPatterns;
    }

    /**
     * Detect spaghetti code
     */
    async detectSpaghettiCode(symbolTable) {
        const spaghettiCode = [];

        for (const func of symbolTable.functions) {
            const complexity = await this.calculateFunctionComplexity(func.node);
            const length = this.calculateFunctionLength(func.node);
            
            // Spaghetti code: high complexity + long length + deep nesting
            if (complexity > 15 && length > 100) {
                spaghettiCode.push({
                    antiPattern: 'spaghetti_code',
                    name: func.name,
                    line: func.line,
                    severity: 'high',
                    description: `Function has high complexity (${complexity}) and length (${length} lines)`
                });
            }
        }

        return spaghettiCode;
    }

    /**
     * Detect copy-paste code
     */
    detectCopyPasteCode(symbolTable) {
        const copyPasteCode = [];
        
        // This would implement sophisticated duplicate detection
        // For now, return placeholder
        return copyPasteCode;
    }

    /**
     * Generate architectural recommendations
     */
    generateArchitecturalRecommendations(patterns) {
        const recommendations = [];

        if (patterns.antiPatterns.length > 0) {
            recommendations.push('Address detected anti-patterns to improve code structure');
        }

        if (patterns.detected.length === 0) {
            recommendations.push('Consider implementing design patterns to improve code organization');
        }

        return recommendations;
    }

    /**
     * Scan for security vulnerabilities
     */
    async scanSecurityVulnerabilities(symbolTable) {
        const vulnerabilities = [];

        if (!symbolTable.ast) return vulnerabilities;

        // XSS vulnerability detection
        const xssVulns = this.detectXSSVulnerabilities(symbolTable);
        vulnerabilities.push(...xssVulns);

        // Insecure data handling
        const dataVulns = await this.detectInsecureDataHandling(symbolTable);
        vulnerabilities.push(...dataVulns);

        // Weak authentication patterns
        const authVulns = this.detectWeakAuthentication(symbolTable);
        vulnerabilities.push(...authVulns);

        return vulnerabilities;
    }

    /**
     * Detect XSS vulnerabilities
     */
    detectXSSVulnerabilities(symbolTable) {
        const vulnerabilities = [];

        walk.simple(symbolTable.ast, {
            AssignmentExpression(node) {
                if (node.left.type === 'MemberExpression' &&
                    node.left.property.name === 'innerHTML') {
                    vulnerabilities.push({
                        type: 'xss',
                        severity: 'high',
                        line: node.loc ? node.loc.start.line : 0,
                        description: 'Potential XSS vulnerability: innerHTML assignment without sanitization',
                        recommendation: 'Use textContent or sanitize HTML content'
                    });
                }
            }
        });

        return vulnerabilities;
    }

    /**
     * Detect insecure data handling
     */
    async detectInsecureDataHandling(symbolTable) {
        await loadDependencies();
        const vulnerabilities = [];

        walk.simple(symbolTable.ast, {
            CallExpression(node) {
                if (node.callee.name === 'eval') {
                    vulnerabilities.push({
                        type: 'code_injection',
                        severity: 'critical',
                        line: node.loc ? node.loc.start.line : 0,
                        description: 'Use of eval() function poses security risk',
                        recommendation: 'Avoid eval() and use safer alternatives'
                    });
                }
            }
        });

        return vulnerabilities;
    }

    /**
     * Detect weak authentication patterns
     */
    detectWeakAuthentication(symbolTable) {
        const vulnerabilities = [];
        
        // This would implement authentication pattern analysis
        // For now, return placeholder
        return vulnerabilities;
    }

    /**
     * Identify performance issues
     */
    async identifyPerformanceIssues(symbolTable) {
        const issues = [];

        if (!symbolTable.ast) return issues;

        // Inefficient loops
        const loopIssues = await this.detectInefficientLoops(symbolTable);
        issues.push(...loopIssues);

        // Memory leaks
        const memoryIssues = await this.detectMemoryLeaks(symbolTable);
        issues.push(...memoryIssues);

        // Blocking operations
        const blockingIssues = await this.detectBlockingOperations(symbolTable);
        issues.push(...blockingIssues);

        return issues;
    }

    /**
     * Detect inefficient loops
     */
    async detectInefficientLoops(symbolTable) {
        await loadDependencies();
        const issues = [];

        walk.simple(symbolTable.ast, {
            ForStatement(node) {
                // Check for nested loops
                let nestedLoops = 0;
                walk.simple(node.body, {
                    ForStatement() { nestedLoops++; },
                    WhileStatement() { nestedLoops++; },
                    DoWhileStatement() { nestedLoops++; }
                });

                if (nestedLoops > 2) {
                    issues.push({
                        type: 'inefficient_loop',
                        severity: 'medium',
                        line: node.loc ? node.loc.start.line : 0,
                        description: `Deeply nested loops detected (${nestedLoops} levels)`,
                        recommendation: 'Consider optimizing nested loops or using more efficient algorithms'
                    });
                }
            }
        });

        return issues;
    }

    /**
     * Detect potential memory leaks
     */
    async detectMemoryLeaks(symbolTable) {
        await loadDependencies();
        const issues = [];

        walk.simple(symbolTable.ast, {
            CallExpression(node) {
                if (node.callee.type === 'MemberExpression' &&
                    node.callee.property.name === 'addEventListener') {
                    // Check if removeEventListener is called
                    issues.push({
                        type: 'potential_memory_leak',
                        severity: 'medium',
                        line: node.loc ? node.loc.start.line : 0,
                        description: 'Event listener added - ensure removeEventListener is called',
                        recommendation: 'Always remove event listeners to prevent memory leaks'
                    });
                }
            }
        });

        return issues;
    }

    /**
     * Detect blocking operations
     */
    async detectBlockingOperations(symbolTable) {
        await loadDependencies();
        const issues = [];

        walk.simple(symbolTable.ast, {
            CallExpression(node) {
                const funcName = this.getFunctionName(node.callee);
                
                // Check for synchronous operations that could block
                if (funcName.includes('sync') && !funcName.includes('async')) {
                    issues.push({
                        type: 'blocking_operation',
                        severity: 'low',
                        line: node.loc ? node.loc.start.line : 0,
                        description: `Potentially blocking synchronous operation: ${funcName}`,
                        recommendation: 'Consider using asynchronous alternatives'
                    });
                }
            }
        });

        return issues;
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
     * Assess testability
     */
    async assessTestability(symbolTable) {
        const testability = {
            score: 0,
            factors: {
                functionComplexity: 0,
                dependencies: 0,
                sideEffects: 0,
                pureFunctions: 0
            },
            recommendations: []
        };

        // Analyze function complexity impact on testability
        const complexity = this.complexityAnalysis.get(symbolTable.filePath) ||
                          await this.analyzeCyclomaticComplexity(symbolTable);
        
        testability.factors.functionComplexity = complexity.averageComplexity;

        // Count pure functions (functions without side effects)
        let pureFunctionCount = 0;
        for (const func of symbolTable.functions) {
            if (this.isPureFunction(func.node)) {
                pureFunctionCount++;
            }
        }
        
        testability.factors.pureFunction = symbolTable.functions.length > 0 ?
            (pureFunctionCount / symbolTable.functions.length) * 100 : 0;

        // Calculate testability score
        testability.score = this.calculateTestabilityScore(testability.factors);

        // Generate recommendations
        testability.recommendations = this.generateTestabilityRecommendations(testability);

        return testability;
    }

    /**
     * Check if function is pure (no side effects)
     */
    isPureFunction(functionNode) {
        let isPure = true;

        walk.simple(functionNode, {
            AssignmentExpression(node) {
                // Check if assigning to external variables
                if (node.left.type === 'MemberExpression' ||
                    (node.left.type === 'Identifier' && this.isExternalVariable(node.left.name))) {
                    isPure = false;
                }
            },
            CallExpression(node) {
                // Check for calls that might have side effects
                const funcName = this.getFunctionName(node.callee);
                if (this.hasPotentialSideEffects(funcName)) {
                    isPure = false;
                }
            }
        });

        return isPure;
    }

    /**
     * Check if variable is external to function
     */
    isExternalVariable(variableName) {
        // Simplified check - would need more sophisticated scope analysis
        return false;
    }

    /**
     * Check if function has potential side effects
     */
    hasPotentialSideEffects(funcName) {
        const sideEffectPatterns = [
            'console.', 'alert', 'confirm', 'prompt',
            'document.', 'window.', 'localStorage.', 'sessionStorage.',
            'fetch', 'XMLHttpRequest', 'axios', 'ajax',
            'setTimeout', 'setInterval', 'requestAnimationFrame'
        ];
        
        return sideEffectPatterns.some(pattern => funcName.includes(pattern));
    }

    /**
     * Calculate testability score
     */
    calculateTestabilityScore(factors) {
        let score = 100;

        // Reduce score based on complexity
        if (factors.functionComplexity > 10) {
            score -= (factors.functionComplexity - 10) * 5;
        }

        // Increase score for pure functions
        score += factors.pureFunction * 0.2;

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Generate testability recommendations
     */
    generateTestabilityRecommendations(testability) {
        const recommendations = [];

        if (testability.factors.functionComplexity > 10) {
            recommendations.push('Reduce function complexity to improve testability');
        }

        if (testability.factors.pureFunction < 50) {
            recommendations.push('Increase the number of pure functions for easier testing');
        }

        if (testability.score < 70) {
            recommendations.push('Consider dependency injection to improve testability');
            recommendations.push('Separate business logic from side effects');
        }

        return recommendations;
    }

    /**
     * Analyze documentation quality
     */
    async analyzeDocumentation(symbolTable) {
        const documentation = {
            coverage: 0,
            quality: 'poor',
            missing: [],
            recommendations: []
        };

        // Calculate documentation coverage
        documentation.coverage = this.calculateDocumentationCoverage(symbolTable);

        // Identify missing documentation
        for (const func of symbolTable.functions) {
            if (!this.hasPrecedingComment(func.node, symbolTable.ast)) {
                documentation.missing.push({
                    type: 'function',
                    name: func.name,
                    line: func.line
                });
            }
        }

        for (const cls of symbolTable.classes) {
            if (!this.hasPrecedingComment(cls.node, symbolTable.ast)) {
                documentation.missing.push({
                    type: 'class',
                    name: cls.name,
                    line: cls.line
                });
            }
        }

        // Determine quality level
        if (documentation.coverage >= 80) {
            documentation.quality = 'excellent';
        } else if (documentation.coverage >= 60) {
            documentation.quality = 'good';
        } else if (documentation.coverage >= 40) {
            documentation.quality = 'moderate';
        } else {
            documentation.quality = 'poor';
        }

        // Generate recommendations
        documentation.recommendations = this.generateDocumentationRecommendations(documentation);

        return documentation;
    }

    /**
     * Generate documentation recommendations
     */
    generateDocumentationRecommendations(documentation) {
        const recommendations = [];

        if (documentation.coverage < 50) {
            recommendations.push('Add JSDoc comments to functions and classes');
        }

        if (documentation.missing.length > 0) {
            recommendations.push(`Add documentation for ${documentation.missing.length} undocumented items`);
        }

        recommendations.push('Include parameter types and return values in documentation');
        recommendations.push('Add usage examples for complex functions');

        return recommendations;
    }

    /**
     * Calculate overall quality score
     */
    calculateOverallQualityScore(qualityMetrics) {
        const weights = {
            complexity: 0.25,
            maintainability: 0.25,
            codeSmells: 0.15,
            security: 0.15,
            performance: 0.10,
            testability: 0.05,
            documentation: 0.05
        };

        let score = 0;

        // Complexity score (inverse - lower complexity is better)
        const complexityScore = Math.max(0, 100 - (qualityMetrics.complexity.averageComplexity * 5));
        score += complexityScore * weights.complexity;

        // Maintainability score
        score += qualityMetrics.maintainability.index * weights.maintainability;

        // Code smells score (inverse - fewer smells is better)
        const smellsScore = Math.max(0, 100 - (qualityMetrics.codeSmells.length * 10));
        score += smellsScore * weights.codeSmells;

        // Security score (inverse - fewer vulnerabilities is better)
        const securityScore = Math.max(0, 100 - (qualityMetrics.security.length * 20));
        score += securityScore * weights.security;

        // Performance score (inverse - fewer issues is better)
        const performanceScore = Math.max(0, 100 - (qualityMetrics.performance.length * 15));
        score += performanceScore * weights.performance;

        // Testability score
        score += qualityMetrics.testability.score * weights.testability;

        // Documentation score
        score += qualityMetrics.documentation.coverage * weights.documentation;

        return Math.round(score);
    }

    /**
     * Get quality summary for a file
     */
    getQualitySummary(filePath) {
        const metrics = this.qualityMetrics.get(filePath);
        if (!metrics) return null;

        return {
            filePath,
            overallScore: metrics.overallScore,
            category: this.categorizeQualityScore(metrics.overallScore),
            topIssues: this.getTopIssues(metrics),
            recommendations: this.getTopRecommendations(metrics)
        };
    }

    /**
     * Categorize quality score
     */
    categorizeQualityScore(score) {
        if (score >= 90) return 'excellent';
        if (score >= 80) return 'good';
        if (score >= 70) return 'moderate';
        if (score >= 60) return 'poor';
        return 'critical';
    }

    /**
     * Get top issues from quality metrics
     */
    getTopIssues(metrics) {
        const issues = [];

        // Add critical code smells
        const criticalSmells = metrics.codeSmells.filter(smell => smell.severity === 'critical');
        issues.push(...criticalSmells.map(smell => ({
            type: 'code_smell',
            severity: smell.severity,
            description: smell.description,
            location: `${smell.name} at line ${smell.line}`
        })));

        // Add security vulnerabilities
        const criticalSecurity = metrics.security.filter(vuln => vuln.severity === 'critical');
        issues.push(...criticalSecurity.map(vuln => ({
            type: 'security',
            severity: vuln.severity,
            description: vuln.description,
            location: `line ${vuln.line}`
        })));

        // Add high complexity functions
        const complexFunctions = metrics.complexity.functions.filter(func => func.category === 'critical');
        issues.push(...complexFunctions.map(func => ({
            type: 'complexity',
            severity: 'high',
            description: `High complexity function (${func.complexity})`,
            location: `${func.name} at line ${func.line}`
        })));

        return issues.sort((a, b) => {
            const severityOrder = { critical: 3, high: 2, medium: 1, low: 0 };
            return severityOrder[b.severity] - severityOrder[a.severity];
        }).slice(0, 5); // Top 5 issues
    }

    /**
     * Get top recommendations
     */
    getTopRecommendations(metrics) {
        const recommendations = new Set();

        // Add maintainability recommendations
        metrics.maintainability.recommendations.forEach(rec => recommendations.add(rec));

        // Add complexity recommendations
        metrics.complexity.functions.forEach(func => {
            func.recommendations?.forEach(rec => recommendations.add(rec));
        });

        // Add architectural recommendations
        metrics.architecture.recommendations.forEach(rec => recommendations.add(rec));

        return Array.from(recommendations).slice(0, 5); // Top 5 recommendations
    }

    /**
     * Get project-wide quality statistics
     */
    getProjectQualityStatistics() {
        const stats = {
            totalFiles: this.qualityMetrics.size,
            averageScore: 0,
            scoreDistribution: { excellent: 0, good: 0, moderate: 0, poor: 0, critical: 0 },
            commonIssues: new Map(),
            totalCodeSmells: 0,
            totalSecurityIssues: 0,
            totalPerformanceIssues: 0
        };

        let totalScore = 0;

        for (const [filePath, metrics] of this.qualityMetrics) {
            totalScore += metrics.overallScore;
            
            // Update score distribution
            const category = this.categorizeQualityScore(metrics.overallScore);
            stats.scoreDistribution[category]++;

            // Count issues
            stats.totalCodeSmells += metrics.codeSmells.length;
            stats.totalSecurityIssues += metrics.security.length;
            stats.totalPerformanceIssues += metrics.performance.length;

            // Track common issues
            metrics.codeSmells.forEach(smell => {
                const count = stats.commonIssues.get(smell.type) || 0;
                stats.commonIssues.set(smell.type, count + 1);
            });
        }

        if (stats.totalFiles > 0) {
            stats.averageScore = Math.round(totalScore / stats.totalFiles);
        }

        return stats;
    }

    /**
     * Clear cache for a file
     */
    clearFileCache(filePath) {
        this.qualityMetrics.delete(filePath);
        this.complexityAnalysis.delete(filePath);
        this.maintainabilityScores.delete(filePath);
        this.codeSmells.delete(filePath);
        this.securityIssues.delete(filePath);
        this.performanceIssues.delete(filePath);
    }

    /**
     * Export quality analysis data
     */
    exportQualityData() {
        return {
            qualityMetrics: Array.from(this.qualityMetrics.entries()),
            architecturePatterns: Array.from(this.architecturePatterns.entries()),
            projectStatistics: this.getProjectQualityStatistics(),
            qualityThresholds: this.qualityThresholds
        };
    }
}

// Export singleton instance
export const codeQualityAnalyzer = new CodeQualityAnalyzer();