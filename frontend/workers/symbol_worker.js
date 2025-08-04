/**
 * Symbol Worker - Handles symbol resolution and analysis in background
 */

/**
 * Symbol table for tracking symbols across files
 */
class SymbolTable {
    constructor() {
        this.symbols = new Map();
        this.scopes = [];
        this.currentScope = null;
    }

    enterScope(scopeName = 'anonymous') {
        const scope = {
            name: scopeName,
            symbols: new Map(),
            parent: this.currentScope
        };
        this.scopes.push(scope);
        this.currentScope = scope;
        return scope;
    }

    exitScope() {
        if (this.currentScope && this.currentScope.parent) {
            this.currentScope = this.currentScope.parent;
        }
    }

    addSymbol(name, info) {
        const symbol = {
            name,
            type: info.type || 'unknown',
            location: info.location,
            scope: this.currentScope?.name || 'global',
            references: [],
            definitions: [],
            ...info
        };

        this.symbols.set(name, symbol);
        
        if (this.currentScope) {
            this.currentScope.symbols.set(name, symbol);
        }

        return symbol;
    }

    findSymbol(name) {
        // First check current scope and parent scopes
        let scope = this.currentScope;
        while (scope) {
            if (scope.symbols.has(name)) {
                return scope.symbols.get(name);
            }
            scope = scope.parent;
        }

        // Check global symbols
        return this.symbols.get(name);
    }

    getAllSymbols() {
        return Array.from(this.symbols.values());
    }
}

/**
 * Resolve symbols in JavaScript/TypeScript code
 */
function resolveSymbols(code, filename) {
    const symbolTable = new SymbolTable();
    const lines = code.split('\n');
    
    // Enter global scope
    symbolTable.enterScope('global');

    // Parse imports
    const importRegex = /import\s+(?:{([^}]+)}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    
    while ((match = importRegex.exec(code)) !== null) {
        const lineNumber = code.substring(0, match.index).split('\n').length;
        const source = match[4];
        
        if (match[1]) {
            // Named imports: import { a, b } from 'module'
            const namedImports = match[1].split(',').map(s => s.trim());
            namedImports.forEach(importName => {
                const cleanName = importName.replace(/\s+as\s+\w+/, '').trim();
                symbolTable.addSymbol(cleanName, {
                    type: 'import',
                    source,
                    location: { line: lineNumber, column: match.index },
                    importType: 'named'
                });
            });
        } else if (match[2]) {
            // Namespace import: import * as name from 'module'
            symbolTable.addSymbol(match[2], {
                type: 'import',
                source,
                location: { line: lineNumber, column: match.index },
                importType: 'namespace'
            });
        } else if (match[3]) {
            // Default import: import name from 'module'
            symbolTable.addSymbol(match[3], {
                type: 'import',
                source,
                location: { line: lineNumber, column: match.index },
                importType: 'default'
            });
        }
    }

    // Parse function declarations
    const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)/g;
    while ((match = functionRegex.exec(code)) !== null) {
        const lineNumber = code.substring(0, match.index).split('\n').length;
        symbolTable.addSymbol(match[1], {
            type: 'function',
            location: { line: lineNumber, column: match.index },
            isExported: match[0].includes('export')
        });
    }

    // Parse arrow functions and function expressions
    const arrowFunctionRegex = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g;
    while ((match = arrowFunctionRegex.exec(code)) !== null) {
        const lineNumber = code.substring(0, match.index).split('\n').length;
        symbolTable.addSymbol(match[1], {
            type: 'function',
            location: { line: lineNumber, column: match.index },
            isArrowFunction: true
        });
    }

    // Parse class declarations
    const classRegex = /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?\s*{/g;
    while ((match = classRegex.exec(code)) !== null) {
        const lineNumber = code.substring(0, match.index).split('\n').length;
        symbolTable.addSymbol(match[1], {
            type: 'class',
            location: { line: lineNumber, column: match.index },
            superClass: match[2] || null,
            isExported: match[0].includes('export')
        });
    }

    // Parse variable declarations
    const variableRegex = /(?:const|let|var)\s+(\w+)(?:\s*=\s*([^;,\n]+))?/g;
    while ((match = variableRegex.exec(code)) !== null) {
        const lineNumber = code.substring(0, match.index).split('\n').length;
        const variableName = match[1];
        const initialValue = match[2]?.trim();
        
        // Skip if it's already a function (handled above)
        if (initialValue && (initialValue.includes('=>') || initialValue.startsWith('function'))) {
            continue;
        }

        symbolTable.addSymbol(variableName, {
            type: 'variable',
            location: { line: lineNumber, column: match.index },
            initialValue: initialValue || null,
            declarationType: match[0].startsWith('const') ? 'const' : 
                           match[0].startsWith('let') ? 'let' : 'var'
        });
    }

    // Parse exports
    const exportRegex = /export\s+(?:default\s+)?(?:{([^}]+)}|(\w+))/g;
    while ((match = exportRegex.exec(code)) !== null) {
        const lineNumber = code.substring(0, match.index).split('\n').length;
        
        if (match[1]) {
            // Named exports: export { a, b }
            const namedExports = match[1].split(',').map(s => s.trim());
            namedExports.forEach(exportName => {
                const symbol = symbolTable.findSymbol(exportName);
                if (symbol) {
                    symbol.isExported = true;
                    symbol.exportType = 'named';
                }
            });
        } else if (match[2]) {
            // Single export: export something
            const symbol = symbolTable.findSymbol(match[2]);
            if (symbol) {
                symbol.isExported = true;
                symbol.exportType = match[0].includes('default') ? 'default' : 'named';
            }
        }
    }

    return symbolTable;
}

