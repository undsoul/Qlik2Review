define([
  './engine',
  './ai-providers/openai',
  './ai-providers/anthropic',
  './ai-providers/gemini',
  '../utils/object-filter',
  '../utils/prompt-builder'
], function(engineService, openaiProvider, anthropicProvider, geminiProvider, objectFilter, promptBuilder) {
  'use strict';

  // Provider registry
  const providers = {
    openai: openaiProvider,
    anthropic: anthropicProvider,
    gemini: geminiProvider
  };

  /**
   * Analyzer Service - Orchestrates sheet analysis
   */
  return {
    /**
     * Analyze entire sheet and generate summaries
     * @param {Object} app - Qlik app object
     * @param {Object} config - Analysis configuration
     * @returns {Promise<Object>} Analysis results
     */
    analyzeSheet: async function(app, config) {
      const self = this;

      // Get all objects on the sheet
      const allObjects = await engineService.getSheetObjects(app);

      // Filter objects based on configuration
      const filteredObjects = objectFilter.filterObjects(allObjects, {
        includedTypes: config.includedTypes,
        excludedIds: config.excludedIds
      });

      if (filteredObjects.length === 0) {
        return {
          sheetSummary: 'No analyzable objects found on this sheet.',
          objectSummaries: [],
          timestamp: new Date().toISOString()
        };
      }

      // Get current selections for context
      const selections = await engineService.getCurrentSelections(app);

      // Get AI provider
      const provider = providers[config.provider];
      if (!provider) {
        throw new Error(`Unknown AI provider: ${config.provider}`);
      }

      // Analyze each object
      const objectSummaries = [];
      for (const obj of filteredObjects) {
        try {
          const summary = await self.analyzeObject(obj, selections, config, provider);
          objectSummaries.push({
            id: obj.id,
            title: obj.title,
            type: obj.type,
            summary: summary,
            timestamp: new Date().toISOString()
          });
        } catch (err) {
          console.error(`Error analyzing object ${obj.id}:`, err);
          objectSummaries.push({
            id: obj.id,
            title: obj.title,
            type: obj.type,
            summary: `Analysis failed: ${err.message}`,
            error: true,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Generate sheet-level summary
      const sheetSummary = await self.generateSheetSummary(
        objectSummaries,
        selections,
        config,
        provider
      );

      return {
        sheetSummary: sheetSummary,
        objectSummaries: objectSummaries,
        timestamp: new Date().toISOString()
      };
    },

    /**
     * Analyze a single object
     * @param {Object} obj - Object details
     * @param {Array} selections - Current selections
     * @param {Object} config - Configuration
     * @param {Object} provider - AI provider
     * @returns {Promise<string>} Summary text
     */
    analyzeObject: async function(obj, selections, config, provider) {
      const prompt = promptBuilder.buildObjectPrompt(obj, selections, config.customPrompt);

      const summary = await provider.generateSummary(prompt, {
        apiKey: config.apiKey,
        model: config.model,
        maxTokens: Math.min(100, Math.floor(config.maxCharsPerObject / 4) || 75)
      });

      // Truncate if necessary
      const maxChars = config.maxCharsPerObject || 300;
      if (summary.length > maxChars) {
        return summary.substring(0, maxChars - 3) + '...';
      }

      return summary;
    },

    /**
     * Generate sheet-level summary from object summaries
     * @param {Array} objectSummaries - Individual object summaries
     * @param {Array} selections - Current selections
     * @param {Object} config - Configuration
     * @param {Object} provider - AI provider
     * @returns {Promise<string>} Sheet summary
     */
    generateSheetSummary: async function(objectSummaries, selections, config, provider) {
      const prompt = promptBuilder.buildSheetPrompt(objectSummaries, selections);

      const summary = await provider.generateSummary(prompt, {
        apiKey: config.apiKey,
        model: config.model,
        maxTokens: 200
      });

      return summary;
    },

    /**
     * Inject footnotes to objects
     * @param {Object} app - Qlik app object
     * @param {Array} objectSummaries - Summaries to inject
     * @returns {Promise<void>}
     */
    injectFootnotes: async function(app, objectSummaries) {
      const promises = objectSummaries
        .filter(function(obj) { return !obj.error; })
        .map(function(obj) {
          const timestamp = new Date(obj.timestamp).toLocaleString();
          const footnote = `[AI Summary | ${timestamp}]\n${obj.summary}`;
          return engineService.updateObjectFootnote(app, obj.id, footnote);
        });

      await Promise.all(promises);
    }
  };
});
