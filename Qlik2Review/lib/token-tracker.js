define([], function() {
  'use strict';

  /**
   * Token Tracker - Estimates token usage and calculates costs
   */

  // Pricing per 1M tokens (as of 2024)
  var PRICING = {
    openai: {
      'gpt-4o-mini': { input: 0.15, output: 0.60 },
      'gpt-4o': { input: 2.50, output: 10.00 },
      'gpt-4-turbo': { input: 10.00, output: 30.00 },
      'gpt-3.5-turbo': { input: 0.50, output: 1.50 }
    },
    anthropic: {
      'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
      'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
      'claude-3-sonnet-20240229': { input: 3.00, output: 15.00 },
      'claude-3-opus-20240229': { input: 15.00, output: 75.00 }
    },
    gemini: {
      'gemini-1.5-flash': { input: 0.075, output: 0.30 },
      'gemini-1.5-pro': { input: 1.25, output: 5.00 },
      'gemini-pro': { input: 0.50, output: 1.50 }
    }
  };

  // Default pricing if model not found
  var DEFAULT_PRICING = { input: 0.50, output: 1.50 };

  return {
    /**
     * Estimate tokens from text (rough: 1 token ~ 4 chars for English)
     * @param {string} text - Text to estimate
     * @returns {number} Estimated token count
     */
    estimateTokens: function(text) {
      if (!text) return 0;
      return Math.ceil(text.length / 4);
    },

    /**
     * Get pricing for a provider/model combination
     * @param {string} provider - Provider name (openai, anthropic, gemini)
     * @param {string} model - Model name
     * @returns {Object} { input, output } pricing per 1M tokens
     */
    getPricing: function(provider, model) {
      if (!provider || !PRICING[provider]) {
        return DEFAULT_PRICING;
      }

      // Try exact match first
      if (model && PRICING[provider][model]) {
        return PRICING[provider][model];
      }

      // Try partial match (model might have version suffix)
      if (model) {
        var providerPricing = PRICING[provider];
        for (var key in providerPricing) {
          if (model.indexOf(key) !== -1 || key.indexOf(model) !== -1) {
            return providerPricing[key];
          }
        }
      }

      // Return first model's pricing as default for provider
      var models = Object.keys(PRICING[provider]);
      if (models.length > 0) {
        return PRICING[provider][models[0]];
      }

      return DEFAULT_PRICING;
    },

    /**
     * Calculate cost from token usage
     * @param {string} provider - Provider name
     * @param {string} model - Model name
     * @param {number} inputTokens - Input token count
     * @param {number} outputTokens - Output token count
     * @returns {number} Cost in USD
     */
    calculateCost: function(provider, model, inputTokens, outputTokens) {
      var pricing = this.getPricing(provider, model);
      var inputCost = (inputTokens / 1000000) * pricing.input;
      var outputCost = (outputTokens / 1000000) * pricing.output;
      return inputCost + outputCost;
    },

    /**
     * Format cost for display
     * @param {number} cost - Cost in USD
     * @returns {string} Formatted cost string
     */
    formatCost: function(cost) {
      if (cost === 0) return '$0.00';
      if (cost < 0.001) {
        return '<$0.001';
      }
      if (cost < 0.01) {
        return '$' + cost.toFixed(4);
      }
      return '$' + cost.toFixed(3);
    },

    /**
     * Format token count for display
     * @param {number} tokens - Token count
     * @returns {string} Formatted token string
     */
    formatTokens: function(tokens) {
      if (tokens >= 1000000) {
        return (tokens / 1000000).toFixed(1) + 'M';
      }
      if (tokens >= 1000) {
        return (tokens / 1000).toFixed(1) + 'K';
      }
      return tokens.toString();
    },

    /**
     * Create empty usage object
     * @returns {Object} Empty usage stats
     */
    createEmptyUsage: function() {
      return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0
      };
    },

    /**
     * Add usage to existing totals
     * @param {Object} total - Total usage object
     * @param {Object} usage - Usage to add
     * @returns {Object} Updated total
     */
    addUsage: function(total, usage) {
      if (!usage) return total;
      total.inputTokens += usage.inputTokens || 0;
      total.outputTokens += usage.outputTokens || 0;
      total.totalTokens += usage.totalTokens || (usage.inputTokens || 0) + (usage.outputTokens || 0);
      return total;
    }
  };
});
