import { ToolRegistry } from '../tool_registry.js';
import { appendMessage } from '../ui.js';

async function _readUrl({ url, timeoutMs = 12000, retries = 3, backoffMs = 800, parentSignal = null }) {
    if (!url || typeof url !== 'string') {
        throw new Error('Failed to read URL: url must be a non-empty string');
    }

    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    for (let attempt = 1; attempt <= (retries + 1); attempt++) {
        const attemptController = new AbortController();
        const timeout = setTimeout(() => attemptController.abort(), timeoutMs);

        const handleParentAbort = () => {
            attemptController.abort();
        };

        if (parentSignal) {
            parentSignal.addEventListener('abort', handleParentAbort);
        }

        try {
            const response = await fetch('/api/read-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
                signal: attemptController.signal
            });

            clearTimeout(timeout);
            if (parentSignal) parentSignal.removeEventListener('abort', handleParentAbort);

            // Try to parse JSON safely; backend might return non-JSON on 500
            let payload;
            try {
                payload = await response.json();
            } catch (e) {
                const text = await response.text().catch(() => '');
                payload = { message: text || 'Non-JSON response from /api/read-url' };
            }

            if (response.ok) {
                return payload;
            }

            const message = payload?.message || `HTTP ${response.status} from /api/read-url`;
            throw new Error(message);
        } catch (err) {
            clearTimeout(timeout);
            if (parentSignal) parentSignal.removeEventListener('abort', handleParentAbort);

            const isLast = attempt === (retries + 1);
            const attemptInfo = `Attempt ${attempt}/${retries + 1}`;

            // AbortError or transient 5xx should be retried
            const errMsg = (err && err.message) ? err.message : String(err);
            const isAbort = err?.name === 'AbortError';
            const isTransient = /5\d\d/.test(errMsg) || /ECONNRESET|ENOTFOUND|EAI_AGAIN|timeout|NetworkError|Failed to fetch/i.test(errMsg);

            console.warn(`[read_url] ${attemptInfo} failed for ${url}: ${errMsg}${isAbort ? ' (timeout)' : ''}`);

            if (!isLast && (isAbort || isTransient)) {
                const wait = backoffMs * Math.pow(2, attempt - 1);
                await delay(wait);
                continue;
            }

            // Final failure
            throw new Error(`Failed to read URL after ${retries + 1} attempts: ${errMsg}`);
        }
    }
}

async function _duckduckgoSearch({ query, timeoutMs = 12000, retries = 2, backoffMs = 600, parentSignal = null }) {
    if (!query || typeof query !== 'string') {
        throw new Error('Failed to perform search: query must be a non-empty string');
    }

    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    for (let attempt = 1; attempt <= (retries + 1); attempt++) {
        const attemptController = new AbortController();
        const timeout = setTimeout(() => attemptController.abort(), timeoutMs);

        const handleParentAbort = () => {
            attemptController.abort();
        };

        if (parentSignal) {
            parentSignal.addEventListener('abort', handleParentAbort);
        }

        try {
            const response = await fetch('/api/duckduckgo-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query }),
                signal: attemptController.signal
            });

            clearTimeout(timeout);
            if (parentSignal) parentSignal.removeEventListener('abort', handleParentAbort);

            let payload;
            try {
                payload = await response.json();
            } catch (e) {
                const text = await response.text().catch(() => '');
                payload = { message: text || 'Non-JSON response from /api/duckduckgo-search' };
            }

            if (response.ok) {
                const resultCount = payload.results?.length || 0;
                console.log(`[duckduckgo_search] Success for "${query}". Results: ${resultCount}`);
                if (resultCount > 0) {
                    // Log a preview of the first few results for quick inspection
                    const preview = payload.results.slice(0, 3).map(r => ({ title: r.title, link: r.link }));
                    console.log(`[duckduckgo_search] Top results preview:`, preview);
                }
                return payload;
            }

            const message = payload?.message || `HTTP ${response.status} from /api/duckduckgo-search`;
            throw new Error(message);
        } catch (err) {
            clearTimeout(timeout);
            if (parentSignal) parentSignal.removeEventListener('abort', handleParentAbort);

            const isLast = attempt === (retries + 1);
            const errMsg = (err && err.message) ? err.message : String(err);
            const isAbort = err?.name === 'AbortError';
            const isTransient = /5\d\d/.test(errMsg) || /ECONNRESET|ENOTFOUND|EAI_AGAIN|timeout|NetworkError|Failed to fetch/i.test(errMsg);

            const reason = isAbort ? 'timeout' : 'transient_error';
            console.warn(`[duckduckgo_search] Attempt ${attempt}/${retries + 1} failed for "${query}": ${errMsg} (Reason: ${reason})`);

            if (!isLast && (isAbort || isTransient)) {
                const wait = backoffMs * Math.pow(2, attempt - 1);
                console.log(`[duckduckgo_search] Retrying in ${wait}ms...`);
                await delay(wait);
                continue;
            }

            throw new Error(`Failed to perform search after ${retries + 1} attempts: ${errMsg}`);
        }
    }
}

