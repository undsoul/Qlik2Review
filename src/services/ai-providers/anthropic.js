define([], function() {
  'use strict';

  const DEFAULT_MODEL = 'claude-3-haiku-20240307';
  const API_URL = 'https://api.anthropic.com/v1/messages';

  /**
   * Anthropic (Claude) Provider Service
   */
  return {
    name: 'anthropic',
    displayName: 'Anthropic Claude',

    /**
     * Generate summary using Anthropic API
     * @param {string} prompt - The prompt to send
     * @param {Object} config - Configuration object
     * @param {string} config.apiKey - Anthropic API key
     * @param {string} [config.model] - Model to use (default: claude-3-haiku)
     * @param {number} [config.maxTokens] - Max tokens in response
     * @returns {Promise<string>} Generated summary
     */
    async generateSummary(prompt, config) {
      if (!config.apiKey) {
        throw new Error('Anthropic API key is required');
      }

      const model = config.model || DEFAULT_MODEL;
      const maxTokens = config.maxTokens || 150;

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: model,
          max_tokens: maxTokens,
          system: 'You are a data analyst. Provide concise, actionable insights from data visualizations. Be specific and direct. No fluff.',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `Anthropic API error: ${response.status}`);
      }

      const data = await response.json();
      return data.content[0]?.text?.trim() || 'No summary generated';
    },

    /**
     * Validate API key format
     * @param {string} apiKey
     * @returns {boolean}
     */
    validateApiKey(apiKey) {
      return apiKey && apiKey.startsWith('sk-ant-') && apiKey.length > 20;
    },

    /**
     * Get available models
     * @returns {Array}
     */
    getModels() {
      return [
        { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku (Fast, Cheap)' },
        { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Balanced)' },
        { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus (Powerful)' }
      ];
    }
  };
});
