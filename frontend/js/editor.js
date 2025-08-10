import { getFileHandleFromPath } from './file_system.js';
import { ChatService } from './chat_service.js';
import * as UI from './ui.js';
import { monacoModelManager } from './monaco_model_manager.js';
import { appState } from './main.js';
import { readFileWithStrategy, FileInfo, ProgressTracker } from './file_streaming.js';

const MONACO_CDN_PATH = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs';

// Enhanced AI Fix Helper Functions
class AIFixAnalyzer {
    static getContextualCode(editor, lineNumber, contextLines = 10) {
        const model = editor.getModel();
        const totalLines = model.getLineCount();
        
        const startLine = Math.max(1, lineNumber - contextLines);
        const endLine = Math.min(totalLines, lineNumber + contextLines);
        
        let contextCode = '';
        for (let i = startLine; i <= endLine; i++) {
            const lineContent = model.getLineContent(i);
            const marker = i === lineNumber ? '>>> ' : '    ';
            contextCode += `${marker}${i}: ${lineContent}\n`;
        }
        
        return {
            contextCode,
            startLine,
            endLine,
            targetLine: lineNumber
        };
    }
    
    static analyzeCodeScope(editor, position) {
        const model = editor.getModel();
        const lineContent = model.getLineContent(position.lineNumber);
        
        // Detect if we're inside a function, class, or block
        let scopeStart = position.lineNumber;
        let scopeEnd = position.lineNumber;
        let indentLevel = this.getIndentLevel(lineContent);
        
        // Look backwards for function/class/block start
        for (let i = position.lineNumber - 1; i >= 1; i--) {
            const line = model.getLineContent(i);
            const currentIndent = this.getIndentLevel(line);
            
            if (line.trim() && currentIndent < indentLevel) {
                if (this.isScopeStart(line)) {
                    scopeStart = i;
                    break;
                }
            }
        }
        
        // Look forwards for scope end
        for (let i = position.lineNumber + 1; i <= model.getLineCount(); i++) {
            const line = model.getLineContent(i);
            const currentIndent = this.getIndentLevel(line);
            
            if (line.trim() && currentIndent <= indentLevel && this.isScopeEnd(line, indentLevel)) {
                scopeEnd = i - 1;
                break;
            }
        }
        
        return { scopeStart, scopeEnd, indentLevel };
    }
    
    static getIndentLevel(line) {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
    }
    
