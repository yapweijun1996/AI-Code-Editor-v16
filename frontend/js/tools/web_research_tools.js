import { ToolRegistry } from '../tool_registry.js';
import { UI } from '../ui.js';

async function _readUrl({ url }) {
    const response = await fetch('/api/read-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    const urlResult = await response.json();
    if (response.ok) {
        return urlResult;
    } else {
        throw new Error(urlResult.message || 'Failed to read URL');
    }
}

async function _duckduckgoSearch({ query }) {
    const response = await fetch('/api/duckduckgo-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const searchResult = await response.json();
    if (response.ok) {
        return searchResult;
    } else {
        throw new Error(searchResult.message || 'Failed to perform search');
    }
}

async function _performResearch({ query, max_results = 3, depth = 2, relevance_threshold = 0.7, task_id = null }) {
    if (!query) throw new Error("The 'query' parameter is required for perform_research.");
    
    let taskTools = null;
    let stageTasks = {
        stage1: null,
        stage2: null,
        stage3: null,
        parent: task_id
    };
    
    if (task_id) {
        try {
            const { TaskTools } = await import('./task_manager.js');
            taskTools = TaskTools;
            
            const parentTask = taskTools.getById(task_id);
            if (parentTask) {
                console.log(`[Research] Linked to parent task: ${parentTask.title} (ID: ${task_id})`);
                
                const subtasks = parentTask.subtasks
                    .map(id => taskTools.getById(id))
                    .filter(task => task !== undefined);
                
                for (const task of subtasks) {
                    if (task.tags?.includes('stage-1') || task.title?.includes('Stage 1')) {
                        stageTasks.stage1 = task.id;
                    } else if (task.tags?.includes('stage-2') || task.title?.includes('Stage 2')) {
                        stageTasks.stage2 = task.id;
                    } else if (task.tags?.includes('stage-3') || task.title?.includes('Stage 3')) {
                        stageTasks.stage3 = task.id;
                    }
                }
            }
        } catch (error) {
            console.warn(`[Research] Failed to get task information: ${error.message}`);
        }
    }

    const researchState = {
        originalQuery: query,
        visitedUrls: new Set(),
        allContent: [],
        references: [],
        searchHistory: [],
        searchQueries: [],
        urlsByRelevance: [],
        keywordExtractions: [],
        currentStage: 1,
        priorityQueue: [],
        contentSummaries: [],
        knowledgeGaps: [],
        maxDepth: Math.min(depth, 4),
        maxResults: Math.min(max_results, 6),
        totalUrlsRead: 0,
        maxTotalUrls: 20,
        relevanceThreshold: Math.max(0.3, Math.min(relevance_threshold, 1.0)),
        parallelSearches: 3,
        stageOneComplete: false,
        stageTwoComplete: false,
        stageThreeComplete: false,
        taskId: task_id,
        stageTasks: stageTasks,
        taskTools: taskTools
    };

    function extractKeywordsAndGenerateQueries(query, maxQueries = 5) {
        console.log(`[Research Stage 1] Extracting keywords from: "${query}"`);
        
        const cleanQuery = query.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
            
        const words = cleanQuery.split(' ');
        
        const stopwords = ['and', 'the', 'for', 'with', 'that', 'this', 'from', 'what', 'how', 'why', 'when', 'where', 'who'];
        const concepts = words.filter(word =>
            word.length > 3 && !stopwords.includes(word));
            
        researchState.keywordExtractions.push({
            source: 'original_query',
            query: query,
            extractedConcepts: concepts,
            timestamp: new Date().toISOString()
        });
        
        const searchQueries = [];
        
        searchQueries.push(query);
        
        if (concepts.length >= 2) {
            for (let i = 0; i < concepts.length - 1; i++) {
                for (let j = i + 1; j < concepts.length; j++) {
                    const focusedQuery = `${concepts[i]} ${concepts[j]} ${query.includes('how') || query.includes('what') ? query.split(' ').slice(0, 3).join(' ') : ''}`.trim();
                    searchQueries.push(focusedQuery);
                }
            }
        }
        
        const instructionalTerms = ['guide', 'tutorial', 'explained', 'overview'];
        const mainConcepts = concepts.slice(0, 3).join(' ');
        instructionalTerms.forEach(term => {
            searchQueries.push(`${mainConcepts} ${term}`);
        });
        
        const uniqueQueries = [...new Set(searchQueries)];
        const finalQueries = uniqueQueries.slice(0, maxQueries);
        
        console.log(`[Research Stage 1] Generated ${finalQueries.length} search queries:`, finalQueries);
        return finalQueries;
    }

    function scoreUrlRelevance(url, title, snippet, searchQuery) {
        let relevanceScore = 0.5;
        
        const domainScores = {
            'wikipedia.org': 0.30,
            '.edu': 0.25,
            '.gov': 0.25,
            'github.com': 0.20,
            'docs.': 0.20,
            'developer.': 0.20,
            'mozilla.org': 0.20,
            'w3.org': 0.20,
            'stackoverflow.com': 0.15,
            'ieee.org': 0.15,
            'acm.org': 0.15,
            'medium.com': 0.10,
            'research': 0.10,
            'ads.': -0.50,
            'tracker.': -0.50,
            'affiliate.': -0.40,
            'popup.': -0.40,
            'analytics.': -0.30
        };
        
        for (const [domain, score] of Object.entries(domainScores)) {
            if (url.includes(domain)) {
                relevanceScore += score;
                break;
            }
        }
        
        const queryTerms = searchQuery.toLowerCase().split(/\s+/);
        const contentText = `${title} ${snippet}`.toLowerCase();
        
        const termMatches = queryTerms.filter(term => contentText.includes(term)).length;
        relevanceScore += (termMatches / queryTerms.length) * 0.35;
        
        const contentTypeScores = {
            'tutorial': 0.15,
            'guide': 0.15,
            'documentation': 0.15,
            'explained': 0.10,
            'how to': 0.10,
            'introduction': 0.10,
            'overview': 0.10,
            'example': 0.10,
            'reference': 0.10
        };
        
        for (const [type, score] of Object.entries(contentTypeScores)) {
            if (title.toLowerCase().includes(type) || snippet.toLowerCase().includes(type)) {
                relevanceScore += score;
            }
        }
        
        const urlPathScores = {
            '/docs/': 0.15,
            '/tutorial/': 0.15,
            '/guide/': 0.15,
            '/learn/': 0.10,
            '/reference/': 0.10,
            '/examples/': 0.10,
            '/article/': 0.05
        };
        
        for (const [path, score] of Object.entries(urlPathScores)) {
            if (url.includes(path)) {
                relevanceScore += score;
                break;
            }
        }
        
        if (url.match(/\.(pdf|doc|docx)$/i)) {
            relevanceScore += 0.10;
        }
        
        relevanceScore = Math.max(0, Math.min(1, relevanceScore));
        
        return relevanceScore;
    }

    async function executeParallelSearches(searchQueries) {
        console.log(`[Research Stage 1] Executing ${searchQueries.length} parallel searches`);
        
        const searchPromises = searchQueries.map(async (query, index) => {
            try {
                UI.appendMessage(document.getElementById('chat-messages'),
                    `🔍 Search ${index + 1}/${searchQueries.length}: "${query}"`, 'ai');
                
                const results = await _duckduckgoSearch({ query });
                
                researchState.searchHistory.push({
                    query,
                    stage: 1,
                    resultCount: results.results?.length || 0,
                    timestamp: new Date().toISOString()
                });
                
                if (!results.results || results.results.length === 0) {
                    console.log(`[Research Stage 1] No results for query: "${query}"`);
                    return [];
                }
                
                return results.results.map(result => ({
                    url: result.link,
                    title: result.title,
                    snippet: result.snippet,
                    query: query,
                    relevanceScore: scoreUrlRelevance(result.link, result.title, result.snippet, query),
                    stage: 1,
                    processed: false
                }));
            } catch (error) {
                console.error(`[Research Stage 1] Search failed for "${query}":`, error.message);
                return [];
            }
        });
        
        const allSearchResults = await Promise.all(searchPromises);
        
        const flatResults = allSearchResults.flat();
        const uniqueResults = [];
        const seenUrls = new Set();
        
        flatResults.forEach(result => {
            if (!seenUrls.has(result.url)) {
                seenUrls.add(result.url);
                uniqueResults.push(result);
            }
        });
        
        uniqueResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
        
        console.log(`[Research Stage 1] Aggregated ${uniqueResults.length} unique URLs from all searches`);
        return uniqueResults;
    }

    function shouldReadUrl(urlInfo, stage) {
        if (researchState.visitedUrls.has(urlInfo.url)) return false;
        if (researchState.totalUrlsRead >= researchState.maxTotalUrls) return false;
        
        let stageThreshold = researchState.relevanceThreshold;
        
        if (stage === 1) {
            stageThreshold -= 0.2;
        } else if (stage === 3) {
            stageThreshold += 0.1;
        }
        
        const shouldRead = urlInfo.relevanceScore >= stageThreshold;
        
        console.log(`[Research Stage ${stage}] URL: ${urlInfo.url} | Score: ${urlInfo.relevanceScore.toFixed(2)} | Threshold: ${stageThreshold.toFixed(2)} | Read: ${shouldRead}`);
        
        return shouldRead;
    }

    async function processUrl(urlInfo, stage) {
        if (researchState.visitedUrls.has(urlInfo.url)) {
            return null;
        }
        
        researchState.visitedUrls.add(urlInfo.url);
        researchState.references.push(urlInfo.url);
        researchState.totalUrlsRead++;
        
        try {
            UI.appendMessage(document.getElementById('chat-messages'),
                `📖 Reading: ${urlInfo.title || urlInfo.url} (Stage ${stage})`, 'ai');
            
            const urlContent = await _readUrl({ url: urlInfo.url });
            
            if (!urlContent.content || !urlContent.content.trim()) {
                console.warn(`[Research Stage ${stage}] No content found for URL: ${urlInfo.url}`);
                return null;
            }
            
            const contentEntry = {
                url: urlInfo.url,
                title: urlInfo.title,
                snippet: urlInfo.snippet,
                content: urlContent.content,
                links: urlContent.links || [],
                stage: stage,
                relevanceScore: urlInfo.relevanceScore,
                timestamp: new Date().toISOString()
            };
            
            researchState.allContent.push(contentEntry);
            console.log(`[Research Stage ${stage}] Successfully read content from ${urlInfo.url}`);
            
            return contentEntry;
        } catch (error) {
            console.warn(`[Research Stage ${stage}] Failed to read URL ${urlInfo.url}:`, error.message);
            
            researchState.allContent.push({
                url: urlInfo.url,
                title: urlInfo.title,
                content: `Error reading content: ${error.message}`,
                links: [],
                stage: stage,
                error: true,
                timestamp: new Date().toISOString()
            });
            
            return null;
        }
    }

    function extractKeywordsFromContent(contentEntry) {
        if (!contentEntry || !contentEntry.content) return [];
        
        const content = contentEntry.content.toLowerCase();
        const words = content
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 3);
            
        const wordFreq = {};
        words.forEach(word => {
            wordFreq[word] = (wordFreq[word] || 0) + 1;
        });
        
        const queryTerms = researchState.originalQuery.toLowerCase().split(/\s+/);
        
        const frequentTerms = Object.entries(wordFreq)
            .filter(([word, freq]) =>
                freq >= 5 && !queryTerms.includes(word))
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([word]) => word);
            
        researchState.keywordExtractions.push({
            source: 'content',
            url: contentEntry.url,
            extractedKeywords: frequentTerms,
            timestamp: new Date().toISOString()
        });
        
        return frequentTerms;
    }

    function analyzeContentAndIdentifyGaps() {
        console.log(`[Research Stage 2] Analyzing ${researchState.allContent.length} content items from Stage 1`);
        
        const topicCoverage = {};
        const allKeywords = [];
        
        researchState.allContent
            .filter(item => !item.error && item.stage === 1)
            .forEach(item => {
                const keywords = extractKeywordsFromContent(item);
                allKeywords.push(...keywords);
                
                keywords.forEach(keyword => {
                    if (!topicCoverage[keyword]) {
                        topicCoverage[keyword] = [];
                    }
                    topicCoverage[keyword].push(item.url);
                });
            });
            
        const keywordFreq = {};
        allKeywords.forEach(keyword => {
            keywordFreq[keyword] = (keywordFreq[keyword] || 0) + 1;
        });
        
        const sortedKeywords = Object.entries(keywordFreq)
            .sort(([,a], [,b]) => b - a)
            .map(([keyword]) => keyword);
            
        const knowledgeGaps = [];
        sortedKeywords.slice(0, 10).forEach(keyword => {
            const coverage = topicCoverage[keyword] || [];
            if (coverage.length < 2) {
                knowledgeGaps.push({
                    keyword: keyword,
                    coverageCount: coverage.length,
                    sources: coverage
                });
            }
        });
        
        console.log(`[Research Stage 2] Identified ${knowledgeGaps.length} knowledge gaps:`,
            knowledgeGaps.map(gap => gap.keyword));
            
        researchState.knowledgeGaps = knowledgeGaps;
        
        const gapQueries = knowledgeGaps.map(gap => {
            const query = `${researchState.originalQuery} ${gap.keyword}`;
            return query;
        });
        
        return gapQueries;
    }

    async function performFocusedReading(gapQueries) {
        console.log(`[Research Stage 3] Performing focused reading for ${gapQueries.length} knowledge gaps`);
        
        for (const query of gapQueries) {
            try {
                UI.appendMessage(document.getElementById('chat-messages'),
                    `🔍 Focused search: "${query}" (Stage 3)`, 'ai');
                
                const searchResults = await _duckduckgoSearch({ query });
                
                researchState.searchHistory.push({
                    query,
                    stage: 3,
                    resultCount: searchResults.results?.length || 0,
                    timestamp: new Date().toISOString()
                });
                
                if (!searchResults.results || searchResults.results.length === 0) {
                    console.log(`[Research Stage 3] No results for gap query: "${query}"`);
                    continue;
                }
                
                const scoredResults = searchResults.results.map(result => ({
                    url: result.link,
                    title: result.title,
                    snippet: result.snippet,
                    query: query,
                    relevanceScore: scoreUrlRelevance(result.link, result.title, result.snippet, query),
                    stage: 3,
                    processed: false
                }));
                
                scoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
                const topResults = scoredResults.slice(0, 2);
                
                for (const urlInfo of topResults) {
                    if (researchState.totalUrlsRead >= researchState.maxTotalUrls) break;
                    
                    if (shouldReadUrl(urlInfo, 3)) {
                        await processUrl(urlInfo, 3);
                    }
                }
                
            } catch (error) {
                console.error(`[Research Stage 3] Search failed for gap query "${query}":`, error.message);
                continue;
            }
        }
    }

    async function executeResearch() {
        try {
            UI.appendMessage(document.getElementById('chat-messages'),
                `🚀 Starting multi-stage research for: "${query}"`, 'ai');
            
            UI.appendMessage(document.getElementById('chat-messages'),
                `🔬 Stage 1: Extracting key concepts and performing broad exploration...`, 'ai');
                
            const searchQueries = extractKeywordsAndGenerateQueries(query);
            researchState.searchQueries = searchQueries;
            
            const urlsByRelevance = await executeParallelSearches(searchQueries);
            researchState.urlsByRelevance = urlsByRelevance;
            
            const topUrlsForStage1 = urlsByRelevance.slice(0, Math.min(10, urlsByRelevance.length));
            
            for (const urlInfo of topUrlsForStage1) {
                if (researchState.totalUrlsRead >= researchState.maxTotalUrls / 2) break;
                
                if (shouldReadUrl(urlInfo, 1)) {
                    await processUrl(urlInfo, 1);
                }
            }
            
            researchState.stageOneComplete = true;
            console.log(`[Research] Stage 1 complete. Processed ${researchState.allContent.length} content items.`);
            
            if (researchState.taskTools && researchState.stageTasks.stage1) {
                await researchState.taskTools.update(researchState.stageTasks.stage1, {
                    status: 'completed',
                    completedTime: Date.now(),
                    notes: [{
                        id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        content: `Completed Stage 1: Processed ${researchState.allContent.length} content items from ${researchState.searchQueries.length} queries.`,
                        type: 'system',
                        timestamp: Date.now()
                    }]
                });
                
                if (researchState.stageTasks.stage2) {
                    await researchState.taskTools.update(researchState.stageTasks.stage2, {
                        status: 'in_progress',
                        startTime: Date.now()
                    });
                }
            }
            
            UI.appendMessage(document.getElementById('chat-messages'),
                `🔬 Stage 2: Analyzing content and identifying knowledge gaps...`, 'ai');
                
            const gapQueries = analyzeContentAndIdentifyGaps();
            
            researchState.stageTwoComplete = true;
            console.log(`[Research] Stage 2 complete. Identified ${gapQueries.length} knowledge gaps.`);
            
            if (researchState.taskTools && researchState.stageTasks.stage2) {
                await researchState.taskTools.update(researchState.stageTasks.stage2, {
                    status: 'completed',
                    completedTime: Date.now(),
                    notes: [{
                        id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        content: `Completed Stage 2: Identified ${gapQueries.length} knowledge gaps: ${researchState.knowledgeGaps.map(g => g.keyword).join(', ')}`,
                        type: 'system',
                        timestamp: Date.now()
                    }]
                });
                
                if (researchState.stageTasks.stage3) {
                    await researchState.taskTools.update(researchState.stageTasks.stage3, {
                        status: 'in_progress',
                        startTime: Date.now()
                    });
                }
            }
            
            UI.appendMessage(document.getElementById('chat-messages'),
                `🔬 Stage 3: Performing focused reading on knowledge gaps...`, 'ai');
                
            await performFocusedReading(gapQueries);
            
            researchState.stageThreeComplete = true;
            console.log(`[Research] Stage 3 complete. Final content count: ${researchState.allContent.length}.`);
            
            if (researchState.taskTools && researchState.stageTasks.stage3) {
                await researchState.taskTools.update(researchState.stageTasks.stage3, {
                    status: 'completed',
                    completedTime: Date.now(),
                    notes: [{
                        id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        content: `Completed Stage 3: Added ${researchState.stage3Sources || 0} focused sources. Total sources: ${researchState.allContent.length}.`,
                        type: 'system',
                        timestamp: Date.now()
                    }]
                });
            }
            
            UI.appendMessage(document.getElementById('chat-messages'),
                `✅ Research completed! Processed ${researchState.allContent.length} sources across 3 stages.`, 'ai');
                
            if (researchState.taskTools && researchState.taskId) {
                try {
                    const parentTask = researchState.taskTools.getById(researchState.taskId);
                    if (parentTask) {
                        await researchState.taskTools.update(researchState.taskId, {
                            status: 'completed',
                            completedTime: Date.now(),
                            notes: [{
                                id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                content: `Research complete! Processed ${researchState.allContent.length} sources across 3 stages.`,
                                type: 'system',
                                timestamp: Date.now()
                            }],
                            context: {
                                ...parentTask.context,
                                researchCompleted: true,
                                totalSources: researchState.allContent.length,
                                uniqueDomains: new Set(researchState.references.map(url => {
                                    try { return new URL(url).hostname; } catch (e) { return 'unknown'; }
                                })).size,
                                knowledgeGaps: researchState.knowledgeGaps.length
                            }
                        });
                    }
                } catch (taskError) {
                    console.warn(`[Research] Failed to update parent task: ${taskError.message}`);
                }
            }
            
            return compileResults();
            
        } catch (error) {
            console.error('[Research] Research process failed:', error);
            
            if (researchState.taskTools) {
                const markTaskFailed = async (taskId, errorMessage) => {
                    if (!taskId) return;
                    
                    const task = researchState.taskTools.getById(taskId);
                    if (task && task.status !== 'completed') {
                        await researchState.taskTools.update(taskId, {
                            status: 'failed',
                            completedTime: Date.now(),
                            notes: [{
                                id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                content: `Failed: ${errorMessage}`,
                                type: 'system',
                                timestamp: Date.now()
                            }]
                        });
                    }
                };
                
                try {
                    await markTaskFailed(researchState.stageTasks.stage1, error.message);
                    await markTaskFailed(researchState.stageTasks.stage2, error.message);
                    await markTaskFailed(researchState.stageTasks.stage3, error.message);
                    
                    if (researchState.taskId) {
                        const parentTask = researchState.taskTools.getById(researchState.taskId);
                        if (parentTask && parentTask.status !== 'completed') {
                            await researchState.taskTools.update(researchState.taskId, {
                                status: 'failed',
                                completedTime: Date.now(),
                                notes: [{
                                    id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                    content: `Research failed: ${error.message}`,
                                    type: 'system',
                                    timestamp: Date.now()
                                }]
                            });
                        }
                    }
                } catch (taskError) {
                    console.warn(`[Research] Failed to update task statuses: ${taskError.message}`);
                }
            }
            
            throw new Error(`Research failed: ${error.message}`);
        }
    }

    function compileResults() {
        const successfulContent = researchState.allContent.filter(item => !item.error);
        const failedUrls = researchState.allContent.filter(item => item.error);
        
        const stage1Content = successfulContent.filter(item => item.stage === 1);
        const stage3Content = successfulContent.filter(item => item.stage === 3);
        
        const summary = `Research for "${query}" completed successfully using multi-stage approach.
        
        📊 Research Statistics:
- Total URLs visited: ${researchState.totalUrlsRead}
- Successful content retrievals: ${successfulContent.length}
- Failed retrievals: ${failedUrls.length}
- Stage 1 (Broad exploration): ${stage1Content.length} sources
- Stage 3 (Focused reading): ${stage3Content.length} sources
- Unique domains explored: ${new Set(researchState.references.map(url => {
            try { return new URL(url).hostname; } catch (e) { return 'unknown'; }
        })).size}
- Search queries performed: ${researchState.searchHistory.length}
- Knowledge gaps identified: ${researchState.knowledgeGaps.length}

The multi-stage research approach first gathered broad information, then identified knowledge gaps, and finally performed focused research to fill those gaps.`;

        successfulContent.sort((a, b) => b.relevanceScore - a.relevanceScore);
        
        const fullContent = successfulContent.map(item =>
            `--- START OF CONTENT FROM ${item.url} (Stage: ${item.stage}, Relevance: ${item.relevanceScore.toFixed(2)}) ---
Title: ${item.title}
URL: ${item.url}
Retrieved: ${item.timestamp}

${item.content}

--- END OF CONTENT ---`
        ).join('\n\n');
        
        return {
            summary: summary,
            full_content: fullContent,
            references: researchState.references,
            metadata: {
                totalUrls: researchState.totalUrlsRead,
                successfulRetrievals: successfulContent.length,
                failedRetrievals: failedUrls.length,
                searchHistory: researchState.searchHistory,
                knowledgeGaps: researchState.knowledgeGaps,
                uniqueDomains: new Set(researchState.references.map(url => {
                    try { return new URL(url).hostname; } catch (e) { return 'unknown'; }
                })).size
            }
        };
    }

    return executeResearch();
}

