// === IndexedDB Manager for API Keys                            ===
// =================================================================
export const DbManager = {
    db: null,
    dbName: 'CodeEditorDB',
    stores: {
        handles: 'fileHandles',
        codeIndex: 'codeIndex',
        sessionState: 'sessionState',
        checkpoints: 'checkpoints',
        settings: 'settings',
        customRules: 'customRules',
        chatHistory: 'chatHistory',
        toolLogs: 'tool_logs',
        metrics: 'metrics',
    },
    async openDb() {
        return new Promise((resolve, reject) => {
            if (this.db) return resolve(this.db);
            const request = indexedDB.open(this.dbName, 12);
            request.onerror = () => reject('Error opening IndexedDB.');
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.stores.handles)) {
                    db.createObjectStore(this.stores.handles, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(this.stores.codeIndex)) {
                    db.createObjectStore(this.stores.codeIndex, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(this.stores.sessionState)) {
                    db.createObjectStore(this.stores.sessionState, { keyPath: 'id' });
                }
                if (db.objectStoreNames.contains(this.stores.checkpoints)) {
                    db.deleteObjectStore(this.stores.checkpoints);
                }
                db.createObjectStore(
                    this.stores.checkpoints,
                    { autoIncrement: true, keyPath: 'id' },
                );
                if (!db.objectStoreNames.contains(this.stores.settings)) {
                    db.createObjectStore(this.stores.settings, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(this.stores.customRules)) {
                    db.createObjectStore(this.stores.customRules, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(this.stores.chatHistory)) {
                    db.createObjectStore(this.stores.chatHistory, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(this.stores.toolLogs)) {
                    const logStore = db.createObjectStore(this.stores.toolLogs, { autoIncrement: true, keyPath: 'id' });
                    logStore.createIndex('timestamp', 'timestamp', { unique: false });
                    logStore.createIndex('toolName', 'toolName', { unique: false });
                }
                // Create metrics store for per-request LLM metrics
                if (!db.objectStoreNames.contains(this.stores.metrics)) {
                    const metricsStore = db.createObjectStore(this.stores.metrics, { keyPath: 'id', autoIncrement: true });
                    metricsStore.createIndex('ts', 'ts', { unique: false });
                    metricsStore.createIndex('provider', 'provider', { unique: false });
                    metricsStore.createIndex('model', 'model', { unique: false });
                }
            };
        });
    },
    async saveDirectoryHandle(handle) {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const request = db
            .transaction(this.stores.handles, 'readwrite')
            .objectStore(this.stores.handles)
            .put({ id: 'rootDirectory', handle });
            request.onerror = () => reject('Error saving directory handle.');
            request.onsuccess = () => resolve();
        });
    },
    async getDirectoryHandle() {
        const db = await this.openDb();
        return new Promise((resolve) => {
            const request = db
            .transaction(this.stores.handles, 'readonly')
            .objectStore(this.stores.handles)
            .get('rootDirectory');
            request.onerror = () => resolve(null);
            request.onsuccess = () =>
            resolve(request.result ? request.result.handle : null);
        });
    },
    async clearDirectoryHandle() {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const request = db
            .transaction(this.stores.handles, 'readwrite')
            .objectStore(this.stores.handles)
            .delete('rootDirectory');
            request.onerror = () => reject('Error clearing directory handle.');
            request.onsuccess = () => resolve();
        });
    },
    async saveCodeIndex(index) {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const request = db
            .transaction(this.stores.codeIndex, 'readwrite')
            .objectStore(this.stores.codeIndex)
            .put({ id: 'fullCodeIndex', index });
            request.onerror = () => reject('Error saving code index.');
            request.onsuccess = () => resolve();
        });
    },
    async getCodeIndex() {
        const db = await this.openDb();
        return new Promise((resolve) => {
            const request = db
            .transaction(this.stores.codeIndex, 'readonly')
            .objectStore(this.stores.codeIndex)
            .get('fullCodeIndex');
            request.onerror = () => resolve(null);
            request.onsuccess = () =>
            resolve(request.result ? request.result.index : null);
        });
    },
    async saveLastIndexTimestamp(timestamp) {
        return this.saveSetting('lastIndexTimestamp', timestamp);
    },
    async getLastIndexTimestamp() {
        return this.getSetting('lastIndexTimestamp');
    },
    async saveSessionState(state) {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const request = db
                .transaction(this.stores.sessionState, 'readwrite')
                .objectStore(this.stores.sessionState)
                .put(state);
            request.onerror = () => reject('Error saving session state.');
            request.onsuccess = () => resolve();
        });
    },
    async getSessionState() {
        const db = await this.openDb();
        return new Promise((resolve) => {
            const request = db
                .transaction(this.stores.sessionState, 'readonly')
                .objectStore(this.stores.sessionState)
                .get('lastSession');
            request.onerror = () => resolve(null);
            request.onsuccess = () => resolve(request.result || null);
        });
    },
    async saveCheckpoint(checkpointData) {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const request = db
                .transaction(this.stores.checkpoints, 'readwrite')
                .objectStore(this.stores.checkpoints)
                .add(checkpointData);
            request.onerror = () => reject('Error saving checkpoint.');
            request.onsuccess = () => resolve();
        });
    },
    async getCheckpoints() {
        const db = await this.openDb();
        return new Promise((resolve) => {
            const request = db
                .transaction(this.stores.checkpoints, 'readonly')
                .objectStore(this.stores.checkpoints)
                .getAll();
            request.onerror = () => resolve([]);
            request.onsuccess = () => resolve(request.result || []);
        });
    },
    async getCheckpointById(id) {
        const db = await this.openDb();
        return new Promise((resolve) => {
            const request = db
                .transaction(this.stores.checkpoints, 'readonly')
                .objectStore(this.stores.checkpoints)
                .get(id);
            request.onerror = () => resolve(null);
            request.onsuccess = () => resolve(request.result || null);
        });
    },
    async deleteCheckpoint(id) {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const request = db
                .transaction(this.stores.checkpoints, 'readwrite')
                .objectStore(this.stores.checkpoints)
                .delete(id);
            request.onerror = () => reject('Error deleting checkpoint.');
            request.onsuccess = () => resolve();
        });
    },

    async getAllFromStore(storeName) {
        const db = await this.openDb();
        return new Promise((resolve) => {
            const request = db
                .transaction(storeName, 'readonly')
                .objectStore(storeName)
                .getAll();
            request.onerror = () => resolve([]);
            request.onsuccess = () => resolve(request.result || []);
        });
    },

    async saveSetting(settingId, value) {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const request = db
                .transaction(this.stores.settings, 'readwrite')
                .objectStore(this.stores.settings)
                .put({ id: settingId, value: value });
            request.onerror = () => reject('Error saving setting.');
            request.onsuccess = () => resolve();
        });
    },
    async getSetting(settingId) {
        const db = await this.openDb();
        return new Promise((resolve) => {
            const request = db
                .transaction(this.stores.settings, 'readonly')
                .objectStore(this.stores.settings)
                .get(settingId);
            request.onerror = () => resolve(null);
            request.onsuccess = () =>
                resolve(request.result ? request.result.value : null);
        });
    },

    async saveMultipleSettings(settings) {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.stores.settings, 'readwrite');
            const store = transaction.objectStore(this.stores.settings);
            settings.forEach(setting => {
                store.put({ id: setting.id, value: setting.value });
            });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject('Error saving multiple settings.');
        });
    },
    async saveCustomRule(ruleId, value) {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const request = db
                .transaction(this.stores.customRules, 'readwrite')
                .objectStore(this.stores.customRules)
                .put({ id: ruleId, value: value });
            request.onerror = () => reject('Error saving custom rule.');
            request.onsuccess = () => resolve();
        });
    },
    async getCustomRule(ruleId) {
        const db = await this.openDb();
        return new Promise((resolve) => {
            const request = db
                .transaction(this.stores.customRules, 'readonly')
                .objectStore(this.stores.customRules)
                .get(ruleId);
            request.onerror = () => resolve(null);
            request.onsuccess = () =>
                resolve(request.result ? request.result.value : null);
        });
    },
    async saveChatHistory(history) {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const request = db
                .transaction(this.stores.chatHistory, 'readwrite')
                .objectStore(this.stores.chatHistory)
                .put({ id: 'current_chat', history });
            request.onerror = () => reject('Error saving chat history.');
            request.onsuccess = () => resolve();
        });
    },
    async getChatHistory() {
        const db = await this.openDb();
        return new Promise((resolve) => {
            const request = db
                .transaction(this.stores.chatHistory, 'readonly')
                .objectStore(this.stores.chatHistory)
                .get('current_chat');
            request.onerror = () => resolve([]);
            request.onsuccess = () =>
                resolve(request.result ? request.result.history : []);
        });
    },
    async clearChatHistory() {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const request = db
                .transaction(this.stores.chatHistory, 'readwrite')
                .objectStore(this.stores.chatHistory)
                .delete('current_chat');
            request.onerror = () => reject('Error clearing chat history.');
            request.onsuccess = () => resolve();
        });
    },

    // === Metrics APIs =========================================================
    // Adds a per-request metrics record
    async metricsAdd(record) {
        const db = await this.openDb();
        const r = record || {};
        const inputTokens = Number.isFinite(r.inputTokens) ? r.inputTokens : 0;
        const outputTokens = Number.isFinite(r.outputTokens) ? r.outputTokens : 0;
        const normalized = {
            ts: typeof r.ts === 'number' ? r.ts : Date.now(),
            provider: typeof r.provider === 'string' ? r.provider : 'UnknownProvider',
            model: typeof r.model === 'string' ? r.model : 'unknown',
            requestId: typeof r.requestId === 'string' ? r.requestId : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            inputTokens,
            outputTokens,
            totalTokens: Number.isFinite(r.totalTokens) ? r.totalTokens : (inputTokens + outputTokens),
            latencyMs: Number.isFinite(r.latencyMs) ? r.latencyMs : 0,
            success: typeof r.success === 'boolean' ? r.success : true,
            errorCategory: (typeof r.errorCategory === 'string' && r.errorCategory) ? r.errorCategory : null
        };
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(this.stores.metrics, 'readwrite');
                const store = tx.objectStore(this.stores.metrics);
                const req = store.put(normalized);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject('Error adding metrics record.');
            } catch (e) {
                reject('Error adding metrics record.');
            }
        });
    },

    // Returns aggregate summary over metrics records
    async metricsGetSummary(filters = {}) {
        const db = await this.openDb();
        const { since, provider, model } = filters || {};
        const summary = {
            requestCount: 0,
            successCount: 0,
            failureCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            averageLatencyMs: 0
        };
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(this.stores.metrics, 'readonly');
                const store = tx.objectStore(this.stores.metrics);

                const hasSince = typeof since === 'number';
                const hasProvider = typeof provider === 'string' && provider.length > 0;
                const hasModel = typeof model === 'string' && model.length > 0;
                const filtersCount = (hasSince ? 1 : 0) + (hasProvider ? 1 : 0) + (hasModel ? 1 : 0);

                let request;
                if (filtersCount === 1 && hasSince) {
                    request = store.index('ts').openCursor(IDBKeyRange.lowerBound(since));
                } else if (filtersCount === 1 && hasProvider) {
                    request = store.index('provider').openCursor(IDBKeyRange.only(provider));
                } else if (filtersCount === 1 && hasModel) {
                    request = store.index('model').openCursor(IDBKeyRange.only(model));
                } else {
                    request = store.openCursor();
                }

                let sumLatency = 0;
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        const val = cursor.value || {};
                        // Apply full filter set in code for correctness
                        if ((!hasSince || (typeof val.ts === 'number' && val.ts >= since)) &&
                            (!hasProvider || val.provider === provider) &&
                            (!hasModel || val.model === model)) {
                            const inTok = Number(val.inputTokens) || 0;
                            const outTok = Number(val.outputTokens) || 0;
                            const totTok = Number(val.totalTokens);
                            const lat = Number(val.latencyMs) || 0;

                            summary.requestCount += 1;
                            if (val.success === false) {
                                summary.failureCount += 1;
                            } else {
                                summary.successCount += 1;
                            }
                            summary.inputTokens += inTok;
                            summary.outputTokens += outTok;
                            summary.totalTokens += Number.isFinite(totTok) ? totTok : (inTok + outTok);
                            sumLatency += lat;
                        }
                        cursor.continue();
                    } else {
                        summary.averageLatencyMs = summary.requestCount > 0 ? (sumLatency / summary.requestCount) : 0;
                        resolve({ summary });
                    }
                };
                request.onerror = () => {
                    resolve({ summary }); // Fail-soft: return zeros
                };
            } catch (e) {
                resolve({ summary }); // Fail-soft
            }
        });
    },

};
