/**
 * TaskPlanner - Responsible for planning tasks using LLM without side effects
 * Generates a structured plan (array of subtask descriptors) from a main task.
 */

export class TaskPlanner {
  constructor() {}

  async generatePlan(mainTask) {
    // Build prompt using the same planning rules as previously used
    const prompt = `You are an expert technical project planner. Break down the user's goal into concrete, executable subtasks with clear intent grouping and dependencies.

TASK: "${mainTask.title}"
DESCRIPTION: "${mainTask.description || 'No additional description provided'}"

PLANNING RULES:
1) Detect multi-intent prompts and decompose them. Common intents include:
   - setup_tailwind (e.g., inject Tailwind via CDN if not installed)
   - create_js_files (e.g., scaffold multiple JS modules/files)
   - generate_ideas (e.g., produce 10 concrete improvement ideas)
   - modify_files, search_codebase, bug_fix, refactor, write_tests
2) Prefer steps that can be executed via repository/file tools (read/search/write/apply_diff).
3) For web research tasks, create an executable subtask that calls the 'perform_research' tool. For other actions that cannot be executed directly, create an "advisory" subtask.
4) Avoid vague tasks like "analyze requirements". Use specific actions such as:
   - "Inject Tailwind CDN link into frontend/index.html (head) and add a sample utility class to verify"
   - "Create JS files under frontend/js/modules/: dom_utils.js, api_client.js, state_store.js with minimal exports"
   - "Generate 10 concrete improvement ideas with brief justifications"
5) Each subtask must include: title, description, priority (low|medium|high|urgent), and estimatedTime (minutes).
6) Produce between 3 and 6 subtasks. Order them with sensible dependencies (first steps unblock later ones).

Return ONLY a valid JSON array in this exact format (no markdown, no code fences, no commentary):
[
  {
    "title": "Specific actionable task title",
    "description": "Detailed description of what to do",
    "priority": "high",
    "estimatedTime": 20
  }
]

CRITICAL:
- Your response must start with [ and end with ].
- Do not include any text before or after the JSON array.
- Ensure tasks reflect all detected intents (e.g., Tailwind setup, JS scaffolding, and advisory ideas if requested).`;

    // dynamic import ChatService to avoid circular dependency
    const { ChatService } = await import('./chat_service.js');

    const response = await ChatService.sendPrompt(prompt, {
      history: [],
      mode: 'plan'
    });

    const jsonArray = this._parseJsonArray(response);

    if (!Array.isArray(jsonArray) || jsonArray.length === 0) {
      throw new Error('No valid subtasks produced by planner');
    }

    // Normalize and validate each task
    const normalized = jsonArray
      .filter(item => item && typeof item === 'object' && item.title)
      .map(item => ({
        title: String(item.title).trim(),
        description: (item.description || '').toString(),
        priority: ['low', 'medium', 'high', 'urgent'].includes((item.priority || '').toLowerCase())
          ? item.priority.toLowerCase()
          : 'medium',
        estimatedTime: Number.isFinite(item.estimatedTime) ? item.estimatedTime : 30
      }));

    if (normalized.length === 0) {
      throw new Error('Planner returned tasks but none were valid after normalization');
    }

    return normalized;
  }

  _parseJsonArray(response) {
    if (!response || typeof response !== 'string') {
      throw new Error('Planner LLM returned empty response');
    }

    // 1) Try first JSON array match
    let match = response.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e) {
        // continue
      }
    }

    // 2) Try fenced code block
    const codeBlockMatch = response.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1]);
      } catch (e) {
        // continue
      }
    }

    // 3) Line-by-line bracket balancing
    try {
      const lines = response.split('\n');
      const buf = [];
      let depth = 0;
      let started = false;
      for (const line of lines) {
        if (!started && line.includes('[')) {
          started = true;
        }
        if (started) {
          buf.push(line);
          for (const ch of line) {
            if (ch === '[') depth++;
            if (ch === ']') depth--;
          }
          if (started && depth <= 0) {
            break;
          }
        }
      }
      if (buf.length > 0) {
        return JSON.parse(buf.join('\n'));
      }
    } catch (e) {
      // continue
    }

    // 4) Last resort: try to JSON.parse entire response
    try {
      return JSON.parse(response);
    } catch (e) {
      // throw descriptive error
      console.error('[TaskPlanner] Raw LLM response:', response);
      throw new Error('Failed to extract valid JSON array from planner response');
    }
  }
}