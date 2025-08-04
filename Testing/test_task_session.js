// Test script for task session functionality
import { taskManager, TaskTools } from './frontend/js/task_manager.js';

async function testTaskSession() {
    try {
        console.log('Initializing task manager...');
        await taskManager.initialize();
        
        // 1. Create a test task
        console.log('Creating test task...');
        const task = await TaskTools.create({
            title: 'Test Task for Session',
            description: 'This task is created to test the start_task_session functionality',
            priority: 'medium'
        });
        console.log(`Task created with ID: ${task.id}`);
        
        // 2. Start a session for the task
        console.log('Starting task session...');
        const session = await TaskTools.startSession(task.id, {
            description: 'Test session',
            duration: 30 // 30 minutes
        });
        console.log('Session started:', session);
        
        // 3. Verify the task has been updated to in_progress
        const updatedTask = TaskTools.getById(task.id);
        console.log('Updated task status:', updatedTask.status);
        console.log('Task has session data:', !!updatedTask.context.sessions);
        
        if (updatedTask.status === 'in_progress' && updatedTask.context.sessions) {
            console.log('✅ TEST PASSED: Task session functionality works correctly');
        } else {
            console.error('❌ TEST FAILED: Task session did not update task properly');
        }
        
        // 4. Clean up test task
        await TaskTools.delete(task.id);
        console.log('Test task deleted');
        
    } catch (error) {
        console.error('Test failed with error:', error);
    }
}

testTaskSession();