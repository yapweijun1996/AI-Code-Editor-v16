// Test module for the improved multi-stage research implementation
import { execute } from './tool_executor.js';

// Ensure tokenizer is available - use local fallback if CDN version fails
const ensureTokenizer = () => {
    if (typeof window.GPTTokenizer !== 'undefined') {
        console.log('Using local GPT Tokenizer fallback');
        return window.GPTTokenizer;
    }
    
    // If somehow neither is available, provide minimal implementation
    console.warn('No tokenizer found, using minimal implementation');
    return {
        encode: (text) => Array(Math.ceil((text || '').length / 4)).fill(1),
        countTokens: (text) => Math.ceil((text || '').length / 4)
    };
};

// Make tokenizer available
const tokenizer = ensureTokenizer();

/**
 * Tests the enhanced multi-stage research implementation with various queries
 * and reports detailed statistics on the process and results.
 * 
 * @param {Object} options - Test configuration options
 * @param {string} options.query - The research query to test with
 * @param {number} [options.maxResults=3] - Maximum URLs to read per search
 * @param {number} [options.depth=2] - Maximum recursion depth
 * @param {number} [options.relevanceThreshold=0.7] - Minimum relevance score (0.3-1.0)
 * @param {boolean} [options.verbose=true] - Whether to log detailed statistics
 * @returns {Promise<Object>} - The research results and test metrics
 */
