import { BaseLLMService } from './base_llm_service.js';
import { ToolAdapter } from './tool_adapter.js';

/**
 * Concrete implementation for the OpenAI API.
 */
export class OpenAIService extends BaseLLMService {
    constructor(apiKeyManager, model, providerConfig = {}, options = {}) {
        super(apiKeyManager, model, options);
        this.updateConfig(providerConfig);
        this.apiBaseUrl = 'https://api.openai.com/v1';
    }

    async isConfigured() {
        await this.apiKeyManager.loadKeys('openai');
        const currentApiKey = this.apiKeyManager.getCurrentKey();
        return !!currentApiKey;
    }

    async *_sendMessageStreamImpl(history, toolDefinition, customRules, abortSignal = null) {
        await this.apiKeyManager.loadKeys('openai');
        const currentApiKey = this.apiKeyManager.getCurrentKey();
        if (!currentApiKey) {
            throw new Error("OpenAI API key is not set or available.");
        }

        const messages = this._prepareMessages(history, customRules);
        const toolDecl = ToolAdapter.toProviderDeclarations(this.getProviderKey(), toolDefinition);
        const enableTools = this.providerConfig?.enableTools !== false;
        const tools = (enableTools && toolDecl) ? toolDecl : undefined;
        const tool_choice = enableTools ? (this.providerConfig?.toolCallMode || 'auto') : 'none';

        const controller = new AbortController();
        const abortHandler = () => controller.abort();
        const timeoutMs = this.options?.timeout ?? 300000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs); // configurable timeout
        if (abortSignal) {
            if (abortSignal.aborted) {
                clearTimeout(timeoutId);
                throw new Error('Request aborted');
            }
            abortSignal.addEventListener('abort', abortHandler, { once: true });
        }

        let response;
        try {
            response = await fetch(`${this.apiBaseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentApiKey}`
                },
                body: JSON.stringify((() => {
                    const payload = {
                        model: this.model,
                        messages,
                        stream: true,
                        temperature: this.providerConfig?.temperature,
                        top_p: this.providerConfig?.topP,
                        max_tokens: this.providerConfig?.maxTokens
                    };
                    if (tools) payload.tools = tools;
                    payload.tool_choice = tool_choice;
                    return payload;
                })()),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
            if (abortSignal) {
                abortSignal.removeEventListener('abort', abortHandler);
            }
        }

