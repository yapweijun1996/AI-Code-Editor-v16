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

    // LLM Debug panel bindings and health polling
    function setupLLMDebugPanel() {
        const debugToggle = document.getElementById('debug-llm-toggle');
        const healthPanel = document.getElementById('llm-health-panel');
        const healthPre = document.getElementById('llm-health-json');
        if (!debugToggle || !healthPanel || !healthPre) {
            return;
        }
// LLM Debug UI (modal + button) to visualize provider health and circuit-breaker status
    function initLLMDebugUI() {
        try {
            const headerToolbar = document.querySelector('.header-toolbar');
            if (!headerToolbar) return;

            // Create Debug button if not present
            let btn = document.getElementById('llm-debug-button');
            if (!btn) {
                btn = document.createElement('button');
                btn.id = 'llm-debug-button';
                btn.title = 'Show LLM debug status';
                btn.textContent = 'LLM Debug';
                headerToolbar.appendChild(btn);
            }

            // Create modal if not present
            let modal = document.getElementById('llm-debug-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'llm-debug-modal';
                modal.className = 'modal';
                modal.style.display = 'none';
                modal.innerHTML = `
                  <div class="modal-content">
                    <span class="close-button">&times;</span>
                    <h2>LLM Debug Status</h2>
                    <div class="llm-debug-controls" style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
                      <button id="llm-debug-trip" title="Force breaker OPEN">Trip OPEN</button>
                      <button id="llm-debug-reset" title="Reset breaker to CLOSED">Reset</button>
                      <button id="llm-debug-fail" title="Inject a failure event">Fail Once</button>
                      <button id="llm-debug-success" title="Inject a success event">Mark Success</button>
                    </div>
                    <pre id="llm-debug-content">{}</pre>
                  </div>
                `;
                document.body.appendChild(modal);
            }

            const closeBtn = modal.querySelector('.close-button');
            const contentEl = modal.querySelector('#llm-debug-content');
            const btnTrip = modal.querySelector('#llm-debug-trip');
            const btnReset = modal.querySelector('#llm-debug-reset');
            const btnFail = modal.querySelector('#llm-debug-fail');
            const btnSuccess = modal.querySelector('#llm-debug-success');

            let timer = null;

            const refresh = async () => {
                try {
                    const status = ChatService.llmService?.getHealthStatus?.() || {};
                    const extra = {
                        providerKey: ChatService.llmService?.getProviderKey?.(),
                        apiKeyIndex: ChatService.llmService?.apiKeyManager?.currentIndex ?? null,
                        now: new Date().toISOString()
                    };
                    contentEl.textContent = JSON.stringify({ ...status, ...extra }, null, 2);
                } catch (e) {
                    contentEl.textContent = `Error fetching status: ${e?.message || e}`;
                }
            };

            // Bind debug control buttons (no-ops if provider doesn't support)
            if (btnTrip) btnTrip.onclick = () => {
                try { ChatService.llmService?.debugTripCircuitBreaker?.(); refresh(); }
                catch (e) { console.warn('[Main] Debug action (Trip OPEN) failed:', e); }
            };
            if (btnReset) btnReset.onclick = () => {
                try { ChatService.llmService?.debugResetCircuitBreaker?.(); refresh(); }
                catch (e) { console.warn('[Main] Debug action (Reset) failed:', e); }
            };
            if (btnFail) btnFail.onclick = () => {
                try { ChatService.llmService?.debugFailOnce?.('Manual test failure'); refresh(); }
                catch (e) { console.warn('[Main] Debug action (Fail Once) failed:', e); }
            };
            if (btnSuccess) btnSuccess.onclick = () => {
                try { ChatService.llmService?.debugMarkSuccess?.(Math.floor(50 + Math.random() * 200)); refresh(); }
                catch (e) { console.warn('[Main] Debug action (Mark Success) failed:', e); }
            };

            const open = async () => {
                modal.style.display = 'flex';
                await refresh();
                timer = setInterval(refresh, 3000); // auto-refresh every 3s
            };

            const close = () => {
                modal.style.display = 'none';
                if (timer) {
                    clearInterval(timer);
                    timer = null;
                }
            };

            btn.onclick = open;
            closeBtn.onclick = close;
            modal.addEventListener('click', (e) => {
                if (e.target === modal) close();
            });

            // When settings change, refresh if open
            document.addEventListener('llm-settings-updated', () => {
                if (modal.style.display !== 'none') {
                    setTimeout(() => refresh(), 200);
                }
            });
        } catch (e) {
            console.warn('[Main] Failed to initialize LLM Debug UI:', e);
        }
    }

    // Initialize LLM Debug UI once chat service is (re)initialized
    initLLMDebugUI();
// Global LLM smoke runner (console-friendly, single entry point)
(function registerLLMConsoleRunner(){
    try {
        if (window.LLMTest) return;
        window.LLMTest = {
            async runSmokeSuite() {
                const m = await import('./llm/debug_harness.js');
                const res = await m.runSmokeSuite();
                try { console.log('[LLMTest] Smoke suite result:', res); } catch(_) {}
                return res;
            },
            async runBreakerTest() {
                const m = await import('./llm/debug_harness.js');
                return m.runBreakerTest();
            },
            async runHealthSmokeTest() {
                const m = await import('./llm/debug_harness.js');
                return m.runHealthSmokeTest();
            },
            async runPromptSmokeTest() {
                const m = await import('./llm/debug_harness.js');
                return m.runPromptSmokeTest();
            }
        };
        // One-liner alias
        window.runLLMSmoke = () => window.LLMTest.runSmokeSuite();
        console.info('[LLMTest] Console runner ready. Use window.runLLMSmoke() or window.LLMTest.*');
    } catch (e) {
        console.warn('[LLMTest] Failed to register console runner:', e);
    }
})();

        const applyState = (enabled) => {
            if (enabled) {
                healthPanel.style.display = 'block';
                if (window.__llmHealthTimer) {
                    clearInterval(window.__llmHealthTimer);
                }
                const render = () => {
                    try {
                        const service = ChatService.llmService;
                        const status = service && service.getHealthStatus ? service.getHealthStatus() : { error: 'service unavailable' };
                        const keyIndex = service && service.apiKeyManager ? (service.apiKeyManager.currentIndex ?? null) : null;
                        const composite = { ...status, keyIndex };
                        healthPre.textContent = JSON.stringify(composite, null, 2);
                    } catch (e) {
                        healthPre.textContent = `Health probe error: ${e?.message || e}`;
                    }
                };
                render();
                window.__llmHealthTimer = setInterval(render, 2000);
            } else {
                if (window.__llmHealthTimer) {
                    clearInterval(window.__llmHealthTimer);
                    window.__llmHealthTimer = null;
                }
                healthPanel.style.display = 'none';
            }
        };

        // Initialize from Settings
        const enabled = !!Settings.get('llm.common.debugLLM');
        debugToggle.checked = enabled;
        applyState(enabled);

        // Bind change handler (idempotent)
        debugToggle.onchange = async () => {
            const value = !!debugToggle.checked;
            try {
                await Settings.set('llm.common.debugLLM', value);
            } catch (_) {}
            applyState(value);
        };
    }
    
    // Clear the chat input on startup to prevent submission on reload
    chatInput.value = '';

    if (appState.rootDirectoryHandle) {
        await ChatService.initialize(appState.rootDirectoryHandle);
    }
    // Initialize debug panel after service comes up
    try {
        setupLLMDebugPanel();
    } catch (e) {
        console.warn('[Main] Failed to setup LLM debug panel:', e);
    }
    
    // Listen for settings changes to re-initialize the chat service
    document.addEventListener('llm-settings-updated', async () => {
        console.log('LLM settings updated, re-initializing chat service...');
        UI.updateLLMProviderStatus();
        if (appState.rootDirectoryHandle) {
            await ChatService.initialize(appState.rootDirectoryHandle);
        }
        // Re-sync debug UI with latest settings and service instance
        try {
            setupLLMDebugPanel();
        } catch (e) {
            console.warn('[Main] Failed to re-bind LLM debug panel:', e);
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

            // Close any open editor tab and dispose model immediately
            try {
                if (Editor.getOpenFiles().has(path)) {
                    Editor.closeTab(path, tabBarContainer);
                }
            } catch (e) {
                console.warn('[Main] Failed to close tab for deleted file:', path, e);
            }

            await UI.refreshFileTree(appState.rootDirectoryHandle, appState.onFileSelect, appState);

            // Notify the user
            try {
                UI.showToast(`File deleted: ${path}`, 'info', 3000);
            } catch (_) {}
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

// Extend global LLM console runner with parity + chaos suites
(function extendLLMConsoleRunner(){
    try {
        if (!window.LLMTest) window.LLMTest = {};
        const ensure = async () => await import('./llm/debug_harness.js');

        // Tool-calling parity
        if (!window.LLMTest.runToolParitySuite) {
            window.LLMTest.runToolParitySuite = async () => {
                const m = await ensure();
                const res = await m.runToolParitySuite();
                try { console.log('[LLMTest] Tool parity suite:', res); } catch(_) {}
                return res;
            };
        }
        if (!window.LLMTest.runToolCallReadFileTest) {
            window.LLMTest.runToolCallReadFileTest = async (filename = 'README.md') => {
                const m = await ensure();
                const res = await m.runToolCallReadFileTest(filename);
                try { console.log('[LLMTest] Tool call read_file test:', res); } catch(_) {}
                return res;
            };
        }

        // Chaos suite (retries + rotation)
        if (!window.LLMTest.runChaosSuite) {
            window.LLMTest.runChaosSuite = async () => {
                const m = await ensure();
                const res = await m.runChaosSuite();
                try { console.log('[LLMTest] Chaos suite:', res); } catch(_) {}
                return res;
            };
        }
        if (!window.LLMTest.runRetryChaosTest) {
            window.LLMTest.runRetryChaosTest = async (opts = { failures: 2, type: 'rate_limit' }) => {
                const m = await ensure();
                const res = await m.runRetryChaosTest(opts);
                try { console.log('[LLMTest] Retry chaos test:', res); } catch(_) {}
                return res;
            };
        }

        // Aliases
        if (!window.runLLMToolParity) window.runLLMToolParity = () => window.LLMTest.runToolParitySuite();
        if (!window.runLLMChaos) window.runLLMChaos = () => window.LLMTest.runChaosSuite();

        console.info('[LLMTest] Extended console runner ready. Parity: runLLMToolParity(); Chaos: runLLMChaos()');
    } catch (e) {
        console.warn('[LLMTest] Failed to extend console runner:', e);
    }
})();

// Extend global LLM console runner with cancellation suite
(function extendLLMConsoleRunnerCancellation(){
    try {
        if (!window.LLMTest) window.LLMTest = {};
        const ensure = async () => await import('./llm/debug_harness.js');

        if (!window.LLMTest.runCancelSuite) {
            window.LLMTest.runCancelSuite = async () => {
                const m = await ensure();
                const res = await m.runCancelSuite();
                try { console.log('[LLMTest] Cancel suite:', res); } catch(_) {}
                return res;
            };
        }
        if (!window.LLMTest.runCancelSmokeTest) {
            window.LLMTest.runCancelSmokeTest = async () => {
                const m = await ensure();
                const res = await m.runCancelSmokeTest();
                try { console.log('[LLMTest] Cancel smoke test:', res); } catch(_) {}
                return res;
            };
        }

        if (!window.runLLMCancel) window.runLLMCancel = () => window.LLMTest.runCancelSuite();

        console.info('[LLMTest] Cancellation console runner ready. Cancellation: runLLMCancel()');
    } catch (e) {
        console.warn('[LLMTest] Failed to extend cancellation console runner:', e);
    }
})();