    static isScopeStart(line) {
        const trimmed = line.trim();
        return /^(function|class|if|for|while|try|catch|switch)\b/.test(trimmed) ||
               /\{$/.test(trimmed) ||
               /^def\s/.test(trimmed) ||
               /^class\s/.test(trimmed);
    }
    
    static isScopeEnd(line, expectedIndent) {
        const trimmed = line.trim();
        return trimmed === '}' ||
               (this.getIndentLevel(line) < expectedIndent && trimmed.length > 0);
    }
    
    static smartSelectCode(editor, marker, userSelection) {
        const model = editor.getModel();
        let selection;
        
        if (userSelection && !userSelection.isEmpty()) {
            // User has selected text, expand to complete lines to avoid alignment issues
            selection = this.expandToCompleteLines(editor, userSelection);
        } else if (marker) {
            // Error marker exists, analyze the scope around the error
            const scope = this.analyzeCodeScope(editor, { lineNumber: marker.startLineNumber });
            
            // Determine if we need single line or multi-line fix
            if (this.isSimpleLineFix(model.getLineContent(marker.startLineNumber))) {
                // Always select complete line to preserve indentation
                selection = new monaco.Selection(
                    marker.startLineNumber, 1,
                    marker.startLineNumber, model.getLineMaxColumn(marker.startLineNumber)
                );
            } else {
                // Select the logical scope as complete lines
                selection = new monaco.Selection(
                    scope.scopeStart, 1,
                    scope.scopeEnd, model.getLineMaxColumn(scope.scopeEnd)
                );
            }
        } else {
            // No marker, no selection - use current line and analyze
            const position = editor.getPosition();
            const scope = this.analyzeCodeScope(editor, position);
            
            // Always select complete lines
            selection = new monaco.Selection(
                scope.scopeStart, 1,
                scope.scopeEnd, model.getLineMaxColumn(scope.scopeEnd)
            );
        }
        
        return selection;
    }
    
    static expandToCompleteLines(editor, selection) {
        const model = editor.getModel();
        const startLine = selection.startLineNumber;
        const endLine = selection.endLineNumber;
        
        // Always expand to complete lines to avoid alignment issues
        let expandedStartLine = startLine;
        let expandedEndLine = endLine;
        
        // Check if selection is incomplete (e.g., missing closing braces)
        const selectedText = model.getValueInRange(new monaco.Selection(
            startLine, 1,
            endLine, model.getLineMaxColumn(endLine)
        ));
        
        const openBraces = (selectedText.match(/\{/g) || []).length;
        const closeBraces = (selectedText.match(/\}/g) || []).length;
        
        if (openBraces > closeBraces) {
            // Expand selection to include closing braces as complete lines
            for (let i = endLine + 1; i <= model.getLineCount(); i++) {
                const line = model.getLineContent(i);
                if (line.includes('}')) {
                    expandedEndLine = i;
                    break;
                }
            }
        }
        
        // Return selection that covers complete lines
        return new monaco.Selection(
            expandedStartLine, 1,
            expandedEndLine, model.getLineMaxColumn(expandedEndLine)
        );
    }
    
    static isSimpleLineFix(lineContent) {
        const trimmed = lineContent.trim();
        // Simple fixes: missing semicolon, typos, simple syntax errors
        return trimmed.length < 100 &&
               !trimmed.includes('{') &&
               !trimmed.includes('function') &&
               !trimmed.includes('class');
    }
    
    static gatherErrorContext(editor, position) {
        const markers = monaco.editor.getModelMarkers({ resource: editor.getModel().uri });
        const relevantMarkers = markers.filter(m =>
            Math.abs(m.startLineNumber - position.lineNumber) <= 5
        );
        
        return relevantMarkers.map(m => ({
            line: m.startLineNumber,
            message: m.message,
            severity: m.severity === monaco.MarkerSeverity.Error ? 'Error' : 'Warning'
        }));
    }
    
    static generateEnhancedPrompt(editor, marker, selection, filePath) {
        const model = editor.getModel();
        const context = this.gatherErrorContext(editor, { lineNumber: marker ? marker.startLineNumber : selection.startLineNumber });
        const contextualCode = this.getContextualCode(editor, marker ? marker.startLineNumber : selection.startLineNumber);
        const selectedText = model.getValueInRange(selection);
        
        let prompt = `ENHANCED AI CODE ANALYSIS AND FIX REQUEST\n\n`;
        
        prompt += `FILE: ${filePath}\n`;
        prompt += `TARGET LINES: ${selection.startLineNumber}-${selection.endLineNumber}\n\n`;
        
        if (marker) {
            prompt += `PRIMARY ERROR:\n`;
            prompt += `- Line ${marker.startLineNumber}: ${marker.message}\n\n`;
        }
        
        if (context.length > 0) {
            prompt += `RELATED ISSUES IN NEARBY CODE:\n`;
            context.forEach(ctx => {
                prompt += `- Line ${ctx.line} (${ctx.severity}): ${ctx.message}\n`;
            });
            prompt += `\n`;
        }
        
        prompt += `CODE CONTEXT (with target area marked >>>):\n`;
        prompt += `\`\`\`\n${contextualCode.contextCode}\`\`\`\n\n`;
        
        prompt += `SELECTED CODE TO FIX:\n`;
        prompt += `\`\`\`\n${selectedText}\`\`\`\n\n`;
        
        prompt += `ANALYSIS REQUIREMENTS:\n`;
        prompt += `1. Identify the root cause of the issue(s)\n`;
        prompt += `2. Analyze the code scope and determine if the selection is optimal\n`;
        prompt += `3. Check for related issues that should be fixed together\n`;
        prompt += `4. Consider the broader context and potential side effects\n\n`;
        
        prompt += `TASK:\n`;
        prompt += `Provide the corrected code that fixes all identified issues. `;
        prompt += `Use the 'replace_selected_text' tool to apply the fix. `;
        prompt += `Explain what was wrong and how your fix addresses the problems.\n\n`;
        
        prompt += `IMPORTANT: The fix should be comprehensive and consider the full context, not just the immediate error.`;
        
        return prompt;
    }
}

let editor;
let openFiles = new Map(); // Key: filePath (string), Value: { handle, name, model, viewState }
let activeFilePath = null;
let codeLensProvider = null;

function getLanguageFromExtension(ext) {
    return ({
        cfm: 'html',
        cfml: 'html',
        js: 'javascript',
        ts: 'typescript',
        java: 'java',
        py: 'python',
        html: 'html',
        css: 'css',
        json: 'json',
        md: 'markdown',
        php: 'php',
    })[ext] || 'plaintext';
}

function renderTabs(tabBarContainer, onTabClick, onTabClose) {
    tabBarContainer.innerHTML = '';
    openFiles.forEach((fileData, filePath) => {
        const tab = document.createElement('div');
        tab.className = 'tab' + (filePath === activeFilePath ? ' active' : '');
        tab.textContent = fileData.name;
        tab.onclick = () => onTabClick(filePath);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close-btn';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            onTabClose(filePath);
        };

        tab.appendChild(closeBtn);
        tabBarContainer.appendChild(tab);
    });
}

