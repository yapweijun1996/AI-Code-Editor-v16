import { ToolRegistry } from '../tool_registry.js';
import * as Editor from '../editor.js';

function stripMarkdownCodeBlock(content) {
   if (typeof content !== 'string') {
       return content;
   }
   const match = content.match(/^```(?:\w+)?\n([\s\S]+)\n```$/);
   return match ? match[1] : content;
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

export function registerEditorTools() {
    ToolRegistry.register('get_open_file_content', {
        handler: _getOpenFileContent,
        requiresProject: false,
        createsCheckpoint: false,
        description: 'Gets the content of the currently open file in the editor.'
    });

    ToolRegistry.register('get_selected_text', {
        handler: _getSelectedText,
        requiresProject: false,
        createsCheckpoint: false,
        description: 'Gets the text currently selected by the user in the editor.'
    });

    ToolRegistry.register('set_selected_text', {
        handler: _setSelectedText,
        requiresProject: false,
        createsCheckpoint: false,
        description: 'Sets the user\'s selection in the editor to the specified range.',
        parameters: {
            start_line: { type: 'number', required: true },
            start_column: { type: 'number', required: true },
            end_line: { type: 'number', required: true },
            end_column: { type: 'number', required: true }
        }
    });

    ToolRegistry.register('replace_selected_text', {
        handler: _replaceSelectedText,
        requiresProject: false,
        createsCheckpoint: false,
        description: 'Replaces the currently selected text in the editor with new text.',
        parameters: {
            new_text: { type: 'string', required: true, description: 'The raw text to replace the selection with. CRITICAL: Do NOT wrap this content in markdown backticks (```).' }
        }
    });
}