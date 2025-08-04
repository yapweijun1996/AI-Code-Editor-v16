/**
 * Data Flow Analysis Engine
 * Advanced data flow tracking and analysis for senior engineer-level code understanding
 */

import { symbolResolver } from './symbol_resolver.js';

// Dynamic imports for browser compatibility - will be loaded when needed
let acorn, walk;

async function loadDependencies() {
    if (!acorn || !walk) {
        acorn = await import('https://cdn.skypack.dev/acorn@8.11.3');
        walk = await import('https://cdn.skypack.dev/acorn-walk@8.3.2');
    }
}

export class DataFlowAnalyzer {
    constructor() {
        this.dataFlowGraphs = new Map(); // filePath -> DataFlowGraph
        this.variableFlows = new Map(); // variable -> FlowInfo
        this.functionCallGraphs = new Map(); // function -> CallGraph
        this.objectPropertyFlows = new Map(); // object.property -> PropertyFlow
        this.crossFileFlows = new Map(); // cross-file data dependencies
    }

    /**
     * Trace complete variable flow through the codebase
     */
    async traceVariableFlow(variableName, startFile, startLine) {
        console.log(`[DataFlowAnalyzer] Tracing flow for variable '${variableName}' from ${startFile}:${startLine}`);
        
        const flowInfo = {
            variable: variableName,
            startFile,
            startLine,
            definitions: [],
            usages: [],
            mutations: [],
            propagations: [],
            crossFileFlows: [],
            dataTypes: new Set(),
            flowGraph: new Map()
        };

        // Get symbol table for starting file
        let symbolTable = symbolResolver.symbolTables.get(startFile);
        if (!symbolTable) {
            console.warn(`[DataFlowAnalyzer] No symbol table found for ${startFile}`);
            return flowInfo;
        }

        // Trace within current file
        await this.traceVariableInFile(variableName, startFile, flowInfo);
        
        // Trace cross-file flows
        await this.traceCrossFileFlows(variableName, startFile, flowInfo);
        
        // Build flow graph
        this.buildFlowGraph(flowInfo);
        
        // Store in cache
        const cacheKey = `${startFile}:${variableName}:${startLine}`;
        this.variableFlows.set(cacheKey, flowInfo);
        
        console.log(`[DataFlowAnalyzer] Found ${flowInfo.definitions.length} definitions, ${flowInfo.usages.length} usages, ${flowInfo.mutations.length} mutations`);
        return flowInfo;
    }

