define([], function() {
  'use strict';

  /**
   * Object Filter Utility
   * Handles filtering of Qlik objects based on type and exclusion rules
   */

  // Preset definitions
  var PRESETS = {
    all: ['barchart', 'linechart', 'piechart', 'combochart', 'scatterplot', 'kpi', 'gauge', 'table', 'pivot-table', 'treemap', 'boxplot', 'histogram', 'waterfallchart', 'map', 'funnelchart', 'mekkochart'],
    common: ['barchart', 'linechart', 'combochart', 'piechart', 'kpi', 'gauge', 'table', 'scatterplot'],
    tables: ['table', 'pivot-table']
  };

  return {
    /**
     * Types that should never be analyzed (containers handled by engine.js)
     */
    excludedBaseTypes: [
      'text-image',
      'container',
      'sn-layout-container',
      'qlik-tab-container',
      'sn-tabbed-container',
      'tabcontainer',
      'layoutcontainer',
      'filterpane',
      'listbox',
      'button',
      'action-button',
      'qlik-show-hide-container',
      'qlik-tabbed-container',
      'qlik-trellis-container'
    ],

    /**
     * Build included types array from config
     * @param {Object} objectFilter - The objectFilter property from layout
     * @returns {Array} Array of included type strings
     */
    getIncludedTypes: function(objectFilter) {
      if (!objectFilter) {
        return PRESETS.common;
      }

      // Check preset-based selection (new approach)
      var preset = objectFilter.preset || 'common';

      if (preset === 'all') {
        return PRESETS.all;
      }

      if (preset === 'custom') {
        // Parse custom types string
        var customStr = objectFilter.customTypes;
        if (customStr && typeof customStr === 'string') {
          return customStr.split(',')
            .map(function(t) { return t.trim().toLowerCase(); })
            .filter(function(t) { return t.length > 0; });
        }
        return PRESETS.common;
      }

      // Default: 'common' preset
      if (preset === 'common') {
        return PRESETS.common;
      }

      // Legacy fallback: Use includedTypes string if available
      var typesStr = objectFilter.includedTypes;
      if (typesStr && typeof typesStr === 'string') {
        return typesStr.split(',')
          .map(function(t) { return t.trim().toLowerCase(); })
          .filter(function(t) { return t.length > 0; });
      }

      return PRESETS.common;
    },

    /**
     * Filter objects based on configuration
     * @param {Array} objects - Array of object details
     * @param {Object} config - Filter configuration from layout.objectFilter
     * @returns {Array} Filtered objects
     */
    filterObjects: function(objects, config) {
      var self = this;

      // Get included types from checkbox properties
      var includedTypes = this.getIncludedTypes(config);
      var excludedIds = this.parseExcludedIds(config ? config.excludedIds : '');

      return objects.filter(function(obj) {
        // Skip if object ID is explicitly excluded
        if (excludedIds.indexOf(obj.id) !== -1) {
          return false;
        }

        // Skip base excluded types (containers, text, etc.)
        if (self.excludedBaseTypes.indexOf(obj.type) !== -1) {
          return false;
        }

        // Include if type is in the included list
        return includedTypes.indexOf(obj.type) !== -1;
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
      var typeNames = {
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
      return this.excludedBaseTypes.indexOf(type) === -1;
    }
  };
});
