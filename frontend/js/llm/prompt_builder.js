/**
 * Provider-agnostic PromptBuilder
 * Produces a single, unified system prompt for all providers based on mode and optional custom rules.
 * Consumers should insert this as a "system" message at the beginning of the conversation history:
 * { role: 'system', parts: [{ text: systemPrompt }] }
 */
export const PromptBuilder = {
  /**
   * Build a prompt pack
   * @param {('code'|'plan'|'search')} mode
   * @param {string} customRules
   * @param {object} context - Optional contextual hints (e.g., repo name, project type)
   * @returns {{ systemPrompt: string, messages: Array, modelParams: object }}
   */
  build(mode = 'code', customRules = '', context = {}) {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeString = new Date().toLocaleString();

    const baseHeader = `You are an AI assistant helping with code development and analysis. Be precise, concise, and correct. Prefer incremental, testable changes.`;

    const modeBlocks = {
      code: [
        '# Mode: CODE',
        '- Focus on code analysis, generation, and debugging.',
        '- Provide working, idiomatic code with brief rationale.',
        '- When modifying files, explain the intent and scope.',
        '- Think step-by-step but keep output compact.'
      ].join('\n'),
      plan: [
        '# Mode: PLAN',
        '- Break complex goals into actionable steps.',
        '- Identify risks, dependencies, and acceptance criteria.',
        '- Provide a phased plan with measurable milestones.'
      ].join('\n'),
      search: [
        '# Mode: SEARCH',
        '- Explore the codebase and documentation to answer questions.',
        '- Cite exact files and line numbers where possible.',
        '- Synthesize findings into clear, actionable insights.'
      ].join('\n')
    };

    const contextBlock = this._formatContext(context);

    let systemPrompt = [
      baseHeader,
      '',
      modeBlocks[mode] || modeBlocks.code,
      contextBlock ? `\n# Context\n${contextBlock}` : '',
      `\n# Session\n- Time: ${timeString}\n- Timezone: ${timeZone}`
    ].join('\n');

    if (customRules && customRules.trim()) {
      systemPrompt += `\n\n# User-Defined Rules\n${customRules.trim()}`;
    }

    return {
      systemPrompt,
      // Reserved for future use (e.g., inserting additional system or dev messages)
      messages: [],
      // Provider-neutral model params; providers may map these to their own knobs
      modelParams: {}
    };
  },

  _formatContext(context) {
    if (!context || typeof context !== 'object') return '';
    const entries = Object.entries(context)
      .filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '');
    if (entries.length === 0) return '';
    return entries.map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
  }
};