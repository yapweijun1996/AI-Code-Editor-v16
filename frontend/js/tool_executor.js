import { DbManager } from './db.js';
import * as Editor from './editor.js';
import * as UI from './ui.js';
import { toolLogger } from './tool_logger.js';
import { performanceOptimizer } from './performance_optimizer.js';
import { ToolRegistry } from './tool_registry.js';
import { taskManager } from './task_manager.js';

// Smart debugging and optimization state
const debuggingState = {
    recentErrors: new Map(), // Track recent errors for pattern detection
    toolPerformance: new Map(), // Track tool execution times
    contextCache: new Map(), // Cache frequently accessed contexts
};

// --- Smart Debugging and Optimization Functions ---

// Lightweight arg normalizer to auto-correct common LLM parameter mistakes
// Maps variants like { path } -> { filename }, etc., based on tool name and schema
function _normalizeParameters(toolName, rawParams = {}, toolDef = null) {
    try {
        const params = { ...(rawParams || {}) };
        const name = String(toolName || '').toLowerCase();

        // Generic filename/path normalization
        const ensureFilename = () => {
            if (params.filename) return;
            if (typeof params.path === 'string' && params.path.trim()) {
                params.filename = params.path.trim();
                delete params.path;
            } else if (typeof params.file === 'string' && params.file.trim()) {
                params.filename = params.file.trim();
                delete params.file;
            }
        };

        // Generic folder path normalization
        const ensureFolderPath = (targetKey = 'folder_path') => {
            if (params[targetKey]) return;
            if (typeof params.path === 'string' && params.path.trim()) {
                params[targetKey] = params.path.trim();
                delete params.path;
            } else if (typeof params.dir === 'string' && params.dir.trim()) {
                params[targetKey] = params.dir.trim();
                delete params.dir;
            }
        };

        // Normalize arrays of filenames
        const ensureFilenamesArray = () => {
            if (Array.isArray(params.filenames)) return;
            if (Array.isArray(params.files)) {
                params.filenames = params.files;
                delete params.files;
            } else if (Array.isArray(params.paths)) {
                params.filenames = params.paths;
                delete params.paths;
            } else if (typeof params.filename === 'string' && params.filename.includes(',')) {
                params.filenames = params.filename.split(',').map(s => s.trim()).filter(Boolean);
                delete params.filename;
            }
        };

        // Line numbers normalization
        const ensureLineNumbers = () => {
            if (params.start_line === undefined && (params.start !== undefined)) {
                params.start_line = Number(params.start);
                delete params.start;
            }
            if (params.end_line === undefined && (params.end !== undefined)) {
                params.end_line = Number(params.end);
                delete params.end;
            }
        };

        // Rename pairs
        const ensureRenamePairs = () => {
            if (!params.old_path && typeof params.from === 'string') {
                params.old_path = params.from;
                delete params.from;
            }
            if (!params.new_path && typeof params.to === 'string') {
                params.new_path = params.to;
                delete params.to;
            }
        };

        // Tool-specific mappings
        if (name === 'read_file') {
            ensureFilename();
            // default include_line_numbers to false if provided as string
            if (typeof params.include_line_numbers === 'string') {
                params.include_line_numbers = params.include_line_numbers.toLowerCase() === 'true';
            }
        } else if (name === 'read_file_lines') {
            ensureFilename();
            ensureLineNumbers();
        } else if (name === 'search_in_file') {
            ensureFilename();
            if (!params.pattern && typeof params.query === 'string') {
                params.pattern = params.query;
                delete params.query;
            }
            if (typeof params.context === 'string') {
                const n = Number(params.context);
                if (Number.isFinite(n)) params.context = n;
            }
        } else if (name === 'read_multiple_files') {
            ensureFilenamesArray();
        } else if (name === 'create_file') {
            ensureFilename();
            // Allow "text" or "data" as content synonyms
            if (params.content === undefined && typeof params.text === 'string') {
                params.content = params.text;
                delete params.text;
            } else if (params.content === undefined && typeof params.data === 'string') {
                params.content = params.data;
                delete params.data;
            }
        } else if (name === 'delete_file' || name === 'get_file_info' || name === 'append_to_file') {
            ensureFilename();
        } else if (name === 'rename_file') {
            ensureRenamePairs();
        } else if (name === 'create_folder' || name === 'delete_folder') {
            ensureFolderPath('folder_path');
        } else if (name === 'rename_folder') {
            if (!params.old_folder_path && typeof params.from === 'string') {
                params.old_folder_path = params.from;
                delete params.from;
            }
            if (!params.new_folder_path && typeof params.to === 'string') {
                params.new_folder_path = params.to;
                delete params.to;
            }
        } else if (name === 'perform_research') {
            // If 'queries' is provided but 'query' is missing, use the first query from the array.
            if (!params.query && Array.isArray(params.queries) && params.queries.length > 0) {
                params.query = params.queries[0];
            }
        }

        // Schema-informed fallback: if toolDef has parameters with required keys missing,
        // attempt to map similarly named keys by Levenshtein-like simple heuristics.
        if (toolDef && toolDef.parameters && toolDef.parameters.required) {
            const required = Array.isArray(toolDef.parameters.required) ? toolDef.parameters.required : [];
            for (const reqKey of required) {
                if (params[reqKey] !== undefined) continue;
                // Try common alias map
                const aliasMap = {
                    filename: ['path', 'file', 'filepath', 'file_path'],
                    old_path: ['from', 'src', 'source'],
                    new_path: ['to', 'dst', 'dest', 'destination'],
                    folder_path: ['path', 'dir', 'directory'],
                    start_line: ['start', 'from_line'],
                    end_line: ['end', 'to_line']
                };
                const aliases = aliasMap[reqKey] || [];
                for (const a of aliases) {
                    if (params[a] !== undefined) {
                        params[reqKey] = params[a];
                        delete params[a];
                        break;
                    }
                }
            }
        }

        return params;
    } catch (_) {
        // On any failure, return raw params to avoid breaking execution
        return rawParams || {};
    }
}

