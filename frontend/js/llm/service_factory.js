import { GeminiService } from './gemini_service.js';
import { OpenAIService } from './openai_service.js';
import { OllamaService } from './ollama_service.js';

/**
 * Factory class to create LLM service instances.
 */
export class LLMServiceFactory {
    /**
     * Creates and returns an instance of an LLM service.
     * @param {string} provider - The name of the LLM provider (e.g., 'gemini', 'openai').
     * @param {object} settings - The application settings.
     * @returns {BaseLLMService} An instance of the requested LLM service.
     */
    static create(provider, settings) {
        if (!settings) {
            throw new Error("LLM settings are not provided.");
        }
        
        switch (provider) {
            case 'gemini': {
                const providerConfig = {
                    temperature: settings.gemini?.temperature,
                    topP: settings.gemini?.topP,
                    maxTokens: settings.gemini?.maxOutputTokens,
                    enableTools: settings.gemini?.enableTools !== false
                };
                return new GeminiService(
                    settings.apiKeyManager,
                    settings.gemini?.model,
                    providerConfig,
                    settings.common || {}
                );
            }
            case 'openai': {
                const providerConfig = {
                    temperature: settings.openai?.temperature,
                    topP: settings.openai?.topP,
                    maxTokens: settings.openai?.maxTokens,
                    toolCallMode: settings.openai?.toolCallMode || 'auto',
                    enableTools: settings.openai?.enableTools !== false
                };
                return new OpenAIService(
                    settings.apiKeyManager,
                    settings.openai?.model,
                    providerConfig,
                    settings.common || {}
                );
            }
            case 'ollama': {
                const customConfig = { baseURL: settings.ollama?.baseURL };
                const providerConfig = {
                    temperature: settings.ollama?.temperature,
                    topP: settings.ollama?.topP,
                    maxTokens: settings.ollama?.maxTokens,
                    enableTools: settings.ollama?.enableTools === true
                };
                return new OllamaService(
                    settings.apiKeyManager,
                    settings.ollama?.model,
                    customConfig,
                    providerConfig,
                    settings.common || {}
                );
            }
            default: {
                // Fallback to Gemini if no provider is selected or the provider is unknown
                console.warn(`Unknown or unset LLM provider: '${provider}'. Falling back to Gemini.`);
                const providerConfig = {
                    temperature: settings.gemini?.temperature,
                    topP: settings.gemini?.topP,
                    maxTokens: settings.gemini?.maxOutputTokens,
                    enableTools: settings.gemini?.enableTools !== false
                };
                return new GeminiService(
                    settings.apiKeyManager,
                    settings.gemini?.model,
                    providerConfig,
                    settings.common || {}
                );
            }
        }
    }
}