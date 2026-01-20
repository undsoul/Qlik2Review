define([], function() {
  'use strict';

  return {
    type: 'items',
    component: 'accordion',
    items: {
      // 1. AI Settings Section (most important)
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
            label: 'Model',
            defaultValue: '',
            placeholder: function(layout) {
              var provider = layout.aiSettings && layout.aiSettings.provider;
              if (provider === 'anthropic') return 'claude-sonnet-4-5-20250929';
              if (provider === 'gemini') return 'gemini-2.5-flash';
              return 'gpt-4.1-2025-04-14';  // OpenAI default
            },
            expression: 'optional'
          },
          modelHint: {
            component: 'text',
            label: function(layout) {
              var provider = layout.aiSettings && layout.aiSettings.provider;
              if (provider === 'anthropic') return 'Default: claude-sonnet-4.5';
              if (provider === 'gemini') return 'Default: gemini-2.5-flash';
              return 'Default: gpt-4.1-2025-04-14';
            }
          },
          showAdvancedModel: {
            ref: 'aiSettings.showAdvancedModel',
            type: 'boolean',
            component: 'switch',
            label: 'Advanced Model Settings',
            defaultValue: false,
            options: [
              { value: true, label: 'Show' },
              { value: false, label: 'Hide' }
            ]
          },
          temperature: {
            ref: 'aiSettings.temperature',
            type: 'number',
            component: 'slider',
            label: 'Temperature (creativity)',
            defaultValue: 0.3,
            min: 0,
            max: 2,
            step: 0.1,
            show: function(layout) {
              return layout.aiSettings && layout.aiSettings.showAdvancedModel;
            }
          },
          temperatureHint: {
            component: 'text',
            label: '0 = deterministic, 2 = creative. Some models ignore this.',
            show: function(layout) {
              return layout.aiSettings && layout.aiSettings.showAdvancedModel;
            }
          },
          maxTokens: {
            ref: 'aiSettings.maxTokens',
            type: 'number',
            component: 'slider',
            label: 'Max Tokens (response length)',
            defaultValue: 150,
            min: 50,
            max: 4000,
            step: 50,
            show: function(layout) {
              return layout.aiSettings && layout.aiSettings.showAdvancedModel;
            }
          },
          topP: {
            ref: 'aiSettings.topP',
            type: 'number',
            component: 'slider',
            label: 'Top P (nucleus sampling)',
            defaultValue: 1,
            min: 0,
            max: 1,
            step: 0.05,
            show: function(layout) {
              return layout.aiSettings && layout.aiSettings.showAdvancedModel;
            }
          },
          topPHint: {
            component: 'text',
            label: '1 = consider all tokens, lower = more focused',
            show: function(layout) {
              return layout.aiSettings && layout.aiSettings.showAdvancedModel;
            }
          },
          responseLanguage: {
            ref: 'aiSettings.responseLanguage',
            type: 'string',
            component: 'dropdown',
            label: 'Response Language',
            defaultValue: 'en',
            options: [
              { value: 'en', label: 'English' },
              { value: 'tr', label: 'Turkish (Türkçe)' },
              { value: 'de', label: 'German (Deutsch)' },
              { value: 'es', label: 'Spanish (Español)' },
              { value: 'fr', label: 'French (Français)' },
              { value: 'pt', label: 'Portuguese (Português)' },
              { value: 'it', label: 'Italian (Italiano)' },
              { value: 'nl', label: 'Dutch (Nederlands)' },
              { value: 'zh', label: 'Chinese (中文)' },
              { value: 'ja', label: 'Japanese (日本語)' },
              { value: 'ko', label: 'Korean (한국어)' },
              { value: 'ar', label: 'Arabic (العربية)' }
            ]
          },
          useCustomPrompt: {
            ref: 'aiSettings.useCustomPrompt',
            type: 'boolean',
            component: 'switch',
            label: 'Customize Object Analysis',
            defaultValue: false,
            options: [
              { value: true, label: 'Custom' },
              { value: false, label: 'Default' }
            ]
          },
          customPrompt: {
            ref: 'aiSettings.customPrompt',
            type: 'string',
            component: 'textarea',
            label: 'Object Analysis Prompt (for each KPI, chart, etc.)',
            defaultValue: 'Analyze this Qlik visualization data. Provide concise analytical insights.\nFocus on: key trends, patterns, outliers, and actionable observations.\nBe specific with numbers. Keep response under 250 characters.\nUse emojis: 📈 increase, 📉 decrease, ⚠️ anomaly, ✅ positive, 🎯 target.\nUse **bold** for key numbers (e.g. **$1.2M**, **+23%**).\nCRITICAL: Be DATA-DRIVEN. Always include specific numbers, percentages, ratios.',
            rows: 7,
            show: function(layout) {
              return layout.aiSettings && layout.aiSettings.useCustomPrompt;
            }
          },
          defaultPromptDisplay: {
            component: 'text',
            label: '📝 Default: Each object (KPI, chart) analyzed for trends, patterns (📈📉⚠️✅🎯)',
            show: function(layout) {
              return !layout.aiSettings || !layout.aiSettings.useCustomPrompt;
            }
          },
          useCustomSheetPrompt: {
            ref: 'aiSettings.useCustomSheetPrompt',
            type: 'boolean',
            component: 'switch',
            label: 'Customize Sheet Summary',
            defaultValue: false,
            options: [
              { value: true, label: 'Custom' },
              { value: false, label: 'Default' }
            ]
          },
          customSheetPrompt: {
            ref: 'aiSettings.customSheetPrompt',
            type: 'string',
            component: 'textarea',
            label: 'Sheet Summary Prompt',
            defaultValue: 'Synthesize ALL chart data into a comprehensive sheet-level analysis.\nIdentify cross-chart patterns, correlations, and the overall data story.\n\nFORMAT AS:\n📊 Overview: [overview]\n📈 Key Trends: [trends]\n⚠️ Concerns: [concerns]\n💡 Recommendations: [recommendations]\n\nUse **bold** for key numbers. Be QUANTITATIVE.',
            rows: 7,
            show: function(layout) {
              return layout.aiSettings && layout.aiSettings.useCustomSheetPrompt;
            }
          },
          defaultSheetPromptDisplay: {
            component: 'text',
            label: '📝 Default: Overview, Trends, Concerns, Recommendations format',
            show: function(layout) {
              return !layout.aiSettings || !layout.aiSettings.useCustomSheetPrompt;
            }
          },
          useCustomSuggestionsPrompt: {
            ref: 'aiSettings.useCustomSuggestionsPrompt',
            type: 'boolean',
            component: 'switch',
            label: 'Customize Dive Deeper',
            defaultValue: false,
            options: [
              { value: true, label: 'Custom' },
              { value: false, label: 'Default' }
            ]
          },
          customSuggestionsPrompt: {
            ref: 'aiSettings.customSuggestionsPrompt',
            type: 'string',
            component: 'textarea',
            label: 'Dive Deeper Prompt',
            defaultValue: 'Suggest visualizations that help discover deeper insights.\n\nThink about:\n- What questions does this dashboard leave unanswered?\n- What hidden patterns or correlations might exist?\n- What comparisons would reveal actionable insights?\n\nMake each suggestion VALUABLE - explain what specific insight it would reveal.',
            rows: 7,
            show: function(layout) {
              return layout.aiSettings && layout.aiSettings.useCustomSuggestionsPrompt;
            }
          },
          defaultSuggestionsPromptDisplay: {
            component: 'text',
            label: '📝 Default: AI suggests valuable charts based on data gaps',
            show: function(layout) {
              return !layout.aiSettings || !layout.aiSettings.useCustomSuggestionsPrompt;
            }
          }
        }
      },

      // 2. Data Settings Section
      dataSettings: {
        type: 'items',
        label: 'Data Settings',
        items: {
          rowLimit: {
            ref: 'dataSettings.rowLimit',
            type: 'number',
            component: 'slider',
            label: 'Row limit per object',
            defaultValue: 50,
            min: 10,
            max: 500,
            step: 10
          },
          rowLimitHint: {
            component: 'text',
            label: 'More rows = better analysis but higher token cost'
          },
          dataFormat: {
            ref: 'dataSettings.dataFormat',
            type: 'string',
            component: 'dropdown',
            label: 'Data format sent to AI',
            defaultValue: 'compressed',
            options: [
              { value: 'compressed', label: 'Compressed Stats (min/max/avg/top3)' },
              { value: 'raw', label: 'Raw Data (actual rows)' }
            ]
          },
          dataFormatHint: {
            component: 'text',
            label: 'Raw data uses more tokens but AI sees actual patterns'
          }
        }
      },

      // 3. Object Filter Section
      objectFilter: {
        type: 'items',
        label: 'Object Filter',
        items: {
          preset: {
            ref: 'objectFilter.preset',
            type: 'string',
            component: 'buttongroup',
            label: 'Quick Select',
            defaultValue: 'common',
            options: [
              { value: 'common', label: 'Common' },
              { value: 'all', label: 'All' },
              { value: 'custom', label: 'Custom' }
            ]
          },
          presetHint: {
            component: 'text',
            label: 'Common: Bar, Line, Combo, Pie, KPI, Gauge, Table, Scatter',
            show: function(layout) {
              return !layout.objectFilter || layout.objectFilter.preset !== 'custom';
            }
          },
          customTypes: {
            ref: 'objectFilter.customTypes',
            type: 'string',
            component: 'textarea',
            label: 'Custom Types (comma-separated)',
            defaultValue: 'barchart, linechart, combochart, piechart, kpi, gauge, table, scatterplot',
            rows: 3,
            show: function(layout) {
              return layout.objectFilter && layout.objectFilter.preset === 'custom';
            }
          },
          customHint: {
            component: 'text',
            label: 'Available: barchart, linechart, combochart, piechart, kpi, gauge, table, scatterplot, pivot-table, treemap, boxplot, histogram, waterfallchart, map, funnelchart, mekkochart',
            show: function(layout) {
              return layout.objectFilter && layout.objectFilter.preset === 'custom';
            }
          },
          excludedIds: {
            ref: 'objectFilter.excludedIds',
            type: 'string',
            label: 'Exclude Object IDs',
            defaultValue: '',
            expression: 'optional'
          }
        }
      },

      // 4. Badge Settings Section
      badgeSettings: {
        type: 'items',
        label: 'AI Badges',
        items: {
          showInsightBadges: {
            ref: 'outputSettings.showInsightBadges',
            type: 'boolean',
            component: 'switch',
            label: 'Show AI badges on objects',
            defaultValue: true,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          },
          badgeHint: {
            component: 'text',
            label: '✨ Click badge to see AI insight popup'
          },
          badgeVisibility: {
            ref: 'outputSettings.badgeVisibility',
            type: 'string',
            component: 'dropdown',
            label: 'Badge Visibility',
            defaultValue: 'hover',
            options: [
              { value: 'always', label: 'Always visible' },
              { value: 'hover', label: 'Show on hover only' }
            ]
          },
          badgeShift: {
            ref: 'outputSettings.badgeShift',
            type: 'boolean',
            component: 'switch',
            label: 'Shift badge on hover',
            defaultValue: true,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          },
          badgeShiftHint: {
            component: 'text',
            label: 'Turn off if Qlik hover menu is disabled'
          },
          badgeReloadHint: {
            component: 'text',
            label: '⚠️ Reload page after changing badge settings'
          }
        }
      },

      // 5. Export Settings Section
      exportSettings: {
        type: 'items',
        label: 'Export & Copy',
        items: {
          showCopyButtons: {
            ref: 'outputSettings.showCopyButtons',
            type: 'boolean',
            component: 'switch',
            label: 'Show copy buttons',
            defaultValue: true,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          },
          copyButtonHint: {
            component: 'text',
            label: 'Copy individual insights or all at once'
          },
          injectFootnotes: {
            ref: 'outputSettings.injectFootnotes',
            type: 'boolean',
            component: 'switch',
            label: 'Inject to object footnotes',
            defaultValue: true,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          },
          footnoteHint: {
            component: 'text',
            label: 'Requires edit permissions (not available in published apps)'
          },
          showTokenCost: {
            ref: 'outputSettings.showTokenCost',
            type: 'boolean',
            component: 'switch',
            label: 'Show token/cost estimate',
            defaultValue: false,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          },
          tokenCostHint: {
            component: 'text',
            label: 'Display estimated API token usage and cost'
          }
        }
      },

      // 6. Selection Tracking Section
      selectionTracking: {
        type: 'items',
        label: 'Selection Tracking',
        items: {
          detectSelectionChange: {
            ref: 'outputSettings.detectSelectionChange',
            type: 'boolean',
            component: 'switch',
            label: 'Detect selection changes',
            defaultValue: false,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          },
          selectionChangeHint: {
            component: 'text',
            label: 'Show notification when selections change after analysis'
          },
          autoAnalyze: {
            ref: 'outputSettings.autoAnalyze',
            type: 'boolean',
            component: 'switch',
            label: 'Auto-analyze on change',
            defaultValue: false,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ],
            show: function(layout) {
              return layout.outputSettings && layout.outputSettings.detectSelectionChange;
            }
          },
          autoAnalyzeDelay: {
            ref: 'outputSettings.autoAnalyzeDelay',
            type: 'number',
            label: 'Auto-analyze delay (ms)',
            defaultValue: 2000,
            min: 500,
            max: 10000,
            show: function(layout) {
              return layout.outputSettings && layout.outputSettings.detectSelectionChange && layout.outputSettings.autoAnalyze;
            }
          }
        }
      },

      // 8. Comparison Mode Section
      comparisonSettings: {
        type: 'items',
        label: 'Comparison Mode',
        items: {
          enabled: {
            ref: 'comparisonSettings.enabled',
            type: 'boolean',
            component: 'switch',
            label: 'Enable Comparison Mode',
            defaultValue: false,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          },
          comparisonHint: {
            component: 'text',
            label: 'Compare current analysis with previous to see what changed'
          }
        }
      },

      // 9. Bookmarked Analysis Section
      bookmarkSettings: {
        type: 'items',
        label: 'Bookmarked Analysis',
        items: {
          enabled: {
            ref: 'bookmarkSettings.enabled',
            type: 'boolean',
            component: 'switch',
            label: 'Enable Bookmarks',
            defaultValue: false,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          },
          bookmarkHint: {
            component: 'text',
            label: 'Save and reload past analyses for comparison'
          },
          maxBookmarks: {
            ref: 'bookmarkSettings.maxBookmarks',
            type: 'number',
            label: 'Maximum saved analyses',
            defaultValue: 10,
            min: 1,
            max: 50,
            show: function(layout) {
              return layout.bookmarkSettings && layout.bookmarkSettings.enabled;
            }
          }
        }
      },

      // 10. Insight Alerts Section
      insightAlerts: {
        type: 'items',
        label: 'Insight Alerts',
        items: {
          enabled: {
            ref: 'insightAlerts.enabled',
            type: 'boolean',
            component: 'switch',
            label: 'Enable Insight Alerts',
            defaultValue: false,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          },
          alertHint: {
            component: 'text',
            label: 'Highlight objects based on keywords in their summaries'
          },
          alertKeywords: {
            ref: 'insightAlerts.alertKeywords',
            type: 'string',
            component: 'textarea',
            label: 'Warning Keywords (comma-separated)',
            defaultValue: 'decrease, decline, drop, warning, anomaly, concern, risk, critical, below, negative, loss, down, high, overdue, reduce, issue, problem, fail',
            rows: 2,
            show: function(layout) {
              return layout.insightAlerts && layout.insightAlerts.enabled;
            }
          },
          positiveKeywords: {
            ref: 'insightAlerts.positiveKeywords',
            type: 'string',
            component: 'textarea',
            label: 'Positive Keywords (comma-separated)',
            defaultValue: 'increase, growth, improvement, exceeds, above, target, positive, gain, up, success, record',
            rows: 2,
            show: function(layout) {
              return layout.insightAlerts && layout.insightAlerts.enabled;
            }
          },
          highlightObjects: {
            ref: 'insightAlerts.highlightObjects',
            type: 'boolean',
            component: 'switch',
            label: 'Highlight object cards',
            defaultValue: true,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ],
            show: function(layout) {
              return layout.insightAlerts && layout.insightAlerts.enabled;
            }
          },
          highlightBadges: {
            ref: 'insightAlerts.highlightBadges',
            type: 'boolean',
            component: 'switch',
            label: 'Color-code badges',
            defaultValue: true,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ],
            show: function(layout) {
              return layout.insightAlerts && layout.insightAlerts.enabled;
            }
          }
        }
      },

      // 11. Dive Deeper Suggestions
      diveDeeper: {
        type: 'items',
        label: 'Dive Deeper',
        items: {
          enabled: {
            ref: 'diveDeeper.enabled',
            type: 'boolean',
            component: 'switch',
            label: 'Show chart suggestions',
            defaultValue: true,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          },
          suggestionHint: {
            component: 'text',
            label: 'AI suggests additional charts and dimensions to explore for deeper insights'
          },
          maxSuggestions: {
            ref: 'diveDeeper.maxSuggestions',
            type: 'number',
            component: 'slider',
            label: 'Maximum suggestions',
            defaultValue: 3,
            min: 1,
            max: 5,
            step: 1,
            show: function(layout) {
              return layout.diveDeeper && layout.diveDeeper.enabled;
            }
          }
        }
      },

      // Appearance & Display Section - uses Qlik's built-in settings (includes hover menu)
      appearance: {
        uses: 'settings',
        items: {
          // Presentation sub-section
          presentation: {
            type: 'items',
            label: 'Presentation',
            grouped: true,
            items: {
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
              topbarVisibility: {
                ref: 'appearance.topbarVisibility',
                type: 'string',
                component: 'dropdown',
                label: 'Topbar visibility',
                defaultValue: 'always',
                options: [
                  { value: 'always', label: 'Always visible' },
                  { value: 'hover', label: 'Show on hover only' }
                ]
              },
              maxCharsPerObject: {
                ref: 'outputSettings.maxCharsPerObject',
                type: 'number',
                label: 'Max characters per summary',
                defaultValue: 300,
                min: 100,
                max: 3500
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
          // Colors & Styling sub-section
          colorsAndStyling: {
            type: 'items',
            label: 'Colors & Styling',
            grouped: true,
            items: {
              backgroundColor: {
                ref: 'appearance.backgroundColor',
                type: 'object',
                component: 'color-picker',
                label: 'Background Color',
                defaultValue: { color: '#ffffff' }
              },
              textColor: {
                ref: 'appearance.textColor',
                type: 'object',
                component: 'color-picker',
                label: 'Text Color',
                defaultValue: { color: '#333333' }
              },
              accentColor: {
                ref: 'appearance.accentColor',
                type: 'object',
                component: 'color-picker',
                label: 'Accent Color',
                defaultValue: { color: '#009845' }
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
              }
            }
          }
        }
      },

      // Developer Settings
      developer: {
        type: 'items',
        label: 'Developer',
        items: {
          debugEnabled: {
            ref: 'developer.debugEnabled',
            type: 'boolean',
            component: 'switch',
            label: 'Enable Debug Logging',
            defaultValue: false,
            options: [
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]
          },
          debugHint: {
            component: 'text',
            label: 'Open browser console (F12) to view debug logs.'
          }
        }
      },

      // 12. About Section
      about: {
        type: 'items',
        label: 'About',
        items: {
          version: {
            component: 'text',
            label: 'Qlik2Review (Mobile Compatible)'
          },
          description: {
            component: 'text',
            label: 'AI-powered sheet analysis extension (Desktop + Mobile)'
          },
          author: {
            component: 'text',
            label: 'Author: MuchachoAI'
          },
          github: {
            component: 'button',
            label: 'GitHub Repository',
            action: function() {
              window.open('https://github.com/undsoul/Qlik2Review', '_blank');
            }
          }
        }
      }
    }
  };
});
