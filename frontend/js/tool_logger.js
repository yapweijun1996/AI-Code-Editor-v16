import { DbManager } from './db.js';

// A more robust and structured logging system for tool executions.
export class ToolLogger {
    constructor() {
        this.logDb = null;
        this.init();
    }

    async init() {
        try {
            this.logDb = await DbManager.openDb();
            console.log('Tool execution log database initialized.');
        } catch (error) {
            console.error('Failed to initialize tool execution log database:', error);
        }
    }

    async log(toolName, parameters, status, result) {
        if (!this.logDb) {
            console.error('Log database is not available.');
            return;
        }

        const logEntry = {
            timestamp: new Date().toISOString(),
            toolName,
            parameters: JSON.parse(JSON.stringify(parameters || {})), // Deep copy
            status, // 'Success' or 'Error'
            result: JSON.parse(JSON.stringify(result || {})), // Deep copy
        };

        try {
            const tx = this.logDb.transaction('tool_logs', 'readwrite');
            const store = tx.objectStore('tool_logs');
            await store.add(logEntry);
            await tx.done;
        } catch (error) {
            console.error('Failed to write to tool log database:', error);
        }
    }

    async getLogs(limit = 100) {
        if (!this.logDb) return Promise.resolve([]);
        return new Promise((resolve, reject) => {
            const tx = this.logDb.transaction('tool_logs', 'readonly');
            const store = tx.objectStore('tool_logs');
            const request = store.getAll(null, limit);
            request.onerror = () => reject('Error fetching logs.');
            request.onsuccess = () => resolve(request.result || []);
        });
    }

    async clearLogs() {
        if (!this.logDb) return;
        const tx = this.logDb.transaction('tool_logs', 'readwrite');
        await tx.objectStore('tool_logs').clear();
        console.log('Tool execution logs cleared.');
    }
}

export const toolLogger = new ToolLogger();
