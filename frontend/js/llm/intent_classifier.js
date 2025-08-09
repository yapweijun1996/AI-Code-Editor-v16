/**
 * IntentClassifier
 * - Extracted from ChatService._classifyMessageIntent
 * - Single-turn classification with no tools; returns one of: DIRECT | TASK | TOOL (string with optional reason text)
 *
 * Usage:
 *   const result = await IntentClassifier.classify({
 *     llmFacade,
 *     userPrompt,
 *     conversationContext,
 *     history
 *   });
 */

export const IntentClassifier = {
  /**
   * Classify the user's intent.
   * @param {object} params
   * @param {import('./llm_facade.js').LLMFacade} params.llmFacade - Required: facade to send prompt
   * @param {string} params.userPrompt - Required: the user's latest message
   * @param {string} params.conversationContext - Optional: short recent history string
   * @param {Array} params.history - Optional: prior structured conversation history (no system turn needed)
   * @returns {Promise<string>} e.g., "DIRECT|TASK|TOOL\nReason: ..."
   */
  async classify({ llmFacade, userPrompt, conversationContext = '', history = [] }) {
    if (!llmFacade) {
      throw new Error('IntentClassifier requires llmFacade');
    }
    const prompt = buildClassificationPrompt(userPrompt, conversationContext);
    // Single-turn, no tools; Facade ensures system turn
    return await llmFacade.sendPrompt(prompt, {
      history,
      tools: null,
      mode: 'code',
      customRules: '',
      abortSignal: null
    });
  }
};

function buildClassificationPrompt(userPrompt, conversationContext) {
  return `
Analyze the user's message and classify its primary intent into ONE of the following categories.

**Conversation Context:**
${conversationContext || 'No recent conversation.'}

**User Message:** "${userPrompt}"

---
**Classification Categories & Rules:**

1.  **DIRECT**: The user wants the AI to analyze, explain, review, or answer something. The primary action is AI thought, which may require using tools to gather information first.
    *   **Examples**: "review file.js", "explain this code", "what does this function do?", "how does this work?", "fix this error"
    *   **Keywords**: review, explain, what, how, why, fix, analyze

2.  **TOOL**: The user wants to directly execute a specific tool and see the raw output. The primary action is running a tool, not AI analysis.
    *   **Examples**: "read file.js", "list all files in src/", "search for 'API_KEY'", "get_project_structure"
    *   **Keywords**: read, list, search, get, run tool

3.  **TASK**: The user wants to perform a complex, multi-step operation that requires planning and execution of several actions.
    *   **Examples**: "create a login system", "refactor the database module", "implement user authentication", "build a new component"
    *   **Keywords**: create, build, implement, refactor, design, develop, system, feature

---
**Your Response:**

Provide the classification and a brief reason.

Response format: DIRECT|TASK|TOOL
Reason: [brief explanation]
`.trim();
}
/**
 * Multi-label intent classification with scores and robust fallback.
 * Adds IntentClassifier.classifyMulti(...) without breaking existing classify(...).
 *
 * Returns shape:
 * {
 *   primary: "DIRECT" | "TASK" | "TOOL",
 *   intents: [{ label: string, score: number }],
 *   reason: string
 * }
 */
IntentClassifier.classifyMulti = async function({ llmFacade, userPrompt, conversationContext = '', history = [] }) {
  if (!llmFacade) throw new Error('IntentClassifier requires llmFacade');

  // 1) Try LLM-driven multi-label classification
  let parsed = null;
  try {
    const prompt = buildMultiIntentPrompt(userPrompt, conversationContext);
    const text = await llmFacade.sendPrompt(prompt, {
      history,
      tools: null,
      mode: 'plan',
      customRules: '',
      abortSignal: null
    });
    parsed = safeParseJson(text);
  } catch (_) {
    parsed = null;
  }

  // 2) Validate and/or fallback to rules
  if (!isValidMultiIntent(parsed)) {
    parsed = ruleBasedMultiIntent(userPrompt);
  }

  // 3) Final normalization
  return normalizeMultiIntent(parsed);
};

