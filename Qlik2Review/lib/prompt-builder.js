define([], function() {
  'use strict';

  /**
   * Prompt Builder Utility
   * Constructs effective prompts for AI analysis
   */

  // Language code to name mapping
  var LANGUAGE_NAMES = {
    'en': 'English',
    'tr': 'Turkish',
    'de': 'German',
    'es': 'Spanish',
    'fr': 'French',
    'pt': 'Portuguese',
    'it': 'Italian',
    'nl': 'Dutch',
    'zh': 'Simplified Chinese',
    'ja': 'Japanese',
    'ko': 'Korean',
    'ar': 'Arabic'
  };

  // Default system prompt for object analysis
  const DEFAULT_OBJECT_PROMPT = `Analyze this Qlik visualization data. Provide concise analytical insights.
Focus on: key trends, patterns, outliers, and actionable observations.
Be specific with numbers. Keep response under 250 characters.
Use subtle emojis for trends: 📈 increase, 📉 decrease, ⚠️ anomaly, ✅ positive, 🎯 target. Max 2-3 emojis.
Use **bold** for key numbers and metrics (e.g. **$1.2M**, **+23%**, **Top: North**).
CRITICAL: Be DATA-DRIVEN. Always include specific numbers, percentages, ratios. Example: "Sales up **23%** to **$1.2M**" not "Sales increased significantly".`;

  // Default system prompt for sheet summary
  const DEFAULT_SHEET_PROMPT = `You are a senior data analyst. Provide ANALYTICAL COMMENTARY on the data, not just a summary.
Think like a consultant presenting to executives - explain the "so what?" behind every number.

FORMAT STRICTLY (add blank line between each section):

📊 Overview:
Set the scene. What's the overall health? Are things improving or declining?

📈 Key Trends:
What patterns tell a story? Connect the dots between metrics.

⚠️ Concerns:
What should keep leadership up at night? Quantify the risk.

💡 Recommendations:
Prioritized actions with business rationale.

CRITICAL: You MUST add a blank line between each section for readability!

STYLE GUIDE:
- Be conversational but professional
- Use **bold** for key numbers
- After each number, add YOUR INTERPRETATION: "Sales **$986K** (+4.6%) - a positive rebound driven by..."
- Ask rhetorical questions: "Why is St Albans underperforming?"
- Make connections: "The inventory buildup combined with falling sales suggests..."
- Keep under 900 characters but prioritize INSIGHT over brevity`;

  return {
    /**
     * Build prompt for analyzing a single object
     * @param {Object} obj - Object details with data
     * @param {Array} selections - Current selections
     * @param {string} customPrompt - Optional custom prompt
     * @param {string} language - Response language code (default: 'en')
     * @param {string} dataFormat - 'compressed' or 'raw' (default: 'compressed')
     * @returns {string} Constructed prompt
     */
    buildObjectPrompt: function(obj, selections, customPrompt, language, dataFormat) {
      const parts = [];

      // Add language instruction at the very beginning if not English
      if (language && language !== 'en' && LANGUAGE_NAMES[language]) {
        parts.push('IMPORTANT: Respond entirely in ' + LANGUAGE_NAMES[language] + '. All text must be in ' + LANGUAGE_NAMES[language] + '.');
        parts.push('');
      }

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

      // Include data (compressed stats or raw TOON format)
      if (obj.data && obj.data.length > 0) {
        parts.push('');
        parts.push(this.formatData(obj.data, obj.dimensions, obj.measures, dataFormat || 'compressed'));
      }

      // Special handling for KPI - extract values from obj.data (same as sheet summary)
      if (obj.type === 'kpi' && obj.data && obj.data.length > 0 && obj.data[0].measures) {
        var kpiMeasures = obj.data[0].measures;
        var primaryVal = kpiMeasures[0] ? (kpiMeasures[0].text || kpiMeasures[0].num) : null;
        var secondaryVal = kpiMeasures[1] ? (kpiMeasures[1].text || kpiMeasures[1].num) : null;

        if (primaryVal) {
          var kpiText = `KPI Value: ${primaryVal}`;
          if (secondaryVal !== undefined && secondaryVal !== null) {
            kpiText += ` | Comparison: ${secondaryVal}`;
          }
          parts.push(kpiText);
        }
      }

      return parts.join('\n');
    },

    /**
     * Build prompt for sheet-level summary with ALL data combined
     * @param {Array} objects - Full objects with data
     * @param {Array} objectSummaries - Individual object summaries
     * @param {Array} selections - Current selections
     * @param {string} language - Response language code (default: 'en')
     * @param {string} dataFormat - 'compressed' or 'raw' (default: 'compressed')
     * @param {string} customPrompt - Optional custom prompt
     * @returns {string} Constructed prompt
     */
    buildSheetPrompt: function(objects, objectSummaries, selections, language, dataFormat, customPrompt) {
      const parts = [];
      const self = this;
      const format = dataFormat || 'compressed';

      // Add language instruction at the very beginning if not English
      if (language && language !== 'en' && LANGUAGE_NAMES[language]) {
        parts.push('IMPORTANT: Respond entirely in ' + LANGUAGE_NAMES[language] + '. All text must be in ' + LANGUAGE_NAMES[language] + '.');
        parts.push('');
      }

      parts.push(customPrompt || DEFAULT_SHEET_PROMPT);
      parts.push('');

      // Selection context
      if (selections && selections.length > 0) {
        const selContext = selections.map(function(s) {
          return `${s.field}: ${s.count} selected`;
        }).join(', ');
        parts.push(`Filters: ${selContext}`);
        parts.push('');
      }

      // Combined data from ALL objects
      parts.push('=== COMBINED DATA FROM ALL CHARTS ===');
      objects.forEach(function(obj, idx) {
        if (obj.data && obj.data.length > 0) {
          parts.push(`[${obj.type.toUpperCase()}] ${obj.title || 'Untitled'}:`);
          parts.push(self.formatData(obj.data, obj.dimensions || [], obj.measures || [], format));
          parts.push('');
        }
      });

      // Individual summaries for reference
      parts.push('=== INDIVIDUAL INSIGHTS ===');
      objectSummaries.forEach(function(obj, idx) {
        if (!obj.error) {
          parts.push(`${idx + 1}. [${obj.type}] ${obj.title}: ${obj.summary}`);
        }
      });

      return parts.join('\n');
    },

    /**
     * Format compressed data stats (token-efficient!)
     * Instead of raw rows, send statistical summary
     * @param {Array} data - Data rows
     * @param {Array} dimensions - Dimension info
     * @param {Array} measures - Measure info
     * @returns {string} Compressed data summary
     */
    formatCompressedData: function(data, dimensions, measures) {
      // Defensive null check
      if (!data || !Array.isArray(data) || data.length === 0) {
        return 'No data available';
      }
      if (!measures) measures = [];
      if (!dimensions) dimensions = [];

      const lines = [];
      const self = this;

      lines.push(`Data: ${data.length} rows`);

      // Calculate measure statistics
      measures.forEach(function(measure, mIdx) {
        const values = data.map(function(row) {
          return row.measures[mIdx] ? row.measures[mIdx].num : null;
        }).filter(function(v) { return v !== null && !isNaN(v); });

        if (values.length > 0) {
          const sum = values.reduce(function(a, b) { return a + b; }, 0);
          const avg = sum / values.length;
          const min = Math.min.apply(null, values);
          const max = Math.max.apply(null, values);

          lines.push(`${measure.label}: min=${self.formatNum(min)}, max=${self.formatNum(max)}, avg=${self.formatNum(avg)}, total=${self.formatNum(sum)}`);
        }
      });

      // Top 3 and Bottom 3 by first measure (if exists)
      if (measures.length > 0 && data.length > 1) {
        const sorted = data.slice().sort(function(a, b) {
          const aVal = a.measures[0] ? a.measures[0].num : 0;
          const bVal = b.measures[0] ? b.measures[0].num : 0;
          return bVal - aVal;
        });

        const top3 = sorted.slice(0, 3).map(function(row) {
          const dim = row.dimensions[0] || 'N/A';
          const val = row.measures[0] ? row.measures[0].text : 'N/A';
          return `${self.truncate(dim, 15)}(${val})`;
        });

        const bottom3 = sorted.slice(-3).reverse().map(function(row) {
          const dim = row.dimensions[0] || 'N/A';
          const val = row.measures[0] ? row.measures[0].text : 'N/A';
          return `${self.truncate(dim, 15)}(${val})`;
        });

        lines.push(`Top3: ${top3.join(', ')}`);
        lines.push(`Bottom3: ${bottom3.join(', ')}`);
      }

      return lines.join('\n');
    },

    /**
     * Format data using TOON compression (token-efficient raw data)
     * Instead of repeating keys for each row, separate columns and values
     * @param {Array} data - Data rows
     * @param {Array} dimensions - Dimension info
     * @param {Array} measures - Measure info
     * @returns {string} TOON compressed data
     */
    formatToonData: function(data, dimensions, measures) {
      if (!data || !Array.isArray(data) || data.length === 0) {
        return 'No data available';
      }
      if (!measures) measures = [];
      if (!dimensions) dimensions = [];

      // Build column names
      var cols = [];
      dimensions.forEach(function(dim) {
        cols.push(dim.label || dim.title || 'Dim');
      });
      measures.forEach(function(meas) {
        cols.push(meas.label || meas.title || 'Measure');
      });

      // Build rows as arrays (not objects - saves tokens!)
      var rows = [];
      var self = this;
      data.forEach(function(row) {
        var rowArr = [];
        // Add dimension values
        row.dimensions.forEach(function(dim) {
          rowArr.push(self.truncate(String(dim), 20));
        });
        // Add measure values (use text for readability)
        row.measures.forEach(function(meas) {
          rowArr.push(meas.text || meas.num || 0);
        });
        rows.push(rowArr);
      });

      // TOON format: cols + rows (no repeated keys!)
      return 'Data (' + data.length + ' rows):\nCols: ' + JSON.stringify(cols) + '\nRows: ' + JSON.stringify(rows);
    },

    /**
     * Format data based on format setting
     * @param {Array} data - Data rows
     * @param {Array} dimensions - Dimension info
     * @param {Array} measures - Measure info
     * @param {string} format - 'compressed' or 'raw'
     * @returns {string} Formatted data
     */
    formatData: function(data, dimensions, measures, format) {
      if (format === 'raw') {
        return this.formatToonData(data, dimensions, measures);
      }
      return this.formatCompressedData(data, dimensions, measures);
    },

    /**
     * Format number for display (compact)
     * @param {number} num - Number to format
     * @returns {string} Formatted number
     */
    formatNum: function(num) {
      if (num === null || num === undefined || isNaN(num)) return 'N/A';
      if (Math.abs(num) >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (Math.abs(num) >= 1000) return (num / 1000).toFixed(1) + 'K';
      // Handle small decimals (likely percentages) - show as percentage
      if (Math.abs(num) > 0 && Math.abs(num) < 1) return (num * 100).toFixed(1) + '%';
      return num.toFixed(1);
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
    },

    // Default suggestions prompt - analysis-driven chart recommendations
    DEFAULT_SUGGESTIONS_PROMPT: 'You are a senior BI analyst. Review the analysis below and think: "What perspective is missing? What would deepen understanding? What follow-up question should we explore?"',

    /**
     * Build prompt for dive deeper suggestions
     * @param {Array} objects - Objects with their data
     * @param {Array} objectSummaries - Individual object summaries
     * @param {string} sheetSummary - Sheet-level summary
     * @param {number} maxSuggestions - Maximum number of suggestions
     * @param {string} language - Response language code
     * @param {Object} availableFields - Optional: pre-fetched available fields from insight model
     * @param {string} customPrompt - Optional custom prompt
     * @returns {string} Constructed prompt
     */
    buildSuggestionsPrompt: function(objects, objectSummaries, sheetSummary, maxSuggestions, language, availableFields, customPrompt) {
      const parts = [];
      const self = this;

      // Use provided fields or collect from objects
      var allDimensions = [];
      var allMeasures = [];

      if (availableFields && (availableFields.dimensions || availableFields.measures)) {
        // Use pre-fetched fields from insight model (preferred - these are the exact names for chart creation)
        allDimensions = (availableFields.dimensions || []).slice();
        allMeasures = (availableFields.measures || []).slice();
      } else {
        // Fall back to extracting from analyzed objects
        const seenDims = {};
        const seenMeas = {};

        objects.forEach(function(obj) {
          (obj.dimensions || []).forEach(function(d) {
            var key = d.field || d.label;
            if (key && !seenDims[key]) {
              seenDims[key] = true;
              allDimensions.push({ label: d.label, field: d.field || d.label });
            }
          });
          (obj.measures || []).forEach(function(m) {
            var key = m.field || m.label;
            if (key && !seenMeas[key]) {
              seenMeas[key] = true;
              allMeasures.push({ label: m.label, field: m.field || m.label, expression: m.expression, libraryId: m.libraryId });
            }
          });
        });
      }

      // Separate temporal and categorical dimensions
      var temporalDims = allDimensions.filter(function(d) { return d.isTemporal; });
      var categoricalDims = allDimensions.filter(function(d) { return !d.isTemporal; });

      // System prompt
      parts.push(customPrompt || self.DEFAULT_SUGGESTIONS_PROMPT);
      parts.push('');

      // Current analysis - what's already shown
      parts.push('== CURRENT DASHBOARD ==');

      // Collect what's already used
      var usedDims = {};
      var usedMeas = {};
      objectSummaries.forEach(function(obj) {
        if (obj.dimensions) obj.dimensions.forEach(function(d) { if (d.label) usedDims[d.label] = true; });
        if (obj.measures) obj.measures.forEach(function(m) { if (m.label) usedMeas[m.label] = true; });
      });

      // Show key insights
      objectSummaries.forEach(function(obj, idx) {
        if (!obj.error && obj.summary) {
          parts.push((idx + 1) + '. ' + (obj.title || obj.type) + ': ' + obj.summary.substring(0, 150));
        }
      });
      parts.push('');

      // Sheet summary
      if (sheetSummary) {
        parts.push('== KEY FINDINGS ==');
        parts.push(sheetSummary.substring(0, 500));
        parts.push('');
      }

      // Show what's currently analyzed
      var usedDimList = Object.keys(usedDims);
      var usedMeasList = Object.keys(usedMeas);
      parts.push('== CURRENT ANALYSIS SCOPE ==');
      parts.push('Dimensions being analyzed: ' + usedDimList.join(', '));
      parts.push('Measures being analyzed: ' + usedMeasList.join(', '));
      parts.push('');

      // Separate master items from raw fields
      var masterDims = allDimensions.filter(function(d) { return d.libraryId; });
      var masterMeas = allMeasures.filter(function(m) { return m.libraryId; });
      var rawDims = allDimensions.filter(function(d) { return !d.libraryId; });
      var rawMeas = allMeasures.filter(function(m) { return !m.libraryId; });

      // Show MASTER ITEMS first (these have business logic!)
      parts.push('== MASTER ITEMS (PREFERRED) ==');
      parts.push('');
      if (masterDims.length > 0) {
        parts.push('DIMENSIONS:');
        parts.push(JSON.stringify(masterDims.slice(0, 15).map(function(d) { return d.label; })));
        parts.push('');
      }
      if (masterMeas.length > 0) {
        parts.push('MEASURES:');
        parts.push(JSON.stringify(masterMeas.slice(0, 20).map(function(m) { return m.label; })));
        parts.push('');
      }

      // Show raw fields as fallback
      parts.push('== RAW FIELDS ==');
      parts.push('');
      parts.push('DIMENSIONS:');
      parts.push(JSON.stringify(rawDims.slice(0, 15).map(function(d) { return d.label; })));
      parts.push('');
      parts.push('MEASURES:');
      parts.push(JSON.stringify(rawMeas.slice(0, 15).map(function(m) { return m.label; })));
      parts.push('');

      // Task - ANALYTICAL DEPTH focused
      parts.push('== YOUR TASK ==');
      parts.push('Think like a senior analyst reviewing this dashboard:');
      parts.push('');
      parts.push('ASK YOURSELF:');
      parts.push('1. What analytical QUESTION remains unanswered?');
      parts.push('2. What PERSPECTIVE would deepen this analysis?');
      parts.push('3. What RELATIONSHIP or PATTERN should we explore next?');
      parts.push('4. What would make a stakeholder say "Ah, I hadn\'t thought of that!"?');
      parts.push('');
      parts.push('Suggest ' + (maxSuggestions || 3) + ' charts that ADD ANALYTICAL VALUE.');
      parts.push('');
      parts.push('RULES:');
      parts.push('1. PRIORITIZE MASTER ITEMS - they have business logic built-in');
      parts.push('2. Title must match the measure you select');
      parts.push('3. NEVER use time dimensions (Week, Month, Year, Date) with time-filtered measures (names containing Cur Wk, Pre Wk, YTD, MTD, WTD, LY, PY) - this creates single data points!');
      parts.push('4. VARIETY: Use DIFFERENT measures across suggestions - explore various metrics, not just one time period');
      parts.push('');
      parts.push('Chart types: barchart, linechart, piechart, treemap, scatterplot, boxplot, table, combochart, waterfall, kpi');
      parts.push('');
      parts.push('CHART TYPE RULES:');
      parts.push('- linechart: TIME dimensions only (Date, Week, Month)');
      parts.push('- barchart: categorical dimensions');
      parts.push('- boxplot: Great for showing distribution and outliers! Use 2 different categorical dimensions (e.g., Category + Region). Tip: avoid pairing drill-down dimensions with their parent field.');
      parts.push('- scatterplot: REQUIRES 2 COMPLETELY DIFFERENT dimensions and 2 measures');
      parts.push('');

      // Response format
      var langName = (language && LANGUAGE_NAMES[language]) ? LANGUAGE_NAMES[language] : 'English';
      parts.push('Respond in ' + langName + ' with JSON:');
      parts.push('```json');
      parts.push('[{');
      parts.push('  "chartType": "barchart|linechart|table|...",');
      parts.push('  "title": "Descriptive title matching the measure",');
      parts.push('  "dimensions": ["EXACT field name from DIMENSIONS list"],');
      parts.push('  "measures": ["EXACT field name from MEASURES list"],');
      parts.push('  "insight": "Why this chart adds value - what question does it answer?"');
      parts.push('}]');
      parts.push('```');
      parts.push('');
      parts.push('CRITICAL: Field names are CASE-SENSITIVE. Copy EXACTLY from the lists above!');

      return parts.join('\n');
    },

    /**
     * Extract measure data characteristics from analyzed objects
     * Used to help AI make informed chart type decisions
     * @param {Array} objects - Objects with their data
     * @returns {Object} Map of measure label to characteristics
     */
    getMeasureCharacteristics: function(objects) {
      var chars = {};
      var self = this;

      objects.forEach(function(obj) {
        if (!obj.data || !obj.measures) return;

        obj.measures.forEach(function(measure, mIdx) {
          var label = measure.label;
          if (!label || chars[label]) return; // skip if already processed

          var values = obj.data.map(function(row) {
            return row.measures && row.measures[mIdx] ? row.measures[mIdx].num : null;
          }).filter(function(v) { return v !== null && !isNaN(v); });

          if (values.length > 0) {
            var hasNeg = values.some(function(v) { return v < 0; });
            var hasZero = values.some(function(v) { return v === 0; });
            var min = Math.min.apply(null, values);
            var max = Math.max.apply(null, values);

            chars[label] = {
              hasNeg: hasNeg,
              hasZero: hasZero,
              min: min,
              max: max
            };
          }
        });
      });

      return chars;
    },

    /**
     * Format measure characteristics compactly for prompt
     * @param {Object} chars - Measure characteristics map
     * @returns {string} Compact formatted string
     */
    formatMeasureTraits: function(chars) {
      var self = this;
      var lines = [];

      Object.keys(chars).forEach(function(label) {
        var c = chars[label];
        var traits = [];

        if (c.hasNeg) {
          traits.push('has-negatives');
        } else {
          traits.push('positive-only');
        }

        // Compact range
        var range = self.formatNum(c.min) + ' to ' + self.formatNum(c.max);
        traits.push('range:' + range);

        lines.push('  ' + label + ': ' + traits.join(', '));
      });

      return lines.join('\n');
    },

    /**
     * Get all available fields from analyzed objects
     * @param {Array} objects - Objects with their data
     * @returns {Object} Object containing dimensions and measures arrays
     */
    getAvailableFields: function(objects) {
      const allDimensions = [];
      const allMeasures = [];
      const seenDims = {};
      const seenMeas = {};

      objects.forEach(function(obj) {
        (obj.dimensions || []).forEach(function(d) {
          var key = d.field || d.label;
          if (key && !seenDims[key]) {
            seenDims[key] = true;
            allDimensions.push({ label: d.label, field: d.field || d.label });
          }
        });
        (obj.measures || []).forEach(function(m) {
          var key = m.field || m.label;
          if (key && !seenMeas[key]) {
            seenMeas[key] = true;
            allMeasures.push({ label: m.label, field: m.field || m.label, expression: m.expression, libraryId: m.libraryId });
          }
        });
      });

      return { dimensions: allDimensions, measures: allMeasures };
    }
  };
});
