/**
 * LLMFacade
 * - Provides a single, provider-agnostic entrypoint to stream responses.
 * - Composes PromptBuilder + ToolAdapter and delegates to BaseLLMService.
 * - Centralized Error/Retry/KeyRotation already handled in BaseLLMService.sendMessageStream.
 */

import { LLMServiceFactory } from './service_factory.js';
import { PromptBuilder } from './prompt_builder.js';
import { ToolAdapter } from './tool_adapter.js';

export class LLMFacade {
  /**
   * Construct facade using an existing LLM service instance.
   * @param {BaseLLMService} llmService
   * @param {object} settings Optional reference to settings (for future parameterization)
   */
  constructor(llmService, settings = {}) {
    if (!llmService) {
      throw new Error('LLMFacade requires a valid llmService instance');
    }
    this.llmService = llmService;
    this.settings = settings;
  }

  /**
   * Convenience factory: construct facade by creating the service from settings.
   * @param {object} settings - Settings object as used in the app Settings.getLLMSettings()
   * @returns {LLMFacade}
   */
  static fromSettings(settings) {
    if (!settings) {
      throw new Error('LLMFacade.fromSettings requires settings');
    }
    const provider = settings.provider || 'gemini';
    const llmService = LLMServiceFactory.create(provider, settings);
    return new LLMFacade(llmService, settings);
  }

  /**
   * Expose provider capabilities
   * @returns {object}
   */
  getCapabilities() {
    return this.llmService?.getCapabilities ? this.llmService.getCapabilities() : {};
  }

  /**
   * Normalize internal tool declarations to provider-specific schema.
   * Note: Providers themselves may already convert declarations internally. This method
   * exists to centralize the mapping if/when we move all conversion to the Facade.
   *
   * @param {object} internalTools - { functionDeclarations: [...] } Gemini-style internal shape
   * @returns {any} Provider-specific tool declaration
   */
  _prepareTools(internalTools) {
    const caps = this.getCapabilities();
    const providerKey =
      caps?.provider ||
      this.llmService?.constructor?.name?.replace('Service', '').toLowerCase() ||
      'gemini';

    // Providers (gemini/openai) currently convert tools internally.
    // To avoid double conversion (which would drop tools), pass-through for them.
    if (providerKey === 'gemini' || providerKey === 'openai') {
      return internalTools;
    }
    // For other providers (or future ones without internal conversion), convert here.
    return ToolAdapter.toProviderDeclarations(providerKey, internalTools);
  }

  /**
   * Ensure a system turn exists at the head of the conversation.
   * @param {Array} history
   * @param {string} systemPrompt
   * @returns {Array}
   */
  _ensureSystemTurn(history, systemPrompt) {
    const safeHistory = Array.isArray(history) ? [...history] : [];
    const hasSystem = safeHistory.length > 0 && safeHistory[0]?.role === 'system';
    if (!hasSystem) {
      const systemTurn = { role: 'system', parts: [{ text: systemPrompt }] };
      return [systemTurn, ...safeHistory];
    }
    return safeHistory;
  }

  /**
   * Stream a response from the underlying provider via a unified interface.
   * - Builds a provider-agnostic system prompt (PromptBuilder)
   * - Optionally converts tools to provider schema (ToolAdapter)
   * - Delegates to BaseLLMService.sendMessageStream (which handles retries/rotation)
   *
   * @param {Array} history - Conversation history turns: [{ role: 'user'|'model'|'system', parts: [...] }, ...]
   * @param {object} internalTools - Optional internal tool declarations (Gemini-style): { functionDeclarations: [...] }
   * @param {string} mode - 'code' | 'plan' | 'search' (default 'code')
   * @param {string} customRules - Optional custom rules string
   * @param {AbortSignal|null} abortSignal - Optional AbortSignal to cancel the request
   * @returns {AsyncGenerator<{ text?: string, functionCalls?: any, usageMetadata?: any }>}
   */
  async *sendMessageStream(history, internalTools = null, mode = 'code', customRules = '', abortSignal = null, promptContext = null) {
    if (!this.llmService) {
      throw new Error('LLMFacade not initialized with a valid llmService');
    }

    // Build unified system prompt (with optional slot caps) and ensure it is present
    const promptPack = PromptBuilder.build(mode, customRules, promptContext || {});
    const effectiveHistory = this._ensureSystemTurn(history, promptPack.systemPrompt);

    // Prepare provider-specific tool declarations
    const providerTools = this._prepareTools(internalTools);

    // Delegate to provider (BaseLLMService entrypoint)
    const stream = this.llmService.sendMessageStream(effectiveHistory, providerTools, customRules, abortSignal);
    for await (const chunk of stream) {
      // Pass-through; Chat layer can normalize functionCalls using ToolAdapter.fromProviderCalls
      yield chunk;
    }
  }

  /**
   * Simple convenience: send a single prompt (non-interactive) and collect full text.
   * @param {string} prompt
   * @param {object} options
   * @param {Array} options.history - Optional prior turns (without a system turn)
   * @param {object} options.tools - Optional internal tool declarations
   * @param {string} options.mode - 'code'|'plan'|'search'
   * @param {string} options.customRules - Optional custom rules
   * @param {AbortSignal|null} options.abortSignal - Optional AbortSignal
   * @returns {Promise<string>} full text response
   */
  async sendPrompt(prompt, options = {}) {
    const {
      history = [],
      tools = null,
      mode = 'code',
      customRules = '',
      abortSignal = null,
      promptContext = null
    } = options;

    const messageHistory = [
      ...history,
      { role: 'user', parts: [{ text: prompt }] }
    ];

    let fullText = '';
    for await (const chunk of this.sendMessageStream(messageHistory, tools, mode, customRules, abortSignal, promptContext)) {
      if (chunk?.text) {
        fullText += chunk.text;
      }
    }
    return fullText.trim();
  }

  /**
   * Dispose underlying service resources.
   */
  dispose() {
    try {
      this.llmService?.dispose?.();
    } catch (_) {
      // no-op
    }
  }
}