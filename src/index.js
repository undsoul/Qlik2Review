define([
  'qlik',
  'jquery',
  'text!./template.html',
  'css!./styles.css',
  './definition',
  './services/engine',
  './services/analyzer'
], function(qlik, $, template, cssStyles, definition, engineService, analyzer) {
  'use strict';

  return {
    definition: definition,
    template: template,
    support: {
      snapshot: false,
      export: false,
      exportData: false
    },

    initialProperties: {
      showTitles: true,
      title: 'Qlik2Review',
      subtitle: 'AI-Powered Analysis'
    },

    paint: function($element, layout) {
      const self = this;
      const app = qlik.currApp(this);
      const extensionId = layout.qInfo.qId;

      // Store references for use in controller
      this.$scope.app = app;
      this.$scope.layout = layout;
      this.$scope.extensionId = extensionId;
      this.$scope.isAnalyzing = false;
      this.$scope.sheetSummary = layout.sheetSummary || null;
      this.$scope.objectSummaries = layout.objectSummaries || [];
      this.$scope.lastUpdated = layout.lastUpdated || null;
      this.$scope.error = null;

      // Analyze sheet function - triggered by button
      this.$scope.analyzeSheet = async function() {
        if (self.$scope.isAnalyzing) return;

        self.$scope.isAnalyzing = true;
        self.$scope.error = null;
        self.$scope.$apply();

        try {
          // Get configuration from properties
          const config = {
            provider: layout.aiSettings.provider || 'openai',
            apiKey: layout.aiSettings.apiKey || '',
            customPrompt: layout.aiSettings.customPrompt || '',
            includedTypes: layout.objectFilter.includedTypes || [],
            excludedIds: layout.objectFilter.excludedIds || ''
          };

          // Validate API key
          if (!config.apiKey) {
            throw new Error('API key is required. Please configure in extension properties.');
          }

          // Get sheet objects and analyze
          const result = await analyzer.analyzeSheet(app, config);

          self.$scope.sheetSummary = result.sheetSummary;
          self.$scope.objectSummaries = result.objectSummaries;
          self.$scope.lastUpdated = new Date().toISOString();

          // Inject footnotes to objects if enabled
          if (layout.outputSettings.injectFootnotes) {
            await analyzer.injectFootnotes(app, result.objectSummaries);
          }

        } catch (err) {
          console.error('Qlik2Review Error:', err);
          self.$scope.error = err.message || 'Analysis failed';
        } finally {
          self.$scope.isAnalyzing = false;
          self.$scope.$apply();
        }
      };

      // Clear summaries
      this.$scope.clearSummaries = function() {
        self.$scope.sheetSummary = null;
        self.$scope.objectSummaries = [];
        self.$scope.lastUpdated = null;
        self.$scope.error = null;
      };

      return qlik.Promise.resolve();
    },

    controller: ['$scope', '$element', function($scope, $element) {
      // Initialize scope variables
      $scope.isAnalyzing = false;
      $scope.sheetSummary = null;
      $scope.objectSummaries = [];
      $scope.lastUpdated = null;
      $scope.error = null;

      // Format timestamp for display
      $scope.formatTimestamp = function(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        return date.toLocaleString();
      };

      // Truncate text helper
      $scope.truncateText = function(text, maxLength) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
      };
    }]
  };
});
