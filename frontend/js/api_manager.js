import { Settings } from './settings.js';

// =================================================================
// === API Key Manager (Handles DB and Rotation)                 ===
// =================================================================
export const ApiKeyManager = {
    keys: [],
    currentIndex: 0,
    triedKeys: new Set(),
    async loadKeys(provider) {
        let keysString = '';

        if (provider) {
            switch (provider) {
                case 'gemini':
                    keysString = Settings.get('llm.gemini.apiKey') || '';
                    break;
                case 'openai':
                    keysString = Settings.get('llm.openai.apiKey') || '';
                    break;
                // Ollama does not use API keys, so it's omitted here.
            }
        }

        // Preserve current index across requests if keyset remains the same.
        const prevKeys = Array.isArray(this.keys) ? [...this.keys] : [];
        const prevIndex = Number.isInteger(this.currentIndex) ? this.currentIndex : 0;

        const newKeys = keysString.split('\n').map(k => k.trim()).filter(Boolean);

        // Decide new index:
        // - If keys unchanged (same order/content), keep previous index (bounded)
        // - Else, try to keep the same key string if still present
        // - Fallback to 0
        let newIndex = 0;
        if (prevKeys.length > 0 && newKeys.length > 0) {
            const sameOrderAndContent =
                prevKeys.length === newKeys.length &&
                prevKeys.every((k, i) => k === newKeys[i]);

            if (sameOrderAndContent) {
                newIndex = Math.min(prevIndex, newKeys.length - 1);
            } else {
                const currentKeyString = prevKeys[Math.min(prevIndex, prevKeys.length - 1)];
                const foundIdx = newKeys.indexOf(currentKeyString);
                newIndex = foundIdx >= 0 ? foundIdx : 0;
            }
        }

        this.keys = newKeys;
        this.currentIndex = newIndex;
        this.triedKeys.clear();
        console.log(`ApiKeyManager loaded ${this.keys.length} keys for ${provider}. Current index: ${this.currentIndex}`);
    },
    // The ApiKeyManager no longer saves keys directly.
    // Saving is handled by the Settings module, triggered by the UI.
    getCurrentKey() {
        if (this.keys.length > 0) {
            this.triedKeys.add(this.keys[this.currentIndex]);
            return this.keys[this.currentIndex];
        }
        return null;
    },
    rotateKey() {
        if (this.keys.length > 0) {
            this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        }
    },
    hasTriedAllKeys() {
        return this.triedKeys.size >= this.keys.length;
    },
    resetTriedKeys() {
        this.triedKeys.clear();
    },
};