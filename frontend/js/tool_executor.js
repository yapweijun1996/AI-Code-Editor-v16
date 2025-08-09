import { DbManager } from './db.js';
import { CodebaseIndexer } from './code_intel.js';
import * as FileSystem from './file_system.js';
import * as Editor from './editor.js';
import * as UI from './ui.js';
import { ChatService } from './chat_service.js';
import { UndoManager } from './undo_manager.js';
import { toolLogger } from './tool_logger.js';
import { syntaxValidator } from './syntax_validator.js';
import { codeComprehension } from './code_comprehension.js';
import { preciseEditor } from './precise_editor.js';
import { backgroundIndexer } from './background_indexer.js';
import { taskManager, TaskTools } from './task_manager.js';
import { performanceOptimizer } from './performance_optimizer.js';
import { providerOptimizer } from './provider_optimizer.js';
import { workerManager, ensureWorkersInitialized } from './worker_manager.js';
import { cacheManager, operationCache } from './cache_manager.js';

import { ToolRegistry } from './tool_registry.js';
// Senior Engineer AI System Imports
import { symbolResolver } from './symbol_resolver.js';
import { dataFlowAnalyzer } from './data_flow_analyzer.js';
import { debuggingIntelligence } from './debugging_intelligence.js';
import { codeQualityAnalyzer } from './code_quality_analyzer.js';
import { seniorEngineerAI } from './senior_engineer_ai.js';

// Smart debugging and optimization state
const debuggingState = {
    recentErrors: new Map(), // Track recent errors for pattern detection
    toolPerformance: new Map(), // Track tool execution times
    contextCache: new Map(), // Cache frequently accessed contexts
    lastFileOperations: [], // Track recent file operations for optimization
    amendModeOptimizations: {
        preferredTools: ['apply_diff', 'search_files', 'read_file'],
        avoidedTools: ['write_to_file', 'rewrite_file'],
        smartSearch: true,
        contextAware: true
    },
    smartToolSelection: {
        fileEditingHistory: new Map(), // Track which tools work best for different file types
        errorPatterns: new Map(), // Track common error patterns and solutions
        performanceMetrics: new Map() // Track tool performance by context
    }
};

// Import diff_match_patch for diff creation
let diff_match_patch;
try {
    // Try to import from global scope (if loaded via script tag)
    diff_match_patch = window.diff_match_patch;
    if (!diff_match_patch) {
        throw new Error('diff_match_patch not found in global scope');
    }
} catch (e) {
    console.warn('diff_match_patch not available:', e.message);
}

// --- Smart Debugging and Optimization Functions ---

// Track tool performance and suggest optimizations
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
    
    // Log performance warnings for slow tools
    if (duration > 5000) { // 5 seconds
        console.warn(`[Performance] Tool ${toolName} took ${duration}ms to execute`);
    }
}