        if (!response.ok) {
            let errorMessage = 'OpenAI API Error';
            try {
                const errorData = await response.json();
                errorMessage = `OpenAI API Error: ${errorData?.error?.message || response.statusText}`;
            } catch (_) {
                // ignore JSON parse error
                errorMessage = `OpenAI API Error: ${response.status} ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentToolCalls = {}; // State to aggregate tool call chunks
        // Accumulate content and normalized usage across the entire stream
        let accumulatedText = '';
        let finalUsage = null;

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
                        continue;
                    }
                    try {
                        const json = JSON.parse(data);
                        const delta = json.choices?.[0]?.delta || {};

                        if (delta.content) {
                            yield { text: delta.content, functionCalls: null };
                            accumulatedText += delta.content;
                        }
                        
                        if (delta.tool_calls) {
                            this._aggregateToolCalls(delta.tool_calls, currentToolCalls);
                        }
                        
                        if (json.usage) {
                            try {
                                const pt = (json.usage.prompt_tokens ?? json.usage.input_tokens ?? 0);
                                const ct = (json.usage.completion_tokens ?? json.usage.output_tokens ??
                                    ((json.usage.total_tokens && (json.usage.prompt_tokens ?? json.usage.input_tokens))
                                        ? (json.usage.total_tokens - (json.usage.prompt_tokens ?? json.usage.input_tokens))
                                        : 0));
                                finalUsage = {
                                    promptTokenCount: pt,
                                    candidatesTokenCount: ct
                                };
                            } catch (_) {
                                // ignore malformed usage payloads
                            }
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
        
         // After loop: compute or emit normalized usage metadata
         try {
             if (!finalUsage) {
                 // Fallback estimation using tokenizer if available
                 let estPrompt = 0;
                 let estResponse = 0;
                 if (typeof GPTTokenizer_cl100k_base !== 'undefined') {
                     const { encode } = GPTTokenizer_cl100k_base;
                     const promptText = (messages || []).map(m => (m.content || '')).join('\n');
                     estPrompt = encode(promptText).length;
                     estResponse = encode(accumulatedText).length;
                 }
                 finalUsage = {
                     promptTokenCount: estPrompt,
                     candidatesTokenCount: estResponse
                 };
             }
             // Emit a final usage chunk to normalize across providers
             yield { text: '', functionCalls: null, usageMetadata: finalUsage };
         } catch (_) {
             // non-fatal
         }
         
         // Successful completion handled by BaseLLMService KeyRotation policy (no provider-level rotation)
     }

    _prepareMessages(history, customRules) {
        // Extract system prompt from incoming history (added by PromptBuilder in Chat layer)
        const systemPrompt = this._extractSystemPrompt(history, customRules);
        const messages = [];

        if (systemPrompt && systemPrompt.trim()) {
            messages.push({ role: 'system', content: systemPrompt });
        }

        // Track tool calls to ensure proper pairing
        const pendingToolCalls = new Map();

        for (const turn of history) {
            if (turn.role === 'system') {
                // Already captured via systemPrompt above; skip additional system turns
                continue;
            }

            if (turn.role === 'user') {
                const toolResponses = turn.parts.filter(p => p.functionResponse);
                if (toolResponses.length > 0) {
                    // Only add tool responses if we have matching pending tool calls
                    toolResponses.forEach(responsePart => {
                        const toolCallId = responsePart.functionResponse.id;
                        if (pendingToolCalls.has(toolCallId)) {
                            messages.push({
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
                        messages.push({ role: 'user', content: userContent });
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
                    messages.push({
                        role: 'assistant',
                        content: null, // As per OpenAI's spec, content is null when tool_calls is present
                        tool_calls: toolCalls
                    });
                    // Track these tool calls for response matching
                    toolCalls.forEach(call => {
                        pendingToolCalls.set(call.id, call);
                    });
                } else {
                    const modelContent = turn.parts.filter(p => p.text).map(p => p.text).join('\n');
                    if (modelContent && modelContent.trim()) {
                        messages.push({ role: 'assistant', content: modelContent });
                    }
                }
            }
        }

        // Clean up any orphaned tool calls by removing assistant messages with no responses
        const cleanedMessages = [];
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role === 'assistant' && msg.tool_calls) {
                // Check if the next messages contain responses to these tool calls
                const toolCallIds = msg.tool_calls.map(tc => tc.id);
                let hasResponses = false;
                for (let j = i + 1; j < messages.length; j++) {
                    if (messages[j].role === 'tool' && toolCallIds.includes(messages[j].tool_call_id)) {
                        hasResponses = true;
                        break;
                    }
                    if (messages[j].role === 'assistant' || messages[j].role === 'user') {
                        break; // Stop looking once we hit another turn
                    }
                }
                if (hasResponses) {
                    cleanedMessages.push(msg);
                }
                // If no responses, skip this assistant message with tool calls
            } else {
                cleanedMessages.push(msg);
            }
        }

        return cleanedMessages;
    }

    _extractSystemPrompt(history, customRules) {
        const sysTurn = history.find(t => t.role === 'system');
        let text = '';
        if (sysTurn && Array.isArray(sysTurn.parts)) {
            text = sysTurn.parts.map(p => p.text).filter(Boolean).join('\n');
        }
        if (!text) {
            // Fallback to legacy generator if no system prompt present
            try {
                text = this._getSystemPrompt('code', customRules, {});
            } catch (_) {
                text = customRules || '';
            }
        }
        return text;
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

**6. TASK MANAGEMENT & PRODUCTIVITY TOOLS - MANDATORY USAGE**
- **IMMEDIATE ACTION REQUIRED:** Before starting ANY multi-step task, you MUST call \`start_task_session\` first. This is NOT optional.
- **AI Task Management System - USE FIRST:**
  - ANY request involving analysis, optimization, review, or improvement = Call \`start_task_session\` immediately
  - Example: User says "analyze the code" → FIRST tool call must be \`start_task_session\` with goal "analyze codebase structure and quality"
  - After \`start_task_session\`, use \`start_next_task\` to begin systematic work
  - Use \`complete_current_task\` when finishing each subtask
  - Use \`display_task_progress\` regularly to keep user informed
- **Personal Todo System:** Help users manage their tasks:
  - Use \`todo_create\` to capture user requirements as actionable todos
  - Use \`todo_list\` to show existing todos
  - Tell users they can access todo list anytime with Ctrl+T

**MANDATORY RULE: If a user request involves more than reading a single file, you MUST start with \`start_task_session\`. NO EXCEPTIONS!**`;
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

    // Tool conversion handled by ToolAdapter.toProviderDeclarations()
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

    // Provider metadata and key
    getProviderKey() {
        return 'openai';
    }

    getCapabilities() {
        return {
            provider: 'openai',
            supportsFunctionCalling: true,
            supportsSystemInstruction: true,
            nativeToolProtocol: 'openai_tools',
            maxContext: 128000,
            maxTokens: this.providerConfig?.maxTokens ?? 4096,
            rateLimits: {
                requestsPerMinute: this.options?.rateLimit?.requestsPerMinute ?? 3000,
                tokensPerMinute: this.options?.rateLimit?.tokensPerMinute ?? null
            }
        };
    }
}
