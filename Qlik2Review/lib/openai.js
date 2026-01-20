define(['./retry'], function(retry) {
  'use strict';

  const DEFAULT_MODEL = 'gpt-4.1-2025-04-14';  // Stable, cost-effective model
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

      // GPT-5.x and reasoning models use max_completion_tokens instead of max_tokens
      const isGPT5 = model.startsWith('gpt-5') || model.startsWith('o3') || model.startsWith('o1');
      const tokenParam = isGPT5 ? 'max_completion_tokens' : 'max_tokens';

      // Some models don't support temperature (gpt-5-mini, o1, o3-mini, etc.)
      const noTempModels = ['gpt-5-mini', 'o1-mini', 'o1-preview', 'o3-mini'];
      const supportsTemp = !noTempModels.some(m => model.includes(m));

      const requestBody = {
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
        ]
      };

      // Only add temperature if model supports it
      if (supportsTemp) {
        requestBody.temperature = config.temperature !== undefined ? config.temperature : 0.3;
        // Add top_p if specified and not default
        if (config.topP !== undefined && config.topP < 1) {
          requestBody.top_p = config.topP;
        }
      }
      requestBody[tokenParam] = maxTokens;

      // Use retry logic for resilient API calls
      const response = await retry.fetchWithRetry(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
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
        throw new Error('Failed to parse OpenAI response: ' + parseError.message);
      }

      // Validate response structure
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        console.log('[OpenAI] Unexpected response structure:', JSON.stringify(data).substring(0, 500));
        throw new Error('Invalid response structure from OpenAI');
      }

      // GPT-5.x may return content differently or include refusal
      var message = data.choices[0].message;
      var text = message.content?.trim() || '';

      // Check for refusal (safety filter)
      if (!text && message.refusal) {
        console.log('[OpenAI] Response refused:', message.refusal);
        text = 'Response filtered by safety policy';
      }

      // Retry on empty content (transient API issue or model quirk)
      if (!text && !message.refusal) {
        console.log('[OpenAI] Empty content, retrying with forced prompt...');

        // Retry with a modified prompt that forces a response
        const forcedRequestBody = JSON.parse(JSON.stringify(requestBody));
        forcedRequestBody.messages[0].content = 'You MUST respond with analysis. Never return empty. ' + forcedRequestBody.messages[0].content;
        forcedRequestBody.messages.push({
          role: 'user',
          content: 'Please provide your analysis now. Do not return empty.'
        });

        // Slight delay before retry
        await new Promise(function(resolve) { setTimeout(resolve, 300); });

        const retryResponse = await retry.fetchWithRetry(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
          },
          body: JSON.stringify(forcedRequestBody)
        }, {
          maxRetries: 1,
          baseDelay: 500
        });

        let retryData;
        try {
          retryData = await retryResponse.json();
        } catch (e) {
          console.log('[OpenAI] Retry parse failed:', e.message);
        }

        if (retryData && retryData.choices && retryData.choices[0] && retryData.choices[0].message) {
          text = retryData.choices[0].message.content?.trim() || '';
          if (text) {
            console.log('[OpenAI] Retry succeeded with forced prompt');
            if (retryData.usage) {
              data.usage = retryData.usage;
            }
          }
        }
      }

      // Final fallback - try one more time with even simpler prompt
      if (!text && !message.refusal) {
        console.log('[OpenAI] Second retry with minimal prompt...');

        const minimalBody = {
          model: model,
          messages: [
            { role: 'user', content: 'Briefly analyze this data and identify key trends:\n\n' + prompt.substring(0, 1500) }
          ]
        };
        minimalBody[tokenParam] = maxTokens;
        if (supportsTemp) minimalBody.temperature = 0.5;

        await new Promise(function(resolve) { setTimeout(resolve, 300); });

        try {
          const lastRetry = await fetch(API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(minimalBody)
          });
          const lastData = await lastRetry.json();
          if (lastData.choices && lastData.choices[0] && lastData.choices[0].message) {
            text = lastData.choices[0].message.content?.trim() || '';
            if (text) {
              console.log('[OpenAI] Minimal prompt retry succeeded');
              if (lastData.usage) data.usage = lastData.usage;
            }
          }
        } catch (e) {
          console.log('[OpenAI] Minimal retry failed:', e.message);
        }
      }

      // Fall back to generic message if still empty
      if (!text) {
        console.log('[OpenAI] All retries failed. Original message:', JSON.stringify(message).substring(0, 200));
        text = 'Analysis pending - please retry';
      }

      // Extract usage data if available
      var usage = null;
      if (data.usage) {
        usage = {
          inputTokens: data.usage.prompt_tokens || 0,
          outputTokens: data.usage.completion_tokens || 0,
          totalTokens: data.usage.total_tokens || 0
        };
      }

      return { text: text, usage: usage };
    },

    /**
     * Validate API key format
     * Supports both old (sk-xxx) and new (sk-proj-xxx) formats
     * @param {string} apiKey
     * @returns {boolean}
     */
    validateApiKey(apiKey) {
      if (!apiKey || apiKey.length < 20) return false;
      // Support both old sk-xxx and new sk-proj-xxx formats
      return apiKey.startsWith('sk-') || apiKey.startsWith('sk-proj-');
    },

    /**
     * Get available models
     * @returns {Array}
     */
    getModels() {
      return [
        { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini (Fast, Cheap)' },
        { value: 'gpt-4.1-2025-04-14', label: 'GPT-4.1 (Default, Stable)' },
        { value: 'gpt-4.1', label: 'GPT-4.1 (Latest)' },
        { value: 'gpt-5-mini-2025-08-07', label: 'GPT-5 Mini (Fast, Smart)' },
        { value: 'gpt-5.2', label: 'GPT-5.2 (Most Powerful)' }
      ];
    }
  };
});