function trackToolPerformance(toolName, startTime, endTime, success, context = {}) {
    const duration = endTime - startTime;
    const key = `${toolName}_${context.fileType || 'unknown'}`;
    
    if (!debuggingState.toolPerformance.has(key)) {
        debuggingState.toolPerformance.set(key, {
            totalCalls: 0,
            totalTime: 0,
            successCount: 0,
            failureCount: 0,
            averageTime: 0,
            lastUsed: Date.now()
        });
    }
    
    const metrics = debuggingState.toolPerformance.get(key);
    metrics.totalCalls++;
    metrics.totalTime += duration;
    metrics.averageTime = metrics.totalTime / metrics.totalCalls;
    metrics.lastUsed = Date.now();
    
    if (success) {
        metrics.successCount++;
    } else {
        metrics.failureCount++;
    }
    
    if (duration > 5000) {
        console.warn(`[Performance] Tool ${toolName} took ${duration}ms to execute`);
    }
}

function getOptimalTool(intent, context = {}) {
    const { fileType, fileSize, mode } = context;
    
    if (mode === 'amend') {
        if (intent === 'edit_file') {
            return {
                recommendedTool: 'apply_diff',
                reason: 'apply_diff is safer and more precise for amend mode',
                alternatives: ['edit_file']
            };
        }
        
        if (intent === 'search') {
            return {
                recommendedTool: 'search_in_file',
                reason: 'More targeted search for amend mode',
                alternatives: ['search_code']
            };
        }
    }
    
    if (intent === 'edit_file' && fileSize) {
        if (fileSize > 500000) {
            return {
                recommendedTool: 'edit_file',
                reason: 'Use edits array for large files',
                parameters: { preferEditsArray: true },
                alternatives: ['apply_diff']
            };
        }
    }
    
    const performanceKey = `${intent}_${fileType || 'unknown'}`;
    const metrics = debuggingState.toolPerformance.get(performanceKey);
    
    if (metrics && metrics.failureCount > metrics.successCount) {
        console.warn(`[Smart Selection] Tool ${intent} has high failure rate for ${fileType} files`);
    }
    
    return null;
}

function analyzeError(toolName, error, context = {}) {
    const errorSignature = `${toolName}:${error.message.substring(0, 100)}`;
    
    if (!debuggingState.recentErrors.has(errorSignature)) {
        debuggingState.recentErrors.set(errorSignature, {
            count: 0,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            contexts: []
        });
    }
    
    const errorInfo = debuggingState.recentErrors.get(errorSignature);
    errorInfo.count++;
    errorInfo.lastSeen = Date.now();
    errorInfo.contexts.push(context);
    
    if (errorInfo.count >= 3) {
        console.warn(`[Error Pattern] Recurring error detected: ${errorSignature}`);
        return getSuggestedFix(toolName, error, errorInfo);
    }
    
    return null;
}

