/**
 * Placeholder for future AI + chat integration (OpenAI, local LLM, etc.).
 * Call from chat handlers or a dedicated queue worker — does not send automatically.
 */
function handleAIChat(message) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) {
    return 'AI response placeholder';
  }
  return 'AI response placeholder';
}

module.exports = { handleAIChat };