function buildMultiIntentPrompt(userPrompt, conversationContext) {
  return `
You are a classifier for developer assistant prompts. Identify ALL applicable intents and assign a confidence score 0-1.

Conversation Context:
${conversationContext || 'No recent conversation.'}

User Message: "${userPrompt}"

Candidate intent labels (choose any that apply):
- setup_tailwind: Add or configure TailwindCSS (prefer CDN bootstrap if not installed).
- create_js_files: Create or scaffold multiple JavaScript files/modules.
- generate_ideas: Produce concrete improvement ideas or plans.
- modify_files: Edit existing files (content changes, injections).
- search_codebase: Read/list/search repository files to gather context.
- answer_question: Provide a direct explanation or analysis response.
- run_tool: Execute a specific tool and return raw output.
- bug_fix: Fix a bug or error in code or tooling.
- refactor: Restructure or optimize existing code.
- write_tests: Add or update automated tests.

Output strictly as minified JSON only (no commentary):
{
  "primary": "DIRECT|TASK|TOOL",
  "intents": [ { "label": "setup_tailwind", "score": 0.92 }, { "label": "create_js_files", "score": 0.81 } ],
  "reason": "brief justification"
}
`.trim();
}

function safeParseJson(text) {
  if (!text || typeof text !== 'string') return null;
  // Try direct parse
  try {
    return JSON.parse(text);
  } catch (_) {}
  // Try fenced code block
  const codeBlock = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (codeBlock && codeBlock[1]) {
    try { return JSON.parse(codeBlock[1]); } catch (_) {}
  }
  // Try to extract first {...} block
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch (_) {}
  }
  return null;
}

function isValidMultiIntent(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (!obj.primary || !/^(DIRECT|TASK|TOOL)$/.test(String(obj.primary))) return false;
  if (!Array.isArray(obj.intents)) return false;
  if (obj.intents.length === 0) return false;
  return obj.intents.every(it => it && typeof it.label === 'string' && typeof it.score === 'number');
}

function ruleBasedMultiIntent(userPrompt = '') {
  const text = String(userPrompt || '').toLowerCase();
  const intents = [];

  const add = (label, score = 0.8) => {
    if (!intents.find(i => i.label === label)) intents.push({ label, score });
  };

  if (text.includes('tailwind')) add('setup_tailwind', 0.9);
  if (text.includes('idea') || text.includes('improve') || text.includes('suggestion') || text.includes('list')) add('generate_ideas', 0.85);
  if (text.includes('several .js') || text.includes('multiple js') || text.includes('many js') || text.includes('create js') || text.includes('scaffold')) add('create_js_files', 0.8);
  if (text.includes('read') || text.includes('list files') || text.includes('search')) add('search_codebase', 0.6);
  if (text.includes('fix') || text.includes('bug') || text.includes('error')) add('bug_fix', 0.6);
  if (text.includes('refactor') || text.includes('optimiz')) add('refactor', 0.6);
  if (text.includes('test')) add('write_tests', 0.5);

  // Heuristic primary: if multiple build/modify actions then TASK; if primarily ask/explain then DIRECT; if explicit "read/list/search" then TOOL
  let primary = 'TASK';
  if (intents.length === 0) {
    add('answer_question', 0.5);
    primary = 'DIRECT';
  } else if (intents.length === 1 && intents[0].label === 'answer_question') {
    primary = 'DIRECT';
  } else if (intents.find(i => i.label === 'search_codebase' || i.label === 'run_tool') && intents.length <= 2) {
    primary = 'TOOL';
  }

  const reason = 'Rule-based fallback classification';
  return { primary, intents, reason };
}

function normalizeMultiIntent(obj) {
  const intentsMap = new Map();
  for (const it of obj.intents) {
    const label = String(it.label || '').trim();
    if (!label) continue;
    const score = Number.isFinite(it.score) ? Math.max(0, Math.min(1, it.score)) : 0.5;
    if (!intentsMap.has(label) || intentsMap.get(label) < score) intentsMap.set(label, score);
  }
  const intents = [...intentsMap.entries()].map(([label, score]) => ({ label, score }))
    .sort((a, b) => b.score - a.score);

  const primary = /^(DIRECT|TASK|TOOL)$/.test(obj.primary)
    ? obj.primary
    : (intents.some(i => ['setup_tailwind','create_js_files','modify_files','bug_fix','refactor','write_tests'].includes(i.label)) ? 'TASK' : 'DIRECT');

  const reason = String(obj.reason || '').trim() || 'Multi-intent classification complete';
  return { primary, intents, reason };
}