/**
 * ToolAdapter
 * - Normalizes provider tool call events into a common structure the Chat layer can consume.
 * - Optionally converts internal tool declarations to provider-specific formats.
 *
 * Normalized function call shape used by ChatService and ToolExecutor:
 * { id: string, name: string, args: object }
 */
export const ToolAdapter = {
  /**
   * Normalize provider-emitted tool call events into a common array of
   * { id, name, args } objects.
   *
   * @param {string} provider - 'gemini' | 'openai' | 'ollama' | other
   * @param {any} rawCalls - Provider-specific function calls payload
   * @returns {Array<{ id: string, name: string, args: object }>}
   */
  fromProviderCalls(provider, rawCalls) {
    if (!rawCalls) return [];

    // OpenAI: already close to normalized; ensure args is parsed object
    if (provider === 'openai') {
      try {
        return (rawCalls || []).map(call => {
          const id = call.id || ToolAdapter._genId('oa_');
          let argsObj = {};
          try {
            argsObj = typeof call.args === 'string' ? JSON.parse(call.args) : (call.args || {});
          } catch (_) {
            // Fall back to empty object if arguments are not valid JSON
            argsObj = {};
          }
          return { id, name: call.name, args: argsObj };
        });
      } catch {
        return [];
      }
    }

    // Gemini: SDK returns array of { name, args } where args is object
    if (provider === 'gemini') {
      try {
        return (rawCalls || []).map((call, idx) => {
          const id = call.id || ToolAdapter._genId('gm_', idx);
          // Gemini args are already objects
          const argsObj = (call.args && typeof call.args === 'object') ? call.args : {};
          return { id, name: call.name, args: argsObj };
        });
      } catch {
        return [];
      }
    }

    // Ollama and others: currently no native tool calling; return empty
    return [];
  },

  /**
   * Convert internal tool declarations (Gemini-style) into provider-specific declarations.
   * For now:
   * - gemini: pass-through
   * - openai: convert to OpenAI function tool schema
   * - ollama: returns empty array (no tool support)
   *
   * @param {string} provider
   * @param {object} internalTools - { functionDeclarations: [...] } (Gemini-style)
   * @returns {any} Provider-specific tool declaration
   */
  toProviderDeclarations(provider, internalTools) {
    if (!internalTools) return provider === 'openai' ? [] : internalTools;

    if (provider === 'gemini') {
      return internalTools; // pass-through (functionDeclarations)
    }

    if (provider === 'openai') {
      const fns = internalTools.functionDeclarations || [];
      return fns.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: ToolAdapter._convertGeminiParamsToOpenAI(tool.parameters),
        }
      }));
    }

    if (provider === 'ollama') {
      return []; // no tools
    }

    return internalTools;
  },

  // Helpers

  _genId(prefix = 'tool_', seed = null) {
    const rnd = Math.random().toString(36).slice(2, 10);
    const ts = Date.now().toString(36);
    return `${prefix}${seed !== null ? seed + '_' : ''}${ts}_${rnd}`;
  },

  _convertGeminiParamsToOpenAI(params) {
    const convert = (prop) => {
      if (typeof prop !== 'object' || prop === null || !prop.type) {
        return prop;
      }

      const newProp = { ...prop, type: String(prop.type || '').toLowerCase() };

      if (newProp.type === 'object' && newProp.properties) {
        const newProperties = {};
        for (const key in newProp.properties) {
          newProperties[key] = convert(newProp.properties[key]);
        }
        newProp.properties = newProperties;
      }

      if (newProp.type === 'array' && newProp.items) {
        newProp.items = convert(newProp.items);
      }

      return newProp;
    };

    return convert(params);
  }
};