function getSuggestedFix(toolName, error, errorInfo) {
    const errorMessage = error.message.toLowerCase();
    
    if (toolName === 'apply_diff') {
        if (errorMessage.includes('no valid diff blocks found')) {
            return {
                suggestion: 'The diff format is incorrect. Use read_file with include_line_numbers=true first, then format the diff exactly as: <<<<<<< SEARCH\\n:start_line:N\\n-------\\nexact content\\n=======\\nnew content\\n>>>>>>> REPLACE',
                alternativeTool: 'read_file',
                confidence: 0.95
            };
        }
        if (errorMessage.includes('search content does not match')) {
            return {
                suggestion: 'The search content must match exactly. Use read_file with include_line_numbers=true to get the exact current content, then copy it precisely into the SEARCH block',
                alternativeTool: 'read_file',
                confidence: 0.95
            };
        }
    }
    
    if (errorMessage.includes('not found') || errorMessage.includes('notfounderror')) {
        return {
            suggestion: 'Use get_project_structure first to verify file paths',
            alternativeTool: 'get_project_structure',
            confidence: 0.9
        };
    }
    
    if (errorMessage.includes('permission') || errorMessage.includes('denied') ||
        errorMessage.includes('user activation is required')) {
        return {
            suggestion: 'File system permission issue. This can happen when the AI tries to access files without user interaction. The system will attempt to handle permissions automatically during file operations. If this persists, try manually clicking in the editor or file tree first.',
            alternativeTool: 'read_file',
            confidence: 0.9
        };
    }
    
    if (toolName.includes('edit') && errorMessage.includes('syntax')) {
        return {
            suggestion: 'Use apply_diff for more precise editing to avoid syntax errors',
            alternativeTool: 'apply_diff',
            confidence: 0.85
        };
    }
    
    if (errorMessage.includes('line') && errorMessage.includes('invalid')) {
        return {
            suggestion: 'Use read_file with line numbers first to get accurate line references',
            alternativeTool: 'read_file',
            confidence: 0.9
        };
    }
    
    return null;
}

function getCachedResult(toolName, parameters) {
    const cacheKey = `${toolName}:${JSON.stringify(parameters)}`;
    const cached = debuggingState.contextCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 30000) {
        console.log(`[Cache Hit] Using cached result for ${toolName}`);
        return cached.result;
    }
    
    return null;
}

