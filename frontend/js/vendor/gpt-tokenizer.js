/**
 * Local fallback for the gpt-tokenizer library
 * Based on gpt-tokenizer@3.0.1
 */

// Simple tokenizer implementation with fallback functionality
const GPTTokenizer = {
  // Fallback tokenizer - estimates tokens based on character counts
  encode: function(text) {
    if (!text) return [];
    // Simple fallback: roughly 4 characters per token for English text
    // This is a rough approximation only
    const estimatedTokens = Math.ceil(text.length / 4);
    return Array(estimatedTokens).fill(1); // Return dummy token IDs
  },
  
  // Count tokens in text
  countTokens: function(text) {
    if (!text) return 0;
    return this.encode(text).length;
  },
  
  // Decode function (stub for compatibility)
  decode: function(tokens) {
    return "[Tokenizer fallback: decoding not supported]";
  }
};

// Export the tokenizer
window.GPTTokenizer = GPTTokenizer;
console.log("📦 Local GPT Tokenizer fallback loaded");