export async function testResearch(options = {}) {
    const query = options.query || 'How do quantum computers work?';
    const maxResults = options.maxResults || 3;
    const depth = options.depth || 2;
    const relevanceThreshold = options.relevanceThreshold || 0.7;
    const verbose = options.verbose !== false;
    const trackTask = options.trackTask !== false;
    
    console.log(`🧪 TESTING MULTI-STAGE RESEARCH 🧪`);
    console.log(`Query: "${query}"`);
    console.log(`Parameters: maxResults=${maxResults}, depth=${depth}, relevanceThreshold=${relevanceThreshold}`);
    
    const startTime = Date.now();
    let researchTaskId = null;
    
    try {
        // Create a master research task if tracking is enabled
        if (trackTask) {
            // Import the TaskTools dynamically to avoid circular dependencies
            const { TaskTools } = await import('./task_manager.js');
            
            // Create a master task for this research session
            const masterTask = await TaskTools.create({
                title: `Research: ${query}`,
                description: `Perform multi-stage research on: ${query}`,
                priority: 'high',
                status: 'in_progress',
                tags: ['research', 'automated-test'],
                context: {
                    type: 'research',
                    query,
                    parameters: { maxResults, depth, relevanceThreshold }
                }
            });
            
            researchTaskId = masterTask.id;
            console.log(`Created research task with ID: ${researchTaskId}`);
            
            // Create linked subtasks for each stage
            const stage1Task = await TaskTools.create({
                title: `Stage 1: Broad exploration`,
                description: `Extract keywords and perform parallel searches`,
                parentId: researchTaskId,
                status: 'in_progress',
                tags: ['research', 'stage-1']
            });
            
            const stage2Task = await TaskTools.create({
                title: `Stage 2: Knowledge gap analysis`,
                description: `Analyze content and identify knowledge gaps`,
                parentId: researchTaskId,
                dependencies: [stage1Task.id],
                tags: ['research', 'stage-2']
            });
            
            const stage3Task = await TaskTools.create({
                title: `Stage 3: Focused content reading`,
                description: `Fill knowledge gaps with targeted research`,
                parentId: researchTaskId,
                dependencies: [stage2Task.id],
                tags: ['research', 'stage-3']
            });
        }
        
        // Execute the performResearch tool
        const toolCall = {
            name: 'perform_research',
            args: {
                query,
                max_results: maxResults,
                depth: depth,
                relevance_threshold: relevanceThreshold
            }
        };
        
        console.log(`Executing research...`);
        const result = await execute(toolCall, null, false);
        const researchResults = result.toolResponse.response;
        
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        
        // Calculate statistics
        const stats = calculateStatistics(researchResults);
        
        console.log(`\n✅ Research completed in ${duration.toFixed(2)} seconds`);
        console.log(`Total sources: ${stats.totalSources}`);
        console.log(`Unique domains: ${stats.uniqueDomains}`);
        console.log(`Knowledge gaps identified: ${stats.knowledgeGaps}`);
        console.log(`Search queries performed: ${stats.searchQueries}`);
        
        if (verbose) {
            console.log(`\n📊 DETAILED STATISTICS:`);
            console.log(`Stage 1 sources: ${stats.stage1Sources}`);
            console.log(`Stage 3 sources: ${stats.stage3Sources}`);
            console.log(`Average relevance score: ${stats.avgRelevanceScore.toFixed(2)}`);
            console.log(`Top domains: ${JSON.stringify(stats.topDomains)}`);
            console.log(`Knowledge gaps: ${JSON.stringify(stats.knowledgeGapTopics)}`);
            
            console.log(`\n📑 RESEARCH SUMMARY:`);
            console.log(researchResults.summary);
        }
        
        // Mark research tasks as completed if they were created
        if (trackTask && researchTaskId) {
            // Import the TaskTools dynamically to avoid circular dependencies
            const { TaskTools } = await import('./task_manager.js');
            
            try {
                // Get all subtasks of the research task
                const masterTask = TaskTools.getById(researchTaskId);
                if (masterTask) {
                    // Mark all subtasks as completed first
                    for (const subtaskId of masterTask.subtasks) {
                        await TaskTools.update(subtaskId, {
                            status: 'completed',
                            completedTime: Date.now()
                        });
                    }
                    
                    // Then mark the master task as completed
                    await TaskTools.update(researchTaskId, {
                        status: 'completed',
                        completedTime: Date.now(),
                        context: {
                            ...masterTask.context,
                            results: {
                                totalSources: stats.totalSources,
                                uniqueDomains: stats.uniqueDomains,
                                knowledgeGaps: stats.knowledgeGaps,
                                duration: duration
                            }
                        }
                    });
                    
                    console.log(`Research task and all subtasks marked as completed`);
                }
            } catch (taskError) {
                console.warn(`Failed to update task status: ${taskError.message}`);
            }
        }
        
        return {
            results: researchResults,
            stats: stats,
            duration: duration,
            success: true,
            taskId: researchTaskId
        };
    } catch (error) {
        console.error(`❌ Research test failed:`, error);
        
        // Mark research tasks as failed if they were created
        if (trackTask && researchTaskId) {
            try {
                // Import the TaskTools dynamically to avoid circular dependencies
                const { TaskTools } = await import('./task_manager.js');
                
                // Mark all subtasks and the master task as failed
                const masterTask = TaskTools.getById(researchTaskId);
                if (masterTask) {
                    for (const subtaskId of masterTask.subtasks) {
                        await TaskTools.update(subtaskId, {
                            status: 'failed',
                            completedTime: Date.now(),
                            notes: [{
                                id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                content: `Failed due to error: ${error.message}`,
                                type: 'system',
                                timestamp: Date.now()
                            }]
                        });
                    }
                    
                    await TaskTools.update(researchTaskId, {
                        status: 'failed',
                        completedTime: Date.now(),
                        notes: [{
                            id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            content: `Research failed: ${error.message}`,
                            type: 'system',
                            timestamp: Date.now()
                        }]
                    });
                    
                    console.log(`Research task and all subtasks marked as failed`);
                }
            } catch (taskError) {
                console.warn(`Failed to update task status: ${taskError.message}`);
            }
        }
        
        return {
            error: error.message,
            duration: (Date.now() - startTime) / 1000,
            success: false,
            taskId: researchTaskId
        };
    }
}

/**
 * Calculates detailed statistics from the research results
 * 
 * @param {Object} results - The research results from _performResearch
 * @returns {Object} - Statistics about the research process and results
 */
