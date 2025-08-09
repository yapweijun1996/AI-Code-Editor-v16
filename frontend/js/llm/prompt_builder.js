/**
 * Provider-agnostic PromptBuilder (token-disciplined)
 * - Builds a compact system prompt with optional slot caps and truncation.
 * - Backward compatible with previous usage (mode + customRules only).
 */
export const PromptBuilder = {
  /**
   * Build a prompt pack
   * @param {('code'|'plan'|'search')} mode
   * @param {string} customRules
   * @param {object} context Optional:
   *   {
   *     compact?: boolean,          // Use shorter system text (default: true)
   *     slots?: {                   // Optional extra context slots
   *       task_summary?: string,
   *       plan_outline?: string,
   *       plan_outline_hash?: string,
   *       current_focus?: string,
   *       tools_context?: string,
   *       code_context?: string
   *     },
   *     caps?: {                    // Character caps per slot (approx tokens*4)
   *       system?: number,          // Cap for the entire system prompt body (excludes Session)
   *       task_summary?: number,
   *       plan_outline?: number,
   *       current_focus?: number,
   *       tools_context?: number,
   *       code_context?: number
   *     }
   *   }
   * @returns {{ systemPrompt: string, messages: Array, modelParams: object }}
   */
  build(mode = 'code', customRules = '', context = {}) {
    const compact = context.compact !== undefined ? !!context.compact : true;

    const caps = {
      system: 1600,           // ~400 tokens
      task_summary: 800,      // ~200 tokens
      plan_outline: 1200,     // ~300 tokens
      current_focus: 800,     // ~200 tokens
      tools_context: 800,     // ~200 tokens
      code_context: 1600,     // ~400 tokens
      // New slots to carry cross-task state and steering
      available_artifacts: 1200,  // ~300 tokens
      execution_guidance: 800,    // ~200 tokens
      ...(context.caps || {})
    };

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeString = new Date().toLocaleString();

    const baseHeader = compact
      ? `You are an AI assistant for code tasks. Be precise, concise, and correct. Prefer incremental, testable changes.`
      : `You are an AI assistant helping with code development and analysis. Be precise, concise, and correct. Prefer incremental, testable changes.`;

    const modeBlocks = compact ? {
      code: [
        '# Mode: CODE',
        '- Focus on code analysis and generation.',
        '- Provide working code; keep rationale brief.',
        '- Explain intent and scope when modifying files.'
      ].join('\n'),
      plan: [
        '# Mode: PLAN',
        '- Produce 3–6 executable subtasks with clear intent.',
        '- Prefer tool-performable actions; otherwise add advisory outputs.',
        '- Follow requested schemas exactly (JSON if specified).'
      ].join('\n'),
      search: [
        '# Mode: SEARCH',
        '- Explore codebase/docs.',
        '- Cite files and line numbers when possible.',
        '- Provide actionable insights.'
      ].join('\n')
    } : {
      code: [
        '# Mode: CODE',
        '- Focus on code analysis, generation, and debugging.',
        '- Provide working, idiomatic code with brief rationale.',
        '- When modifying files, explain the intent and scope.',
        '- Think step-by-step but keep output compact.'
      ].join('\n'),
      plan: [
        '# Mode: PLAN',
        '- Break complex or multi-intent goals into concrete, executable subtasks.',
        '- Detect and decompose multi-intent prompts (e.g., setup_tailwind, create_js_files, generate_ideas).',
        '- For each intent, group subtasks, specify dependencies, and define measurable acceptance criteria.',
        '- Prefer actions that can be performed via available tools first; if tools are unavailable, add an advisory/info-producing subtask.',
        '- Output MUST be valid JSON when a strict schema is requested by the user or the system.'
      ].join('\n'),
      search: [
        '# Mode: SEARCH',
        '- Explore the codebase and documentation to answer questions.',
        '- Cite exact files and line numbers where possible.',
        '- Synthesize findings into clear, actionable insights.'
      ].join('\n')
    };

    // Compose optional slots with hard caps
    const slotText = this._composeSlots(context.slots || {}, caps);

    // Hard rule to enforce reuse-before-tools behavior across all modes
    const reusePolicy = [
      '# Reuse Policy',
      '- Before invoking any tool, first inspect "Available Artifacts" in the Context.',
      '- If the artifacts contain sufficient information to complete the task, synthesize directly and DO NOT call tools.',
      '- Only call tools when information is missing or insufficient. If you call a tool, briefly justify what is missing.',
      '- Prefer targeted, low-cost tools over broad or duplicate operations.'
    ].join('\\n');
    
    // Assemble system prompt body (subject to system cap)
    let body = [
      baseHeader,
      '',
      (modeBlocks[mode] || modeBlocks.code),
      reusePolicy,
      slotText ? `\\n# Context\\n${slotText}` : ''
    ].join('\\n');

    body = this._cap(body, caps.system);

    // Session footer (not capped, small)
    let systemPrompt = [
      body,
      `\n# Session\n- Time: ${timeString}\n- Timezone: ${timeZone}`
    ].join('\n');

    if (customRules && customRules.trim()) {
      systemPrompt += `\n\n# User-Defined Rules\n${customRules.trim()}`;
    }

    return {
      systemPrompt,
      messages: [],
      modelParams: {}
    };
  },

  _composeSlots(slots, caps) {
    const parts = [];

    if (slots.task_summary) {
      parts.push(this._section('Task Summary', this._cap(slots.task_summary, caps.task_summary)));
    }

    if (slots.plan_outline_hash) {
      parts.push(this._kv('Plan Outline Hash', String(slots.plan_outline_hash)));
    }

    if (slots.plan_outline) {
      parts.push(this._section('Plan Outline', this._cap(slots.plan_outline, caps.plan_outline)));
    }

    if (slots.current_focus) {
      parts.push(this._section('Current Focus', this._cap(slots.current_focus, caps.current_focus)));
    }

    if (slots.tools_context) {
      parts.push(this._section('Tools Context', this._cap(slots.tools_context, caps.tools_context)));
    }

    if (slots.code_context) {
      parts.push(this._section('Code Context', this._cap(slots.code_context, caps.code_context)));
    }

    if (slots.available_artifacts) {
      parts.push(this._section('Available Artifacts', this._cap(slots.available_artifacts, caps.available_artifacts)));
    }

    if (slots.execution_guidance) {
      parts.push(this._section('Execution Guidance', this._cap(slots.execution_guidance, caps.execution_guidance)));
    }

    return parts.filter(Boolean).join('\n\n').trim();
  },

  _section(title, body) {
    if (!body) return '';
    return `## ${title}\n${body}`;
  },

  _kv(key, value) {
    return `- ${key}: ${value}`;
  },

  _cap(text, maxChars) {
    if (!text || typeof text !== 'string') return '';
    if (!maxChars || maxChars <= 0) return text;
    if (text.length <= maxChars) return text;
    const hard = Math.max(0, maxChars - 3);
    return text.slice(0, hard) + '...';
  },

  // Back-compat: keep _formatContext for legacy callers that passed a flat object
  _formatContext(context) {
    if (!context || typeof context !== 'object') return '';
    const entries = Object.entries(context)
      .filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '');
    if (entries.length === 0) return '';
    return entries.map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
  }
};