define([], function() {
  'use strict';

  // Default prompt template
  const DEFAULT_PROMPT = `Analyze this Qlik visualization data and provide a concise analytical summary.
Focus on:
- Key trends and patterns
- Notable outliers or anomalies
- Actionable insights
Keep response under 250 characters. Be direct and specific.`;

  // Supported chart types for object filtering
  const CHART_TYPES = [
    { value: 'barchart', label: 'Bar Chart' },
    { value: 'linechart', label: 'Line Chart' },
    { value: 'piechart', label: 'Pie Chart' },
    { value: 'combochart', label: 'Combo Chart' },
    { value: 'scatterplot', label: 'Scatter Plot' },
    { value: 'treemap', label: 'Treemap' },
    { value: 'kpi', label: 'KPI' },
    { value: 'gauge', label: 'Gauge' },
    { value: 'table', label: 'Table' },
    { value: 'pivot-table', label: 'Pivot Table' },
    { value: 'boxplot', label: 'Box Plot' },
    { value: 'distributionplot', label: 'Distribution Plot' },
    { value: 'histogram', label: 'Histogram' },
    { value: 'waterfallchart', label: 'Waterfall Chart' },
    { value: 'map', label: 'Map' },
    { value: 'mekkochart', label: 'Mekko Chart' },
    { value: 'bulletchart', label: 'Bullet Chart' },
    { value: 'funnelchart', label: 'Funnel Chart' }
  ];

  // Default included types (classic charts)
  const DEFAULT_INCLUDED_TYPES = [
    'barchart', 'linechart', 'piechart', 'combochart',
    'kpi', 'gauge', 'table', 'scatterplot'
  ];

  return {
    type: 'items',
    component: 'accordion',
    items: {
      // AI Settings Section
      aiSettings: {
        type: 'items',
        label: 'AI Settings',
        items: {
          provider: {
            ref: 'aiSettings.provider',
            type: 'string',
            component: 'dropdown',
            label: 'AI Provider',
            defaultValue: 'openai',
            options: [
              { value: 'openai', label: 'OpenAI (GPT-4)' },
              { value: 'anthropic', label: 'Anthropic (Claude)' },
              { value: 'gemini', label: 'Google Gemini' }
            ]
          },
          apiKey: {
            ref: 'aiSettings.apiKey',
            type: 'string',
            label: 'API Key',
            defaultValue: '',
            expression: 'optional'
          },
          apiKeyHint: {
            component: 'text',
            label: 'Store API keys securely. Consider using variables.'
          },
          model: {
            ref: 'aiSettings.model',
            type: 'string',
            label: 'Model (optional)',
            defaultValue: '',
            expression: 'optional',
            show: function(data) {
              return data.aiSettings && data.aiSettings.provider;
            }
          },
          customPrompt: {
            ref: 'aiSettings.customPrompt',
            type: 'string',
            component: 'textarea',
            label: 'Custom Prompt (optional)',
            defaultValue: '',
            rows: 4
          },
          defaultPromptHint: {
            component: 'text',
            label: 'Leave empty to use default analytical prompt.'
          }
        }
      },

      // Object Filter Section
      objectFilter: {
        type: 'items',
        label: 'Object Filter',
        items: {
          includedTypesHeader: {
            component: 'text',
            label: 'Select which object types to analyze:'
          },
          includedTypes: {
            ref: 'objectFilter.includedTypes',
            type: 'array',
            component: 'dropdown',
            label: 'Included Object Types',
            defaultValue: DEFAULT_INCLUDED_TYPES,
            options: CHART_TYPES,
            multiple: true
          },
          excludedIds: {
            ref: 'objectFilter.excludedIds',
            type: 'string',
            label: 'Excluded Object IDs (comma-separated)',
            defaultValue: '',
            expression: 'optional'
          },
          excludeHint: {
            component: 'text',
            label: 'Enter specific object IDs to exclude from analysis.'
          }
        }
      },

      // Output Settings Section
      outputSettings: {
        type: 'items',
        label: 'Output Settings',
        items: {
          injectFootnotes: {
            ref: 'outputSettings.injectFootnotes',
            type: 'boolean',
            component: 'switch',
            label: 'Inject summaries to object footnotes',
            defaultValue: true,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          },
          showSheetSummary: {
            ref: 'outputSettings.showSheetSummary',
            type: 'boolean',
            component: 'switch',
            label: 'Show sheet-level summary',
            defaultValue: true,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          },
          showObjectList: {
            ref: 'outputSettings.showObjectList',
            type: 'boolean',
            component: 'switch',
            label: 'Show object summaries list',
            defaultValue: true,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          },
          maxCharsPerObject: {
            ref: 'outputSettings.maxCharsPerObject',
            type: 'number',
            label: 'Max characters per object summary',
            defaultValue: 300,
            min: 100,
            max: 3500
          }
        }
      },

      // Appearance Settings
      appearance: {
        type: 'items',
        label: 'Appearance',
        items: {
          backgroundColor: {
            ref: 'appearance.backgroundColor',
            type: 'string',
            label: 'Background Color',
            defaultValue: '#ffffff',
            expression: 'optional'
          },
          textColor: {
            ref: 'appearance.textColor',
            type: 'string',
            label: 'Text Color',
            defaultValue: '#333333',
            expression: 'optional'
          },
          accentColor: {
            ref: 'appearance.accentColor',
            type: 'string',
            label: 'Accent Color',
            defaultValue: '#009845',
            expression: 'optional'
          },
          fontSize: {
            ref: 'appearance.fontSize',
            type: 'string',
            component: 'dropdown',
            label: 'Font Size',
            defaultValue: 'medium',
            options: [
              { value: 'small', label: 'Small (12px)' },
              { value: 'medium', label: 'Medium (14px)' },
              { value: 'large', label: 'Large (16px)' }
            ]
          },
          showTimestamp: {
            ref: 'appearance.showTimestamp',
            type: 'boolean',
            component: 'switch',
            label: 'Show timestamp',
            defaultValue: true,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          }
        }
      },

      // About Section
      about: {
        type: 'items',
        label: 'About',
        items: {
          version: {
            component: 'text',
            label: 'Qlik2Review v1.0.0'
          },
          description: {
            component: 'text',
            label: 'AI-powered sheet analysis extension'
          },
          github: {
            component: 'text',
            label: 'github.com/undsoul/Qlik2Review'
          }
        }
      }
    }
  };
});
