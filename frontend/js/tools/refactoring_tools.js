import { ToolRegistry } from '../tool_registry.js';
import * as FileSystem from '../file_system.js';
import * as Editor from '../editor.js';
import { UndoManager } from '../undo_manager.js';
import { toolLogger } from '../tool_logger.js';
import { syntaxValidator } from '../syntax_validator.js';
import { workerManager } from '../worker_manager.js';

let diff_match_patch;
try {
    diff_match_patch = window.diff_match_patch;
    if (!diff_match_patch) {
        throw new Error('diff_match_patch not found in global scope');
    }
} catch (e) {
    console.warn('diff_match_patch not available:', e.message);
}

function stripMarkdownCodeBlock(content) {
   if (typeof content !== 'string') {
       return content;
   }
   const match = content.match(/^```(?:\w+)?\n([\s\S]+)\n```$/);
   return match ? match[1] : content;
}

async function validateSyntaxBeforeWrite(filename, content) {
    const validation = await syntaxValidator.validateSyntax(filename, content);
    if (!validation.valid) {
        const errorMessages = validation.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n');
        const suggestionMessages = validation.suggestions ? `\n\nSuggestions:\n- ${validation.suggestions.join('\n- ')}` : '';
        return {
            isValid: false,
            errors: errorMessages,
            suggestions: suggestionMessages
        };
    }
    return { isValid: true };
}

