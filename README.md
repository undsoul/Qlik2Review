# Qlik2Review

<img width="1024" height="768" alt="image" src="https://github.com/user-attachments/assets/6c387774-3be7-4f71-b29b-bae6d289d6e9" />


AI-powered sheet analysis extension for Qlik Sense with multi-provider support.

![Version](https://img.shields.io/badge/version-3.9.3-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![Qlik](https://img.shields.io/badge/Qlik%20Sense-3.2%2B-orange)

## Features

### Multi-Provider AI Support
- **OpenAI**: GPT-4.1, GPT-4.1 Mini, GPT-5 Mini, GPT-5.2
- **Anthropic**: Claude 3.5 Haiku, Claude Sonnet 4, Claude Sonnet 4.5, Claude Opus 4.5
- **Google Gemini**: Gemini 2.5 Flash-Lite, Gemini 2.5 Flash, Gemini 2.5 Pro, Gemini 3 Flash, Gemini 3 Pro

### Analysis Capabilities
- **Sheet Summary**: Executive-style analytical commentary (Overview, Trends, Concerns, Recommendations)
- **Object Insights**: Individual analysis for each KPI, chart, and table
- **KPI Analysis**: Full extraction including secondary/comparison values (+4.6%, -2.3%)
- **Dive Deeper**: AI suggests additional charts to explore - create them with one click
- **Insight Alerts**: Automatic detection of warnings (⚠️) and positive indicators (✅)

### Smart Features
- **AI Badges**: Clickable insight badges on charts with color-coded popups
- **Selection Tracking**: Detects when selections change, optional auto-re-analyze
- **Comparison Mode**: Compare current vs previous analysis
- **Bookmarks**: Save and recall analysis snapshots
- **Token Tracking**: Monitor API usage and estimated costs

### Data Optimization
- **TOON Compression**: Token-Optimized Object Notation saves ~60% on API costs
- **Row Limit Control**: Send 10-500 rows per object
- **Object Filtering**: Analyze only specific chart types

### Output Options
- **Footnote Injection**: Write insights directly to object footnotes
- **Copy Functions**: Copy individual insights or all at once
- **Multi-Language**: 12 languages (EN, TR, DE, ES, FR, PT, IT, NL, ZH, JA, KO, AR)

---

## Installation

### Qlik Sense Desktop
1. Download the `Qlik2Review` folder
2. Copy to `C:\Users\[Username]\Documents\Qlik\Sense\Extensions\`
3. Restart Qlik Sense Desktop

### Qlik Sense Enterprise / Cloud
1. Zip the `Qlik2Review` folder
2. Go to Management Console > Extensions
3. Import the zip file
4. The extension will be available in Custom Objects

---

## Quick Start

1. **Add Extension**: Drag Qlik2Review from Custom Objects onto your sheet
2. **Configure**: Open Properties panel → AI Settings → Enter API Key
3. **Analyze**: Click the Analyze button

---

## Variable Support

Store API keys in Qlik variables instead of hardcoding:

```qlik
// In load script
SET vAPIKey = 'sk-proj-your-api-key-here';
```

Then reference in extension properties:
```
=vAPIKey
```

---

## Complete Configuration Reference

Everything is configurable from the Properties Panel. Here's every setting available:

### 1. AI Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **AI Provider** | Dropdown | OpenAI | Choose: OpenAI, Anthropic, or Google Gemini |
| **API Key** | Text (expression) | - | Your provider API key. Supports `=vVariableName` |
| **Model** | Text (expression) | Auto | Override default model. Leave blank for recommended |
| **Response Language** | Dropdown | English | Output in 12 languages |
| **Advanced Model Settings** | Toggle | Off | Show temperature, max tokens, top P |
| **Temperature** | Slider | 0.3 | Creativity (0=deterministic, 2=creative) |
| **Max Tokens** | Slider | 150 | Response length (50-4000) |
| **Top P** | Slider | 1.0 | Nucleus sampling (1=all tokens) |
| **Customize Object Analysis** | Toggle | Off | Write custom prompt for objects |
| **Object Analysis Prompt** | Textarea | Default | Custom instructions for KPI/chart analysis |
| **Customize Sheet Summary** | Toggle | Off | Write custom prompt for sheet summary |
| **Sheet Summary Prompt** | Textarea | Default | Custom instructions for overall summary |
| **Customize Dive Deeper** | Toggle | Off | Write custom prompt for suggestions |
| **Dive Deeper Prompt** | Textarea | Default | Custom instructions for chart suggestions |

### 2. Data Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Row Limit** | Slider | 50 | Rows per object sent to AI (10-500) |
| **Data Format** | Dropdown | Compressed | Compressed Stats or Raw Data (TOON) |

**Data Formats Explained:**
- **Compressed Stats**: Sends min, max, avg, top 3, bottom 3 - lower token cost
- **Raw Data (TOON)**: Sends actual rows in token-optimized format - AI sees real patterns

### 3. Object Filter

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Quick Select** | Button Group | Common | Common, All, or Custom types |
| **Custom Types** | Textarea | - | Comma-separated list when Custom selected |
| **Exclude Object IDs** | Text (expression) | - | Skip specific objects by ID |

**Common Types**: barchart, linechart, combochart, piechart, kpi, gauge, table, scatterplot

**All Supported Types**: barchart, linechart, combochart, piechart, kpi, gauge, table, scatterplot, pivot-table, treemap, boxplot, histogram, waterfallchart, map, funnelchart, mekkochart

### 4. AI Badges

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Show AI Badges** | Toggle | On | Display clickable badges on objects |
| **Badge Visibility** | Dropdown | Hover | Always visible or show on hover only |
| **Shift Badge on Hover** | Toggle | On | Move badge to avoid Qlik menu overlap |

### 5. Export & Copy

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Show Copy Buttons** | Toggle | On | Enable copy functionality |
| **Inject to Footnotes** | Toggle | On | Write insights to object footnotes |
| **Show Token/Cost** | Toggle | Off | Display API usage estimates |

### 6. Selection Tracking

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Detect Selection Changes** | Toggle | Off | Notify when selections change |
| **Auto-Analyze on Change** | Toggle | Off | Re-run analysis automatically |
| **Auto-Analyze Delay** | Number | 2000ms | Wait time before auto-analyze (500-10000) |

### 7. Comparison Mode

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Enable Comparison** | Toggle | Off | Compare current vs previous analysis |

### 8. Bookmarked Analysis

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Enable Bookmarks** | Toggle | Off | Save/load analysis snapshots |
| **Max Bookmarks** | Number | 10 | Limit per sheet (1-50) |

### 9. Insight Alerts

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Enable Alerts** | Toggle | Off | Highlight based on keywords |
| **Warning Keywords** | Textarea | decrease, decline... | Words triggering warning status |
| **Positive Keywords** | Textarea | increase, growth... | Words triggering positive status |
| **Highlight Object Cards** | Toggle | On | Color object cards by status |
| **Color-Code Badges** | Toggle | On | Color badges by alert status |

**Default Warning Keywords**: decrease, decline, drop, warning, anomaly, concern, risk, critical, below, negative, loss, down, high, overdue, reduce, issue, problem, fail

**Default Positive Keywords**: increase, growth, improvement, exceeds, above, target, positive, gain, up, success, record

### 10. Dive Deeper

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Show Suggestions** | Toggle | On | AI suggests additional charts |
| **Max Suggestions** | Slider | 3 | Number of suggestions (1-5) |

### 11. Appearance (Qlik Native + Custom)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Show Titles** | Toggle | On | Display title/subtitle/footnote |
| **Show Hover Menu** | Toggle | On | Qlik's native context menu |
| **Show Sheet Summary** | Toggle | On | Display executive summary |
| **Show Object List** | Toggle | On | Display per-object insights |
| **Topbar Visibility** | Dropdown | Always | Always visible or show on hover |
| **Max Characters** | Number | 300 | Summary length (100-3500) |
| **Show Timestamp** | Toggle | On | Display analysis time |
| **Background Color** | Color Picker | #ffffff | Custom background |
| **Text Color** | Color Picker | #333333 | Custom text color |
| **Accent Color** | Color Picker | #009845 | Custom highlight color |
| **Font Size** | Dropdown | Medium | Small (12px), Medium (14px), Large (16px) |

### 12. Developer

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Debug Logging** | Toggle | Off | Enable console logging (F12) |

---

## TOON Data Format

Token-Optimized Object Notation reduces API costs by ~60%:

**Traditional JSON (verbose):**
```json
[
  {"Region": "North", "Sales": 1000, "Profit": 200},
  {"Region": "South", "Sales": 2000, "Profit": 400},
  {"Region": "East", "Sales": 1500, "Profit": 300}
]
```

**TOON Format (compact):**
```
Cols: ["Region", "Sales", "Profit"]
Rows: [["North", 1000, 200], ["South", 2000, 400], ["East", 1500, 300]]
```

Same data, fewer tokens. AI understands both formats equally well.

---

## Sheet Summary Format

The sheet summary provides executive-style analytical commentary:

```
📊 Overview:
Sales $986.4K (+4.6%) - a positive rebound driven by strong weekly
performance. Inventory $103.67M remains stable.

📈 Key Trends:
Weekly sales peaked at $1.44M (W20) then fell to $940.7K (W22) -
volatility suggests demand isn't stable.

⚠️ Concerns:
St Albans forecast 45.5% availability - why is it underperforming
so severely? Inventory up while sales forecast down.

💡 Recommendations:
1) Fix St Albans first: reduce shorts from 45 toward avg 25
2) Rebalance inventory to high-availability stores
3) Move availability target from 92% → 95%
```

---

## API Key Setup

### OpenAI
1. Go to [platform.openai.com](https://platform.openai.com)
2. Navigate to API Keys
3. Create new secret key (supports `sk-xxx` and `sk-proj-xxx` formats)

### Anthropic (Claude)
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Go to Settings > API Keys
3. Create new key (format: `sk-ant-xxx`)

### Google Gemini
1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Click "Get API Key"
3. Create key for project

---

## Best Practices

### For Security
- **Always use variables** for API keys: `=vAPIKey`
- Store keys in load script, not properties
- Use different keys for dev/prod
- Never publish apps with hardcoded keys

### For Best Results
- Use clear, descriptive chart titles
- Enable Insight Alerts for quick scanning
- Use Raw Data format for pattern detection
- Customize prompts for your domain

### For Performance
- Use Compressed Stats format (lower costs)
- Filter to relevant object types only
- Set appropriate row limits
- Use hover-only badges for clean UI

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No analyzable objects | Check Object Filter settings |
| Analysis failed: 401 | Verify API key is correct |
| Analysis failed: 429 | Rate limited - wait and retry |
| Request timed out | Will auto-retry (30s timeout) |
| KPI shows 0% | Update to v3.8.8+ |
| Empty responses | Update to v3.9.1+ (auto-retry) |

---

## Technical Details

- **Dependencies**: None (Vanilla JS)
- **Tested on**: Qlik Sense SaaS
- **On-premise**: Not tested

---

## Author

**MuchachoAI**

## License

MIT License

## Repository

[GitHub - undsoul/Qlik2Review](https://github.com/undsoul/Qlik2Review)
