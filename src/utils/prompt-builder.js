define([], function() {
  'use strict';

  /**
   * Prompt Builder Utility
   * Constructs effective prompts for AI analysis
   */

  // Default system prompt for object analysis
  const DEFAULT_OBJECT_PROMPT = `Analyze this Qlik visualization data. Provide concise analytical insights.
Focus on: key trends, patterns, outliers, and actionable observations.
Be specific with numbers. Keep response under 250 characters.`;

  // Default system prompt for sheet summary
  const DEFAULT_SHEET_PROMPT = `Synthesize these visualization summaries into a cohesive sheet-level analysis.
Identify cross-chart patterns and overall story. Keep response under 400 characters.`;

  return {
    /**
     * Build prompt for analyzing a single object
     * @param {Object} obj - Object details with data
     * @param {Array} selections - Current selections
     * @param {string} customPrompt - Optional custom prompt
     * @returns {string} Constructed prompt
     */
    buildObjectPrompt: function(obj, selections, customPrompt) {
      const parts = [];

      // Use custom prompt or default
      parts.push(customPrompt || DEFAULT_OBJECT_PROMPT);
      parts.push('');

      // Object metadata
      parts.push(`Chart Type: ${obj.type}`);
      if (obj.title) {
        parts.push(`Title: ${obj.title}`);
      }

      // Dimensions and measures info
      if (obj.dimensions && obj.dimensions.length > 0) {
        const dimLabels = obj.dimensions.map(function(d) { return d.label; }).join(', ');
        parts.push(`Dimensions: ${dimLabels}`);
      }

      if (obj.measures && obj.measures.length > 0) {
        const measLabels = obj.measures.map(function(m) { return m.label; }).join(', ');
        parts.push(`Measures: ${measLabels}`);
      }

      // Include current selections context
      if (selections && selections.length > 0) {
        const selContext = selections.map(function(s) {
          return `${s.field}: ${s.selected.slice(0, 3).join(', ')}${s.count > 3 ? '...' : ''}`;
        }).join('; ');
        parts.push(`Active Filters: ${selContext}`);
      }

      // Include data sample
      if (obj.data && obj.data.length > 0) {
        parts.push('');
        parts.push('Data Sample (first 10 rows):');
        parts.push(this.formatDataSample(obj.data, obj.dimensions, obj.measures));
      }

      // Special handling for KPI
      if (obj.type === 'kpi' && obj.kpiValue) {
        parts.push(`KPI Value: ${obj.kpiValue}`);
      }

      return parts.join('\n');
    },

    /**
     * Build prompt for sheet-level summary
     * @param {Array} objectSummaries - Individual object summaries
     * @param {Array} selections - Current selections
     * @returns {string} Constructed prompt
     */
    buildSheetPrompt: function(objectSummaries, selections) {
      const parts = [];

      parts.push(DEFAULT_SHEET_PROMPT);
      parts.push('');

      // Selection context
      if (selections && selections.length > 0) {
        const selContext = selections.map(function(s) {
          return `${s.field}: ${s.count} selected`;
        }).join(', ');
        parts.push(`Current Selections: ${selContext}`);
        parts.push('');
      }

      // Object summaries
      parts.push('Individual Chart Summaries:');
      objectSummaries.forEach(function(obj, idx) {
        if (!obj.error) {
          parts.push(`${idx + 1}. [${obj.type}] ${obj.title}: ${obj.summary}`);
        }
      });

      return parts.join('\n');
    },

    /**
     * Format data sample for prompt
     * @param {Array} data - Data rows
     * @param {Array} dimensions - Dimension info
     * @param {Array} measures - Measure info
     * @returns {string} Formatted data table
     */
    formatDataSample: function(data, dimensions, measures) {
      const lines = [];
      const maxRows = 10;

      // Build header
      const headers = [];
      dimensions.forEach(function(d) { headers.push(d.label); });
      measures.forEach(function(m) { headers.push(m.label); });
      lines.push(headers.join(' | '));

      // Build data rows
      const rowCount = Math.min(data.length, maxRows);
      for (let i = 0; i < rowCount; i++) {
        const row = data[i];
        const values = [];

        row.dimensions.forEach(function(d) {
          values.push(this.truncate(d, 20));
        }, this);

        row.measures.forEach(function(m) {
          values.push(m.text || String(m.num || ''));
        });

        lines.push(values.join(' | '));
      }

      if (data.length > maxRows) {
        lines.push(`... and ${data.length - maxRows} more rows`);
      }

      return lines.join('\n');
    },

    /**
     * Truncate string to max length
     * @param {string} str - Input string
     * @param {number} maxLen - Maximum length
     * @returns {string} Truncated string
     */
    truncate: function(str, maxLen) {
      if (!str) return '';
      if (str.length <= maxLen) return str;
      return str.substring(0, maxLen - 2) + '..';
    }
  };
});