// Smart tool selection based on context and history
function getOptimalTool(intent, context = {}) {
    const { fileType, fileSize, mode } = context;
    
    // Amend mode optimizations
    if (mode === 'amend') {
        if (intent === 'edit_file') {
            // Prefer apply_diff for surgical changes in amend mode
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
    
    // File size optimizations
    if (intent === 'edit_file' && fileSize) {
        if (fileSize > 500000) { // 500KB
            return {
                recommendedTool: 'edit_file',
                reason: 'Use edits array for large files',
                parameters: { preferEditsArray: true },
                alternatives: ['apply_diff']
            };
        }
    }
    
    // Performance-based recommendations
    const performanceKey = `${intent}_${fileType || 'unknown'}`;
    const metrics = debuggingState.toolPerformance.get(performanceKey);
    
    if (metrics && metrics.failureCount > metrics.successCount) {
        console.warn(`[Smart Selection] Tool ${intent} has high failure rate for ${fileType} files`);
    }
    
    return null; // No specific recommendation
}

// Error pattern detection and smart recovery
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
    
    // Detect recurring errors
    if (errorInfo.count >= 3) {
        console.warn(`[Error Pattern] Recurring error detected: ${errorSignature}`);
        return getSuggestedFix(toolName, error, errorInfo);
    }
    
    return null;
}

// Suggest fixes for common error patterns
function getSuggestedFix(toolName, error, errorInfo) {
    const errorMessage = error.message.toLowerCase();
    
    // apply_diff specific errors
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
    
    // File not found errors
    if (errorMessage.includes('not found') || errorMessage.includes('notfounderror')) {
        return {
            suggestion: 'Use get_project_structure first to verify file paths',
            alternativeTool: 'get_project_structure',
            confidence: 0.9
        };
    }
    
    // Permission errors - enhanced handling for File System Access API
    if (errorMessage.includes('permission') || errorMessage.includes('denied') ||
        errorMessage.includes('user activation is required')) {
        return {
            suggestion: 'File system permission issue. This can happen when the AI tries to access files without user interaction. The system will attempt to handle permissions automatically during file operations. If this persists, try manually clicking in the editor or file tree first.',
            alternativeTool: 'read_file',
            confidence: 0.9
        };
    }
    
    // Syntax errors in file editing
    if (toolName.includes('edit') && errorMessage.includes('syntax')) {
        return {
            suggestion: 'Use apply_diff for more precise editing to avoid syntax errors',
            alternativeTool: 'apply_diff',
            confidence: 0.85
        };
    }
    
    // Line number errors
    if (errorMessage.includes('line') && errorMessage.includes('invalid')) {
        return {
            suggestion: 'Use read_file with line numbers first to get accurate line references',
            alternativeTool: 'read_file',
            confidence: 0.9
        };
    }
    
    return null;
}

// Smart caching for repeated operations
function getCachedResult(toolName, parameters) {
    const cacheKey = `${toolName}:${JSON.stringify(parameters)}`;
    const cached = debuggingState.contextCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 30000) { // 30 second cache
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
    
    // Limit cache size
    if (debuggingState.contextCache.size > 100) {
        const oldestKey = Array.from(debuggingState.contextCache.keys())[0];
        debuggingState.contextCache.delete(oldestKey);
    }
}

// Optimize tool execution order
function optimizeToolSequence(tools) {
    // Sort tools by priority and dependencies
    const priorityOrder = {
        'get_project_structure': 1,
        'read_file': 2,
        'search_files': 3,
        'apply_diff': 4,
        'edit_file': 5,
        'create_file': 6
    };
    
    return tools.sort((a, b) => {
        const priorityA = priorityOrder[a.name] || 999;
        const priorityB = priorityOrder[b.name] || 999;
        return priorityA - priorityB;
    });
}

// --- Helper Functions ---

function stripMarkdownCodeBlock(content) {
   if (typeof content !== 'string') {
       return content;
   }
   // Use a regular expression to match the code block format (e.g., ```javascript ... ```)
   const match = content.match(/^```(?:\w+)?\n([\s\S]+)\n```$/);
   // If it matches, return the captured group (the actual code). Otherwise, return the original content.
   return match ? match[1] : content;
}

// Enhanced syntax validation using workers and caching
async function validateSyntaxBeforeWrite(filename, content) {
    try {
        // Use cached validation if available
        const validation = await operationCache.cacheValidation(filename, content, async (content, filename) => {
            // Use worker for validation to avoid blocking main thread
            return await workerManager.processFile('validate', {
                filename,
                content
            });
        });

        if (validation.warnings && validation.warnings.length > 0) {
            console.warn(`Syntax warnings found in ${filename}:`, validation.warnings);
        }

        if (!validation.valid) {
            const errorMessages = validation.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n');
            const suggestionMessages = validation.suggestions ? `\n\nSuggestions:\n- ${validation.suggestions.join('\n- ')}` : '';
            
            // Return a detailed error object instead of throwing an error
            return {
                isValid: false,
                errors: errorMessages,
                suggestions: suggestionMessages
            };
        }

        console.log(`Syntax validation passed for ${filename}.`);
        return { isValid: true };
    } catch (error) {
        console.warn(`Validation failed for ${filename}:`, error.message);
        // Fallback to basic validation
        return { isValid: true, warnings: [`Validation service unavailable: ${error.message}`] };
    }
}

// Streaming file processing for large files
async function streamFileUpdate(filename, content, chunkSize = 50000) {
    const chunks = [];
    for (let i = 0; i < content.length; i += chunkSize) {
        chunks.push(content.slice(i, i + chunkSize));
    }
    
    let result = '';
    for (let i = 0; i < chunks.length; i++) {
        result += chunks[i];
        
        // Yield control to prevent UI blocking
        if (i % 5 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        // Update progress for large files
        if (chunks.length > 10) {
            const progress = Math.round((i / chunks.length) * 100);
            console.log(`Processing large file: ${progress}%`);
        }
    }
    
    return result;
}

// Streaming edit for very large files (>500KB)
async function _streamingEditFile({ filename, edits, fileHandle, file }) {
    console.log(`Using streaming edit for large file: ${filename} (${file.size} bytes)`);
    
    // Read file in chunks to avoid memory issues
    const chunkSize = 1024 * 1024; // 1MB chunks
    const fileSize = file.size;
    let currentPos = 0;
    let lines = [];
    
    // Read file in chunks and split into lines
    while (currentPos < fileSize) {
        const chunk = await file.slice(currentPos, Math.min(currentPos + chunkSize, fileSize)).text();
        const chunkLines = chunk.split(/\r?\n/);
        
        if (lines.length > 0) {
            // Merge last line from previous chunk with first line of current chunk
            lines[lines.length - 1] += chunkLines[0];
            lines.push(...chunkLines.slice(1));
        } else {
            lines.push(...chunkLines);
        }
        
        currentPos += chunkSize;
        
        // Yield control periodically
        if (currentPos % (chunkSize * 5) === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    
    const originalLineCount = lines.length;
    console.log(`Streaming edit: Loaded ${originalLineCount} lines`);
    
    // Validate edits
    for (const edit of edits) {
        if (edit.type === 'replace_lines') {
            const { start_line, end_line } = edit;
            if (start_line < 1 || end_line < 1 || start_line > originalLineCount || end_line > originalLineCount) {
                throw new Error(`Invalid line range: ${start_line}-${end_line} (file has ${originalLineCount} lines)`);
            }
        }
    }
    
    // Apply edits in reverse order
    const sortedEdits = [...edits].sort((a, b) => b.start_line - a.start_line);
    
    for (const edit of sortedEdits) {
        if (edit.type === 'replace_lines') {
            const { start_line, end_line, new_content } = edit;
            const cleanContent = stripMarkdownCodeBlock(new_content || '');
            const newLines = cleanContent.split(/\r?\n/);
            
            const before = lines.slice(0, start_line - 1);
            const after = lines.slice(end_line - 1);
            lines = [...before, ...newLines, ...after];
        }
    }
    
    // Write file in chunks to avoid memory issues
    const writable = await fileHandle.createWritable();
    const writeChunkSize = 100000; // 100KB write chunks
    
    for (let i = 0; i < lines.length; i += writeChunkSize) {
        const chunk = lines.slice(i, i + writeChunkSize).join('\n');
        await writable.write(chunk);
        
        if (i + writeChunkSize < lines.length) {
            await writable.write('\n');
        }
        
        // Yield control during writes
        if (i % (writeChunkSize * 2) === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    
    await writable.close();
    
    console.log(`Streaming edit completed: ${originalLineCount} -> ${lines.length} lines`);
    
    return {
        message: `Streaming edit applied to '${filename}' successfully. ${edits.length} edit(s) applied.`,
        details: {
            originalLines: originalLineCount,
            finalLines: lines.length,
            editsApplied: edits.length,
            processingMethod: 'streaming',
            fileSize: file.size
        }
    };
}

// --- Tool Handlers ---

function unescapeHtmlEntities(text) {
    if (typeof text !== 'string') {
        return text;
    }
    // Use a temporary textarea element to decode entities
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    let decoded = textarea.value;

    // Additionally, handle JavaScript-style hex escapes that might not be covered
    try {
        decoded = decoded.replace(/\\x([0-9A-Fa-f]{2})/g, (match, p1) => {
            return String.fromCharCode(parseInt(p1, 16));
        });
    } catch (e) {
        console.error("Error decoding hex escapes", e);
    }
    
    return decoded;
}

async function _getProjectStructure(params, rootHandle) {
    const ignorePatterns = await FileSystem.getIgnorePatterns(rootHandle);
    const tree = await FileSystem.buildStructureTree(rootHandle, ignorePatterns);
    const structure = FileSystem.formatTreeToString(tree);
    return { structure };
}

async function _readFile({ filename, include_line_numbers = false }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for read_file.");
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    
    // Use streaming file reader for better performance
    const { readFileWithStrategy } = await import('./file_streaming.js');
    const file = await fileHandle.getFile();
    
    const MAX_CONTEXT_BYTES = 256000; // 256KB threshold

    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();

    if (file.size > MAX_CONTEXT_BYTES) {
        // For large files, use streaming with preview
        // Skip cache to avoid caching corruption issues
        const result = await readFileWithStrategy(fileHandle, filename, {
            previewOnly: true,
            previewSize: MAX_CONTEXT_BYTES,
            skipCache: true
        });
        
        return {
            status: "Success",
            message: "File is large - showing preview content.",
            filename: filename,
            file_size: file.size,
            preview_size: MAX_CONTEXT_BYTES,
            truncated: true,
            content: result.content,
            guidance: "Only preview content shown to prevent exceeding context window. File opened in editor. Use 'read_file_lines' for specific sections or 'edit_file' for targeted modifications."
        };
    }

    // For smaller files, read normally but with streaming for consistency
    // Skip cache to avoid caching corruption issues
    const streamResult = await readFileWithStrategy(fileHandle, filename, { skipCache: true });
    let cleanContent = unescapeHtmlEntities(streamResult.content);

    if (typeof cleanContent !== 'string') {
        console.warn(`Read file content for ${filename} is not a string, it is a ${typeof cleanContent}. Coercing to empty string.`);
        cleanContent = '';
    }

    if (include_line_numbers) {
        const lines = cleanContent.split('\n');
        cleanContent = lines.map((line, index) => `${index + 1} | ${line}`).join('\n');
    }
    
    return { 
        content: cleanContent,
        status: "Success",
        filename: filename,
        file_size: file.size,
        strategy: streamResult.strategy
    };
}

/**
 * Reads a specific range of lines from a file.
 *
 * IMPORTANT NOTES:
 * 1. Fixed 'content.split is not a function' error that occurred when reading certain file types.
 *    The issue was that some files were incorrectly classified as text files when they were binary,
 *    or the content was returned as null/non-string, causing the split() method to fail.
 *
 * 2. Type checking was added to handle non-string content, with fallbacks to convert to string
 *    or use an empty string when content is null. This makes the function more robust against
 *    various file formats.
 *
 * 3. Enhanced logging was added to help diagnose similar issues in the future.
 *
 * 4. The list of recognized text file extensions in file_streaming.js was expanded to include
 *    more file types like ColdFusion (.cfm, .cfc, .cfml) and others to prevent similar issues.
 *
 * @param {Object} params - Function parameters
 * @param {string} params.filename - Path to the file
 * @param {number} params.start_line - First line to read (1-based)
 * @param {number} params.end_line - Last line to read (1-based)
 * @param {Object} rootHandle - File system root handle
 * @returns {Object} Object containing the content and details about the read operation
 */
async function _readFileLines({ filename, start_line, end_line }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required.");
    if (typeof start_line !== 'number' || typeof end_line !== 'number') {
        throw new Error("The 'start_line' and 'end_line' parameters must be numbers.");
    }
    if (start_line > end_line) {
        throw new Error("The 'start_line' must not be after the 'end_line'.");
    }

    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    
    // Use streaming file reader for better performance with large files
    const { readFileWithStrategy, FileInfo } = await import('./file_streaming.js');
    
    // Declare variables in the correct scope
    let content, lines, clampedStart, clampedEnd;
    
    try {
        const file = await fileHandle.getFile();
        const fileInfo = new FileInfo(file, fileHandle);
        
        // Add detailed logging for debugging
        console.log(`Reading file: ${filename} (${fileInfo.formatFileSize(file.size)})`);
        console.log(`File type: ${file.type || 'unknown'}, Extension: ${fileInfo.extension}`);
        console.log(`Is text file: ${fileInfo.isText()}, Is binary file: ${fileInfo.isBinary()}`);
        
        const streamResult = await readFileWithStrategy(fileHandle, filename);
        
        // Enhanced type checking to handle various content types (binary files, null content, etc.)
        // This fixes the "content.split is not a function" error for files misclassified as text
        if (typeof streamResult.content !== 'string') {
            console.warn(`Warning: File content for ${filename} is not a string, it is a ${typeof streamResult.content}.`);
            console.warn(`Strategy used: ${streamResult.strategy}, Content truncated: ${streamResult.truncated}`);
            
            // Fix: Properly handle non-string content by converting to string or using empty fallback
            if (streamResult.content === null || streamResult.content === undefined) {
                content = '';
            } else if (typeof streamResult.content === 'object') {
                // If it's an object, try to extract text content or stringify as last resort
                content = streamResult.content.text || streamResult.content.content || JSON.stringify(streamResult.content);
            } else {
                // For other types, convert to string
                content = String(streamResult.content);
            }
            console.log(`Converted content to string (length: ${content.length})`);
        } else {
            content = streamResult.content;
        }
        
        // Ensure content is definitely a string before splitting
        if (typeof content !== 'string') {
            console.error(`Content is still not a string after conversion: ${typeof content}`);
            content = '';
        }
        
        lines = content.split('\n');
        console.log(`Split content into ${lines.length} lines`);
        
        clampedStart = Math.max(1, start_line);
        clampedEnd = Math.min(lines.length, end_line);
    } catch (error) {
        console.error(`Error reading file ${filename}:`, error);
        throw new Error(`Failed to read file ${filename}: ${error.message}`);
    }

    // Check if line range is valid
    if (clampedStart > clampedEnd) {
        console.log(`Invalid line range: start(${clampedStart}) > end(${clampedEnd})`);
        return { content: '' };
    }

    // Extract the requested lines
    const selectedLines = lines.slice(clampedStart - 1, clampedEnd);
    console.log(`Selected ${selectedLines.length} lines from ${clampedStart} to ${clampedEnd}`);
    
    // Always include line numbers in the output of this tool
    const numberedLines = selectedLines.map((line, index) => `${clampedStart + index} | ${line}`);
    
    return {
        content: numberedLines.join('\n'),
        details: {
            filename,
            start_line: clampedStart,
            end_line: clampedEnd,
            lines_count: selectedLines.length,
            original_lines_count: lines.length
        }
    };
}

async function _searchInFile({ filename, pattern, context = 2 }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required.");
    if (!pattern) throw new Error("The 'pattern' (string or regex) parameter is required.");

    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    const file = await fileHandle.getFile();
    const content = await file.text();
    const lines = content.split('\n');
    
    const searchResults = [];
    const regex = new RegExp(pattern, 'g');

    lines.forEach((line, index) => {
        if (line.match(regex)) {
            const start = Math.max(0, index - context);
            const end = Math.min(lines.length, index + context + 1);
            const contextLines = lines.slice(start, end).map((contextLine, contextIndex) => {
                const lineNumber = start + contextIndex + 1;
                return `${lineNumber}: ${contextLine}`;
            });
            
            searchResults.push({
                line_number: index + 1,
                line_content: line,
                context: contextLines.join('\n')
            });
        }
    });

    if (searchResults.length === 0) {
        return { message: "No matches found." };
    }

    return { results: searchResults };
}

async function _readMultipleFiles({ filenames }, rootHandle) {
    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
        throw new Error("The 'filenames' parameter is required and must be a non-empty array of strings.");
    }

    const MAX_CONTEXT_BYTES = 256000; // 256KB threshold per file
    
    try {
        // Ensure workers are initialized before use
        await ensureWorkersInitialized();
        
        // Use batch worker for efficient parallel processing of multiple files
        const batchResult = await workerManager.executeBatch([
            {
                type: 'file_read',
                filenames: filenames,
                maxContextBytes: MAX_CONTEXT_BYTES,
                includeMetadata: true
            }
        ]);
        
        let combinedContent = '';
        const processedFiles = [];
        const errors = [];
        
        for (let i = 0; i < filenames.length; i++) {
            const filename = filenames[i];
            const result = batchResult.results[i];
            
            if (result.success) {
                combinedContent += `--- START OF FILE: ${filename} ---\n`;
                
                if (result.truncated) {
                    combinedContent += `File is too large to be included in the context (Size: ${result.fileSize} bytes).\n`;
                    combinedContent += `Guidance: The file has been opened in the editor. Use surgical tools to modify it.\n`;
                } else {
                    combinedContent += result.content + '\n';
                }
                
                combinedContent += `--- END OF FILE: ${filename} ---\n\n`;
                processedFiles.push(filename);
                
                // Open file in editor
                try {
                    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
                    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
                } catch (editorError) {
                    console.warn(`Failed to open ${filename} in editor:`, editorError.message);
                }
            } else {
                combinedContent += `--- ERROR READING FILE: ${filename} ---\n`;
                combinedContent += `${result.error}\n`;
                combinedContent += `--- END OF ERROR ---\n\n`;
                errors.push({ filename, error: result.error });
            }
        }
        
        document.getElementById('chat-input').focus();
        
        return {
            combined_content: combinedContent,
            batch_stats: {
                total_files: filenames.length,
                successful: processedFiles.length,
                failed: errors.length,
                processing_time: batchResult.processingTime || 0,
                parallel_processing: true
            }
        };
        
    } catch (error) {
        console.warn('Batch processing failed, falling back to sequential processing:', error.message);
        
        // Fallback to original sequential processing
        let combinedContent = '';

        for (const filename of filenames) {
            try {
                const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
                const file = await fileHandle.getFile();
                
                combinedContent += `--- START OF FILE: ${filename} ---\n`;

                if (file.size > MAX_CONTEXT_BYTES) {
                    combinedContent += `File is too large to be included in the context (Size: ${file.size} bytes).\n`;
                    combinedContent += `Guidance: The file has been opened in the editor. Use surgical tools to modify it.\n`;
                } else {
                    let content = await file.text();
                    combinedContent += content + '\n';
                }
                
                combinedContent += `--- END OF FILE: ${filename} ---\n\n`;

                await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
            } catch (error) {
                combinedContent += `--- ERROR READING FILE: ${filename} ---\n`;
                combinedContent += `${error.message}\n`;
                combinedContent += `--- END OF ERROR ---\n\n`;
            }
        }
        
        document.getElementById('chat-input').focus();
        return {
            combined_content: combinedContent,
            fallback: true
        };
    }
}

async function _createFile({ filename, content = '' }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for create_file.");
    if (typeof filename !== 'string') throw new Error("The 'filename' parameter must be a string.");
    
    const cleanContent = stripMarkdownCodeBlock(content);
    
    try {
        const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename, { create: true });
        
        // Enhanced permission handling - try to proceed even if permission check fails
        let hasPermission = false;
        try {
            hasPermission = await FileSystem.verifyAndRequestPermission(fileHandle, true);
        } catch (permissionError) {
            console.warn('Permission check failed, attempting to proceed:', permissionError.message);
            hasPermission = true; // Optimistically proceed
        }
        
        if (!hasPermission) {
            throw new Error('Permission to write to the file was denied.');
        }
        
        // Track for undo - save empty content since this is a new file creation
        UndoManager.push(filename, '');
        
        const writable = await fileHandle.createWritable();
        await writable.write(cleanContent);
        await writable.close();
        
        // Use more reliable refresh timing
        await new Promise(resolve => setTimeout(resolve, 150));
        await UI.refreshFileTree(rootHandle, (filePath) => {
            const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
            Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
        });
        await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
        document.getElementById('chat-input').focus();
        
        return { message: `File '${filename}' created successfully.` };
    } catch (error) {
        // Enhanced error handling for permission issues
        if (error.message.includes('User activation is required')) {
            throw new Error(`Failed to create file '${filename}': File system permission required. This happens when the AI tries to create files without user interaction. Please try clicking in the editor or file tree first, then retry the operation.`);
        }
        throw new Error(`Failed to create file '${filename}': ${error.message}`);
    }
}

async function _rewriteFile({ filename, content }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for rewrite_file.");
    const cleanContent = stripMarkdownCodeBlock(content);
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename, { create: true });
    
    // Enhanced permission handling - try to proceed even if permission check fails
    let hasPermission = false;
    try {
        hasPermission = await FileSystem.verifyAndRequestPermission(fileHandle, true);
    } catch (permissionError) {
        console.warn('Permission check failed, attempting to proceed:', permissionError.message);
        hasPermission = true; // Optimistically proceed
    }
    
    if (!hasPermission) {
        throw new Error('Permission to write to the file was denied.');
    }
    
    let originalContent = '';
    try {
        const file = await fileHandle.getFile();
        originalContent = await file.text();
        UndoManager.push(filename, originalContent);
    } catch (e) {
        // File doesn't exist, push empty content for undo
        UndoManager.push(filename, '');
    }

    // Validate syntax before writing, but do not block
    const validationResult = await validateSyntaxBeforeWrite(filename, cleanContent);

    // Use streaming for large files
    const STREAM_THRESHOLD = 100000; // 100KB
    let processedContent = cleanContent;
    
    if (cleanContent.length > STREAM_THRESHOLD) {
        console.log(`Processing large file ${filename} with streaming...`);
        processedContent = await streamFileUpdate(filename, cleanContent);
    }

    const writable = await fileHandle.createWritable();
    await writable.write(processedContent);
    await writable.close();
    
    if (Editor.getOpenFiles().has(filename)) {
        Editor.getOpenFiles().get(filename)?.model.setValue(processedContent);
    }
    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();
    let message = `File '${filename}' rewritten successfully.`;
    if (!validationResult.isValid) {
        message += `\n\nWARNING: Syntax errors were detected and have been written to the file.\nErrors:\n${validationResult.errors}${validationResult.suggestions}`;
    }
    return { message };
}

async function _deleteFile({ filename }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for delete_file.");
    if (typeof filename !== 'string') throw new Error("The 'filename' parameter must be a string.");
    
    try {
        const { parentHandle, entryName } = await FileSystem.getParentDirectoryHandle(rootHandle, filename);
        await parentHandle.removeEntry(entryName);
        
        // Close file in editor if open
        if (Editor.getOpenFiles().has(filename)) {
            Editor.closeTab(filename, document.getElementById('tab-bar'));
        }
        
        // Use more reliable refresh timing
        await new Promise(resolve => setTimeout(resolve, 150));
        await UI.refreshFileTree(rootHandle, (filePath) => {
            const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
            Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
        });
        
        return { message: `File '${filename}' deleted successfully.` };
    } catch (error) {
        throw new Error(`Failed to delete file '${filename}': ${error.message}`);
    }
}

async function _renameFile({ old_path, new_path }, rootHandle) {
    if (!old_path || !new_path) throw new Error("The 'old_path' and 'new_path' parameters are required for rename_file.");
    if (typeof old_path !== 'string' || typeof new_path !== 'string') {
        throw new Error("The 'old_path' and 'new_path' parameters must be strings.");
    }
    try {
        const wasOpen = Editor.getOpenFiles().has(old_path);
        // Perform filesystem rename
        await FileSystem.renameEntry(rootHandle, old_path, new_path);

        if (wasOpen) {
            // Update editor tab/model id and handle without closing/reopening
            const newFileHandle = await FileSystem.getFileHandleFromPath(rootHandle, new_path);
            const newName = new_path.split('/').pop();
            Editor.updateTabId(old_path, new_path, newName);
            const openFiles = Editor.getOpenFiles();
            const newEntry = openFiles.get(new_path);
            if (newEntry) {
                newEntry.handle = newFileHandle;
            }
        }

        // Refresh the file tree so UI reflects the rename
        await new Promise(resolve => setTimeout(resolve, 150));
        await UI.refreshFileTree(rootHandle, (filePath) => {
            const fileHandlePromise = FileSystem.getFileHandleFromPath(rootHandle, filePath);
            fileHandlePromise.then(fh => Editor.openFile(fh, filePath, document.getElementById('tab-bar'), false)).catch(() => {});
        });

        return { message: `File '${old_path}' renamed to '${new_path}' successfully.` };
    } catch (error) {
        throw new Error(`Failed to rename file '${old_path}' to '${new_path}': ${error.message}`);
    }
}

// REMOVED: insert_content function - simplified to use only rewrite_file for clarity

// REMOVED: replace_lines function - was causing conflicts and bugs with complex indentation logic

// Apply diff tool - safer and more precise than full file rewrites
async function _applyDiff({ filename, diff }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for apply_diff.");
    if (!diff) throw new Error("The 'diff' parameter is required for apply_diff.");
    
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    
    // Enhanced permission handling - try to proceed even if permission check fails
    let hasPermission = false;
    try {
        hasPermission = await FileSystem.verifyAndRequestPermission(fileHandle, true);
    } catch (permissionError) {
        console.warn('Permission check failed, attempting to proceed:', permissionError.message);
        hasPermission = true; // Optimistically proceed
    }
    
    if (!hasPermission) {
        throw new Error('Permission to write to the file was denied.');
    }
    
    const file = await fileHandle.getFile();
    const originalContent = await file.text();
    UndoManager.push(filename, originalContent);
    
    const lines = originalContent.split(/\r?\n/);
    const originalLineCount = lines.length;
    
    // Parse diff blocks - expecting format like:
    // <<<<<<< SEARCH
    // :start_line:10
    // -------
    // old content
    // =======
    // new content
    // >>>>>>> REPLACE
    
    // Debug: Log the raw diff content to understand the format
    console.log('Raw diff content:', JSON.stringify(diff));
    
    // Split diff into individual blocks first, then parse each one
    // This approach is more reliable than a single regex for complex content
    const diffBlocks = [];
    
    // Split by the SEARCH markers to get individual blocks
    const blockSeparator = /<<<<<<< SEARCH/g;
    const rawBlocks = diff.split(blockSeparator).filter(block => block.trim());
    
    for (const rawBlock of rawBlocks) {
        // Parse each block individually
        const blockPattern = /^\s*\n:start_line:(\d+)\s*\n-------\s*\n([\s\S]*?)\n=======\s*\n([\s\S]*?)\n>>>>>>> REPLACE/;
        const match = rawBlock.match(blockPattern);
        
        if (match) {
            const startLine = parseInt(match[1]);
            const searchContent = match[2];
            const replaceContent = match[3];
            
            diffBlocks.push({
                startLine,
                searchContent,
                replaceContent
            });
        } else {
            // Try to provide more specific error information
            console.warn('Failed to parse diff block:', rawBlock.substring(0, 200) + '...');
        }
    }
    
    // If no blocks were parsed successfully, provide detailed debugging
    if (diffBlocks.length === 0) {
        // Try to identify what parts of the expected format are present
        const hasSearchMarker = diff.includes('<<<<<<< SEARCH');
        const hasReplaceMarker = diff.includes('>>>>>>> REPLACE');
        const hasStartLine = diff.includes(':start_line:');
        const hasSeparator = diff.includes('-------');
        const hasEquals = diff.includes('=======');
        
        let debugInfo = `No valid diff blocks found. Debug info:\n`;
        debugInfo += `- Has SEARCH marker: ${hasSearchMarker}\n`;
        debugInfo += `- Has REPLACE marker: ${hasReplaceMarker}\n`;
        debugInfo += `- Has start_line: ${hasStartLine}\n`;
        debugInfo += `- Has separator (-------): ${hasSeparator}\n`;
        debugInfo += `- Has equals (=======): ${hasEquals}\n`;
        debugInfo += `\nExpected format:\n<<<<<<< SEARCH\n:start_line:N\n-------\nold content\n=======\nnew content\n>>>>>>> REPLACE\n`;
        debugInfo += `\nActual content received:\n${diff}`;
        
        throw new Error(debugInfo);
    }
    
    // Sort diff blocks by start line in descending order to apply from bottom to top
    diffBlocks.sort((a, b) => b.startLine - a.startLine);
    
    let modifiedLines = [...lines];
    
    for (const block of diffBlocks) {
        const { startLine, searchContent, replaceContent } = block;
        
        if (startLine < 1 || startLine > originalLineCount) {
            throw new Error(`Invalid start_line ${startLine}. File has ${originalLineCount} lines.`);
        }
        
        // Find the best match for the search content using multiple strategies
        const searchLines = searchContent.split(/\r?\n/);
        let actualStartIndex = startLine - 1;
        let matches = false;
        let mismatchDetails = '';
        
        // Strategy 1: Try exact match at specified line
        if (actualStartIndex >= 0 && actualStartIndex < modifiedLines.length) {
            matches = true;
            for (let i = 0; i < searchLines.length; i++) {
                const lineIndex = actualStartIndex + i;
                if (lineIndex >= modifiedLines.length || modifiedLines[lineIndex] !== searchLines[i]) {
                    matches = false;
                    break;
                }
            }
        }
        
        // Strategy 2: If exact match fails, try fuzzy search nearby (±10 lines)
        if (!matches) {
            const searchRange = 10;
            const minIndex = Math.max(0, actualStartIndex - searchRange);
            const maxIndex = Math.min(modifiedLines.length - searchLines.length, actualStartIndex + searchRange);
            
            for (let searchIndex = minIndex; searchIndex <= maxIndex; searchIndex++) {
                let fuzzyMatches = true;
                for (let i = 0; i < searchLines.length; i++) {
                    const lineIndex = searchIndex + i;
                    if (lineIndex >= modifiedLines.length || 
                        modifiedLines[lineIndex].trim() !== searchLines[i].trim()) {
                        fuzzyMatches = false;
                        break;
                    }
                }
                
                if (fuzzyMatches) {
                    matches = true;
                    actualStartIndex = searchIndex;
                    console.log(`[ApplyDiff] Found fuzzy match at line ${actualStartIndex + 1} instead of ${startLine}`);
                    break;
                }
            }
        }
        
        // Strategy 3: Try partial content match (match first and last lines)
        if (!matches && searchLines.length > 2) {
            const firstLine = searchLines[0].trim();
            const lastLine = searchLines[searchLines.length - 1].trim();
            
            for (let searchIndex = Math.max(0, actualStartIndex - 5); 
                 searchIndex <= Math.min(modifiedLines.length - searchLines.length, actualStartIndex + 5); 
                 searchIndex++) {
                
                if (searchIndex < modifiedLines.length && 
                    searchIndex + searchLines.length - 1 < modifiedLines.length &&
                    modifiedLines[searchIndex].trim() === firstLine &&
                    modifiedLines[searchIndex + searchLines.length - 1].trim() === lastLine) {
                    
                    matches = true;
                    actualStartIndex = searchIndex;
                    console.log(`[ApplyDiff] Found partial match (first/last lines) at line ${actualStartIndex + 1}`);
                    break;
                }
            }
        }
        
        if (!matches) {
            // Provide detailed context for debugging
            const contextStart = Math.max(0, actualStartIndex - 3);
            const contextEnd = Math.min(modifiedLines.length, actualStartIndex + searchLines.length + 3);
            const contextLines = modifiedLines.slice(contextStart, contextEnd);
            
            mismatchDetails = `Could not find search content around line ${startLine}.\n`;
            mismatchDetails += `Context (lines ${contextStart + 1}-${contextEnd}):\n`;
            contextLines.forEach((line, idx) => {
                const lineNum = contextStart + idx + 1;
                const marker = (lineNum === startLine) ? '>>>' : '   ';
                mismatchDetails += `${marker} ${lineNum}: ${line}\n`;
            });
            
            const actualContent = modifiedLines.slice(actualStartIndex, actualStartIndex + searchLines.length).join('\n');
            throw new Error(`Search content does not match at line ${startLine}.\n\n${mismatchDetails}\nExpected content:\n${searchContent}\n\nActual content:\n${actualContent}`);
        }
        
        // Update the search start index to the found position
        const searchStartIndex = actualStartIndex;
        
        // Apply the replacement
        const replaceLines = replaceContent.split(/\r?\n/);
        const before = modifiedLines.slice(0, searchStartIndex);
        const after = modifiedLines.slice(searchStartIndex + searchLines.length);
        modifiedLines = [...before, ...replaceLines, ...after];
    }
    
    // Preserve original line endings
    const lineEnding = originalContent.includes('\r\n') ? '\r\n' : '\n';
    const newContent = modifiedLines.join(lineEnding);
    
    // Validate syntax before writing, but do not block
    const validationResult = await validateSyntaxBeforeWrite(filename, newContent);
    
    const writable = await fileHandle.createWritable();
    await writable.write(newContent);
    await writable.close();
    
    // Update editor if file is open
    if (Editor.getOpenFiles().has(filename)) {
        Editor.getOpenFiles().get(filename)?.model.setValue(newContent);
    }
    
    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();
    
    let message = `Applied ${diffBlocks.length} diff block(s) to '${filename}' successfully.`;
    if (!validationResult.isValid) {
        message += `\n\nWARNING: Syntax errors were detected:\n${validationResult.errors}${validationResult.suggestions}`;
    }
    
    return {
        message,
        details: {
            originalLines: originalLineCount,
            finalLines: modifiedLines.length,
            blocksApplied: diffBlocks.length
        }
    };
}

async function _createDiff({ original_content, new_content }) {
    if (original_content === undefined) throw new Error("The 'original_content' parameter is required for create_diff.");
    if (new_content === undefined) throw new Error("The 'new_content' parameter is required for create_diff.");

    if (!diff_match_patch) {
        throw new Error("diff_match_patch library is not available. Please ensure it's loaded before using create_diff.");
    }

    try {
        const dmp = new diff_match_patch();
        const a = dmp.diff_linesToChars_(original_content, new_content);
        const lineText1 = a.chars1;
        const lineText2 = a.chars2;
        const lineArray = a.lineArray;
        const diffs = dmp.diff_main(lineText1, lineText2, false);
        dmp.diff_charsToLines_(diffs, lineArray);
        const patches = dmp.patch_make(original_content, diffs);
        const patchText = dmp.patch_toText(patches);

        return { patch_content: patchText };
    } catch (error) {
        throw new Error(`Failed to create diff: ${error.message}`);
    }
}

// Alternative diff tools for better reliability

/**
 * Find and replace text in a file - more reliable than apply_diff for simple changes
 */
// REMOVED: _findAndReplace, _insertAtLine, _replaceLines, _smartReplace - functionality consolidated into edit_file and apply_diff

// Smart file editing - efficient for large files, safe for small ones
async function _smartEditFile({ filename, edits }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required.");
    if (!edits || !Array.isArray(edits)) throw new Error("The 'edits' parameter is required and must be an array.");

    // Validate that each edit has a valid type property early
    for (const edit of edits) {
        if (!edit.type) {
            throw new Error("Each edit must have a 'type' property. Valid types are: 'replace_lines', 'insert_lines'");
        }
        if (!['replace_lines', 'insert_lines'].includes(edit.type)) {
            throw new Error(`Invalid edit type: '${edit.type}'. Valid types are: 'replace_lines', 'insert_lines'`);
        }
    }

    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);

    // Enhanced permission handling - try to proceed even if permission check fails
    let hasPermission = false;
    try {
        hasPermission = await FileSystem.verifyAndRequestPermission(fileHandle, true);
    } catch (permissionError) {
        console.warn('Permission check failed, attempting to proceed:', permissionError.message);
        hasPermission = true; // Optimistically proceed
    }

    if (!hasPermission) {
        throw new Error('Permission to write to the file was denied.');
    }

    const file = await fileHandle.getFile();
    const fileSize = file.size;
    console.log(`_smartEditFile: Processing ${filename} (${fileSize} bytes)`);

    // For very large files (>500KB), use streaming approach
    if (fileSize > 500000) {
        // TODO: Add content verification to streaming edits as well
        return await _streamingEditFile({ filename, edits, fileHandle, file });
    }

    const originalContent = await file.text();
    UndoManager.push(filename, originalContent);

    let lines = originalContent.split(/\r?\n/);
    const originalLineCount = lines.length;

    // Enhanced validation with content verification and better error messages
    for (const edit of edits) {
        if (edit.type === 'replace_lines') {
            let { start_line, end_line, new_content, expected_content } = edit;
            if (typeof start_line !== 'number' || typeof end_line !== 'number') {
                throw new Error(`Invalid line numbers in edit: start_line=${start_line}, end_line=${end_line}`);
            }
            if (start_line < 1 || end_line < 1) {
                throw new Error(`Line numbers must be >= 1: start_line=${start_line}, end_line=${end_line}`);
            }
            if (start_line > end_line) {
                throw new Error(`start_line (${start_line}) cannot be greater than end_line (${end_line})`);
            }
            if (start_line > originalLineCount) {
                 throw new Error(`start_line (${start_line}) exceeds file length (${originalLineCount}).`);
            }
            if (end_line > originalLineCount) {
                console.warn(`Warning: end_line (${end_line}) exceeds file length (${originalLineCount}). Clamping to ${originalLineCount}.`);
                edit.end_line = originalLineCount;
                end_line = originalLineCount; // update local variable
            }

            // *** NEW: Content Verification ***
            if (expected_content) {
                // end_line is inclusive, so slice up to end_line
                const actual_content = lines.slice(start_line - 1, end_line).join('\n');
                // Using trim() to be more robust against whitespace differences at the start/end of the block
                if (actual_content.trim() !== expected_content.trim()) {
                    const error = new Error(`Content mismatch at lines ${start_line}-${end_line}. The file content has likely changed. Please read the file again and construct a new edit.`);
                    error.details = {
                        filename,
                        start_line,
                        end_line,
                        expected: expected_content,
                        actual: actual_content
                    };
                    throw error;
                }
            } else {
                // If no expected_content is provided, log a warning.
                // This makes the tool safer by default while allowing old calls to work with a warning.
                console.warn(`Warning: 'replace_lines' edit for '${filename}' at lines ${start_line}-${end_line} was performed without 'expected_content' verification. This is unsafe and will be deprecated.`);
            }

        } else if (edit.type === 'insert_lines') {
            const { line_number } = edit;
            if (typeof line_number !== 'number' || line_number < 0 || line_number > originalLineCount) {
                throw new Error(`Invalid line number for insert: ${line_number} (file has ${originalLineCount} lines)`);
            }
        } else if (!edit.type) {
            throw new Error(`Missing edit type: Each edit must have a 'type' property of either 'replace_lines' or 'insert_lines'`);
        } else {
            throw new Error(`Unsupported edit type: ${edit.type}. Must be one of: 'replace_lines', 'insert_lines'`);
        }
    }

    // Apply edits in reverse order to maintain line numbers
    const sortedEdits = [...edits].sort((a, b) => {
        const aLine = a.type === 'insert_lines' ? a.line_number : a.start_line;
        const bLine = b.type === 'insert_lines' ? b.line_number : b.start_line;
        return bLine - aLine;
    });

    for (const edit of sortedEdits) {
        if (edit.type === 'replace_lines') {
            const { start_line, end_line, new_content } = edit;
            const cleanContent = stripMarkdownCodeBlock(new_content || '');
            const newLines = cleanContent.split(/\r?\n/);

            // Replace the specified range with new content
            // end_line is inclusive for replacement
            const before = lines.slice(0, start_line - 1);
            const after = lines.slice(end_line); // Corrected from end_line - 1
            lines = [...before, ...newLines, ...after];
        } else if (edit.type === 'insert_lines') {
            const { line_number, new_content } = edit;
            const cleanContent = stripMarkdownCodeBlock(new_content || '');
            const newLines = cleanContent.split(/\r?\n/);

            // Insert at the specified line number
            const before = lines.slice(0, line_number);
            const after = lines.slice(line_number);
            lines = [...before, ...newLines, ...after];
        }
    }

    await toolLogger.log('_smartEditFile', {
        filename,
        fileSize,
        originalLineCount,
        finalLineCount: lines.length,
        editsApplied: edits.length
    }, 'Success');

    // Preserve original line endings
    const lineEnding = originalContent.includes('\r\n') ? '\r\n' : '\n';
    const newContent = lines.join(lineEnding);

    // Final validation of the fully assembled content before writing, but do not block
    const validationResult = await validateSyntaxBeforeWrite(filename, newContent);

    const writable = await fileHandle.createWritable();
    await writable.write(newContent);
    await writable.close();

    // Only refresh editor for smaller files to avoid performance issues
    if (fileSize < 100000 && Editor.getOpenFiles().has(filename)) {
        Editor.getOpenFiles().get(filename)?.model.setValue(newContent);
    }

    // Only auto-open if file is small enough
    if (fileSize < 50000) {
        await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    }

    document.getElementById('chat-input').focus();

    let message = `Smart edit applied to '${filename}' successfully. ${edits.length} edit(s) applied.`;
    if (!validationResult.isValid) {
        message += `\n\nWARNING: Syntax errors were detected and have been written to the file.\nErrors:\n${validationResult.errors}${validationResult.suggestions}`;
    }

    return {
        message: message,
        details: {
            originalLines: originalLineCount,
            finalLines: lines.length,
            editsApplied: edits.length,
            fileSize: fileSize,
            processingMethod: fileSize > 500000 ? 'streaming' : 'standard'
        }
    };
}

// Intelligent file size-based tool selection
async function _editFile({ filename, content, edits }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required.");
    
    // Auto-detect best approach based on file size and edit type
    if (content !== undefined && edits !== undefined) {
        throw new Error("Provide either 'content' OR 'edits', not both.");
    }
    
    if (content !== undefined) {
        // Check if file exists and its size to determine best approach
        try {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
            const file = await fileHandle.getFile();
            const fileSize = file.size;
            
            // For very large files, suggest using edits instead
            if (fileSize > 1000000) { // 1MB threshold
                console.warn(`File ${filename} is large (${fileSize} bytes). Consider using 'edits' for better performance.`);
            }
        } catch (e) {
            // File doesn't exist, will be created
        }
        
        return await _rewriteFile({ filename, content }, rootHandle);
    }
    
    // If edits provided, use smart editing (for large files)
    if (edits !== undefined) {
        // Basic validation before passing to _smartEditFile
        if (!Array.isArray(edits)) {
            throw new Error("The 'edits' parameter must be an array of edit objects.");
        }
        
        // Validate that at least one edit exists
        if (edits.length === 0) {
            throw new Error("The 'edits' array must contain at least one edit object.");
        }
        
        return await _smartEditFile({ filename, edits }, rootHandle);
    }
    
    throw new Error("Either 'content' (for full rewrite) or 'edits' (for targeted changes) must be provided.");
}

// Fast append for logs and incremental files
async function _appendToFile({ filename, content }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required.");
    if (!content) throw new Error("The 'content' parameter is required.");
    
    const cleanContent = stripMarkdownCodeBlock(content);
    
    try {
        const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
        
        // Enhanced permission handling - try to proceed even if permission check fails
        let hasPermission = false;
        try {
            hasPermission = await FileSystem.verifyAndRequestPermission(fileHandle, true);
        } catch (permissionError) {
            console.warn('Permission check failed, attempting to proceed:', permissionError.message);
            hasPermission = true; // Optimistically proceed
        }
        
        if (!hasPermission) {
            throw new Error('Permission to write to the file was denied.');
        }
        
        // Get existing content
        const file = await fileHandle.getFile();
        const existingContent = await file.text();
        
        // Append new content
        const newContent = existingContent + (existingContent ? '\n' : '') + cleanContent;
        
        const writable = await fileHandle.createWritable();
        await writable.write(newContent);
        await writable.close();
        
        return { 
            message: `Content appended to '${filename}' successfully.`,
            details: { appendedBytes: cleanContent.length }
        };
    } catch (error) {
        if (error.name === 'NotFoundError') {
            // File doesn't exist, create it
            return await _createFile({ filename, content: cleanContent }, rootHandle);
        }
        throw error;
    }
}

// Get file size and metadata without reading content
async function _getFileInfo({ filename }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required.");
    
    try {
        const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
        const file = await fileHandle.getFile();
        
        return {
            message: `File info for '${filename}':`,
            details: {
                name: file.name,
                size: file.size,
                lastModified: new Date(file.lastModified).toISOString(),
                type: file.type || 'text/plain'
            }
        };
    } catch (error) {
        if (error.name === 'NotFoundError') {
            throw new Error(`File '${filename}' does not exist.`);
        }
        throw error;
    }
}

// --- Unified Task Management Tool Handlers ---

async function _taskCreate({ title, description = '', priority = 'medium', parentId = null, listId = null }) {
    if (!title) throw new Error("The 'title' parameter is required.");
    if (typeof title !== 'string') throw new Error("The 'title' parameter must be a string.");
    if (priority && !['low', 'medium', 'high', 'urgent'].includes(priority)) {
        throw new Error("The 'priority' parameter must be one of: low, medium, high, urgent.");
    }
    
    try {
        const task = await TaskTools.create({ title, description, priority, parentId, listId });
        return {
            message: `Task "${title}" created with ID ${task.id}.`,
            details: task
        };
    } catch (error) {
        throw new Error(`Failed to create task: ${error.message}`);
    }
}

async function _taskUpdate({ taskId, updates }) {
    if (!taskId || !updates) {
        throw new Error("The 'task_update' tool is missing required parameters. You MUST provide both a 'taskId' (string) and an 'updates' (object). For example: { taskId: 'task_123', updates: { status: 'in_progress', notes: 'Started working on the task.' } }");
    }
    if (typeof taskId !== 'string') throw new Error("The 'taskId' parameter must be a string.");
    if (typeof updates !== 'object' || updates === null) throw new Error("The 'updates' parameter must be an object.");
    
    try {
        const task = await TaskTools.update(taskId, updates);
        return {
            message: `Task "${task.title}" (ID: ${taskId}) updated.`,
            details: task
        };
    } catch (error) {
        throw new Error(`Failed to update task ${taskId}: ${error.message}`);
    }
}

async function _taskDelete({ taskId }) {
    if (!taskId) throw new Error("The 'taskId' parameter is required.");
    if (typeof taskId !== 'string') throw new Error("The 'taskId' parameter must be a string.");
    
    try {
        const task = await TaskTools.delete(taskId);
        return {
            message: `Task "${task.title}" (ID: ${taskId}) and all its subtasks have been deleted.`,
            details: task
        };
    } catch (error) {
        throw new Error(`Failed to delete task ${taskId}: ${error.message}`);
    }
}

async function _taskBreakdown({ taskId }) {
    if (!taskId) throw new Error("The 'taskId' parameter is required.");
    if (typeof taskId !== 'string') throw new Error("The 'taskId' parameter must be a string.");
    
    try {
        const mainTask = TaskTools.getById(taskId);
        if (!mainTask) throw new Error(`Task with ID ${taskId} not found.`);
        
        const subtasks = await TaskTools.breakdown(mainTask);
        return {
            message: `Goal "${mainTask.title}" has been broken down into ${subtasks.length} subtasks.`,
            details: {
                mainTask,
                subtasks
            }
        };
    } catch (error) {
        throw new Error(`Failed to breakdown task ${taskId}: ${error.message}`);
    }
}

async function _taskGetNext() {
    try {
        const nextTask = TaskTools.getNext();
        if (!nextTask) {
            return {
                message: "No actionable tasks are currently available. All tasks may be completed or blocked by dependencies.",
                details: null
            };
        }
        return {
            message: `The next actionable task is "${nextTask.title}".`,
            details: nextTask
        };
    } catch (error) {
        throw new Error(`Failed to get next task: ${error.message}`);
    }
}

async function _taskGetStatus({ taskId }) {
    try {
        if (taskId) {
            if (typeof taskId !== 'string') throw new Error("The 'taskId' parameter must be a string.");
            
            const task = TaskTools.getById(taskId);
            if (!task) {
                return {
                    message: `Task with ID ${taskId} not found.`,
                    details: null
                };
            }
            return {
                message: `Task "${task.title}" is currently ${task.status}.`,
                details: task
            };
        } else {
            // Get overall status of all tasks
            const allTasks = TaskTools.getAll();
            const stats = {
                total: allTasks.length,
                pending: allTasks.filter(t => t.status === 'pending').length,
                in_progress: allTasks.filter(t => t.status === 'in_progress').length,
                completed: allTasks.filter(t => t.status === 'completed').length,
                failed: allTasks.filter(t => t.status === 'failed').length
            };
            
            const activeTasks = allTasks.filter(t => t.status === 'in_progress');
            const nextTask = TaskTools.getNext();
            
            return {
                message: `Task Status Overview: ${stats.total} total, ${stats.pending} pending, ${stats.in_progress} in progress, ${stats.completed} completed, ${stats.failed} failed.`,
                details: {
                    stats,
                    activeTasks,
                    nextTask,
                    recentTasks: allTasks.sort((a, b) => (b.updatedTime || b.createdTime) - (a.updatedTime || a.createdTime)).slice(0, 5)
                }
            };
        }
    } catch (error) {
        throw new Error(`Failed to get task status: ${error.message}`);
    }
}
async function _startTaskSession({ taskId, description = '', duration = null }) {
    if (!taskId) throw new Error("The 'taskId' parameter is required.");
    if (typeof taskId !== 'string') throw new Error("The 'taskId' parameter must be a string.");
    
    try {
        const task = TaskTools.getById(taskId);
        if (!task) {
            throw new Error(`Task with ID ${taskId} not found.`);
        }
        
        const session = await TaskTools.startSession(taskId, { description, duration });
        return {
            message: `Task session started for "${task.title}" (ID: ${taskId})`,
            details: session
        };
    } catch (error) {
        throw new Error(`Failed to start task session: ${error.message}`);
    }
}

async function _createFolder({ folder_path }, rootHandle) {
    if (!folder_path) throw new Error("The 'folder_path' parameter is required for create_folder.");
    if (typeof folder_path !== 'string') throw new Error("The 'folder_path' parameter must be a string.");
    
    try {
        await FileSystem.createDirectoryFromPath(rootHandle, folder_path);
        
        // Use more reliable refresh timing
        await new Promise(resolve => setTimeout(resolve, 150));
        await UI.refreshFileTree(rootHandle, (filePath) => {
            const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
            Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
        });
        
        return { message: `Folder '${folder_path}' created successfully.` };
    } catch (error) {
        throw new Error(`Failed to create folder '${folder_path}': ${error.message}`);
    }
}

async function _deleteFolder({ folder_path }, rootHandle) {
    if (!folder_path) throw new Error("The 'folder_path' parameter is required for delete_folder.");
    if (typeof folder_path !== 'string') throw new Error("The 'folder_path' parameter must be a string.");
    
    try {
        const { parentHandle, entryName } = await FileSystem.getParentDirectoryHandle(rootHandle, folder_path);
        await parentHandle.removeEntry(entryName, { recursive: true });
        
        // Close any open files from the deleted folder
        const openFiles = Editor.getOpenFiles();
        for (const [filePath] of openFiles) {
            if (filePath.startsWith(folder_path + '/')) {
                Editor.closeTab(filePath, document.getElementById('tab-bar'));
            }
        }
        
        // Use more reliable refresh timing
        await new Promise(resolve => setTimeout(resolve, 150));
        await UI.refreshFileTree(rootHandle, (filePath) => {
            const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
            Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
        });
        
        return { message: `Folder '${folder_path}' deleted successfully.` };
    } catch (error) {
        throw new Error(`Failed to delete folder '${folder_path}': ${error.message}`);
    }
}

async function _renameFolder({ old_folder_path, new_folder_path }, rootHandle) {
    if (!old_folder_path || !new_folder_path) {
        throw new Error("The 'old_folder_path' and 'new_folder_path' parameters are required for rename_folder.");
    }
    if (typeof old_folder_path !== 'string' || typeof new_folder_path !== 'string') {
        throw new Error("The 'old_folder_path' and 'new_folder_path' parameters must be strings.");
    }
    
    try {
        await FileSystem.renameEntry(rootHandle, old_folder_path, new_folder_path);
        
        // Update any open files from the renamed folder
        const openFiles = Editor.getOpenFiles();
        const filesToUpdate = [];
        for (const [filePath] of openFiles) {
            if (filePath.startsWith(old_folder_path + '/')) {
                const newFilePath = filePath.replace(old_folder_path, new_folder_path);
                filesToUpdate.push({ oldPath: filePath, newPath: newFilePath });
            }
        }
        
        // Close old tabs and open new ones
        for (const { oldPath, newPath } of filesToUpdate) {
            Editor.closeTab(oldPath, document.getElementById('tab-bar'));
            try {
                const newFileHandle = await FileSystem.getFileHandleFromPath(rootHandle, newPath);
                await Editor.openFile(newFileHandle, newPath, document.getElementById('tab-bar'), false);
            } catch (e) {
                console.warn(`Failed to reopen file ${newPath}:`, e.message);
            }
        }
        
        // Use more reliable refresh timing
        await new Promise(resolve => setTimeout(resolve, 150));
        await UI.refreshFileTree(rootHandle, (filePath) => {
            const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
            Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
        });
        
        return { message: `Folder '${old_folder_path}' renamed to '${new_folder_path}' successfully.` };
    } catch (error) {
        throw new Error(`Failed to rename folder '${old_folder_path}' to '${new_folder_path}': ${error.message}`);
    }
}

async function _searchCode({ search_term }, rootHandle) {
    if (!search_term) throw new Error("The 'search_term' parameter is required for search_code.");
    if (typeof search_term !== 'string') throw new Error("The 'search_term' parameter must be a string.");
    
    if (!backgroundIndexer.isAvailable()) {
        throw new Error("The background indexer is not ready. Please wait a moment and try again.");
    }
    
    try {
        const searchResults = await backgroundIndexer.searchInIndex(search_term);
       
        const successfulResults = searchResults.filter(r => r.matches);
        const erroredFiles = searchResults.filter(r => r.error);

        let summary = `Search complete. Found ${successfulResults.length} files with matches.`;
        if (erroredFiles.length > 0) {
            summary += ` Failed to search ${erroredFiles.length} files.`;
        }

        return {
           summary: summary,
           results: successfulResults,
           errors: erroredFiles
        };
    } catch (error) {
        throw new Error(`Search failed: ${error.message}`);
    }
}

async function _buildCodebaseIndex(params, rootHandle) {
    const startTime = Date.now();
    UI.appendMessage(document.getElementById('chat-messages'), 'Checking for updates and building codebase index...', 'ai');

    const lastIndexTimestamp = await DbManager.getLastIndexTimestamp() || 0;
    const existingIndex = await DbManager.getCodeIndex();
    
    const ignorePatterns = await FileSystem.getIgnorePatterns(rootHandle);
    const { index: newIndex, stats } = await CodebaseIndexer.buildIndex(rootHandle, { lastIndexTimestamp, existingIndex, ignorePatterns });
    
    await DbManager.saveCodeIndex(newIndex);
    await DbManager.saveLastIndexTimestamp(startTime);

    const message = `Codebase index updated. ${stats.indexedFileCount} files indexed, ${stats.skippedFileCount} files skipped (unchanged), ${stats.deletedFileCount} files removed.`;
    return { message };
}

async function _queryCodebase({ query }) {
    const index = await DbManager.getCodeIndex();
    if (!index) throw new Error("No codebase index. Please run 'build_or_update_codebase_index'.");
    const queryResults = await CodebaseIndexer.queryIndex(index, query);
    return { results: queryResults };
}

async function _reindexCodebasePaths({ paths }, rootHandle) {
    if (!paths || !Array.isArray(paths) || paths.length === 0) {
        throw new Error("The 'paths' parameter is required and must be a non-empty array.");
    }

    UI.appendMessage(document.getElementById('chat-messages'), `Re-indexing ${paths.length} specific paths...`, 'ai');
    
    const index = await DbManager.getCodeIndex();
    if (!index) {
        throw new Error("No codebase index found. Please run 'build_or_update_codebase_index' first.");
    }
    const stats = { indexedFileCount: 0, skippedFileCount: 0, deletedFileCount: 0 };
    const ignorePatterns = await FileSystem.getIgnorePatterns(rootHandle);

    await CodebaseIndexer.reIndexPaths(rootHandle, paths, index, stats, ignorePatterns);

    await DbManager.saveCodeIndex(index);
    
    const message = `Re-indexing complete for specified paths. ${stats.indexedFileCount} files were updated.`;
    return { message };
}

async function _formatCode({ filename }, rootHandle) {
    return new Promise(async (resolve, reject) => {
        if (!filename) {
            return reject(new Error("The 'filename' parameter is required."));
        }

        try {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
            const file = await fileHandle.getFile();
            const originalContent = await file.text();
            UndoManager.push(filename, originalContent);
            const parser = Editor.getPrettierParser(filename);
            
            if (!parser) {
                return reject(new Error(`Could not determine Prettier parser for file: ${filename}`));
            }

            const prettierWorker = new Worker('prettier.worker.js');

            prettierWorker.onmessage = async (event) => {
                if (event.data.success) {
                    const formattedCode = event.data.formattedCode;
                    
                    if (!await FileSystem.verifyAndRequestPermission(fileHandle, true)) {
                        return reject(new Error('Permission to write to the file was denied.'));
                    }
                    
                    const writable = await fileHandle.createWritable();
                    await writable.write(formattedCode);
                    await writable.close();

                    if (Editor.getOpenFiles().has(filename)) {
                        Editor.getOpenFiles().get(filename)?.model.setValue(formattedCode);
                    }
                    
                    resolve({ message: `File '${filename}' formatted successfully.` });
                } else {
                    console.error('Error formatting file from worker:', event.data.error);
                    reject(new Error(`An error occurred while formatting the file: ${event.data.error}`));
                }
                prettierWorker.terminate();
            };
            
            prettierWorker.onerror = (error) => {
                reject(new Error(`Prettier worker error: ${error.message}`));
                prettierWorker.terminate();
            };

            prettierWorker.postMessage({ code: originalContent, parser });

        } catch (error) {
            reject(new Error(`Failed to format code: ${error.message}`));
        }
    });
}

async function _analyzeCode({ filename }, rootHandle) {
    if (!filename.endsWith('.js') && !filename.endsWith('.ts') && !filename.endsWith('.jsx') && !filename.endsWith('.tsx')) {
        throw new Error('This tool can only analyze JavaScript/TypeScript files. Use read_file for others.');
    }
    
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    const file = await fileHandle.getFile();
    const content = await file.text();
    
    try {
        // Use cached AST parsing with worker
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
        
        // Fallback to basic regex-based analysis
        const basicAnalysis = {
            functions: [],
            classes: [],
            imports: [],
            variables: []
        };
        
        // Extract functions
        const functionMatches = content.match(/(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g) || [];
        functionMatches.forEach(match => {
            const name = match.match(/(?:function\s+(\w+)|const\s+(\w+))/)?.[1] || match.match(/(?:function\s+(\w+)|const\s+(\w+))/)?.[2];
            if (name) {
                basicAnalysis.functions.push({ name, type: 'function' });
            }
        });
        
        // Extract classes
        const classMatches = content.match(/class\s+(\w+)/g) || [];
        classMatches.forEach(match => {
            const name = match.replace('class ', '');
            basicAnalysis.classes.push({ name, type: 'class' });
        });
        
        // Extract imports
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

// REMOVED: validateTerminalCommand - No longer needed since run_terminal_command has been removed

// REMOVED: _runTerminalCommand - This tool has been removed to maintain the client-centric architecture.
// Terminal operations are not needed for a browser-based code editor focused on file editing.
// This eliminates security risks and backend dependencies for command execution.

// REMOVED: escapeShellArg - No longer needed since terminal commands have been removed

// REMOVED: _getFileHistory - Git operations removed to maintain client-centric architecture.
// File history can be implemented using browser-based git libraries if needed in the future.
async function _getFileHistory({ filename }, rootHandle) {
    throw new Error("File history feature has been disabled. This browser-based editor focuses on file editing without requiring git/terminal access. Consider using your local git client for version control operations.");
}

// --- Non-Project Tools ---

async function _readUrl({ url }) {
    const response = await fetch('/api/read-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    const urlResult = await response.json();
    if (response.ok) {
        return urlResult;
    } else {
        throw new Error(urlResult.message || 'Failed to read URL');
    }
}

async function _duckduckgoSearch({ query }) {
    const response = await fetch('/api/duckduckgo-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const searchResult = await response.json();
    if (response.ok) {
        return searchResult;
    } else {
        throw new Error(searchResult.message || 'Failed to perform search');
    }
}

/**
 * Performs comprehensive web research using a sophisticated three-stage approach:
 *
 * Stage 1: Broad keyword extraction and parallel search waves
 * - Extracts key concepts from the original query
 * - Generates multiple search queries to explore different aspects
 * - Executes searches in parallel for faster and broader initial exploration
 * - Scores and prioritizes URLs based on multiple relevance factors
 *
 * Stage 2: Link aggregation and first-pass analysis
 * - Analyzes content gathered in Stage 1
 * - Identifies knowledge gaps (important topics with limited coverage)
 * - Extracts keywords from content for targeted follow-up
 * - Generates targeted search queries to fill knowledge gaps
 *
 * Stage 3: Focused content reading and synthesis
 * - Executes targeted searches to fill identified knowledge gaps
 * - Prioritizes the most authoritative and relevant sources
 * - Focuses on depth rather than breadth at this stage
 * - Aggregates comprehensive information across all stages
 *
 * This multi-stage approach provides more thorough research than single-pass methods
 * by first prioritizing breadth of coverage, then identifying gaps, and finally
 * filling those gaps with focused research.
 *
 * Tasks are properly linked and managed through the task management system,
 * ensuring all subtasks are completed in sequence and no tasks are left incomplete.
 *
 * @param {Object} params - Research parameters
 * @param {string} params.query - The research query or topic to investigate
 * @param {number} [params.max_results=3] - Maximum URLs to read per search (default: 3)
 * @param {number} [params.depth=2] - Maximum recursion depth (default: 2)
 * @param {number} [params.relevance_threshold=0.7] - Minimum relevance score to read URLs (0.3-1.0)
 * @param {string} [params.task_id] - Optional ID of a parent task to link with
 * @returns {Object} Research results containing summary, full content, and metadata
 */
async function _performResearch({ query, max_results = 3, depth = 2, relevance_threshold = 0.7, task_id = null }) {
    if (!query) throw new Error("The 'query' parameter is required for perform_research.");
    
    // Get task manager if a task_id is provided
    let taskTools = null;
    let stageTasks = {
        stage1: null,
        stage2: null,
        stage3: null,
        parent: task_id
    };
    
    // If task_id is provided, try to get task info and subtasks
    if (task_id) {
        try {
            // Import TaskTools dynamically to avoid circular dependencies
            const { TaskTools } = await import('./task_manager.js');
            taskTools = TaskTools;
            
            // Get the parent task
            const parentTask = taskTools.getById(task_id);
            if (parentTask) {
                console.log(`[Research] Linked to parent task: ${parentTask.title} (ID: ${task_id})`);
                
                // Get subtasks for each stage if they exist
                const subtasks = parentTask.subtasks
                    .map(id => taskTools.getById(id))
                    .filter(task => task !== undefined);
                
                // Find stage tasks by tags or title
                for (const task of subtasks) {
                    if (task.tags?.includes('stage-1') || task.title?.includes('Stage 1')) {
                        stageTasks.stage1 = task.id;
                    } else if (task.tags?.includes('stage-2') || task.title?.includes('Stage 2')) {
                        stageTasks.stage2 = task.id;
                    } else if (task.tags?.includes('stage-3') || task.title?.includes('Stage 3')) {
                        stageTasks.stage3 = task.id;
                    }
                }
            }
        } catch (error) {
            console.warn(`[Research] Failed to get task information: ${error.message}`);
            // Continue without task linking if there's an error
        }
    }

    // Research state tracking with enhanced multi-stage capabilities
    const researchState = {
        originalQuery: query,
        visitedUrls: new Set(),
        allContent: [],
        references: [],
        searchHistory: [],
        searchQueries: [],          // Store all generated search queries
        urlsByRelevance: [],        // URLs sorted by relevance score
        keywordExtractions: [],     // Keywords extracted from query and content
        currentStage: 1,            // Track current research stage (1-3)
        priorityQueue: [],          // Queue of URLs to read, sorted by priority
        contentSummaries: [],       // Summaries of processed content
        knowledgeGaps: [],          // Identified gaps in the research
        maxDepth: Math.min(depth, 4),
        maxResults: Math.min(max_results, 6),  // Increased for broader first stage
        totalUrlsRead: 0,
        maxTotalUrls: 20,           // Increased for multi-stage approach
        relevanceThreshold: Math.max(0.3, Math.min(relevance_threshold, 1.0)),
        parallelSearches: 3,        // Number of parallel searches in first stage
        stageOneComplete: false,
        stageTwoComplete: false,
        stageThreeComplete: false,
        taskId: task_id,
        stageTasks: stageTasks,
        taskTools: taskTools
    };

    /**
     * Stage 1: Keyword extraction and query generation
     * Extracts key concepts from original query and generates multiple search queries
     */
    function extractKeywordsAndGenerateQueries(query, maxQueries = 5) {
        console.log(`[Research Stage 1] Extracting keywords from: "${query}"`);
        
        // Clean the query and split into words
        const cleanQuery = query.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
            
        const words = cleanQuery.split(' ');
        
        // Extract main concepts (words longer than 3 chars, not stopwords)
        const stopwords = ['and', 'the', 'for', 'with', 'that', 'this', 'from', 'what', 'how', 'why', 'when', 'where', 'who'];
        const concepts = words.filter(word =>
            word.length > 3 && !stopwords.includes(word));
            
        // Record the keyword extraction
        researchState.keywordExtractions.push({
            source: 'original_query',
            query: query,
            extractedConcepts: concepts,
            timestamp: new Date().toISOString()
        });
        
        // Generate variations of search queries
        const searchQueries = [];
        
        // 1. The original query
        searchQueries.push(query);
        
        // 2. Focused queries with pairs of concepts
        if (concepts.length >= 2) {
            for (let i = 0; i < concepts.length - 1; i++) {
                for (let j = i + 1; j < concepts.length; j++) {
                    const focusedQuery = `${concepts[i]} ${concepts[j]} ${query.includes('how') || query.includes('what') ? query.split(' ').slice(0, 3).join(' ') : ''}`.trim();
                    searchQueries.push(focusedQuery);
                }
            }
        }
        
        // 3. Add "guide", "tutorial", "explained" to create more instructional queries
        const instructionalTerms = ['guide', 'tutorial', 'explained', 'overview'];
        const mainConcepts = concepts.slice(0, 3).join(' ');
        instructionalTerms.forEach(term => {
            searchQueries.push(`${mainConcepts} ${term}`);
        });
        
        // Deduplicate and take top queries
        const uniqueQueries = [...new Set(searchQueries)];
        const finalQueries = uniqueQueries.slice(0, maxQueries);
        
        console.log(`[Research Stage 1] Generated ${finalQueries.length} search queries:`, finalQueries);
        return finalQueries;
    }

    /**
     * Scores URL relevance based on comprehensive criteria
     * Returns a score between 0 and 1
     */
    function scoreUrlRelevance(url, title, snippet, searchQuery) {
        // Base score starts at 0.5
        let relevanceScore = 0.5;
        
        // Domain reputation scoring - weighted more heavily in multi-stage approach
        const domainScores = {
            // Tier 1: Highly authoritative sources
            'wikipedia.org': 0.30,
            '.edu': 0.25,
            '.gov': 0.25,
            'github.com': 0.20,
            
            // Tier 2: Technical and documentation sites
            'docs.': 0.20,
            'developer.': 0.20,
            'mozilla.org': 0.20,
            'w3.org': 0.20,
            'stackoverflow.com': 0.15,
            
            // Tier 3: Other reputable sites
            'ieee.org': 0.15,
            'acm.org': 0.15,
            'medium.com': 0.10,
            'research': 0.10,
            
            // Negative scoring for spam/ad domains
            'ads.': -0.50,
            'tracker.': -0.50,
            'affiliate.': -0.40,
            'popup.': -0.40,
            'analytics.': -0.30
        };
        
        // Apply domain scoring
        for (const [domain, score] of Object.entries(domainScores)) {
            if (url.includes(domain)) {
                relevanceScore += score;
                break; // Only apply the highest matching domain score
            }
        }
        
        // Content relevance based on title and snippet
        const queryTerms = searchQuery.toLowerCase().split(/\s+/);
        const contentText = `${title} ${snippet}`.toLowerCase();
        
        // Score based on percentage of query terms found in the content
        const termMatches = queryTerms.filter(term => contentText.includes(term)).length;
        relevanceScore += (termMatches / queryTerms.length) * 0.35;
        
        // Special content type bonuses
        const contentTypeScores = {
            'tutorial': 0.15,
            'guide': 0.15,
            'documentation': 0.15,
            'explained': 0.10,
            'how to': 0.10,
            'introduction': 0.10,
            'overview': 0.10,
            'example': 0.10,
            'reference': 0.10
        };
        
        // Apply content type scoring
        for (const [type, score] of Object.entries(contentTypeScores)) {
            if (title.toLowerCase().includes(type) || snippet.toLowerCase().includes(type)) {
                relevanceScore += score;
            }
        }
        
        // URL structure scoring
        const urlPathScores = {
            '/docs/': 0.15,
            '/tutorial/': 0.15,
            '/guide/': 0.15,
            '/learn/': 0.10,
            '/reference/': 0.10,
            '/examples/': 0.10,
            '/article/': 0.05
        };
        
        // Apply URL path scoring
        for (const [path, score] of Object.entries(urlPathScores)) {
            if (url.includes(path)) {
                relevanceScore += score;
                break; // Only apply the highest matching path score
            }
        }
        
        // File type bonuses for downloadable resources
        if (url.match(/\.(pdf|doc|docx)$/i)) {
            relevanceScore += 0.10; // Documents often contain comprehensive information
        }
        
        // Normalize score to 0-1 range
        relevanceScore = Math.max(0, Math.min(1, relevanceScore));
        
        return relevanceScore;
    }

    /**
     * Executes searches in parallel to quickly gather broad initial results
     */
    async function executeParallelSearches(searchQueries) {
        console.log(`[Research Stage 1] Executing ${searchQueries.length} parallel searches`);
        
        const searchPromises = searchQueries.map(async (query, index) => {
            try {
                UI.appendMessage(document.getElementById('chat-messages'),
                    `🔍 Search ${index + 1}/${searchQueries.length}: "${query}"`, 'ai');
                
                const results = await _duckduckgoSearch({ query });
                
                // Record the search
                researchState.searchHistory.push({
                    query,
                    stage: 1,
                    resultCount: results.results?.length || 0,
                    timestamp: new Date().toISOString()
                });
                
                if (!results.results || results.results.length === 0) {
                    console.log(`[Research Stage 1] No results for query: "${query}"`);
                    return [];
                }
                
                // Score and return URL information
                return results.results.map(result => ({
                    url: result.link,
                    title: result.title,
                    snippet: result.snippet,
                    query: query,
                    relevanceScore: scoreUrlRelevance(result.link, result.title, result.snippet, query),
                    stage: 1,
                    processed: false
                }));
            } catch (error) {
                console.error(`[Research Stage 1] Search failed for "${query}":`, error.message);
                return [];  // Return empty array on error to continue with other searches
            }
        });
        
        // Wait for all searches to complete
        const allSearchResults = await Promise.all(searchPromises);
        
        // Flatten results and remove duplicates
        const flatResults = allSearchResults.flat();
        const uniqueResults = [];
        const seenUrls = new Set();
        
        flatResults.forEach(result => {
            if (!seenUrls.has(result.url)) {
                seenUrls.add(result.url);
                uniqueResults.push(result);
            }
        });
        
        // Sort by relevance score
        uniqueResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
        
        console.log(`[Research Stage 1] Aggregated ${uniqueResults.length} unique URLs from all searches`);
        return uniqueResults;
    }

    /**
     * Decides whether a URL should be read based on relevance to the research goal
     * Enhanced for multi-stage approach
     */
    function shouldReadUrl(urlInfo, stage) {
        // Already processed or visited
        if (researchState.visitedUrls.has(urlInfo.url)) return false;
        if (researchState.totalUrlsRead >= researchState.maxTotalUrls) return false;
        
        // Stage-specific threshold adjustment
        let stageThreshold = researchState.relevanceThreshold;
        
        if (stage === 1) {
            // More permissive in first stage to gather broad information
            stageThreshold -= 0.2;
        } else if (stage === 3) {
            // More strict in final stage to focus on highest quality
            stageThreshold += 0.1;
        }
        
        // Apply threshold check
        const shouldRead = urlInfo.relevanceScore >= stageThreshold;
        
        console.log(`[Research Stage ${stage}] URL: ${urlInfo.url} | Score: ${urlInfo.relevanceScore.toFixed(2)} | Threshold: ${stageThreshold.toFixed(2)} | Read: ${shouldRead}`);
        
        return shouldRead;
    }

    /**
     * Processes a URL by reading its content and analyzing it
     */
    async function processUrl(urlInfo, stage) {
        if (researchState.visitedUrls.has(urlInfo.url)) {
            return null;
        }
        
        researchState.visitedUrls.add(urlInfo.url);
        researchState.references.push(urlInfo.url);
        researchState.totalUrlsRead++;
        
        try {
            UI.appendMessage(document.getElementById('chat-messages'),
                `📖 Reading: ${urlInfo.title || urlInfo.url} (Stage ${stage})`, 'ai');
            
            const urlContent = await _readUrl({ url: urlInfo.url });
            
            if (!urlContent.content || !urlContent.content.trim()) {
                console.warn(`[Research Stage ${stage}] No content found for URL: ${urlInfo.url}`);
                return null;
            }
            
            // Create content entry with stage information
            const contentEntry = {
                url: urlInfo.url,
                title: urlInfo.title,
                snippet: urlInfo.snippet,
                content: urlContent.content,
                links: urlContent.links || [],
                stage: stage,
                relevanceScore: urlInfo.relevanceScore,
                timestamp: new Date().toISOString()
            };
            
            researchState.allContent.push(contentEntry);
            console.log(`[Research Stage ${stage}] Successfully read content from ${urlInfo.url}`);
            
            return contentEntry;
        } catch (error) {
            console.warn(`[Research Stage ${stage}] Failed to read URL ${urlInfo.url}:`, error.message);
            
            // Track failed URLs
            researchState.allContent.push({
                url: urlInfo.url,
                title: urlInfo.title,
                content: `Error reading content: ${error.message}`,
                links: [],
                stage: stage,
                error: true,
                timestamp: new Date().toISOString()
            });
            
            return null;
        }
    }

    /**
     * Extracts relevant keywords from the content for further searches
     */
    function extractKeywordsFromContent(contentEntry) {
        if (!contentEntry || !contentEntry.content) return [];
        
        // Extract most relevant terms from content
        const content = contentEntry.content.toLowerCase();
        const words = content
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 3);
            
        // Count word frequencies
        const wordFreq = {};
        words.forEach(word => {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
        });
        
        // Get original query terms to exclude
        const queryTerms = researchState.originalQuery.toLowerCase().split(/\s+/);
        
        // Find frequently mentioned terms not in original query
        const frequentTerms = Object.entries(wordFreq)
            .filter(([word, freq]) =>
                freq >= 5 && !queryTerms.includes(word))  // Higher threshold than original
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([word]) => word);
            
        // Record the extraction
        researchState.keywordExtractions.push({
            source: 'content',
            url: contentEntry.url,
            extractedKeywords: frequentTerms,
            timestamp: new Date().toISOString()
        });
        
        return frequentTerms;
    }

    /**
     * Stage 2: Content analysis and knowledge gap identification
     */
    function analyzeContentAndIdentifyGaps() {
        console.log(`[Research Stage 2] Analyzing ${researchState.allContent.length} content items from Stage 1`);
        
        // Create a map of key topics and their coverage
        const topicCoverage = {};
        const allKeywords = [];
        
        // Extract all keywords from content gathered in Stage 1
        researchState.allContent
            .filter(item => !item.error && item.stage === 1)
            .forEach(item => {
                const keywords = extractKeywordsFromContent(item);
                allKeywords.push(...keywords);
                
                // Map keywords to the content that covers them
                keywords.forEach(keyword => {
                    if (!topicCoverage[keyword]) {
                        topicCoverage[keyword] = [];
                    }
                    topicCoverage[keyword].push(item.url);
                });
            });
            
        // Count keyword frequencies across all content
        const keywordFreq = {};
        allKeywords.forEach(keyword => {
            keywordFreq[keyword] = (keywordFreq[keyword] || 0) + 1;
        });
        
        // Sort keywords by frequency
        const sortedKeywords = Object.entries(keywordFreq)
            .sort(([,a], [,b]) => b - a)
            .map(([keyword]) => keyword);
            
        // Identify knowledge gaps (important keywords with limited coverage)
        const knowledgeGaps = [];
        sortedKeywords.slice(0, 10).forEach(keyword => {
            const coverage = topicCoverage[keyword] || [];
            if (coverage.length < 2) {  // Only mentioned in 0 or 1 sources
                knowledgeGaps.push({
                    keyword: keyword,
                    coverageCount: coverage.length,
                    sources: coverage
                });
            }
        });
        
        console.log(`[Research Stage 2] Identified ${knowledgeGaps.length} knowledge gaps:`,
            knowledgeGaps.map(gap => gap.keyword));
            
        researchState.knowledgeGaps = knowledgeGaps;
        
        // Generate targeted search queries for knowledge gaps
        const gapQueries = knowledgeGaps.map(gap => {
            const query = `${researchState.originalQuery} ${gap.keyword}`;
            return query;
        });
        
        return gapQueries;
    }

    /**
     * Stage 3: Focused reading based on knowledge gaps
     */
    async function performFocusedReading(gapQueries) {
        console.log(`[Research Stage 3] Performing focused reading for ${gapQueries.length} knowledge gaps`);
        
        // Execute targeted searches for each knowledge gap
        for (const query of gapQueries) {
            try {
                UI.appendMessage(document.getElementById('chat-messages'),
                    `🔍 Focused search: "${query}" (Stage 3)`, 'ai');
                
                const searchResults = await _duckduckgoSearch({ query });
                
                researchState.searchHistory.push({
                    query,
                    stage: 3,
                    resultCount: searchResults.results?.length || 0,
                    timestamp: new Date().toISOString()
                });
                
                if (!searchResults.results || searchResults.results.length === 0) {
                    console.log(`[Research Stage 3] No results for gap query: "${query}"`);
                    continue;
                }
                
                // Score and prioritize results
                const scoredResults = searchResults.results.map(result => ({
                    url: result.link,
                    title: result.title,
                    snippet: result.snippet,
                    query: query,
                    relevanceScore: scoreUrlRelevance(result.link, result.title, result.snippet, query),
                    stage: 3,
                    processed: false
                }));
                
                // Sort by relevance and take top results
                scoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
                const topResults = scoredResults.slice(0, 2);  // Limit to 2 per gap
                
                // Process the most relevant results
                for (const urlInfo of topResults) {
                    if (researchState.totalUrlsRead >= researchState.maxTotalUrls) break;
                    
                    if (shouldReadUrl(urlInfo, 3)) {
                        await processUrl(urlInfo, 3);
                    }
                }
                
            } catch (error) {
                console.error(`[Research Stage 3] Search failed for gap query "${query}":`, error.message);
                continue;  // Continue with other gap queries
            }
        }
    }

    /**
     * Main research execution function
     */
    async function executeResearch() {
        try {
            UI.appendMessage(document.getElementById('chat-messages'),
                `🚀 Starting multi-stage research for: "${query}"`, 'ai');
            
            // Stage 1: Broad exploration with parallel searches
            UI.appendMessage(document.getElementById('chat-messages'),
                `🔬 Stage 1: Extracting key concepts and performing broad exploration...`, 'ai');
                
            // Generate multiple search queries from original query
            const searchQueries = extractKeywordsAndGenerateQueries(query);
            researchState.searchQueries = searchQueries;
            
            // Execute searches in parallel
            const urlsByRelevance = await executeParallelSearches(searchQueries);
            researchState.urlsByRelevance = urlsByRelevance;
            
            // Select and process the most relevant URLs from Stage 1
            const topUrlsForStage1 = urlsByRelevance.slice(0, Math.min(10, urlsByRelevance.length));
            
            for (const urlInfo of topUrlsForStage1) {
                if (researchState.totalUrlsRead >= researchState.maxTotalUrls / 2) break;
                
                if (shouldReadUrl(urlInfo, 1)) {
                    await processUrl(urlInfo, 1);
                }
            }
            
            researchState.stageOneComplete = true;
            console.log(`[Research] Stage 1 complete. Processed ${researchState.allContent.length} content items.`);
            
            // Update Stage 1 task status if it exists
            if (researchState.taskTools && researchState.stageTasks.stage1) {
                await researchState.taskTools.update(researchState.stageTasks.stage1, {
                    status: 'completed',
                    completedTime: Date.now(),
                    notes: [{
                        id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        content: `Completed Stage 1: Processed ${researchState.allContent.length} content items from ${researchState.searchQueries.length} queries.`,
                        type: 'system',
                        timestamp: Date.now()
                    }]
                });
                
                // If Stage 2 task exists, mark it as in_progress
                if (researchState.stageTasks.stage2) {
                    await researchState.taskTools.update(researchState.stageTasks.stage2, {
                        status: 'in_progress',
                        startTime: Date.now()
                    });
                }
            }
            
            // Stage 2: Content analysis and knowledge gap identification
            UI.appendMessage(document.getElementById('chat-messages'),
                `🔬 Stage 2: Analyzing content and identifying knowledge gaps...`, 'ai');
                
            const gapQueries = analyzeContentAndIdentifyGaps();
            
            researchState.stageTwoComplete = true;
            console.log(`[Research] Stage 2 complete. Identified ${gapQueries.length} knowledge gaps.`);
            
            // Update Stage 2 task status if it exists
            if (researchState.taskTools && researchState.stageTasks.stage2) {
                await researchState.taskTools.update(researchState.stageTasks.stage2, {
                    status: 'completed',
                    completedTime: Date.now(),
                    notes: [{
                        id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        content: `Completed Stage 2: Identified ${gapQueries.length} knowledge gaps: ${researchState.knowledgeGaps.map(g => g.keyword).join(', ')}`,
                        type: 'system',
                        timestamp: Date.now()
                    }]
                });
                
                // If Stage 3 task exists, mark it as in_progress
                if (researchState.stageTasks.stage3) {
                    await researchState.taskTools.update(researchState.stageTasks.stage3, {
                        status: 'in_progress',
                        startTime: Date.now()
                    });
                }
            }
            
            // Stage 3: Focused reading based on knowledge gaps
            UI.appendMessage(document.getElementById('chat-messages'),
                `🔬 Stage 3: Performing focused reading on knowledge gaps...`, 'ai');
                
            await performFocusedReading(gapQueries);
            
            researchState.stageThreeComplete = true;
            console.log(`[Research] Stage 3 complete. Final content count: ${researchState.allContent.length}.`);
            
            // Update Stage 3 task status if it exists
            if (researchState.taskTools && researchState.stageTasks.stage3) {
                await researchState.taskTools.update(researchState.stageTasks.stage3, {
                    status: 'completed',
                    completedTime: Date.now(),
                    notes: [{
                        id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        content: `Completed Stage 3: Added ${researchState.stage3Sources || 0} focused sources. Total sources: ${researchState.allContent.length}.`,
                        type: 'system',
                        timestamp: Date.now()
                    }]
                });
            }
            
            // Final result compilation
            UI.appendMessage(document.getElementById('chat-messages'),
                `✅ Research completed! Processed ${researchState.allContent.length} sources across 3 stages.`, 'ai');
                
            // Update parent task if it exists
            if (researchState.taskTools && researchState.taskId) {
                try {
                    const parentTask = researchState.taskTools.getById(researchState.taskId);
                    if (parentTask) {
                        await researchState.taskTools.update(researchState.taskId, {
                            status: 'completed',
                            completedTime: Date.now(),
                            notes: [{
                                id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                content: `Research complete! Processed ${researchState.allContent.length} sources across 3 stages.`,
                                type: 'system',
                                timestamp: Date.now()
                            }],
                            context: {
                                ...parentTask.context,
                                researchCompleted: true,
                                totalSources: researchState.allContent.length,
                                uniqueDomains: new Set(researchState.references.map(url => {
                                    try { return new URL(url).hostname; } catch (e) { return 'unknown'; }
                                })).size,
                                knowledgeGaps: researchState.knowledgeGaps.length
                            }
                        });
                    }
                } catch (taskError) {
                    console.warn(`[Research] Failed to update parent task: ${taskError.message}`);
                }
            }
            
            // Return results
            return compileResults();
            
        } catch (error) {
            console.error('[Research] Research process failed:', error);
            
            // Mark all incomplete tasks as failed if they exist
            if (researchState.taskTools) {
                // Helper function to mark a task as failed if it exists and is not completed
                const markTaskFailed = async (taskId, errorMessage) => {
                    if (!taskId) return;
                    
                    const task = researchState.taskTools.getById(taskId);
                    if (task && task.status !== 'completed') {
                        await researchState.taskTools.update(taskId, {
                            status: 'failed',
                            completedTime: Date.now(),
                            notes: [{
                                id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                content: `Failed: ${errorMessage}`,
                                type: 'system',
                                timestamp: Date.now()
                            }]
                        });
                    }
                };
                
                try {
                    // Mark all stage tasks as failed if they aren't completed
                    await markTaskFailed(researchState.stageTasks.stage1, error.message);
                    await markTaskFailed(researchState.stageTasks.stage2, error.message);
                    await markTaskFailed(researchState.stageTasks.stage3, error.message);
                    
                    // Mark parent task as failed if it exists and isn't completed
                    if (researchState.taskId) {
                        const parentTask = researchState.taskTools.getById(researchState.taskId);
                        if (parentTask && parentTask.status !== 'completed') {
                            await researchState.taskTools.update(researchState.taskId, {
                                status: 'failed',
                                completedTime: Date.now(),
                                notes: [{
                                    id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                    content: `Research failed: ${error.message}`,
                                    type: 'system',
                                    timestamp: Date.now()
                                }]
                            });
                        }
                    }
                } catch (taskError) {
                    console.warn(`[Research] Failed to update task statuses: ${taskError.message}`);
                }
            }
            
            throw new Error(`Research failed: ${error.message}`);
        }
    }

    /**
     * Compiles final research results
     */
    function compileResults() {
        // Filter out error content
        const successfulContent = researchState.allContent.filter(item => !item.error);
        const failedUrls = researchState.allContent.filter(item => item.error);
        
        // Group content by stage
        const stage1Content = successfulContent.filter(item => item.stage === 1);
        const stage3Content = successfulContent.filter(item => item.stage === 3);
        
        // Generate summary
        const summary = `Research for "${query}" completed successfully using multi-stage approach.
        
📊 Research Statistics:
- Total URLs visited: ${researchState.totalUrlsRead}
- Successful content retrievals: ${successfulContent.length}
- Failed retrievals: ${failedUrls.length}
- Stage 1 (Broad exploration): ${stage1Content.length} sources
- Stage 3 (Focused reading): ${stage3Content.length} sources
- Unique domains explored: ${new Set(researchState.references.map(url => {
            try { return new URL(url).hostname; } catch (e) { return 'unknown'; }
        })).size}
- Search queries performed: ${researchState.searchHistory.length}
- Knowledge gaps identified: ${researchState.knowledgeGaps.length}

The multi-stage research approach first gathered broad information, then identified knowledge gaps, and finally performed focused research to fill those gaps.`;

        // Combine content, prioritizing highest relevance sources
        successfulContent.sort((a, b) => b.relevanceScore - a.relevanceScore);
        
        const fullContent = successfulContent.map(item =>
            `--- START OF CONTENT FROM ${item.url} (Stage: ${item.stage}, Relevance: ${item.relevanceScore.toFixed(2)}) ---
Title: ${item.title}
URL: ${item.url}
Retrieved: ${item.timestamp}

${item.content}

--- END OF CONTENT ---`
        ).join('\n\n');
        
        return {
            summary: summary,
            full_content: fullContent,
            references: researchState.references,
            metadata: {
                totalUrls: researchState.totalUrlsRead,
                successfulRetrievals: successfulContent.length,
                failedRetrievals: failedUrls.length,
                searchHistory: researchState.searchHistory,
                knowledgeGaps: researchState.knowledgeGaps,
                uniqueDomains: new Set(researchState.references.map(url => {
                    try { return new URL(url).hostname; } catch (e) { return 'unknown'; }
                })).size
            }
        };
    }

    // Start the research process
    return executeResearch();
}

async function _getOpenFileContent() {
    const activeFile = Editor.getActiveFile();
    if (!activeFile) throw new Error('No file is currently open in the editor.');
    
    const content = activeFile.model.getValue();
    return { filename: activeFile.name, content: content };
}

async function _getSelectedText() {
    const editor = Editor.getEditorInstance();
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
        throw new Error('Error: No text is currently selected in the editor. Please select the text you want to get.');
    }
    const selectedText = editor.getModel().getValueInRange(selection);
    return {
        selected_text: selectedText,
        start_line: selection.startLineNumber,
        start_column: selection.startColumn,
        end_line: selection.endLineNumber,
        end_column: selection.endColumn,
        details: `Selection from L${selection.startLineNumber}:C${selection.startColumn} to L${selection.endLineNumber}:C${selection.endColumn}`
    };
}

async function _setSelectedText({ start_line, start_column, end_line, end_column }) {
    if (start_line === undefined || start_column === undefined || end_line === undefined || end_column === undefined) {
        throw new Error("Parameters 'start_line', 'start_column', 'end_line', and 'end_column' are required.");
    }
    const editor = Editor.getEditorInstance();
    const range = new monaco.Range(start_line, start_column, end_line, end_column);
    editor.setSelection(range);
    editor.revealRange(range, monaco.editor.ScrollType.Smooth); // Scroll to the selection
    editor.focus();
    return { message: `Selection set to L${start_line}:C${start_column} to L${end_line}:C${end_column}.` };
}

async function _replaceSelectedText({ new_text }) {
    if (new_text === undefined) throw new Error("The 'new_text' parameter is required.");
    
    try {
        const cleanText = stripMarkdownCodeBlock(new_text);
        const editor = Editor.getEditorInstance();
        if (!editor) throw new Error('No editor instance is available.');
        
        const selection = editor.getSelection();
        if (!selection || selection.isEmpty()) {
            throw new Error('Error: No text is selected in the editor. Please select the text you want to replace.');
        }
        
        editor.executeEdits('ai-agent', [{ range: selection, text: cleanText }]);
        return { message: 'Replaced the selected text.' };
    } catch (error) {
        throw new Error(`Failed to replace selected text: ${error.message}`);
    }
}

// =================================================================
// === Backend Indexing Tools                                    ===
// =================================================================

async function build_backend_index(params, rootHandle) {
   const ignorePatterns = await FileSystem.getIgnorePatterns(rootHandle);
   const response = await fetch('/api/build-codebase-index', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ ignorePatterns }),
   });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to build backend index: ${error.message}`);
  }
  const result = await response.json();
  return `Backend index built successfully. Indexed ${result.indexedFiles} files and found ${result.totalSymbols} symbols.`;
}

async function query_backend_index({ query, page = 1, limit = 20 }) {
  const params = new URLSearchParams({ query, page, limit });
  const response = await fetch(`/api/query-codebase?${params.toString()}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to query backend index: ${error.message}`);
  }
  const result = await response.json();
  return result;
}


async function _undoLastChange(params, rootHandle) {
   const lastState = UndoManager.pop();
   if (!lastState) {
       return { message: "No file modifications to undo." };
   }

   const { filename, content } = lastState;
   await _rewriteFile({ filename, content }, rootHandle);
   
   // After undoing, we don't want the user to "redo" the undo, so don't push to stack again.
   // The rewriteFile call inside this function will have pushed the state *before* the undo.
   // We need to pop that off to prevent a confusing redo state.
   UndoManager.pop();


   return { message: `Undid the last change to '${filename}'.` };
}

async function _listTools() {
   try {
     const dynamicNames = (typeof ToolRegistry.list === 'function') ? ToolRegistry.list() : [];
     const builtinNames = Object.keys(builtInTools);
     const toolNames = Array.from(new Set([...builtinNames, ...dynamicNames]));
     return { tools: toolNames };
   } catch (e) {
     // Fallback to built-in only
     return { tools: Object.keys(builtInTools) };
   }
}

// --- Enhanced Code Comprehension Tools ---

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

// --- Senior Engineer AI Tools ---

async function _buildSymbolTable({ file_path }, rootHandle) {
    if (!file_path) throw new Error("The 'file_path' parameter is required.");
    
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, file_path);
    const file = await fileHandle.getFile();
    const content = await file.text();
    
    try {
        // Use cached symbol resolution with worker for background processing
        const symbolTable = await operationCache.cacheSymbolResolution(file_path, content, async (content, filePath) => {
            // Use symbol worker for comprehensive symbol analysis
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
        
        // Fallback to basic symbol resolution
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
        
        // Use cached data flow analysis with worker processing
        const flowInfo = await operationCache.cacheSymbolResolution(`${file_path}:${variable_name}:flow`, content, async (content, cacheKey) => {
            // Use symbol worker for data flow analysis
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
        
        // Fallback to original data flow analyzer
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
        // Use cached code quality analysis with worker processing
        const qualityMetrics = await operationCache.cacheValidation(`${file_path}:quality`, content, async (content, filePath) => {
            // Ensure workers are initialized before use
            await ensureWorkersInitialized();
            
            // Use file worker for comprehensive quality analysis
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
        
        // Fallback to original code quality analyzer
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
        // Get file-specific insights
        const qualitySummary = codeQualityAnalyzer.getQualitySummary(file_path);
        if (qualitySummary) {
            insights.fileQuality = qualitySummary;
        }
    } else {
        // Get project-wide insights
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
    
    // Analyze current state
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, file_path);
    const file = await fileHandle.getFile();
    const content = await file.text();
    
    const qualityMetrics = await codeQualityAnalyzer.analyzeCodeQuality(file_path, content);
    const symbolTable = await symbolResolver.buildSymbolTable(content, file_path);
    
    // Generate optimization recommendations
    const optimizations = [];
    
    // Check complexity issues
    const complexFunctions = qualityMetrics.complexity.functions.filter(f => f.category === 'high' || f.category === 'critical');
    if (complexFunctions.length > 0) {
        optimizations.push({
            type: 'complexity_reduction',
            priority: 'high',
            description: `${complexFunctions.length} functions have high complexity`,
            recommendations: complexFunctions.flatMap(f => f.recommendations || [])
        });
    }
    
    // Check code smells
    const criticalSmells = qualityMetrics.codeSmells.filter(smell => smell.severity === 'critical' || smell.severity === 'high');
    if (criticalSmells.length > 0) {
        optimizations.push({
            type: 'code_smell_removal',
            priority: 'medium',
            description: `${criticalSmells.length} critical code smells detected`,
            recommendations: criticalSmells.map(smell => smell.recommendation)
        });
    }
    
    // Check architectural patterns
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
            qualityImprovement: optimizations.length * 10, // Rough estimate
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

async function _traceVariableFlow({ variable_name, file_path }, rootHandle) {
    if (!variable_name) throw new Error("The 'variable_name' parameter is required.");
    if (!file_path) throw new Error("The 'file_path' parameter is required.");

    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, file_path);
    const file = await fileHandle.getFile();
    const content = await file.text();

    const analysis = await dataFlowAnalyzer.traceVariableFlow(variable_name, file_path, 1, content);
    return {
        variable: variable_name,
        definitions: analysis.definitions,
        usages: analysis.usages,
        dataFlow: analysis.dataFlow,
        relatedFiles: analysis.relatedFiles
    };
}

// --- Precise Code Modification Tools ---

// REMOVED: modify_function - use rewrite_file for simplicity

// REMOVED: modify_class - use rewrite_file for simplicity

// REMOVED: rename_symbol - use manual find/replace with rewrite_file

// REMOVED: add_method_to_class - use rewrite_file for simplicity

// REMOVED: update_imports - use rewrite_file for simplicity

// --- Enhanced Analysis Tools ---

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

// --- Batch Processing Tools ---

async function _batchAnalyzeFiles({ filenames, analysis_types = ['ast', 'quality', 'symbols'] }, rootHandle) {
    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
        throw new Error("The 'filenames' parameter is required and must be a non-empty array of strings.");
    }
    
    try {
        // Ensure workers are initialized before use
        await ensureWorkersInitialized();
        
        // Use batch worker for parallel analysis of multiple files
        const batchResult = await workerManager.executeBatch([
            {
                type: 'file_analyze',
                filenames: filenames,
                analysisTypes: analysis_types,
                includeMetrics: true,
                includeRecommendations: true
            }
        ]);
        
        const results = [];
        const summary = {
            totalFiles: filenames.length,
            successful: 0,
            failed: 0,
            totalIssues: 0,
            averageQuality: 0,
            processingTime: batchResult.processingTime || 0
        };
        
        for (let i = 0; i < filenames.length; i++) {
            const filename = filenames[i];
            const result = batchResult.results[i];
            
            if (result.success) {
                summary.successful++;
                summary.totalIssues += (result.issues?.length || 0);
                summary.averageQuality += (result.qualityScore || 0);
                
                results.push({
                    filename,
                    success: true,
                    analysis: result.analysis,
                    qualityScore: result.qualityScore,
                    issues: result.issues || [],
                    recommendations: result.recommendations || [],
                    metrics: result.metrics || {}
                });
            } else {
                summary.failed++;
                results.push({
                    filename,
                    success: false,
                    error: result.error
                });
            }
        }
        
        summary.averageQuality = summary.successful > 0 ? summary.averageQuality / summary.successful : 0;
        
        return {
            message: `Batch analysis completed for ${filenames.length} files`,
            summary,
            results,
            performance: {
                parallelProcessing: true,
                processingTime: batchResult.processingTime || 0,
                averageTimePerFile: summary.successful > 0 ? (batchResult.processingTime || 0) / summary.successful : 0
            }
        };
        
    } catch (error) {
        console.warn('Batch analysis failed, falling back to sequential processing:', error.message);
        
        // Fallback to sequential processing
        const results = [];
        const startTime = Date.now();
        
        for (const filename of filenames) {
            try {
                const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
                const file = await fileHandle.getFile();
                const content = await file.text();
                
                const analysis = {};
                
                // Perform requested analysis types
                if (analysis_types.includes('ast')) {
                    try {
                        analysis.ast = await operationCache.cacheAST(filename, content, async (content, filename) => {
                            await ensureWorkersInitialized();
                            return await workerManager.parseAST(content, filename);
                        });
                    } catch (e) {
                        analysis.ast = { error: e.message };
                    }
                }
                
                if (analysis_types.includes('quality')) {
                    try {
                        analysis.quality = await _analyzeCodeQuality({ file_path: filename }, rootHandle);
                    } catch (e) {
                        analysis.quality = { error: e.message };
                    }
                }
                
                if (analysis_types.includes('symbols')) {
                    try {
                        analysis.symbols = await _buildSymbolTable({ file_path: filename }, rootHandle);
                    } catch (e) {
                        analysis.symbols = { error: e.message };
                    }
                }
                
                results.push({
                    filename,
                    success: true,
                    analysis,
                    fallback: true
                });
                
            } catch (error) {
                results.push({
                    filename,
                    success: false,
                    error: error.message
                });
            }
        }
        
        const processingTime = Date.now() - startTime;
        
        return {
            message: `Batch analysis completed for ${filenames.length} files (fallback mode)`,
            results,
            fallback: true,
            performance: {
                parallelProcessing: false,
                processingTime,
                averageTimePerFile: processingTime / filenames.length
            }
        };
    }
}

async function _batchValidateFiles({ filenames, validation_types = ['syntax', 'style', 'security'] }, rootHandle) {
    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
        throw new Error("The 'filenames' parameter is required and must be a non-empty array of strings.");
    }
    
    try {
        // Ensure workers are initialized before use
        await ensureWorkersInitialized();
        
        // Use batch worker for parallel validation of multiple files
        const batchResult = await workerManager.executeBatch([
            {
                type: 'file_validate',
                filenames: filenames,
                validationTypes: validation_types,
                includeWarnings: true,
                includeSuggestions: true
            }
        ]);
        
        const results = [];
        const summary = {
            totalFiles: filenames.length,
            validFiles: 0,
            filesWithErrors: 0,
            filesWithWarnings: 0,
            totalErrors: 0,
            totalWarnings: 0,
            processingTime: batchResult.processingTime || 0
        };
        
        for (let i = 0; i < filenames.length; i++) {
            const filename = filenames[i];
            const result = batchResult.results[i];
            
            if (result.success) {
                const hasErrors = result.errors && result.errors.length > 0;
                const hasWarnings = result.warnings && result.warnings.length > 0;
                
                if (!hasErrors && !hasWarnings) {
                    summary.validFiles++;
                } else {
                    if (hasErrors) summary.filesWithErrors++;
                    if (hasWarnings) summary.filesWithWarnings++;
                }
                
                summary.totalErrors += (result.errors?.length || 0);
                summary.totalWarnings += (result.warnings?.length || 0);
                
                results.push({
                    filename,
                    success: true,
                    valid: !hasErrors,
                    errors: result.errors || [],
                    warnings: result.warnings || [],
                    suggestions: result.suggestions || [],
                    language: result.language || 'unknown'
                });
            } else {
                summary.filesWithErrors++;
                results.push({
                    filename,
                    success: false,
                    valid: false,
                    error: result.error
                });
            }
        }
        
        return {
            message: `Batch validation completed for ${filenames.length} files`,
            summary,
            results,
            performance: {
                parallelProcessing: true,
                processingTime: batchResult.processingTime || 0,
                averageTimePerFile: filenames.length > 0 ? (batchResult.processingTime || 0) / filenames.length : 0
            }
        };
        
    } catch (error) {
        console.warn('Batch validation failed, falling back to sequential processing:', error.message);
        
        // Fallback to sequential processing
        const results = [];
        const startTime = Date.now();
        
        for (const filename of filenames) {
            try {
                const validation = await _validateSyntax({ file_path: filename }, rootHandle);
                results.push({
                    filename,
                    success: true,
                    valid: validation.valid,
                    errors: validation.errors || [],
                    warnings: validation.warnings || [],
                    suggestions: validation.suggestions || [],
                    language: validation.language || 'unknown',
                    fallback: true
                });
            } catch (error) {
                results.push({
                    filename,
                    success: false,
                    valid: false,
                    error: error.message
                });
            }
        }
        
        const processingTime = Date.now() - startTime;
        
        return {
            message: `Batch validation completed for ${filenames.length} files (fallback mode)`,
            results,
            fallback: true,
            performance: {
                parallelProcessing: false,
                processingTime,
                averageTimePerFile: processingTime / filenames.length
            }
        };
    }
}

async function _clearCacheForFile({ filename }) {
    if (!filename) throw new Error("The 'filename' parameter is required.");
    
    const invalidatedCount = operationCache.invalidateFile(filename);
    
    return {
        message: `Cache invalidated for '${filename}'. Cleared ${invalidatedCount} related entries.`
    };
}

// --- Tool Registry ---

const builtInTools = {
   list_tools: { handler: _listTools, requiresProject: false, createsCheckpoint: false },
    // Project-based tools
    get_project_structure: { handler: _getProjectStructure, requiresProject: true, createsCheckpoint: false },
    
    // Enhanced code comprehension tools
    analyze_symbol: { handler: _analyzeSymbol, requiresProject: true, createsCheckpoint: false },
    explain_code_section: { handler: _explainCodeSection, requiresProject: true, createsCheckpoint: false },
    trace_variable_flow: { handler: _traceVariableFlow, requiresProject: true, createsCheckpoint: false },
    validate_syntax: { handler: _validateSyntax, requiresProject: true, createsCheckpoint: false },
    
    // Senior Engineer AI Tools
    build_symbol_table: { handler: _buildSymbolTable, requiresProject: true, createsCheckpoint: false },
    trace_data_flow: { handler: _traceDataFlow, requiresProject: true, createsCheckpoint: false },
    debug_systematically: { handler: _debugSystematically, requiresProject: false, createsCheckpoint: false },
    analyze_code_quality: { handler: _analyzeCodeQuality, requiresProject: true, createsCheckpoint: false },
    solve_engineering_problem: { handler: _solveEngineeringProblem, requiresProject: false, createsCheckpoint: false },
    get_engineering_insights: { handler: _getEngineeringInsights, requiresProject: false, createsCheckpoint: false },
    optimize_code_architecture: { handler: _optimizeCodeArchitecture, requiresProject: true, createsCheckpoint: false },
    
    // REMOVED: Precise code modification tools - simplified to use rewrite_file only
    read_file: { handler: _readFile, requiresProject: true, createsCheckpoint: false },
    read_file_lines: { handler: _readFileLines, requiresProject: true, createsCheckpoint: false },
    search_in_file: { handler: _searchInFile, requiresProject: true, createsCheckpoint: false },
    read_multiple_files: { handler: _readMultipleFiles, requiresProject: true, createsCheckpoint: false },
    search_code: { handler: _searchCode, requiresProject: true, createsCheckpoint: false },
    build_or_update_codebase_index: { handler: _buildCodebaseIndex, requiresProject: true, createsCheckpoint: false },
    query_codebase: { handler: _queryCodebase, requiresProject: true, createsCheckpoint: false },
    reindex_codebase_paths: { handler: _reindexCodebasePaths, requiresProject: true, createsCheckpoint: false },
    format_code: { handler: _formatCode, requiresProject: true, createsCheckpoint: false },
    analyze_code: { handler: _analyzeCode, requiresProject: true, createsCheckpoint: false },
    // REMOVED: run_terminal_command - Eliminated to maintain client-centric architecture
    get_file_history: { handler: _getFileHistory, requiresProject: true, createsCheckpoint: false },

    // New backend indexer tools
    build_backend_index: { handler: build_backend_index, requiresProject: true, createsCheckpoint: false },
    query_backend_index: { handler: query_backend_index, requiresProject: true, createsCheckpoint: false },

    // Smart file modification tools
    create_file: { handler: _createFile, requiresProject: true, createsCheckpoint: true },
    edit_file: { handler: _editFile, requiresProject: true, createsCheckpoint: true },
    rewrite_file: { handler: _rewriteFile, requiresProject: true, createsCheckpoint: true }, // To be removed next
    append_to_file: { handler: _appendToFile, requiresProject: true, createsCheckpoint: true },
    get_file_info: { handler: _getFileInfo, requiresProject: true, createsCheckpoint: false },
    delete_file: { handler: _deleteFile, requiresProject: true, createsCheckpoint: true },
    rename_file: { handler: _renameFile, requiresProject: true, createsCheckpoint: true },
    create_folder: { handler: _createFolder, requiresProject: true, createsCheckpoint: true },
    delete_folder: { handler: _deleteFolder, requiresProject: true, createsCheckpoint: true },
    rename_folder: { handler: _renameFolder, requiresProject: true, createsCheckpoint: true },

    // --- Unified Task Management Tools ---
    task_create: { handler: _taskCreate, requiresProject: false, createsCheckpoint: true },
    task_update: { handler: _taskUpdate, requiresProject: false, createsCheckpoint: true },
    task_delete: { handler: _taskDelete, requiresProject: false, createsCheckpoint: true },
    task_breakdown: { handler: _taskBreakdown, requiresProject: false, createsCheckpoint: true },
    task_get_next: { handler: _taskGetNext, requiresProject: false, createsCheckpoint: false },
    task_get_status: { handler: _taskGetStatus, requiresProject: false, createsCheckpoint: false },
    start_task_session: { handler: _startTaskSession, requiresProject: false, createsCheckpoint: true },

    // Non-project / Editor tools
    read_url: { handler: _readUrl, requiresProject: false, createsCheckpoint: false },
    duckduckgo_search: { handler: _duckduckgoSearch, requiresProject: false, createsCheckpoint: false },
    perform_research: { handler: _performResearch, requiresProject: false, createsCheckpoint: false },
    get_open_file_content: { handler: _getOpenFileContent, requiresProject: false, createsCheckpoint: false },
    get_selected_text: { handler: _getSelectedText, requiresProject: false, createsCheckpoint: false },
    replace_selected_text: { handler: _replaceSelectedText, requiresProject: false, createsCheckpoint: false },
    set_selected_text: { handler: _setSelectedText, requiresProject: false, createsCheckpoint: false },
    create_diff: { handler: _createDiff, requiresProject: false, createsCheckpoint: false },
    apply_diff: { handler: _applyDiff, requiresProject: true, createsCheckpoint: true },
    
    // Alternative file editing tools - more reliable than apply_diff in many cases
    // REMOVED: find_and_replace, insert_at_line, replace_lines, smart_replace
    
    // Batch processing tools for efficient bulk operations
    batch_analyze_files: { handler: _batchAnalyzeFiles, requiresProject: true, createsCheckpoint: false },
    batch_validate_files: { handler: _batchValidateFiles, requiresProject: true, createsCheckpoint: false },
    
    undo_last_change: { handler: _undoLastChange, requiresProject: true, createsCheckpoint: false },
    test_research: { handler: _testResearch, requiresProject: false, createsCheckpoint: false },
    clear_cache_for_file: { handler: _clearCacheForFile, requiresProject: false, createsCheckpoint: false },
};

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
    const { name: toolName, args: parameters } = toolCall;

    // Prefer dynamically registered tools, then fall back to built-ins
    const registered = (typeof ToolRegistry.get === 'function') ? ToolRegistry.get(toolName) : null;
    const tool = registered || builtInTools[toolName];

    if (!tool) {
        throw new Error(`Unknown tool '${toolName}'.`);
    }

    if (tool.requiresProject && !rootDirectoryHandle) {
        return { error: "No project folder is open. Please ask the user to open a folder before using this tool." };
    }

    if (tool.createsCheckpoint) {
        await createAutomaticCheckpoint();
    }

    console.debug(`[Tool Start] Executing tool: ${toolName}`, { parameters });
    const result = await tool.handler(parameters, rootDirectoryHandle);
    console.debug(`[Tool Success] Tool ${toolName} finished.`, { result });
    return result;
}

// REMOVED: TOOLS_REQUIRING_SYNTAX_CHECK - no longer using automatic syntax checking

export async function execute(toolCall, rootDirectoryHandle, silent = false) {
    const toolName = toolCall.name;
    const mode = document.getElementById('agent-mode-selector').value;
    const startTime = performance.now();

    // Smart tool validation and optimization
    if (mode === 'amend' && toolName === 'rewrite_file') {
        throw new Error("The 'rewrite_file' tool is not allowed in 'Amend' mode. Use 'apply_diff' or 'edit_file' with the 'edits' parameter for targeted changes.");
    }

    const parameters = toolCall.args;
    
    // Check for cached results for read-only operations
    if (['read_file', 'get_project_structure', 'search_in_file'].includes(toolName)) {
        const cachedResult = getCachedResult(toolName, parameters);
        if (cachedResult) {
            return { toolResponse: { name: toolName, response: cachedResult } };
        }
    }

    // Get smart tool recommendations
    const context = {
        mode,
        fileType: parameters.filename ? parameters.filename.split('.').pop() : null,
        fileSize: null // Will be determined during execution if needed
    };
    
    const recommendation = getOptimalTool(toolName, context);
    if (recommendation && !silent) {
        console.log(`[Smart Selection] Recommended: ${recommendation.recommendedTool} - ${recommendation.reason}`);
    }

    const groupTitle = `AI Tool Call: ${toolName}`;
    const groupContent = parameters && Object.keys(parameters).length > 0 ? parameters : 'No parameters';
    console.group(groupTitle, groupContent);
    
    let logEntry;
    if (!silent) {
        logEntry = UI.appendToolLog(document.getElementById('chat-messages'), toolName, parameters);
    }

    let resultForModel;
    let isSuccess = true;

    try {
        // Enhanced execution with performance monitoring
        performanceOptimizer.startTimer(`tool_${toolName}`);
        resultForModel = await executeTool(toolCall, rootDirectoryHandle);
        const executionTime = performanceOptimizer.endTimer(`tool_${toolName}`);
        
        // Track performance metrics
        trackToolPerformance(toolName, startTime, performance.now(), true, context);
        
        // Cache successful read operations
        if (['read_file', 'get_project_structure', 'search_in_file'].includes(toolName)) {
            setCachedResult(toolName, parameters, resultForModel);
        }
        
        toolLogger.log(toolName, parameters, 'Success', resultForModel);
        
        // Log performance insights
        if (executionTime > 2000) {
            console.warn(`[Performance] Tool ${toolName} took ${executionTime}ms - consider optimization`);
        }
        
    } catch (error) {
        isSuccess = false;
        const endTime = performance.now();
        
        // Track failed performance
        trackToolPerformance(toolName, startTime, endTime, false, context);
        
        // Analyze error patterns and suggest fixes
        const errorAnalysis = analyzeError(toolName, error, context);
        let errorMessage = `Error executing tool '${toolName}': ${error.message}`;
        
        if (errorAnalysis && errorAnalysis.suggestion) {
            errorMessage += `\n\nSuggestion: ${errorAnalysis.suggestion}`;
            if (errorAnalysis.alternativeTool) {
                errorMessage += `\nConsider using: ${errorAnalysis.alternativeTool}`;
            }
        }
        
        resultForModel = { error: errorMessage };
        UI.showError(errorMessage);
        console.debug(`[Tool Error] Tool ${toolName} failed.`, { error: errorMessage, details: error });
        console.error(errorMessage, error);
        toolLogger.log(toolName, parameters, 'Error', {
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
    
    return { toolResponse: { name: toolName, response: resultForModel } };
}

export function getToolDefinitions() {
    return {
        functionDeclarations: [
            { name: 'create_file', description: "Creates a new file. CRITICAL: Do NOT include the root directory name in the path. Example: To create 'app.js' in the root, the path is 'app.js', NOT 'my-project/app.js'.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, content: { type: 'STRING', description: 'The raw text content of the file. CRITICAL: Do NOT wrap this content in markdown backticks (```).' } }, required: ['filename', 'content'] } },
            { name: 'delete_file', description: "Deletes a file. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
            { name: 'create_folder', description: "Creates a new folder. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { folder_path: { type: 'STRING' } }, required: ['folder_path'] } },
            { name: 'delete_folder', description: "Deletes a folder and all its contents. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { folder_path: { type: 'STRING' } }, required: ['folder_path'] } },
            { name: 'rename_folder', description: "Renames a folder. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { old_folder_path: { type: 'STRING' }, new_folder_path: { type: 'STRING' } }, required: ['old_folder_path', 'new_folder_path'] } },
            { name: 'rename_file', description: "Renames a file. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { old_path: { type: 'STRING' }, new_path: { type: 'STRING' } }, required: ['old_path', 'new_path'] } },
            { name: 'read_file', description: "Reads a file's content. To ensure accuracy when editing, set 'include_line_numbers' to true. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, include_line_numbers: { type: 'BOOLEAN', description: 'Set to true to prepend line numbers to each line of the output.' } }, required: ['filename'] } },
            { name: 'read_multiple_files', description: "Reads and concatenates the content of multiple files. Essential for multi-file context tasks.", parameters: { type: 'OBJECT', properties: { filenames: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['filenames'] } },
            { name: 'read_file_lines', description: 'Reads a specific range of lines from a file. Output will always include line numbers. Use for quick inspection of specific code sections.', parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, start_line: { type: 'NUMBER' }, end_line: { type: 'NUMBER' } }, required: ['filename', 'start_line', 'end_line'] } },
            { name: 'search_in_file', description: 'Searches for a pattern in a file and returns matching lines. Use this for large files.', parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, pattern: { type: 'STRING' }, context: { type: 'NUMBER' } }, required: ['filename', 'pattern'] } },
            { name: 'read_url', description: 'Reads and extracts the main content and all links from a given URL. The result will be a JSON object with "content" and "links" properties.', parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' } }, required: ['url'] } },
            { name: 'get_open_file_content', description: 'Gets the content of the currently open file in the editor.' },
            { name: 'get_selected_text', description: 'Gets the text currently selected by the user in the editor.' },
            { name: 'replace_selected_text', description: 'Replaces the currently selected text in the editor with new text.', parameters: { type: 'OBJECT', properties: { new_text: { type: 'STRING', description: 'The raw text to replace the selection with. CRITICAL: Do NOT wrap this content in markdown backticks (```).' } }, required: ['new_text'] } },
            { name: 'get_project_structure', description: 'Gets the entire file and folder structure of the project. CRITICAL: Always use this tool before attempting to read or create a file to ensure you have the correct file path.' },
            { name: 'duckduckgo_search', description: 'Performs a search using DuckDuckGo and returns the results.', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] } },
            { name: 'perform_research', description: '🔬 ENHANCED: Performs intelligent, recursive web research with AI-driven decision making. Automatically searches, analyzes content relevance, follows promising links, and expands searches based on discovered information. Much more comprehensive than simple search.', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'The research query or topic to investigate' }, max_results: { type: 'NUMBER', description: 'Maximum URLs to read per search (1-5, default: 3)' }, depth: { type: 'NUMBER', description: 'Maximum recursion depth for following links (1-4, default: 2)' }, relevance_threshold: { type: 'NUMBER', description: 'Minimum relevance score to read URLs (0.3-1.0, default: 0.7). Lower = more URLs read' } }, required: ['query'] } },
            { name: 'search_code', description: 'Searches for a specific string in all files in the project (like grep).', parameters: { type: 'OBJECT', properties: { search_term: { type: 'STRING' } }, required: ['search_term'] } },
            // REMOVED: run_terminal_command - Tool eliminated to maintain browser-first architecture
            { name: 'build_or_update_codebase_index', description: 'Scans the entire codebase to build a searchable index. Slow, run once per session.' },
            { name: 'query_codebase', description: 'Searches the pre-built codebase index.', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] } },
            { name: 'get_file_history', description: "DISABLED: Git history feature has been disabled in this browser-based editor. Use your local git client for version control operations.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
            // REMOVED: insert_content, create_and_apply_diff, replace_lines - simplified to use rewrite_file only
            { name: 'format_code', description: "Formats a file with Prettier. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
            { name: 'analyze_code', description: "Analyzes a JavaScript file's structure. CRITICAL: Do NOT include the root directory name in the path.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
            { name: 'edit_file', description: "The primary tool for all file modifications. CRITICAL: Before using this tool to fix an error, you MUST use 'read_file' to get the full, up-to-date content of the file. CRITICAL: If the content you are using was retrieved with line numbers, you MUST remove the line numbers and the ` | ` separator from every line before using it in the 'new_content' or 'content' parameter. The content must be the raw source code. Provide EITHER 'content' for a full rewrite OR an 'edits' array for targeted changes.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, content: { type: 'STRING', description: 'Complete file content for small files. CRITICAL: Do NOT wrap in markdown backticks.' }, edits: { type: 'ARRAY', items: { type: 'OBJECT', properties: { type: { type: 'STRING', enum: ['replace_lines', 'insert_lines'] }, start_line: { type: 'NUMBER', description: 'Start line for replace_lines (inclusive)' }, end_line: { type: 'NUMBER', description: 'End line for replace_lines (inclusive)' }, expected_content: { type: 'STRING', description: 'SAFETY: The exact content of the lines to be replaced. If this does not match, the edit will fail.' }, line_number: { type: 'NUMBER', description: 'Line position for insert_lines (0=start of file)' }, new_content: { type: 'STRING' } } }, description: 'Efficient targeted edits for large files. Use replace_lines to replace line ranges or insert_lines to add content.' } }, required: ['filename'] } },
            { name: 'append_to_file', description: "Fast append content to end of file without reading full content. Ideal for logs, incremental updates.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, content: { type: 'STRING', description: 'Content to append. Will add newline separator automatically.' } }, required: ['filename', 'content'] } },
            { name: 'get_file_info', description: "Get file metadata (size, last modified, type) without reading content. Use before editing large files.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
            { name: 'rewrite_file', description: "DEPRECATED and REMOVED. Use 'edit_file' instead.", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' }, content: { type: 'STRING' } }, required: ['filename', 'content'] } },
            { name: 'apply_diff', description: "🔧 RECOMMENDED: Apply precise, surgical changes to files using diff blocks. This is the safest and most reliable way to edit files. Use this instead of edit_file when you need to make targeted changes. CRITICAL: The diff parameter must contain properly formatted diff blocks with EXACT format:\n\n<<<<<<< SEARCH\n:start_line:10\n-------\nold code here\n=======\nnew code here\n>>>>>>> REPLACE\n\nMANDATORY REQUIREMENTS:\n1. Must include ':start_line:N' where N is the line number\n2. Must include '-------' separator line after start_line\n3. Must include '=======' separator between old and new content\n4. Each line must be exact, including whitespace and indentation\n5. Use read_file with include_line_numbers=true first to get accurate content", parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING', description: 'Path to the file to modify' }, diff: { type: 'STRING', description: 'One or more diff blocks in the EXACT format: <<<<<<< SEARCH\\n:start_line:N\\n-------\\nold content\\n=======\\nnew content\\n>>>>>>> REPLACE. The -------  separator line is MANDATORY.' } }, required: ['filename', 'diff'] } },
            
            // --- Unified Task Management System ---
            { name: 'task_create', description: "Creates a new task. This is the starting point for any new goal.", parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, description: { type: 'STRING' }, priority: { type: 'STRING', enum: ['low', 'medium', 'high', 'urgent'] }, parentId: { type: 'STRING' }, listId: { type: 'STRING' } }, required: ['title'] } },
            { name: 'task_update', description: "🔄 Updates an existing task. CRITICAL: You MUST provide both 'taskId' and 'updates'. The 'updates' object MUST contain the properties to be changed. For example, to mark a task as complete, the tool call would be: `task_update({ taskId: 'task_123', updates: { status: 'completed' } })`.", parameters: { type: 'OBJECT', properties: { taskId: { type: 'STRING', description: "REQUIRED: The ID of the task to update (e.g., 'task_123')" }, updates: { type: 'OBJECT', description: "REQUIRED: An object with the fields to update (e.g., { status: 'completed', progress: 100 })" } }, required: ['taskId', 'updates'] } },
            { name: 'task_delete', description: "Deletes a task and all of its subtasks.", parameters: { type: 'OBJECT', properties: { taskId: { type: 'STRING' } }, required: ['taskId'] } },
            { name: 'task_breakdown', description: "🎯 CRITICAL: Analyzes a high-level task and breaks it down into SPECIFIC, ACTIONABLE subtasks. DO NOT create generic tasks like 'Analyze requirements' or 'Plan approach'. Instead, create concrete tasks like 'Locate CSS files containing dashboard styles', 'Identify color variables in style.css', 'Update background-color properties to blue theme'. Each subtask should be a specific action that can be executed immediately.", parameters: { type: 'OBJECT', properties: { taskId: { type: 'STRING' } }, required: ['taskId'] } },
            { name: 'task_get_next', description: "Fetches the next logical task for the AI to work on, based on priority and dependencies." },
            { name: 'task_get_status', description: "Gets status information about tasks. Can check a specific task by ID or get overall task statistics.", parameters: { type: 'OBJECT', properties: { taskId: { type: 'STRING', description: 'Optional specific task ID to check. If omitted, returns overview of all tasks.' } } } },
            { name: 'start_task_session', description: "Starts a new work session for a specific task, tracking time spent and progress. Useful for focused work periods on complex tasks.", parameters: { type: 'OBJECT', properties: { taskId: { type: 'STRING', description: 'The ID of the task to start a session for' }, description: { type: 'STRING', description: 'Optional description of this work session' }, duration: { type: 'NUMBER', description: 'Optional planned duration in minutes' } }, required: ['taskId'] } },
            
            // Enhanced code comprehension tools
            { name: 'analyze_symbol', description: 'Analyzes a symbol (variable, function, class) across the entire codebase to understand its usage, definition, and relationships.', parameters: { type: 'OBJECT', properties: { symbol_name: { type: 'STRING', description: 'The name of the symbol to analyze' }, file_path: { type: 'STRING', description: 'The file path where the symbol is used or defined' } }, required: ['symbol_name', 'file_path'] } },
            { name: 'explain_code_section', description: 'Provides detailed explanation of a complex code section including complexity analysis, symbols, and control flow.', parameters: { type: 'OBJECT', properties: { file_path: { type: 'STRING' }, start_line: { type: 'NUMBER' }, end_line: { type: 'NUMBER' } }, required: ['file_path', 'start_line', 'end_line'] } },
            { name: 'trace_variable_flow', description: 'Traces the data flow of a variable through the codebase to understand how data moves and transforms.', parameters: { type: 'OBJECT', properties: { variable_name: { type: 'STRING' }, file_path: { type: 'STRING' } }, required: ['variable_name', 'file_path'] } },
            { name: 'validate_syntax', description: 'Validates the syntax of a file and provides detailed errors, warnings, and suggestions.', parameters: { type: 'OBJECT', properties: { file_path: { type: 'STRING' } }, required: ['file_path'] } },
            
            // Senior Engineer AI Tools
            { name: 'build_symbol_table', description: '🧠 SENIOR ENGINEER: Build comprehensive symbol table for advanced code analysis. Creates detailed mapping of all symbols, functions, classes, imports, and exports in a file.', parameters: { type: 'OBJECT', properties: { file_path: { type: 'STRING', description: 'Path to the file to analyze' } }, required: ['file_path'] } },
            { name: 'trace_data_flow', description: '🧠 SENIOR ENGINEER: Advanced data flow analysis that traces how variables flow through the codebase. Identifies definitions, usages, mutations, and cross-file dependencies.', parameters: { type: 'OBJECT', properties: { variable_name: { type: 'STRING', description: 'Name of the variable to trace' }, file_path: { type: 'STRING', description: 'Starting file path' }, line: { type: 'NUMBER', description: 'Starting line number (optional)' } }, required: ['variable_name', 'file_path'] } },
            { name: 'debug_systematically', description: '🧠 SENIOR ENGINEER: Systematic debugging using hypothesis-driven approach. Analyzes errors, generates hypotheses, tests them systematically, and provides root cause analysis.', parameters: { type: 'OBJECT', properties: { error_message: { type: 'STRING', description: 'The error message to debug' }, file_path: { type: 'STRING', description: 'File where error occurred (optional)' }, line: { type: 'NUMBER', description: 'Line number where error occurred (optional)' }, stack_trace: { type: 'STRING', description: 'Full stack trace (optional)' } }, required: ['error_message'] } },
            { name: 'analyze_code_quality', description: '🧠 SENIOR ENGINEER: Comprehensive code quality analysis including complexity, maintainability, code smells, security vulnerabilities, and performance issues.', parameters: { type: 'OBJECT', properties: { file_path: { type: 'STRING', description: 'Path to the file to analyze' } }, required: ['file_path'] } },
            { name: 'solve_engineering_problem', description: '🧠 SENIOR ENGINEER: Holistic engineering problem solving. Analyzes problems comprehensively, generates multiple solutions, evaluates trade-offs, and provides implementation plans.', parameters: { type: 'OBJECT', properties: { problem_description: { type: 'STRING', description: 'Detailed description of the engineering problem' }, file_path: { type: 'STRING', description: 'Related file path (optional)' }, priority: { type: 'STRING', description: 'Problem priority: low, medium, high, critical', enum: ['low', 'medium', 'high', 'critical'] }, constraints: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Any constraints or limitations (optional)' } }, required: ['problem_description'] } },
            { name: 'get_engineering_insights', description: '🧠 SENIOR ENGINEER: Get comprehensive engineering insights and statistics about code quality, debugging patterns, and decision-making effectiveness.', parameters: { type: 'OBJECT', properties: { file_path: { type: 'STRING', description: 'Specific file to analyze (optional - if omitted, provides project-wide insights)' } } } },
            { name: 'optimize_code_architecture', description: '🧠 SENIOR ENGINEER: Analyze and optimize code architecture. Identifies architectural issues, suggests design patterns, and provides optimization recommendations.', parameters: { type: 'OBJECT', properties: { file_path: { type: 'STRING', description: 'Path to the file to optimize' }, optimization_goals: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Optimization goals: maintainability, performance, readability, security (optional)' } }, required: ['file_path'] } },
            { name: 'clear_cache_for_file', description: 'Clears the cache for a specific file. Use this if you suspect the cached content is stale.', parameters: { type: 'OBJECT', properties: { filename: { type: 'STRING' } }, required: ['filename'] } },
            // Smart editing system - efficient for both small and large files
        ],
    };
}

/**
 * Test function for the multi-stage research implementation
 * This is a convenience function that lets you quickly test the research functionality
 * from the console or as part of other functionality.
 *
 * @param {Object} options - Optional configuration for the test
 * @param {string} options.query - Research query to test with
 * @returns {Promise<Object>} - The research results and test metrics
 */
async function _testResearch(options = {}) {
    console.log('🧪 Testing multi-stage research implementation...');
    
    // Import the test module dynamically
    const { testResearch } = await import('./test_research.js');
    
    // Run the test with provided options or defaults
    const results = await testResearch(options);
    
    console.log('✅ Test completed!');
    console.log(`To run more detailed tests, open the test page at: ./test_research.html`);
    
    return results;
}
