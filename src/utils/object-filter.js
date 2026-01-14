define([], function() {
  'use strict';

  /**
   * Object Filter Utility
   * Handles filtering of Qlik objects based on type and exclusion rules
   */
  return {
    /**
     * Default chart types to include
     */
    defaultIncludedTypes: [
      'barchart',
      'linechart',
      'piechart',
      'combochart',
      'scatterplot',
      'treemap',
      'kpi',
      'gauge',
      'table',
      'pivot-table'
    ],

    /**
     * Types that should never be analyzed
     */
    excludedBaseTypes: [
      'text-image',
      'container',
      'filterpane',
      'listbox',
      'button',
      'action-button',
      'qlik-show-hide-container',
      'qlik-tabbed-container',
      'qlik-trellis-container'
    ],

    /**
     * Filter objects based on configuration
     * @param {Array} objects - Array of object details
     * @param {Object} config - Filter configuration
     * @param {Array} config.includedTypes - Types to include
     * @param {string} config.excludedIds - Comma-separated object IDs to exclude
     * @returns {Array} Filtered objects
     */
    filterObjects: function(objects, config) {
      const self = this;
      const includedTypes = config.includedTypes || self.defaultIncludedTypes;
      const excludedIds = self.parseExcludedIds(config.excludedIds);

      return objects.filter(function(obj) {
        // Skip if object ID is explicitly excluded
        if (excludedIds.includes(obj.id)) {
          return false;
        }

        // Skip base excluded types (containers, text, etc.)
        if (self.excludedBaseTypes.includes(obj.type)) {
          return false;
        }

        // Include if type is in the included list
        return includedTypes.includes(obj.type);
      });
    },

    /**
     * Parse comma-separated excluded IDs string
     * @param {string} excludedIdsStr - Comma-separated IDs
     * @returns {Array} Array of trimmed IDs
     */
    parseExcludedIds: function(excludedIdsStr) {
      if (!excludedIdsStr || typeof excludedIdsStr !== 'string') {
        return [];
      }

      return excludedIdsStr
        .split(',')
        .map(function(id) { return id.trim(); })
        .filter(function(id) { return id.length > 0; });
    },

    /**
     * Get human-readable type name
     * @param {string} type - Object type
     * @returns {string} Readable name
     */
    getTypeName: function(type) {
      const typeNames = {
        'barchart': 'Bar Chart',
        'linechart': 'Line Chart',
        'piechart': 'Pie Chart',
        'combochart': 'Combo Chart',
        'scatterplot': 'Scatter Plot',
        'treemap': 'Treemap',
        'kpi': 'KPI',
        'gauge': 'Gauge',
        'table': 'Table',
        'pivot-table': 'Pivot Table',
        'boxplot': 'Box Plot',
        'distributionplot': 'Distribution Plot',
        'histogram': 'Histogram',
        'waterfallchart': 'Waterfall Chart',
        'map': 'Map',
        'mekkochart': 'Mekko Chart',
        'bulletchart': 'Bullet Chart',
        'funnelchart': 'Funnel Chart'
      };

      return typeNames[type] || type;
    },

    /**
     * Check if object type is analyzable
     * @param {string} type - Object type
     * @returns {boolean}
     */
    isAnalyzable: function(type) {
      return !this.excludedBaseTypes.includes(type);
    }
  };
});
