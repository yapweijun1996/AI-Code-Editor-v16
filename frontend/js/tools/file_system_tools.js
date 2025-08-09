import { ToolRegistry } from '../tool_registry.js';
import * as FileSystem from '../file_system.js';
import * as Editor from '../editor.js';
import * as UI from '../ui.js';
import { UndoManager } from '../undo_manager.js';
import { workerManager, ensureWorkersInitialized } from '../worker_manager.js';

function stripMarkdownCodeBlock(content) {
   if (typeof content !== 'string') {
       return content;
   }
   const match = content.match(/^```(?:\w+)?\n([\s\S]+)\n```$/);
   return match ? match[1] : content;
}

function unescapeHtmlEntities(text) {
    if (typeof text !== 'string') {
        return text;
    }
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    let decoded = textarea.value;

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
    
    const { readFileWithStrategy } = await import('../file_streaming.js');
    const file = await fileHandle.getFile();
    
    const MAX_CONTEXT_BYTES = 256000;

    await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
    document.getElementById('chat-input').focus();

    if (file.size > MAX_CONTEXT_BYTES) {
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

async function _readFileLines({ filename, start_line, end_line }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required.");
    if (typeof start_line !== 'number' || typeof end_line !== 'number') {
        throw new Error("The 'start_line' and 'end_line' parameters must be numbers.");
    }
    if (start_line > end_line) {
        throw new Error("The 'start_line' must not be after the 'end_line'.");
    }

    const fileHandle = await FileSystem.getFileHandleFromPath(rootHandle, filename);
    
    const { readFileWithStrategy, FileInfo } = await import('../file_streaming.js');
    
    let content, lines, clampedStart, clampedEnd;
    
    try {
        const file = await fileHandle.getFile();
        const fileInfo = new FileInfo(file, fileHandle);
        
        console.log(`Reading file: ${filename} (${fileInfo.formatFileSize(file.size)})`);
        console.log(`File type: ${file.type || 'unknown'}, Extension: ${fileInfo.extension}`);
        console.log(`Is text file: ${fileInfo.isText()}, Is binary file: ${fileInfo.isBinary()}`);
        
        const streamResult = await readFileWithStrategy(fileHandle, filename);
        
        if (typeof streamResult.content !== 'string') {
            console.warn(`Warning: File content for ${filename} is not a string, it is a ${typeof streamResult.content}.`);
            console.warn(`Strategy used: ${streamResult.strategy}, Content truncated: ${streamResult.truncated}`);
            
            if (streamResult.content === null || streamResult.content === undefined) {
                content = '';
            } else if (typeof streamResult.content === 'object') {
                content = streamResult.content.text || streamResult.content.content || JSON.stringify(streamResult.content);
            } else {
                content = String(streamResult.content);
            }
            console.log(`Converted content to string (length: ${content.length})`);
        } else {
            content = streamResult.content;
        }
        
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

    if (clampedStart > clampedEnd) {
        console.log(`Invalid line range: start(${clampedStart}) > end(${clampedEnd})`);
        return { content: '' };
    }

    const selectedLines = lines.slice(clampedStart - 1, clampedEnd);
    console.log(`Selected ${selectedLines.length} lines from ${clampedStart} to ${clampedEnd}`);
    
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

    const MAX_CONTEXT_BYTES = 256000;
    
    try {
        await ensureWorkersInitialized();
        
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
        
        UndoManager.push(filename, '');
        
        const writable = await fileHandle.createWritable();
        await writable.write(cleanContent);
        await writable.close();
        
        await new Promise(resolve => setTimeout(resolve, 150));
        await UI.refreshFileTree(rootHandle, (filePath) => {
            const fileHandle = FileSystem.getFileHandleFromPath(rootHandle, filePath);
            Editor.openFile(fileHandle, filePath, document.getElementById('tab-bar'));
        });
        await Editor.openFile(fileHandle, filename, document.getElementById('tab-bar'), false);
        document.getElementById('chat-input').focus();
        
        return { message: `File '${filename}' created successfully.` };
    } catch (error) {
        if (error.message.includes('User activation is required')) {
            throw new Error(`Failed to create file '${filename}': File system permission required. This happens when the AI tries to create files without user interaction. Please try clicking in the editor or file tree first, then retry the operation.`);
        }
        throw new Error(`Failed to create file '${filename}': ${error.message}`);
    }
}

async function _deleteFile({ filename }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required for delete_file.");
    if (typeof filename !== 'string') throw new Error("The 'filename' parameter must be a string.");
    
    try {
        const { parentHandle, entryName } = await FileSystem.getParentDirectoryHandle(rootHandle, filename);
        await parentHandle.removeEntry(entryName);
        
        if (Editor.getOpenFiles().has(filename)) {
            Editor.closeTab(filename, document.getElementById('tab-bar'));
        }
        
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
        await FileSystem.renameEntry(rootHandle, old_path, new_path);

        if (wasOpen) {
            const newFileHandle = await FileSystem.getFileHandleFromPath(rootHandle, new_path);
            const newName = new_path.split('/').pop();
            Editor.updateTabId(old_path, new_path, newName);
            const openFiles = Editor.getOpenFiles();
            const newEntry = openFiles.get(new_path);
            if (newEntry) {
                newEntry.handle = newFileHandle;
            }
        }

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

async function _appendToFile({ filename, content }, rootHandle) {
    if (!filename) throw new Error("The 'filename' parameter is required.");
    if (!content) throw new Error("The 'content' parameter is required.");
    
    const cleanContent = stripMarkdownCodeBlock(content);
    
    try {
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
        const existingContent = await file.text();
        
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
            return await _createFile({ filename, content: cleanContent }, rootHandle);
        }
        throw error;
    }
}

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

async function _createFolder({ folder_path }, rootHandle) {
    if (!folder_path) throw new Error("The 'folder_path' parameter is required for create_folder.");
    if (typeof folder_path !== 'string') throw new Error("The 'folder_path' parameter must be a string.");
    
    try {
        await FileSystem.createDirectoryFromPath(rootHandle, folder_path);
        
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
        
        const openFiles = Editor.getOpenFiles();
        for (const [filePath] of openFiles) {
            if (filePath.startsWith(folder_path + '/')) {
                Editor.closeTab(filePath, document.getElementById('tab-bar'));
            }
        }
        
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
        
        const openFiles = Editor.getOpenFiles();
        const filesToUpdate = [];
        for (const [filePath] of openFiles) {
            if (filePath.startsWith(old_folder_path + '/')) {
                const newFilePath = filePath.replace(old_folder_path, new_folder_path);
                filesToUpdate.push({ oldPath: filePath, newPath: newFilePath });
            }
        }
        
        for (const { oldPath, newPath } of filesToUpdate) {
            Editor.closeTab(oldPath, document.getElementById('tab-bar'));
            try {
                const newFileHandle = await FileSystem.getFileHandleFromPath(rootHandle, newPath);
                await Editor.openFile(newFileHandle, newPath, document.getElementById('tab-bar'), false);
            } catch (e) {
                console.warn(`Failed to reopen file ${newPath}:`, e.message);
            }
        }
        
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

export function registerFileSystemTools() {
  ToolRegistry.register('get_project_structure', {
    handler: _getProjectStructure,
    requiresProject: true,
    createsCheckpoint: false,
    description: 'Gets the entire file and folder structure of the project. CRITICAL: Always use this tool before attempting to read or create a file to ensure you have the correct file path.'
  });

  ToolRegistry.register('create_file', {
    handler: _createFile,
    requiresProject: true,
    createsCheckpoint: true,
    description: "Creates a new file. CRITICAL: Do NOT include the root directory name in the path. Example: To create 'app.js' in the root, the path is 'app.js', NOT 'my-project/app.js'.",
    parameters: {
        filename: { type: 'string', required: true },
        content: { type: 'string', description: 'The raw text content of the file. CRITICAL: Do NOT wrap this content in markdown backticks (```).' }
    }
  });

  ToolRegistry.register('read_file', {
    handler: _readFile,
    requiresProject: true,
    createsCheckpoint: false,
    description: "Reads a file's content. To ensure accuracy when editing, set 'include_line_numbers' to true. CRITICAL: Do NOT include the root directory name in the path.",
    parameters: {
        filename: { type: 'string', required: true },
        include_line_numbers: { type: 'boolean', description: 'Set to true to prepend line numbers to each line of the output.' }
    }
  });

  ToolRegistry.register('read_file_lines', {
    handler: _readFileLines,
    requiresProject: true,
    createsCheckpoint: false,
    description: 'Reads a specific range of lines from a file. Output will always include line numbers. Use for quick inspection of specific code sections.',
    parameters: {
        filename: { type: 'string', required: true },
        start_line: { type: 'number', required: true },
        end_line: { type: 'number', required: true }
    }
  });

  ToolRegistry.register('search_in_file', {
    handler: _searchInFile,
    requiresProject: true,
    createsCheckpoint: false,
    description: 'Searches for a pattern in a file and returns matching lines. Use this for large files.',
    parameters: {
        filename: { type: 'string', required: true },
        pattern: { type: 'string', required: true },
        context: { type: 'number' }
    }
  });

  ToolRegistry.register('read_multiple_files', {
    handler: _readMultipleFiles,
    requiresProject: true,
    createsCheckpoint: false,
    description: "Reads and concatenates the content of multiple files. Essential for multi-file context tasks.",
    parameters: {
        filenames: { type: 'array', items: { type: 'string' }, required: true }
    }
  });

  ToolRegistry.register('delete_file', {
    handler: _deleteFile,
    requiresProject: true,
    createsCheckpoint: true,
    description: "Deletes a file. CRITICAL: Do NOT include the root directory name in the path.",
    parameters: { filename: { type: 'string', required: true } }
  });

  ToolRegistry.register('rename_file', {
    handler: _renameFile,
    requiresProject: true,
    createsCheckpoint: true,
    description: "Renames a file. CRITICAL: Do NOT include the root directory name in the path.",
    parameters: {
        old_path: { type: 'string', required: true },
        new_path: { type: 'string', required: true }
    }
  });

  ToolRegistry.register('append_to_file', {
    handler: _appendToFile,
    requiresProject: true,
    createsCheckpoint: true,
    description: "Fast append content to end of file without reading full content. Ideal for logs, incremental updates.",
    parameters: {
        filename: { type: 'string', required: true },
        content: { type: 'string', required: true, description: 'Content to append. Will add newline separator automatically.' }
    }
  });

  ToolRegistry.register('get_file_info', {
    handler: _getFileInfo,
    requiresProject: true,
    createsCheckpoint: false,
    description: "Get file metadata (size, last modified, type) without reading content. Use before editing large files.",
    parameters: { filename: { type: 'string', required: true } }
  });

  ToolRegistry.register('create_folder', {
    handler: _createFolder,
    requiresProject: true,
    createsCheckpoint: true,
    description: "Creates a new folder. CRITICAL: Do NOT include the root directory name in the path.",
    parameters: { folder_path: { type: 'string', required: true } }
  });

  ToolRegistry.register('delete_folder', {
    handler: _deleteFolder,
    requiresProject: true,
    createsCheckpoint: true,
    description: "Deletes a folder and all its contents. CRITICAL: Do NOT include the root directory name in the path.",
    parameters: { folder_path: { type: 'string', required: true } }
  });

  ToolRegistry.register('rename_folder', {
    handler: _renameFolder,
    requiresProject: true,
    createsCheckpoint: true,
    description: "Renames a folder. CRITICAL: Do NOT include the root directory name in the path.",
    parameters: {
        old_folder_path: { type: 'string', required: true },
        new_folder_path: { type: 'string', required: true }
    }
  });

  console.log('[ToolRegistry] File system tools registered');
}