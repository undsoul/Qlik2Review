define(['./retry'], function(retry) {
  'use strict';

  const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';  // Updated Jan 2025
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

      // Build request body
      const requestBody = {
        model: model,
        max_tokens: maxTokens,
        system: 'You are a data analyst. Provide concise, actionable insights from data visualizations. Be specific and direct. No fluff.',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      };

      // Add temperature if specified (Anthropic supports 0-1 range)
      if (config.temperature !== undefined) {
        requestBody.temperature = Math.min(config.temperature, 1.0); // Anthropic max is 1.0
      }

      // Add top_p if specified
      if (config.topP !== undefined && config.topP < 1) {
        requestBody.top_p = config.topP;
      }

      // Use retry logic for resilient API calls
      const response = await retry.fetchWithRetry(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(requestBody)
      }, {
        maxRetries: 2,
        baseDelay: 1000
      });

      // Parse JSON with error handling
      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        throw new Error('Failed to parse Anthropic response: ' + parseError.message);
      }

      // Validate response structure
      if (!data.content || !data.content[0]) {
        throw new Error('Invalid response structure from Anthropic');
      }

      var text = data.content[0].text?.trim() || '';

      // Retry once on empty content (transient API issue)
      if (!text) {
        console.log('[Anthropic] Empty content, retrying once...');

        await new Promise(function(resolve) { setTimeout(resolve, 500); });

        const retryResponse = await retry.fetchWithRetry(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify(requestBody)
        }, {
          maxRetries: 1,
          baseDelay: 500
        });

        let retryData;
        try {
          retryData = await retryResponse.json();
        } catch (e) {
          console.log('[Anthropic] Retry parse failed:', e.message);
        }

        if (retryData && retryData.content && retryData.content[0]) {
          text = retryData.content[0].text?.trim() || '';
          if (text) {
            console.log('[Anthropic] Retry succeeded');
            if (retryData.usage) {
              data.usage = retryData.usage;
            }
          }
        }
      }

      // Fall back if still empty
      if (!text) {
        console.log('[Anthropic] Empty content after retry');
        text = 'No summary generated';
      }

      // Extract usage data if available
      var usage = null;
      if (data.usage) {
        usage = {
          inputTokens: data.usage.input_tokens || 0,
          outputTokens: data.usage.output_tokens || 0,
          totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
        };
      }

      return { text: text, usage: usage };
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
        { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku (Fast, Cheap)' },
        { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (Balanced)' },
        { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5 (Default, Latest)' },
        { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5 (Most Powerful)' }
      ];
    }
  };
});
