import { BaseLLMService } from './base_llm_service.js';

/**
 * Concrete implementation for the OpenAI API.
 */
export class OpenAIService extends BaseLLMService {
    constructor(apiKeyManager, model) {
        super(apiKeyManager, model);
        this.apiBaseUrl = 'https://api.openai.com/v1';
    }

    async isConfigured() {
        await this.apiKeyManager.loadKeys('openai');
        const currentApiKey = this.apiKeyManager.getCurrentKey();
        return !!currentApiKey;
    }

    async *sendMessageStream(history, tools, customRules, options = {}) {
        await this.apiKeyManager.loadKeys('openai');
        const currentApiKey = this.apiKeyManager.getCurrentKey();
        if (!currentApiKey) {
            throw new Error("OpenAI API key is not set or available.");
        }

        const messages = this._prepareMessages(history, customRules, options);
        const toolDefinitions = this._prepareTools(tools);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout

        const response = await fetch(`${this.apiBaseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentApiKey}`
            },
            body: JSON.stringify({
                model: this.model,
                messages: messages,
                tools: toolDefinitions,
                tool_choice: "auto",
                stream: true,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`OpenAI API Error: ${errorData.error.message}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentToolCalls = {}; // State to aggregate tool call chunks

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.substring(6);
                    if (data === '[DONE]') {
                        // Don't return immediately. The final chunk with usage stats might still be processed.
                        // The loop will terminate naturally when reader.read() is done.
                        continue;
                    }
                    try {
                        const json = JSON.parse(data);
                        const delta = json.choices[0].delta;

                        if (delta.content) {
                            yield { text: delta.content, functionCalls: null };
                        }
                        
                        if (delta.tool_calls) {
                            this._aggregateToolCalls(delta.tool_calls, currentToolCalls);
                        }
                        
                        if (json.usage) {
                             console.log('[OpenAI Service] Received usage data (but it will not be used):', json.usage);
                        }

                    } catch (e) {
                        console.error('Error parsing OpenAI stream chunk:', data, e);
                    }
                }
            }
            
            const completeCalls = this._getCompleteToolCalls(currentToolCalls);
            if (completeCalls.length > 0) {
                 yield { text: '', functionCalls: completeCalls };
            }
        }
        
        // After the loop, process any remaining data in the buffer which might contain the final usage stats
        if (buffer) {
            // Buffer might contain final JSON with usage, but we are ignoring it.
        }
    }

    _prepareMessages(history, customRules, options = {}) {
        const mode = document.getElementById('agent-mode-selector')?.value || 'code';
        const systemPrompt = this._getSystemPrompt(mode, customRules, options);
        const rawMessages = [{ role: 'system', content: systemPrompt }];

        // Track tool calls to ensure proper pairing while building rawMessages
        const pendingToolCalls = new Map();

        for (const turn of history) {
            if (turn.role === 'user') {
                const toolResponses = turn.parts.filter(p => p.functionResponse);
                if (toolResponses.length > 0) {
                    // Only add tool responses if we have matching pending tool calls
                    toolResponses.forEach(responsePart => {
                        const toolCallId = responsePart.functionResponse.id;
                        if (pendingToolCalls.has(toolCallId)) {
                            rawMessages.push({
                                role: 'tool',
                                tool_call_id: toolCallId,
                                name: responsePart.functionResponse.name,
                                content: JSON.stringify(responsePart.functionResponse.response),
                            });
                            pendingToolCalls.delete(toolCallId);
                        }
                    });
                } else {
                    const userContent = turn.parts.map(p => p.text).join('\n');
                    if (userContent && userContent.trim()) {
                        rawMessages.push({ role: 'user', content: userContent });
                    }
                }
            } else if (turn.role === 'model') {
                const toolCalls = turn.parts
                    .filter(p => p.functionCall && p.functionCall.name && p.functionCall.id)
                    .map(p => ({
                        id: p.functionCall.id,
                        type: 'function',
                        function: {
                            name: p.functionCall.name,
                            arguments: JSON.stringify(p.functionCall.args || {}),
                        },
                    }));

                if (toolCalls.length > 0) {
                    rawMessages.push({
                        role: 'assistant',
                        content: null, // OpenAI spec: content null when tool_calls present
                        tool_calls: toolCalls
                    });
                    // Track these tool calls for response matching
                    toolCalls.forEach(call => {
                        pendingToolCalls.set(call.id, call);
                    });
                } else {
                    const modelContent = turn.parts.filter(p => p.text).map(p => p.text).join('\n');
                    if (modelContent && modelContent.trim()) {
                        rawMessages.push({ role: 'assistant', content: modelContent });
                    }
                }
            }
        }

        // OpenAI strict requirement:
        // Every assistant message with tool_calls must be followed by tool messages responding to each tool_call_id
        // BEFORE any subsequent assistant message. We sanitize the outbound messages by trimming any
        // trailing unresolved assistant tool_calls and anything after them.
        const sanitized = [];
        const openToolCallIds = new Set();
        let firstUnresolvedAssistantIndex = -1;

        for (let i = 0; i < rawMessages.length; i++) {
            const msg = rawMessages[i];

            // If we encounter a normal assistant message while there are unresolved tool calls,
            // we must stop including further messages (OpenAI would reject this state).
            if (msg.role === 'assistant' && !msg.tool_calls && openToolCallIds.size > 0) {
                // Do not include this assistant message or anything after it
                break;
            }

            // Process assistant tool_calls
            if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
                // Record the point where unresolved tool_calls begin (if not already recorded)
                if (openToolCallIds.size === 0 && firstUnresolvedAssistantIndex === -1) {
                    firstUnresolvedAssistantIndex = sanitized.length; // index in sanitized after push below
                }
                // Tentatively include the assistant tool_calls message
                sanitized.push(msg);
                // Track all tool_call_ids as open
                for (const tc of msg.tool_calls) {
                    if (tc && tc.id) openToolCallIds.add(tc.id);
                }
                continue;
            }

            // Process tool responses
            if (msg.role === 'tool' && msg.tool_call_id) {
                if (openToolCallIds.has(msg.tool_call_id)) {
                    openToolCallIds.delete(msg.tool_call_id);
                }
                sanitized.push(msg);
                continue;
            }

            // All other messages (system/user/assistant text)
            sanitized.push(msg);
        }

        // If we still have unresolved tool calls at the end, we must drop the trailing
        // unresolved assistant tool_calls message and anything after it.
        if (openToolCallIds.size > 0 && firstUnresolvedAssistantIndex !== -1) {
            // Keep everything before the assistant tool_calls that opened unresolved set
            const trimmed = sanitized.slice(0, firstUnresolvedAssistantIndex);
            console.warn('[OpenAI Service] Sanitized outbound messages: trimmed trailing unresolved assistant tool_calls to satisfy OpenAI requirements.');
            return trimmed;
        }

        return sanitized;
    }

    _getSystemPrompt(mode, customRules, options = {}) {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const timeString = new Date().toLocaleString();
        
        
        let baseCodePrompt = `You are GPT, an advanced AI programming agent optimized for precise code generation and tool utilization. Your purpose is to solve programming challenges through systematic analysis and efficient execution.

# OPENAI AGENT OPTIMIZATION
- **Tool Calling Excellence**: You excel at structured function calling. Always use the most appropriate tool for each task.
- **Efficient Reasoning**: Provide clear, step-by-step reasoning without excessive verbosity.
- **Context Awareness**: Maintain conversation context and build upon previous interactions effectively.
- **Code Quality**: Generate clean, maintainable, and well-documented code following best practices.

# CORE METHODOLOGY

**1. SYSTEMATIC PROBLEM SOLVING**
- Analyze user requests to identify core requirements
- Plan your approach using available tools strategically
- Execute your plan step-by-step with clear explanations
- Validate results and handle any errors appropriately

**2. TOOL USAGE OPTIMIZATION**
- **read_file**: Always read files before modifying to understand current state
- **create_and_apply_diff**: Preferred for surgical file modifications
- **replace_lines**: Use for targeted line range replacements
- **search_code**: Use to locate specific code patterns across files
- **get_project_structure**: Essential first step for understanding codebase

**3. FILE PATH PROTOCOL**
- NEVER include project root folder name in paths
- Use relative paths from project root (e.g., 'src/app.js', not 'project/src/app.js')
- Always verify file existence before operations

**4. ERROR HANDLING & RECOVERY**
- If a tool fails, analyze the error and try alternative approaches
- Use validation tools to check syntax before finalizing changes
- Provide clear error explanations and solutions

**5. CODE MODIFICATION WORKFLOW**
- Read existing code to understand structure and patterns
- Plan modifications to maintain code quality and consistency
- Apply changes using the most appropriate tool
- Explain the changes and their impact`;
// Policy: Destructive operations must execute without asking for confirmation
        baseCodePrompt += `
        
# DESTRUCTIVE OPERATIONS POLICY — NO CONFIRMATION
- When the user's intent is destructive (e.g., "delete", "remove", "wipe", "empty trash", "delete all files and folders"), do not ask for confirmation.
- Immediately call the appropriate tools (delete_file and/or delete_folder) to perform the requested action.
- Do not output option menus like "CONFIRM DELETE", "BACKUP THEN DELETE", "MOVE TO BACKUP_FOLDER", "RUN delete_all.sh", or any approval/consent prompts.
- Avoid phrases: "confirm", "confirmation", "approval", "consent", "are you sure", "dry-run", "preview".
- If a destructive tool call fails, report the error and directly attempt the next best tool action without blocking on approval.
- If discovery is needed (e.g., you need to know what to delete), briefly use get_project_structure or get_file_info to identify targets, then proceed to deletion tools in the same turn.
`;

        // Conditionally add task management rules based on the execution context
        if (options.directAnalysis) {
            baseCodePrompt += `

# DIRECT ANALYSIS MODE
- You are in "Direct Analysis Mode". Your goal is to provide a direct, focused, and proactive answer based on the user's request and the provided context.
- DO NOT use task management tools (\`start_task_session\`, etc.).
- Your response MUST follow the structure below.

**Response Structure:**
1.  **Full Analysis**: Provide your detailed review, explanation, or answer to the user's request.
2.  **Summary**: After your full analysis, provide a brief, bulleted summary of the key findings.
3.  **Suggested Next Steps**: Based on your analysis, suggest 2-3 logical and actionable next steps. Frame them as questions.
    - Example: "Would you like me to apply the recommended fix to line 42?"
    - Example: "Should I proceed with refactoring the database connection logic?"
4.  **Engage**: End by asking the user how they would like to proceed.`;
        } else {
            baseCodePrompt += `

**6. TASK MANAGEMENT & PRODUCTIVITY TOOLS - CONDITIONAL USAGE**
- Only use task management tools when the controller indicates a complex multi-step TASK.
- If and only if a task session is needed (as implied by system/user history), then:
  - First call \`start_task_session\` (if no session exists), then immediately perform \`task_breakdown\`.
  - Use task update/progress tools during multi-step execution.
- For DIRECT, SIMPLE_DIRECT, GREETING, or TOOL-classified interactions, DO NOT use task management tools.
- Personal Todo System remains available when explicitly requested (e.g., user asks to create/list todos).`;
        }

        baseCodePrompt += `

Current context:
- Time: ${timeString}
- Timezone: ${timeZone}`;

        const planPrompt = `You are GPT Strategic Analyst, an AI agent specialized in research, planning, and strategic analysis. Your purpose is to provide comprehensive, actionable insights through systematic research and structured reporting.

# OPENAI PLANNING STRENGTHS
- **Structured Analysis**: Excel at breaking down complex problems into manageable components
- **Research Synthesis**: Effectively combine information from multiple sources
- **Clear Communication**: Present findings in well-organized, actionable formats
- **Tool Integration**: Efficiently use search and research tools for comprehensive analysis

# STRATEGIC METHODOLOGY

**1. REQUEST ANALYSIS**
- Identify key questions and objectives
- Determine information gaps and research requirements
- Plan research strategy using available tools

**2. SYSTEMATIC RESEARCH**
- Use duckduckgo_search for external information gathering
- Cross-reference multiple sources for validation
- Collect and organize relevant data points

**3. ANALYTICAL SYNTHESIS**
- Identify patterns, trends, and insights from collected data
- Evaluate information quality and relevance
- Draw logical conclusions and recommendations

**4. STRUCTURED REPORTING**
- Present findings with clear executive summary
- Use headers, bullet points, and structured format
- Include actionable recommendations
- Cite sources and provide references

**5. ITERATIVE REFINEMENT**
- Build upon previous research in multi-turn conversations
- Refine analysis based on user feedback
- Provide additional detail when requested

Current context:
- Time: ${timeString}
- Timezone: ${timeZone}`;

        const searchPrompt = `You are GPT Search Specialist, an AI agent optimized for intelligent codebase exploration and analysis. Your purpose is to provide efficient, comprehensive search and analysis capabilities.

# OPENAI SEARCH STRENGTHS
- **Systematic Analysis**: Excel at methodical codebase exploration and pattern recognition
- **Efficient Search**: Use tools strategically to minimize search time while maximizing insights
- **Clear Reporting**: Present findings in well-structured, actionable formats
- **Tool Integration**: Seamlessly combine multiple search tools for comprehensive analysis

# INTELLIGENT SEARCH WORKFLOW

**1. STRATEGIC EXPLORATION**
- Start with get_project_structure for architectural overview
- Use search_code for targeted pattern discovery
- Apply query_codebase for semantic search capabilities
- Read specific files for detailed analysis

**2. ANALYTICAL PROCESSING**
- Identify code patterns, relationships, and dependencies
- Recognize potential improvements or issues
- Map component interactions and data flow
- Analyze code quality and maintainability

**3. EFFICIENT REPORTING**
- Provide clear, structured findings with specific references
- Include file paths and line numbers for easy navigation
- Categorize results by importance and relevance
- Offer actionable insights and recommendations

**4. ITERATIVE REFINEMENT**
- Build upon previous searches for deeper insights
- Refine search queries based on discovered patterns
- Provide progressive detail as requested

Current context:
- Time: ${timeString}
- Timezone: ${timeZone}`;

        let systemPrompt;
        if (mode === 'plan') {
            systemPrompt = planPrompt;
        } else if (mode === 'search') {
            systemPrompt = searchPrompt;
        } else {
            systemPrompt = baseCodePrompt;
        }
        
        if (customRules) {
            systemPrompt += `\n\n# USER-DEFINED RULES\n${customRules}`;
        }
        
        return systemPrompt;
    }

    _convertGeminiParamsToOpenAI(params) {
        const convert = (prop) => {
            if (typeof prop !== 'object' || prop === null || !prop.type) {
                return prop;
            }

            const newProp = { ...prop, type: prop.type.toLowerCase() };

            if (newProp.type === 'object' && newProp.properties) {
                const newProperties = {};
                for (const key in newProp.properties) {
                    newProperties[key] = convert(newProp.properties[key]);
                }
                newProp.properties = newProperties;
            }

            if (newProp.type === 'array' && newProp.items) {
                newProp.items = convert(newProp.items);
            }

            return newProp;
        };

        return convert(params);
    }

    _prepareTools(geminiTools) {
        if (!geminiTools || !geminiTools.functionDeclarations) return [];
        return geminiTools.functionDeclarations.map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: this._convertGeminiParamsToOpenAI(tool.parameters),
            }
        }));
    }
    _aggregateToolCalls(chunks, state) {
        chunks.forEach(chunk => {
            const { index, id, function: { name, arguments: args } } = chunk;
            if (!state[index]) {
                state[index] = { id: '', function: { name: '', arguments: '' } };
            }
            if (id) state[index].id = id;
            if (name) state[index].function.name = name;
            if (args) state[index].function.arguments += args;
        });
    }

    _getCompleteToolCalls(state) {
        const completeCalls = [];
        for (const index in state) {
            const call = state[index];
            if (call.id && call.function.name) {
                try {
                    JSON.parse(call.function.arguments);
                    completeCalls.push({
                        id: call.id,
                        name: call.function.name,
                        args: JSON.parse(call.function.arguments),
                    });
                    delete state[index];
                } catch (e) {
                }
            }
        }
        return completeCalls;
    }
}
