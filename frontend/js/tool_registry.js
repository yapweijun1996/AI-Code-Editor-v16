/**
 * ToolRegistry - Dynamic tool registration and discovery
 * Allows external modules to register tools without modifying core tool_executor.js
 *
 * Tool shape:
 * {
 *   handler: Function(params, rootHandle) => Promise<any>,
 *   requiresProject: boolean,
 *   createsCheckpoint: boolean,
 *   description?: string
 * }
 */

class _ToolRegistry {
  constructor() {
    this._tools = Object.create(null);
  }

  /**
   * Register or override a tool at runtime
   * @param {string} name
   * @param {object} def - { handler, requiresProject, createsCheckpoint, description? }
   */
  register(name, def) {
    if (!name || typeof name !== 'string') {
      throw new Error('Tool name must be a non-empty string');
    }
    if (!def || typeof def.handler !== 'function') {
      throw new Error(`Tool "${name}" must provide a 'handler' function`);
    }
    // Normalize shape and apply defaults
    const normalized = {
      handler: def.handler,
      requiresProject: Boolean(def.requiresProject),
      createsCheckpoint: Boolean(def.createsCheckpoint),
      description: typeof def.description === 'string' ? def.description : undefined
    };
    this._tools[name] = normalized;
    return true;
  }

  /**
   * Get a single tool by name
   * @param {string} name
   * @returns {object|undefined}
   */
  get(name) {
    return this._tools[name];
  }

  /**
   * Get a shallow copy of all registered tools
   * @returns {Record<string, object>}
   */
  getAll() {
    return { ...this._tools };
  }

  /**
   * List tool names
   * @returns {string[]}
   */
  list() {
    return Object.keys(this._tools);
  }

  /**
   * Bulk register from a plain object map
   * @param {Record<string, object>} toolsMap
   */
  registerAll(toolsMap) {
    if (!toolsMap || typeof toolsMap !== 'object') return;
    for (const [name, def] of Object.entries(toolsMap)) {
      this.register(name, def);
    }
  }
}

export const ToolRegistry = new _ToolRegistry();