/**
 * COMPLETE CHART TEMPLATES - v3.7.4
 * Based on official Qlik documentation:
 * https://qlik.dev/embed/capability-api/customize/visualizations/
 *
 * Each template is a FULL, WORKING chart definition.
 * AI only provides: dimensions[], measures[], title, subtitle
 */
define([], function() {
  'use strict';

  /**
   * Generate unique cId for qlik objects
   */
  function generateCId() {
    return 'qr_' + Math.random().toString(36).substring(2, 11);
  }

  /**
   * Build dimension object
   * Angular tracks by item.id, Qlik property panel uses qDef.cId
   * Need BOTH for it to work
   */
  function buildDimension(dim) {
    var id = generateCId();

    // For library items (master dimensions)
    if (dim.libraryId) {
      return {
        qLibraryId: dim.libraryId,
        qDef: { cId: id },
        id: id
      };
    }

    // For inline fields
    var fieldName = dim.field || '';
    if (fieldName.charAt(0) === '[' && fieldName.charAt(fieldName.length - 1) === ']') {
      fieldName = fieldName.substring(1, fieldName.length - 1);
    }

    return {
      qDef: {
        qGrouping: 'N',
        qFieldDefs: ['[' + fieldName + ']'],
        qFieldLabels: [dim.label || fieldName],
        cId: id
      },
      qNullSuppression: true,
      id: id
    };
  }

  /**
   * Build measure object
   * Angular tracks by item.id, Qlik property panel uses qDef.cId
   * Need BOTH for it to work
   */
  function buildMeasure(meas, options) {
    options = options || {};
    var id = generateCId();

    // For library items (master measures)
    if (meas.libraryId) {
      return {
        qLibraryId: meas.libraryId,
        qDef: { cId: id },
        id: id
      };
    }

    // For inline expressions
    var expression = (meas.expression || '').trim().replace(/[\r\n]+/g, ' ');

    var qMeas = {
      qDef: {
        qLabel: meas.label || '',
        qGrouping: 'N',
        qDef: expression,
        cId: id
      },
      id: id
    };

    // Add number format if provided (from master measure)
    if (meas.numFormat) {
      qMeas.qDef.qNumFormat = meas.numFormat;
    }

    if (options.valueType) {
      qMeas.qDef.valueType = options.valueType;
    }

    if (options.series) {
      qMeas.qDef.series = options.series;
    }

    return qMeas;
  }

  /**
   * COMPLETE CHART TEMPLATES
   * Each returns a FULL definition ready for createSessionObject
   */
  var TEMPLATES = {

    // BAR CHART - https://qlik.dev/embed/capability-api/customize/visualizations/create-barchart/
    barchart: function(title, subtitle, dimensions, measures) {
      var qDims = dimensions.map(function(d) { return buildDimension(d); });
      var qMeas = measures.map(function(m) { return buildMeasure(m); });

      return {
        qInfo: { qType: 'barchart' },
        visualization: 'barchart',
        showTitles: true,
        title: title || '',
        subtitle: subtitle || '',
        qHyperCubeDef: {
          qDimensions: qDims,
          qMeasures: qMeas,
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 10, qHeight: 1000 }],
          qSuppressMissing: true,
          qSuppressZero: false
        }
      };
    },

    // LINE CHART - https://qlik.dev/embed/capability-api/customize/visualizations/create-linechart/
    linechart: function(title, subtitle, dimensions, measures) {
      var qDims = dimensions.map(function(d) { return buildDimension(d); });
      var qMeas = measures.map(function(m) { return buildMeasure(m); });

      return {
        qInfo: { qType: 'linechart' },
        visualization: 'linechart',
        showTitles: true,
        title: title || '',
        subtitle: subtitle || '',
        qHyperCubeDef: {
          qDimensions: qDims,
          qMeasures: qMeas,
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 10, qHeight: 1000 }],
          qSuppressMissing: true,
          qSuppressZero: false
        }
      };
    },

    // COMBO CHART - https://qlik.dev/embed/capability-api/customize/visualizations/create-combochart/
    combochart: function(title, subtitle, dimensions, measures) {
      var qDims = dimensions.map(function(d) { return buildDimension(d); });
      // Combo chart: first measure as bar, rest as line
      var qMeas = measures.map(function(m, idx) {
        var seriesType = idx === 0 ? 'bar' : 'line';
        return buildMeasure(m, { series: { type: seriesType, axis: 0 } });
      });

      return {
        qInfo: { qType: 'combochart' },
        visualization: 'combochart',
        showTitles: true,
        title: title || '',
        subtitle: subtitle || '',
        qHyperCubeDef: {
          qDimensions: qDims,
          qMeasures: qMeas,
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 10, qHeight: 1000 }],
          qSuppressMissing: true,
          qSuppressZero: false
        }
      };
    },

    // PIE CHART - https://qlik.dev/embed/capability-api/customize/visualizations/create-piechart/
    piechart: function(title, subtitle, dimensions, measures) {
      var qDims = dimensions.map(function(d) { return buildDimension(d); });
      var qMeas = measures.map(function(m) { return buildMeasure(m); });

      return {
        qInfo: { qType: 'piechart' },
        visualization: 'piechart',
        showTitles: true,
        title: title || '',
        subtitle: subtitle || '',
        qHyperCubeDef: {
          qDimensions: qDims,
          qMeasures: qMeas,
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 2, qHeight: 500 }],
          qSuppressMissing: true,
          qSuppressZero: true
        }
      };
    },

    // TREEMAP - https://qlik.dev/embed/capability-api/customize/visualizations/create-treemap/
    treemap: function(title, subtitle, dimensions, measures) {
      var qDims = dimensions.map(function(d) { return buildDimension(d); });
      var qMeas = measures.map(function(m) { return buildMeasure(m); });

      return {
        qInfo: { qType: 'treemap' },
        visualization: 'treemap',
        showTitles: true,
        title: title || '',
        subtitle: subtitle || '',
        qHyperCubeDef: {
          qDimensions: qDims,
          qMeasures: qMeas,
          qMode: 'S',
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: qDims.length + qMeas.length, qHeight: 500 }],
          qSuppressMissing: true,
          qSuppressZero: true
        },
        color: {
          auto: true,
          mode: 'byDimension',
          formatting: {
            numFormatFromTemplate: true
          },
          useBaseColors: 'off',
          paletteColor: { index: 6, color: '#4477aa' },
          useDimColVal: true,
          useMeasureGradient: true,
          persistent: false,
          expressionIsColor: true,
          reverseScheme: false,
          dimensionScheme: 'auto'
        },
        legend: {
          show: true,
          dock: 'auto',
          showTitle: true
        },
        labels: {
          auto: true,
          headers: true,
          overlay: true,
          leaves: true,
          values: true
        },
        tooltip: {
          auto: true,
          hideBasic: false,
          title: '',
          description: ''
        }
      };
    },

    // SCATTER PLOT - https://qlik.dev/embed/capability-api/customize/visualizations/create-scatterplot/
    scatterplot: function(title, subtitle, dimensions, measures) {
      var qDims = dimensions.map(function(d) { return buildDimension(d); });
      var qMeas = measures.map(function(m) { return buildMeasure(m); });

      return {
        qInfo: { qType: 'scatterplot' },
        visualization: 'scatterplot',
        showTitles: true,
        title: title || '',
        subtitle: subtitle || '',
        qHyperCubeDef: {
          qDimensions: qDims,
          qMeasures: qMeas,
          qMode: 'S',
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 4, qHeight: 3000 }],
          qSuppressMissing: true,
          qSuppressZero: false
        },
        dataPoint: {
          bubbleSizes: 5,
          rangeBubbleSizes: [2, 8]
        },
        color: {
          auto: true,
          mode: 'primary'
        },
        legend: {
          show: true,
          dock: 'auto',
          showTitle: true
        },
        xAxis: {
          show: 'all',
          dock: 'near',
          spacing: 1,
          autoMinMax: true
        },
        yAxis: {
          show: 'all',
          dock: 'near',
          spacing: 1,
          autoMinMax: true
        },
        measureAxis: {
          autoMinMax: true
        },
        compressionResolution: 0
      };
    },

    // WATERFALL CHART - https://qlik.dev/embed/capability-api/customize/visualizations/create-waterfall/
    waterfallchart: function(title, subtitle, dimensions, measures) {
      var qDims = dimensions.map(function(d) { return buildDimension(d); });
      // Waterfall: measures need valueType (NORMAL, INVERSE, SUBTOTAL)
      var qMeas = measures.map(function(m, idx) {
        var valueType = 'NORMAL';
        if (idx === measures.length - 1 && measures.length > 1) {
          valueType = 'SUBTOTAL';
        }
        return buildMeasure(m, { valueType: valueType });
      });

      return {
        qInfo: { qType: 'waterfallchart' },
        visualization: 'waterfallchart',
        showTitles: true,
        title: title || '',
        subtitle: subtitle || '',
        qHyperCubeDef: {
          qDimensions: qDims,
          qMeasures: qMeas,
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 10, qHeight: 500 }],
          qSuppressMissing: true,
          qSuppressZero: false
        }
      };
    },

    // BOX PLOT - https://qlik.dev/embed/capability-api/customize/visualizations/create-boxplot/
    boxplot: function(title, subtitle, dimensions, measures) {
      var qDims = dimensions.map(function(d) { return buildDimension(d); });
      var qMeas = measures.map(function(m) { return buildMeasure(m); });

      return {
        qInfo: { qType: 'boxplot' },
        visualization: 'boxplot',
        showTitles: true,
        title: title || '',
        subtitle: subtitle || '',
        boxplotDef: {
          qHyperCubeDef: {
            qDimensions: qDims,
            qMeasures: qMeas,
            qMode: 'S',
            qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 3, qHeight: 500 }],
            qSuppressMissing: true,
            qSuppressZero: false
          },
          calculations: {
            auto: true,
            mode: 'tukey',
            parameters: { tukey: 1.5 }
          },
          color: {
            auto: true,
            mode: 'primary'
          },
          sorting: {
            autoSort: true
          }
        },
        dataPoint: {
          showOutliers: true
        },
        outliers: {
          show: true
        },
        orientation: 'vertical',
        measureAxis: {
          autoMinMax: true
        },
        dimensionAxis: {
          show: 'all'
        }
      };
    },

    // HISTOGRAM - https://qlik.dev/embed/capability-api/customize/visualizations/create-histogram/
    histogram: function(title, subtitle, dimensions, measures) {
      // Histogram: only one dimension, no measures (frequency auto-calculated)
      var qDims = dimensions.map(function(d) { return buildDimension(d); });

      return {
        qInfo: { qType: 'histogram' },
        visualization: 'histogram',
        showTitles: true,
        title: title || '',
        subtitle: subtitle || '',
        qHyperCubeDef: {
          qDimensions: qDims,
          qMeasures: [],
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 1, qHeight: 1000 }],
          qSuppressMissing: true,
          qSuppressZero: false
        },
        bins: {
          auto: true,
          binCount: 10
        }
      };
    },

    // DISTRIBUTION PLOT - https://qlik.dev/embed/capability-api/customize/visualizations/create-distributionplot/
    distributionplot: function(title, subtitle, dimensions, measures) {
      var qDims = dimensions.map(function(d) { return buildDimension(d); });
      var qMeas = measures.map(function(m) { return buildMeasure(m); });

      return {
        qInfo: { qType: 'distributionplot' },
        visualization: 'distributionplot',
        showTitles: true,
        title: title || '',
        subtitle: subtitle || '',
        qHyperCubeDef: {
          qDimensions: qDims,
          qMeasures: qMeas,
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 2, qHeight: 1000 }],
          qSuppressMissing: true,
          qSuppressZero: false
        }
      };
    },

    // GAUGE - https://qlik.dev/embed/capability-api/customize/visualizations/create-gauge/
    gauge: function(title, subtitle, dimensions, measures) {
      // Gauge: one measure only, no dimensions
      var qMeas = measures.map(function(m) { return buildMeasure(m); });

      return {
        qInfo: { qType: 'gauge' },
        visualization: 'gauge',
        showTitles: true,
        title: title || '',
        subtitle: subtitle || '',
        qHyperCubeDef: {
          qDimensions: [],
          qMeasures: qMeas,
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 1, qHeight: 1 }],
          qSuppressMissing: true,
          qSuppressZero: false
        }
      };
    },

    // KPI - https://qlik.dev/embed/capability-api/customize/visualizations/create-kpi/
    kpi: function(title, subtitle, dimensions, measures) {
      // KPI: one or two measures, no dimensions
      var qMeas = measures.map(function(m) { return buildMeasure(m); });

      return {
        qInfo: { qType: 'kpi' },
        visualization: 'kpi',
        showTitles: true,
        title: title || '',
        subtitle: subtitle || '',
        qHyperCubeDef: {
          qDimensions: [],
          qMeasures: qMeas,
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 1, qHeight: 1 }],
          qSuppressMissing: true,
          qSuppressZero: false
        }
      };
    },

    // TABLE - https://qlik.dev/embed/capability-api/customize/visualizations/create-table/
    table: function(title, subtitle, dimensions, measures) {
      var qDims = dimensions.map(function(d) { return buildDimension(d); });
      var qMeas = measures.map(function(m) { return buildMeasure(m); });

      return {
        qInfo: { qType: 'table' },
        visualization: 'table',
        showTitles: true,
        title: title || '',
        subtitle: subtitle || '',
        qHyperCubeDef: {
          qDimensions: qDims,
          qMeasures: qMeas,
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 10, qHeight: 500 }],
          qSuppressMissing: true,
          qSuppressZero: false
        }
      };
    },

    // PIVOT TABLE
    pivottable: function(title, subtitle, dimensions, measures) {
      var qDims = dimensions.map(function(d) { return buildDimension(d); });
      var qMeas = measures.map(function(m) { return buildMeasure(m); });

      return {
        qInfo: { qType: 'pivottable' },
        visualization: 'pivottable',
        showTitles: true,
        title: title || '',
        subtitle: subtitle || '',
        qHyperCubeDef: {
          qDimensions: qDims,
          qMeasures: qMeas,
          qMode: 'P',
          qAlwaysFullyExpanded: true,
          qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 10, qHeight: 500 }],
          qSuppressMissing: true,
          qSuppressZero: false
        }
      };
    }
  };

  // Chart type aliases
  var ALIASES = {
    'waterfall': 'waterfallchart',
    'bar': 'barchart',
    'line': 'linechart',
    'pie': 'piechart',
    'combo': 'combochart',
    'scatter': 'scatterplot',
    'box': 'boxplot',
    'distribution': 'distributionplot',
    'pivot': 'pivottable'
  };

  return {
    /**
     * Build complete chart definition
     */
    build: function(chartType, title, subtitle, dimensions, measures) {
      var normalizedType = (chartType || 'barchart').toLowerCase();
      if (ALIASES[normalizedType]) {
        normalizedType = ALIASES[normalizedType];
      }

      var templateFn = TEMPLATES[normalizedType];
      if (!templateFn) {
        console.warn('[ChartTemplates] Unknown chart type:', chartType, '- using barchart');
        templateFn = TEMPLATES.barchart;
      }

      return templateFn(title || '', subtitle || '', dimensions || [], measures || []);
    },

    getSupportedTypes: function() {
      return Object.keys(TEMPLATES);
    },

    isSupported: function(chartType) {
      var normalized = (chartType || '').toLowerCase();
      return !!TEMPLATES[normalized] || !!TEMPLATES[ALIASES[normalized]];
    }
  };
});