    /**
     * Trace variable flow within a single file
     */
    async traceVariableInFile(variableName, filePath, flowInfo) {
        const symbolTable = symbolResolver.symbolTables.get(filePath);
        if (!symbolTable || !symbolTable.ast) return;

        const ast = symbolTable.ast;
        const definitions = [];
        const usages = [];
        const mutations = [];

        // Walk AST to find all occurrences
        walk.ancestor(ast, {
            VariableDeclarator(node, ancestors) {
                if (node.id && node.id.type === 'Identifier' && node.id.name === variableName) {
                    const definition = {
                        type: 'declaration',
                        filePath,
                        line: node.loc ? node.loc.start.line : 0,
                        column: node.loc ? node.loc.start.column : 0,
                        node,
                        scope: this.findContainingScope(node, symbolTable.scopes),
                        initialValue: node.init,
                        dataType: this.inferDataType(node.init),
                        ancestors: [...ancestors]
                    };
                    definitions.push(definition);
                    flowInfo.dataTypes.add(definition.dataType);
                }
            },

            AssignmentExpression(node, ancestors) {
                if (node.left && node.left.type === 'Identifier' && node.left.name === variableName) {
                    const mutation = {
                        type: 'assignment',
                        filePath,
                        line: node.loc ? node.loc.start.line : 0,
                        column: node.loc ? node.loc.start.column : 0,
                        node,
                        operator: node.operator,
                        rightSide: node.right,
                        dataType: this.inferDataType(node.right),
                        ancestors: [...ancestors]
                    };
                    mutations.push(mutation);
                    flowInfo.dataTypes.add(mutation.dataType);
                } else if (this.containsVariable(node.right, variableName)) {
                    // Variable used in assignment to another variable
                    const usage = {
                        type: 'assignment_rhs',
                        filePath,
                        line: node.loc ? node.loc.start.line : 0,
                        column: node.loc ? node.loc.start.column : 0,
                        node,
                        context: 'assignment',
                        targetVariable: node.left.name,
                        ancestors: [...ancestors]
                    };
                    usages.push(usage);
                }
            },

            UpdateExpression(node, ancestors) {
                if (node.argument && node.argument.type === 'Identifier' && node.argument.name === variableName) {
                    const mutation = {
                        type: 'update',
                        filePath,
                        line: node.loc ? node.loc.start.line : 0,
                        column: node.loc ? node.loc.start.column : 0,
                        node,
                        operator: node.operator,
                        prefix: node.prefix,
                        ancestors: [...ancestors]
                    };
                    mutations.push(mutation);
                }
            },

            CallExpression(node, ancestors) {
                // Check if variable is used as function argument
                if (node.arguments) {
                    node.arguments.forEach((arg, index) => {
                        if (this.containsVariable(arg, variableName)) {
                            const usage = {
                                type: 'function_argument',
                                filePath,
                                line: node.loc ? node.loc.start.line : 0,
                                column: node.loc ? node.loc.start.column : 0,
                                node,
                                argumentIndex: index,
                                functionName: this.getFunctionName(node.callee),
                                ancestors: [...ancestors]
                            };
                            usages.push(usage);
                        }
                    });
                }
            },

            ReturnStatement(node, ancestors) {
                if (node.argument && this.containsVariable(node.argument, variableName)) {
                    const usage = {
                        type: 'return',
                        filePath,
                        line: node.loc ? node.loc.start.line : 0,
                        column: node.loc ? node.loc.start.column : 0,
                        node,
                        context: 'return_value',
                        ancestors: [...ancestors]
                    };
                    usages.push(usage);
                }
            },

            MemberExpression(node, ancestors) {
                // Handle object.property access
                if (node.object && node.object.type === 'Identifier' && node.object.name === variableName) {
                    const usage = {
                        type: 'property_access',
                        filePath,
                        line: node.loc ? node.loc.start.line : 0,
                        column: node.loc ? node.loc.start.column : 0,
                        node,
                        property: node.property.name || node.property.value,
                        computed: node.computed,
                        ancestors: [...ancestors]
                    };
                    usages.push(usage);
                }
            },

            Identifier(node, ancestors) {
                // General identifier usage (excluding declarations and assignments already handled)
                if (node.name === variableName) {
                    const parent = ancestors[ancestors.length - 1];
                    
                    // Skip if already handled by other cases
                    if (parent && (
                        (parent.type === 'VariableDeclarator' && parent.id === node) ||
                        (parent.type === 'AssignmentExpression' && parent.left === node) ||
                        (parent.type === 'UpdateExpression' && parent.argument === node) ||
                        (parent.type === 'MemberExpression' && parent.object === node)
                    )) {
                        return;
                    }

                    const usage = {
                        type: 'reference',
                        filePath,
                        line: node.loc ? node.loc.start.line : 0,
                        column: node.loc ? node.loc.start.column : 0,
                        node,
                        context: this.getUsageContext(node, ancestors),
                        ancestors: [...ancestors]
                    };
                    usages.push(usage);
                }
            }
        });

        // Add to flow info
        flowInfo.definitions.push(...definitions);
        flowInfo.usages.push(...usages);
        flowInfo.mutations.push(...mutations);

        // Analyze propagations (where this variable's value flows to other variables)
        await this.analyzePropagations(variableName, filePath, flowInfo);
    }

    /**
     * Check if an AST node contains a reference to a variable
     */
    containsVariable(node, variableName) {
        if (!node) return false;

        if (node.type === 'Identifier') {
            return node.name === variableName;
        }

        let found = false;
        walk.simple(node, {
            Identifier(n) {
                if (n.name === variableName) {
                    found = true;
                }
            }
        });
        
        return found;
    }

