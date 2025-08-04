# 🚀 AI Task Management System

## Overview

The AI Task Management System provides a structured way to handle complex programming tasks. It allows an AI agent to break down a high-level goal into a series of smaller, manageable subtasks and execute them sequentially. This system is unified with a user-facing to-do list, providing full visibility into the AI's plan.

## 🎯 Key Benefits

-   **Clarity and Structure:** The AI breaks down complex goals into a clear, step-by-step plan.
-   **Systematic Execution:** Tasks are executed in a logical order, with support for dependencies.
-   **Progress Tracking:** The user can monitor the AI's progress in real-time through the To-Do List UI (`Ctrl+T`).
-   **Adaptability:** The AI can add new tasks as it discovers more work is needed.

## 🛠️ Core Tools

The task management system is controlled through a set of tools available under the `TaskTools` namespace.

### 1. `TaskTools.create(data)` - Create a New Task

This is the fundamental tool for creating a new task or a main goal.

```javascript
// Create a main goal
const mainTask = await TaskTools.create({
  title: "Implement user authentication feature",
  priority: "high"
});

// Create a simple one-off task
const simpleTask = await TaskTools.create({
  title: "Fix the typo in the README.md file"
});
```

### 2. `TaskTools.breakdown(mainTask)` - Breakdown a Goal into Subtasks

Once a main goal is created, this tool analyzes its title and uses a heuristic-based approach to generate a series of logical subtasks.

```javascript
// mainTask is the object returned from TaskTools.create
const subtasks = await TaskTools.breakdown(mainTask);
```

**Pattern Recognition Examples:**

-   `"optimize|refactor|improve"` → Generates steps for analysis, implementation, and verification.
-   `"implement|create|add"` → Generates steps for requirements, implementation, testing, and documentation.
-   `"fix|debug|resolve"` → Generates steps for reproduction, root cause analysis, implementation, and verification.

### 3. `TaskTools.update(taskId, updates)` - Update Task Status and Details

This tool is used to modify a task's properties, most importantly its status (`pending`, `in_progress`, `completed`).

```javascript
// Mark a task as in progress
await TaskTools.update(taskId, { status: 'in_progress' });

// Mark a task as completed
await TaskTools.update(taskId, { 
    status: 'completed',
    results: { 
        filesModified: ['index.html'],
        notes: "The main query was optimized successfully."
    }
});
```

### 4. `TaskTools.getNext()` - Get the Next Actionable Task

This tool identifies the next logical task to work on, respecting priorities and dependencies.

```javascript
const nextTask = await TaskTools.getNext();
if (nextTask) {
    console.log(`Next task to execute: ${nextTask.title}`);
}
```

## 🔄 Recommended Workflow

The intended workflow combines these tools to systematically address a complex goal.

### Phase 1: Planning and Breakdown

```javascript
// 1. Create the main goal
const mainTask = await TaskTools.create({ 
  goal: "Refactor the database module for performance"
});

// 2. Break it down into subtasks
const subtasks = await TaskTools.breakdown(mainTask);

// 3. User can view the full plan in the To-Do List UI (Ctrl+T)
```

### Phase 2: Systematic Execution

```javascript
// 4. Get the first task to execute
let currentTask = await TaskTools.getNext();

while (currentTask) {
    // 5. Mark the task as "in progress"
    await TaskTools.update(currentTask.id, { status: 'in_progress' });

    // 6. --- Perform the actual work for the task ---
    // (e.g., use read_file, rewrite_file, etc.)
    
    // 7. Mark the task as "completed"
    await TaskTools.update(currentTask.id, { status: 'completed' });

    // 8. Get the next task
    currentTask = await TaskTools.getNext();
}

console.log("All tasks have been completed!");
```

### Phase 3: Adapting to New Information

If additional work is discovered during execution, the AI can add new tasks to the plan.

```javascript
// While working on a task, the AI discovers a new requirement
const newlyDiscoveredTask = await TaskTools.create({
    title: "Add error handling for database connection failures",
    parentId: mainTask.id, // Link it to the main goal
    priority: "high"
});
```

## 🚦 Best Practices

1.  **Start with a Goal:** For any complex request, first create a main goal task, then use `breakdown` to generate a plan.
2.  **Update Status Religiously:** Use `TaskTools.update` to keep the task status current. This is critical for progress tracking and dependency management.
3.  **Check for the Next Task:** Always use `TaskTools.getNext()` to determine what to work on next, rather than assuming the order.
4.  **Use the UI:** Encourage the user to check the To-Do List (`Ctrl+T`) to see the plan and monitor progress.