/**
 * Find all references to a specific symbol
 */
function findSymbolReferences(code, symbolName) {
    const references = [];
    const lines = code.split('\n');
    
    // Create regex to find symbol usage (word boundaries to avoid partial matches)
    const symbolRegex = new RegExp(`\\b${symbolName}\\b`, 'g');
    
    lines.forEach((line, lineIndex) => {
        let match;
        while ((match = symbolRegex.exec(line)) !== null) {
            references.push({
                line: lineIndex + 1,
                column: match.index + 1,
                context: line.trim(),
                type: determineReferenceType(line, match.index, symbolName)
            });
        }
        // Reset regex lastIndex for next line
        symbolRegex.lastIndex = 0;
    });

    return references;
}

/**
 * Determine the type of symbol reference (definition, call, assignment, etc.)
 */
function determineReferenceType(line, index, symbolName) {
    const beforeSymbol = line.substring(0, index).trim();
    const afterSymbol = line.substring(index + symbolName.length).trim();

    // Function call
    if (afterSymbol.startsWith('(')) {
        return 'call';
    }

    // Assignment
    if (afterSymbol.startsWith('=') && !afterSymbol.startsWith('==') && !afterSymbol.startsWith('===')) {
        return 'assignment';
    }

    // Declaration
    if (beforeSymbol.match(/(?:const|let|var|function|class)\s*$/)) {
        return 'declaration';
    }

    // Property access
    if (beforeSymbol.endsWith('.') || afterSymbol.startsWith('.')) {
        return 'property';
    }

    // Import/Export
    if (beforeSymbol.includes('import') || beforeSymbol.includes('export')) {
        return 'import_export';
    }

    return 'reference';
}

/**
 * Analyze symbol dependencies
 */
function analyzeSymbolDependencies(symbolTable) {
    const dependencies = new Map();
    const symbols = symbolTable.getAllSymbols();

    symbols.forEach(symbol => {
        const deps = [];
        
        // For imports, the dependency is the source module
        if (symbol.type === 'import') {
            deps.push({
                type: 'module',
                name: symbol.source,
                relationship: 'imports'
            });
        }

        // For classes with inheritance
        if (symbol.type === 'class' && symbol.superClass) {
            const superSymbol = symbolTable.findSymbol(symbol.superClass);
            if (superSymbol) {
                deps.push({
                    type: 'class',
                    name: symbol.superClass,
                    relationship: 'extends'
                });
            }
        }

        dependencies.set(symbol.name, deps);
    });

    return dependencies;
}

/**
 * Generate symbol usage report
 */
function generateSymbolReport(symbolTable, code) {
    const symbols = symbolTable.getAllSymbols();
    const report = {
        totalSymbols: symbols.length,
        byType: {},
        unused: [],
        exported: [],
        imported: [],
        dependencies: analyzeSymbolDependencies(symbolTable)
    };

    // Group by type
    symbols.forEach(symbol => {
        if (!report.byType[symbol.type]) {
            report.byType[symbol.type] = 0;
        }
        report.byType[symbol.type]++;

        // Check if exported
        if (symbol.isExported) {
            report.exported.push(symbol.name);
        }

        // Check if imported
        if (symbol.type === 'import') {
            report.imported.push({
                name: symbol.name,
                source: symbol.source,
                type: symbol.importType
            });
        }

        // Check if unused (simple heuristic)
        const references = findSymbolReferences(code, symbol.name);
        if (references.length <= 1) { // Only declaration, no usage
            report.unused.push(symbol.name);
        }
    });

    return report;
}

// Message handler
self.addEventListener('message', async (event) => {
    const { jobId, data, type } = event.data;
    
    try {
        let result;
        
        switch (data.action) {
            case 'resolve':
                const symbolTable = resolveSymbols(data.code, data.filename);
                if (data.symbolName) {
                    // Find specific symbol
                    const symbol = symbolTable.findSymbol(data.symbolName);
                    const references = findSymbolReferences(data.code, data.symbolName);
                    result = {
                        symbol,
                        references,
                        found: !!symbol
                    };
                } else {
                    // Return all symbols
                    result = {
                        symbols: symbolTable.getAllSymbols(),
                        report: generateSymbolReport(symbolTable, data.code)
                    };
                }
                break;
                
            case 'references':
                result = findSymbolReferences(data.code, data.symbolName);
                break;
                
            case 'dependencies':
                const depSymbolTable = resolveSymbols(data.code, data.filename);
                result = analyzeSymbolDependencies(depSymbolTable);
                break;
                
            case 'report':
                const reportSymbolTable = resolveSymbols(data.code, data.filename);
                result = generateSymbolReport(reportSymbolTable, data.code);
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