async function _applyDiff({ filename, diff }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for apply_diff.");
    if (!diff) throw new Error("The 'diff' parameter is required for apply_diff.");
    
    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    
    let hasPermission = false;
    try {
        hasPermission = await FileSystem.verifyAndRequestPermission(fileHandle, true);
    } catch (permissionError) {
        console.warn('Permission check failed, attempting to proceed:', permissionError.message);
        hasPermission = true;
    }
    
    if (!hasPermission) {
        throw new Error('Permission to write to the file was denied.');
    }
    
    const file = await fileHandle.getFile();
    const originalContent = await file.text();
    UndoManager.push(filename, originalContent);
    
    const lines = originalContent.split(/\r?\n/);
    const originalLineCount = lines.length;
    
    const diffBlocks = [];
    const blockSeparator = /<<<<<<< SEARCH/g;
    const rawBlocks = diff.split(blockSeparator).filter(block => block.trim());
    
    for (const rawBlock of rawBlocks) {
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
            console.warn('Failed to parse diff block:', rawBlock.substring(0, 200) + '...');
        }
    }
    
    if (diffBlocks.length === 0) {
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
    
    diffBlocks.sort((a, b) => b.startLine - a.startLine);
    
    let modifiedLines = [...lines];
    
    for (const block of diffBlocks) {
        const { startLine, searchContent, replaceContent } = block;
        
        if (startLine < 1 || startLine > originalLineCount) {
            throw new Error(`Invalid start_line ${startLine}. File has ${originalLineCount} lines.`);
        }
        
        const searchLines = searchContent.split(/\r?\n/);
        let actualStartIndex = startLine - 1;
        let matches = false;
        
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
        
        if (!matches) {
            const contextStart = Math.max(0, actualStartIndex - 3);
            const contextEnd = Math.min(modifiedLines.length, actualStartIndex + searchLines.length + 3);
            const contextLines = modifiedLines.slice(contextStart, contextEnd);
            
            let mismatchDetails = `Could not find search content around line ${startLine}.\n`;
            mismatchDetails += `Context (lines ${contextStart + 1}-${contextEnd}):\n`;
            contextLines.forEach((line, idx) => {
                const lineNum = contextStart + idx + 1;
                const marker = (lineNum === startLine) ? '>>>' : '   ';
                mismatchDetails += `${marker} ${lineNum}: ${line}\n`;
            });
            
            const actualContent = modifiedLines.slice(actualStartIndex, actualStartIndex + searchLines.length).join('\n');
            throw new Error(`Search content does not match at line ${startLine}.\n\n${mismatchDetails}\nExpected content:\n${searchContent}\n\nActual content:\n${actualContent}`);
        }
        
        const searchStartIndex = actualStartIndex;
        
        const replaceLines = replaceContent.split(/\r?\n/);
        const before = modifiedLines.slice(0, searchStartIndex);
        const after = modifiedLines.slice(searchStartIndex + searchLines.length);
        modifiedLines = [...before, ...replaceLines, ...after];
    }
    
    const lineEnding = originalContent.includes('\r\n') ? '\r\n' : '\n';
    const newContent = modifiedLines.join(lineEnding);
    
    const validationResult = await validateSyntaxBeforeWrite(filename, newContent);
    
    const writable = await fileHandle.createWritable();
    await writable.write(newContent);
    await writable.close();
    
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

async function _streamingEditFile({ filename, edits, fileHandle, file }) {
    console.log(`Using streaming edit for large file: ${filename} (${file.size} bytes)`);
    
    const chunkSize = 1024 * 1024; // 1MB chunks
    const fileSize = file.size;
    let currentPos = 0;
    let lines = [];
    
    while (currentPos < fileSize) {
        const chunk = await file.slice(currentPos, Math.min(currentPos + chunkSize, fileSize)).text();
        const chunkLines = chunk.split(/\r?\n/);
        
        if (lines.length > 0) {
            lines[lines.length - 1] += chunkLines[0];
            lines.push(...chunkLines.slice(1));
        } else {
            lines.push(...chunkLines);
        }
        
        currentPos += chunkSize;
        
        if (currentPos % (chunkSize * 5) === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    
    const originalLineCount = lines.length;
    console.log(`Streaming edit: Loaded ${originalLineCount} lines`);
    
    for (const edit of edits) {
        if (edit.type === 'replace_lines') {
            const { start_line, end_line } = edit;
            if (start_line < 1 || end_line < 1 || start_line > originalLineCount || end_line > originalLineCount) {
                throw new Error(`Invalid line range: ${start_line}-${end_line} (file has ${originalLineCount} lines)`);
            }
        }
    }
    
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
    
    const writable = await fileHandle.createWritable();
    const writeChunkSize = 100000;
    
    for (let i = 0; i < lines.length; i += writeChunkSize) {
        const chunk = lines.slice(i, i + writeChunkSize).join('\n');
        await writable.write(chunk);
        
        if (i + writeChunkSize < lines.length) {
            await writable.write('\n');
        }
        
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

async function _smartEditFile({ filename, edits }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required.");
    if (!edits || !Array.isArray(edits)) throw new Error("The 'edits' parameter is required and must be an array.");

    for (const edit of edits) {
        if (!edit.type) {
            throw new Error("Each edit must have a 'type' property. Valid types are: 'replace_lines', 'insert_lines'");
        }
        if (!['replace_lines', 'insert_lines'].includes(edit.type)) {
            throw new Error(`Invalid edit type: '${edit.type}'. Valid types are: 'replace_lines', 'insert_lines'`);
        }
    }

    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);

    let hasPermission = false;
    try {
        hasPermission = await FileSystem.verifyAndRequestPermission(fileHandle, true);
    } catch (permissionError) {
        console.warn('Permission check failed, attempting to proceed:', permissionError.message);
        hasPermission = true;
    }

    if (!hasPermission) {
        throw new Error('Permission to write to the file was denied.');
    }

    const file = await fileHandle.getFile();
    const fileSize = file.size;
    console.log(`_smartEditFile: Processing ${filename} (${fileSize} bytes)`);

    if (fileSize > 500000) {
        return await _streamingEditFile({ filename, edits, fileHandle, file });
    }

    const originalContent = await file.text();
    UndoManager.push(filename, originalContent);

    let lines = originalContent.split(/\r?\n/);
    const originalLineCount = lines.length;

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
                end_line = originalLineCount;
            }

            if (expected_content) {
                const actual_content = lines.slice(start_line - 1, end_line).join('\n');
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

            const before = lines.slice(0, start_line - 1);
            const after = lines.slice(end_line);
            lines = [...before, ...newLines, ...after];
        } else if (edit.type === 'insert_lines') {
            const { line_number, new_content } = edit;
            const cleanContent = stripMarkdownCodeBlock(new_content || '');
            const newLines = cleanContent.split(/\r?\n/);

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

    const lineEnding = originalContent.includes('\r\n') ? '\r\n' : '\n';
    const newContent = lines.join(lineEnding);

    const validationResult = await validateSyntaxBeforeWrite(filename, newContent);

    const writable = await fileHandle.createWritable();
    await writable.write(newContent);
    await writable.close();

    if (fileSize < 100000 && Editor.getOpenFiles().has(filename)) {
        Editor.getOpenFiles().get(filename)?.model.setValue(newContent);
    }

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

async function _editFile({ filename, content, edits }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required.");
    
    if (content !== undefined && edits !== undefined) {
        throw new Error("Provide either 'content' OR 'edits', not both.");
    }
    
    if (content !== undefined) {
        try {
            const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
            const file = await fileHandle.getFile();
            const fileSize = file.size;
            
            if (fileSize > 1000000) {
                console.warn(`File ${filename} is large (${fileSize} bytes). Consider using 'edits' for better performance.`);
            }
        } catch (e) {
            // File doesn't exist, will be created
        }
        
        // This is a stand-in for what was _rewriteFile
        const cleanContent = stripMarkdownCodeBlock(content);
        const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename, { create: true });
        
        let hasPermission = false;
        try {
            hasPermission = await FileSystem.verifyAndRequestPermission(fileHandle, true);
        } catch (permissionError) {
            console.warn('Permission check failed, attempting to proceed:', permissionError.message);
            hasPermission = true;
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
            UndoManager.push(filename, '');
        }

        const validationResult = await validateSyntaxBeforeWrite(filename, cleanContent);

        const writable = await fileHandle.createWritable();
        await writable.write(cleanContent);
        await writable.close();
        
        if (Editor.getOpenFiles().has(filename)) {
            Editor.getOpenFiles().get(filename)?.model.setValue(cleanContent);
        }
        await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
        document.getElementById('chat-input').focus();
        let message = `File '${filename}' rewritten successfully.`;
        if (!validationResult.isValid) {
            message += `\n\nWARNING: Syntax errors were detected and have been written to the file.\nErrors:\n${validationResult.errors}${validationResult.suggestions}`;
        }
        return { message };
    }
    
    if (edits !== undefined) {
        if (!Array.isArray(edits)) {
            throw new Error("The 'edits' parameter must be an array of edit objects.");
        }
        
        if (edits.length === 0) {
            throw new Error("The 'edits' array must contain at least one edit object.");
        }
        
        return await _smartEditFile({ filename, edits }, rootHandle);
    }
    
    throw new Error("Either 'content' (for full rewrite) or 'edits' (for targeted changes) must be provided.");
}


export function registerRefactoringTools() {
    ToolRegistry.register('apply_diff', {
        handler: _applyDiff,
        requiresProject: true,
        createsCheckpoint: true,
        description: "🔧 RECOMMENDED: Apply precise, surgical changes to files using diff blocks. This is the safest and most reliable way to edit files. Use this instead of edit_file when you need to make targeted changes. CRITICAL: The diff parameter must contain properly formatted diff blocks with EXACT format:\n\n<<<<<<< SEARCH\n:start_line:10\n-------\nold code here\n=======\nnew code here\n>>>>>>> REPLACE\n\nMANDATORY REQUIREMENTS:\n1. Must include ':start_line:N' where N is the line number\n2. Must include '-------' separator line after start_line\n3. Must include '=======' separator between old and new content\n4. Each line must be exact, including whitespace and indentation\n5. Use read_file with include_line_numbers=true first to get accurate content",
        parameters: {
            filename: { type: 'string', required: true, description: 'Path to the file to modify' },
            diff: { type: 'string', required: true, description: 'One or more diff blocks in the EXACT format: <<<<<<< SEARCH\\n:start_line:N\\n-------\\nold content\\n=======\\nnew content\\n>>>>>>> REPLACE. The -------  separator line is MANDATORY.' }
        }
    });

    ToolRegistry.register('create_diff', {
        handler: _createDiff,
        requiresProject: false,
        createsCheckpoint: false,
        description: 'Creates a diff patch between two text contents.',
        parameters: {
            original_content: { type: 'string', required: true },
            new_content: { type: 'string', required: true }
        }
    });

    ToolRegistry.register('edit_file', {
        handler: _editFile,
        requiresProject: true,
        createsCheckpoint: true,
        description: "The primary tool for all file modifications. CRITICAL: Before using this tool to fix an error, you MUST use 'read_file' to get the full, up-to-date content of the file. CRITICAL: If the content you are using was retrieved with line numbers, you MUST remove the line numbers and the ` | ` separator from every line before using it in the 'new_content' or 'content' parameter. The content must be the raw source code. Provide EITHER 'content' for a full rewrite OR an 'edits' array for targeted changes.",
        parameters: {
            filename: { type: 'string', required: true },
            content: { type: 'string', description: 'Complete file content for small files. CRITICAL: Do NOT wrap in markdown backticks.' },
            edits: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', enum: ['replace_lines', 'insert_lines'] },
                        start_line: { type: 'number', description: 'Start line for replace_lines (inclusive)' },
                        end_line: { type: 'number', description: 'End line for replace_lines (inclusive)' },
                        expected_content: { type: 'string', description: 'SAFETY: The exact content of the lines to be replaced. If this does not match, the edit will fail.' },
                        line_number: { type: 'number', description: 'Line position for insert_lines (0=start of file)' },
                        new_content: { type: 'string' }
                    }
                },
                description: 'Efficient targeted edits for large files. Use replace_lines to replace line ranges or insert_lines to add content.'
            }
        }
    });
}