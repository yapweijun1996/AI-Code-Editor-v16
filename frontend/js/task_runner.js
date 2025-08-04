// This module handles discovering tasks from package.json.
// Task execution has been disabled to maintain the browser-first architecture.

import { getFileHandleFromPath } from './file_system.js';

class TaskRunner {
    constructor() {
        this.tasks = {};
    }

    async discoverTasks(rootDirHandle) {
        try {
            const packageJsonHandle = await getFileHandleFromPath(rootDirHandle, 'package.json');
            const file = await packageJsonHandle.getFile();
            const content = await file.text();
            const packageJson = JSON.parse(content);
            this.tasks = packageJson.scripts || {};
        } catch (e) {
            this.tasks = {};
        }
        return this.tasks;
    }

    runTask(taskName) {
        const command = this.tasks[taskName];
        if (command) {
            console.warn(`Task execution disabled: "${taskName}" -> "${command}"`);
            console.warn('This browser-based editor focuses on file editing. Use your terminal to run: npm run ' + taskName);
            throw new Error(`Task execution has been disabled in this browser-based editor. Please run "npm run ${taskName}" in your terminal.`);
        } else {
            console.error(`Task not found: ${taskName}`);
        }
    }
}

export default new TaskRunner();