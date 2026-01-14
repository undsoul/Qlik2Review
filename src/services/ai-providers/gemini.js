define([], function() {
  'use strict';

  const DEFAULT_MODEL = 'gemini-1.5-flash';
  const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  /**
   * Google Gemini Provider Service
   */
  return {
    name: 'gemini',
    displayName: 'Google Gemini',

    /**
     * Generate summary using Gemini API
     * @param {string} prompt - The prompt to send
     * @param {Object} config - Configuration object
     * @param {string} config.apiKey - Gemini API key
     * @param {string} [config.model] - Model to use (default: gemini-1.5-flash)
     * @param {number} [config.maxTokens] - Max tokens in response
     * @returns {Promise<string>} Generated summary
     */
    async generateSummary(prompt, config) {
      if (!config.apiKey) {
        throw new Error('Gemini API key is required');
      }

      const model = config.model || DEFAULT_MODEL;
      const maxTokens = config.maxTokens || 150;
      const apiUrl = `${API_BASE}/${model}:generateContent?key=${config.apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `You are a data analyst. Provide concise, actionable insights from data visualizations. Be specific and direct. No fluff.\n\n${prompt}`
                }
              ]
            }
          ],
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.3
          }
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return content?.trim() || 'No summary generated';
    },

    /**
     * Validate API key format
     * @param {string} apiKey
     * @returns {boolean}
     */
    validateApiKey(apiKey) {
      // Gemini API keys are typically 39 characters
      return apiKey && apiKey.length >= 30;
    },

    /**
     * Get available models
     * @returns {Array}
     */
    getModels() {
      return [
        { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Fast, Cheap)' },
        { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (Balanced)' },
        { value: 'gemini-1.0-pro', label: 'Gemini 1.0 Pro (Stable)' }
      ];
    }
  };
});