    /**
     * Get function name from callee expression
     */
    getFunctionName(callee) {
        if (!callee) return 'unknown';
        
        if (callee.type === 'Identifier') {
            return callee.name;
        } else if (callee.type === 'MemberExpression') {
            const object = callee.object.name || 'unknown';
            const property = callee.property.name || callee.property.value || 'unknown';
            return `${object}.${property}`;
        }
        
        return 'anonymous';
    }

    /**
     * Get usage context for better understanding
     */
    getUsageContext(node, ancestors) {
        if (ancestors.length === 0) return 'unknown';
        
        const parent = ancestors[ancestors.length - 1];
        
        switch (parent.type) {
            case 'BinaryExpression':
                return `binary_${parent.operator}`;
            case 'UnaryExpression':
                return `unary_${parent.operator}`;
            case 'ConditionalExpression':
                return parent.test === node ? 'condition' : 'conditional_value';
            case 'IfStatement':
                return 'if_condition';
            case 'WhileStatement':
            case 'DoWhileStatement':
                return 'loop_condition';
            case 'ForStatement':
                return 'for_condition';
            case 'SwitchStatement':
                return 'switch_discriminant';
            case 'ThrowStatement':
                return 'throw_expression';
            default:
                return parent.type.toLowerCase();
        }
    }

    /**
     * Infer data type from AST node
     */
    inferDataType(node) {
        if (!node) return 'undefined';
        
        switch (node.type) {
            case 'Literal':
                if (node.value === null) return 'null';
                return typeof node.value;
            case 'ArrayExpression':
                return 'array';
            case 'ObjectExpression':
                return 'object';
            case 'FunctionExpression':
            case 'ArrowFunctionExpression':
                return 'function';
            case 'NewExpression':
                return node.callee.name || 'object';
            case 'CallExpression':
                // Try to infer from function name
                const funcName = this.getFunctionName(node.callee);
                if (funcName.includes('String') || funcName.includes('toString')) return 'string';
                if (funcName.includes('Number') || funcName.includes('parseInt')) return 'number';
                if (funcName.includes('Boolean')) return 'boolean';
                if (funcName.includes('Array')) return 'array';
                return 'unknown';
            case 'BinaryExpression':
                if (['+', '-', '*', '/', '%', '**'].includes(node.operator)) {
                    return 'number';
                } else if (['==', '!=', '===', '!==', '<', '>', '<=', '>='].includes(node.operator)) {
                    return 'boolean';
                } else if (node.operator === '+') {
                    // Could be string concatenation or addition
                    const leftType = this.inferDataType(node.left);
                    const rightType = this.inferDataType(node.right);
                    if (leftType === 'string' || rightType === 'string') return 'string';
                    return 'number';
                }
                return 'unknown';
            case 'UnaryExpression':
                if (node.operator === '!') return 'boolean';
                if (['+', '-', '~'].includes(node.operator)) return 'number';
                if (node.operator === 'typeof') return 'string';
                return 'unknown';
            default:
                return 'unknown';
        }
    }

    /**
     * Find containing scope for a node
     */
    findContainingScope(node, scopes) {
        if (!scopes || !node.loc) return null;
        
        const line = node.loc.start.line;
        let bestScope = null;
        
        for (const scope of scopes) {
            if (scope.start <= line && line <= scope.end) {
                if (!bestScope || (scope.start >= bestScope.start && scope.end <= bestScope.end)) {
                    bestScope = scope;
                }
            }
        }
        
        return bestScope;
    }

