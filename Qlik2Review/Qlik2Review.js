define([
  'qlik',
  'css!./styles.css',
  './definition',
  './lib/engine',
  './lib/analyzer',
  './lib/logger',
  './lib/prompt-builder',
  './lib/openai',
  './lib/anthropic',
  './lib/gemini',
  './lib/chart-templates'
], function(qlik, cssStyles, definition, engineService, analyzer, logger, promptBuilder, openaiProvider, anthropicProvider, geminiProvider, chartTemplates) {
  'use strict';

  console.log('Qlik2Review v3.9.3 LOADED - Vanilla JS (Mobile Compatible)');

  // AI providers map
  var aiProviders = {
    openai: openaiProvider,
    anthropic: anthropicProvider,
    gemini: geminiProvider
  };

  // Helper to get AI provider
  function getAIProvider(providerName) {
    return aiProviders[providerName] || openaiProvider;
  }

  // Cancellation token
  var cancelToken = { cancelled: false };

  // Storage key prefix
  var STORAGE_PREFIX = 'q2r_';

  // Debounce timer for paint calls
  var paintDebounceTimer = null;
  var lastPaintTime = 0;
  var PAINT_DEBOUNCE_MS = 100;

  // Track all setTimeout IDs for cleanup
  var activeTimers = [];

  // Helper function to create self-cleaning tracked timeouts
  function setTrackedTimeout(callback, delay) {
    var timerId = setTimeout(function() {
      // Remove self from tracking array when executed
      var idx = activeTimers.indexOf(timerId);
      if (idx > -1) activeTimers.splice(idx, 1);
      callback();
    }, delay);
    activeTimers.push(timerId);
    return timerId;
  }

  // State management (replaces Angular $scope)
  var state = {
    isAnalyzing: false,
    sheetSummary: null,
    objectSummaries: [],
    lastUpdated: null,
    error: null,
    progress: '',
    currentSheetId: null,
    objectsExpanded: true,
    app: null,
    layout: null,
    extensionId: null,
    element: null,
    copyFeedback: null,  // { id: 'all' | objectId, timestamp }
    usage: null,  // { inputTokens, outputTokens, totalTokens, estimatedCost }
    alertStatuses: {},  // { objectId: 'warning' | 'positive' | 'neutral' }
    alertCounts: { warning: 0, positive: 0, neutral: 0 },  // Alert summary counts
    lastSelectionHash: null,  // Hash of selections at last analysis
    selectionsChanged: false,  // Flag indicating selections have changed since last analysis
    selectionCheckInterval: null,  // Interval ID for selection polling
    autoAnalyzeTimer: null,  // Timer ID for auto-analyze debounce
    previousAnalysis: null,  // { sheetSummary, objectSummaries, timestamp }
    comparisonResult: null,  // { changedObjects, newObjects, removedObjects }
    showComparison: false,  // Toggle for comparison view
    savedAnalyses: [],  // Array of bookmarked analyses
    viewingSavedId: null,  // ID of currently viewed saved analysis
    bookmarksExpanded: false,  // Toggle for bookmarks list
    diveDeeperSuggestions: null,  // AI-generated chart suggestions (raw text)
    parsedSuggestions: null,  // Parsed JSON suggestions for Insight Advisor
    analyzedObjects: [],  // Objects with data used for chart creation
    creatingChart: null,  // ID of suggestion being created
    createdChartModal: null,  // { objectId, title } for modal display
    modalError: null,  // Error message to display in modal
    isEditMode: false,  // Whether app is in edit mode
    insightModel: null  // Cached insight model from /api/v1/apps/{appId}/insight-analyses/model
  };

  // Bookmark storage key prefix
  var BOOKMARK_PREFIX = 'q2r_bookmarks_';

  // Get bookmark storage key
  function getBookmarkKey(appId, sheetId) {
    return BOOKMARK_PREFIX + appId + '_' + sheetId;
  }

  // Load bookmarks from localStorage
  function loadBookmarks(appId, sheetId) {
    try {
      var key = getBookmarkKey(appId, sheetId);
      var data = localStorage.getItem(key);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      logger.debug('Could not load bookmarks:', e.message);
    }
    return [];
  }

  // Save bookmarks to localStorage
  function saveBookmarksToStorage(appId, sheetId, bookmarks) {
    try {
      var key = getBookmarkKey(appId, sheetId);
      localStorage.setItem(key, JSON.stringify(bookmarks));
      return true;
    } catch (e) {
      logger.warn('Could not save bookmarks:', e.message);
      return false;
    }
  }

  // Generate unique ID
  function generateId() {
    return 'bk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // Generate comparison between previous and current analysis
  function generateComparison(previous, current) {
    if (!previous || !current) return null;

    var prevMap = {};
    var currMap = {};

    (previous.objectSummaries || []).forEach(function(obj) {
      prevMap[obj.id] = obj;
    });

    (current.objectSummaries || []).forEach(function(obj) {
      currMap[obj.id] = obj;
    });

    var changedObjects = [];
    var newObjects = [];
    var removedObjects = [];

    // Find changed and new objects
    (current.objectSummaries || []).forEach(function(obj) {
      var prev = prevMap[obj.id];
      if (!prev) {
        newObjects.push(obj);
      } else if (prev.summary !== obj.summary) {
        changedObjects.push({
          id: obj.id,
          title: obj.title || prev.title,
          type: obj.type,
          previousSummary: prev.summary,
          currentSummary: obj.summary
        });
      }
    });

    // Find removed objects
    (previous.objectSummaries || []).forEach(function(obj) {
      if (!currMap[obj.id]) {
        removedObjects.push(obj);
      }
    });

    return {
      changedObjects: changedObjects,
      newObjects: newObjects,
      removedObjects: removedObjects,
      previousTimestamp: previous.timestamp,
      sheetSummaryChanged: previous.sheetSummary !== current.sheetSummary,
      previousSheetSummary: previous.sheetSummary
    };
  }

  // Create a hash of current selections for comparison
  // Selection objects from engine.js have: { field, selected, count }
  function hashSelections(selections) {
    if (!selections || selections.length === 0) return 'empty';
    try {
      return selections.map(function(s) {
        // Use 'field' and 'selected' properties from engine.js getCurrentSelections
        var fieldName = s.field || '';
        var values = s.selected || [];
        return fieldName + ':' + values.sort().join(',');
      }).sort().join('|');
    } catch (e) {
      logger.debug('hashSelections error:', e.message);
      return 'error';
    }
  }

  // Detect alert status from summary text based on keywords
  function detectAlertStatus(summary, alertKeywords, positiveKeywords) {
    if (!summary) return 'neutral';

    var text = summary.toLowerCase();
    var originalText = summary; // Keep original for emoji detection

    // Built-in emoji detection (always active)
    var warningEmojis = ['⚠', '⚠️', '🔴', '❌', '🚨', '⬇️', '📉', '🔻'];
    var positiveEmojis = ['✅', '✓', '🟢', '📈', '⬆️', '🔺', '🎯', '🏆'];

    var hasEmojiWarning = warningEmojis.some(function(emoji) { return originalText.indexOf(emoji) !== -1; });
    var hasEmojiPositive = positiveEmojis.some(function(emoji) { return originalText.indexOf(emoji) !== -1; });

    // Parse keywords (comma-separated)
    var alertWords = (alertKeywords || '').split(',').map(function(w) { return w.trim().toLowerCase(); }).filter(Boolean);
    var positiveWords = (positiveKeywords || '').split(',').map(function(w) { return w.trim().toLowerCase(); }).filter(Boolean);

    var hasKeywordAlert = alertWords.some(function(word) { return text.indexOf(word) !== -1; });
    var hasKeywordPositive = positiveWords.some(function(word) { return text.indexOf(word) !== -1; });

    // Combine emoji and keyword detection
    var hasAlert = hasEmojiWarning || hasKeywordAlert;
    var hasPositive = hasEmojiPositive || hasKeywordPositive;

    // Alert takes priority over positive
    if (hasAlert) return 'warning';
    if (hasPositive) return 'positive';
    return 'neutral';
  }

  // Process all object summaries and assign alert statuses
  function processAlertStatuses(objectSummaries, alertKeywords, positiveKeywords) {
    var statuses = {};
    var counts = { warning: 0, positive: 0, neutral: 0 };

    objectSummaries.forEach(function(obj) {
      if (!obj.error) {
        var status = detectAlertStatus(obj.summary, alertKeywords, positiveKeywords);
        statuses[obj.id] = status;
        counts[status]++;
      }
    });

    return { statuses: statuses, counts: counts };
  }

  // Update alert statuses from current state and layout settings
  function updateAlertStatuses(layout) {
    var alertsEnabled = layout && layout.insightAlerts && layout.insightAlerts.enabled;
    if (alertsEnabled && state.objectSummaries && state.objectSummaries.length > 0) {
      var alertKeywords = (layout.insightAlerts && layout.insightAlerts.alertKeywords) || '';
      var positiveKeywords = (layout.insightAlerts && layout.insightAlerts.positiveKeywords) || '';
      var alertResult = processAlertStatuses(state.objectSummaries, alertKeywords, positiveKeywords);
      state.alertStatuses = alertResult.statuses;
      state.alertCounts = alertResult.counts;
      return alertResult;
    } else {
      state.alertStatuses = {};
      state.alertCounts = { warning: 0, positive: 0, neutral: 0 };
      return null;
    }
  }

  // Map visualization approach to Qlik chart type
  function mapVisualizationToChart(vizApproach, dims, meas) {
    var approach = (vizApproach || '').toLowerCase();

    // Map conceptual visualization to Qlik chart type
    var mapping = {
      'comparison': 'barchart',
      'trend': 'linechart',
      'distribution': 'boxplot',
      'correlation': 'scatterplot',
      'composition': dims && dims.length > 1 ? 'treemap' : 'piechart',
      'detail': 'table',
      'ranking': 'barchart',
      'flow': 'waterfallchart'
    };

    return mapping[approach] || 'barchart';
  }

  // Parse dive deeper suggestions from AI response (JSON extraction)
  function parseDiveDeeperSuggestions(rawText) {
    if (!rawText) return null;

    try {
      // Try to extract JSON from response (may be wrapped in markdown code blocks)
      var jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
      var jsonStr = jsonMatch ? jsonMatch[1] : rawText;

      // Try parsing as JSON array
      var parsed = JSON.parse(jsonStr.trim());

      if (Array.isArray(parsed) && parsed.length > 0) {
        // Validate structure and add unique IDs
        // Support both old format (chartType) and new format (visualization/question)
        return parsed.map(function(item, idx) {
          // Handle both array and singular format
          var dims = item.dimensions || (item.dimension ? [item.dimension] : []);
          var meas = item.measures || (item.measure ? [item.measure] : []);

          // Determine chart type: old format uses chartType, new format uses visualization
          var chartType;
          if (item.chartType) {
            // Old format - direct chart type
            chartType = item.chartType;
          } else if (item.visualization) {
            // New format - map visualization approach to chart type
            chartType = mapVisualizationToChart(item.visualization, dims, meas);
          } else {
            chartType = 'barchart';
          }

          // Title: old format uses title, new format uses question
          var title = item.title || item.question || 'Analysis ' + (idx + 1);

          return {
            id: 'sug_' + idx + '_' + Date.now(),
            title: title,
            insight: item.insight || '',
            chartType: chartType,
            visualization: item.visualization || null, // Keep for display
            dimensions: dims,
            measures: meas
          };
        }).filter(function(item) {
          // Must have at least one dimension or one measure
          return (item.dimensions && item.dimensions.length > 0) ||
                 (item.measures && item.measures.length > 0);
        });
      }
    } catch (e) {
      logger.debug('Could not parse suggestions as JSON:', e.message);
    }

    // Fallback: return null (will show raw text)
    return null;
  }

  // Map chart type names to Qlik visualization types
  function mapChartType(chartType) {
    var typeMap = {
      // Standard charts
      'barchart': 'barchart',
      'bar': 'barchart',
      'bar chart': 'barchart',
      'column': 'barchart',
      'columnchart': 'barchart',
      'linechart': 'linechart',
      'line': 'linechart',
      'line chart': 'linechart',
      'areachart': 'linechart',
      'area': 'linechart',
      'area chart': 'linechart',
      'piechart': 'piechart',
      'pie': 'piechart',
      'pie chart': 'piechart',
      'donut': 'piechart',
      'donutchart': 'piechart',
      'combochart': 'combochart',
      'combo': 'combochart',
      'combo chart': 'combochart',
      'table': 'table',
      'sn-table': 'table',
      'straight-table': 'table',
      'straighttable': 'table',
      'kpi': 'kpi',
      // Advanced charts
      'scatterplot': 'scatterplot',
      'scatter': 'scatterplot',
      'scatter plot': 'scatterplot',
      'bubble': 'scatterplot',
      'bubblechart': 'scatterplot',
      'treemap': 'treemap',
      'tree map': 'treemap',
      'histogram': 'histogram',
      'gauge': 'gauge',
      'waterfall': 'waterfallchart',
      'waterfallchart': 'waterfallchart',
      'waterfall chart': 'waterfallchart',
      'boxplot': 'boxplot',
      'box plot': 'boxplot',
      'box-plot': 'boxplot',
      'distributionplot': 'distributionplot',
      'distribution': 'distributionplot',
      'distribution plot': 'distributionplot',
      // Additional native charts
      'pivot-table': 'pivottable',
      'pivottable': 'pivottable',
      'pivot': 'pivottable',
      'pivot table': 'pivottable',
      'sn-pivot-table': 'pivottable',
      'map': 'map',
      'mekkochart': 'mekkochart',
      'mekko': 'mekkochart',
      'marimekko': 'mekkochart',
      // Funnel and other charts
      'funnelchart': 'funnelchart',
      'funnel': 'funnelchart',
      'funnel chart': 'funnelchart',
      'sankeychart': 'sankey-chart',
      'sankey': 'sankey-chart',
      'bullet': 'bulletchart',
      'bulletchart': 'bulletchart',
      'bullet chart': 'bulletchart'
    };
    return typeMap[(chartType || '').toLowerCase()] || 'barchart';
  }

  /**
   * Apply chart-specific configuration to definition object
   * Centralized function for all chart types - used by both session and permanent objects
   * @param {Object} def - The chart definition object
   * @param {string} vizType - The visualization type
   * @param {string} context - 'session' or 'permanent'
   */
  function applyChartConfig(def, vizType, context) {
    // Helper to set up sorting
    function setupSorting(def) {
      if (!def.qHyperCubeDef) return;
      var totalCols = (def.qHyperCubeDef.qDimensions || []).length + (def.qHyperCubeDef.qMeasures || []).length;
      def.qHyperCubeDef.qInterColumnSortOrder = [];
      for (var i = 0; i < totalCols; i++) {
        def.qHyperCubeDef.qInterColumnSortOrder.push(i);
      }
    }

    // Helper to set dimension sorting by measure
    function sortDimensionsByMeasure(def) {
      if (!def.qHyperCubeDef || !def.qHyperCubeDef.qDimensions) return;
      def.qHyperCubeDef.qDimensions.forEach(function(dim) {
        dim.qSortByExpression = -1;
        dim.qSortByNumeric = -1;
        dim.qSortByAscii = 0;
        dim.qSortByLoadOrder = 0;
      });
    }

    switch (vizType) {
      case 'barchart':
        def.measureAxis = { show: 'all', autoMinMax: true, dock: 'near', spacing: 1 };
        def.dimensionAxis = { show: 'all', dock: 'near', label: 'auto' };
        def.dataPoint = { showLabels: false };
        def.barGrouping = { grouping: 'grouped' };
        def.orientation = 'vertical';
        def.gridLine = { auto: true, spacing: 2 };
        def.scrollbar = { show: 'auto' };
        def.refLine = { refLines: [] };
        def.color = { auto: true, mode: 'primary' };
        setupSorting(def);
        break;

      case 'linechart':
        def.measureAxis = { show: 'all', autoMinMax: true, dock: 'near', spacing: 1 };
        def.dimensionAxis = { show: 'all', dock: 'near', label: 'auto' };
        def.dataPoint = { showLabels: false, show: true };
        def.lineType = 'line';
        def.nullMode = 'gap';
        def.orientation = 'vertical';
        def.gridLine = { auto: true, spacing: 2 };
        def.scrollbar = { show: 'auto' };
        def.refLine = { refLines: [] };
        def.color = { auto: true, mode: 'primary' };
        setupSorting(def);
        break;

      case 'combochart':
        def.measureAxis = { show: 'all', autoMinMax: true, dock: 'near', spacing: 1 };
        def.dimensionAxis = { show: 'all', dock: 'near', label: 'auto' };
        def.dataPoint = { showLabels: false };
        def.barGrouping = { grouping: 'grouped' };
        def.orientation = 'vertical';
        def.gridLine = { auto: true, spacing: 2 };
        def.scrollbar = { show: 'auto' };
        def.refLine = { refLines: [] };
        def.color = { auto: true, mode: 'primary' };
        setupSorting(def);
        break;

      case 'piechart':
        def.dataPoint = { showLabels: true, labelMode: 'share' };
        def.dimensionAxis = { label: 'tilted' };
        def.color = { auto: true, mode: 'byDimension', dimensionScheme: '12' };
        def.legend = { show: true, dock: 'auto' };
        if (def.qHyperCubeDef) {
          def.qHyperCubeDef.qSuppressZero = true;
          def.qHyperCubeDef.qSuppressMissing = true;
        }
        setupSorting(def);
        sortDimensionsByMeasure(def);
        break;

      case 'treemap':
        // Treemap labels - show all label types
        def.labels = {
          auto: true,
          headers: true,
          overlay: true,
          leaves: true,
          values: true
        };
        def.color = { auto: true, mode: 'byDimension', dimensionScheme: '12' };
        def.legend = { show: true, dock: 'auto', showTitle: true };
        if (def.qHyperCubeDef) {
          def.qHyperCubeDef.qSuppressZero = true;
          def.qHyperCubeDef.qSuppressMissing = true;
          // Treemap needs proper initial data fetch
          def.qHyperCubeDef.qInitialDataFetch = [{ qWidth: 2, qHeight: 500 }];
        }
        setupSorting(def);
        sortDimensionsByMeasure(def);
        break;

      case 'scatterplot':
        // Scatterplot uses xAxis and yAxis, NOT measureAxis
        def.xAxis = {
          show: 'all',
          dock: 'near',
          spacing: 1,
          autoMinMax: true
        };
        def.yAxis = {
          show: 'all',
          dock: 'near',
          spacing: 1,
          autoMinMax: true
        };
        def.labels = { mode: 1 };  // 0=show, 1=auto, 2=hide
        def.gridLine = { auto: true, spacing: 2 };
        def.navigation = false;
        def.compressionResolution = 5;
        def.color = { auto: true, mode: 'primary' };
        def.dataPoint = { bubbleSizes: 5, rangeBubbleSizes: [2, 8] };
        def.legend = { show: true, dock: 'auto', showTitle: true };
        // Add qAttributeDimensions and qAttributeExpressions
        if (def.qHyperCubeDef) {
          if (def.qHyperCubeDef.qDimensions) {
            def.qHyperCubeDef.qDimensions.forEach(function(dim) {
              dim.qAttributeDimensions = dim.qAttributeDimensions || [];
              dim.qAttributeExpressions = dim.qAttributeExpressions || [];
            });
          }
          if (def.qHyperCubeDef.qMeasures) {
            def.qHyperCubeDef.qMeasures.forEach(function(meas) {
              meas.qAttributeExpressions = meas.qAttributeExpressions || [];
            });
          }
        }
        break;

      case 'waterfallchart':
        def.measureAxis = { show: 'all', autoMinMax: true, dock: 'near', spacing: 1 };
        def.dimensionAxis = { show: 'all', dock: 'near' };
        def.dataPoint = { showLabels: true };
        def.gridLine = { auto: true, spacing: 2 };
        def.color = {
          auto: false,
          positiveValue: { color: '#276e27', index: -1 },
          negativeValue: { color: '#a6192e', index: -1 },
          subtotalValue: { color: '#c3c3c3', index: -1 }
        };
        // Waterfall measures need valueType
        if (def.qHyperCubeDef && def.qHyperCubeDef.qMeasures) {
          def.qHyperCubeDef.qMeasures.forEach(function(meas, idx) {
            if (meas.qDef) {
              meas.qDef.isCustomFormatted = false;
              meas.qDef.numFormatFromTemplate = true;
              if (idx === def.qHyperCubeDef.qMeasures.length - 1 && def.qHyperCubeDef.qMeasures.length > 1) {
                meas.qDef.valueType = 'SUBTOTAL';
              } else {
                meas.qDef.valueType = 'NORMAL';
              }
            }
          });
        }
        setupSorting(def);
        break;

      case 'boxplot':
        // Set up dimension sorting first
        if (def.qHyperCubeDef && def.qHyperCubeDef.qDimensions) {
          def.qHyperCubeDef.qDimensions.forEach(function(dim) {
            if (dim.qDef) {
              dim.qDef.qSortCriterias = dim.qDef.qSortCriterias || [{ qSortByNumeric: 1, qSortByAscii: 1, qSortByLoadOrder: 1, qSortByExpression: 0, qExpression: { qv: '' } }];
            }
            dim.qSortByExpression = 0;
            dim.qSortByNumeric = 1;
            dim.qSortByAscii = 1;
            dim.qSortByLoadOrder = 1;
          });
        }
        // Boxplot uses nested structure
        def.boxplotDef = {
          qHyperCubeDef: def.qHyperCubeDef,
          calculations: { auto: true, mode: 'tukey', parameters: { tukey: 1.5, fractiles: 0.01, stdDev: 3 } },
          elements: {
            firstWhisker: { name: '', expression: '' },
            boxStart: { name: '', expression: '' },
            boxMiddle: { name: '', expression: '' },
            boxEnd: { name: '', expression: '' },
            lastWhisker: { name: '', expression: '' },
            outliers: { include: true }
          },
          color: { auto: true, box: { paletteColor: { color: '#4477aa', index: 6 } }, point: { paletteColor: { color: '#4477aa', index: 6 } } },
          presentation: { whiskers: { show: true } },
          sorting: { autoSort: true, elementId: 'boxMiddle', sortCriteria: { sortByExpression: 0, sortByNumeric: 1, sortByAscii: 0 } }
        };
        delete def.qHyperCubeDef;
        def.color = { auto: true };
        def.presentation = { whiskers: { show: true } };
        def.measureAxis = { show: 'all', autoMinMax: true, dock: 'near', spacing: 1 };
        def.dimensionAxis = { show: 'all', dock: 'near' };
        break;

      case 'histogram':
        def.measureAxis = { show: 'all', autoMinMax: true, dock: 'near', spacing: 1 };
        def.dimensionAxis = { show: 'all', dock: 'near', label: 'auto' };
        def.bins = { auto: true, binMode: 'maxCount', binCount: 10, countDistinct: false };
        def.dataPoint = { showLabels: false };
        def.gridLine = { auto: true, spacing: 2 };
        // Histogram uses barColor, not color!
        def.barColor = {
          paletteColor: {
            index: 6,
            color: '#4477aa'
          }
        };
        def.frequencyMode = 'N';
        break;

      case 'distributionplot':
        def.measureAxis = { show: 'all', autoMinMax: true, dock: 'near' };
        def.dimensionAxis = { show: 'all', dock: 'near' };
        def.dataPoint = { showLabels: false, bubbleSizes: 5 };
        def.color = { auto: true, mode: 'primary' };
        def.gridLine = { auto: true, spacing: 2 };
        break;

      case 'gauge':
        def.gaugetype = 'radial';
        def.measureAxis = { show: 'labels', min: 0, max: 'auto', autoMinMax: false };
        def.refLine = { refLines: [] };
        def.useSegments = false;
        def.color = { auto: true, paletteColor: { index: 6 } };
        def.orientation = 'vertical';
        break;

      case 'kpi':
        def.showMeasureTitle = true;
        def.fontSize = 'M';
        def.textAlign = 'center';
        def.layoutBehavior = 'responsive';
        break;

      case 'table':
        def.totals = { show: true, position: 'bottom', label: 'Totals' };
        def.scrollbar = { show: 'auto' };
        break;

      case 'pivottable':
        if (def.qHyperCubeDef) {
          def.qHyperCubeDef.qMode = 'P';
          def.qHyperCubeDef.qAlwaysFullyExpanded = true;
        }
        def.totals = { show: true, position: 'bottom', label: 'Totals' };
        break;

      case 'funnelchart':
        def.dataPoint = { showLabels: true };
        def.measureAxis = { show: 'all' };
        def.color = { auto: true, mode: 'byDimension', dimensionScheme: '12' };
        def.legend = { show: true, dock: 'auto' };
        setupSorting(def);
        sortDimensionsByMeasure(def);
        break;

      case 'mekkochart':
        def.measureAxis = { show: 'all', autoMinMax: true, dock: 'near' };
        def.dimensionAxis = { show: 'all', dock: 'near' };
        def.dataPoint = { showLabels: false };
        def.gridLine = { auto: true, spacing: 2 };
        def.color = { auto: true, mode: 'byDimension' };
        setupSorting(def);
        break;

      case 'bulletchart':
        def.measureAxis = { show: 'all', autoMinMax: true };
        def.orientation = 'horizontal';
        def.color = { auto: true };
        break;

      case 'sankey':
        def.dataPoint = { showLabels: true };
        def.color = { auto: true, mode: 'byDimension' };
        break;

      case 'map':
        def.mapSettings = { showScaleBar: true, showLasso: true };
        def.color = { auto: true };
        break;

      default:
        // Generic defaults
        if (def.qHyperCubeDef) {
          setupSorting(def);
        }
        break;
    }
  }

  // Extract actual field names from measure expression
  // e.g. "Sum([Open Balance])" -> "Open Balance"
  function extractFieldsFromExpression(expression) {
    if (!expression) return [];
    var fields = [];
    var regex = /\[([^\]]+)\]/g;
    var match;
    while ((match = regex.exec(expression)) !== null) {
      // Skip date qualifiers like [As Of Date.autoCalendar.Date]
      if (match[1].indexOf('.') === -1 || match[1].split('.').length <= 2) {
        fields.push(match[1]);
      }
    }
    return fields;
  }

  // Fetch insight model from Qlik Cloud API (all available fields and master items)
  async function fetchInsightModel() {
    if (state.insightModel) {
      logger.debug('Using cached insight model');
      return state.insightModel;
    }

    try {
      var appId = state.app && state.app.id;
      if (!appId) {
        logger.warn('No app ID available for insight model fetch');
        return null;
      }

      logger.info('Fetching insight model for app:', appId);
      var response = await fetch('/api/v1/apps/' + appId + '/insight-analyses/model', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      if (!response.ok) {
        logger.warn('Insight model fetch failed:', response.status, response.statusText);
        return null;
      }

      var result = await response.json();
      if (result && result.data) {
        state.insightModel = result.data;
        logger.info('Insight model loaded:',
          (result.data.fields || []).length, 'fields,',
          (result.data.masterItems || []).length, 'master items');
        return result.data;
      }
      return null;
    } catch (err) {
      logger.warn('Error fetching insight model:', err.message);
      return null;
    }
  }

  // Get available fields from insight model (for chart creation)
  // Only returns fields with usable expressions - skips master items since we can't get their expressions easily
  function getFieldsFromInsightModel(model) {
    var dimensions = [];
    var measures = [];

    if (!model) return { dimensions: dimensions, measures: measures };

    // Process raw fields - these have usable expressions
    (model.fields || []).forEach(function(field) {
      var simplified = field.simplifiedClassifications || field.classifications || [];

      // Check if this is a temporal (date/time) field
      var isTemporal = simplified.indexOf('temporal') !== -1 ||
                       simplified.indexOf('time') !== -1 ||
                       simplified.indexOf('date') !== -1;

      if (simplified.indexOf('dimension') !== -1) {
        dimensions.push({
          name: field.name,
          label: field.name,
          field: '[' + field.name + ']',
          type: 'field',
          isTemporal: isTemporal
        });
      }
      if (simplified.indexOf('measure') !== -1) {
        var aggr = field.defaultAggregation || 'sum';
        measures.push({
          name: field.name,
          label: field.name,
          expression: aggr.charAt(0).toUpperCase() + aggr.slice(1) + '([' + field.name + '])',
          type: 'field'
        });
      }
    });

    // Process master items - use qLibraryId for chart creation
    var masterItemsList = model.masterItems || [];

    // Debug: log first master item structure
    if (masterItemsList.length > 0) {
      logger.debug('Master item sample keys:', Object.keys(masterItemsList[0]).join(', '));
      logger.debug('Master item sample:', JSON.stringify(masterItemsList[0]).substring(0, 300));
    }

    masterItemsList.forEach(function(item, idx) {
      // Insight API returns: caption, libId, classifications
      var itemName = item.caption || item.title || item.name || '';
      var itemId = item.libId || item.qId || item.id || '';
      var classifications = item.classifications || item.simplifiedClassifications || [];

      // Debug first few items
      if (idx < 3) {
        logger.debug('Master item ' + idx + ':', itemName, 'libId:', itemId, 'classifications:', classifications.join(','));
      }

      if (!itemName || !itemId) return;

      // Check if temporal from classifications
      var isTemporal = classifications.indexOf('temporal') !== -1 ||
                       classifications.indexOf('time') !== -1 ||
                       classifications.indexOf('date') !== -1;

      // Detect if dimension or measure from classifications array
      var isDimension = classifications.indexOf('dimension') !== -1;
      var isMeasure = classifications.indexOf('measure') !== -1;

      if (isDimension) {
        dimensions.push({
          name: itemName,
          label: itemName,
          libraryId: itemId,
          type: 'master',
          isTemporal: isTemporal
        });
      } else if (isMeasure) {
        measures.push({
          name: itemName,
          label: itemName,
          libraryId: itemId,
          type: 'master'
        });
      }
    });

    return { dimensions: dimensions, measures: measures };
  }

  // Get measure details from library ID (for master measures)
  // Returns: { expression, label, numFormat } or null
  async function getMeasureDetails(libId) {
    if (!state.app || !libId) return null;
    try {
      // getMeasure is an Engine API method on enigmaModel, not on Capability API app
      var enigmaModel = state.app.model && state.app.model.enigmaModel;
      if (!enigmaModel || typeof enigmaModel.getMeasure !== 'function') {
        logger.debug('enigmaModel.getMeasure not available, trying alternative');
        // Fallback: try to get via global model if available
        if (state.app.model && typeof state.app.model.getMeasure === 'function') {
          enigmaModel = state.app.model;
        } else {
          logger.debug('No getMeasure method available on app');
          return null;
        }
      }
      var measure = await enigmaModel.getMeasure(libId);
      if (measure) {
        var props = await measure.getProperties();
        if (props && props.qMeasure && props.qMeasure.qDef) {
          var result = {
            expression: props.qMeasure.qDef,
            label: props.qMeasure.qLabel || props.qMetaDef && props.qMetaDef.title || null,
            numFormat: props.qMeasure.qNumFormat || null
          };
          logger.debug('Got measure details for', libId, ':', result.expression.substring(0, 50), 'label:', result.label);
          return result;
        }
      }
    } catch (e) {
      logger.debug('Could not get measure details for', libId, ':', e.message);
    }
    return null;
  }

  // Get dimension details from library ID (for master dimensions)
  // Returns: { fieldDefs, label } or null
  async function getDimensionDetails(libId) {
    if (!state.app || !libId) return null;
    try {
      var enigmaModel = state.app.model && state.app.model.enigmaModel;
      if (!enigmaModel || typeof enigmaModel.getDimension !== 'function') {
        logger.debug('enigmaModel.getDimension not available, trying alternative');
        if (state.app.model && typeof state.app.model.getDimension === 'function') {
          enigmaModel = state.app.model;
        } else {
          logger.debug('No getDimension method available on app');
          return null;
        }
      }
      var dimension = await enigmaModel.getDimension(libId);
      if (dimension) {
        var props = await dimension.getProperties();
        if (props && props.qDim && props.qDim.qFieldDefs && props.qDim.qFieldDefs.length > 0) {
          var result = {
            fieldDefs: props.qDim.qFieldDefs,
            label: props.qDim.qFieldLabels && props.qDim.qFieldLabels[0] || props.qMetaDef && props.qMetaDef.title || null
          };
          logger.debug('Got dimension details for', libId, ':', result.fieldDefs.join(', '), 'label:', result.label);
          return result;
        }
      }
    } catch (e) {
      logger.debug('Could not get dimension details for', libId, ':', e.message);
    }
    return null;
  }

  // Helper: Clean field name - ensure single brackets
  function cleanFieldName(field) {
    if (!field) return '';
    // Remove any existing brackets and trim
    var clean = field.replace(/^\[+/, '').replace(/\]+$/, '').trim();
    return clean;
  }

  // Create chart from AI suggestion
  async function createChartFromSuggestion(suggestion) {
    if (!suggestion || !state.app) {
      logger.error('Cannot create chart: missing suggestion or app');
      return null;
    }

    logger.info('Creating chart:', suggestion.title);
    logger.debug('Suggestion details:', JSON.stringify({ dimensions: suggestion.dimensions, measures: suggestion.measures, chartType: suggestion.chartType }));
    state.creatingChart = suggestion.id;
    updateUI();

    try {
      var app = state.app;

      // Fetch insight model from Qlik Cloud API (complete data model)
      var insightModel = await fetchInsightModel();
      var availableFields;

      if (insightModel) {
        availableFields = getFieldsFromInsightModel(insightModel);
        logger.info('Using insight model:', availableFields.dimensions.length, 'dimensions,', availableFields.measures.length, 'measures');
      } else {
        // Fallback to analyzed objects if API call fails
        availableFields = promptBuilder.getAvailableFields(state.analyzedObjects || []);
        logger.info('Using fallback (analyzed objects):', availableFields.dimensions.length, 'dimensions,', availableFields.measures.length, 'measures');
      }

      logger.debug('Available dimensions:', availableFields.dimensions.slice(0, 10).map(function(d) { return d.label; }).join(', ') + (availableFields.dimensions.length > 10 ? '...' : ''));
      logger.debug('Available measures:', availableFields.measures.slice(0, 10).map(function(m) { return m.label; }).join(', ') + (availableFields.measures.length > 10 ? '...' : ''));

      // Helper: match a field name to available fields (with fuzzy fallback)
      function matchField(fieldName, availableList, fieldType) {
        if (!fieldName || !availableList) return null;
        var searchName = fieldName.toLowerCase().trim();

        // 1. Try exact match first (case insensitive)
        var matched = availableList.find(function(f) {
          return (f.label && f.label.toLowerCase().trim() === searchName) ||
                 (f.name && f.name.toLowerCase().trim() === searchName);
        });
        if (matched) {
          logger.info('Matched ' + fieldType + ':', matched.label, matched.type === 'master' ? '(master item)' : '(field)');
          return matched;
        }

        // 2. Fuzzy fallback: find field that ENDS WITH the search term
        // E.g., "Percent Overdue 60 Days" matches "Prior Percent Overdue 60 Days"
        var suffixMatch = availableList.find(function(f) {
          var label = (f.label || '').toLowerCase().trim();
          return label.endsWith(searchName) && label.length <= searchName.length + 20; // Max 20 char prefix
        });
        if (suffixMatch) {
          logger.warn('Fuzzy match for ' + fieldType + ':', fieldName, '->', suffixMatch.label);
          return suffixMatch;
        }

        // 3. Last resort: find field that CONTAINS the search term (if unique)
        var containsMatches = availableList.filter(function(f) {
          var label = (f.label || '').toLowerCase().trim();
          return label.indexOf(searchName) !== -1;
        });
        if (containsMatches.length === 1) {
          logger.warn('Contains match for ' + fieldType + ':', fieldName, '->', containsMatches[0].label);
          return containsMatches[0];
        }

        logger.warn('Field not found:', fieldName, '- AI should use exact names from the list');
        return null;
      }

      // Track unmatched fields for user feedback
      var unmatchedFields = [];

      // Parse dimensions array (support both array and single value for backwards compat)
      var dimNames = suggestion.dimensions || (suggestion.dimension ? [suggestion.dimension] : []);
      var matchedDimensions = [];
      dimNames.forEach(function(dimName) {
        var matched = matchField(dimName, availableFields.dimensions, 'dimension');
        if (matched) {
          matchedDimensions.push({
            field: matched.field || null,
            libraryId: matched.libraryId || null,
            label: matched.label
          });
        } else {
          unmatchedFields.push({ type: 'dimension', name: dimName });
        }
      });

      // Parse measures array (support both array and single values for backwards compat)
      var measNames = suggestion.measures || [];
      if (measNames.length === 0 && suggestion.measure) {
        measNames.push(suggestion.measure);
        if (suggestion.measure2) measNames.push(suggestion.measure2);
      }
      var matchedMeasures = [];
      measNames.forEach(function(measName) {
        var matched = matchField(measName, availableFields.measures, 'measure');
        if (matched) {
          matchedMeasures.push({
            expression: matched.expression || null,
            libraryId: matched.libraryId || null,
            label: matched.label
          });
        } else {
          unmatchedFields.push({ type: 'measure', name: measName });
        }
      });

      logger.info('Matched', matchedDimensions.length, 'dimensions,', matchedMeasures.length, 'measures');
      if (unmatchedFields.length > 0) {
        logger.warn('Unmatched fields:', unmatchedFields.map(function(f) { return f.name + ' (' + f.type + ')'; }).join(', '));
      }

      var vizType = mapChartType(suggestion.chartType);

      // Check if we have any master items
      var hasMasterDimensions = matchedDimensions.some(function(d) { return d.libraryId; });
      var hasMasterMeasures = matchedMeasures.some(function(m) { return m.libraryId; });

      logger.debug('Chart creation - vizType:', vizType, 'masterDims:', hasMasterDimensions, 'masterMeas:', hasMasterMeasures);

      var vizObject;
      var objectId;

      // Use Visualization API
      // Note: qLibraryId objects don't mix well with expression strings, so we resolve master items first
      logger.info('Using Visualization API');

      // First, resolve any master dimension field definitions
      for (var i = 0; i < matchedDimensions.length; i++) {
        var dim = matchedDimensions[i];
        if (dim.libraryId && !dim.resolvedField) {
          logger.debug('Resolving master dimension for:', dim.label);
          var dimDetails = await getDimensionDetails(dim.libraryId);
          if (dimDetails && dimDetails.fieldDefs && dimDetails.fieldDefs.length > 0) {
            matchedDimensions[i].resolvedField = dimDetails.fieldDefs[0];
            if (dimDetails.label) matchedDimensions[i].resolvedLabel = dimDetails.label;
            logger.info('Resolved dimension:', dim.label, '->', dimDetails.fieldDefs[0]);
          } else {
            logger.warn('Could not resolve field for dimension:', dim.label);
          }
        }
      }

      // Check for duplicate resolved dimensions (critical for boxplot/scatterplot)
      // This can happen when drill-down dimensions like "Region > Store" resolve to just "Region"
      if (matchedDimensions.length >= 2) {
        var resolvedFields = matchedDimensions.map(function(d) {
          return cleanFieldName(d.resolvedField || d.field || '').toLowerCase();
        });
        var seenFields = {};
        var duplicates = [];
        resolvedFields.forEach(function(f, idx) {
          if (f && seenFields[f] !== undefined) {
            duplicates.push({ field: f, indices: [seenFields[f], idx] });
          } else if (f) {
            seenFields[f] = idx;
          }
        });

        if (duplicates.length > 0) {
          var dupInfo = duplicates.map(function(d) {
            return matchedDimensions[d.indices[0]].label + ' and ' + matchedDimensions[d.indices[1]].label + ' both resolve to [' + d.field + ']';
          }).join('; ');
          logger.warn('Duplicate resolved dimensions detected:', dupInfo);

          // For charts requiring different dimensions (boxplot, scatterplot), this is a critical error
          if (vizType === 'boxplot' || vizType === 'scatterplot' || vizType === 'distributionplot') {
            logger.error(vizType + ' requires different dimensions, but duplicates found');
            state.creatingChart = null;
            updateUI();
            return { error: vizType + ' requires 2 DIFFERENT dimensions. The selected dimensions (' + dupInfo + ') resolve to the same field. Please try with different dimensions.' };
          }

          // For other chart types, remove duplicates (keep first occurrence)
          matchedDimensions = matchedDimensions.filter(function(d, idx) {
            var field = cleanFieldName(d.resolvedField || d.field || '').toLowerCase();
            return resolvedFields.indexOf(field) === idx;
          });
          logger.info('Removed duplicate dimensions, keeping:', matchedDimensions.map(function(d) { return d.label; }).join(', '));
        }
      }

      // Then, resolve any master measure expressions to get expression + label
      for (var i = 0; i < matchedMeasures.length; i++) {
        var meas = matchedMeasures[i];
        if (meas.libraryId && !meas.expression) {
          logger.debug('Resolving master measure for:', meas.label);
          var details = await getMeasureDetails(meas.libraryId);
          if (details && details.expression) {
            matchedMeasures[i].expression = details.expression;
            // Also store label and numFormat for later use (Add to Sheet)
            if (details.label) matchedMeasures[i].resolvedLabel = details.label;
            if (details.numFormat) matchedMeasures[i].numFormat = details.numFormat;
            logger.info('Resolved measure:', meas.label, '->', details.expression.substring(0, 40) + '...');
          } else {
            logger.warn('Could not resolve expression for:', meas.label);
          }
        }
      }

      var cols = [];
      // Add all dimensions - always use qDef format for consistency (cannot mix qLibraryId with qDef)
      if (vizType !== 'kpi' && vizType !== 'gauge') {
        matchedDimensions.forEach(function(dim) {
          var fieldName = dim.resolvedField || dim.field;
          if (fieldName) {
            // Clean field name to prevent double brackets
            var cleanField = cleanFieldName(fieldName);
            cols.push({
              qDef: {
                qFieldDefs: ['[' + cleanField + ']'],
                qLabel: dim.resolvedLabel || dim.label || cleanField
              }
            });
            logger.debug('Viz API: Using dimension:', dim.resolvedLabel || dim.label, '-> field:', cleanField);
          } else {
            logger.warn('Skipping dimension without field:', dim.label);
          }
        });
      }
      // Add all measures - use object format with qLabel for proper axis labels
      // If any measure lacks expression after resolution, we cannot create the chart
      var measuresAdded = 0;
      for (var m = 0; m < matchedMeasures.length; m++) {
        var meas = matchedMeasures[m];
        if (meas.expression) {
          var cleanExpr = meas.expression.trim().replace(/[\r\n]+/g, ' ');
          if (!cleanExpr.startsWith('=')) {
            cleanExpr = '=' + cleanExpr;
          }
          // Use object format with qLabel to display proper label on axis instead of raw expression
          var measDef = {
            qDef: {
              qDef: cleanExpr,
              qLabel: meas.resolvedLabel || meas.label || ''
            }
          };
          // Add numFormat if available
          if (meas.numFormat) {
            measDef.qDef.qNumFormat = meas.numFormat;
          }
          cols.push(measDef);
          measuresAdded++;
          logger.debug('Viz API: Using measure:', meas.resolvedLabel || meas.label, '-> expr:', cleanExpr.substring(0, 40) + '...');
        } else if (meas.libraryId) {
          // Master measure that couldn't be resolved - this will fail
          logger.error('Master measure', meas.label, 'has no expression - cannot create chart');
          throw new Error('Could not resolve master measure: ' + meas.label);
        }
      }

      if (measuresAdded === 0 && matchedMeasures.length > 0) {
        throw new Error('No valid measures found for chart');
      }

      logger.debug('Columns:', JSON.stringify(cols));

      vizObject = await app.visualization.create(vizType, cols, {
        title: suggestion.title,
        subtitle: suggestion.insight || '',
        showTitles: true
      });
      objectId = vizObject.id;

      logger.debug('vizObject result:', vizObject);

      if (vizObject && objectId) {
        logger.info('Chart created:', objectId);
        state.createdChartModal = {
          objectId: objectId,
          title: suggestion.title,
          insight: suggestion.insight,
          chartType: suggestion.chartType,
          vizObject: vizObject,
          dimensions: matchedDimensions,
          measures: matchedMeasures,
          unmatchedFields: unmatchedFields
        };
        state.creatingChart = null;
        updateUI();
        return objectId;
      }
      throw new Error('Chart creation returned invalid object');

    } catch (err) {
      var errorMsg = err && err.message ? err.message : (err ? String(err) : 'Unknown error');
      logger.error('Chart creation failed:', errorMsg);
      logger.debug('Full error:', err);
      state.creatingChart = null;
      state.error = 'Could not create chart: ' + errorMsg;
      updateUI();
      return null;
    }
  }

  // Helper: Generate unique client ID for Qlik property panel
  function generateCId() {
    return 'cid_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  }

  // Helper: Build chart object definition for engine API
  // Uses complete templates from chart-templates.js
  // ASYNC: resolves master measure expressions to avoid qLibraryId issues
  async function buildChartDefinition(modal) {
    logger.info('Building chart definition for:', modal.title);
    var rawType = (modal.definition && modal.definition.visualization) || modal.chartType || 'barchart';
    var vizType = mapChartType(rawType);
    logger.debug('Chart type normalization:', rawType, '->', vizType);

    // Prepare dimensions array for template - resolve master dimensions
    var dimensions = [];
    if (vizType !== 'kpi' && vizType !== 'gauge' && modal.dimensions) {
      for (var d = 0; d < modal.dimensions.length; d++) {
        var dim = modal.dimensions[d];
        var fieldName = dim.resolvedField || dim.field;
        if (fieldName) {
          var cleanField = cleanFieldName(fieldName);
          logger.debug('Using dimension field:', cleanField);
          dimensions.push({ field: cleanField, label: dim.resolvedLabel || dim.label || cleanField });
        } else if (dim.libraryId) {
          // Resolve master dimension
          var dimDetails = await getDimensionDetails(dim.libraryId);
          if (dimDetails && dimDetails.fieldDefs && dimDetails.fieldDefs.length > 0) {
            var cleanField = cleanFieldName(dimDetails.fieldDefs[0]);
            logger.debug('Resolved master dimension:', dim.label, '->', cleanField);
            dimensions.push({ field: cleanField, label: dimDetails.label || dim.label || cleanField });
          } else {
            logger.warn('Could not resolve master dimension:', dim.label);
          }
        } else if (dim.label) {
          var cleanField = cleanFieldName(dim.label);
          dimensions.push({ field: cleanField, label: cleanField });
        }
      }
    }

    // Prepare measures array for template - use already resolved expressions if available
    var measures = [];
    if (modal.measures) {
      for (var i = 0; i < modal.measures.length; i++) {
        var meas = modal.measures[i];
        if (meas.expression) {
          // Use resolved label and numFormat if they were set during preview
          var measLabel = meas.resolvedLabel || meas.label;
          logger.debug('Using measure:', measLabel, ':', meas.expression.substring(0, 50));
          measures.push({
            expression: meas.expression,
            label: measLabel,
            numFormat: meas.numFormat || null
          });
        } else if (meas.libraryId) {
          // Resolve master measure - get expression, label, and numFormat
          var details = await getMeasureDetails(meas.libraryId);
          if (details && details.expression) {
            logger.debug('Resolved master measure:', meas.label, '->', details.expression.substring(0, 50) + '...');
            measures.push({
              expression: details.expression,
              label: details.label || meas.label,
              numFormat: details.numFormat
            });
          } else {
            // Fallback to libraryId if resolution fails
            logger.warn('Could not resolve master measure, using libraryId:', meas.label);
            measures.push({ libraryId: meas.libraryId, label: meas.label });
          }
        }
      }
    }

    // Use chart-templates module to build complete definition
    var def = chartTemplates.build(vizType, modal.title, modal.insight || '', dimensions, measures);
    logger.debug('Built chart from template:', vizType, 'dims:', dimensions.length, 'measures:', measures.length);

    return def;
  }

  // Helper: Check if error is permission-related
  function isPermissionError(err) {
    if (!err) return false;
    var msg = (err.message || err.toString() || '').toLowerCase();
    return msg.indexOf('permission') !== -1 ||
           msg.indexOf('access') !== -1 ||
           msg.indexOf('denied') !== -1 ||
           msg.indexOf('unauthorized') !== -1 ||
           msg.indexOf('forbidden') !== -1 ||
           msg.indexOf('not allowed') !== -1 ||
           msg.indexOf('read only') !== -1 ||
           msg.indexOf('readonly') !== -1;
  }

  // Helper: Show modal error message
  function showModalError(message) {
    state.modalError = message;
    updateUI();
    // Auto-clear after 5 seconds
    setTimeout(function() {
      if (state.modalError === message) {
        state.modalError = null;
        updateUI();
      }
    }, 5000);
  }

  // Add chart to current sheet
  async function addChartToSheet() {
    if (!state.createdChartModal || !state.app) {
      logger.error('No chart to add');
      return false;
    }

    try {
      var app = state.app;
      var modal = state.createdChartModal;

      logger.info('Adding chart to current sheet:', modal.title);

      var sheetId = state.currentSheetId;

      if (!app.model || !app.model.enigmaModel) {
        showModalError('Cannot access app engine. Please try again.');
        return false;
      }

      var enigmaApp = app.model.enigmaModel;

      // SOLUTION: Copy properties from working session object instead of using templates
      var chartDef;
      if (modal.vizObject && modal.vizObject.model) {
        try {
          // Get properties from the WORKING preview object
          var sessionProps = await modal.vizObject.model.getProperties();
          logger.info('Copying properties from working session object');

          // Clone and prepare for permanent object
          chartDef = JSON.parse(JSON.stringify(sessionProps));

          // Generate new qId for permanent object
          chartDef.qInfo = chartDef.qInfo || {};
          chartDef.qInfo.qId = undefined; // Let Qlik generate new ID

          logger.debug('Copied chart definition from session object');
        } catch (copyErr) {
          logger.warn('Could not copy session object properties:', copyErr.message);
          // Fallback to template
          chartDef = await buildChartDefinition(modal);
        }
      } else {
        // Fallback to template if no session object
        chartDef = await buildChartDefinition(modal);
      }
      logger.debug('Creating permanent chart object:', chartDef.visualization);

      var chartObject;
      try {
        chartObject = await enigmaApp.createObject(chartDef);
      } catch (createErr) {
        logger.error('Failed to create chart object:', createErr.message);
        if (isPermissionError(createErr)) {
          showModalError('You do not have permission to create objects in this app. Please contact your administrator.');
        } else {
          showModalError('Failed to create chart: ' + createErr.message);
        }
        return false;
      }

      if (!chartObject) {
        showModalError('Failed to create chart object. Please try again.');
        return false;
      }

      // Get the actual chart ID from the created object
      var chartId = chartObject.id;
      if (!chartId && chartObject.qInfo) {
        chartId = chartObject.qInfo.qId;
      }
      if (!chartId) {
        // Try to get it from layout
        try {
          var chartLayout = await chartObject.getLayout();
          chartId = chartLayout.qInfo.qId;
        } catch (e) {
          logger.debug('Could not get chart layout:', e.message);
        }
      }

      if (!chartId) {
        showModalError('Could not get chart ID. Please try again.');
        return false;
      }

      logger.info('Permanent chart created:', chartId);

      // Now add it to the current sheet
      logger.debug('Getting sheet object:', sheetId);
      var sheet;
      try {
        sheet = await enigmaApp.getObject(sheetId);
      } catch (sheetErr) {
        var sheetErrMsg = sheetErr ? (sheetErr.message || sheetErr.toString()) : 'Unknown error';
        logger.error('Failed to access sheet:', sheetErrMsg);
        if (isPermissionError(sheetErr)) {
          showModalError('You do not have permission to modify this sheet.');
        } else {
          showModalError('Cannot access the current sheet: ' + sheetErrMsg);
        }
        return false;
      }

      if (!sheet) {
        showModalError('Could not find the current sheet. Please refresh the page.');
        return false;
      }

      logger.debug('Got sheet object, getting properties...');
      var sheetProps;
      try {
        sheetProps = await sheet.getProperties();
      } catch (propsErr) {
        var propsErrMsg = propsErr ? (propsErr.message || propsErr.toString()) : 'Unknown error';
        logger.error('Failed to get sheet properties:', propsErrMsg);
        showModalError('Cannot read sheet properties. You may not have edit access.');
        return false;
      }
      logger.debug('Got sheet properties, cells count:', (sheetProps.cells || []).length);

      var cells = sheetProps.cells || [];

      // Find best position for new chart - stack vertically at column 0
      var SHEET_COLS = 24;  // Qlik sheet has 24 columns
      var CHART_COLS = 24;  // Full width chart for better visibility
      var CHART_ROWS = 8;   // Default chart height

      // Find the bottom of all existing cells to stack below
      var maxBottomRow = 0;
      cells.forEach(function(cell) {
        var bottom = (cell.row || 0) + (cell.rowspan || 6);
        if (bottom > maxBottomRow) maxBottomRow = bottom;
      });

      // Place new chart at bottom, column 0, full width
      var foundRow = maxBottomRow;
      var foundCol = 0;
      logger.info('Stacking chart vertically at row:', foundRow, 'full width');

      var newCell = {
        name: chartId,
        type: chartDef.visualization,
        col: foundCol,
        row: foundRow,
        colspan: CHART_COLS,
        rowspan: CHART_ROWS
      };

      cells.push(newCell);
      sheetProps.cells = cells;

      try {
        logger.debug('Setting sheet properties with new cell:', JSON.stringify(newCell));
        await sheet.setProperties(sheetProps);
      } catch (setErr) {
        var setErrMsg = setErr ? (setErr.message || setErr.toString() || JSON.stringify(setErr)) : 'Unknown error';
        logger.error('Failed to update sheet:', setErrMsg);
        if (isPermissionError(setErr)) {
          showModalError('You do not have permission to edit this sheet. The chart was created but could not be added.');
        } else {
          showModalError('Failed to add chart to sheet: ' + setErrMsg);
        }
        return false;
      }

      logger.info('Chart added to sheet successfully');
      closeChartModal();
      return true;

    } catch (err) {
      var errMsg = err ? (err.message || err.toString() || JSON.stringify(err)) : 'Unknown error';
      logger.error('Failed to add chart to sheet:', errMsg);
      logger.debug('Full error object:', err);
      if (isPermissionError(err)) {
        showModalError('You do not have permission to modify this app. Please open the app in edit mode or contact your administrator.');
      } else {
        showModalError('Could not add chart to sheet: ' + errMsg);
      }
      return false;
    }
  }

  // Add chart to new sheet
  async function addChartToNewSheet() {
    logger.info('addChartToNewSheet called');
    logger.debug('state.createdChartModal:', state.createdChartModal ? 'exists' : 'null');
    logger.debug('state.app:', state.app ? 'exists' : 'null');

    if (!state.createdChartModal || !state.app) {
      logger.error('No chart to add - createdChartModal:', !!state.createdChartModal, 'app:', !!state.app);
      showModalError('No chart data available. Please try creating the chart again.');
      return false;
    }

    try {
      var app = state.app;
      var modal = state.createdChartModal;

      logger.info('Creating new sheet with chart:', modal.title);
      logger.debug('Modal data:', JSON.stringify({
        title: modal.title,
        chartType: modal.chartType,
        hasDimensions: !!(modal.dimensions && modal.dimensions.length),
        hasMeasures: !!(modal.measures && modal.measures.length)
      }));

      if (!app.model || !app.model.enigmaModel) {
        showModalError('Cannot access app engine. Please try again.');
        return false;
      }

      var enigmaApp = app.model.enigmaModel;

      // SOLUTION: Copy properties from working session object instead of using templates
      var chartDef;
      if (modal.vizObject && modal.vizObject.model) {
        try {
          // Get properties from the WORKING preview object
          var sessionProps = await modal.vizObject.model.getProperties();
          logger.info('Copying properties from working session object (new sheet)');

          // Clone and prepare for permanent object
          chartDef = JSON.parse(JSON.stringify(sessionProps));

          // Generate new qId for permanent object
          chartDef.qInfo = chartDef.qInfo || {};
          chartDef.qInfo.qId = undefined; // Let Qlik generate new ID

          logger.debug('Copied chart definition from session object');
        } catch (copyErr) {
          logger.warn('Could not copy session object properties:', copyErr.message);
          // Fallback to template
          chartDef = await buildChartDefinition(modal);
        }
      } else {
        // Fallback to template if no session object
        chartDef = await buildChartDefinition(modal);
      }
      logger.debug('Creating permanent chart object:', chartDef.visualization);

      var chartObject;
      try {
        chartObject = await enigmaApp.createObject(chartDef);
      } catch (createErr) {
        logger.error('Failed to create chart object:', createErr.message);
        if (isPermissionError(createErr)) {
          showModalError('You do not have permission to create objects in this app. Please contact your administrator.');
        } else {
          showModalError('Failed to create chart: ' + createErr.message);
        }
        return false;
      }

      if (!chartObject) {
        showModalError('Failed to create chart object. Please try again.');
        return false;
      }

      logger.debug('Chart object created, getting ID...');

      // Get the actual chart ID from the created object
      var chartId = chartObject.id;
      if (!chartId && chartObject.qInfo) {
        chartId = chartObject.qInfo.qId;
      }
      if (!chartId) {
        // Try to get it from layout
        try {
          var chartLayout = await chartObject.getLayout();
          chartId = chartLayout.qInfo.qId;
        } catch (e) {
          logger.debug('Could not get chart layout:', e.message);
        }
      }

      if (!chartId) {
        showModalError('Could not get chart ID. Please try again.');
        return false;
      }

      logger.debug('Chart ID for new sheet:', chartId);
      logger.info('Chart object created successfully, ID:', chartId);

      // Create new sheet with the chart
      // Use Qlik Cloud compatible structure
      var newSheetProps = {
        qInfo: { qType: 'sheet' },
        qMetaDef: { title: modal.title + ' - Analysis' },
        rank: -1,
        thumbnail: { qStaticContentUrlDef: {} },
        cells: [{
          name: chartId,
          type: chartDef.visualization,
          col: 0,
          row: 0,
          colspan: 24,
          rowspan: 12,
          bounds: {
            x: 0,
            y: 0,
            width: 100,
            height: 100
          }
        }],
        columns: 24,
        rows: 12
      };

      logger.debug('Creating sheet with props:', JSON.stringify(newSheetProps));

      var newSheet;
      try {
        newSheet = await enigmaApp.createObject(newSheetProps);
      } catch (sheetErr) {
        logger.error('Failed to create new sheet:', sheetErr.message);
        if (isPermissionError(sheetErr)) {
          showModalError('You do not have permission to create new sheets in this app. Please contact your administrator.');
        } else {
          showModalError('Failed to create new sheet: ' + sheetErr.message);
        }
        return false;
      }

      if (!newSheet) {
        showModalError('Failed to create new sheet. Please try again.');
        return false;
      }

      // Get the actual sheet ID from the created object
      var sheetId = newSheet.id;
      if (!sheetId && newSheet.qInfo) {
        sheetId = newSheet.qInfo.qId;
      }
      if (!sheetId) {
        // Try to get it from layout
        try {
          var sheetLayout = await newSheet.getLayout();
          sheetId = sheetLayout.qInfo.qId;
        } catch (e) {
          logger.debug('Could not get sheet layout:', e.message);
        }
      }

      if (!sheetId) {
        showModalError('Could not get new sheet ID. Please try again.');
        return false;
      }

      logger.info('New sheet created:', sheetId);
      logger.debug('Sheet contains chart:', chartId);

      // Try to save the app to persist the sheet
      try {
        if (enigmaApp.doSave) {
          logger.debug('Saving app to persist new sheet...');
          await enigmaApp.doSave();
          logger.info('App saved successfully');
        }
      } catch (saveErr) {
        logger.debug('Could not save app (may not have permissions):', saveErr.message);
        // Continue anyway - sheet might still work as session object
      }

      // Close modal first
      closeChartModal();

      // Navigate to new sheet with a small delay to allow save to complete
      if (qlik.navigation && qlik.navigation.gotoSheet) {
        logger.debug('Navigating to new sheet:', sheetId);
        setTimeout(function() {
          qlik.navigation.gotoSheet(sheetId);
        }, 500);
      }

      return true;

    } catch (err) {
      logger.error('Failed to create new sheet:', err.message);
      if (isPermissionError(err)) {
        showModalError('You do not have permission to create sheets. Please open the app in edit mode or contact your administrator.');
      } else {
        showModalError('Could not create new sheet: ' + err.message);
      }
      return false;
    }
  }

  // Close chart modal
  function closeChartModal() {
    if (state.createdChartModal && state.createdChartModal.vizObject) {
      try {
        // Close/destroy the visualization to free resources
        state.createdChartModal.vizObject.close();
      } catch (e) {
        logger.debug('Could not close visualization:', e.message);
      }
    }
    state.createdChartModal = null;
    updateUI();
  }

  // HTML escape helper
  var escapeHtml = function(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // Markdown to HTML converter (escape first, then convert markdown)
  var markdownToHtml = function(text) {
    if (!text) return '';
    // First escape HTML
    var escaped = escapeHtml(text);

    // Pre-process: Split inline numbered items onto separate lines
    // Matches patterns like "1) Item text 2) Next item" or "1. Item 2. Next"
    escaped = escaped.replace(/(\s)(\d+[\)\.]\s*\*{0,2}[A-Z])/g, '\n$2');

    // Process line by line for better structure
    var lines = escaped.split('\n');
    var result = [];
    var inList = false;
    var listType = null; // 'ul' or 'ol'

    lines.forEach(function(line) {
      var trimmed = line.trim();

      // Section headers with emojis - can be "📊 Overview:" alone OR "📊 Overview: content here"
      var headerMatch = trimmed.match(/^((?:📊|📈|📉|⚠️|💡|✅|🎯|📋|🔍|💰|📌|🚀|⭐|🔔|📍|💼|📑|🏆|📝|🔑)\s*[^:]+:)\s*(.*)/);
      if (headerMatch) {
        if (inList) {
          result.push('</' + listType + '>');
          inList = false;
        }
        var header = headerMatch[1];
        var content = headerMatch[2] || '';
        // Apply bold to content
        content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        result.push('<div class="q2r-section-header"><span class="q2r-section-title">' + header + '</span> ' + content + '</div>');
      }
      // Numbered items (1) or 1. format)
      else if (/^\d+[\)\.]\s+/.test(trimmed)) {
        if (inList && listType !== 'ol') {
          result.push('</' + listType + '>');
          inList = false;
        }
        if (!inList) {
          result.push('<ol class="q2r-numbered-list">');
          inList = true;
          listType = 'ol';
        }
        var itemText = trimmed.replace(/^\d+[\)\.]\s*/, '');
        // Apply bold within list items
        itemText = itemText.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        result.push('<li>' + itemText + '</li>');
      }
      // Bullet points
      else if (/^[-•]\s+/.test(trimmed)) {
        if (inList && listType !== 'ul') {
          result.push('</' + listType + '>');
          inList = false;
        }
        if (!inList) {
          result.push('<ul class="q2r-bullet-list">');
          inList = true;
          listType = 'ul';
        }
        var itemText = trimmed.replace(/^[-•]\s+/, '');
        // Apply bold within list items
        itemText = itemText.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        result.push('<li>' + itemText + '</li>');
      }
      // Regular line
      else {
        if (inList) {
          result.push('</' + listType + '>');
          inList = false;
        }
        // Apply bold/italic
        var processed = line.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        processed = processed.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        // Clean up orphans
        processed = processed.replace(/\*\*[^<]*$/g, '');
        processed = processed.replace(/\*[^<]*$/g, '');
        result.push(processed);
      }
    });

    // Close any open list
    if (inList) {
      result.push('</' + listType + '>');
    }

    return result.join('\n');
  };

  // Storage helpers
  var storage = {
    getKey: function(appId, sheetId) {
      return STORAGE_PREFIX + appId + '_' + sheetId;
    },
    save: function(appId, sheetId, data) {
      try {
        var key = this.getKey(appId, sheetId);
        localStorage.setItem(key, JSON.stringify(data));
        logger.info('Summary saved to localStorage:', key);
        return true;
      } catch (e) {
        logger.warn('Failed to save to localStorage:', e.message);
        return false;
      }
    },
    load: function(appId, sheetId) {
      try {
        var key = this.getKey(appId, sheetId);
        var data = localStorage.getItem(key);
        if (data) {
          logger.info('Summary loaded from localStorage:', key);
          return JSON.parse(data);
        }
        return null;
      } catch (e) {
        logger.warn('Failed to load from localStorage:', e.message);
        return null;
      }
    },
    clear: function(appId, sheetId) {
      try {
        var key = this.getKey(appId, sheetId);
        localStorage.removeItem(key);
        logger.info('Summary cleared from localStorage:', key);
        return true;
      } catch (e) {
        logger.warn('Failed to clear localStorage:', e.message);
        return false;
      }
    }
  };

  // Format timestamp
  function formatTimestamp(isoString) {
    if (!isoString) return '';
    var date = new Date(isoString);
    return date.toLocaleString();
  }

  // Copy to clipboard helper (cross-browser)
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback for older browsers
    return new Promise(function(resolve) {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      resolve();
    });
  }

  // Strip markdown for plain text copy
  function stripMarkdownForCopy(text) {
    if (!text) return '';
    return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  }

  // Copy all insights to clipboard
  function copyAllInsights() {
    var text = '# Qlik2Review Analysis Report\n';
    text += 'Generated: ' + formatTimestamp(state.lastUpdated) + '\n\n';

    if (state.sheetSummary) {
      text += '## Sheet Summary\n' + stripMarkdownForCopy(state.sheetSummary) + '\n\n';
    }

    if (state.objectSummaries && state.objectSummaries.length > 0) {
      text += '## Object Insights\n\n';
      state.objectSummaries.forEach(function(obj) {
        if (!obj.error) {
          text += '### ' + (obj.title || 'Untitled') + ' (' + obj.type + ')\n';
          text += stripMarkdownForCopy(obj.summary) + '\n\n';
        }
      });
    }

    copyToClipboard(text).then(function() {
      showCopyFeedback('all');
    });
  }

  // Copy single object insight
  function copyObjectInsight(objectId) {
    var obj = state.objectSummaries.find(function(o) { return o.id === objectId; });
    if (!obj) return;

    var text = (obj.title || 'Untitled') + ' (' + obj.type + ')\n' + stripMarkdownForCopy(obj.summary);
    copyToClipboard(text).then(function() {
      showCopyFeedback(objectId);
    });
  }

  // Show copy feedback
  function showCopyFeedback(id) {
    state.copyFeedback = { id: id, timestamp: Date.now() };
    updateUI();
    setTrackedTimeout(function() {
      state.copyFeedback = null;
      updateUI();
    }, 2000);
  }

  // Build the UI HTML
  function buildUI(layout) {
    var bgColor = (layout.appearance && layout.appearance.backgroundColor && layout.appearance.backgroundColor.color) || '#ffffff';
    var textColor = (layout.appearance && layout.appearance.textColor && layout.appearance.textColor.color) || '#333333';
    var accentColor = (layout.appearance && layout.appearance.accentColor && layout.appearance.accentColor.color) || '#009845';
    var fontSize = (layout.appearance && layout.appearance.fontSize) || 'medium';
    var showTimestamp = layout.appearance && layout.appearance.showTimestamp !== false;
    var showSheetSummary = !layout.outputSettings || layout.outputSettings.showSheetSummary !== false;
    var showObjectList = !layout.outputSettings || layout.outputSettings.showObjectList !== false;
    var showCopyButtons = !layout.outputSettings || layout.outputSettings.showCopyButtons !== false;
    var showTokenCost = layout.outputSettings && layout.outputSettings.showTokenCost === true;
    var topbarVisibility = (layout.appearance && layout.appearance.topbarVisibility) || 'always';

    var html = '<div class="qlik2review-container" style="background-color:' + bgColor + ';color:' + textColor + ';">';

    // Header - force visible during analysis to prevent flicker on hover mode
    var headerClass = 'q2r-header';
    if (topbarVisibility === 'hover' && !state.isAnalyzing) {
      headerClass += ' q2r-header-hover';
    }
    html += '<div class="' + headerClass + '">';
    html += '<div class="q2r-title"><span class="q2r-icon">&#9733;</span><span>Qlik2Review</span></div>';
    html += '<div class="q2r-actions">';

    if (!state.isAnalyzing) {
      html += '<button class="q2r-btn q2r-btn-primary" id="q2r-analyze-btn" style="background-color:' + accentColor + ';">&#10024; Analyze</button>';
    } else {
      html += '<button class="q2r-btn q2r-btn-danger" id="q2r-cancel-btn">Cancel</button>';
    }

    html += '<button class="q2r-btn q2r-btn-secondary" id="q2r-pdf-btn"' + (state.isAnalyzing || !state.sheetSummary ? ' disabled' : '') + '>&#128196; PDF</button>';
    if (state.copyFeedback && state.copyFeedback.id === 'all') {
      html += '<button class="q2r-btn q2r-btn-copied" disabled>&#10003; Copied</button>';
    } else {
      html += '<button class="q2r-btn q2r-btn-secondary" id="q2r-copy-all-btn"' + (state.isAnalyzing || !state.sheetSummary ? ' disabled' : '') + '>&#128203; Copy</button>';
    }
    // Compare toggle button
    var comparisonEnabled = layout.comparisonSettings && layout.comparisonSettings.enabled;
    var hasComparison = comparisonEnabled && state.comparisonResult && (
      state.comparisonResult.changedObjects.length > 0 ||
      state.comparisonResult.newObjects.length > 0 ||
      state.comparisonResult.removedObjects.length > 0 ||
      state.comparisonResult.sheetSummaryChanged
    );
    if (hasComparison) {
      html += '<button class="q2r-btn' + (state.showComparison ? ' q2r-btn-compare-active' : ' q2r-btn-compare') + '" id="q2r-compare-btn">&#128260; Compare</button>';
    }
    // Save bookmark button
    var bookmarksEnabled = layout.bookmarkSettings && layout.bookmarkSettings.enabled;
    if (bookmarksEnabled && state.sheetSummary && !state.isAnalyzing && !state.viewingSavedId) {
      html += '<button class="q2r-btn q2r-btn-bookmark" id="q2r-save-btn">&#128278; Save</button>';
    }
    html += '<button class="q2r-btn q2r-btn-secondary" id="q2r-clear-btn"' + (state.isAnalyzing || !state.sheetSummary ? ' disabled' : '') + '>Clear</button>';
    // Clear Footnotes button - only visible in edit mode when there are analyzed objects
    if (state.isEditMode && state.objectSummaries.length > 0 && !state.isAnalyzing) {
      html += '<button class="q2r-btn q2r-btn-secondary" id="q2r-clear-footnotes-btn" title="Clear AI footnotes from all analyzed objects">&#128465; Clear Footnotes</button>';
    }
    html += '</div></div>';

    // Alert summary counts - always show when alerts enabled
    var alertsEnabled = layout.insightAlerts && layout.insightAlerts.enabled;
    if (alertsEnabled && state.sheetSummary && !state.isAnalyzing) {
      html += '<div class="q2r-alert-summary">';
      if (state.alertCounts.warning > 0) {
        html += '<span class="q2r-alert-badge q2r-alert-warning">&#9888; ' + state.alertCounts.warning + ' Warning' + (state.alertCounts.warning > 1 ? 's' : '') + '</span>';
      }
      if (state.alertCounts.positive > 0) {
        html += '<span class="q2r-alert-badge q2r-alert-positive">&#10004; ' + state.alertCounts.positive + ' Positive</span>';
      }
      if (state.alertCounts.warning === 0 && state.alertCounts.positive === 0) {
        html += '<span class="q2r-alert-badge q2r-alert-neutral">&#10003; No alerts - ' + state.alertCounts.neutral + ' objects clear</span>';
      }
      html += '</div>';
    }

    // Selection changed banner
    var detectSelectionChange = layout.outputSettings && layout.outputSettings.detectSelectionChange;
    if (detectSelectionChange && state.selectionsChanged && state.sheetSummary && !state.isAnalyzing) {
      html += '<div class="q2r-selection-changed">';
      html += '<span class="q2r-selection-icon">&#128260;</span>';
      html += '<span>Selections changed since last analysis</span>';
      html += '<button class="q2r-btn q2r-btn-refresh" id="q2r-refresh-btn">Refresh</button>';
      html += '</div>';
    }

    // Comparison Panel
    if (state.showComparison && state.comparisonResult) {
      var comp = state.comparisonResult;
      html += '<div class="q2r-comparison-panel">';
      html += '<div class="q2r-comparison-header">';
      html += '<span>&#128260; Comparison with previous analysis</span>';
      html += '<span class="q2r-comparison-timestamp">Previous: ' + formatTimestamp(comp.previousTimestamp) + '</span>';
      html += '</div>';

      // Summary of changes
      var totalChanges = comp.changedObjects.length + comp.newObjects.length + comp.removedObjects.length;
      html += '<div class="q2r-comparison-summary">';
      if (comp.changedObjects.length > 0) {
        html += '<span class="q2r-comp-badge q2r-comp-changed">' + comp.changedObjects.length + ' Changed</span>';
      }
      if (comp.newObjects.length > 0) {
        html += '<span class="q2r-comp-badge q2r-comp-new">' + comp.newObjects.length + ' New</span>';
      }
      if (comp.removedObjects.length > 0) {
        html += '<span class="q2r-comp-badge q2r-comp-removed">' + comp.removedObjects.length + ' Removed</span>';
      }
      if (comp.sheetSummaryChanged) {
        html += '<span class="q2r-comp-badge q2r-comp-changed">Sheet Summary Changed</span>';
      }
      html += '</div>';

      // Changed objects detail
      if (comp.changedObjects.length > 0) {
        html += '<div class="q2r-comp-section">';
        html += '<div class="q2r-comp-section-title">Changed Objects</div>';
        comp.changedObjects.forEach(function(obj) {
          html += '<div class="q2r-comp-item q2r-comp-item-changed">';
          html += '<div class="q2r-comp-item-header">' + escapeHtml(obj.title || 'Untitled') + ' <span class="q2r-comp-type">(' + escapeHtml(obj.type) + ')</span></div>';
          html += '<div class="q2r-comp-diff">';
          html += '<div class="q2r-comp-prev"><strong>Before:</strong> ' + markdownToHtml(obj.previousSummary) + '</div>';
          html += '<div class="q2r-comp-curr"><strong>After:</strong> ' + markdownToHtml(obj.currentSummary) + '</div>';
          html += '</div></div>';
        });
        html += '</div>';
      }

      // New objects
      if (comp.newObjects.length > 0) {
        html += '<div class="q2r-comp-section">';
        html += '<div class="q2r-comp-section-title">New Objects</div>';
        comp.newObjects.forEach(function(obj) {
          html += '<div class="q2r-comp-item q2r-comp-item-new">';
          html += '<div class="q2r-comp-item-header">' + escapeHtml(obj.title || 'Untitled') + ' <span class="q2r-comp-type">(' + escapeHtml(obj.type) + ')</span></div>';
          html += '<div class="q2r-comp-content">' + markdownToHtml(obj.summary) + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }

      // Removed objects
      if (comp.removedObjects.length > 0) {
        html += '<div class="q2r-comp-section">';
        html += '<div class="q2r-comp-section-title">Removed Objects</div>';
        comp.removedObjects.forEach(function(obj) {
          html += '<div class="q2r-comp-item q2r-comp-item-removed">';
          html += '<div class="q2r-comp-item-header">' + escapeHtml(obj.title || 'Untitled') + ' <span class="q2r-comp-type">(' + escapeHtml(obj.type) + ')</span></div>';
          html += '<div class="q2r-comp-content">' + markdownToHtml(obj.summary) + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }

      html += '</div>';
    }

    // Viewing saved analysis banner
    if (bookmarksEnabled && state.viewingSavedId) {
      var viewingBookmark = state.savedAnalyses.find(function(b) { return b.id === state.viewingSavedId; });
      if (viewingBookmark) {
        html += '<div class="q2r-viewing-banner">';
        html += '<span class="q2r-viewing-icon">&#128278;</span>';
        html += '<span>Viewing: <strong>' + escapeHtml(viewingBookmark.name) + '</strong></span>';
        html += '<button class="q2r-btn q2r-btn-return" id="q2r-return-btn">Return to Current</button>';
        html += '</div>';
      }
    }

    // Bookmarks list
    if (bookmarksEnabled && state.savedAnalyses.length > 0 && !state.isAnalyzing) {
      html += '<div class="q2r-bookmarks-section">';
      html += '<div class="q2r-bookmarks-header" id="q2r-bookmarks-toggle">';
      html += '<span class="q2r-section-icon">&#128278;</span>';
      html += '<span>Saved Analyses (' + state.savedAnalyses.length + ')</span>';
      html += '<span class="q2r-collapse-arrow' + (state.bookmarksExpanded ? ' q2r-expanded' : '') + '">&#9660;</span>';
      html += '</div>';
      html += '<div class="q2r-bookmarks-list" style="display:' + (state.bookmarksExpanded ? 'flex' : 'none') + ';">';

      state.savedAnalyses.forEach(function(bookmark) {
        var isActive = state.viewingSavedId === bookmark.id;
        html += '<div class="q2r-bookmark-item' + (isActive ? ' q2r-bookmark-active' : '') + '">';
        html += '<div class="q2r-bookmark-info">';
        html += '<span class="q2r-bookmark-name">' + escapeHtml(bookmark.name) + '</span>';
        html += '<span class="q2r-bookmark-date">' + formatTimestamp(bookmark.timestamp) + '</span>';
        html += '</div>';
        html += '<div class="q2r-bookmark-actions">';
        if (!isActive) {
          html += '<button class="q2r-btn-sm q2r-btn-load" data-bookmark-id="' + bookmark.id + '">Load</button>';
        }
        html += '<button class="q2r-btn-sm q2r-btn-delete" data-bookmark-id="' + bookmark.id + '">&#128465;</button>';
        html += '</div>';
        html += '</div>';
      });

      html += '</div></div>';
    }

    // Progress
    if (state.isAnalyzing && state.progress) {
      html += '<div class="q2r-progress"><div class="q2r-spinner-small"></div><span>' + escapeHtml(state.progress) + '</span></div>';
    }

    // Error
    if (state.error) {
      html += '<div class="q2r-error"><span class="q2r-error-icon">&#9888;</span><span>' + escapeHtml(state.error) + '</span></div>';
    }

    // Timestamp
    if (state.lastUpdated && showTimestamp) {
      html += '<div class="q2r-timestamp">Last updated: ' + formatTimestamp(state.lastUpdated) + '</div>';
    }

    // Token/Cost display
    if (showTokenCost && state.usage && state.usage.totalTokens > 0) {
      var cost = state.usage.estimatedCost || 0;
      var costStr = cost < 0.001 ? '<$0.001' : (cost < 0.01 ? '$' + cost.toFixed(4) : '$' + cost.toFixed(3));
      var tokensStr = state.usage.totalTokens >= 1000 ? (state.usage.totalTokens / 1000).toFixed(1) + 'K' : state.usage.totalTokens.toString();
      html += '<div class="q2r-token-cost">';
      html += '<span class="q2r-token-icon">&#128176;</span>';
      html += '<span>' + tokensStr + ' tokens (~' + costStr + ')</span>';
      html += '</div>';
    }

    // Sheet Summary
    if (showSheetSummary && state.sheetSummary) {
      html += '<div class="q2r-section">';
      html += '<div class="q2r-section-header"><span class="q2r-section-icon">&#128202;</span><span>Sheet Summary</span></div>';
      html += '<div class="q2r-summary-content q2r-font-' + fontSize + '">' + markdownToHtml(state.sheetSummary).replace(/\n/g, '<br>') + '</div>';
      html += '</div>';
    }

    // Dive Deeper Suggestions (default: true)
    var diveDeeperEnabled = !layout.diveDeeper || layout.diveDeeper.enabled !== false;
    if (diveDeeperEnabled && state.diveDeeperSuggestions && state.sheetSummary) {
      html += '<div class="q2r-section q2r-dive-deeper">';
      html += '<div class="q2r-section-header"><span class="q2r-section-icon">&#128161;</span><span>Dive Deeper</span></div>';
      html += '<div class="q2r-dive-deeper-content q2r-font-' + fontSize + '">';

      // Check if we have parsed JSON suggestions
      if (state.parsedSuggestions && state.parsedSuggestions.length > 0) {
        // Render structured suggestions with Create buttons
        state.parsedSuggestions.forEach(function(sug) {
          var isCreating = state.creatingChart === sug.id;
          html += '<div class="q2r-suggestion-card">';
          html += '<div class="q2r-suggestion-header">';
          html += '<span class="q2r-suggestion-type" style="border-color:' + accentColor + ';color:' + accentColor + ';">' + escapeHtml(sug.chartType) + '</span>';
          html += '<span class="q2r-suggestion-title">' + escapeHtml(sug.title) + '</span>';
          html += '</div>';
          html += '<div class="q2r-suggestion-details">';
          if (sug.dimensions && sug.dimensions.length > 0) {
            sug.dimensions.forEach(function(dim) {
              html += '<span class="q2r-suggestion-field">&#128202; ' + escapeHtml(dim) + '</span>';
            });
          }
          if (sug.measures && sug.measures.length > 0) {
            sug.measures.forEach(function(mea) {
              html += '<span class="q2r-suggestion-field">&#128200; ' + escapeHtml(mea) + '</span>';
            });
          }
          html += '</div>';
          if (sug.insight) {
            html += '<div class="q2r-suggestion-insight">' + escapeHtml(sug.insight) + '</div>';
          }
          html += '<div class="q2r-suggestion-actions">';
          if (isCreating) {
            html += '<button class="q2r-btn q2r-btn-create q2r-btn-creating" disabled><span class="q2r-spinner-tiny"></span> Creating...</button>';
          } else {
            html += '<button class="q2r-btn q2r-btn-create" data-suggestion-id="' + sug.id + '" style="background-color:' + accentColor + ';">&#10024; Create</button>';
          }
          html += '</div>';
          html += '</div>';
        });
      } else {
        // Fallback: show raw text (old format or parse failure)
        var suggestions = state.diveDeeperSuggestions.split('\n').filter(function(line) {
          return line.trim().length > 0;
        });
        suggestions.forEach(function(suggestion) {
          html += '<div class="q2r-suggestion-item">' + markdownToHtml(suggestion) + '</div>';
        });
      }

      html += '</div></div>';
    }

    // Chart Modal
    if (state.createdChartModal) {
      html += '<div class="q2r-modal-overlay" id="q2r-modal-overlay">';
      html += '<div class="q2r-modal">';
      html += '<div class="q2r-modal-header">';
      html += '<span class="q2r-modal-title">' + escapeHtml(state.createdChartModal.title) + '</span>';
      html += '<button class="q2r-modal-close" id="q2r-modal-close">&#10005;</button>';
      html += '</div>';
      html += '<div class="q2r-modal-body">';
      html += '<div class="q2r-chart-container" id="q2r-chart-container"></div>';
      if (state.createdChartModal.insight) {
        html += '<div class="q2r-modal-insight">' + escapeHtml(state.createdChartModal.insight) + '</div>';
      }
      // Show warning if some fields weren't found
      if (state.createdChartModal.unmatchedFields && state.createdChartModal.unmatchedFields.length > 0) {
        var unmatchedNames = state.createdChartModal.unmatchedFields.map(function(f) { return '"' + f.name + '"'; }).join(', ');
        html += '<div class="q2r-modal-warning">&#9888; Fields not found: ' + escapeHtml(unmatchedNames) + '. AI used names not in field list.</div>';
      }
      html += '</div>';
      html += '<div class="q2r-modal-footer">';
      if (state.modalError) {
        html += '<div class="q2r-modal-error">' + escapeHtml(state.modalError) + '</div>';
      }
      html += '<div class="q2r-modal-actions">';
      if (state.isEditMode) {
        html += '<button class="q2r-btn q2r-btn-secondary" id="q2r-add-to-sheet">Add to Current Sheet</button>';
      }
      html += '<button class="q2r-btn q2r-btn-primary" id="q2r-add-to-new-sheet">Add to New Sheet</button>';
      html += '</div>';
      html += '<span class="q2r-modal-hint">Preview chart - click a button above to add it permanently.</span>';
      html += '</div>';
      html += '</div>';
      html += '</div>';
    }

    // Object Summaries
    if (showObjectList && state.objectSummaries.length > 0) {
      html += '<div class="q2r-section">';
      html += '<div class="q2r-section-header q2r-collapsible" id="q2r-objects-toggle">';
      html += '<span class="q2r-section-icon">&#128200;</span>';
      html += '<span>Object Insights (' + state.objectSummaries.length + ')</span>';
      html += '<span class="q2r-collapse-arrow' + (state.objectsExpanded ? ' q2r-expanded' : '') + '">&#9660;</span>';
      html += '</div>';
      html += '<div class="q2r-objects-list" style="display:' + (state.objectsExpanded ? 'flex' : 'none') + ';">';

      var highlightObjects = alertsEnabled && layout.insightAlerts && layout.insightAlerts.highlightObjects !== false;
      state.objectSummaries.forEach(function(obj) {
        var alertStatus = state.alertStatuses[obj.id] || 'neutral';
        var alertClass = (highlightObjects && alertStatus !== 'neutral') ? ' q2r-object-' + alertStatus : '';
        html += '<div class="q2r-object-item' + (obj.error ? ' q2r-object-error' : '') + alertClass + '">';
        html += '<div class="q2r-object-header">';
        html += '<span class="q2r-object-type" style="border-color:' + accentColor + ';color:' + accentColor + ';">' + escapeHtml(obj.type) + '</span>';
        html += '<span class="q2r-object-title">' + escapeHtml(obj.title) + '</span>';
        if (highlightObjects && alertStatus === 'warning') {
          html += '<span class="q2r-object-alert-icon">&#9888;</span>';
        } else if (highlightObjects && alertStatus === 'positive') {
          html += '<span class="q2r-object-positive-icon">&#10004;</span>';
        }
        if (showCopyButtons && !obj.error) {
          if (state.copyFeedback && state.copyFeedback.id === obj.id) {
            html += '<span class="q2r-copy-obj-done">&#10003;</span>';
          } else {
            html += '<button class="q2r-copy-obj-btn" data-object-id="' + obj.id + '" title="Copy insight">&#128203;</button>';
          }
        }
        html += '</div>';
        html += '<div class="q2r-object-summary q2r-font-' + fontSize + '">' + markdownToHtml(obj.summary) + '</div>';
        html += '</div>';
      });

      html += '</div></div>';
    }

    // Empty State
    if (!state.sheetSummary && !state.isAnalyzing && !state.error) {
      html += '<div class="q2r-empty">';
      html += '<div class="q2r-empty-icon">&#128269;</div>';
      html += '<div class="q2r-empty-text">Click "&#10024; Analyze" to generate AI-powered insights</div>';
      html += '<div class="q2r-empty-hint">Configure your AI provider in the extension properties</div>';
      html += '</div>';
    }

    // Loading State
    if (state.isAnalyzing && !state.progress) {
      html += '<div class="q2r-loading">';
      html += '<div class="q2r-spinner"></div>';
      html += '<div class="q2r-loading-text">Analyzing sheet objects...</div>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  // Update UI
  function updateUI() {
    if (!state.element) return;

    var element = state.element[0] || state.element;
    element.innerHTML = buildUI(state.layout);

    // Attach event listeners
    attachEventListeners(element);
  }

  // Attach event listeners
  function attachEventListeners(element) {
    var analyzeBtn = element.querySelector('#q2r-analyze-btn');
    var cancelBtn = element.querySelector('#q2r-cancel-btn');
    var pdfBtn = element.querySelector('#q2r-pdf-btn');
    var copyAllBtn = element.querySelector('#q2r-copy-all-btn');
    var clearBtn = element.querySelector('#q2r-clear-btn');
    var refreshBtn = element.querySelector('#q2r-refresh-btn');
    var objectsToggle = element.querySelector('#q2r-objects-toggle');
    var copyObjBtns = element.querySelectorAll('.q2r-copy-obj-btn');

    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', analyzeSheet);
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', cancelAnalysis);
    }
    if (pdfBtn) {
      pdfBtn.addEventListener('click', exportPDF);
    }
    if (copyAllBtn) {
      copyAllBtn.addEventListener('click', copyAllInsights);
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', clearSummaries);
    }
    var clearFootnotesBtn = element.querySelector('#q2r-clear-footnotes-btn');
    if (clearFootnotesBtn) {
      clearFootnotesBtn.addEventListener('click', clearFootnotes);
    }
    if (refreshBtn) {
      refreshBtn.addEventListener('click', analyzeSheet);
    }
    var compareBtn = element.querySelector('#q2r-compare-btn');
    if (compareBtn) {
      compareBtn.addEventListener('click', toggleComparison);
    }
    if (objectsToggle) {
      objectsToggle.addEventListener('click', toggleObjects);
    }
    // Bookmark buttons
    var saveBtn = element.querySelector('#q2r-save-btn');
    var returnBtn = element.querySelector('#q2r-return-btn');
    var bookmarksToggle = element.querySelector('#q2r-bookmarks-toggle');
    var loadBtns = element.querySelectorAll('.q2r-btn-load');
    var deleteBtns = element.querySelectorAll('.q2r-btn-delete');

    if (saveBtn) {
      saveBtn.addEventListener('click', saveBookmark);
    }
    if (returnBtn) {
      returnBtn.addEventListener('click', returnToCurrent);
    }
    if (bookmarksToggle) {
      bookmarksToggle.addEventListener('click', toggleBookmarks);
    }
    loadBtns.forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var bookmarkId = btn.getAttribute('data-bookmark-id');
        if (bookmarkId) loadBookmark(bookmarkId);
      });
    });
    deleteBtns.forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var bookmarkId = btn.getAttribute('data-bookmark-id');
        if (bookmarkId && confirm('Delete this saved analysis?')) {
          deleteBookmark(bookmarkId);
        }
      });
    });
    // Copy buttons for individual objects
    copyObjBtns.forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var objectId = btn.getAttribute('data-object-id');
        if (objectId) copyObjectInsight(objectId);
      });
    });

    // Create chart buttons for suggestions
    var createBtns = element.querySelectorAll('.q2r-btn-create[data-suggestion-id]');
    createBtns.forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var suggestionId = btn.getAttribute('data-suggestion-id');
        if (suggestionId && state.parsedSuggestions) {
          var suggestion = state.parsedSuggestions.find(function(s) { return s.id === suggestionId; });
          if (suggestion) {
            createChartFromSuggestion(suggestion);
          }
        }
      });
    });

    // Modal close handlers
    var modalOverlay = element.querySelector('#q2r-modal-overlay');
    var modalClose = element.querySelector('#q2r-modal-close');
    if (modalClose) {
      modalClose.addEventListener('click', closeChartModal);
    }
    if (modalOverlay) {
      modalOverlay.addEventListener('click', function(e) {
        // Close if clicked on overlay (not modal content)
        if (e.target === modalOverlay) {
          closeChartModal();
        }
      });
    }

    // Add-to-sheet button handlers
    var addToSheetBtn = element.querySelector('#q2r-add-to-sheet');
    var addToNewSheetBtn = element.querySelector('#q2r-add-to-new-sheet');
    if (addToSheetBtn) {
      addToSheetBtn.addEventListener('click', function() {
        addChartToSheet();
      });
    }
    if (addToNewSheetBtn) {
      addToNewSheetBtn.addEventListener('click', function() {
        logger.info('Add to New Sheet button clicked');
        addChartToNewSheet().then(function(result) {
          logger.info('Add to New Sheet result:', result);
        }).catch(function(err) {
          logger.error('Add to New Sheet failed:', err);
          showModalError('Failed to add to new sheet: ' + (err.message || err));
        });
      });
    }

    // Render chart in modal if exists
    if (state.createdChartModal && state.createdChartModal.vizObject) {
      var chartContainer = element.querySelector('#q2r-chart-container');
      if (chartContainer) {
        // Use the visualization object's show method
        try {
          state.createdChartModal.vizObject.show(chartContainer);
        } catch (err) {
          logger.error('Could not render chart:', err.message);
          chartContainer.innerHTML = '<div class="q2r-chart-error">Could not render chart preview</div>';
        }
      }
    }
  }

  // Toggle objects section
  function toggleObjects() {
    state.objectsExpanded = !state.objectsExpanded;
    updateUI();
  }

  // Toggle comparison panel
  function toggleComparison() {
    state.showComparison = !state.showComparison;
    updateUI();
  }

  // Toggle bookmarks list
  function toggleBookmarks() {
    state.bookmarksExpanded = !state.bookmarksExpanded;
    updateUI();
  }

  // Save current analysis as bookmark
  function saveBookmark() {
    if (!state.sheetSummary) return;

    var name = prompt('Enter a name for this bookmark:', 'Analysis ' + new Date().toLocaleString());
    if (!name) return;

    var layout = state.layout;
    var maxBookmarks = (layout.bookmarkSettings && layout.bookmarkSettings.maxBookmarks) || 10;
    var appId = state.app ? state.app.id : 'unknown';
    var sheetId = state.currentSheetId || 'unknown';

    var bookmark = {
      id: generateId(),
      name: name,
      timestamp: state.lastUpdated,
      sheetSummary: state.sheetSummary,
      objectSummaries: state.objectSummaries,
      usage: state.usage,
      selectionHash: state.lastSelectionHash
    };

    // Load existing bookmarks
    var bookmarks = loadBookmarks(appId, sheetId);

    // Add new bookmark at the beginning
    bookmarks.unshift(bookmark);

    // Enforce max limit (FIFO eviction)
    if (bookmarks.length > maxBookmarks) {
      bookmarks = bookmarks.slice(0, maxBookmarks);
    }

    // Save to storage
    saveBookmarksToStorage(appId, sheetId, bookmarks);
    state.savedAnalyses = bookmarks;

    logger.info('Bookmark saved:', name);
    updateUI();
  }

  // Load a saved bookmark
  function loadBookmark(bookmarkId) {
    var bookmark = state.savedAnalyses.find(function(b) { return b.id === bookmarkId; });
    if (!bookmark) return;

    state.viewingSavedId = bookmarkId;
    state.sheetSummary = bookmark.sheetSummary;
    state.objectSummaries = bookmark.objectSummaries;
    state.usage = bookmark.usage;
    state.lastUpdated = bookmark.timestamp;

    // Recalculate alert statuses for loaded bookmark
    updateAlertStatuses(state.layout);

    logger.info('Bookmark loaded:', bookmark.name);
    updateUI();
  }

  // Return to current analysis
  function returnToCurrent() {
    state.viewingSavedId = null;

    // Reload from cache
    var appId = state.app ? state.app.id : 'unknown';
    var sheetId = state.currentSheetId;
    var layout = state.layout;
    if (sheetId) {
      var cached = storage.load(appId, sheetId);
      if (cached) {
        state.sheetSummary = cached.sheetSummary;
        state.objectSummaries = cached.objectSummaries || [];
        state.usage = cached.usage || null;
        state.lastUpdated = cached.lastUpdated;
        state.diveDeeperSuggestions = cached.diveDeeperSuggestions || null;

        // Recalculate alert statuses
        updateAlertStatuses(layout);
      } else {
        state.sheetSummary = null;
        state.objectSummaries = [];
        state.usage = null;
        state.lastUpdated = null;
        state.alertStatuses = {};
        state.alertCounts = { warning: 0, positive: 0, neutral: 0 };
        state.diveDeeperSuggestions = null;
      }
    }

    logger.info('Returned to current analysis');
    updateUI();
  }

  // Delete a saved bookmark
  function deleteBookmark(bookmarkId) {
    var appId = state.app ? state.app.id : 'unknown';
    var sheetId = state.currentSheetId || 'unknown';

    state.savedAnalyses = state.savedAnalyses.filter(function(b) { return b.id !== bookmarkId; });
    saveBookmarksToStorage(appId, sheetId, state.savedAnalyses);

    // If currently viewing the deleted bookmark, return to current
    if (state.viewingSavedId === bookmarkId) {
      returnToCurrent();
    } else {
      updateUI();
    }

    logger.info('Bookmark deleted');
  }

  // Cancel analysis
  function cancelAnalysis() {
    logger.info('Cancellation requested');
    cancelToken.cancelled = true;
    state.isAnalyzing = false;
    state.progress = 'Cancelled';
    state.error = 'Analysis cancelled by user';
    updateUI();
  }

  // Analyze sheet
  async function analyzeSheet() {
    if (state.isAnalyzing) return;

    // Clear any pending auto-analyze timer to prevent race conditions
    if (state.autoAnalyzeTimer) {
      clearTimeout(state.autoAnalyzeTimer);
      state.autoAnalyzeTimer = null;
    }
    // Reset selection change flag since we're analyzing now
    state.selectionsChanged = false;

    cancelToken.cancelled = false;
    var endTimer = logger.time('Sheet Analysis');
    logger.info('Starting sheet analysis...');

    state.isAnalyzing = true;
    state.error = null;
    state.progress = 'Initializing...';
    updateUI();

    try {
      var layout = state.layout;
      var app = state.app;
      var appId = app.id || 'unknown';

      // Get configuration
      var objectFilter = layout.objectFilter || {};
      var useCustom = layout.aiSettings && layout.aiSettings.useCustomPrompt;
      var customPrompt = useCustom ? (layout.aiSettings.customPrompt || '') : '';
      var useCustomSheet = layout.aiSettings && layout.aiSettings.useCustomSheetPrompt;
      var customSheetPrompt = useCustomSheet ? (layout.aiSettings.customSheetPrompt || '') : '';
      var useCustomSuggestions = layout.aiSettings && layout.aiSettings.useCustomSuggestionsPrompt;
      var customSuggestionsPrompt = useCustomSuggestions ? (layout.aiSettings.customSuggestionsPrompt || '') : '';

      var config = {
        provider: (layout.aiSettings && layout.aiSettings.provider) || 'openai',
        apiKey: (layout.aiSettings && layout.aiSettings.apiKey) || '',
        model: (layout.aiSettings && layout.aiSettings.model) || '',
        language: (layout.aiSettings && layout.aiSettings.responseLanguage) || 'en',
        customPrompt: customPrompt,
        customSheetPrompt: customSheetPrompt,
        customSuggestionsPrompt: customSuggestionsPrompt,
        objectFilter: objectFilter,
        excludedIds: objectFilter.excludedIds || '',
        maxCharsPerObject: (layout.outputSettings && layout.outputSettings.maxCharsPerObject) || 300,
        rowLimit: (layout.dataSettings && layout.dataSettings.rowLimit) || 50,
        dataFormat: (layout.dataSettings && layout.dataSettings.dataFormat) || 'compressed'
      };

      logger.debug('Analysis config:', { provider: config.provider, model: config.model || '(default)', hasApiKey: !!config.apiKey, dataFormat: config.dataFormat, rowLimit: config.rowLimit });

      if (!config.apiKey) {
        throw new Error('API key is required. Please configure in extension properties.');
      }

      if (cancelToken.cancelled) throw new Error('Analysis cancelled');

      // Store previous analysis for comparison (if enabled)
      var comparisonEnabled = layout.comparisonSettings && layout.comparisonSettings.enabled;
      if (comparisonEnabled && state.sheetSummary) {
        state.previousAnalysis = {
          sheetSummary: state.sheetSummary,
          objectSummaries: state.objectSummaries,
          timestamp: state.lastUpdated
        };
        logger.info('Previous analysis stored for comparison');
      }

      state.progress = 'Fetching sheet objects...';
      updateUI();
      logger.info('Fetching sheet objects...');

      var result = await analyzer.analyzeSheet(app, config, cancelToken, function(progress) {
        state.progress = progress;
        updateUI();
      }, state.extensionId);

      if (cancelToken.cancelled) throw new Error('Analysis cancelled');

      logger.info('Analysis complete. Objects analyzed:', result.objectSummaries.length);

      state.sheetSummary = result.sheetSummary;
      state.objectSummaries = result.objectSummaries;
      state.analyzedObjects = result.analyzedObjects || [];  // Store for chart creation
      state.usage = result.usage || null;
      state.lastUpdated = new Date().toISOString();
      state.progress = '';

      if (state.usage) {
        logger.info('Token usage:', state.usage.totalTokens, 'tokens, estimated cost:', state.usage.estimatedCost);
      }

      // Process alert statuses if enabled
      var alertResult = updateAlertStatuses(layout);
      if (alertResult) {
        logger.info('Alert analysis:', state.alertCounts);
      }

      // Save selection hash for change detection
      var detectSelectionChange = layout.outputSettings && layout.outputSettings.detectSelectionChange;
      if (detectSelectionChange) {
        try {
          var currentSelections = await engineService.getCurrentSelections(app);
          state.lastSelectionHash = hashSelections(currentSelections);
          state.selectionsChanged = false;
          logger.info('Selection hash saved:', state.lastSelectionHash);
        } catch (e) {
          logger.debug('Could not get selections for hash:', e.message);
        }
      }

      // Generate comparison if previous analysis exists
      if (comparisonEnabled && state.previousAnalysis) {
        state.comparisonResult = generateComparison(state.previousAnalysis, {
          sheetSummary: state.sheetSummary,
          objectSummaries: state.objectSummaries,
          timestamp: state.lastUpdated
        });
        if (state.comparisonResult) {
          var changeCount = state.comparisonResult.changedObjects.length +
                           state.comparisonResult.newObjects.length +
                           state.comparisonResult.removedObjects.length;
          logger.info('Comparison generated:', changeCount, 'changes detected');
        }
      } else {
        state.comparisonResult = null;
        state.showComparison = false;
      }

      // Inject footnotes if enabled
      var injectFootnotes = !layout.outputSettings || layout.outputSettings.injectFootnotes !== false;
      if (injectFootnotes && result.objectSummaries.length > 0) {
        var canEdit = await engineService.canEditObjects(app);
        if (canEdit) {
          state.progress = 'Injecting footnotes...';
          updateUI();
          try {
            await analyzer.injectFootnotes(app, result.objectSummaries);
            logger.info('Footnotes injected successfully');
          } catch (footnoteErr) {
            logger.error('Footnote injection failed:', footnoteErr.message);
          }
          state.progress = '';
        }
      }

      // Inject badges if enabled
      var showBadges = !layout.outputSettings || layout.outputSettings.showInsightBadges !== false;
      var alertsEnabled = layout.insightAlerts && layout.insightAlerts.enabled;
      if (showBadges && result.objectSummaries.length > 0) {
        state.progress = 'Adding insight badges...';
        updateUI();
        try {
          var highlightBadges = alertsEnabled && layout.insightAlerts && layout.insightAlerts.highlightBadges !== false;
          var badgeSettings = {
            visibility: (layout.outputSettings && layout.outputSettings.badgeVisibility) || 'hover',
            shift: !layout.outputSettings || layout.outputSettings.badgeShift !== false,
            alertStatuses: highlightBadges ? state.alertStatuses : null
          };
          setTrackedTimeout(function() {
            analyzer.injectInsightBadges(result.objectSummaries, badgeSettings);
          }, 500);
        } catch (badgeErr) {
          logger.error('Badge injection failed:', badgeErr.message);
        }
        state.progress = '';
      }

      // Generate dive deeper suggestions if enabled (default: true)
      var diveDeeperEnabled = !layout.diveDeeper || layout.diveDeeper.enabled !== false;
      if (diveDeeperEnabled && result.sheetSummary && !cancelToken.cancelled) {
        state.progress = 'Generating suggestions...';
        updateUI();
        try {
          var maxSuggestions = (layout.diveDeeper && layout.diveDeeper.maxSuggestions) || 3;
          var language = (layout.aiSettings && layout.aiSettings.responseLanguage) || 'en';

          // Fetch insight model to get accurate available fields for chart creation
          var insightModelFields = null;
          try {
            var insightModel = await fetchInsightModel();
            if (insightModel) {
              insightModelFields = getFieldsFromInsightModel(insightModel);
              logger.info('Using insight model fields for suggestions:',
                insightModelFields.dimensions.length, 'dims,',
                insightModelFields.measures.length, 'measures');
              // Debug: Log exact field names being sent to AI (critical for troubleshooting)
              logger.debug('EXACT DIMENSION NAMES for AI:', JSON.stringify(insightModelFields.dimensions.map(function(d) { return d.label; })));
              logger.debug('EXACT MEASURE NAMES for AI:', JSON.stringify(insightModelFields.measures.map(function(m) { return m.label; })));
            }
          } catch (insightErr) {
            logger.warn('Could not fetch insight model for suggestions:', insightErr.message);
          }

          var suggestionsPrompt = promptBuilder.buildSuggestionsPrompt(
            result.analyzedObjects || [],
            result.objectSummaries,
            result.sheetSummary,
            maxSuggestions,
            language,
            insightModelFields,  // Pass insight model fields for accurate field names
            config.customSuggestionsPrompt  // Custom user prompt if enabled
          );

          var aiProvider = getAIProvider(config.provider);
          // Use configured model (defaults: gpt-5.2 for OpenAI, claude-sonnet-4.5 for Anthropic, gemini-2.5-flash for Gemini)
          var suggestionsModel = config.model;
          var suggestionsResponse = await aiProvider.generateSummary(suggestionsPrompt, {
            apiKey: config.apiKey,
            model: suggestionsModel,
            maxTokens: 500  // More tokens for better suggestions
          });
          state.diveDeeperSuggestions = suggestionsResponse.text || suggestionsResponse;
          // Parse JSON suggestions for Insight Advisor integration
          state.parsedSuggestions = parseDiveDeeperSuggestions(state.diveDeeperSuggestions);
          if (state.parsedSuggestions) {
            logger.info('Dive deeper suggestions parsed:', state.parsedSuggestions.length, 'items');
          } else {
            logger.info('Dive deeper suggestions generated (raw text format)');
          }
        } catch (suggestErr) {
          logger.error('Suggestions generation failed:', suggestErr.message);
          state.diveDeeperSuggestions = null;
          state.parsedSuggestions = null;
        }
        state.progress = '';
      } else {
        state.diveDeeperSuggestions = null;
        state.parsedSuggestions = null;
      }

      // Save to localStorage - prefer real sheet ID over mobile fallback
      var saveSheetId = state.currentSheetId;
      // If current is mobile ID, try to get real sheet ID
      if (!saveSheetId || saveSheetId.startsWith('_mobile_')) {
        try {
          var realSheetId = await engineService.getCurrentSheetId();
          if (realSheetId && !realSheetId.startsWith('_mobile_')) {
            saveSheetId = realSheetId;
          }
        } catch (e) {
          logger.debug('Could not get real sheet ID:', e.message);
        }
      }
      if (saveSheetId && !saveSheetId.startsWith('_mobile_')) {
        storage.save(appId, saveSheetId, {
          sheetSummary: result.sheetSummary,
          objectSummaries: result.objectSummaries,
          usage: state.usage,
          lastUpdated: state.lastUpdated,
          diveDeeperSuggestions: state.diveDeeperSuggestions
        });
      }

      endTimer();

    } catch (err) {
      logger.error('Analysis failed:', err.message);
      state.error = err.message || 'Analysis failed';
      state.progress = '';
    } finally {
      state.isAnalyzing = false;
      updateUI();
    }
  }

  // Export PDF
  function exportPDF() {
    logger.info('Exporting to PDF...');
    var sheetTitle = document.title || 'Qlik Sheet';
    var timestamp = state.lastUpdated ? new Date(state.lastUpdated).toLocaleString() : new Date().toLocaleString();

    var html = '<!DOCTYPE html><html><head><title>Qlik2Review Report - ' + sheetTitle + '</title>';
    html += '<style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #333; } .header { border-bottom: 2px solid #009845; padding-bottom: 15px; margin-bottom: 25px; } .header h1 { font-size: 24px; color: #009845; margin-bottom: 5px; } .header .meta { font-size: 12px; color: #666; } .section { margin-bottom: 25px; } .section-title { font-size: 16px; font-weight: 600; color: #009845; margin-bottom: 10px; } .sheet-summary { background: #f5f9f7; border-left: 3px solid #009845; padding: 15px; line-height: 1.6; } .object-item { border: 1px solid #e0e0e0; border-radius: 4px; padding: 12px; margin-bottom: 10px; } .object-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; } .object-type { font-size: 10px; text-transform: uppercase; padding: 2px 8px; border: 1px solid #009845; border-radius: 3px; color: #009845; font-weight: 600; } .object-title { font-weight: 500; } .object-summary { color: #555; line-height: 1.5; } .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #e0e0e0; font-size: 11px; color: #888; text-align: center; } @media print { body { padding: 20px; } }</style></head>';
    html += '<body><div class="header"><h1>&#9733; Qlik2Review Analysis Report</h1><div class="meta">Sheet: ' + escapeHtml(sheetTitle) + ' | Generated: ' + timestamp + '</div></div>';
    html += '<div class="section"><div class="section-title">&#128202; Sheet Summary</div><div class="sheet-summary">' + markdownToHtml(state.sheetSummary || 'No summary available').replace(/\n/g, '<br>') + '</div></div>';
    html += '<div class="section"><div class="section-title">&#128200; Object Insights (' + state.objectSummaries.length + ')</div>';

    state.objectSummaries.forEach(function(obj) {
      html += '<div class="object-item"><div class="object-header"><span class="object-type">' + escapeHtml(obj.type) + '</span><span class="object-title">' + escapeHtml(obj.title) + '</span></div><div class="object-summary">' + markdownToHtml(obj.summary) + '</div></div>';
    });

    html += '</div><div class="footer">Generated by Qlik2Review | AI-Powered Sheet Analysis</div></body></html>';

    var printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTrackedTimeout(function() {
        if (printWindow && !printWindow.closed) printWindow.print();
      }, 250);
    }
  }

  // Clear summaries
  async function clearSummaries() {
    logger.info('Clearing summaries');
    state.sheetSummary = null;
    state.objectSummaries = [];
    state.usage = null;
    state.alertStatuses = {};
    state.alertCounts = { warning: 0, positive: 0, neutral: 0 };
    state.lastUpdated = null;
    state.error = null;
    state.progress = '';
    state.diveDeeperSuggestions = null;
    state.parsedSuggestions = null;
    state.analyzedObjects = [];
    state.creatingChart = null;
    state.createdChartModal = null;

    // Stop selection polling since there's no analysis to compare against
    if (state.selectionCheckInterval) {
      clearInterval(state.selectionCheckInterval);
      state.selectionCheckInterval = null;
    }
    if (state.autoAnalyzeTimer) {
      clearTimeout(state.autoAnalyzeTimer);
      state.autoAnalyzeTimer = null;
    }
    state.selectionsChanged = false;
    state.lastSelectionHash = null;

    analyzer.removeInsightBadges();

    try {
      var appId = state.app ? state.app.id : 'unknown';
      var sheetId = state.currentSheetId;
      if (!sheetId) {
        try { sheetId = await engineService.getCurrentSheetId(); } catch (e) { logger.debug('Could not get sheet ID for clear:', e.message); }
      }
      if (sheetId) storage.clear(appId, sheetId);
    } catch (e) {
      logger.debug('Could not clear localStorage:', e.message);
    }

    updateUI();
  }

  // Clear footnotes from all analyzed objects
  async function clearFootnotes() {
    if (!state.app || state.objectSummaries.length === 0) {
      logger.warn('No objects to clear footnotes from');
      return;
    }

    if (!state.isEditMode) {
      logger.warn('Clear footnotes requires edit mode');
      return;
    }

    logger.info('Clearing footnotes from', state.objectSummaries.length, 'objects');
    state.progress = 'Clearing footnotes...';
    updateUI();

    try {
      var result = await analyzer.clearFootnotes(state.app, state.objectSummaries);
      logger.info('Footnotes cleared:', result.success, 'success,', result.failed, 'failed');
      state.progress = '';

      if (result.failed > 0) {
        state.error = 'Some footnotes could not be cleared (' + result.failed + ' failed)';
      }
    } catch (err) {
      logger.error('Clear footnotes failed:', err.message);
      state.error = 'Failed to clear footnotes: ' + err.message;
      state.progress = '';
    }

    updateUI();
  }

  // Handle sheet change
  function handleSheetChange(sheetId) {
    if (state.currentSheetId !== sheetId) {
      logger.info('Sheet ID:', sheetId);
      state.currentSheetId = sheetId;
      state.sheetSummary = null;
      state.objectSummaries = [];
      state.usage = null;
      state.alertStatuses = {};
      state.alertCounts = { warning: 0, positive: 0, neutral: 0 };
      state.previousAnalysis = null;
      state.comparisonResult = null;
      state.showComparison = false;
      state.viewingSavedId = null;
      state.bookmarksExpanded = false;
      state.lastUpdated = null;
      state.error = null;
      state.diveDeeperSuggestions = null;
      state.parsedSuggestions = null;
      state.analyzedObjects = [];
      state.creatingChart = null;
      state.createdChartModal = null;

      // Load bookmarks for this sheet
      if (sheetId && !sheetId.startsWith('_mobile_')) {
        var appId = state.app ? state.app.id : 'unknown';
        state.savedAnalyses = loadBookmarks(appId, sheetId);
        logger.info('Loaded', state.savedAnalyses.length, 'bookmarks for sheet');
      } else {
        state.savedAnalyses = [];
      }

      // Load from cache
      if (sheetId && !sheetId.startsWith('_mobile_')) {
        var appId = state.app ? state.app.id : 'unknown';
        var cached = storage.load(appId, sheetId);
        if (cached) {
          logger.info('Restoring cached summary from localStorage');
          state.sheetSummary = cached.sheetSummary;
          state.objectSummaries = cached.objectSummaries || [];
          state.usage = cached.usage || null;
          state.lastUpdated = cached.lastUpdated;
          state.diveDeeperSuggestions = cached.diveDeeperSuggestions || null;
          // Parse cached suggestions for Create buttons
          state.parsedSuggestions = parseDiveDeeperSuggestions(state.diveDeeperSuggestions);

          // Recalculate alert statuses from cached summaries
          var layout = state.layout || {};
          var alertResult = updateAlertStatuses(layout);
          if (alertResult) {
            logger.info('Alert analysis restored from cache:', state.alertCounts);
          }
          var alertsEnabled = layout.insightAlerts && layout.insightAlerts.enabled;

          // Initialize selection hash for change detection when loading from cache
          var detectSelectionChange = layout.outputSettings && layout.outputSettings.detectSelectionChange;
          if (detectSelectionChange && state.app) {
            engineService.getCurrentSelections(state.app).then(function(currentSelections) {
              state.lastSelectionHash = hashSelections(currentSelections);
              state.selectionsChanged = false;
              logger.info('Selection hash initialized from cache load:', state.lastSelectionHash);
            }).catch(function(err) {
              logger.debug('Could not initialize selection hash:', err.message);
            });
          }

          // Re-inject badges
          var showBadges = !layout.outputSettings || layout.outputSettings.showInsightBadges !== false;
          if (showBadges && state.objectSummaries.length > 0) {
            var highlightBadges = alertsEnabled && layout.insightAlerts && layout.insightAlerts.highlightBadges !== false;
            var badgeSettings = {
              visibility: (layout.outputSettings && layout.outputSettings.badgeVisibility) || 'hover',
              shift: !layout.outputSettings || layout.outputSettings.badgeShift !== false,
              alertStatuses: highlightBadges ? state.alertStatuses : null
            };
            setTrackedTimeout(function() {
              analyzer.injectInsightBadges(state.objectSummaries, badgeSettings);
            }, 1000);
          }
        }
      }
      updateUI();
    }
  }

  return {
    definition: definition,
    support: {
      snapshot: false,
      export: false,
      exportData: false
    },
    initialProperties: {
      showTitles: false,
      title: '',
      subtitle: ''
    },

    paint: function($element, layout) {
      var self = this;
      var app = qlik.currApp(this);
      var extensionId = layout.qInfo.qId;

      // Update logger
      var debugEnabled = layout.developer && layout.developer.debugEnabled;
      logger.setEnabled(debugEnabled);

      logger.info('Paint called for extension:', extensionId);

      // Store state
      state.app = app;
      state.layout = layout;
      state.extensionId = extensionId;
      state.element = $element;

      // Detect edit mode
      try {
        state.isEditMode = qlik.navigation && qlik.navigation.getMode() === 'edit';
      } catch (e) {
        state.isEditMode = false;
      }

      // Render UI
      var element = $element[0] || $element;
      element.innerHTML = buildUI(layout);
      attachEventListeners(element);

      // Debounced sheet check
      var now = Date.now();
      if (now - lastPaintTime < PAINT_DEBOUNCE_MS) {
        return qlik.Promise.resolve();
      }
      lastPaintTime = now;

      if (paintDebounceTimer) clearTimeout(paintDebounceTimer);

      paintDebounceTimer = setTimeout(function() {
        engineService.getCurrentSheetId().then(function(sheetId) {
          handleSheetChange(sheetId);
          // Start selection polling AFTER handleSheetChange completes (cache restored)
          startSelectionPolling();
        }).catch(function(err) {
          logger.debug('Could not get sheet ID:', err.message);
          handleSheetChange('_mobile_' + Date.now());
          startSelectionPolling();
        });
      }, 50);

      // Helper function to start/stop selection polling
      function startSelectionPolling() {
        var currentLayout = state.layout;
        var detectSelectionChange = currentLayout && currentLayout.outputSettings && currentLayout.outputSettings.detectSelectionChange;

        if (detectSelectionChange && state.sheetSummary && !state.isAnalyzing) {
          // Start selection polling if not already running
          if (!state.selectionCheckInterval) {
            logger.info('Starting selection polling');
            state.selectionCheckInterval = setInterval(function() {
              if (!state.app || state.isAnalyzing) return;

              // Read current settings from state.layout (not captured closure)
              var currentLayout = state.layout;
              var autoAnalyzeEnabled = currentLayout && currentLayout.outputSettings && currentLayout.outputSettings.autoAnalyze;
              var autoAnalyzeDelay = (currentLayout && currentLayout.outputSettings && currentLayout.outputSettings.autoAnalyzeDelay) || 2000;

              engineService.getCurrentSelections(state.app).then(function(currentSelections) {
                var currentHash = hashSelections(currentSelections);

                // Initialize hash on first poll if not set
                if (!state.lastSelectionHash) {
                  state.lastSelectionHash = currentHash;
                  logger.info('Selection hash initialized on polling start:', currentHash);
                  return;
                }

                // Check for changes
                if (currentHash !== state.lastSelectionHash) {
                  logger.info('Selection change detected. Previous:', state.lastSelectionHash, 'Current:', currentHash);

                  // Update hash to track latest selections
                  state.lastSelectionHash = currentHash;

                  // Only trigger UI update and auto-analyze if not already flagged
                  if (!state.selectionsChanged) {
                    state.selectionsChanged = true;
                    updateUI();

                    // Auto-analyze if enabled (read from current layout, not closure)
                    logger.debug('Auto-analyze check: enabled=' + autoAnalyzeEnabled + ', isAnalyzing=' + state.isAnalyzing);
                    if (autoAnalyzeEnabled && !state.isAnalyzing) {
                      // Clear any existing auto-analyze timer
                      if (state.autoAnalyzeTimer) {
                        clearTimeout(state.autoAnalyzeTimer);
                      }
                      logger.info('Auto-analyze scheduled in', autoAnalyzeDelay, 'ms');
                      state.autoAnalyzeTimer = setTrackedTimeout(function() {
                        state.autoAnalyzeTimer = null;
                        if (!state.isAnalyzing) {
                          logger.info('Auto-analyzing due to selection change');
                          analyzeSheet();
                        }
                      }, autoAnalyzeDelay);
                    }
                  }
                }
              }).catch(function(err) {
                logger.debug('Selection check failed:', err.message);
              });
            }, 500);  // Check every 500ms
          }
        } else {
          // Stop selection polling
          if (state.selectionCheckInterval) {
            logger.info('Stopping selection polling');
            clearInterval(state.selectionCheckInterval);
            state.selectionCheckInterval = null;
          }
        }
      }

      return qlik.Promise.resolve();
    },

    destroy: function() {
      logger.info('Extension destroy called - cleaning up');
      cancelToken.cancelled = true;

      if (paintDebounceTimer) {
        clearTimeout(paintDebounceTimer);
        paintDebounceTimer = null;
      }

      // Clean up selection polling
      if (state.selectionCheckInterval) {
        clearInterval(state.selectionCheckInterval);
        state.selectionCheckInterval = null;
      }

      // Clean up auto-analyze timer
      if (state.autoAnalyzeTimer) {
        clearTimeout(state.autoAnalyzeTimer);
        state.autoAnalyzeTimer = null;
      }

      lastPaintTime = 0;

      activeTimers.forEach(function(timerId) {
        clearTimeout(timerId);
      });
      activeTimers = [];

      // Close any open chart modal
      if (state.createdChartModal) {
        closeChartModal();
      }

      analyzer.destroy();
      logger.info('Extension cleanup complete');
    }
  };
});
