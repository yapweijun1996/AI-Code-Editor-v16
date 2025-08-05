import { LLMServiceFactory } from './llm/service_factory.js';
import { Settings } from './settings.js';
import { DbManager } from './db.js';
import { CodebaseIndexer } from './code_intel.js';
import * as FileSystem from './file_system.js';
import * as ToolExecutor from './tool_executor.js';
import * as Editor from './editor.js';
import * as UI from './ui.js';
import { performanceOptimizer } from './performance_optimizer.js';
import { providerOptimizer } from './provider_optimizer.js';
import { taskManager } from './task_manager.js';
import { contextAnalyzer } from './context_analyzer.js';
import { contextBuilder } from './context_builder.js';

export const ChatService = {
    isSending: false,
    isCancelled: false,
    llmService: null,
    rootDirectoryHandle: null,
    activePlan: null,
    errorTracker: {
        filePath: null,
        errorSignature: null,
        count: 0,
    },
    currentHistory: null,

    async initialize(rootDirectoryHandle) {
        this.rootDirectoryHandle = rootDirectoryHandle;
        await this._initializeLLMService();

        const chatHistory = await DbManager.getChatHistory();
        if (chatHistory.length > 0) {
            console.log(`[Chat History] Found ${chatHistory.length} messages.`);
            const chatMessages = document.getElementById('chat-messages');
            UI.renderChatHistory(chatMessages, chatHistory);
        }
    },

    async _initializeLLMService() {
        const llmSettings = Settings.getLLMSettings();
        this.llmService = LLMServiceFactory.create(llmSettings.provider, llmSettings);
        
        // Initialize provider-specific optimizations
        this.currentProvider = llmSettings.provider;
        console.log(`LLM Service initialized with provider: ${llmSettings.provider}`);
        
        // Set up performance monitoring
        performanceOptimizer.startTimer('llm_initialization');
        performanceOptimizer.endTimer('llm_initialization');
    },

    async _startChat(history = []) {
        // This method will now be simpler. The complex setup (prompts, tools)
        // will be handled by the specific LLMService implementation.
        // For now, we just ensure the service is ready.
        if (!this.llmService || !(await this.llmService.isConfigured())) {
            console.warn("LLM service not configured. Chat will not start. Please configure settings.");
            return;
        }

        try {
            // The actual chat session object might be managed within the LLMService
            // or we can still store it here. For now, we'll assume the service
            // manages its own state and this method just signals readiness.
            const mode = document.getElementById('agent-mode-selector').value;
            await DbManager.saveSetting('selectedMode', mode);
            this.activeMode = mode;
            console.log(`Chat ready to start with provider: ${this.llmService.constructor.name}, mode: ${mode}`);
        } catch (error) {
            console.error('Failed to start chat:', error);
            UI.showError(`Error: Could not start chat. ${error.message}`);
        }
    },



    _updateUiState(isSending) {
        const chatSendButton = document.getElementById('chat-send-button');
        const chatCancelButton = document.getElementById('chat-cancel-button');
        chatSendButton.style.display = isSending ? 'none' : 'inline-block';
        chatCancelButton.style.display = isSending ? 'inline-block' : 'none';
    },


    async _handleRateLimiting(chatMessages) {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        const rateLimitMs = this.rateLimit;

        if (timeSinceLastRequest < rateLimitMs) {
            const delay = rateLimitMs - timeSinceLastRequest;
            UI.appendMessage(chatMessages, `Rate limit active. Waiting for ${Math.ceil(delay / 1000)}s...`, 'ai');
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        this.lastRequestTime = Date.now();
    },

    _prepareAndRenderUserMessage(chatInput, chatMessages, uploadedImage, clearImagePreview) {
        // Handle both DOM elements and string inputs
        let userPrompt;
        if (typeof chatInput === 'string') {
            userPrompt = chatInput.trim();
        } else if (chatInput && chatInput.value) {
            userPrompt = chatInput.value.trim();
        } else {
            userPrompt = '';
        }
        let displayMessage = userPrompt;
        const initialParts = [];

        // Intelligent auto-context injection
        const contextAnalysis = this._analyzeAndInjectContext(userPrompt);
        let enhancedPrompt = userPrompt;
        
        if (contextAnalysis.contextInjected) {
            enhancedPrompt = contextAnalysis.enhancedPrompt;
            displayMessage += `\n🤖 Auto-context: ${contextAnalysis.summary}`;
            console.log(`[Auto-Context] ${contextAnalysis.summary}`);
        }

        if (enhancedPrompt) initialParts.push({ text: enhancedPrompt });

        if (uploadedImage) {
            displayMessage += `\n📷 Attached: ${uploadedImage.name}`;
            initialParts.push({
                inlineData: {
                    mimeType: uploadedImage.type,
                    data: uploadedImage.data,
                },
            });
        }

        // Only update UI if we have DOM elements
        if (chatMessages) {
            UI.appendMessage(chatMessages, displayMessage.trim(), 'user');
        }
        
        // Only clear input if it's a DOM element
        if (chatInput && typeof chatInput !== 'string' && chatInput.value !== undefined) {
            chatInput.value = '';
        }
        
        // Only clear image preview if callback provided
        if (clearImagePreview && typeof clearImagePreview === 'function') {
            clearImagePreview();
        }
        console.log(`[User Query] ${userPrompt}`);

        return initialParts;
    },

    /**
     * Analyze user query and inject context if needed
     */
    async _analyzeAndInjectContext(userPrompt) {
        const result = {
            contextInjected: false,
            enhancedPrompt: userPrompt,
            summary: '',
            analysis: null
        };

        try {
            // This check is now handled by the main intent classifier,
            // so we can simplify this part. The decision to run a task
            // or inject context will be made at a higher level.

            // Get current file info
            const currentFileInfo = this._getCurrentFileInfo();
            if (!currentFileInfo) {
                return result; // No file open, no context to inject
            }

            // Analyze if context should be included
            const analysis = contextAnalyzer.analyzeQuery(userPrompt, currentFileInfo);
            result.analysis = analysis;

            if (!analysis.shouldIncludeContext) {
                console.log(`[Context Analysis] ${analysis.reason}`);
                return result;
            }

            // Build context
            const context = contextBuilder.buildContext(analysis.suggestedContext, currentFileInfo);
            if (!context) {
                return result;
            }

            // Format context for AI
            const contextText = contextBuilder.formatContextForAI(context);
            
            // Enhance the prompt with context
            result.enhancedPrompt = `${contextText}\n\n---\n\n**User Question:** ${userPrompt}`;
            result.contextInjected = true;
            result.summary = `${context.file.name} (${context.content.totalLines} lines, confidence: ${Math.round(analysis.confidence * 100)}%)`;

            console.log(`[Context Injected] ${result.summary} - ${analysis.reason}`);

        } catch (error) {
            console.error('[Context Injection Error]', error);
            // Fail gracefully - return original prompt
        }

        return result;
    },

    // DEPRECATED: This functionality is now consolidated into _classifyMessageIntent
    // to avoid redundant AI calls and logic.

    /**
     * Get current file information for context analysis
     */
    _getCurrentFileInfo() {
        const activeFile = Editor.getActiveFile();
        const activeFilePath = Editor.getActiveFilePath();
        const editorInstance = Editor.getEditorInstance();

        if (!activeFile || !editorInstance) {
            return null;
        }

        const model = activeFile.model;
        const position = editorInstance.getPosition();
        const selection = editorInstance.getSelection();

        return {
            path: activeFilePath,
            name: activeFile.name,
            language: model.getLanguageId(),
            totalLines: model.getLineCount(),
            content: model.getValue(),
            cursor: {
                line: position ? position.lineNumber : 1,
                column: position ? position.column : 1
            },
            selection: selection && !selection.isEmpty() ? {
                startLine: selection.startLineNumber,
                startColumn: selection.startColumn,
                endLine: selection.endLineNumber,
                endColumn: selection.endColumn,
                text: model.getValueInRange(selection)
            } : null
        };
    },

    async _performApiCall(history, chatMessages, singleTurn = false) {
        if (!this.llmService) {
            UI.showError("LLM Service is not initialized. Please check your settings.");
            return;
        }

        let functionCalls;
        let continueLoop = true;
        let totalRequestTokens = 0;
        let totalResponseTokens = 0;

        // Estimate request tokens
        if (typeof GPTTokenizer_cl100k_base !== 'undefined') {
            const { encode } = GPTTokenizer_cl100k_base;
            const historyText = history.map(turn => turn.parts.map(p => p.text || '').join('\n')).join('\n');
            totalRequestTokens = encode(historyText).length;
        }
        
        while (continueLoop && !this.isCancelled) {
            try {
                UI.showThinkingIndicator(chatMessages, 'AI is thinking...');
                const mode = document.getElementById('agent-mode-selector').value;
                const customRules = Settings.get(`custom.${mode}.rules`);
                
                // Enhanced tool definitions with smart recommendations
                let tools = ToolExecutor.getToolDefinitions();
                
                // Optimize tool selection for amend mode
                if (mode === 'amend') {
                    // Prioritize safer tools for amend mode
                    const amendOptimizedTools = tools.functionDeclarations.map(tool => {
                        if (tool.name === 'apply_diff') {
                            return {
                                ...tool,
                                description: `🔧 RECOMMENDED FOR AMEND MODE: ${tool.description}`
                            };
                        }
                        if (tool.name === 'read_file') {
                            return {
                                ...tool,
                                description: `📖 ESSENTIAL FOR AMEND MODE: ${tool.description} Always use with include_line_numbers=true for precise editing.`
                            };
                        }
                        if (tool.name === 'search_in_file') {
                            return {
                                ...tool,
                                description: `🔍 PREFERRED FOR AMEND MODE: ${tool.description}`
                            };
                        }
                        return tool;
                    });
                    tools = { functionDeclarations: amendOptimizedTools };
                }
                
                const stream = this.llmService.sendMessageStream(history, tools, customRules);

                let modelResponseText = '';
                let displayText = '';
                functionCalls = []; // Reset for this iteration

                for await (const chunk of stream) {
                    if (this.isCancelled) return;

                    if (chunk.text) {
                        const text = chunk.text;
                        modelResponseText += text;
                        displayText += text;
                        UI.appendMessage(chatMessages, displayText, 'ai', true);
                    }
                    if (chunk.functionCalls) {
                        functionCalls.push(...chunk.functionCalls);
                    }
                    if (chunk.usageMetadata) {
                        // This is for Gemini, which provides accurate counts
                        totalRequestTokens = chunk.usageMetadata.promptTokenCount || 0;
                        totalResponseTokens += chunk.usageMetadata.candidatesTokenCount || 0;
                    }
                }

                // For OpenAI, estimate response tokens
                if (typeof GPTTokenizer_cl100k_base !== 'undefined' && this.llmService.constructor.name === 'OpenAIService') {
                    const { encode } = GPTTokenizer_cl100k_base;
                    totalResponseTokens = encode(modelResponseText).length;
                }
                
                console.log(`[Token Usage] Final totals - Req: ${totalRequestTokens}, Res: ${totalResponseTokens}`);
                UI.updateTokenDisplay(totalRequestTokens, totalResponseTokens);
                

                const modelResponseParts = [];
                if (modelResponseText) modelResponseParts.push({ text: modelResponseText });
                if (functionCalls.length > 0) {
                    functionCalls.forEach(fc => modelResponseParts.push({ functionCall: fc }));
                }

                if (modelResponseParts.length > 0) {
                    history.push({ role: 'model', parts: modelResponseParts });
                }

                if (functionCalls.length > 0) {
                    // Execute all tools sequentially for all providers
                    const toolResults = [];
                    for (const call of functionCalls) {
                        if (this.isCancelled) return;
                        console.log(`Executing tool: ${call.name} sequentially...`);
                        UI.showThinkingIndicator(chatMessages, `Executing tool: ${call.name}...`);
                        const result = await ToolExecutor.execute(call, this.rootDirectoryHandle);
                        toolResults.push({
                            id: call.id,
                            name: result.toolResponse.name,
                            response: result.toolResponse.response,
                        });
                    }
                    history.push({ role: 'user', parts: toolResults.map(functionResponse => ({ functionResponse })) });
                    
                    if (singleTurn) {
                        continueLoop = false;
                    } else {
                        // For OpenAI: Continue the loop to get AI's next response
                        // For other providers (Gemini, Ollama): Check if AI wants to continue with more tools
                        if (this.llmService.constructor.name === 'OpenAIService') {
                            continueLoop = true; // Always continue for OpenAI to get next response
                        } else {
                            // For Gemini/Ollama: Continue the loop to allow them to make more tool calls if needed
                            continueLoop = true;
                        }
                    }
                } else {
                    // No tools called, conversation is complete
                    continueLoop = false;
                }

            } catch (error) {
                console.error(`Error during API call with ${this.llmService.constructor.name}:`, error);
                console.error(`Error stack:`, error.stack); // Log the stack trace
                UI.showError(`An error occurred during AI communication: ${error.message}. Please check your API key and network connection.`);
                continueLoop = false;
            }
        }

        // Only save to DB if it's not part of an autonomous plan
        if (!this.activePlan) {
            await DbManager.saveChatHistory(history);
        }
    },

    /**
     * Simplified method for programmatic API calls (used by TaskManager, etc.)
     */
    async sendPrompt(prompt, options = {}) {
        try {
            await this._initializeLLMService();
            
            if (!(await this.llmService.isConfigured())) {
                throw new Error("LLM service not configured");
            }

            const history = options.history || [];
            const tools = options.tools || ToolExecutor.getToolDefinitions();
            const customRules = options.customRules || '';

            // Create a simple message history
            const messageHistory = [...history, {
                role: 'user',
                parts: [{ text: prompt }]
            }];

            let fullResponse = '';
            const streamGenerator = this.llmService.sendMessageStream(messageHistory, tools, customRules);
            
            for await (const chunk of streamGenerator) {
                if (chunk.text) {
                    fullResponse += chunk.text;
                }
            }

            return fullResponse.trim();
        } catch (error) {
            console.error('[ChatService] sendPrompt failed:', error);
            throw error;
        }
    },

    async sendMessage(chatInput, chatMessages, chatSendButton, chatCancelButton, uploadedImage, clearImagePreview) {
        let userPrompt;
        if (typeof chatInput === 'string') {
            userPrompt = chatInput.trim();
        } else if (chatInput && chatInput.value) {
            userPrompt = chatInput.value.trim();
        } else {
            userPrompt = '';
        }

        if ((!userPrompt && !uploadedImage) || this.isSending) return;

        this.isSending = true;
        this.isCancelled = false;
        if (chatSendButton && chatCancelButton) this._updateUiState(true);
        this.resetErrorTracker();

        try {
            // 1. Render user message immediately
            this._prepareAndRenderUserMessage(chatInput, chatMessages, uploadedImage, clearImagePreview);
            
            // 2. AI-driven intent classification
            this.currentHistory = await DbManager.getChatHistory();
            const classificationResult = await this._classifyMessageIntent(userPrompt, this._getRecentContext());
            
            // Robust parsing for the intent
            const match = classificationResult.match(/(DIRECT|TASK|TOOL)/);
            const intent = match ? match[0] : 'DIRECT'; // Default to DIRECT for safety

            console.log(`AI classified intent as: ${intent}. Raw response: "${classificationResult}"`);

            // 3. Route to the appropriate handler based on AI's decision
            switch (intent) {
                case 'TASK':
                    await this._handleTaskCreation(userPrompt, chatMessages);
                    break;
                case 'TOOL':
                    await this._handleToolExecution(userPrompt, chatMessages);
                    break;
                case 'DIRECT':
                default:
                    await this._handleDirectResponse(userPrompt, chatMessages);
                    break;
            }
        } catch (error) {
            UI.showError(`An error occurred: ${error.message}`);
            console.error('Chat Error:', error);
        } finally {
            this.isSending = false;
            this._updateUiState(false);
            this.currentHistory = null;
        }
    },

    /**
     * Asks the AI to classify the user's intent to determine the correct handling logic.
     * @param {string} userPrompt - The user's message.
     * @param {string} conversationContext - Recent conversation history.
     * @returns {Promise<string>} The AI's classification (DIRECT, TASK, or TOOL).
     */
    async _classifyMessageIntent(userPrompt, conversationContext = '') {
        const classificationPrompt = `
Conversation context:
${conversationContext}

User message: "${userPrompt}"

Classify this message into ONE category:
- DIRECT: Simple questions, explanations, greetings, thanks, casual conversation.
- TASK: Complex work requiring multiple steps, project-level changes, "create/build/implement" requests.
- TOOL: Specific actions needing tools but not full task management (e.g., "read file.js").

Consider complexity, intent, and whether it needs breakdown into subtasks.

Response format: DIRECT|TASK|TOOL
Reason: [brief explanation]`;

        // Use sendPrompt for a direct, non-chatty response
        return await this.sendPrompt(classificationPrompt, { history: this.currentHistory });
    },

    /**
     * Retrieves the last few messages to provide context for the AI's decisions.
     * @param {number} messageCount - The number of recent messages to retrieve.
     * @returns {string} A formatted string of recent messages.
     */
    _getRecentContext(messageCount = 3) {
        const recentMessages = this.currentHistory?.slice(-messageCount) || [];
        if (recentMessages.length === 0) return "No recent conversation.";
        return recentMessages.map(msg => {
            const content = msg.parts.map(part => part.text || '').join(' ');
            return `${msg.role}: ${content}`;
        }).join('\n');
    },

    /**
     * Handles simple, direct interactions that don't require the task management system.
     * @param {string} userPrompt - The user's message.
     * @param {HTMLElement} chatMessages - The chat messages container.
     */
    async _handleDirectResponse(userPrompt, chatMessages) {
        this.currentHistory.push({ role: 'user', parts: [{ text: userPrompt }] });
        await this._performApiCall(this.currentHistory, chatMessages, true); // singleTurn = true
        await DbManager.saveChatHistory(this.currentHistory);
    },

    /**
     * Handles direct requests to execute a tool. (Placeholder for future enhancement)
     * @param {string} userPrompt - The user's message.
     * @param {HTMLElement} chatMessages - The chat messages container.
     */
    async _handleToolExecution(userPrompt, chatMessages) {
        // For now, treat as a direct response. Can be enhanced later to parse and run tools.
        UI.appendMessage(chatMessages, "Tool execution pathway triggered. For now, treating as a direct question.", 'ai-muted');
        await this._handleDirectResponse(userPrompt, chatMessages);
    },

    /**
     * Handles complex tasks that require breakdown and the full task management system.
     * This function encapsulates the original, complex logic of `sendMessage`.
     * @param {string} userPrompt - The user's message.
     * @param {HTMLElement} chatMessages - The chat messages container.
     */
    async _handleTaskCreation(userPrompt, chatMessages) {
        // This is the original, complex logic, now conditionally executed.
        await taskManager.clearActiveTasks();
        UI.appendMessage(chatMessages, `Task created: "${userPrompt}"`, 'ai');
        const mainTask = await taskManager.createTask({ title: userPrompt, priority: 'high' });

        this.currentHistory.push({ role: 'user', parts: [{ text: userPrompt }] });
        this.currentHistory.push({ role: 'user', parts: [{ text: `The main task ID is ${mainTask.id}. Your first step is to call the "task_breakdown" tool with this ID.` }] });

        await this._performApiCall(this.currentHistory, chatMessages, true); // Force breakdown

        let nextTask = taskManager.getNextTask();
        let executionAttempts = 0;
        const maxExecutionAttempts = 10;

        while (nextTask && !this.isCancelled && executionAttempts < maxExecutionAttempts) {
            executionAttempts++;
            UI.appendMessage(chatMessages, `Executing subtask ${executionAttempts}: "${nextTask.title}"`, 'ai');
            await taskManager.updateTask(nextTask.id, { status: 'in_progress' });

            const contextInfo = this._buildTaskContext(nextTask);
            const prompt = `Current subtask: "${nextTask.title}"${nextTask.description ? ` - ${nextTask.description}` : ''}.
Context: ${contextInfo}
Execute this task step by step. When completed, call the task_update tool to mark it as completed. Task ID: ${nextTask.id}`;
            
            this.currentHistory.push({ role: 'user', parts: [{ text: prompt }] });

            let executionResult = null;
            try {
                const startTime = Date.now();
                await this._performApiCall(this.currentHistory, chatMessages, false);
                const endTime = Date.now();
                const updatedTask = taskManager.tasks.get(nextTask.id);
                if (updatedTask && updatedTask.status === 'in_progress') {
                    await taskManager.updateTask(nextTask.id, {
                        status: 'completed',
                        results: { completedAutomatically: true, timestamp: Date.now(), executionTime: endTime - startTime }
                    });
                    executionResult = { success: true, executionTime: endTime - startTime };
                } else {
                    executionResult = { success: updatedTask?.status === 'completed', status: updatedTask?.status, results: updatedTask?.results };
                }
            } catch (error) {
                console.error(`[ChatService] Error executing task ${nextTask.id}:`, error);
                const errorAnalysis = this._analyzeTaskError(nextTask, error);
                executionResult = { error: error.message, timestamp: Date.now(), analysis: errorAnalysis };
                if (errorAnalysis.canRecover && errorAnalysis.retryCount < 2) {
                    UI.appendMessage(chatMessages, `Task "${nextTask.title}" encountered an error. Attempting recovery...`, 'ai');
                    await taskManager.updateTask(nextTask.id, {
                        status: 'pending',
                        context: { ...nextTask.context, errorHistory: [...(nextTask.context?.errorHistory || []), { error: error.message, timestamp: Date.now(), retryCount: errorAnalysis.retryCount + 1 }] }
                    });
                    await taskManager.replanBasedOnResults(nextTask.id, executionResult);
                } else {
                    await taskManager.updateTask(nextTask.id, { status: 'failed', results: executionResult });
                    UI.appendMessage(chatMessages, `Task "${nextTask.title}" failed after recovery attempts: ${error.message}`, 'ai');
                    await taskManager.replanBasedOnResults(nextTask.id, executionResult);
                }
            }

            if (executionResult && !executionResult.error) {
                await taskManager.replanBasedOnResults(nextTask.id, executionResult);
            }

            nextTask = taskManager.getNextTask();
            if (nextTask && nextTask.status === 'failed' && executionAttempts > 3) {
                console.warn(`[ChatService] Breaking execution loop - repeated failed task: ${nextTask.title}`);
                break;
            }
        }

        if (executionAttempts >= maxExecutionAttempts) {
            UI.appendMessage(chatMessages, 'Execution stopped: Maximum attempts reached.', 'ai');
        }

        if (this.isCancelled) {
            UI.appendMessage(chatMessages, 'Execution cancelled by user.', 'ai');
            await taskManager.updateTask(mainTask.id, { status: 'failed', results: { cancelled: true, timestamp: Date.now() } });
        } else {
            const allSubtasks = mainTask.subtasks.map(id => taskManager.tasks.get(id)).filter(Boolean);
            const completedSubtasks = allSubtasks.filter(t => t.status === 'completed');
            const failedSubtasks = allSubtasks.filter(t => t.status === 'failed');
            if (failedSubtasks.length > 0) {
                await taskManager.updateTask(mainTask.id, { status: 'failed', results: { completedSubtasks: completedSubtasks.length, failedSubtasks: failedSubtasks.length, timestamp: Date.now() } });
                UI.appendMessage(chatMessages, `Main task "${mainTask.title}" partially completed. ${completedSubtasks.length}/${allSubtasks.length} subtasks successful.`, 'ai');
            } else {
                await taskManager.updateTask(mainTask.id, { status: 'completed', results: { completedSubtasks: completedSubtasks.length, timestamp: Date.now() } });
                UI.appendMessage(chatMessages, `Main task "${mainTask.title}" completed successfully! All ${completedSubtasks.length} subtasks finished.`, 'ai');
            }
        }
        await DbManager.saveChatHistory(this.currentHistory);
    },

    cancelMessage() {
        if (this.isSending) {
            this.isCancelled = true;
        }
    },

    async sendDirectCommand(prompt, chatMessages) {
        if (this.isSending) return;

        this.isSending = true;
        this.isCancelled = false;
        this._updateUiState(true);

        try {
            UI.appendMessage(chatMessages, prompt, 'user');
            const history = await DbManager.getChatHistory();
            history.push({ role: 'user', parts: [{ text: prompt }] });

            await this._performApiCall(history, chatMessages, true); // singleTurn = true

            await DbManager.saveChatHistory(history);
        } catch (error) {
            UI.showError(`An error occurred: ${error.message}`);
            console.error('Direct Command Error:', error);
        } finally {
            this.isSending = false;
            this._updateUiState(false);
        }
    },

    async clearHistory(chatMessages) {
        chatMessages.innerHTML = '';
        UI.appendMessage(chatMessages, 'Conversation history cleared.', 'ai');
        await DbManager.clearChatHistory();
        await this._initializeLLMService();
    },

    async condenseHistory(chatMessages) {
        UI.appendMessage(chatMessages, 'Condensing history... This will start a new session.', 'ai');
        const history = await DbManager.getChatHistory();
        if (history.length === 0) {
            UI.appendMessage(chatMessages, 'History is already empty.', 'ai');
            return;
        }

        const condensationPrompt =
            "Please summarize our conversation so far in a concise way. Include all critical decisions, file modifications, and key insights. The goal is to reduce the context size while retaining the essential information for our ongoing task. Start the summary with 'Here is a summary of our conversation so far:'.";
        
        // This needs to be a one-off call, not part of the main loop
        const condensationHistory = history.concat([{ role: 'user', parts: [{ text: condensationPrompt }] }]);
        const stream = this.llmService.sendMessageStream(condensationHistory, [], ''); // No tools, no custom rules for summary
        let summaryText = '';
        for await (const chunk of stream) {
            if (chunk.text) {
                summaryText += chunk.text;
            }
        }
        
        chatMessages.innerHTML = '';
        UI.appendMessage(chatMessages, 'Original conversation history has been condensed.', 'ai');
        UI.appendMessage(chatMessages, summaryText, 'ai');

        await this._startChat();
    },

    async viewHistory() {
        const history = await DbManager.getChatHistory();
        return JSON.stringify(history, null, 2);
    },

   trackError(filePath, errorSignature) {
       if (this.errorTracker.filePath === filePath && this.errorTracker.errorSignature === errorSignature) {
           this.errorTracker.count++;
       } else {
           this.errorTracker.filePath = filePath;
           this.errorTracker.errorSignature = errorSignature;
           this.errorTracker.count = 1;
       }
       console.log(`Error tracked:`, this.errorTracker);
   },

   getConsecutiveErrorCount(filePath, errorSignature) {
       if (this.errorTracker.filePath === filePath && this.errorTracker.errorSignature === errorSignature) {
           return this.errorTracker.count;
       }
       return 0;
   },

   resetErrorTracker() {
       this.errorTracker.filePath = null;
       this.errorTracker.errorSignature = null;
       this.errorTracker.count = 0;
       console.log('Error tracker reset.');
   },

   async runToolDirectly(toolName, params, silent = false) {
       if (this.isSending && !this.activePlan) { // Allow tool use during autonomous plan
           UI.showError("Please wait for the current AI operation to complete.");
           return;
       }

       const toolCall = { name: toolName, args: params };
       const chatMessages = document.getElementById('chat-messages');
       if (!silent) {
           UI.appendMessage(chatMessages, `Running tool: ${toolName}...`, 'ai');
       }

       try {
           const result = await ToolExecutor.execute(toolCall, this.rootDirectoryHandle, silent);
           if (!silent) {
               let resultMessage = `Tool '${toolName}' executed successfully.`;
               if (result.toolResponse && result.toolResponse.response && result.toolResponse.response.message) {
                   resultMessage = result.toolResponse.response.message;
               } else if (result.toolResponse && result.toolResponse.response && result.toolResponse.response.error) {
                   throw new Error(result.toolResponse.response.error);
               }
               UI.appendMessage(chatMessages, resultMessage, 'ai');
           }
       } catch (error) {
           const errorMessage = `Error running tool '${toolName}': ${error.message}`;
           UI.showError(errorMessage);
           if (!silent) {
               UI.appendMessage(chatMessages, errorMessage, 'ai');
           }
           console.error(errorMessage, error);
       }
   },

   /**
    * Build contextual information for task execution
    */
   _buildTaskContext(task) {
       const context = [];
       
       // Add task metadata
       if (task.priority !== 'medium') {
           context.push(`Priority: ${task.priority}`);
       }
       
       if (task.confidence < 0.8) {
           context.push(`Confidence: ${(task.confidence * 100).toFixed(0)}% (proceed with caution)`);
       }
       
       if (task.context?.riskLevel && task.context.riskLevel !== 'low') {
           context.push(`Risk Level: ${task.context.riskLevel}`);
       }
       
       if (task.context?.complexity && task.context.complexity !== 'low') {
           context.push(`Complexity: ${task.context.complexity}`);
       }
       
       // Add pattern information
       if (task.context?.patternUsed) {
           context.push(`Pattern: ${task.context.patternUsed} (confidence: ${(task.context.patternConfidence * 100).toFixed(0)}%)`);
       }
       
       // Add error history if exists
       if (task.context?.errorHistory && task.context.errorHistory.length > 0) {
           const lastError = task.context.errorHistory[task.context.errorHistory.length - 1];
           context.push(`Previous Error: ${lastError.error} (retry #${lastError.retryCount})`);
       }
       
       // Add parent task context
       if (task.parentId) {
           const parent = taskManager.tasks.get(task.parentId);
           if (parent) {
               context.push(`Parent Task: "${parent.title}"`);
               
               // Check for failed siblings
               const failedSiblings = parent.subtasks
                   .map(id => taskManager.tasks.get(id))
                   .filter(t => t && t.status === 'failed');
               
               if (failedSiblings.length > 0) {
                   context.push(`Warning: ${failedSiblings.length} sibling task(s) have failed`);
               }
           }
       }
       
       return context.length > 0 ? context.join(', ') : 'Standard execution context';
   },

   /**
    * Analyze task execution errors for recovery strategies
    */
   _analyzeTaskError(task, error) {
       const analysis = {
           canRecover: false,
           retryCount: 0,
           recoveryStrategy: 'none',
           errorType: 'unknown'
       };
       
       // Get retry count from task context
       if (task.context?.errorHistory) {
           analysis.retryCount = task.context.errorHistory.length;
       }
       
       const errorMessage = error.message.toLowerCase();
       
       // Categorize error types and determine recovery strategies
       if (errorMessage.includes('file not found') || errorMessage.includes('path does not exist')) {
           analysis.errorType = 'file_not_found';
           analysis.canRecover = analysis.retryCount < 2;
           analysis.recoveryStrategy = 'file_discovery';
       } else if (errorMessage.includes('permission denied') || errorMessage.includes('access denied')) {
           analysis.errorType = 'permission_denied';
           analysis.canRecover = analysis.retryCount < 1;
           analysis.recoveryStrategy = 'permission_check';
       } else if (errorMessage.includes('syntax error') || errorMessage.includes('parse error')) {
           analysis.errorType = 'syntax_error';
           analysis.canRecover = analysis.retryCount < 2;
           analysis.recoveryStrategy = 'syntax_validation';
       } else if (errorMessage.includes('network') || errorMessage.includes('connection')) {
           analysis.errorType = 'network_error';
           analysis.canRecover = analysis.retryCount < 3;
           analysis.recoveryStrategy = 'retry_with_delay';
       } else if (errorMessage.includes('timeout')) {
           analysis.errorType = 'timeout';
           analysis.canRecover = analysis.retryCount < 2;
           analysis.recoveryStrategy = 'increase_timeout';
       } else if (errorMessage.includes('dependency') || errorMessage.includes('import') || errorMessage.includes('module')) {
           analysis.errorType = 'dependency_error';
           analysis.canRecover = analysis.retryCount < 1;
           analysis.recoveryStrategy = 'dependency_resolution';
       }
       
       return analysis;
   },

   /**
    * Get comprehensive execution metrics and insights
    */
   getExecutionInsights() {
       const metrics = taskManager.getExecutionMetrics();
       const insights = {
           ...metrics,
           recommendations: [],
           healthScore: 0
       };
       
       // Calculate health score (0-100)
       let healthScore = 0;
       
       // Completion rate contributes 40% to health score
       healthScore += (metrics.completionRate * 0.4);
       
       // Low failure rate contributes 30% to health score
       healthScore += ((100 - metrics.failureRate) * 0.3);
       
       // Adaptive task generation indicates good error handling (20%)
       const adaptiveRatio = metrics.totalTasks > 0 ? (metrics.adaptiveTasksGenerated / metrics.totalTasks) * 100 : 0;
       healthScore += Math.min(adaptiveRatio * 2, 20); // Cap at 20%
       
       // Pattern effectiveness contributes 10%
       const avgPatternSuccess = Object.values(metrics.patternEffectiveness)
           .reduce((sum, pattern) => sum + pattern.successRate, 0) /
           Object.keys(metrics.patternEffectiveness).length || 0;
       healthScore += (avgPatternSuccess * 0.1);
       
       insights.healthScore = Math.round(Math.min(healthScore, 100));
       
       // Generate recommendations
       if (metrics.failureRate > 20) {
           insights.recommendations.push('High failure rate detected. Consider reviewing task breakdown patterns.');
       }
       
       if (metrics.completionRate < 70) {
           insights.recommendations.push('Low completion rate. Tasks may be too complex or poorly defined.');
       }
       
       if (metrics.replanningEvents > metrics.totalTasks * 0.3) {
           insights.recommendations.push('Frequent re-planning detected. Initial task breakdown may need improvement.');
       }
       
       if (metrics.adaptiveTasksGenerated === 0 && metrics.failureRate > 0) {
           insights.recommendations.push('No adaptive tasks generated despite failures. Error recovery system may need attention.');
       }
       
       // Pattern-specific recommendations
       for (const [pattern, stats] of Object.entries(metrics.patternEffectiveness)) {
           if (stats.failureRate > 30) {
               insights.recommendations.push(`Pattern "${pattern}" has high failure rate (${stats.failureRate.toFixed(1)}%). Consider refining this pattern.`);
           }
       }
       
       return insights;
   }
};
