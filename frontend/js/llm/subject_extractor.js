/**
 * SubjectExtractor
 * - Extracts a clean, specific "subject" from a task title or user prompt.
 * - This is crucial for ensuring that auto-generated subtasks are accurately targeted.
 */
export const SubjectExtractor = {
  /**
   * Extracts the primary subject from a string (e.g., a task title).
   * @param {string} text - The text to extract the subject from.
   * @returns {string | null} The extracted subject or null if not found.
   */
  extract(text) {
    if (!text) return null;

    // Priority 1: Text inside double quotes
    let match = text.match(/"([^"]+)"/);
    if (match && match[1]) {
      return match[1].trim();
    }

    // Priority 2: Text inside single quotes
    match = text.match(/'([^']+)'/);
    if (match && match[1]) {
      return match[1].trim();
    }

    // Priority 3: A simple heuristic for "research X" or "find Y"
    match = text.match(/^(?:research|find|investigate|look up)\s+(.+?)(?:\s+for|\s+and|,|upto|$)/i);
    if (match && match[1]) {
        return match[1].trim().replace(/,$/, ''); // Remove trailing comma
    }
    
    // Fallback: return the original text, cleaned up a bit.
    // This is a safe fallback but should be improved with more sophisticated NLP/entity recognition if needed.
    return text.trim();
  }
};