    /**
     * Analyze how variable values propagate to other variables
     */
    async analyzePropagations(variableName, filePath, flowInfo) {
        await loadDependencies();
        const symbolTable = symbolResolver.symbolTables.get(filePath);
        if (!symbolTable || !symbolTable.ast) return;

        const propagations = [];

        walk.simple(symbolTable.ast, {
            AssignmentExpression(node) {
                if (this.containsVariable(node.right, variableName)) {
                    // This variable's value flows to the left side
                    if (node.left.type === 'Identifier') {
                        propagations.push({
                            type: 'assignment',
                            from: variableName,
                            to: node.left.name,
                            filePath,
                            line: node.loc ? node.loc.start.line : 0,
                            node,
                            operator: node.operator
                        });
                    }
                }
            },
            
            VariableDeclarator(node) {
                if (node.init && this.containsVariable(node.init, variableName)) {
                    if (node.id.type === 'Identifier') {
                        propagations.push({
                            type: 'initialization',
                            from: variableName,
                            to: node.id.name,
                            filePath,
                            line: node.loc ? node.loc.start.line : 0,
                            node
                        });
                    }
                }
            },
            
            CallExpression(node) {
                // Check if variable is passed as argument
                if (node.arguments) {
                    node.arguments.forEach((arg, index) => {
                        if (this.containsVariable(arg, variableName)) {
                            propagations.push({
                                type: 'function_call',
                                from: variableName,
                                to: this.getFunctionName(node.callee),
                                filePath,
                                line: node.loc ? node.loc.start.line : 0,
                                node,
                                argumentIndex: index
                            });
                        }
                    });
                }
            }
        });
        
        flowInfo.propagations.push(...propagations);
    }

    /**
     * Trace cross-file data flows
     */
    async traceCrossFileFlows(variableName, startFile, flowInfo) {
        const symbolTable = symbolResolver.symbolTables.get(startFile);
        if (!symbolTable) return;

        // Check exports - if this variable is exported, trace its usage in importing files
        for (const exportInfo of symbolTable.exports) {
            if (this.isVariableExported(variableName, exportInfo)) {
                const importingFiles = await this.findImportingFiles(startFile);
                for (const importingFile of importingFiles) {
                    await this.traceImportedVariableUsage(variableName, importingFile, startFile, flowInfo);
                }
            }
        }

        // Check imports - if this variable comes from an import, trace back to source
        for (const importInfo of symbolTable.imports) {
            const spec = importInfo.specifiers.find(s => s.local === variableName);
            if (spec && importInfo.resolvedPath) {
                await this.traceVariableInFile(spec.imported, importInfo.resolvedPath, flowInfo);
            }
        }
    }

    /**
     * Check if variable is exported
     */
    isVariableExported(variableName, exportInfo) {
        if (exportInfo.type === 'named') {
            return exportInfo.specifiers.some(spec => spec.local === variableName);
        } else if (exportInfo.type === 'default' && exportInfo.declaration) {
            if (exportInfo.declaration.type === 'Identifier') {
                return exportInfo.declaration.name === variableName;
            }
        }
        return false;
    }

    /**
     * Find files that import from the given file
     */
    async findImportingFiles(filePath) {
        const importingFiles = [];
        
        for (const [otherFile, symbolTable] of symbolResolver.symbolTables) {
            if (otherFile === filePath) continue;
            
            for (const importInfo of symbolTable.imports) {
                if (importInfo.resolvedPath === filePath || importInfo.source === filePath) {
                    importingFiles.push(otherFile);
                    break;
                }
            }
        }
        
        return importingFiles;
    }

    /**
     * Trace usage of imported variable in importing file
     */
    async traceImportedVariableUsage(originalVariable, importingFile, sourceFile, flowInfo) {
        const symbolTable = symbolResolver.symbolTables.get(importingFile);
        if (!symbolTable) return;

        // Find the local name of the imported variable
        let localName = null;
        for (const importInfo of symbolTable.imports) {
            if (importInfo.resolvedPath === sourceFile || importInfo.source === sourceFile) {
                const spec = importInfo.specifiers.find(s => s.imported === originalVariable);
                if (spec) {
                    localName = spec.local;
                    break;
                }
            }
        }

        if (localName) {
            // Trace the local variable in the importing file
            const localFlowInfo = {
                definitions: [],
                usages: [],
                mutations: [],
                propagations: []
            };
            
            await this.traceVariableInFile(localName, importingFile, localFlowInfo);
            
            // Add cross-file flow information
            flowInfo.crossFileFlows.push({
                sourceFile,
                targetFile: importingFile,
                originalName: originalVariable,
                localName,
                ...localFlowInfo
            });
        }
    }