function setCachedResult(toolName, parameters, result) {
    const cacheKey = `${toolName}:${JSON.stringify(parameters)}`;
    debuggingState.contextCache.set(cacheKey, {
        result,
        timestamp: Date.now()
    });
    
    if (debuggingState.contextCache.size > 100) {
        const oldestKey = Array.from(debuggingState.contextCache.keys())[0];
        debuggingState.contextCache.delete(oldestKey);
    }
    
    /**
     * Infer artifacts and summary from an arbitrary tool result.
     * Returns { summary?: string, artifacts: Array<{kind,name,url,title}> }
     */
    function _inferArtifactsAndSummary(toolName, result) {
        const artifacts = [];
        let summary = null;
    
        const pushFile = (name, title) => {
            if (typeof name === 'string' && name.trim()) {
                artifacts.push({ kind: 'file', name: name.trim(), title });
            }
        };
        const pushUrl = (url, title) => {
            if (typeof url === 'string' && url.trim()) {
                artifacts.push({ kind: 'url', url: url.trim(), title });
            }
        };
        const pushNamed = (name, title) => {
            if (typeof name === 'string' && name.trim()) {
                artifacts.push({ kind: 'named_resource', name: name.trim(), title });
            }
        };
    
        try {
            // Common shapes
            if (result && typeof result === 'object') {
                // Direct filename
                if (typeof result.filename === 'string') pushFile(result.filename, result.title);
                // Direct url
                if (typeof result.url === 'string') pushUrl(result.url, result.title);
                // Named resource
                if (typeof result.name === 'string') pushNamed(result.name, result.title);
    
                // Arrays of links/files
                if (Array.isArray(result.links)) {
                    for (const L of result.links) {
                        if (typeof L === 'string') pushUrl(L);
                        else if (L && typeof L.url === 'string') pushUrl(L.url, L.title || L.text);
                    }
                }
                if (Array.isArray(result.urls)) {
                    for (const u of result.urls) {
                        if (typeof u === 'string') pushUrl(u);
                        else if (u && typeof u.url === 'string') pushUrl(u.url, u.title);
                    }
                }
                if (Array.isArray(result.files)) {
                    for (const f of result.files) {
                        if (typeof f === 'string') pushFile(f);
                        else if (f && typeof f.filename === 'string') pushFile(f.filename, f.title);
                        else if (f && typeof f.name === 'string') pushFile(f.name, f.title);
                    }
                }
                if (Array.isArray(result.artifacts)) {
                    for (const a of result.artifacts) {
                        if (a && typeof a === 'object') {
                            const kind = a.kind || (a.url ? 'url' : (a.name ? 'file' : 'named_resource'));
                            if (kind === 'url' && a.url) pushUrl(a.url, a.title);
                            else if ((kind === 'file' || kind === 'named_resource') && a.name) artifacts.push({ kind, name: a.name, title: a.title });
                        }
                    }
                }
    
                // Summary-like fields
                if (typeof result.summary === 'string' && result.summary.trim()) {
                    summary = result.summary.trim();
                } else if (typeof result.overview === 'string' && result.overview.trim()) {
                    summary = result.overview.trim();
                } else if (typeof result.content === 'string' && result.content.trim()) {
                    // Truncate overly long content for summary field
                    const c = result.content.trim();
                    summary = c.length > 2000 ? c.slice(0, 2000) : c;
                } else if (typeof result.text === 'string' && result.text.trim()) {
                    const c = result.text.trim();
                    summary = c.length > 2000 ? c.slice(0, 2000) : c;
                }
            }
    
            // Light heuristics per tool name
            const name = String(toolName || '').toLowerCase();
            if (!summary && name.includes('research')) {
                // A generic hint: if we saw URLs, produce a micro-summary
                const urlCount = artifacts.filter(a => a.kind === 'url').length;
                if (urlCount > 0) summary = `Collected ${urlCount} research link(s).`;
            }
        } catch (_) {
            // ignore inference errors
        }
    
        // Deduplicate by (kind,url|name)
        const seen = new Set();
        const deduped = [];
        for (const a of artifacts) {
            const key = `${a.kind}:${a.url || a.name || ''}`;
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(a);
            }
        }
    
        return { summary: summary || null, artifacts: deduped };
    }
}

// --- Core Execution Logic ---

async function createAutomaticCheckpoint() {
    try {
        const editorState = Editor.getEditorState();
        if (editorState.openFiles.length > 0) {
            const checkpointData = {
                name: `Auto-Checkpoint @ ${new Date().toLocaleString()}`,
                editorState: editorState,
                timestamp: Date.now(),
            };
            await DbManager.saveCheckpoint(checkpointData);
        }
    } catch (error) {
        if (error.message.includes('Model is disposed')) {
            console.warn('Skipping automatic checkpoint: A file model was disposed during the process.');
        } else {
            console.error('Failed to create automatic checkpoint:', error);
        }
    }
}

async function executeTool(toolCall, rootDirectoryHandle) {
    const { name: toolName, args: rawArgs } = toolCall;

    const tool = ToolRegistry.get(toolName);

    if (!tool) {
        throw new Error(`Unknown tool '${toolName}'.`);
    }

    if (tool.requiresProject && !rootDirectoryHandle) {
        return { error: "No project folder is open. Please ask the user to open a folder before using this tool." };
    }

    if (tool.createsCheckpoint) {
        await createAutomaticCheckpoint();
    }

    // Normalize parameters proactively to fix common LLM argument mistakes
    const normalizedParams = _normalizeParameters(toolName, rawArgs, tool);

    console.debug(`[Tool Start] Executing tool: ${toolName}`, { parameters: normalizedParams });
    const result = await tool.handler(normalizedParams, rootDirectoryHandle);
    console.debug(`[Tool Success] Tool ${toolName} finished.`, { result });
    return result;
}

