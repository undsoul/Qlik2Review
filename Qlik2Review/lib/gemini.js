define(['./retry'], function(retry) {
  'use strict';

  const DEFAULT_MODEL = 'gemini-2.5-flash';  // Updated Jan 2026 - stable production model
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
      // SECURITY FIX: Use header authentication instead of URL query parameter
      // This prevents API key from appearing in browser history, DevTools, and logs
      const apiUrl = `${API_BASE}/${model}:generateContent`;

      // Use retry logic for resilient API calls
      const response = await retry.fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.apiKey  // API key in header, not URL
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
            temperature: config.temperature !== undefined ? config.temperature : 0.3,
            topP: config.topP !== undefined ? config.topP : 0.95
          }
        })
      }, {
        maxRetries: 2,
        baseDelay: 1000
      });

      // Parse JSON with error handling
      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        throw new Error('Failed to parse Gemini response: ' + parseError.message);
      }

      // Validate response structure
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        throw new Error('Invalid response structure from Gemini');
      }

      var text = data.candidates[0].content.parts?.[0]?.text?.trim() || '';

      // Retry once on empty content (transient API issue)
      if (!text) {
        console.log('[Gemini] Empty content, retrying once...');

        await new Promise(function(resolve) { setTimeout(resolve, 500); });

        const retryResponse = await retry.fetchWithRetry(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': config.apiKey
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
              temperature: config.temperature !== undefined ? config.temperature : 0.3,
              topP: config.topP !== undefined ? config.topP : 0.95
            }
          })
        }, {
          maxRetries: 1,
          baseDelay: 500
        });

        let retryData;
        try {
          retryData = await retryResponse.json();
        } catch (e) {
          console.log('[Gemini] Retry parse failed:', e.message);
        }

        if (retryData && retryData.candidates && retryData.candidates[0] && retryData.candidates[0].content) {
          text = retryData.candidates[0].content.parts?.[0]?.text?.trim() || '';
          if (text) {
            console.log('[Gemini] Retry succeeded');
            if (retryData.usageMetadata) {
              data.usageMetadata = retryData.usageMetadata;
            }
          }
        }
      }

      // Fall back if still empty
      if (!text) {
        console.log('[Gemini] Empty content after retry');
        text = 'No summary generated';
      }

      // Extract usage data if available
      var usage = null;
      if (data.usageMetadata) {
        usage = {
          inputTokens: data.usageMetadata.promptTokenCount || 0,
          outputTokens: data.usageMetadata.candidatesTokenCount || 0,
          totalTokens: data.usageMetadata.totalTokenCount || 0
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
      // Gemini API keys are typically 39 characters
      return apiKey && apiKey.length >= 30;
    },

    /**
     * Get available models
     * @returns {Array}
     */
    getModels() {
      return [
        { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (Fast, Cheap)' },
        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Default, Balanced)' },
        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Powerful)' },
        { value: 'gemini-3-flash', label: 'Gemini 3 Flash (Latest, Multimodal)' },
        { value: 'gemini-3-pro', label: 'Gemini 3 Pro (Most Powerful)' }
      ];
    }
  };
});
