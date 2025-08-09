/**
 * OutputEvaluator
 * - Centralizes the logic for determining if a task has produced a valuable output.
 * - Provides a consistent way to decide whether to advance the task workflow.
 */
export const OutputEvaluator = {
  /**
   * Evaluates the results of a completed task to determine if it produced tangible value.
   * @param {object} task - The task object, including its results.
   * @returns {{ producedValue: boolean, nextStepHint: string }}
   */
  evaluate(task) {
    if (!task || !task.results) {
      return { producedValue: false, nextStepHint: 'retry' };
    }

    const { results, title = '' } = task;
    const hasArtifacts = Array.isArray(results.artifacts) && results.artifacts.length > 0;
    const hasSummary = typeof results.summary === 'string' && results.summary.trim().length > 0;

    // Rule for research tasks
    if (title.toLowerCase().includes('research')) {
      const hasResearchJson = results.json && (Array.isArray(results.json.sources) && results.json.sources.length > 0 || results.json.overall_relevance_summary);
      if (hasResearchJson) {
        return { producedValue: true, nextStepHint: 'synthesis' };
      }
    }

    // Rule for inventory/inspection tasks
    if (title.toLowerCase().includes('inventory') || title.toLowerCase().includes('inspect')) {
        // The creation of an artifacts_index.json is a clear sign of successful inventory.
        const hasInventoryIndex = hasArtifacts && results.artifacts.some(a => a.filename && a.filename.includes('artifacts_index.json'));
        if (hasInventoryIndex) {
            return { producedValue: true, nextStepHint: 'proceed' };
        }
    }

    // Generic fallback rules
    if (hasArtifacts || hasSummary) {
      return { producedValue: true, nextStepHint: 'proceed' };
    }

    return { producedValue: false, nextStepHint: 're-evaluate' };
  }
};