async function _performResearch(params) {
    // Parameter aliasing for flexibility (snake_case from tool def, camelCase from other callers)
    const {
        query,
        queries,
        max_results = params.maxResults || 3,
        depth = params.depth || 2,
        relevance_threshold = params.relevanceThreshold || 0.7,
        task_id = params.taskId || null,
        deadline_ms = params.deadline_ms || 45000, // Phase 2: Add deadline
        logger = params.logger || { log: () => {}, warn: () => {}, error: () => {} } // Phase 5: Headless-safe logger
    } = params;

    const researchController = new AbortController();
    const overallTimeout = setTimeout(() => researchController.abort(), deadline_ms);

    if (!query && (!queries || queries.length === 0)) {
        throw new Error("The 'query' or 'queries' parameter is required for perform_research.");
    }
    
    let taskTools = null;
    let stageTasks = {
        stage1: null,
        stage2: null,
        stage3: null,
        parent: task_id
    };
    
    if (task_id) {
        try {
            const { TaskTools } = await import('../task_manager.js');
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
        frontier: [], // Priority queue for URLs to visit: {url, title, snippet, query, relevanceScore, stage, depth}
        contentSummaries: [],
        knowledgeGaps: [],
        maxDepth: Math.min(depth, 3), // Keep depth reasonable
        maxResults: Math.min(max_results, 6),
        totalUrlsRead: 0,
        maxTotalUrls: 20,
        relevanceThreshold: Math.max(0.3, Math.min(relevance_threshold, 1.0)),
        parallelSearches: 3, // Unused for now, but planned for future enhancement
        concurrentReads: 1, // Force sequential reading for debugging
        stageOneComplete: false,
        stageTwoComplete: false,
        stageThreeComplete: false,
        taskId: task_id,
        stageTasks: stageTasks,
        taskTools: taskTools,
        failedUrlCount: 0
    };

    function extractKeywordsAndGenerateQueries(baseQuery, additionalQueries = [], maxQueries = 5) {
        console.log(`[Research Stage 1] Generating queries from base: "${baseQuery}"`);
        
        const cleanQuery = baseQuery.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
            
        const words = cleanQuery.split(' ');
        
        const stopwords = ['and', 'the', 'for', 'with', 'that', 'this', 'from', 'what', 'how', 'why', 'when', 'where', 'who'];
        const concepts = words.filter(word =>
            word.length > 3 && !stopwords.includes(word));
            
        researchState.keywordExtractions.push({
            source: 'original_query',
            query: baseQuery,
            extractedConcepts: concepts,
            timestamp: new Date().toISOString()
        });
        
        const searchQueries = [baseQuery, ...(additionalQueries || [])];
        
        if (concepts.length >= 2) {
            for (let i = 0; i < concepts.length - 1; i++) {
                for (let j = i + 1; j < concepts.length; j++) {
                    const focusedQuery = `${concepts[i]} ${concepts[j]} ${baseQuery.includes('how') || baseQuery.includes('what') ? baseQuery.split(' ').slice(0, 3).join(' ') : ''}`.trim();
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

    // Phase 3: Enhanced Scoring Logic
    function scoreUrlRelevance(url, title, snippet, searchQuery) {
        let score = 0.5;
        const lowerTitle = (title || '').toLowerCase();
        const lowerSnippet = (snippet || '').toLowerCase();
        const lowerUrl = (url || '').toLowerCase();
        const queryTerms = (searchQuery || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);

        // Domain authority
        const domainScores = { 'wikipedia.org': 0.2, 'github.com': 0.2, '.edu': 0.15, '.gov': 0.15, 'developer.mozilla.org': 0.2, 'stackoverflow.com': 0.15, 'w3.org': 0.15, 'medium.com': 0.05, 'dev.to': 0.1 };
        for (const [domain, boost] of Object.entries(domainScores)) {
            if (lowerUrl.includes(domain)) score += boost;
        }

        // Negative patterns
        const penaltyPatterns = [/ads\./, /tracker\./, /affiliate\./, /doubleclick\.net/, /analytics\./, /facebook\.com\/plugins/, /&utm_/];
        for (const pattern of penaltyPatterns) {
            if (pattern.test(lowerUrl)) score -= 0.4;
        }

        // Keyword matching
        let matches = 0;
        for (const term of queryTerms) {
            if (lowerTitle.includes(term)) matches += 1.5; // Title matches are strong signals
            if (lowerSnippet.includes(term)) matches += 1;
        }
        if (queryTerms.length > 0) {
            score += (matches / (queryTerms.length * 2.5)) * 0.4;
        }

        // Exact phrase match
        if (lowerTitle.includes(searchQuery) || lowerSnippet.includes(searchQuery)) {
            score += 0.15;
        }

        // Content type keywords
        const contentTypeScores = { 'tutorial': 0.1, 'guide': 0.1, 'documentation': 0.15, 'api': 0.1, 'reference': 0.1, 'examples': 0.05, 'blog': -0.05, 'news': -0.1, 'forum': -0.1 };
        for (const [type, boost] of Object.entries(contentTypeScores)) {
            if (lowerTitle.includes(type) || lowerUrl.includes(`/${type}/`)) score += boost;
        }

        // URL structure
        if (lowerUrl.includes('/docs/') || lowerUrl.includes('/documentation/')) score += 0.1;
        if (/\.(pdf|docx?)$/.test(lowerUrl)) score += 0.05;

        return Math.max(0, Math.min(1, score));
    }

    async function executeSequentialSearches(searchQueries) {
        console.log(`[Research Stage 1] Executing ${searchQueries.length} sequential searches`);
        const allSearchResults = [];

        for (let i = 0; i < searchQueries.length; i++) {
            const query = searchQueries[i];
            try {
                appendMessage(document.getElementById('chat-messages'),
                    `🔍 Search ${i + 1}/${searchQueries.length}: "${query}"`, 'ai');

                const results = await _duckduckgoSearch({ query, parentSignal: researchController.signal });

                researchState.searchHistory.push({
                    query,
                    stage: 1,
                    resultCount: results.results?.length || 0,
                    timestamp: new Date().toISOString()
                });

                if (!results.results || results.results.length === 0) {
                    console.log(`[Research Stage 1] No results for query: "${query}"`);
                    allSearchResults.push([]);
                    continue;
                }

                const mappedResults = results.results.map(result => ({
                    url: result.link,
                    title: result.title,
                    snippet: result.snippet,
                    query: query,
                    relevanceScore: scoreUrlRelevance(result.link, result.title, result.snippet, query),
                    stage: 1,
                    processed: false
                }));
                allSearchResults.push(mappedResults);

            } catch (error) {
                console.error(`[Research Stage 1] Search failed for "${query}":`, error.message);
                allSearchResults.push([]);
            }
        }
        
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
            appendMessage(document.getElementById('chat-messages'),
                `📖 Reading: ${urlInfo.title || urlInfo.url} (Stage ${stage})`, 'ai');
            
            const urlContent = await _readUrl({ url: urlInfo.url, parentSignal: researchController.signal });
            
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
            const contentPreview = (contentEntry.content || '').substring(0, 100).replace(/\s+/g, ' ').trim();
            console.log(`[Research Stage ${stage}] Successfully read content from ${urlInfo.url} | Preview: "${contentPreview}..."`);
            
            // Phase 1: Add discovered links to the frontier for recursive traversal
            if (contentEntry.links.length > 0 && urlInfo.depth < researchState.maxDepth) {
                const newUrlInfos = contentEntry.links.map(link => {
                    // Create a new searchQuery for relevance scoring based on anchor text if available
                    const syntheticQuery = link.text ? `${researchState.originalQuery} ${link.text}` : researchState.originalQuery;
                    return {
                        url: link.href,
                        title: link.text || 'Linked Page',
                        snippet: `Linked from: ${urlInfo.title}`,
                        query: syntheticQuery,
                        relevanceScore: scoreUrlRelevance(link.href, link.text || '', '', syntheticQuery),
                        stage: stage,
                        depth: urlInfo.depth + 1, // Increment depth
                        processed: false
                    };
                });

                // Add new, valid URLs to the frontier
                for (const newUrlInfo of newUrlInfos) {
                    if (shouldReadUrl(newUrlInfo, stage)) {
                        researchState.frontier.push(newUrlInfo);
                    }
                }
                // Sort frontier to prioritize most relevant links next
                researchState.frontier.sort((a, b) => b.relevanceScore - a.relevanceScore);
            }

            return contentEntry;
        } catch (error) {
            console.warn(`[Research Stage ${stage}] Failed to read URL ${urlInfo.url}:`, error.message);
            researchState.failedUrlCount++;
            
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
                appendMessage(document.getElementById('chat-messages'),
                    `🔍 Focused search: "${query}" (Stage 3)`, 'ai');
                
                const searchResults = await _duckduckgoSearch({ query, parentSignal: researchController.signal });
                
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
            // Phase 5: Use injected logger
            logger.log(`🚀 Starting multi-stage research for: "${query}"`);
            
            // --- Stage 1: Broad Search & Initial Reading ---
            logger.log(`🔬 Stage 1: Performing broad search and exploration (Depth: ${researchState.maxDepth})...`);
                
            const searchQueries = extractKeywordsAndGenerateQueries(query, queries);
            researchState.searchQueries = searchQueries;
            
            const initialUrls = await executeSequentialSearches(searchQueries);
            researchState.urlsByRelevance = initialUrls;

            // Seed the frontier with initial search results, adding depth info
            researchState.frontier = initialUrls.map(u => ({ ...u, depth: 1 }));

            // If no results are found, and the query looks like a username, add heuristic platform URLs
            if (researchState.frontier.length === 0 && /^[a-z0-9\-_]{4,24}$/i.test(query)) {
                logger.warn('[Research] No search results found. Applying heuristic platform fallback for potential username.');
                const platformTemplates = [
                    { url: `https://github.com/${query}`, title: `GitHub Profile: ${query}`, relevance: 0.95 },
                    { url: `https://www.linkedin.com/in/${query}`, title: `LinkedIn Profile: ${query}`, relevance: 0.90 },
                    { url: `https://x.com/${query}`, title: `X/Twitter Profile: ${query}`, relevance: 0.85 },
                    { url: `https://www.instagram.com/${query}`, title: `Instagram Profile: ${query}`, relevance: 0.80 },
                    { url: `https://dev.to/${query}`, title: `Dev.to Profile: ${query}`, relevance: 0.88 }
                ];

                const heuristicUrls = platformTemplates.map(p => ({
                    url: p.url,
                    title: p.title,
                    snippet: `Heuristically generated URL for likely username: ${query}`,
                    query: query,
                    relevanceScore: p.relevance,
                    stage: 1,
                    depth: 1,
                    processed: false
                }));

                researchState.frontier.push(...heuristicUrls);
                logger.log(`[Research] Added ${heuristicUrls.length} heuristic platform URLs to the frontier.`);
            }
            
            // Process the frontier until it's empty or limits are reached
            while (researchState.frontier.length > 0 && researchState.totalUrlsRead < researchState.maxTotalUrls) {
                if (researchController.signal.aborted) {
                    logger.warn('[Research] Deadline exceeded, stopping research.');
                    break;
                }
                const processingBatch = researchState.frontier.splice(0, researchState.concurrentReads);
                
                // Process one URL at a time for sequential debugging
                const urlInfo = processingBatch[0];
                if (urlInfo && shouldReadUrl(urlInfo, 1)) {
                    await processUrl(urlInfo, 1); // processUrl now adds new links to frontier
                }
            }
            
            researchState.stageOneComplete = true;
            console.log(`[Research] Stage 1 (Recursive Traversal) complete. Processed ${researchState.allContent.length} content items.`);
            
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
            
            logger.log(`🔬 Stage 2: Analyzing content and identifying knowledge gaps...`);
                
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
            
            logger.log(`🔬 Stage 3: Performing focused reading on knowledge gaps...`);
                
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
            
            logger.log(`✅ Research completed! Processed ${researchState.allContent.length} sources across 3 stages.`);
                
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
            
            const result = compileResults();
            // Explicitly log the final structured result to the console for debugging
            console.log('[perform_research][result]', result);
            try {
                // Also provide a compact JSON string for easy copy/paste
                console.log('[perform_research][result:json]', JSON.stringify(result, null, 2));
            } catch (_) { /* ignore circular refs */ }
            return result;
            
        } catch (error) {
            if (error.name === 'AbortError') {
                logger.warn(`[Research] Aborted due to timeout after ${deadline_ms}ms.`);
                // Return partial results if any content was gathered
                if (researchState.allContent.length > 0) {
                    const result = compileResults({ status: 'Degraded', reason: 'Timeout' });
                    // Log degraded result to console for easier debugging
                    console.warn('[perform_research][result:degraded:timeout]', result);
                    try {
                        console.warn('[perform_research][result:degraded:timeout:json]', JSON.stringify(result, null, 2));
                    } catch (_) { /* ignore circular refs */ }
                    return result;
                }
            }
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

    function compileResults({ status = 'Success', reason = null } = {}) {
        const successfulContent = researchState.allContent.filter(item => !item.error);
        const failedUrls = researchState.allContent.filter(item => item.error);

        // Phase 4: Dynamic Failure Threshold
        const totalAttempts = successfulContent.length + failedUrls.length;
        const failureRatio = totalAttempts > 0 ? failedUrls.length / totalAttempts : 0;
        // More lenient on small samples, stricter on larger ones.
        const dynamicThreshold = Math.min(0.6, 0.20 + 0.15 * Math.log10(Math.max(1, totalAttempts)));
        const qualityCompromised = failureRatio > dynamicThreshold;

        if (qualityCompromised && status !== 'Degraded') {
            throw new Error(`Research quality compromised: ${failedUrls.length} out of ${totalAttempts} URL reads failed (ratio ${failureRatio.toFixed(2)} > threshold ${dynamicThreshold.toFixed(2)}).`);
        }
        
        const stage1Content = successfulContent.filter(item => item.stage === 1);
        const stage3Content = successfulContent.filter(item => item.stage === 3);
        
        const uniqueDomains = new Set(researchState.references.map(url => {
            try { return new URL(url).hostname; } catch (e) { return 'unknown'; }
        }));

        const summary = `Research for "${researchState.originalQuery}" completed successfully.
- URLs visited: ${researchState.totalUrlsRead} (${successfulContent.length} successful, ${failedUrls.length} failed)
- Unique domains: ${uniqueDomains.size}
- Knowledge gaps identified: ${researchState.knowledgeGaps.length}`;

        successfulContent.sort((a, b) => b.relevanceScore - a.relevanceScore);
        
        const fullContent = successfulContent.map(item =>
            `--- START OF CONTENT FROM ${item.url} (Stage: ${item.stage}, Relevance: ${item.relevanceScore.toFixed(2)}) ---\nTitle: ${item.title}\nURL: ${item.url}\n\n${item.content}\n--- END OF CONTENT ---`
        ).join('\n\n');
        
        const sources = successfulContent.map(item => ({
            url: item.url,
            title: item.title,
            stage: item.stage,
            relevanceScore: item.relevanceScore,
            timestamp: item.timestamp
        }));

        return {
            status: qualityCompromised ? 'Degraded' : status,
            summary: summary,
            full_content: fullContent,
            references: researchState.references,
            // New structured results field for reliable downstream processing
            results: {
                sources: sources,
                summary: summary,
                stats: {
                    totalUrls: researchState.totalUrlsRead,
                    successfulRetrievals: successfulContent.length,
                    failedRetrievals: failedUrls.length,
                    uniqueDomains: uniqueDomains.size,
                    knowledgeGaps: researchState.knowledgeGaps.length,
                    failureRatio: failureRatio,
                    qualityThreshold: dynamicThreshold,
                    degradedReason: qualityCompromised ? 'High failure rate in URL reads' : reason
                },
                queries: {
                    initial: researchState.searchQueries,
                    gap: researchState.knowledgeGaps.map(g => `${researchState.originalQuery} ${g.keyword}`)
                }
            },
            metadata: { // Keep for backward compatibility
                totalUrls: researchState.totalUrlsRead,
                successfulRetrievals: successfulContent.length,
                failedRetrievals: failedUrls.length,
                searchHistory: researchState.searchHistory,
                knowledgeGaps: researchState.knowledgeGaps,
                uniqueDomains: uniqueDomains.size
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
            depth: { type: 'number', description: 'Maximum recursion depth for following links (1-3, default: 2)' },
            relevance_threshold: { type: 'number', description: 'Minimum relevance score to read URLs (0.3-1.0, default: 0.7). Lower = more URLs read' },
            deadline_ms: { type: 'number', description: 'Overall timeout in milliseconds for the entire research task (default: 45000)' }
        }
    });
}