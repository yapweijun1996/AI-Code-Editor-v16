import { DbManager } from './db.js';
import { ApiKeyManager } from './api_manager.js';
import { ChatService } from './chat_service.js';
import * as Editor from './editor.js';
import * as UI from './ui.js';
import * as FileSystem from './file_system.js';
import TaskRunner from './task_runner.js';
import { toolLogger } from './tool_logger.js';
import { todoListUI } from './todo_list_ui.js';
import { taskManager } from './task_manager.js';

export function initializeEventListeners(appState) {
    const {
        rootDirectoryHandle,
        uploadedImage,
        isFileTreeCollapsed,
        editor,
        onFileSelect,
        saveCurrentSession,
        clearImagePreview,
        handleFixErrors,
        handleImageUpload,
    } = appState;

    const fileTreeContainer = document.getElementById('file-tree');
    const editorContainer = document.getElementById('editor');
    const tabBarContainer = document.getElementById('tab-bar');
    const openDirectoryButton = document.getElementById('open-directory-button');
    const forgetFolderButton = document.getElementById('forget-folder-button');
    const reconnectButton = document.getElementById('reconnect-button');
    const refreshFolderButton = document.getElementById('refresh-folder-button');
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const chatSendButton = document.getElementById('chat-send-button');
    const chatCancelButton = document.getElementById('chat-cancel-button');
    const toggleFilesButton = document.getElementById('toggle-files-button');
    const imageUploadButton = document.getElementById('image-upload-button');
    const imageInput = document.getElementById('image-input');
    const imagePreviewContainer = document.getElementById('image-preview-container');
    const viewContextButton = document.getElementById('view-context-button');
    const condenseContextButton = document.getElementById('condense-context-button');
    const clearContextButton = document.getElementById('clear-context-button');
    const contextModal = document.getElementById('context-modal');
    const contextDisplay = document.getElementById('context-display');
    const closeModalButton = contextModal.querySelector('.close-button');
    const formatButton = document.getElementById('format-button');
    const themeToggleButton = document.getElementById('theme-toggle-button');
    const viewCheckpointsButton = document.getElementById('view-checkpoints-button');
    const checkpointsModal = document.getElementById('checkpoints-modal');
    const checkpointsList = document.getElementById('checkpoints-list'); // This is now the tbody
    const closeCheckpointsModalButton = checkpointsModal.querySelector('.close-button');
    const createCheckpointButton = document.getElementById('create-checkpoint-button');
    const deleteSelectedCheckpointsButton = document.getElementById('delete-selected-checkpoints-button');
    const selectAllCheckpointsCheckbox = document.getElementById('select-all-checkpoints-checkbox'); // In the controls div
    const selectAllCheckpointsCheckboxHeader = document.getElementById('select-all-checkpoints-checkbox-header'); // In the table header
    const customRulesButton = document.getElementById('custom-rules-button');
    const customRulesModal = document.getElementById('custom-rules-modal');
    const closeCustomRulesModalButton = customRulesModal.querySelector('.close-button');
    const customRulesTextarea = document.getElementById('custom-rules-textarea');
    const saveCustomRulesButton = document.getElementById('save-custom-rules-button');
    const customRulesModeName = document.getElementById('custom-rules-mode-name');
    const fixErrorsButton = document.getElementById('fix-errors-button');
    const viewToolLogsButton = document.getElementById('view-tool-logs-button');
    const toolLogsModal = document.getElementById('tool-logs-modal');
    const toolLogsList = document.getElementById('tool-logs-list');
    const toolLogsFilter = document.getElementById('tool-logs-filter');
    const closeToolLogsModalButton = toolLogsModal.querySelector('.close-button');
    const undoButton = document.getElementById('undo-last-change-button');
    const filesTab = document.getElementById('files-tab');
    const searchTab = document.getElementById('search-tab');
    const filesContent = document.getElementById('files-content');
    const searchContent = document.getElementById('search-content');
    const tasksTab = document.getElementById('tasks-tab');
    const tasksContent = document.getElementById('tasks-content');
    const searchInput = document.getElementById('search-input');
    const tasksContainer = document.getElementById('tasks-container');
    const taskOutput = document.getElementById('task-output');
    const searchRegex = document.getElementById('search-regex');
    const searchCaseSensitive = document.getElementById('search-case-sensitive');
    const searchButton = document.getElementById('search-button');
    const searchResultsContainer = document.getElementById('search-results-container');


    window.addEventListener('beforeunload', saveCurrentSession);

    fileTreeContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    let saveTimeout;
    editorContainer.addEventListener('keyup', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveCurrentSession, 2000);
    });

    tabBarContainer.addEventListener('click', () => {
        setTimeout(saveCurrentSession, 100);
    });

    openDirectoryButton.addEventListener('click', async () => {
        try {
            appState.rootDirectoryHandle = await window.showDirectoryPicker();
            await DbManager.saveDirectoryHandle(appState.rootDirectoryHandle);
            await UI.refreshFileTree(appState.rootDirectoryHandle, onFileSelect, appState);
            ChatService.rootDirectoryHandle = appState.rootDirectoryHandle; // Update the handle
        } catch (error) {
            console.error('Error opening directory:', error);
        }
    });

    forgetFolderButton.addEventListener('click', async () => {
        await DbManager.clearDirectoryHandle();
        appState.rootDirectoryHandle = null;
        const treeInstance = $('#file-tree').jstree(true);
        if (treeInstance) treeInstance.destroy();
        fileTreeContainer.innerHTML = '';
        UI.updateDirectoryButtons(false);
        Editor.clearEditor();
    });

    reconnectButton.addEventListener('click', async () => {
        let savedHandle = await DbManager.getDirectoryHandle();
        if (savedHandle) {
            try {
                if ((await savedHandle.requestPermission({ mode: 'readwrite' })) === 'granted') {
                    appState.rootDirectoryHandle = savedHandle;
                    await UI.refreshFileTree(appState.rootDirectoryHandle, onFileSelect, appState);
                    ChatService.rootDirectoryHandle = appState.rootDirectoryHandle; // Update the handle
                } else {
                    alert('Permission to access the folder was denied.');
                }
            } catch (error) {
                console.error('Error requesting permission:', error);
                alert('There was an error reconnecting to the project folder.');
            }
        }
    });
    
    refreshFolderButton.addEventListener('click', async () => {
        if (appState.rootDirectoryHandle) {
            await UI.refreshFileTree(appState.rootDirectoryHandle, onFileSelect, appState);
        }
    });
 
     chatSendButton.addEventListener('click', () => ChatService.sendMessage(chatInput, chatMessages, chatSendButton, chatCancelButton, appState.uploadedImage, clearImagePreview));
    chatCancelButton.addEventListener('click', () => ChatService.cancelMessage());

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            ChatService.sendMessage(chatInput, chatMessages, chatSendButton, chatCancelButton, appState.uploadedImage, clearImagePreview);
        }
    });

    editorContainer.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            Editor.saveActiveFile();
        }
    });


    viewContextButton.addEventListener('click', async () => {
        contextDisplay.textContent = await ChatService.viewHistory();
        contextModal.style.display = 'block';
    });

    condenseContextButton.addEventListener('click', () => ChatService.condenseHistory(chatMessages));
    clearContextButton.addEventListener('click', () => ChatService.clearHistory(chatMessages));

    closeModalButton.addEventListener('click', () => {
        contextModal.style.display = 'none';
    });

    window.addEventListener('click', (event) => {
        if (event.target == contextModal) {
            contextModal.style.display = 'none';
        }
        if (event.target == checkpointsModal) {
            checkpointsModal.style.display = 'none';
        }
        if (event.target == customRulesModal) {
            customRulesModal.style.display = 'none';
        }
        if (event.target == toolLogsModal) {
            toolLogsModal.style.display = 'none';
        }
    });

    viewCheckpointsButton.addEventListener('click', async () => {
        const checkpoints = await DbManager.getCheckpoints();
        UI.renderCheckpoints(checkpointsModal, checkpoints);
        checkpointsModal.style.display = 'block';
        UI.updateIndexedDBUsage();
    });

    closeCheckpointsModalButton.addEventListener('click', () => {
        checkpointsModal.style.display = 'none';
    });

    createCheckpointButton.addEventListener('click', async () => {
        const editorState = Editor.getEditorState();
        if (editorState.openFiles.length === 0) {
            alert('Cannot create a checkpoint with no open files.');
            return;
        }

        const checkpointName = prompt('Enter a name for this checkpoint:', `Checkpoint ${new Date().toLocaleString()}`);
        if (!checkpointName) return; // User cancelled

        const checkpointData = {
            name: checkpointName,
            editorState: editorState,
            timestamp: Date.now(),
        };

        try {
            await DbManager.saveCheckpoint(checkpointData);
            alert(`Checkpoint "${checkpointName}" created successfully.`);
            // Refresh the list
            const checkpoints = await DbManager.getCheckpoints();
            UI.renderCheckpoints(checkpointsModal, checkpoints);
        } catch (error) {
            console.error('Failed to create checkpoint:', error);
            alert('Error creating checkpoint. See console for details.');
        }
    });

    checkpointsList.addEventListener('click', async (event) => {
        const target = event.target;

        if (target.classList.contains('checkpoint-checkbox')) {
            updateDeleteSelectedButtonState();
            updateSelectAllHeaderCheckboxState();
        } else if (target.classList.contains('restore-checkpoint-button')) {
            const checkpointId = parseInt(target.dataset.id, 10);
            const checkpoint = await DbManager.getCheckpointById(checkpointId);
            if (checkpoint && checkpoint.editorState) {
                await Editor.restoreCheckpointState(checkpoint.editorState, appState.rootDirectoryHandle, tabBarContainer);
                await Editor.saveAllOpenFiles(); // Save all restored files to disk
                await UI.refreshFileTree(appState.rootDirectoryHandle, onFileSelect, appState);
                checkpointsModal.style.display = 'none';
                alert(`Project state restored to checkpoint '${checkpoint.name}'.`);
            }
        } else if (target.classList.contains('delete-checkpoint-button')) {
            const checkpointId = parseInt(target.dataset.id, 10);
            if (confirm('Are you sure you want to delete this checkpoint?')) {
                await DbManager.deleteCheckpoint(checkpointId);
                await refreshCheckpointsList();
            }
        }
    });

    const syncCheckboxes = (source, isHeader) => {
        const checkboxes = checkpointsList.querySelectorAll('.checkpoint-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = source.checked;
        });
        if (isHeader) {
            selectAllCheckpointsCheckbox.checked = source.checked;
        } else {
            selectAllCheckpointsCheckboxHeader.checked = source.checked;
        }
        updateDeleteSelectedButtonState();
    };

    selectAllCheckpointsCheckbox.addEventListener('change', () => syncCheckboxes(selectAllCheckpointsCheckbox, false));
    selectAllCheckpointsCheckboxHeader.addEventListener('change', () => syncCheckboxes(selectAllCheckpointsCheckboxHeader, true));

    deleteSelectedCheckpointsButton.addEventListener('click', async () => {
        const selectedCheckboxes = checkpointsList.querySelectorAll('.checkpoint-checkbox:checked');
        if (selectedCheckboxes.length === 0) {
            alert('Please select at least one checkpoint to delete.');
            return;
        }

        if (confirm(`Are you sure you want to delete ${selectedCheckboxes.length} selected checkpoint(s)?`)) {
            for (const checkbox of selectedCheckboxes) {
                const checkpointId = parseInt(checkbox.dataset.id, 10);
                await DbManager.deleteCheckpoint(checkpointId);
            }
            await refreshCheckpointsList();
        }
    });

    function updateDeleteSelectedButtonState() {
        const selectedCheckboxes = checkpointsList.querySelectorAll('.checkpoint-checkbox:checked');
        deleteSelectedCheckpointsButton.disabled = selectedCheckboxes.length === 0;
    }

    function updateSelectAllHeaderCheckboxState() {
        const checkboxes = checkpointsList.querySelectorAll('.checkpoint-checkbox');
        const checkedCount = checkpointsList.querySelectorAll('.checkpoint-checkbox:checked').length;
        selectAllCheckpointsCheckboxHeader.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
        selectAllCheckpointsCheckbox.checked = selectAllCheckpointsCheckboxHeader.checked;
    }

    async function refreshCheckpointsList() {
        const checkpoints = await DbManager.getCheckpoints();
        UI.renderCheckpoints(checkpointsModal, checkpoints);
        updateDeleteSelectedButtonState();
        updateSelectAllHeaderCheckboxState();
    }

    customRulesButton.addEventListener('click', async () => {
        const agentModeSelector = document.getElementById('agent-mode-selector');
        const selectedOption = agentModeSelector.options[agentModeSelector.selectedIndex];
        const mode = selectedOption.value;
        const modeName = selectedOption.text;

        const defaultRules = {
            code: `
- Always write clean, modular, and well-documented code.
- Follow the existing coding style and conventions of the project.
- When modifying a file, first read it carefully to understand the context.
- Provide clear explanations for any code changes you make.
- When you create a file, make sure it is placed in the correct directory.
            `.trim(),
            plan: `
- Always start by creating a clear, step-by-step research plan.
- Cite all sources and provide links in a 'References' section.
- Synthesize information from multiple sources to provide a comprehensive answer.
- Present findings in a structured format, using headings, lists, and Mermaid diagrams where appropriate.
- Distinguish between facts from sources and your own analysis.
            `.trim(),
        };

        customRulesModeName.textContent = modeName;
        let rules = await DbManager.getCustomRule(mode);
        if (rules === null) {
            rules = defaultRules[mode] || '';
        }
        customRulesTextarea.value = rules;
        customRulesModal.style.display = 'block';
    });

    closeCustomRulesModalButton.addEventListener('click', () => {
        customRulesModal.style.display = 'none';
    });

    saveCustomRulesButton.addEventListener('click', async () => {
        const agentModeSelector = document.getElementById('agent-mode-selector');
        const mode = agentModeSelector.value;
        await DbManager.saveCustomRule(mode, customRulesTextarea.value);
        alert('Custom rules saved successfully.');
        customRulesModal.style.display = 'none';
    });

    imageUploadButton.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', (e) => handleImageUpload(e, appState));

    toggleFilesButton.addEventListener('click', () => {
        const fileTreePanel = document.getElementById('file-tree-container');
        if (!window.splitInstance || !fileTreePanel) return;

        appState.isFileTreeCollapsed = !appState.isFileTreeCollapsed;

        if (appState.isFileTreeCollapsed) {
            fileTreePanel.classList.add('hidden');
            window.splitInstance.setSizes([0, 70, 30]);
        } else {
            fileTreePanel.classList.remove('hidden');
            window.splitInstance.setSizes([15, 55, 30]);
        }
        setTimeout(() => editor.layout(), 50);
    });

    if (formatButton) {
        formatButton.addEventListener('click', () => {
            const activeFile = Editor.getActiveFile();
            if (!activeFile) {
                alert('Please open a file to format.');
                return;
            }
            const originalContent = activeFile.model.getValue();
            const parser = Editor.getPrettierParser(activeFile.name);
            const prettierWorker = new Worker('prettier.worker.js');

            prettierWorker.onmessage = (event) => {
                if (event.data.success) {
                    activeFile.model.setValue(event.data.formattedCode);
                    console.log(`File '${activeFile.name}' formatted successfully.`);
                } else {
                    console.error('Error formatting file:', event.data.error);
                    alert('An error occurred while formatting the file.');
                }
            };
            prettierWorker.postMessage({ code: originalContent, parser });
        });
    }

    // --- Tab Bar Mouse Wheel Scrolling ---
    tabBarContainer.addEventListener('wheel', (event) => {
        if (event.deltaY !== 0) {
            event.preventDefault();
            tabBarContainer.scrollLeft += event.deltaY;
        }
    });

    // --- Theme Toggling ---
    const applyTheme = (theme) => {
        document.body.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    };

    themeToggleButton.addEventListener('click', () => {
        const currentTheme = localStorage.getItem('theme') || 'dark';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        applyTheme(newTheme);
    });

    fixErrorsButton.addEventListener('click', () => handleFixErrors(appState));

    // --- Dropdown Logic ---
    const dropdownButton = document.querySelector('.dropdown-button');
    const dropdown = document.querySelector('.dropdown');

    dropdownButton.addEventListener('click', (event) => {
        event.stopPropagation();
        dropdown.classList.toggle('active');
    });

    window.addEventListener('click', (event) => {
        if (!dropdown.contains(event.target)) {
            dropdown.classList.remove('active');
        }
    });

    viewToolLogsButton.addEventListener('click', async () => {
        const logs = await toolLogger.getLogs();
        UI.renderToolLogs(toolLogsList, logs);
        toolLogsModal.style.display = 'block';

        toolLogsFilter.addEventListener('input', () => {
            UI.renderToolLogs(toolLogsList, logs, toolLogsFilter.value);
        });
    });

    closeToolLogsModalButton.addEventListener('click', () => {
        toolLogsModal.style.display = 'none';
    });

    undoButton.addEventListener('click', () => {
        ChatService.runToolDirectly('undo_last_change', {});
    });

    if (filesTab && searchTab && tasksTab && filesContent && searchContent && tasksContent) {
        filesTab.addEventListener('click', () => {
            filesTab.classList.add('active');
            searchTab.classList.remove('active');
            tasksTab.classList.remove('active');
            filesContent.style.display = 'block';
            searchContent.style.display = 'none';
            tasksContent.style.display = 'none';
        });
    }


    if (searchTab && filesTab && tasksTab && searchContent && filesContent && tasksContent) {
        searchTab.addEventListener('click', () => {
            searchTab.classList.add('active');
            filesTab.classList.remove('active');
            tasksTab.classList.remove('active');
            searchContent.style.display = 'block';
            filesContent.style.display = 'none';
            tasksContent.style.display = 'none';
        });
    }

    searchButton.addEventListener('click', () => handleSearch(appState));
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handleSearch(appState);
        }
    });

    async function handleSearch(appState) {
        const searchTerm = searchInput.value;
        if (!searchTerm) {
            return;
        }

        const useRegex = searchRegex.checked;
        const caseSensitive = searchCaseSensitive.checked;

        searchResultsContainer.innerHTML = 'Searching...';

        const results = [];
        const ignorePatterns = await FileSystem.getIgnorePatterns(appState.rootDirectoryHandle);
        await FileSystem.searchInDirectory(
            appState.rootDirectoryHandle,
            searchTerm,
            '',
            results,
            ignorePatterns,
            useRegex,
            caseSensitive
        );

        displaySearchResults(results);
    }

    function displaySearchResults(results) {
        if (results.length === 0) {
            searchResultsContainer.innerHTML = 'No results found.';
            return;
        }

        let html = '';
        for (const result of results) {
            html += `<div class="search-result-file">${result.file}</div>`;
            html += '<ul>';
            for (const match of result.matches) {
                html += `<li data-path="${result.file}" data-line="${match.line_number}">${match.line_number}: ${match.line_content}</li>`;
            }
            html += '</ul>';
        }
        searchResultsContainer.innerHTML = html;

        searchResultsContainer.querySelectorAll('li').forEach(li => {
            li.addEventListener('click', () => {
                const path = li.dataset.path;
                const line = parseInt(li.dataset.line, 10);
                onFileSelect(path);
                // TODO: Go to line
            });
        });
    }
    if (tasksTab && filesTab && searchTab && tasksContent && filesContent && searchContent) {
        tasksTab.addEventListener('click', async () => {
            tasksTab.classList.add('active');
            filesTab.classList.remove('active');
            searchTab.classList.remove('active');
            tasksContent.style.display = 'block';
            filesContent.style.display = 'none';
            searchContent.style.display = 'none';
            await displayTasks(appState);
        });
    }

    async function displayTasks(appState) {
        // Show TodoListUI embedded in the tasks tab
        tasksContainer.innerHTML = `
            <div class="tasks-header">
                <h3>Task Management</h3>
                <div class="tasks-actions">
                    <button id="open-todo-overlay" class="btn-primary">
                        <i class="fas fa-tasks" style="
    font-size: 12px;
"></i> Open Todo List (Ctrl+T)
                    </button>
                    <button id="add-quick-task" class="btn-secondary">
                        <i class="fas fa-plus"></i> Quick Add
                    </button>
                </div>
            </div>
            <div class="tasks-summary" id="tasks-summary">
                <div class="summary-stats" id="summary-stats">
                    Loading tasks...
                </div>
            </div>
            <div class="recent-tasks" id="recent-tasks">
                <h4>Recent Tasks</h4>
                <div id="recent-tasks-list"></div>
            </div>
        `;

        // Add event listeners
        document.getElementById('open-todo-overlay').addEventListener('click', () => {
            todoListUI.show();
        });

        document.getElementById('add-quick-task').addEventListener('click', () => {
            const title = prompt('Enter task title:');
            if (title && title.trim()) {
                // Use the imported taskManager
                taskManager.createTask({ 
                    title: title.trim(),
                    priority: 'medium'
                }).then(() => {
                    refreshTasksSummary();
                });
            }
        });

        // Initial load
        refreshTasksSummary();

        // Listen for task manager events to refresh the summary
        taskManager.addEventListener((event, data) => {
            if (['task_created', 'task_updated', 'task_deleted'].includes(event)) {
                refreshTasksSummary();
            }
        });
    }

    function refreshTasksSummary() {
        if (!taskManager) return;

        const stats = taskManager.getStats();
        const recentTasks = taskManager.getAllTasks()
            .sort((a, b) => (b.updatedTime || b.createdTime) - (a.updatedTime || a.createdTime))
            .slice(0, 5);

        // Update stats
        const summaryStats = document.getElementById('summary-stats');
        if (summaryStats) {
            summaryStats.innerHTML = `
                <div class="stat-item">
                    <span class="stat-number">${stats.total}</span>
                    <span class="stat-label">Total</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${stats.pending}</span>
                    <span class="stat-label">Pending</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${stats.in_progress}</span>
                    <span class="stat-label">In Progress</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${stats.completed}</span>
                    <span class="stat-label">Completed</span>
                </div>
            `;
        }

        // Update recent tasks
        const recentTasksList = document.getElementById('recent-tasks-list');
        if (recentTasksList) {
            if (recentTasks.length === 0) {
                recentTasksList.innerHTML = '<p class="no-tasks">No tasks yet. Create your first task!</p>';
            } else {
                recentTasksList.innerHTML = recentTasks.map(task => `
                    <div class="task-item status-${task.status}" data-task-id="${task.id}">
                        <div class="task-title">${task.title}</div>
                        <div class="task-meta">
                            <span class="task-status status-${task.status}">${task.status.replace('_', ' ')}</span>
                            <span class="task-priority priority-${task.priority}">${task.priority}</span>
                        </div>
                    </div>
                `).join('');

                // Add click handlers for task items
                recentTasksList.querySelectorAll('.task-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const taskId = item.dataset.taskId;
                        todoListUI.show();
                        setTimeout(() => {
                            todoListUI.showDetailView(taskId);
                        }, 100);
                    });
                });
            }
        }
    }

    const btnCollapse = document.getElementById('toggle-files-button');
    const sidebar = document.getElementById('file-tree-container');
    const overlay = document.querySelector('.overlay');

    // Sidebar collapse toggle for better UI UX
    btnCollapse.addEventListener('click', () => {
        if (sidebar.classList.contains('collapsed')) {
            sidebar.classList.remove('collapsed');
            overlay.classList.remove('active');
            btnCollapse.setAttribute('aria-expanded', 'true');
        } else {
            sidebar.classList.add('collapsed');
            overlay.classList.add('active');
            btnCollapse.setAttribute('aria-expanded', 'false');
        }
    });

    overlay.addEventListener('click', () => {
        sidebar.classList.remove('collapsed');
        overlay.classList.remove('active');
        btnCollapse.setAttribute('aria-expanded', 'true');
    });

    // Enhanced search: highlight matched text in suggestions
    function highlightMatch(text, query) {
        const regex = new RegExp(`(${query})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }

    // This assumes debouncedSearchInputHandler is defined elsewhere and accessible
    // If not, you may need to define or import it.
    // For now, we proceed assuming it's available in the scope.
    if (typeof debouncedSearchInputHandler !== 'undefined') {
        const originalHandler = debouncedSearchInputHandler;
        searchInput.removeEventListener('input', originalHandler);
        searchInput.addEventListener('input', debounce(() => {
            const val = searchInput.value.toLowerCase();
            searchSuggestions.innerHTML = '';
            toggleClearButton();
            if (!val) {
                hideSuggestions();
                return;
            }
            const filtered = navItems.filter(item => item.toLowerCase().includes(val));
            if (!filtered.length) {
                const li = document.createElement('li');
                li.textContent = 'No results found';
                li.setAttribute('role', 'option');
                li.classList.add('text-gray-500', 'px-2', 'py-1');
                searchSuggestions.appendChild(li);
                searchSuggestions.classList.remove('hidden');
                searchInput.setAttribute('aria-expanded', 'true');
                currentFocus = -1;
                return;
            }
            filtered.forEach((item, index) => {
                const li = document.createElement('li');
                li.innerHTML = highlightMatch(item, val);
                li.setAttribute('role', 'option');
                li.setAttribute('id', `suggestion-${index}`);
                li.addEventListener('click', () => selectSuggestion(item));
                li.tabIndex = 0;
                searchSuggestions.appendChild(li);
            });
            searchSuggestions.classList.remove('hidden');
            searchInput.setAttribute('aria-expanded', 'true');
            currentFocus = -1;
        }, 250));
    }


    // Lazy load charts only when sections are activated
    const chartSections = ['sales', 'inventory', 'purchasing'];
    const loadedCharts = new Set();

    function selectSuggestion(value) {
        searchInput.value = value;
        hideSuggestions();
        document.getElementById('pageTitle').textContent = value;
        document.querySelectorAll('main section').forEach(section => {
            if (section.id === value.toLowerCase()) {
                section.classList.remove('hidden');
            } else {
                section.classList.add('hidden');
            }
        });
        document.querySelectorAll('.sidebar-link').forEach(link => {
            if (link.textContent.trim() === value) {
                link.classList.add('active');
                link.setAttribute('aria-current', 'page');
                const target = document.getElementById(value.toLowerCase());
                if(target) target.scrollIntoView({behavior: 'smooth'});
            } else {
                link.classList.remove('active');
                link.removeAttribute('aria-current');
            }
        });
        // Lazy load chart
        const sectionId = value.toLowerCase();
        if(chartSections.includes(sectionId) && !loadedCharts.has(sectionId)) {
            createCharts(initialTheme);
            loadedCharts.add(sectionId);
        }
    }
    
    // Update createCharts to set loadedCharts for lazy load tracking
    function createCharts(theme) {
        if(chartsInitialized) {
            salesChart.destroy();
            inventoryChart.destroy();
            purchasingChart.destroy();
        }
        const colors = getChartColors(theme);
        const commonOptions = {
            responsive: true,
            plugins: { legend: { display: false }, tooltip: { enabled: true, backgroundColor: colors.tooltipBg, borderColor: colors.tooltipBorder, borderWidth: 1, titleColor: colors.textColor, bodyColor: colors.textColor } },
            scales: { y: { beginAtZero: true, grid: { color: colors.gridColor }, ticks: { color: colors.textColor } }, x: { grid: { color: colors.gridColor }, ticks: { color: colors.textColor } } }
        };
        salesChart = new Chart(document.getElementById('salesChart').getContext('2d'), { type: 'bar', data: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], datasets: [{ label: 'Sales', data: [12000, 19000, 15000, 22000, 28000, 25000], backgroundColor: colors.salesBg, borderColor: colors.salesBorder, borderWidth: 1 }] }, options: commonOptions });
        inventoryChart = new Chart(document.getElementById('inventoryChart').getContext('2d'), { type: 'line', data: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], datasets: [{ label: 'Inventory', data: [1200, 1400, 1300, 1600, 1700, 1500], backgroundColor: colors.inventoryBg, borderColor: colors.inventoryBorder, borderWidth: 2, fill: true }] }, options: commonOptions });
        purchasingChart = new Chart(document.getElementById('purchasingChart').getContext('2d'), { type: 'bar', data: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], datasets: [{ label: 'Purchasing', data: [8000, 9000, 8500, 9500, 10500, 10000], backgroundColor: colors.purchasingBg, borderColor: colors.purchasingBorder, borderWidth: 1 }] }, options: commonOptions });
        chartsInitialized = true;
    }
    
    // Keyboard shortcut to toggle sidebar (Ctrl+B, like VS Code)
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            btnCollapse.click();
        }
    });
}