    /**
     * Analyze function calls and their data flow
     */
    async analyzeFunctionCalls(functionName, projectScope) {
        console.log(`[DataFlowAnalyzer] Analyzing function calls for '${functionName}'`);
        
        const callGraph = {
            function: functionName,
            calls: [],
            calledBy: [],
            parameters: [],
            returnValues: [],
            sideEffects: []
        };

        // Find all calls to this function across all files
        for (const [filePath, symbolTable] of symbolResolver.symbolTables) {
            if (!symbolTable.ast) continue;
            
            walk.simple(symbolTable.ast, {
                CallExpression(node) {
                    const calledFunction = this.getFunctionName(node.callee);
                    if (calledFunction === functionName) {
                        const call = {
                            filePath,
                            line: node.loc ? node.loc.start.line : 0,
                            arguments: node.arguments.map(arg => ({
                                type: arg.type,
                                value: this.getArgumentValue(arg),
                                dataType: this.inferDataType(arg)
                            })),
                            node
                        };
                        callGraph.calls.push(call);
                    }
                }
            });
        }

        // Find function definition and analyze parameters/return values
        const functionDef = await this.findFunctionDefinition(functionName);
        if (functionDef) {
            callGraph.parameters = functionDef.params.map(param => ({
                name: param.name,
                type: this.inferParameterType(param, functionDef.body)
            }));
            
            callGraph.returnValues = await this.analyzeReturnValues(functionDef);
            callGraph.sideEffects = await this.analyzeSideEffects(functionDef);
        }

        this.functionCallGraphs.set(functionName, callGraph);
        return callGraph;
    }

    /**
     * Get argument value for analysis
     */
    getArgumentValue(arg) {
        if (arg.type === 'Literal') {
            return arg.value;
        } else if (arg.type === 'Identifier') {
            return arg.name;
        } else if (arg.type === 'MemberExpression') {
            return `${arg.object.name}.${arg.property.name}`;
        }
        return 'complex_expression';
    }

    /**
     * Find function definition across all files
     */
    async findFunctionDefinition(functionName) {
        for (const [filePath, symbolTable] of symbolResolver.symbolTables) {
            const func = symbolTable.functions.find(f => f.name === functionName);
            if (func) {
                return func.node;
            }
        }
        return null;
    }

    /**
     * Analyze return values of a function
     */
    async analyzeReturnValues(functionNode) {
        await loadDependencies();
        const returnValues = [];

        walk.simple(functionNode, {
            ReturnStatement(node) {
                if (node.argument) {
                    returnValues.push({
                        type: node.argument.type,
                        dataType: this.inferDataType(node.argument),
                        line: node.loc ? node.loc.start.line : 0,
                        node: node.argument
                    });
                } else {
                    returnValues.push({
                        type: 'undefined',
                        dataType: 'undefined',
                        line: node.loc ? node.loc.start.line : 0
                    });
                }
            }
        });
        
        return returnValues;
    }

    /**
     * Analyze side effects of a function
     */
    async analyzeSideEffects(functionNode) {
        await loadDependencies();
        const sideEffects = [];

        walk.simple(functionNode, {
            AssignmentExpression(node) {
                // Global variable assignments or property modifications
                if (node.left.type === 'Identifier' || node.left.type === 'MemberExpression') {
                    sideEffects.push({
                        type: 'assignment',
                        target: node.left,
                        line: node.loc ? node.loc.start.line : 0
                    });
                }
            },
            
            CallExpression(node) {
                // Function calls that might have side effects
                const funcName = this.getFunctionName(node.callee);
                if (this.hasPotentialSideEffects(funcName)) {
                    sideEffects.push({
                        type: 'function_call',
                        function: funcName,
                        line: node.loc ? node.loc.start.line : 0
                    });
                }
            }
        });
        
        return sideEffects;
    }