export function registerWebResearchTools() {
    ToolRegistry.register('read_url', {
        handler: _readUrl,
        requiresProject: false,
        createsCheckpoint: false,
        description: 'Reads and extracts the main content and all links from a given URL. The result will be a JSON object with "content" and "links" properties.',
        parameters: { url: { type: 'string', required: true } }
    });

    ToolRegistry.register('duckduckgo_search', {
        handler: _duckduckgoSearch,
        requiresProject: false,
        createsCheckpoint: false,
        description: 'Performs a search using DuckDuckGo and returns the results.',
        parameters: { query: { type: 'string', required: true } }
    });

    ToolRegistry.register('perform_research', {
        handler: _performResearch,
        requiresProject: false,
        createsCheckpoint: false,
        description: '🔬 ENHANCED: Performs intelligent, recursive web research with AI-driven decision making. Automatically searches, analyzes content relevance, follows promising links, and expands searches based on discovered information. Much more comprehensive than simple search.',
        parameters: {
            query: { type: 'string', required: true, description: 'The research query or topic to investigate' },
            max_results: { type: 'number', description: 'Maximum URLs to read per search (1-5, default: 3)' },
            depth: { type: 'number', description: 'Maximum recursion depth for following links (1-4, default: 2)' },
            relevance_threshold: { type: 'number', description: 'Minimum relevance score to read URLs (0.3-1.0, default: 0.7). Lower = more URLs read' }
        }
    });
}