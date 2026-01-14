define([], function() {
  'use strict';

  const DEFAULT_MODEL = 'gpt-4o-mini';
  const API_URL = 'https://api.openai.com/v1/chat/completions';

  /**
   * OpenAI Provider Service
   */
  return {
    name: 'openai',
    displayName: 'OpenAI',

    /**
     * Generate summary using OpenAI API
     * @param {string} prompt - The prompt to send
     * @param {Object} config - Configuration object
     * @param {string} config.apiKey - OpenAI API key
     * @param {string} [config.model] - Model to use (default: gpt-4o-mini)
     * @param {number} [config.maxTokens] - Max tokens in response
     * @returns {Promise<string>} Generated summary
     */
    async generateSummary(prompt, config) {
      if (!config.apiKey) {
        throw new Error('OpenAI API key is required');
      }

      const model = config.model || DEFAULT_MODEL;
      const maxTokens = config.maxTokens || 150;

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: 'You are a data analyst. Provide concise, actionable insights from data visualizations. Be specific and direct. No fluff.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: maxTokens,
          temperature: 0.3
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0]?.message?.content?.trim() || 'No summary generated';
    },

    /**
     * Validate API key format
     * @param {string} apiKey
     * @returns {boolean}
     */
    validateApiKey(apiKey) {
      return apiKey && apiKey.startsWith('sk-') && apiKey.length > 20;
    },

    /**
     * Get available models
     * @returns {Array}
     */
    getModels() {
      return [
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast, Cheap)' },
        { value: 'gpt-4o', label: 'GPT-4o (Balanced)' },
        { value: 'gpt-4-turbo', label: 'GPT-4 Turbo (Powerful)' }
      ];
    }
  };
});