    /**
     * Check if function name suggests potential side effects
     */
    hasPotentialSideEffects(funcName) {
        const sideEffectPatterns = [
            'console.', 'alert', 'confirm', 'prompt',
            'document.', 'window.', 'localStorage.', 'sessionStorage.',
            'fetch', 'XMLHttpRequest', 'axios', 'ajax',
            'setTimeout', 'setInterval', 'requestAnimationFrame',
            'addEventListener', 'removeEventListener',
            'appendChild', 'removeChild', 'innerHTML', 'textContent'
        ];
        
        return sideEffectPatterns.some(pattern => funcName.includes(pattern));
    }

    /**
     * Track object property flows
     */
    async trackObjectProperties(objectName, propertyChain) {
        console.log(`[DataFlowAnalyzer] Tracking object properties for '${objectName}.${propertyChain.join('.')}'`);
        
        const propertyFlow = {
            object: objectName,
            propertyChain,
            assignments: [],
            accesses: [],
            mutations: [],
            propagations: []
        };

        // Find all property accesses and assignments across all files
        for (const [filePath, symbolTable] of symbolResolver.symbolTables) {
            if (!symbolTable.ast) continue;
            
            await this.trackPropertiesInFile(objectName, propertyChain, filePath, propertyFlow);
        }

        const cacheKey = `${objectName}.${propertyChain.join('.')}`;
        this.objectPropertyFlows.set(cacheKey, propertyFlow);
        return propertyFlow;
    }

    /**
     * Track properties in a single file
     */
    async trackPropertiesInFile(objectName, propertyChain, filePath, propertyFlow) {
        await loadDependencies();
        const symbolTable = symbolResolver.symbolTables.get(filePath);
        if (!symbolTable || !symbolTable.ast) return;

        walk.simple(symbolTable.ast, {
            MemberExpression(node) {
                if (this.matchesPropertyChain(node, objectName, propertyChain)) {
                    propertyFlow.accesses.push({
                        filePath,
                        line: node.loc ? node.loc.start.line : 0,
                        node,
                        computed: node.computed
                    });
                }
            },
            
            AssignmentExpression(node) {
                if (node.left.type === 'MemberExpression' && 
                    this.matchesPropertyChain(node.left, objectName, propertyChain)) {
                    propertyFlow.assignments.push({
                        filePath,
                        line: node.loc ? node.loc.start.line : 0,
                        node,
                        value: node.right,
                        operator: node.operator
                    });
                }
            }
        });
    }

    /**
     * Check if member expression matches property chain
     */
    matchesPropertyChain(memberExpr, objectName, propertyChain) {
        if (!memberExpr || memberExpr.type !== 'MemberExpression') return false;
        
        // Build the chain from the member expression
        const chain = [];
        let current = memberExpr;
        
        while (current && current.type === 'MemberExpression') {
            const propName = current.property.name || current.property.value;
            chain.unshift(propName);
            current = current.object;
        }
        
        if (current && current.type === 'Identifier' && current.name === objectName) {
            // Check if chains match
            if (chain.length !== propertyChain.length) return false;
            return chain.every((prop, index) => prop === propertyChain[index]);
        }
        
        return false;
    }

    /**
     * Build comprehensive flow graph
     */
    buildFlowGraph(flowInfo) {
        const graph = new Map();
        
        // Add definitions as source nodes
        flowInfo.definitions.forEach(def => {
            const nodeId = `def_${def.line}`;
            graph.set(nodeId, {
                type: 'definition',
                ...def,
                connections: []
            });
        });
        
        // Add usages and connect to definitions
        flowInfo.usages.forEach(usage => {
            const nodeId = `use_${usage.line}`;
            graph.set(nodeId, {
                type: 'usage',
                ...usage,
                connections: []
            });
            
            // Find closest preceding definition
            const precedingDef = this.findPrecedingDefinition(usage, flowInfo.definitions);
            if (precedingDef) {
                const defNodeId = `def_${precedingDef.line}`;
                if (graph.has(defNodeId)) {
                    graph.get(defNodeId).connections.push(nodeId);
                }
            }
        });
        
        // Add mutations and connect appropriately
        flowInfo.mutations.forEach(mutation => {
            const nodeId = `mut_${mutation.line}`;
            graph.set(nodeId, {
                type: 'mutation',
                ...mutation,
                connections: []
            });
        });
        
        flowInfo.flowGraph = graph;
    }