export async function execute(toolCall, rootDirectoryHandle, silent = false) {
    const toolName = toolCall.name;
    const mode = document.getElementById('agent-mode-selector').value;
    const startTime = performance.now();

    if (mode === 'amend' && toolName === 'rewrite_file') {
        throw new Error("The 'rewrite_file' tool is not allowed in 'Amend' mode. Use 'apply_diff' or 'edit_file' with the 'edits' parameter for targeted changes.");
    }

    // Normalize parameters early so logging, caching, and perf context are all consistent
    const toolDef = ToolRegistry.get(toolName);
    const normalizedArgs = _normalizeParameters(toolName, toolCall.args, toolDef);

    // Update the toolCall passed downstream to ensure consistent params
    const normalizedToolCall = { ...toolCall, args: normalizedArgs };

    if (['read_file', 'get_project_structure', 'search_in_file'].includes(toolName)) {
        const cachedResult = getCachedResult(toolName, normalizedArgs);
        if (cachedResult) {
            return { toolResponse: { name: toolName, response: cachedResult }, success: true };
        }
    }

    const context = {
        mode,
        fileType: normalizedArgs.filename ? normalizedArgs.filename.split('.').pop() : null,
        fileSize: null
    };
    
    const recommendation = getOptimalTool(toolName, context);
    if (recommendation && !silent) {
        console.log(`[Smart Selection] Recommended: ${recommendation.recommendedTool} - ${recommendation.reason}`);
    }

    const groupTitle = `AI Tool Call: ${toolName}`;
    const groupContent = normalizedArgs && Object.keys(normalizedArgs).length > 0 ? normalizedArgs : 'No parameters';
    console.group(groupTitle, groupContent);
    
    let logEntry;
    if (!silent) {
        logEntry = UI.appendToolLog(document.getElementById('chat-messages'), toolName, normalizedArgs);
    }

    let resultForModel;
    let isSuccess = true;

    try {
        performanceOptimizer.startTimer(`tool_${toolName}`);
        resultForModel = await executeTool(normalizedToolCall, rootDirectoryHandle);
        const executionTime = performanceOptimizer.endTimer(`tool_${toolName}`);
        
        trackToolPerformance(toolName, startTime, performance.now(), true, context);
        
        if (['read_file', 'get_project_structure', 'search_in_file'].includes(toolName)) {
            setCachedResult(toolName, normalizedArgs, resultForModel);
        }
        
        toolLogger.log(toolName, normalizedArgs, 'Success', resultForModel);
        
        // Persist standardized artifacts/summary into the active task context so subsequent subtasks can reuse them.
        try {
            // Only record when there's meaningful content to share
            const inferred = _inferArtifactsAndSummary(toolName, resultForModel);
            const hasMeaningful =
                (inferred.summary && inferred.summary.length > 0) ||
                (Array.isArray(inferred.artifacts) && inferred.artifacts.length > 0);

            // Avoid spamming context for purely read operations unless they yield named outputs
            const isPureRead = ['read_file', 'read_file_lines', 'search_in_file', 'get_project_structure'].includes(toolName);

            if (hasMeaningful && (!isPureRead || inferred.artifacts.length > 0)) {
                await taskManager.recordToolResult('active', {
                    toolName,
                    args: normalizedArgs,
                    summary: inferred.summary || undefined,
                    artifacts: inferred.artifacts || [],
                    rawResult: resultForModel
                });
            }
        } catch (persistErr) {
            console.warn('[ToolExecutor] Failed to persist tool result to task context:', persistErr?.message || persistErr);
        }

        if (executionTime > 2000) {
            console.warn(`[Performance] Tool ${toolName} took ${executionTime}ms - consider optimization`);
        }
        
    } catch (error) {
        isSuccess = false;
        const endTime = performance.now();
        
        trackToolPerformance(toolName, startTime, endTime, false, context);

        // Attempt to salvage and persist any partial results from the failed tool call
        let partialSaved = false;
        try {
            const candidates = [];
            if (error && typeof error === 'object') {
                if (error.partialResult) candidates.push(error.partialResult);
                if (error.partial) candidates.push(error.partial);
                if (error.result) candidates.push(error.result);
                if (error.data && error.data.partialResult) candidates.push(error.data.partialResult);

                // If the error object itself resembles a result shape, treat selected fields as a candidate
                const looksLikeResult =
                    Array.isArray(error.links) ||
                    Array.isArray(error.urls) ||
                    Array.isArray(error.files) ||
                    typeof error.filename === 'string' ||
                    typeof error.url === 'string' ||
                    typeof error.name === 'string';
                if (looksLikeResult) {
                    candidates.push({
                        links: error.links,
                        urls: error.urls,
                        files: error.files,
                        filename: error.filename,
                        url: error.url,
                        name: error.name,
                        summary: typeof error.summary === 'string' ? error.summary : undefined
                    });
                }
            }

            for (const candidate of candidates) {
                if (!candidate) continue;
                const inferred = _inferArtifactsAndSummary(toolName, candidate);
                const hasMeaningful =
                    (inferred.summary && inferred.summary.length > 0) ||
                    (Array.isArray(inferred.artifacts) && inferred.artifacts.length > 0);

                // Avoid spamming context for purely read operations unless they yield named outputs
                const isPureRead = ['read_file', 'read_file_lines', 'search_in_file', 'get_project_structure'].includes(toolName);

                if (hasMeaningful && (!isPureRead || (inferred.artifacts && inferred.artifacts.length > 0))) {
                    await taskManager.recordToolResult('active', {
                        toolName,
                        args: normalizedArgs,
                        summary: inferred.summary ? `[Partial] ${inferred.summary}` : undefined,
                        artifacts: inferred.artifacts || [],
                        rawResult: { partial: candidate, error: String(error?.message || error) }
                    });
                    partialSaved = true;
                    console.warn(`[ToolExecutor] Saved partial results for failed tool '${toolName}'.`);
                    break; // save the first meaningful partial
                }
            }
        } catch (persistErr) {
            console.warn('[ToolExecutor] Failed to persist partial results from error:', persistErr?.message || persistErr);
        }
        
        const errorAnalysis = analyzeError(toolName, error, context);
        let errorMessage = `Error executing tool '${toolName}': ${error.message}`;
        
        if (errorAnalysis && errorAnalysis.suggestion) {
            errorMessage += `\n\nSuggestion: ${errorAnalysis.suggestion}`;
            if (errorAnalysis.alternativeTool) {
                errorMessage += `\nConsider using: ${errorAnalysis.alternativeTool}`;
            }
        }

        if (partialSaved) {
            errorMessage += `\n\nNote: Partial results were saved to the task context and can be reused by subsequent steps.`;
        }
        
        resultForModel = { error: errorMessage };
        UI.showError(errorMessage);
        console.debug(`[Tool Error] Tool ${toolName} failed.`, { error: errorMessage, details: error });
        console.error(errorMessage, error);
        toolLogger.log(toolName, normalizedArgs, 'Error', {
            message: error.message,
            stack: error.stack,
            suggestion: errorAnalysis?.suggestion,
            alternativeTool: errorAnalysis?.alternativeTool
        });
    }

    const resultForLog = isSuccess ? { status: 'Success', ...resultForModel } : { status: 'Error', message: resultForModel.error };
    console.log('Result:', resultForLog);
    console.groupEnd();
    
    if (!silent) {
        UI.updateToolLog(logEntry, isSuccess);
    }
    
    // Return standardized shape with explicit success flag to allow callers to halt pipelines on failure
    return { toolResponse: { name: toolName, response: resultForModel }, success: isSuccess };
}

export function getToolDefinitions() {
    const declarations = [];
    const tools = ToolRegistry.getAll();
    for (const [name, tool] of Object.entries(tools)) {
        const declaration = {
            name: name,
            description: tool.description,
        };
        if (tool.parameters) {
            const properties = {};
            const required = [];
            for (const [paramName, paramDetails] of Object.entries(tool.parameters)) {
                properties[paramName] = {
                    type: paramDetails.type.toUpperCase(),
                    description: paramDetails.description
                };
                if (paramDetails.enum) {
                    properties[paramName].enum = paramDetails.enum;
                }
                if (paramDetails.items) {
                    properties[paramName].items = paramDetails.items;
                }
                if (paramDetails.required) {
                    required.push(paramName);
                }
            }
            declaration.parameters = {
                type: 'OBJECT',
                properties: properties
            };
            if (required.length > 0) {
                declaration.parameters.required = required;
            }
        }
        declarations.push(declaration);
    }
    return { functionDeclarations: declarations };
}
