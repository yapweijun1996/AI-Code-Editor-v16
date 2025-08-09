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