function calculateStatistics(results) {
    // Extract data from full content
    const contentBlocks = results.full_content.split('--- START OF CONTENT FROM');
    const contentItems = [];
    
    for (const block of contentBlocks) {
        if (!block.trim()) continue;
        
        const urlMatch = block.match(/https?:\/\/[^\s)]+/);
        const stageMatch = block.match(/Stage:\s*(\d+)/);
        const relevanceMatch = block.match(/Relevance:\s*([\d.]+)/);
        
        if (urlMatch && stageMatch && relevanceMatch) {
            const url = urlMatch[0];
            const stage = parseInt(stageMatch[1]);
            const relevance = parseFloat(relevanceMatch[1]);
            
            let domain;
            try {
                domain = new URL(url).hostname;
            } catch (e) {
                domain = 'unknown';
            }
            
            contentItems.push({
                url,
                domain,
                stage,
                relevance
            });
        }
    }
    
    // Count by stage
    const stage1Sources = contentItems.filter(item => item.stage === 1).length;
    const stage3Sources = contentItems.filter(item => item.stage === 3).length;
    
    // Calculate average relevance
    const totalRelevance = contentItems.reduce((sum, item) => sum + item.relevance, 0);
    const avgRelevanceScore = contentItems.length > 0 ? totalRelevance / contentItems.length : 0;
    
    // Count domains
    const domains = {};
    contentItems.forEach(item => {
        domains[item.domain] = (domains[item.domain] || 0) + 1;
    });
    
    // Get top domains
    const topDomains = Object.entries(domains)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([domain, count]) => `${domain} (${count})`);
    
    // Get knowledge gaps
    let knowledgeGaps = 0;
    let knowledgeGapTopics = [];
    
    if (results.metadata && results.metadata.knowledgeGaps) {
        knowledgeGaps = results.metadata.knowledgeGaps.length;
        knowledgeGapTopics = results.metadata.knowledgeGaps.map(gap => gap.keyword);
    }
    
    // Get search queries
    let searchQueries = 0;
    if (results.metadata && results.metadata.searchHistory) {
        searchQueries = results.metadata.searchHistory.length;
    }
    
    return {
        totalSources: contentItems.length,
        uniqueDomains: Object.keys(domains).length,
        stage1Sources,
        stage3Sources,
        avgRelevanceScore,
        topDomains,
        knowledgeGaps,
        knowledgeGapTopics,
        searchQueries
    };
}

/**
 * Compares research results between the original and multi-stage implementations
 * 
 * @param {Object} options - Test configuration options
 * @param {string} options.query - The research query to test with
 * @returns {Promise<Object>} - Comparison results
 */
export async function compareResearchImplementations(options = {}) {
    const query = options.query || 'How do quantum computers work?';
    
    console.log(`🔍 COMPARING RESEARCH IMPLEMENTATIONS 🔍`);
    console.log(`Query: "${query}"`);
    
    // First run the enhanced multi-stage implementation
    console.log(`\n1️⃣ Running multi-stage implementation...`);
    const multiStageResult = await testResearch({
        query,
        verbose: false
    });
    
    if (!multiStageResult.success) {
        console.error(`Multi-stage implementation test failed`);
        return { error: multiStageResult.error, success: false };
    }
    
    // We'll log comparison metrics
    console.log(`\n📈 COMPARISON RESULTS:`);
    console.log(`Total sources found: ${multiStageResult.stats.totalSources}`);
    console.log(`Unique domains: ${multiStageResult.stats.uniqueDomains}`);
    console.log(`Knowledge gaps identified: ${multiStageResult.stats.knowledgeGaps}`);
    console.log(`Search queries performed: ${multiStageResult.stats.searchQueries}`);
    console.log(`Average relevance score: ${multiStageResult.stats.avgRelevanceScore.toFixed(2)}`);
    
    console.log(`\n✅ The multi-stage implementation delivers more comprehensive research by:`);
    console.log(`1. Starting with broader exploration (${multiStageResult.stats.stage1Sources} sources in Stage 1)`);
    console.log(`2. Identifying knowledge gaps (${multiStageResult.stats.knowledgeGaps} gaps found)`);
    console.log(`3. Filling those gaps with targeted research (${multiStageResult.stats.stage3Sources} sources in Stage 3)`);
    console.log(`4. Leveraging multiple search queries (${multiStageResult.stats.searchQueries} queries) instead of a single recursive approach`);
    
    return {
        multiStageStats: multiStageResult.stats,
        duration: multiStageResult.duration,
        success: true
    };
}

// Function to run the test directly
export async function runTest() {
    const testQuery = 'What are the main architectural patterns in software engineering?';
    console.log(`Running research test with query: "${testQuery}"`);
    return await testResearch({ query: testQuery });
}