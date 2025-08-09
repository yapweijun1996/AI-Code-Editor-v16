import { DbManager } from './db.js';
import { ApiKeyManager } from './api_manager.js';

export const Settings = {
    // Default settings
    defaults: {
        'llm.provider': 'gemini',
        'llm.gemini.model': 'gemini-2.5-flash',
        'llm.openai.model': 'gpt-4o',
        'llm.ollama.model': 'llama3',
        'llm.ollama.baseURL': 'http://localhost:11434',

        'llm.common.debugLLM': false,
        'llm.common.timeoutMs': 300000,
        'llm.common.retryAttempts': 3,
        'llm.common.retryDelay': 1000,
        'llm.common.requestsPerMinute': 60,
        'llm.common.tokensPerMinute': 1000000,

        // Provider-specific tuning
        'llm.gemini.temperature': 0.4,
        'llm.gemini.topP': 1,
        'llm.gemini.maxOutputTokens': 8192,
        'llm.gemini.enableTools': true,

        'llm.openai.temperature': 0.2,
        'llm.openai.topP': 1,
        'llm.openai.maxTokens': 4096,
        'llm.openai.toolCallMode': 'auto', // 'auto' | 'none' | 'required'
        'llm.openai.enableTools': true,

        'llm.ollama.temperature': 0.2,
        'llm.ollama.topP': 0.9,
        'llm.ollama.maxTokens': 1024,
        'llm.ollama.enableTools': false,

        'ui.theme': 'dark',
        'custom.amend.rules': `You are in "Amend Mode" - optimized for fast, precise debugging and code changes.

🎯 PRIMARY OBJECTIVES:
- Make surgical, targeted changes with minimal risk
- Prefer faster debugging methods while maintaining accuracy
- Use the most efficient tools for each situation

🔧 PREFERRED TOOL WORKFLOW:
1. ALWAYS start with 'read_file' (with include_line_numbers=true) to get precise context
2. Use 'search_in_file' for targeted searches within specific files
3. Use 'apply_diff' for surgical changes - this is the SAFEST and FASTEST method
4. Only use 'edit_file' with edits array for complex multi-line changes

⚡ PERFORMANCE OPTIMIZATIONS:
- Cache read operations when possible
- Use line-numbered reads for accurate targeting
- Prefer apply_diff over full file rewrites
- Batch related changes when safe to do so

🚫 FORBIDDEN ACTIONS:
- NEVER use 'rewrite_file' or 'write_to_file'
- NEVER make changes without reading the current file content first
- NEVER guess at line numbers - always verify with read_file

💡 SMART DEBUGGING:
- If an error occurs repeatedly, try alternative approaches
- Use performance metrics to optimize tool selection
- Learn from previous successful patterns`,
    },

    // In-memory cache for settings
    cache: new Map(),

    /**
     * Initializes the settings module, loading all settings from the database.
     */
    async initialize() {
        // 1. Load all default settings into the cache first.
        for (const key in this.defaults) {
            this.cache.set(key, this.defaults[key]);
        }

        // 2. Fetch all stored settings from the database.
        const allSettings = await DbManager.getAllFromStore(DbManager.stores.settings);

        // 3. Overwrite the defaults with any stored values.
        for (const setting of allSettings) {
            this.cache.set(setting.id, setting.value);
        }
        console.log('Settings initialized and loaded into cache.');
        
        // ApiKeyManager is now loaded on-demand, no explicit initialization needed.
    },

    /**
     * Gets a setting value by key.
     * @param {string} key - The key of the setting to retrieve.
     * @returns {any} The value of the setting.
     */
    get(key) {
        if (this.cache.has(key)) {
            return this.cache.get(key);
        }
        console.warn(`Setting with key "${key}" not found. Returning default.`);
        return this.defaults[key];
    },

    /**
     * Sets a setting value by key and saves it to the database.
     * @param {string} key - The key of the setting to save.
     * @param {any} value - The value to save.
     */
    async set(key, value) {
        const valueToSave = typeof value === 'string' ? value.trim() : value;
        this.cache.set(key, valueToSave);
        await DbManager.saveSetting(key, valueToSave);
        if (key.includes('apiKey')) {
            console.log(`Setting "${key}" updated to "[REDACTED]".`);
        } else {
            console.log(`Setting "${key}" updated to "${value}".`);
        }
        // Notify listeners if LLM settings changed so services can reconfigure at runtime
        try {
            if (typeof key === 'string' && key.startsWith('llm.')) {
                document.dispatchEvent(new CustomEvent('llm-settings-updated'));
            }
        } catch (_) {}
    },

    async setMultiple(settings) {
        const settingsToSave = [];
        for (const key in settings) {
            const value = settings[key];
            const valueToSave = typeof value === 'string' ? value.trim() : value;
            this.cache.set(key, valueToSave);
            settingsToSave.push({ id: key, value: valueToSave });
            if (key.includes('apiKey')) {
                console.log(`Setting "${key}" updated to "[REDACTED]".`);
            } else {
                console.log(`Setting "${key}" updated to "${value}".`);
            }
        }
        await DbManager.saveMultipleSettings(settingsToSave);
        // Notify listeners if any LLM-related setting changed
        try {
            const touchedLLM = Object.keys(settings || {}).some(k => typeof k === 'string' && k.startsWith('llm.'));
            if (touchedLLM) {
                document.dispatchEvent(new CustomEvent('llm-settings-updated'));
            }
        } catch (_) {}
    },

    /**
     * Gets all settings required to configure an LLM service.
     * This abstracts the underlying storage from the consumers.
     * @returns {object} An object containing all necessary LLM settings.
     */
    getLLMSettings() {
        const common = {
            debugLLM: !!this.get('llm.common.debugLLM'),
            timeout: this.get('llm.common.timeoutMs'),
            retryAttempts: this.get('llm.common.retryAttempts'),
            retryDelay: this.get('llm.common.retryDelay'),
            rateLimit: {
                requestsPerMinute: this.get('llm.common.requestsPerMinute'),
                tokensPerMinute: this.get('llm.common.tokensPerMinute'),
            }
        };

        return {
            provider: this.get('llm.provider'),
            apiKeyManager: ApiKeyManager, // Pass the singleton instance
            common,
            gemini: {
                model: this.get('llm.gemini.model'),
                temperature: this.get('llm.gemini.temperature'),
                topP: this.get('llm.gemini.topP'),
                maxOutputTokens: this.get('llm.gemini.maxOutputTokens'),
                enableTools: !!this.get('llm.gemini.enableTools'),
            },
            openai: {
                model: this.get('llm.openai.model'),
                temperature: this.get('llm.openai.temperature'),
                topP: this.get('llm.openai.topP'),
                maxTokens: this.get('llm.openai.maxTokens'),
                toolCallMode: this.get('llm.openai.toolCallMode'),
                enableTools: !!this.get('llm.openai.enableTools'),
            },
            ollama: {
                model: this.get('llm.ollama.model'),
                baseURL: this.get('llm.ollama.baseURL'),
                temperature: this.get('llm.ollama.temperature'),
                topP: this.get('llm.ollama.topP'),
                maxTokens: this.get('llm.ollama.maxTokens'),
                enableTools: !!this.get('llm.ollama.enableTools'),
            },
        };
    }
};

// Custom event to signal that LLM settings have been updated.
export const dispatchLLMSettingsUpdated = () => {
    document.dispatchEvent(new CustomEvent('llm-settings-updated'));
};
