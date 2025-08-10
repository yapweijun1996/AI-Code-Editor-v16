// Core systems
import { performanceProfiler } from './core/performance_profiler.js';
import { container } from './core/di_container.js';
import { errorHandler, ErrorSeverity } from './core/error_handler.js';
import { appStateManager, migrateFromOldAppState } from './core/state_manager.js';

// Existing modules
import { Settings, dispatchLLMSettingsUpdated } from './settings.js';
import { ChatService } from './chat_service.js';
import * as Editor from './editor.js';
import * as UI from './ui.js';
import * as FileSystem from './file_system.js';
import { initializeEventListeners } from './events.js';
import { DbManager } from './db.js';
import { taskManager } from './task_manager.js';
import { todoListUI } from './todo_list_ui.js';

// Legacy appState for backward compatibility during migration
export const appState = {
    rootDirectoryHandle: null,
    uploadedImage: null,
    isFileTreeCollapsed: false,
    editor: null,
    onFileSelect: null,
    saveCurrentSession: null,
    clearImagePreview: null,
    handleFixErrors: null,
    handleImageUpload: null,
    handleCreateFile: null,
    handleCreateFolder: null,
    handleRenameEntry: null,
    handleDeleteEntry: null,
};

// Initialize core systems
async function initializeCoreServices() {
    const startTime = performance.now();
    
    try {
        // Register core services with DI container
        container
            .registerInstance('PerformanceProfiler', performanceProfiler)
            .registerInstance('ErrorHandler', errorHandler)
            .registerInstance('StateManager', appStateManager)
            .registerSingleton('Settings', Settings)
            .registerSingleton('DbManager', DbManager)
            .registerSingleton('ChatService', ChatService)
            .registerSingleton('TaskManager', taskManager);

        // Initialize performance profiling
        performanceProfiler.recordMetric('app', 'coreServicesInit', performance.now() - startTime);
        
        // Migrate legacy state
        migrateFromOldAppState(appState);
        
        console.log('[Main] Core services initialized successfully');
        return true;
    } catch (error) {
        errorHandler.handleError(error, {
            context: 'coreServicesInit',
            severity: ErrorSeverity.HIGH
        });
        return false;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const appInitTimer = performanceProfiler.startTimer('app.initialization');
    
    try {
        // Initialize core services first
        const coreInitialized = await initializeCoreServices();
        if (!coreInitialized) {
            throw new Error('Failed to initialize core services');
        }

        // Update app state to indicate loading
        appStateManager.updateApp({ loading: true });

        // --- DOM Elements ---
    const editorContainer = document.getElementById('editor');
    const tabBarContainer = document.getElementById('tab-bar');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const chatSendButton = document.getElementById('chat-send-button');
    const chatCancelButton = document.getElementById('chat-cancel-button');
    const apiKeysTextarea = document.getElementById('api-keys-textarea');
    const imagePreviewContainer = document.getElementById('image-preview-container');

    // --- Initialization ---
    appState.editor = await Editor.initializeEditor(editorContainer, tabBarContainer, appState);
    UI.initResizablePanels(appState.editor);
    
    // Initialize task management UI
    if (window.todoListUI) {
        window.todoListUI.initialize();
        console.log('[Main] TodoListUI initialized.');
    } else {
        console.error('[Main] TodoListUI not found on window object.');
    }

    appState.onFileSelect = async (filePath) => {
        const fileHandle = await FileSystem.getFileHandleFromPath(appState.rootDirectoryHandle, filePath);
        await Editor.openFile(fileHandle, filePath, tabBarContainer);
    };


    async function tryRestoreDirectory() {
        const savedHandle = await DbManager.getDirectoryHandle();
        if (!savedHandle) {
            UI.updateDirectoryButtons(false);
            return;
        }

        if ((await savedHandle.queryPermission({ mode: 'readwrite' })) === 'granted') {
            appState.rootDirectoryHandle = savedHandle;
            appState.rootDirectoryHandle = savedHandle;
            await UI.refreshFileTree(savedHandle, appState.onFileSelect, appState);

            const savedState = await DbManager.getSessionState();
            if (savedState) {
                await Editor.restoreEditorState(savedState.tabs, appState.rootDirectoryHandle, tabBarContainer);
            }
            UI.updateDirectoryButtons(true);
        } else {
            UI.updateDirectoryButtons(false, true);
        }
    }

    // --- Initialization ---
    await Settings.initialize();
    await tryRestoreDirectory();
    
    // Setup one-time UI event listeners
    UI.initializeUI();

    // Clear the chat input on startup to prevent submission on reload
    chatInput.value = '';

    if (appState.rootDirectoryHandle) {
        await ChatService.initialize(appState.rootDirectoryHandle);
    }
    
    // Listen for settings changes to re-initialize the chat service
    document.addEventListener('llm-settings-updated', async () => {
        console.log('LLM settings updated, re-initializing chat service...');
        UI.updateLLMProviderStatus();
        if (appState.rootDirectoryHandle) {
            await ChatService.initialize(appState.rootDirectoryHandle);
        }
    });

    appState.saveCurrentSession = async () => {
        if (!appState.rootDirectoryHandle) return;

        const editorState = Editor.getEditorState();
        const sessionState = {
            id: 'lastSession',
            editor: editorState,
        };
        await DbManager.saveSessionState(sessionState);
    };

    appState.clearImagePreview = () => {
        appState.uploadedImage = null;
        const imageInput = document.getElementById('image-input');
        imageInput.value = '';
        UI.updateImagePreview(imagePreviewContainer, null, appState.clearImagePreview);
    };

    appState.handleImageUpload = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            appState.uploadedImage = {
                name: file.name,
                type: file.type,
                data: e.target.result.split(',')[1],
            };
            UI.updateImagePreview(imagePreviewContainer, appState.uploadedImage, appState.clearImagePreview);
        };
        reader.readAsDataURL(file);
    };

    appState.handleFixErrors = () => {
        const activeFilePath = Editor.getActiveFilePath();
        if (!activeFilePath) {
            UI.showError('Please open a file to fix errors in.');
            return;
        }

        const errorDetails = Editor.getFormattedErrors(activeFilePath);

        if (!errorDetails) {
            UI.showError('No errors found in the current file.');
            return;
        }

        const prompt = `
The following errors have been detected in the file \`${activeFilePath}\`. Please fix them.

**Errors:**
\`\`\`
${errorDetails}
\`\`\`

Analyze the code and provide the necessary changes to resolve these issues.
        `;

        chatInput.value = prompt.trim();
        ChatService.sendMessage(chatInput, chatMessages, chatSendButton, chatCancelButton, null, () => {});
    };

    appState.handleCreateFile = async (parentNode, newFileName) => {
        const parentPath = (parentNode.id === '#' || parentNode.id === appState.rootDirectoryHandle.name) ? '' : parentNode.id;
        const newFilePath = parentPath ? `${parentPath}/${newFileName}` : newFileName;
        try {
            const fileHandle = await FileSystem.getFileHandleFromPath(appState.rootDirectoryHandle, newFilePath, { create: true });
            await UI.refreshFileTree(appState.rootDirectoryHandle, appState.onFileSelect, appState);
            Editor.openFile(fileHandle, newFilePath, tabBarContainer);
        } catch (error) {
            console.error('Error creating file:', error);
            UI.showError(`Failed to create file: ${error.message}`);
        }
    };

    appState.handleCreateFolder = async (parentNode, newFolderName) => {
        const parentPath = (parentNode.id === '#' || parentNode.id === appState.rootDirectoryHandle.name) ? '' : parentNode.id;
        const newFolderPath = parentPath ? `${parentPath}/${newFolderName}` : newFolderName;
        try {
            await FileSystem.createDirectoryFromPath(appState.rootDirectoryHandle, newFolderPath);
            await UI.refreshFileTree(appState.rootDirectoryHandle, appState.onFileSelect, appState);
        } catch (error) {
            console.error('Error creating folder:', error);
            UI.showError(`Failed to create folder: ${error.message}`);
        }
    };

    appState.handleRenameEntry = async (node, newName, oldName) => {
        const parentPath = (node.parent === '#' || node.parent === appState.rootDirectoryHandle.name) ? '' : node.parent;
        const oldPath = parentPath ? `${parentPath}/${oldName}` : oldName;
        const newPath = parentPath ? `${parentPath}/${newName}` : newName;
        const isFolder = node.type === 'folder';

        try {
            await FileSystem.renameEntry(appState.rootDirectoryHandle, oldPath, newPath);

            if (isFolder) {
                Editor.updateTabPathsForFolderRename(oldPath, newPath);
            } else {
                Editor.updateTabId(oldPath, newPath, newName);
            }

            await UI.refreshFileTree(appState.rootDirectoryHandle, appState.onFileSelect, appState);
        } catch (error) {
            console.error('Error renaming entry:', error);
            UI.showError(`Failed to rename: ${error.message}`);
            await UI.refreshFileTree(appState.rootDirectoryHandle, appState.onFileSelect, appState);
        }
    };

    appState.handleDeleteEntry = async (node) => {
        const path = node.id;
        try {
            await FileSystem.deleteEntry(appState.rootDirectoryHandle, path);
            await UI.refreshFileTree(appState.rootDirectoryHandle, appState.onFileSelect, appState);
        } catch (error) {
            console.error('Error deleting entry:', error);
            UI.showError(`Failed to delete: ${error.message}`);
        }
    };


    initializeEventListeners(appState);

    // Mark app as initialized
    appStateManager.updateApp({ 
        initialized: true, 
        loading: false 
    });

    // Relayout panels after a short delay to fix initialization issue
    setTimeout(() => UI.relayout(appState.editor), 100);
    
    // Complete initialization timing
    performanceProfiler.endTimer(appInitTimer);
    
    console.log('[Main] Application initialization completed successfully');
    
    } catch (error) {
        // Handle initialization errors
        errorHandler.handleError(error, {
            context: 'appInitialization',
            severity: ErrorSeverity.HIGH
        });
        
        appStateManager.updateApp({ 
            loading: false, 
            error: error.message 
        });
        
        // Still try to end the timer for metrics
        try {
            performanceProfiler.endTimer(appInitTimer);
        } catch (timerError) {
            console.warn('[Main] Failed to end initialization timer:', timerError);
        }
    }
});