export function clearEditor() {
    if (editor) {
        // Use managed model instead of creating directly
        const placeholderModel = monacoModelManager.getModel(
            '__placeholder__', 
            '// Select a file to view its content',
            'plaintext'
        );
        editor.setModel(placeholderModel);
        editor.updateOptions({ readOnly: true });
    }
    
    // Properly dispose of all open file models
    for (const [filePath] of openFiles) {
        monacoModelManager.disposeModel(filePath);
    }
    
    activeFilePath = null;
    openFiles = new Map();
}

export function initializeEditor(editorContainer, tabBarContainer, appState) {
    return new Promise((resolve) => {
        require.config({ paths: { 'vs': MONACO_CDN_PATH } });
        require(['vs/editor/editor.main'], () => {
            monaco.editor.defineTheme('cfmlTheme', {
                base: 'vs-dark',
                inherit: true,
                rules: [
                    { token: 'tag', foreground: '569cd6' },
                    { token: 'delimiter', foreground: 'd4d4d4' },
                    { token: 'attribute.name', foreground: '9cdcfe' },
                    { token: 'attribute.value', foreground: 'ce9178' },
                    { token: 'string', foreground: 'd69d85' },
                    { token: 'number', foreground: 'b5cea8' },
                    { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
                ],
                colors: {
                    'editor.foreground': '#D4D4D4',
                    'editor.background': '#1E1E1E',
                    'editor.lineHighlightBackground': '#2c313c',
                    'editorCursor.foreground': '#528BFF',
                    'editorWhitespace.foreground': '#3B4048',
                    'editor.selectionBackground': '#264F78',
                    'editor.inactiveSelectionBackground': '#3A3D41',
                },
            });
            monaco.editor.setTheme('cfmlTheme');
            editor = monaco.editor.create(editorContainer, {
                value: `<!-- Click "Open Project Folder" to start -->`,
                language: 'html',
                theme: 'cfmlTheme',
                readOnly: true,
            });
            
            // Set the createModel function in the manager now that Monaco is loaded
            monacoModelManager.setCreateModelFunction(monaco.editor.createModel);

            const onTabClick = (filePath) => switchTab(filePath, tabBarContainer);
            const onTabClose = (filePath) => closeTab(filePath, tabBarContainer);
            
            // Initial render
            renderTabs(tabBarContainer, onTabClick, onTabClose);

            // Register the enhanced AI fix command
            monaco.editor.registerCommand("editor.action.fixErrorWithAI", function(accessor, marker) {
                // Enhanced workflow with smart analysis and auto-selection
                const currentSelection = editor.getSelection();
                
                // Phase 1: Smart Selection - Determine optimal code range to fix
                const smartSelection = AIFixAnalyzer.smartSelectCode(editor, marker, currentSelection);
                
                // Phase 2: Apply the smart selection to highlight what will be fixed
                editor.setSelection(smartSelection);
                
                // Phase 3: Generate enhanced prompt with comprehensive context
                const enhancedPrompt = AIFixAnalyzer.generateEnhancedPrompt(
                    editor,
                    marker,
                    smartSelection,
                    getActiveFilePath()
                );

                // Phase 4: Send to AI with enhanced context and auto-save callback
                const chatMessages = document.getElementById('chat-messages');
                
                // Create a wrapper for the enhanced prompt that includes auto-save instruction
                const promptWithAutoSave = `${enhancedPrompt}

IMPORTANT: After successfully applying the fix using the 'replace_selected_text' tool, automatically save the file to preserve the changes.`;

                ChatService.sendDirectCommand(promptWithAutoSave, chatMessages).then(() => {
                    // Auto-save after AI completes the fix
                    setTimeout(() => {
                        saveActiveFile();
                        console.log('Auto-saved file after AI fix');
                    }, 1000); // Small delay to ensure AI operations complete
                });
                
                // Show user feedback about what was selected
                const selectedLines = smartSelection.endLineNumber - smartSelection.startLineNumber + 1;
                const selectionInfo = selectedLines === 1 ?
                    `line ${smartSelection.startLineNumber}` :
                    `lines ${smartSelection.startLineNumber}-${smartSelection.endLineNumber}`;
                
                console.log(`AI Fix: Analyzing and fixing ${selectionInfo} with enhanced context`);
            });

            // Add the enhanced context menu action
            editor.addAction({
                id: "editor.action.fixErrorWithAIContextMenu",
                label: "Fix with AI (Enhanced)",
                contextMenuGroupId: "navigation",
                contextMenuOrder: 1.5,
                run: function(ed) {
                    const position = ed.getPosition();
                    const markers = monaco.editor.getModelMarkers({ resource: ed.getModel().uri })
                        .filter(m => m.severity === monaco.MarkerSeverity.Error && m.startLineNumber === position.lineNumber);
                    
                    if (markers.length > 0) {
                        // Use the enhanced command for error markers
                        ed.trigger('source', 'editor.action.fixErrorWithAI', markers[0]);
                    } else {
                        // Enhanced workflow for general code improvement
                        const currentSelection = ed.getSelection();
                        
                        // Create a pseudo-marker for non-error fixes
                        const pseudoMarker = {
                            startLineNumber: currentSelection.isEmpty() ? position.lineNumber : currentSelection.startLineNumber,
                            endLineNumber: currentSelection.isEmpty() ? position.lineNumber : currentSelection.endLineNumber,
                            message: "Code improvement requested by user"
                        };
                        
                        // Use the same enhanced workflow
                        const smartSelection = AIFixAnalyzer.smartSelectCode(editor, pseudoMarker, currentSelection);
                        editor.setSelection(smartSelection);
                        
                        const enhancedPrompt = AIFixAnalyzer.generateEnhancedPrompt(
                            editor,
                            null, // No actual error marker
                            smartSelection,
                            getActiveFilePath()
                        );
                        
                        // Modify prompt for general improvement
                        const improvementPrompt = enhancedPrompt.replace(
                            'ENHANCED AI CODE ANALYSIS AND FIX REQUEST',
                            'ENHANCED AI CODE ANALYSIS AND IMPROVEMENT REQUEST'
                        ).replace(
                            'PRIMARY ERROR:',
                            'IMPROVEMENT REQUEST:'
                        ).replace(
                            'Provide the corrected code that fixes all identified issues',
                            'Analyze the code and provide improvements for better quality, performance, or readability'
                        );
                        
                        const chatMessages = document.getElementById('chat-messages');
                        
                        // Add auto-save instruction to the improvement prompt
                        const improvementPromptWithAutoSave = `${improvementPrompt}

IMPORTANT: After successfully applying the improvements using the 'replace_selected_text' tool, automatically save the file to preserve the changes.`;

                        ChatService.sendDirectCommand(improvementPromptWithAutoSave, chatMessages).then(() => {
                            // Auto-save after AI completes the improvement
                            setTimeout(() => {
                                saveActiveFile();
                                console.log('Auto-saved file after AI improvement');
                            }, 1000); // Small delay to ensure AI operations complete
                        });
                        
                        const selectedLines = smartSelection.endLineNumber - smartSelection.startLineNumber + 1;
                        const selectionInfo = selectedLines === 1 ?
                            `line ${smartSelection.startLineNumber}` :
                            `lines ${smartSelection.startLineNumber}-${smartSelection.endLineNumber}`;
                        
                        console.log(`AI Improvement: Analyzing and enhancing ${selectionInfo} with context`);
                    }
                }
            });

            if (codeLensProvider) {
                codeLensProvider.dispose();
            }
            
            codeLensProvider = monaco.languages.registerCodeLensProvider(['javascript', 'typescript', 'python', 'java', 'html', 'css'], {
                provideCodeLenses: function(model, token) {
                    const markers = monaco.editor.getModelMarkers({ resource: model.uri });
                    const lenses = [];
                    markers.forEach(marker => {
                        if (marker.severity === monaco.MarkerSeverity.Error) {
                            lenses.push({
                                range: {
                                    startLineNumber: marker.startLineNumber,
                                    startColumn: marker.startColumn,
                                    endLineNumber: marker.endLineNumber,
                                    endColumn: marker.endColumn
                                },
                                id: "fixErrorLens",
                                command: {
                                    id: "editor.action.fixErrorWithAI",
                                    title: "✨ Fix with AI",
                                    arguments: [marker]
                                }
                            });
                        }
                    });
                    return {
                        lenses: lenses,
                        dispose: () => {}
                    };
                },
                resolveCodeLens: function(model, codeLens, token) {
                    return codeLens;
                }
            });

            resolve(editor);
        });
    });
}

export async function openFile(fileHandle, filePath, tabBarContainer, focusEditor = true) {
    if (openFiles.has(filePath)) {
        await switchTab(filePath, tabBarContainer, focusEditor);
        return;
    }

    try {
        const file = await fileHandle.getFile();
        const fileInfo = new FileInfo(file, fileHandle);
        
        // Show loading indicator for large files
        let loadingToast = null;
        if (fileInfo.isLarge) {
            loadingToast = UI.showToast(`Loading ${file.name}...`, 'info', 0); // 0 duration = persistent
        }

        try {
            // Use streaming file reader with progress tracking
            const options = {
                onProgress: (progress, loaded, total) => {
                    if (loadingToast && fileInfo.isLarge) {
                        const progressTracker = new ProgressTracker(total);
                        progressTracker.update(loaded);
                        const progressPercent = progress.toFixed(1);
                        const currentFormatted = progressTracker.formatBytes(loaded);
                        const totalFormatted = progressTracker.formatBytes(total);
                        
                        // Update toast message with progress
                        updateToastMessage(loadingToast, 
                            `Loading ${file.name}... ${progressPercent}% (${currentFormatted}/${totalFormatted})`);
                    }
                }
            };

            // For very large files, offer preview option
            if (fileInfo.size > 50 * 1024 * 1024) { // 50MB
                const fileSize = new ProgressTracker(0).formatBytes(fileInfo.size);
                const userChoice = confirm(
                    `This file is ${fileSize}. Loading the entire file may slow down the editor.\n\n` +
                    'Click OK to load a preview (1MB), or Cancel to load the full file.'
                );
                
                if (userChoice) {
                    options.previewOnly = true;
                    options.previewSize = 1024 * 1024; // 1MB preview
                }
            }

            const result = await readFileWithStrategy(fileHandle, filePath, options);
            
            if (!result.content && result.strategy === 'binary') {
                UI.showError(`Cannot open binary file: ${file.name}`);
                return;
            }

            // Use managed model creation with streaming strategy
            const language = getLanguageFromExtension(file.name.split('.').pop());
            const modelOptions = {
                strategy: result.strategy,
                truncated: result.truncated
            };
            
            const model = monacoModelManager.getModel(
                filePath,
                result.content,
                language,
                modelOptions
            );

            // Add truncation warning if applicable
            if (result.truncated) {
                addTruncationWarning(model, result);
            }

            openFiles.set(filePath, {
                handle: fileHandle,
                name: file.name,
                model: model,
                viewState: null,
                fileInfo: fileInfo,
                loadStrategy: result.strategy,
                truncated: result.truncated
            });

            await switchTab(filePath, tabBarContainer, focusEditor);
            
            // Show success message for large files
            if (fileInfo.isLarge) {
                const fileSize = new ProgressTracker(0).formatBytes(fileInfo.size);
                const message = result.truncated 
                    ? `Preview loaded: ${file.name} (${new ProgressTracker(0).formatBytes(result.previewSize || 1024*1024)} shown of ${fileSize})`
                    : `Large file loaded: ${file.name} (${fileSize})`;
                UI.showToast(message, 'success', 5000);
            }

        } finally {
            if (loadingToast) {
                hideToast(loadingToast);
            }
        }

    } catch (error) {
        console.error(`Failed to open file ${filePath}:`, error);
        UI.showError(`Failed to open file: ${error.message}`);
    }
}

/**
 * Add truncation warning to Monaco model
 */
function addTruncationWarning(model, result) {
    if (!monaco?.editor) return;
    
    try {
        // Add a marker to indicate truncation
        const warningMessage = `⚠️ File truncated: Showing ${result.previewSize || 'partial'} content of ${result.size} total bytes`;
        
        // Add decoration to the first line
        const decorations = [{
            range: new monaco.Range(1, 1, 1, 1),
            options: {
                isWholeLine: true,
                className: 'truncation-warning-line',
                glyphMarginClassName: 'truncation-warning-glyph',
                hoverMessage: { value: warningMessage }
            }
        }];
        
        model.deltaDecorations([], decorations);
        
        // Add CSS for the warning if not already added
        if (!document.getElementById('truncation-warning-styles')) {
            const style = document.createElement('style');
            style.id = 'truncation-warning-styles';
            style.textContent = `
                .truncation-warning-line {
                    background-color: rgba(255, 193, 7, 0.1) !important;
                }
                .truncation-warning-glyph:before {
                    content: "⚠️";
                    color: #ffc107;
                }
            `;
            document.head.appendChild(style);
        }
    } catch (error) {
        console.warn('Failed to add truncation warning:', error);
    }
}

/**
 * Update toast message content
 */
function updateToastMessage(toast, message) {
    if (toast && toast.querySelector) {
        const messageElement = toast.querySelector('.toast-message');
        if (messageElement) {
            messageElement.textContent = message;
        }
    }
}

/**
 * Hide a specific toast
 */
function hideToast(toast) {
    if (toast && toast.remove) {
        toast.remove();
    }
}

export async function switchTab(filePath, tabBarContainer, focusEditor = true) {
    if (activeFilePath && openFiles.has(activeFilePath)) {
        openFiles.get(activeFilePath).viewState = editor.saveViewState();
    }

    activeFilePath = filePath;
    const fileData = openFiles.get(filePath);

    editor.setModel(fileData.model);
    if (fileData.viewState) {
        editor.restoreViewState(fileData.viewState);
    }
    if (focusEditor) {
        editor.focus();
    }
    editor.updateOptions({ readOnly: false });
    
    const onTabClick = (fp) => switchTab(fp, tabBarContainer, true); // User clicks always focus
    const onTabClose = (fp) => closeTab(fp, tabBarContainer);
    renderTabs(tabBarContainer, onTabClick, onTabClose);
}

export function updateTabId(oldPath, newPath, newName) {
    if (openFiles.has(oldPath)) {
        const fileData = openFiles.get(oldPath);
        openFiles.delete(oldPath);

        fileData.name = newName;
        openFiles.set(newPath, fileData);

        monacoModelManager.renameModel(oldPath, newPath);

        if (activeFilePath === oldPath) {
            activeFilePath = newPath;
        }

        const tabBarContainer = document.getElementById('tab-bar');
        const onTabClick = (fp) => switchTab(fp, tabBarContainer);
        const onTabClose = (fp) => closeTab(fp, tabBarContainer);
        renderTabs(tabBarContainer, onTabClick, onTabClose);
    }
}

export function updateTabPathsForFolderRename(oldFolderPath, newFolderPath) {
    const tabBarContainer = document.getElementById('tab-bar');
    const onTabClick = (fp) => switchTab(fp, tabBarContainer);
    const onTabClose = (fp) => closeTab(fp, tabBarContainer);
    const pathsToUpdate = [];

    for (const [filePath, fileData] of openFiles.entries()) {
        if (filePath.startsWith(oldFolderPath + '/')) {
            pathsToUpdate.push(filePath);
        }
    }

    if (pathsToUpdate.length > 0) {
        for (const oldPath of pathsToUpdate) {
            const newPath = oldPath.replace(oldFolderPath, newFolderPath);
            const fileData = openFiles.get(oldPath);
            
            openFiles.delete(oldPath);
            openFiles.set(newPath, fileData);
            monacoModelManager.renameModel(oldPath, newPath);

            if (activeFilePath === oldPath) {
                activeFilePath = newPath;
            }
        }
        renderTabs(tabBarContainer, onTabClick, onTabClose);
    }
}

export function closeTab(filePath, tabBarContainer) {
    const fileData = openFiles.get(filePath);
    if (fileData && fileData.model) {
        // Use model manager for proper disposal
        monacoModelManager.disposeModel(filePath);
    }
    openFiles.delete(filePath);

    if (activeFilePath === filePath) {
        activeFilePath = null;
        const nextFile = openFiles.keys().next().value;
        if (nextFile) {
            switchTab(nextFile, tabBarContainer);
        } else {
            clearEditor();
            renderTabs(tabBarContainer, () => {}, () => {});
        }
    } else {
        const onTabClick = (fp) => switchTab(fp, tabBarContainer);
        const onTabClose = (fp) => closeTab(fp, tabBarContainer);
        renderTabs(tabBarContainer, onTabClick, onTabClose);
    }
}

// Tab Context Menu Functions
export function closeOtherTabs(excludeFilePath, tabBarContainer) {
    const filesToClose = [];
    for (const filePath of openFiles.keys()) {
        if (filePath !== excludeFilePath) {
            filesToClose.push(filePath);
        }
    }
    
    // Close all other tabs
    for (const filePath of filesToClose) {
        closeTab(filePath, tabBarContainer);
    }
}

export function closeAllTabs(tabBarContainer) {
    const filesToClose = Array.from(openFiles.keys());
    
    // Close all tabs
    for (const filePath of filesToClose) {
        closeTab(filePath, tabBarContainer);
    }
}

export function closeTabsToLeft(targetFilePath, tabBarContainer) {
    const tabOrder = Array.from(openFiles.keys());
    const targetIndex = tabOrder.indexOf(targetFilePath);
    
    if (targetIndex === -1) return;
    
    // Close all tabs to the left
    for (let i = 0; i < targetIndex; i++) {
        closeTab(tabOrder[i], tabBarContainer);
    }
}

export function closeTabsToRight(targetFilePath, tabBarContainer) {
    const tabOrder = Array.from(openFiles.keys());
    const targetIndex = tabOrder.indexOf(targetFilePath);
    
    if (targetIndex === -1) return;
    
    // Close all tabs to the right
    for (let i = targetIndex + 1; i < tabOrder.length; i++) {
        closeTab(tabOrder[i], tabBarContainer);
    }
}

export async function saveActiveFile() {
    if (!activeFilePath) return;
    try {
        const fileData = openFiles.get(activeFilePath);
        const writable = await fileData.handle.createWritable();
        await writable.write(fileData.model.getValue());
        await writable.close();
        console.log(`File '${fileData.name}' saved successfully`);
    } catch (error) {
        console.error(`Failed to save file:`, error);
    }
}

export async function saveAllOpenFiles() {
    for (const [filePath, fileData] of openFiles.entries()) {
        try {
            const writable = await fileData.handle.createWritable();
            await writable.write(fileData.model.getValue());
            await writable.close();
            console.log(`File '${fileData.name}' saved successfully.`);
        } catch (error) {
            console.error(`Failed to save file '${fileData.name}':`, error);
        }
    }
}

export function getActiveFile() {
    if (!activeFilePath) return null;
    return openFiles.get(activeFilePath);
}

export function getEditorInstance() {
    return editor;
}

export function getOpenFiles() {
    return openFiles;
}

export function getActiveFilePath() {
    return activeFilePath;
}

export function getPrettierParser(filename) {
    const extension = filename.split('.').pop();
    switch (extension) {
        case 'js':
        case 'ts':
        case 'jsx':
        case 'tsx':
        return 'babel';
        case 'html':
        return 'html';
        case 'css':
        case 'scss':
        case 'less':
        return 'css';
        case 'json':
        return 'json';
        case 'md':
        return 'markdown';
        default:
        return 'babel';
    }
}

export function getEditorState() {
    if (activeFilePath && openFiles.has(activeFilePath)) {
        openFiles.get(activeFilePath).viewState = editor.saveViewState();
    }

    const files = [];
    for (const [path, data] of openFiles.entries()) {
        files.push({
            path: path,
            content: data.model.getValue(),
            viewState: data.viewState,
        });
    }

    return {
        openFiles: files,
        activeFile: activeFilePath,
    };
}

export async function restoreEditorState(state, rootHandle, tabBarContainer) {
    if (!state || !state.openFiles) return;

    for (const fileData of state.openFiles) {
        try {
            const fileHandle = await getFileHandleFromPath(rootHandle, fileData.path, { create: true });
            // Use managed model creation
            const model = monacoModelManager.getModel(
                fileData.path,
                fileData.content,
                getLanguageFromExtension(fileData.path.split('.').pop())
            );
            openFiles.set(fileData.path, {
                handle: fileHandle,
                name: fileHandle.name,
                model: model,
                viewState: fileData.viewState,
            });
        } catch (error) {
            console.error(`Could not restore file ${fileData.path}:`, error);
        }
    }

    if (state.activeFile && openFiles.has(state.activeFile)) {
        await switchTab(state.activeFile, tabBarContainer, true);
    } else if (openFiles.size > 0) {
        // If active file is gone, open the first available one
        const firstFile = openFiles.keys().next().value;
        await switchTab(firstFile, tabBarContainer, true);
    } else {
        // No files to restore, just render empty tabs
        renderTabs(tabBarContainer, () => {}, () => {});
    }
}
export async function restoreCheckpointState(state, rootHandle, tabBarContainer) {
    // Close all current tabs without saving their state
    const currentFiles = Array.from(openFiles.keys());
    for (const filePath of currentFiles) {
        const fileData = openFiles.get(filePath);
        if (fileData && fileData.model) {
            // Use model manager for proper disposal
            monacoModelManager.disposeModel(filePath);
        }
        openFiles.delete(filePath);
    }
    activeFilePath = null;

    // Restore files from the checkpoint state
    await restoreEditorState(state, rootHandle, tabBarContainer);
}

export function getModelMarkers(filePath) {
    const fileData = openFiles.get(filePath);
    if (!fileData || !fileData.model) {
        return [];
    }
    return monaco.editor.getModelMarkers({ resource: fileData.model.uri });
}

export function getFormattedErrors(filePath) {
    const markers = getModelMarkers(filePath);
    const errors = markers.filter(m => m.severity === monaco.MarkerSeverity.Error);

    if (errors.length === 0) {
        return null;
    }

    return errors.map(e => `- Line ${e.startLineNumber}, Col ${e.startColumn}: ${e.message}`).join('\n');
}
