// Simple test runner script for the multi-stage research implementation
import { execute } from './js/tool_executor.js';
import { TaskTools } from './js/task_manager.js';

/**
 * Runs a test of the research functionality
 * @param {Object} options - Test options
 * @returns {Promise<Object>} Test results
 */
async function runTest(options = {}) {
  console.log('🧪 Running research test...');
  const query = options.query || 'What are the main architectural patterns in software engineering?';
  
  try {
    // Create a tool call for the test_research tool
    const toolCall = {
      name: 'test_research',
      args: {
        query: query
      }
    };
    
    console.log('Executing test_research tool...');
    const result = await execute(toolCall, null, false);
    
    console.log('✅ Test completed successfully!');
    
    // If cleanup after test is enabled
    if (options.cleanup !== false) {
      console.log('Cleaning up stale tasks...');
      await cleanupStaleTasks({
        threshold: options.cleanupThreshold || 10 * 60 * 1000 // 10 minutes by default for tests
      });
    }
    
    return result;
  } catch (error) {
    console.error('❌ Test failed:', error);
    return { error: error.message };
  }
}

/**
 * Cleans up stale tasks with a custom threshold for testing purposes
 * @param {Object} options - Cleanup options
 * @returns {Promise<void>}
 */
async function cleanupStaleTasks(options = {}) {
  try {
    // Temporarily update the cleanup configuration for immediate cleanup
    const threshold = options.threshold || 30 * 60 * 1000; // 30 minutes by default
    
    // Update cleanup config to use a much shorter threshold for test cleanup
    TaskTools.updateCleanupConfig({
      inactivityThreshold: threshold,
      action: options.action || 'complete'
    });
    
    // Trigger immediate cleanup
    await TaskTools.cleanupStale();
    
    // Reset to default settings
    TaskTools.updateCleanupConfig({
      inactivityThreshold: 24 * 60 * 60 * 1000, // Reset to 24 hours
      action: 'complete'
    });
    
    console.log(`Test cleanup completed. Tasks inactive for more than ${threshold/(60*1000)} minutes were processed.`);
  } catch (error) {
    console.error('Error during test cleanup:', error);
  }
}

// Create UI controls for test and cleanup
function setupUI() {
  const container = document.getElementById('test-controls');
  if (!container) return;
  
  // Add cleanup button
  const cleanupButton = document.createElement('button');
  cleanupButton.textContent = 'Clean Up Stale Tasks';
  cleanupButton.className = 'cleanup-btn';
  cleanupButton.onclick = () => {
    cleanupStaleTasks({ threshold: 5 * 60 * 1000 }); // 5 minutes for manual cleanup
  };
  
  // Add query input
  const queryInput = document.createElement('input');
  queryInput.type = 'text';
  queryInput.placeholder = 'Enter research query...';
  queryInput.value = 'What are the main architectural patterns in software engineering?';
  queryInput.className = 'query-input';
  
  // Add run button
  const runButton = document.createElement('button');
  runButton.textContent = 'Run Research Test';
  runButton.className = 'run-btn';
  runButton.onclick = () => {
    const query = queryInput.value.trim();
    if (query) {
      runTest({ query, cleanup: true });
    }
  };
  
  // Add elements to container
  container.appendChild(queryInput);
  container.appendChild(runButton);
  container.appendChild(cleanupButton);
}

// Initialize UI and run test
document.addEventListener('DOMContentLoaded', () => {
  setupUI();
  console.log('Test runner initialized. Use the interface to run tests.');
});

// Export for external use
export { runTest, cleanupStaleTasks };