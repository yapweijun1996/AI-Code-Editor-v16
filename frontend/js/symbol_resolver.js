/**
 * Symbol Resolution Engine
 * Advanced symbol tracking and resolution system for senior engineer-level code analysis
 */

// Dynamic imports for browser compatibility - will be loaded when needed
let acorn, walk;

async function loadDependencies() {
    if (!acorn || !walk) {
        acorn = await import('https://cdn.skypack.dev/acorn@8.11.3');
        walk = await import('https://cdn.skypack.dev/acorn-walk@8.3.2');
    }
}

export class SymbolResolver {
    constructor() {
        this.symbolTables = new Map(); // filePath -> SymbolTable
        this.globalSymbolIndex = new Map(); // symbolName -> [locations]
        this.importGraph = new Map(); // filePath -> { imports: [], exports: [] }
        this.scopeChains = new Map(); // filePath -> scope hierarchy
        this.typeInference = new Map(); // symbol -> inferred type info
    }

    /**
     * Build comprehensive symbol table for a file
     */
    async buildSymbolTable(fileContent, filePath) {
        try {
            // Load dependencies first
            await loadDependencies();
            
            const ast = acorn.parse(fileContent, {
                ecmaVersion: 'latest',
                sourceType: 'module',
                locations: true,
                ranges: true,
                allowHashBang: true,
                allowReturnOutsideFunction: true
            });

            const symbolTable = {
                filePath,
                symbols: new Map(),
                scopes: [],
                imports: [],
                exports: [],
                functions: [],
                classes: [],
                variables: [],
                ast: ast
            };

            // Build scope hierarchy
            await this.buildScopeHierarchy(ast, symbolTable);
            
            // Extract all symbols
            await this.extractSymbols(ast, symbolTable);
            
            // Analyze imports/exports
            await this.analyzeImportsExports(ast, symbolTable);
            
            // Store in cache
            this.symbolTables.set(filePath, symbolTable);
            
            // Update global index
            this.updateGlobalIndex(symbolTable);
            
            console.log(`[SymbolResolver] Built symbol table for ${filePath}: ${symbolTable.symbols.size} symbols`);
            return symbolTable;
            
        } catch (error) {
            console.error(`[SymbolResolver] Failed to parse ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Build scope hierarchy for proper variable resolution
     */
    buildScopeHierarchy(ast, symbolTable) {
        const scopes = [];
        let currentScope = null;

        const createScope = (node, type) => {
            const scope = {
                id: `scope_${scopes.length}`,
                type, // 'global', 'function', 'block', 'class', 'module'
                node,
                parent: currentScope,
                children: [],
                symbols: new Map(),
                start: node.start,
                end: node.end,
                line: node.loc ? node.loc.start.line : 0
            };
            
            if (currentScope) {
                currentScope.children.push(scope);
            }
            
            scopes.push(scope);
            return scope;
        };

        // Global scope
        currentScope = createScope(ast, 'global');

        walk.ancestor(ast, {
            Function(node, ancestors) {
                const prevScope = currentScope;
                currentScope = createScope(node, 'function');
                
                // Add function parameters to scope
                if (node.params) {
                    node.params.forEach(param => {
                        this.addParameterToScope(param, currentScope);
                    });
                }
            },
            
            BlockStatement(node, ancestors) {
                // Only create block scope for certain contexts
                const parent = ancestors[ancestors.length - 2];
                if (parent && (parent.type === 'IfStatement' || 
                              parent.type === 'ForStatement' || 
                              parent.type === 'WhileStatement' ||
                              parent.type === 'DoWhileStatement' ||
                              parent.type === 'TryStatement' ||
                              parent.type === 'CatchClause')) {
                    const prevScope = currentScope;
                    currentScope = createScope(node, 'block');
                }
            },
            
            ClassDeclaration(node, ancestors) {
                const prevScope = currentScope;
                currentScope = createScope(node, 'class');
                
                // Add class name to parent scope
                if (node.id) {
                    this.addSymbolToScope(node.id.name, 'class', node, prevScope);
                }
            },
            
            VariableDeclaration(node, ancestors) {
                node.declarations.forEach(decl => {
                    if (decl.id && decl.id.type === 'Identifier') {
                        this.addSymbolToScope(decl.id.name, 'variable', decl, currentScope);
                    }
                });
            },
            
            FunctionDeclaration(node, ancestors) {
                if (node.id) {
                    // Add function name to parent scope
                    const parentScope = currentScope.parent || currentScope;
                    this.addSymbolToScope(node.id.name, 'function', node, parentScope);
                }
            }
        }, {
            // Handle scope exit
            Function: {
                exit(node, ancestors) {
                    if (currentScope && currentScope.type === 'function') {
                        currentScope = currentScope.parent;
                    }
                }
            },
            BlockStatement: {
                exit(node, ancestors) {
                    if (currentScope && currentScope.type === 'block' && currentScope.node === node) {
                        currentScope = currentScope.parent;
                    }
                }
            },
            ClassDeclaration: {
                exit(node, ancestors) {
                    if (currentScope && currentScope.type === 'class') {
                        currentScope = currentScope.parent;
                    }
                }
            }
        });

        symbolTable.scopes = scopes;
        this.scopeChains.set(symbolTable.filePath, scopes);
    }

    /**
     * Add parameter to function scope
     */
    addParameterToScope(param, scope) {
        if (param.type === 'Identifier') {
            this.addSymbolToScope(param.name, 'parameter', param, scope);
        } else if (param.type === 'ObjectPattern') {
            // Handle destructuring parameters
            param.properties.forEach(prop => {
                if (prop.type === 'Property' && prop.value.type === 'Identifier') {
                    this.addSymbolToScope(prop.value.name, 'parameter', prop.value, scope);
                }
            });
        } else if (param.type === 'ArrayPattern') {
            // Handle array destructuring parameters
            param.elements.forEach(element => {
                if (element && element.type === 'Identifier') {
                    this.addSymbolToScope(element.name, 'parameter', element, scope);
                }
            });
        }
    }

    /**
     * Add symbol to scope
     */
    addSymbolToScope(name, type, node, scope) {
        if (!scope.symbols.has(name)) {
            scope.symbols.set(name, []);
        }
        
        scope.symbols.get(name).push({
            name,
            type,
            node,
            line: node.loc ? node.loc.start.line : 0,
            column: node.loc ? node.loc.start.column : 0,
            scope: scope.id
        });
    }

    /**
     * Extract all symbols from AST
     */
    async extractSymbols(ast, symbolTable) {
        await loadDependencies();
        walk.simple(ast, {
            Identifier(node) {
                const symbol = {
                    name: node.name,
                    type: 'identifier',
                    line: node.loc ? node.loc.start.line : 0,
                    column: node.loc ? node.loc.start.column : 0,
                    start: node.start,
                    end: node.end,
                    node: node
                };
                
                if (!symbolTable.symbols.has(node.name)) {
                    symbolTable.symbols.set(node.name, []);
                }
                symbolTable.symbols.get(node.name).push(symbol);
            },
            
            VariableDeclarator(node) {
                if (node.id && node.id.type === 'Identifier') {
                    symbolTable.variables.push({
                        name: node.id.name,
                        type: 'variable',
                        line: node.loc ? node.loc.start.line : 0,
                        node: node,
                        init: node.init
                    });
                }
            },
            
            FunctionDeclaration(node) {
                if (node.id) {
                    symbolTable.functions.push({
                        name: node.id.name,
                        type: 'function',
                        line: node.loc ? node.loc.start.line : 0,
                        node: node,
                        params: node.params,
                        async: node.async,
                        generator: node.generator
                    });
                }
            },
            
            ClassDeclaration(node) {
                if (node.id) {
                    symbolTable.classes.push({
                        name: node.id.name,
                        type: 'class',
                        line: node.loc ? node.loc.start.line : 0,
                        node: node,
                        superClass: node.superClass,
                        methods: []
                    });
                }
            },
            
            MethodDefinition(node) {
                if (node.key && node.key.type === 'Identifier') {
                    // Find parent class
                    const parentClass = symbolTable.classes[symbolTable.classes.length - 1];
                    if (parentClass) {
                        parentClass.methods.push({
                            name: node.key.name,
                            type: 'method',
                            kind: node.kind, // 'method', 'constructor', 'get', 'set'
                            static: node.static,
                            line: node.loc ? node.loc.start.line : 0,
                            node: node
                        });
                    }
                }
            }
        });
    }

    /**
     * Analyze imports and exports
     */
    async analyzeImportsExports(ast, symbolTable) {
        await loadDependencies();
        walk.simple(ast, {
            ImportDeclaration(node) {
                const importInfo = {
                    source: node.source.value,
                    specifiers: [],
                    line: node.loc ? node.loc.start.line : 0,
                    node: node
                };
                
                node.specifiers.forEach(spec => {
                    if (spec.type === 'ImportDefaultSpecifier') {
                        importInfo.specifiers.push({
                            type: 'default',
                            local: spec.local.name,
                            imported: 'default'
                        });
                    } else if (spec.type === 'ImportSpecifier') {
                        importInfo.specifiers.push({
                            type: 'named',
                            local: spec.local.name,
                            imported: spec.imported.name
                        });
                    } else if (spec.type === 'ImportNamespaceSpecifier') {
                        importInfo.specifiers.push({
                            type: 'namespace',
                            local: spec.local.name,
                            imported: '*'
                        });
                    }
                });
                
                symbolTable.imports.push(importInfo);
            },
            
            ExportNamedDeclaration(node) {
                const exportInfo = {
                    type: 'named',
                    specifiers: [],
                    declaration: node.declaration,
                    source: node.source ? node.source.value : null,
                    line: node.loc ? node.loc.start.line : 0,
                    node: node
                };
                
                if (node.specifiers) {
                    node.specifiers.forEach(spec => {
                        exportInfo.specifiers.push({
                            local: spec.local.name,
                            exported: spec.exported.name
                        });
                    });
                }
                
                symbolTable.exports.push(exportInfo);
            },
            
            ExportDefaultDeclaration(node) {
                symbolTable.exports.push({
                    type: 'default',
                    declaration: node.declaration,
                    line: node.loc ? node.loc.start.line : 0,
                    node: node
                });
            },
            
            ExportAllDeclaration(node) {
                symbolTable.exports.push({
                    type: 'all',
                    source: node.source.value,
                    line: node.loc ? node.loc.start.line : 0,
                    node: node
                });
            }
        });
    }

    /**
     * Update global symbol index
     */
    updateGlobalIndex(symbolTable) {
        for (const [symbolName, occurrences] of symbolTable.symbols) {
            if (!this.globalSymbolIndex.has(symbolName)) {
                this.globalSymbolIndex.set(symbolName, []);
            }
            
            occurrences.forEach(occurrence => {
                this.globalSymbolIndex.get(symbolName).push({
                    filePath: symbolTable.filePath,
                    ...occurrence
                });
            });
        }
    }

    /**
     * Resolve variable in specific scope and line
     */
    resolveVariableInScope(variableName, filePath, line) {
        const symbolTable = this.symbolTables.get(filePath);
        if (!symbolTable) return null;

        const scopes = this.scopeChains.get(filePath);
        if (!scopes) return null;

        // Find the most specific scope containing the line
        let targetScope = null;
        for (const scope of scopes) {
            if (scope.start <= line && line <= scope.end) {
                if (!targetScope || (scope.start >= targetScope.start && scope.end <= targetScope.end)) {
                    targetScope = scope;
                }
            }
        }

        // Walk up the scope chain to find the variable
        let currentScope = targetScope;
        while (currentScope) {
            if (currentScope.symbols.has(variableName)) {
                const symbols = currentScope.symbols.get(variableName);
                // Return the most recent declaration before the current line
                const validSymbols = symbols.filter(s => s.line <= line);
                if (validSymbols.length > 0) {
                    return validSymbols[validSymbols.length - 1];
                }
            }
            currentScope = currentScope.parent;
        }

        return null;
    }

    /**
     * Cross-file symbol resolution
     */
    async resolveImports(symbolTable, projectStructure) {
        const importGraph = {
            imports: [],
            exports: [],
            dependencies: new Set(),
            dependents: new Set()
        };

        for (const importInfo of symbolTable.imports) {
            const resolvedPath = await this.resolveImportPath(importInfo.source, symbolTable.filePath, projectStructure);
            if (resolvedPath) {
                importGraph.dependencies.add(resolvedPath);
                
                // Get or build symbol table for imported file
                let importedSymbolTable = this.symbolTables.get(resolvedPath);
                if (!importedSymbolTable && projectStructure) {
                    // Try to build symbol table for imported file
                    const fileContent = await this.getFileContent(resolvedPath, projectStructure);
                    if (fileContent) {
                        importedSymbolTable = await this.buildSymbolTable(fileContent, resolvedPath);
                    }
                }

                if (importedSymbolTable) {
                    importGraph.imports.push({
                        ...importInfo,
                        resolvedPath,
                        availableExports: importedSymbolTable.exports
                    });
                }
            }
        }

        this.importGraph.set(symbolTable.filePath, importGraph);
        return importGraph;
    }

    /**
     * Resolve import path to actual file path
     */
    async resolveImportPath(importPath, currentFilePath, projectStructure) {
        // Handle relative imports
        if (importPath.startsWith('./') || importPath.startsWith('../')) {
            const currentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
            let resolvedPath = this.resolvePath(currentDir, importPath);
            
            // Try different extensions
            const extensions = ['', '.js', '.ts', '.jsx', '.tsx', '/index.js', '/index.ts'];
            for (const ext of extensions) {
                const testPath = resolvedPath + ext;
                if (await this.fileExists(testPath, projectStructure)) {
                    return testPath;
                }
            }
        }
        
        // Handle absolute imports (node_modules, etc.)
        // This would need more sophisticated resolution logic
        return null;
    }

    /**
     * Helper to resolve relative paths
     */
    resolvePath(basePath, relativePath) {
        const parts = basePath.split('/').filter(p => p);
        const relativeParts = relativePath.split('/').filter(p => p);
        
        for (const part of relativeParts) {
            if (part === '..') {
                parts.pop();
            } else if (part !== '.') {
                parts.push(part);
            }
        }
        
        return parts.join('/');
    }

    /**
     * Check if file exists in project structure
     */
    async fileExists(filePath, projectStructure) {
        // This would integrate with the actual file system
        // For now, return true as placeholder
        return true;
    }

    /**
     * Get file content from project structure
     */
    async getFileContent(filePath, projectStructure) {
        // This would integrate with the actual file system
        // For now, return null as placeholder
        return null;
    }

    /**
     * Find all references to a symbol across the project
     */
    findSymbolReferences(symbolName, filePath = null) {
        if (filePath) {
            const symbolTable = this.symbolTables.get(filePath);
            return symbolTable ? symbolTable.symbols.get(symbolName) || [] : [];
        }
        
        return this.globalSymbolIndex.get(symbolName) || [];
    }

    /**
     * Get symbol definition location
     */
    getSymbolDefinition(symbolName, filePath, line) {
        const resolved = this.resolveVariableInScope(symbolName, filePath, line);
        if (resolved) {
            return {
                filePath,
                line: resolved.line,
                column: resolved.column,
                type: resolved.type,
                node: resolved.node
            };
        }
        
        // Check imports
        const symbolTable = this.symbolTables.get(filePath);
        if (symbolTable) {
            for (const importInfo of symbolTable.imports) {
                const spec = importInfo.specifiers.find(s => s.local === symbolName);
                if (spec) {
                    return {
                        filePath: importInfo.resolvedPath || importInfo.source,
                        imported: spec.imported,
                        type: 'import'
                    };
                }
            }
        }
        
        return null;
    }

    /**
     * Get comprehensive symbol information
     */
    getSymbolInfo(symbolName, filePath, line) {
        const definition = this.getSymbolDefinition(symbolName, filePath, line);
        const references = this.findSymbolReferences(symbolName, filePath);
        const scope = this.resolveVariableInScope(symbolName, filePath, line);
        
        return {
            name: symbolName,
            definition,
            references,
            scope,
            type: definition ? definition.type : 'unknown',
            usageCount: references.length
        };
    }

    /**
     * Clear cache for a file (useful when file is modified)
     */
    clearFileCache(filePath) {
        this.symbolTables.delete(filePath);
        this.scopeChains.delete(filePath);
        this.importGraph.delete(filePath);
        
        // Remove from global index
        for (const [symbolName, locations] of this.globalSymbolIndex) {
            const filtered = locations.filter(loc => loc.filePath !== filePath);
            if (filtered.length === 0) {
                this.globalSymbolIndex.delete(symbolName);
            } else {
                this.globalSymbolIndex.set(symbolName, filtered);
            }
        }
    }

    /**
     * Get statistics about symbol resolution
     */
    getStatistics() {
        return {
            filesAnalyzed: this.symbolTables.size,
            totalSymbols: Array.from(this.globalSymbolIndex.values()).reduce((sum, refs) => sum + refs.length, 0),
            uniqueSymbols: this.globalSymbolIndex.size,
            importRelationships: this.importGraph.size
        };
    }
}

// Export singleton instance
export const symbolResolver = new SymbolResolver();