    /**
     * Find the definition that precedes a usage
     */
    findPrecedingDefinition(usage, definitions) {
        const usageLine = usage.line;
        let bestDef = null;
        
        for (const def of definitions) {
            if (def.line <= usageLine) {
                if (!bestDef || def.line > bestDef.line) {
                    bestDef = def;
                }
            }
        }
        
        return bestDef;
    }

    /**
     * Get comprehensive data flow analysis for a symbol
     */
    async getComprehensiveFlow(symbolName, filePath, line) {
        const variableFlow = await this.traceVariableFlow(symbolName, filePath, line);
        
        // If it's a function, also get call graph
        let callGraph = null;
        const symbolInfo = symbolResolver.getSymbolInfo(symbolName, filePath, line);
        if (symbolInfo.type === 'function') {
            callGraph = await this.analyzeFunctionCalls(symbolName);
        }
        
        return {
            variableFlow,
            callGraph,
            summary: {
                totalDefinitions: variableFlow.definitions.length,
                totalUsages: variableFlow.usages.length,
                totalMutations: variableFlow.mutations.length,
                crossFileFlows: variableFlow.crossFileFlows.length,
                dataTypes: Array.from(variableFlow.dataTypes),
                complexity: this.calculateFlowComplexity(variableFlow)
            }
        };
    }

    /**
     * Calculate flow complexity score
     */
    calculateFlowComplexity(flowInfo) {
        const weights = {
            definition: 1,
            usage: 0.5,
            mutation: 2,
            crossFile: 3,
            propagation: 1.5
        };
        
        return (
            flowInfo.definitions.length * weights.definition +
            flowInfo.usages.length * weights.usage +
            flowInfo.mutations.length * weights.mutation +
            flowInfo.crossFileFlows.length * weights.crossFile +
            flowInfo.propagations.length * weights.propagation
        );
    }

    /**
     * Clear cache for a file
     */
    clearFileCache(filePath) {
        // Remove file-specific entries
        for (const [key, value] of this.variableFlows) {
            if (value.startFile === filePath ||
                value.crossFileFlows.some(flow => flow.sourceFile === filePath || flow.targetFile === filePath)) {
                this.variableFlows.delete(key);
            }
        }
        
        // Remove function call graphs
        for (const [funcName, callGraph] of this.functionCallGraphs) {
            if (callGraph.calls.some(call => call.filePath === filePath)) {
                this.functionCallGraphs.delete(funcName);
            }
        }
        
        // Remove object property flows
        for (const [key, propertyFlow] of this.objectPropertyFlows) {
            if (propertyFlow.assignments.some(assign => assign.filePath === filePath) ||
                propertyFlow.accesses.some(access => access.filePath === filePath)) {
                this.objectPropertyFlows.delete(key);
            }
        }
        
        // Remove data flow graphs
        this.dataFlowGraphs.delete(filePath);
    }

    /**
     * Get statistics about data flow analysis
     */
    getStatistics() {
        return {
            variableFlowsTracked: this.variableFlows.size,
            functionCallGraphs: this.functionCallGraphs.size,
            objectPropertyFlows: this.objectPropertyFlows.size,
            crossFileFlows: Array.from(this.variableFlows.values())
                .reduce((sum, flow) => sum + flow.crossFileFlows.length, 0)
        };
    }

    /**
     * Export data flow information for debugging
     */
    exportFlowData() {
        return {
            variableFlows: Array.from(this.variableFlows.entries()),
            functionCallGraphs: Array.from(this.functionCallGraphs.entries()),
            objectPropertyFlows: Array.from(this.objectPropertyFlows.entries()),
            statistics: this.getStatistics()
        };
    }
}

// Export singleton instance
export const dataFlowAnalyzer = new DataFlowAnalyzer();