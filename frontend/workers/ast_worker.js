/**
 * AST Worker - Handles Abstract Syntax Tree parsing in background
 */

// Import necessary libraries for AST parsing
let acorn, acornWalk;

// Initialize libraries
async function initializeLibraries() {
    try {
        // Try to import acorn if available
        if (typeof importScripts !== 'undefined') {
            // In a worker context, we might need to import scripts
            // For now, we'll use a simplified approach
        }
        
        // Fallback to basic parsing if acorn is not available
        acorn = self.acorn || null;
        acornWalk = self.acorn?.walk || null;
    } catch (error) {
        console.warn('AST libraries not available, using fallback parsing');
    }
}

/**
 * Parse JavaScript/TypeScript code into AST
 */
function parseCode(code, filename, options = {}) {
    try {
        if (acorn) {
            const parseOptions = {
                ecmaVersion: 'latest',
                sourceType: 'module',
                locations: true,
                ranges: true,
                ...options
            };
            
            return acorn.parse(code, parseOptions);
        } else {
            // Fallback: Basic regex-based parsing for common patterns
            return parseWithRegex(code, filename);
        }
    } catch (error) {
        throw new Error(`Failed to parse ${filename}: ${error.message}`);
    }
}

/**
 * Fallback regex-based parsing for basic code analysis
 */
function parseWithRegex(code, filename) {
    const ast = {
        type: 'Program',
        body: [],
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        variables: []
    };

    // Extract functions
    const functionRegex = /(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g;
    let match;
    while ((match = functionRegex.exec(code)) !== null) {
        ast.functions.push({
            name: match[1] || match[2],
            type: 'FunctionDeclaration',
            start: match.index,
            end: match.index + match[0].length
        });
    }

    // Extract classes
    const classRegex = /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*{/g;
    while ((match = classRegex.exec(code)) !== null) {
        ast.classes.push({
            name: match[1],
            superClass: match[2] || null,
            type: 'ClassDeclaration',
            start: match.index,
            end: match.index + match[0].length
        });
    }

    // Extract imports
    const importRegex = /import\s+(?:{([^}]+)}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = importRegex.exec(code)) !== null) {
        ast.imports.push({
            specifiers: match[1] ? match[1].split(',').map(s => s.trim()) : [match[2] || match[3]],
            source: match[4],
            type: 'ImportDeclaration',
            start: match.index,
            end: match.index + match[0].length
        });
    }

    // Extract exports
    const exportRegex = /export\s+(?:default\s+)?(?:function\s+(\w+)|class\s+(\w+)|const\s+(\w+)|{([^}]+)})/g;
    while ((match = exportRegex.exec(code)) !== null) {
        ast.exports.push({
            name: match[1] || match[2] || match[3] || match[4],
            type: 'ExportDeclaration',
            start: match.index,
            end: match.index + match[0].length
        });
    }

    // Extract variables
    const variableRegex = /(?:const|let|var)\s+(\w+)\s*=/g;
    while ((match = variableRegex.exec(code)) !== null) {
        ast.variables.push({
            name: match[1],
            type: 'VariableDeclaration',
            start: match.index,
            end: match.index + match[0].length
        });
    }

    return ast;
}

/**
 * Analyze AST for complexity metrics
 */
function analyzeComplexity(ast) {
    const metrics = {
        cyclomaticComplexity: 1, // Base complexity
        cognitiveComplexity: 0,
        nestingDepth: 0,
        functionCount: 0,
        classCount: 0,
        linesOfCode: 0
    };

    if (ast.functions) {
        metrics.functionCount = ast.functions.length;
    }

    if (ast.classes) {
        metrics.classCount = ast.classes.length;
    }

    // Basic complexity calculation
    if (typeof ast === 'object' && ast.body) {
        metrics.cyclomaticComplexity += countComplexityNodes(ast);
    }

    return metrics;
}

/**
 * Count nodes that contribute to cyclomatic complexity
 */
function countComplexityNodes(node) {
    let complexity = 0;
    
    if (!node || typeof node !== 'object') return complexity;

    // Count decision points
    const complexityNodes = [
        'IfStatement', 'ConditionalExpression', 'SwitchCase',
        'WhileStatement', 'DoWhileStatement', 'ForStatement',
        'ForInStatement', 'ForOfStatement', 'CatchClause'
    ];

    if (complexityNodes.includes(node.type)) {
        complexity++;
    }

    // Recursively count in child nodes
    for (const key in node) {
        if (key !== 'parent' && typeof node[key] === 'object') {
            if (Array.isArray(node[key])) {
                for (const child of node[key]) {
                    complexity += countComplexityNodes(child);
                }
            } else {
                complexity += countComplexityNodes(node[key]);
            }
        }
    }

    return complexity;
}

/**
 * Extract symbols from AST
 */
function extractSymbols(ast) {
    const symbols = {
        functions: [],
        classes: [],
        variables: [],
        imports: [],
        exports: []
    };

    if (ast.functions) {
        symbols.functions = ast.functions.map(fn => ({
            name: fn.name,
            type: 'function',
            location: { start: fn.start, end: fn.end }
        }));
    }

    if (ast.classes) {
        symbols.classes = ast.classes.map(cls => ({
            name: cls.name,
            type: 'class',
            superClass: cls.superClass,
            location: { start: cls.start, end: cls.end }
        }));
    }

    if (ast.variables) {
        symbols.variables = ast.variables.map(variable => ({
            name: variable.name,
            type: 'variable',
            location: { start: variable.start, end: variable.end }
        }));
    }

    if (ast.imports) {
        symbols.imports = ast.imports.map(imp => ({
            specifiers: imp.specifiers,
            source: imp.source,
            type: 'import',
            location: { start: imp.start, end: imp.end }
        }));
    }

    if (ast.exports) {
        symbols.exports = ast.exports.map(exp => ({
            name: exp.name,
            type: 'export',
            location: { start: exp.start, end: exp.end }
        }));
    }

    return symbols;
}

// Message handler
self.addEventListener('message', async (event) => {
    const { jobId, data, type } = event.data;
    
    try {
        let result;
        
        switch (data.action) {
            case 'parse':
                result = parseCode(data.code, data.filename, data.options);
                break;
                
            case 'analyze':
                const ast = parseCode(data.code, data.filename, data.options);
                result = {
                    ast,
                    complexity: analyzeComplexity(ast),
                    symbols: extractSymbols(ast)
                };
                break;
                
            case 'complexity':
                const parsedAst = parseCode(data.code, data.filename, data.options);
                result = analyzeComplexity(parsedAst);
                break;
                
            case 'symbols':
                const symbolAst = parseCode(data.code, data.filename, data.options);
                result = extractSymbols(symbolAst);
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

// Initialize when worker starts
initializeLibraries();

// Signal that worker is ready
self.postMessage({ type: 'ready' });