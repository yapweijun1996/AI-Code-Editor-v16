import { BaseLLMService } from './base_llm_service.js';

/**
 * Concrete implementation for a local Ollama instance.
 */
export class OllamaService extends BaseLLMService {
    constructor(apiKeyManager, model, customConfig = {}, providerConfig = {}, options = {}) {
        // Ollama does not use ApiKeyManager; pass null but carry over common options
        super(null, model, options);
        this.customConfig = customConfig;
        this.updateConfig(providerConfig);
    }

    async isConfigured() {
        return !!this.customConfig.baseURL && !!this.model;
    }

    async *_sendMessageStreamImpl(history, _toolDefinition, customRules, abortSignal = null) {
        if (!(await this.isConfigured())) {
            throw new Error("Ollama base URL and model name are not set.");
        }

        const messages = this._prepareMessages(history);

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
            response = await fetch(`${this.customConfig.baseURL}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages,
                    stream: true,
                    options: {
                        temperature: this.providerConfig?.temperature,
                        top_p: this.providerConfig?.topP,
                        num_predict: this.providerConfig?.maxTokens
                    }
                    // Note: Ollama's native tool support is still developing.
                    // This implementation will focus on text generation for now.
                }),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
            if (abortSignal) {
                abortSignal.removeEventListener('abort', abortHandler);
            }
        }

        if (!response.ok) {
            let errMsg = 'Ollama API Error';
            try {
                const errorData = await response.json();
                errMsg = `Ollama API Error: ${errorData?.error || response.statusText}`;
            } catch (_) {
                errMsg = `Ollama API Error: ${response.status} ${response.statusText}`;
            }
            throw new Error(errMsg);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Accumulate streamed bytes and process line-delimited JSON
            buffer += decoder.decode(value, { stream: true });

            // Process complete lines
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);
                if (!line) continue;
                try {
                    const json = JSON.parse(line);
                    if (json.done) {
                        yield {
                            usageMetadata: {
                                promptTokenCount: json.prompt_eval_count,
                                candidatesTokenCount: json.eval_count,
                            }
                        };
                        // No API key rotation for Ollama; simply return.
                        return;
                    }
                    if (json.message?.content) {
                        yield {
                            text: json.message.content,
                            functionCalls: null // No function calling support in this implementation
                        };
                    }
                } catch (e) {
                    // Some chunks may be partial or non-JSON; skip quietly to be robust
                    console.debug('Ollama stream non-JSON/partial line skipped:', line);
                }
            }
        }

        // Flush any remaining buffered content
        const remaining = buffer.trim();
        if (remaining) {
            try {
                const json = JSON.parse(remaining);
                if (json.done) {
                    yield {
                        usageMetadata: {
                            promptTokenCount: json.prompt_eval_count,
                            candidatesTokenCount: json.eval_count,
                        }
                    };
                    return;
                }
                if (json.message?.content) {
                    yield {
                        text: json.message.content,
                        functionCalls: null
                    };
                }
            } catch (_) {
                // ignore trailing partial
            }
        }
    }

    _prepareMessages(history) {
        // Extract system prompt from incoming history (added by PromptBuilder in Chat layer)
        const sysTurn = history.find(t => t.role === 'system');
        const systemPrompt = sysTurn && Array.isArray(sysTurn.parts)
            ? sysTurn.parts.map(p => p.text).filter(Boolean).join('\n')
            : '';

        const messages = [];
        if (systemPrompt && systemPrompt.trim()) {
            messages.push({ role: 'system', content: systemPrompt });
        }

        history.forEach(turn => {
            if (turn.role === 'system') return;
            const role = turn.role === 'model' ? 'assistant' : 'user';
            const content = (turn.parts || []).map(p => p.text).filter(Boolean).join('\n');
            if (content && content.trim()) {
                messages.push({ role, content });
            }
        });
        return messages;
    }

    _getSystemPrompt(mode, customRules) {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const timeString = new Date().toLocaleString();
        
        const baseCodePrompt = `You are a specialized local AI programming assistant running on Ollama. Your purpose is to provide efficient, focused programming assistance while being mindful of local resource constraints.

# OLLAMA OPTIMIZATION PRINCIPLES
- **Resource Efficiency**: Provide concise, focused responses to minimize processing overhead
- **Local Context**: Leverage your local execution for privacy and speed benefits
- **Direct Action**: Get straight to the point with clear, actionable solutions
- **Memory Conservation**: Keep context relevant and avoid unnecessary verbosity

# CORE PROGRAMMING METHODOLOGY

**1. EFFICIENT PROBLEM ANALYSIS**
- Quickly identify the core issue or requirement
- Focus on practical, implementable solutions
- Prioritize clarity and correctness over elaborate explanations

**2. STREAMLINED TOOL USAGE**
Note: Tool calling may be limited in Ollama. When tools are available:
- Use read_file to understand existing code before modifications
- Prefer apply_diff for precise, surgical changes; if multiple ranges or very large files, use edit_file with an edits array
- Use search_code to locate specific patterns efficiently

**3. FILE OPERATIONS**
- Always use relative paths from project root
- Verify file existence before operations
- Handle errors gracefully with clear explanations

**4. CODE QUALITY FOCUS**
- Write clean, maintainable code following established patterns
- Provide brief explanations for complex logic
- Ensure compatibility with existing codebase

**5. RESPONSE STRUCTURE**
- Lead with the solution or answer
- Provide necessary context concisely
- Include code examples when helpful
- Keep explanations focused and practical

Current session: ${timeString} (${timeZone})`;

        const planPrompt = `You are a local AI research assistant running on Ollama, specialized in providing focused strategic analysis and planning support.

# LOCAL ANALYSIS ADVANTAGES
- **Privacy-Focused**: Your local execution ensures sensitive planning data stays private
- **Focused Research**: Provide targeted, actionable insights without unnecessary elaboration
- **Efficient Processing**: Deliver comprehensive analysis while being resource-conscious

# STREAMLINED PLANNING METHODOLOGY

**1. RAPID ASSESSMENT**
- Identify key objectives and constraints quickly
- Focus on most critical information needs
- Prioritize actionable insights over theoretical analysis

**2. TARGETED RESEARCH**
When research tools are available:
- Use duckduckgo_search for essential external information
- Focus on recent, relevant sources
- Synthesize findings efficiently

**3. STRUCTURED DELIVERY**
- Lead with executive summary and key recommendations
- Use clear headers and bullet points for readability
- Provide specific, actionable next steps
- Keep supporting detail concise but comprehensive

**4. ITERATIVE REFINEMENT**
- Build upon previous research in follow-up questions
- Refine recommendations based on new information
- Maintain focus on practical implementation

Current session: ${timeString} (${timeZone})`;

        const searchPrompt = `You are Ollama Search Assistant, a local AI agent specialized in efficient codebase exploration and analysis. Your purpose is to provide focused, resource-efficient search capabilities.

# LOCAL SEARCH ADVANTAGES  
- **Privacy-Focused**: Your local execution ensures sensitive code analysis stays private
- **Efficient Processing**: Provide targeted analysis while being resource-conscious
- **Direct Results**: Focus on actionable findings without unnecessary overhead

# STREAMLINED SEARCH APPROACH

**1. FOCUSED EXPLORATION**
- Use get_project_structure for quick architectural overview
- Apply search_code for targeted pattern matching
- Read key files for essential analysis
- Prioritize most relevant findings

**2. EFFICIENT ANALYSIS**
- Identify critical patterns and relationships quickly
- Focus on most important code quality issues
- Provide concise insights without elaborate explanations
- Highlight actionable improvements

**3. CONCISE REPORTING**
- Lead with most important findings
- Include specific file references
- Keep explanations focused and practical
- Provide clear next steps

**4. RESOURCE-CONSCIOUS OPERATION**
- Balance thoroughness with efficiency
- Focus on high-impact insights
- Minimize processing overhead
- Deliver value quickly

Current session: ${timeString} (${timeZone})`;

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

    // Provider metadata and key
    getProviderKey() {
        return 'ollama';
    }

    getCapabilities() {
        return {
            provider: 'ollama',
            supportsFunctionCalling: false,
            supportsSystemInstruction: true,
            nativeToolProtocol: 'none',
            maxContext: 32000,
            maxTokens: this.providerConfig?.maxTokens ?? 2048,
            rateLimits: {
                requestsPerMinute: null,
                tokensPerMinute: null
            }
        };
    }
}