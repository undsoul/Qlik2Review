define([
  './engine',
  './openai',
  './anthropic',
  './gemini',
  './object-filter',
  './prompt-builder',
  './logger',
  './token-tracker'
], function(engineService, openaiProvider, anthropicProvider, geminiProvider, objectFilter, promptBuilder, logger, tokenTracker) {
  'use strict';

  // Provider registry
  var providers = {
    openai: openaiProvider,
    anthropic: anthropicProvider,
    gemini: geminiProvider
  };

  // Store references for cleanup - CRITICAL for preventing memory leaks
  var activeEventListeners = [];
  var activeTimeouts = [];  // Track setTimeout IDs for cleanup
  var documentClickHandler = null;

  // Simple markdown to HTML converter for popup content
  var markdownToHtml = function(text) {
    if (!text) return '';
    // Escape HTML first
    var escaped = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // Convert **bold** to <strong>
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Convert *italic* to <em>
    escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Clean up any orphan ** from truncation
    escaped = escaped.replace(/\*\*[^*]*$/g, '');
    escaped = escaped.replace(/\*[^*]*$/g, '');
    return escaped;
  };

  // Strip markdown for plain text output (footnotes)
  var stripMarkdown = function(text) {
    if (!text) return '';
    // Remove **bold** markers but keep the text
    return text.replace(/\*\*([^*]+)\*\*/g, '$1')
               .replace(/\*([^*]+)\*/g, '$1');
  };

  // Smart truncation that doesn't break markdown pairs
  var smartTruncate = function(text, maxChars) {
    if (!text || text.length <= maxChars) return text;

    var truncated = text.substring(0, maxChars - 3);

    // Check if we're in the middle of a **bold** section
    var lastOpenBold = truncated.lastIndexOf('**');
    if (lastOpenBold !== -1) {
      // Count ** markers before this point
      var beforeLast = truncated.substring(0, lastOpenBold);
      var boldCount = (beforeLast.match(/\*\*/g) || []).length;
      // If even count before, all previous ** are paired, so the last ** is an opener
      // If odd count before, there's an unclosed opener, so the last ** is a closer
      if (boldCount % 2 === 0) {
        // The last ** is an opener without closer - remove it
        truncated = truncated.substring(0, lastOpenBold);
      }
    }

    return truncated.trim() + '...';
  };

  /**
   * Analyzer Service - Orchestrates sheet analysis
   */
  return {
    /**
     * Analyze entire sheet and generate summaries
     * @param {Object} app - Qlik app object
     * @param {Object} config - Analysis configuration
     * @param {Object} cancelToken - Cancellation token { cancelled: boolean }
     * @param {Function} onProgress - Progress callback
     * @param {string} extensionId - Extension object ID (for mobile fallback)
     * @returns {Promise<Object>} Analysis results
     */
    analyzeSheet: async function(app, config, cancelToken, onProgress, extensionId) {
      var self = this;
      cancelToken = cancelToken || { cancelled: false };
      onProgress = onProgress || function() {};

      logger.group('Sheet Analysis', function() {
        logger.info('Starting sheet analysis with provider:', config.provider);
        logger.info('Extension ID:', extensionId);
      });

      // Get all objects on the sheet (pass extensionId for mobile fallback)
      onProgress('Fetching sheet objects...');
      var rowLimit = config.rowLimit || 50;
      var allObjects = await engineService.getSheetObjects(app, extensionId, rowLimit);
      logger.info('Total objects on sheet:', allObjects.length, '(row limit:', rowLimit + ')');

      // Check cancellation
      if (cancelToken.cancelled) {
        throw new Error('Analysis cancelled');
      }

      // Filter objects based on configuration
      var filteredObjects = objectFilter.filterObjects(allObjects, config.objectFilter);

      logger.info('Objects after filtering:', filteredObjects.length);
      logger.debug('Filtered object IDs:', filteredObjects.map(function(o) { return o.id; }));

      if (filteredObjects.length === 0) {
        logger.warn('No analyzable objects found after filtering');
        return {
          sheetSummary: 'No analyzable objects found on this sheet.',
          objectSummaries: [],
          timestamp: new Date().toISOString()
        };
      }

      // Get current selections for context
      onProgress('Getting current selections...');
      var selections = await engineService.getCurrentSelections(app);

      // Check cancellation
      if (cancelToken.cancelled) {
        throw new Error('Analysis cancelled');
      }

      // Get AI provider
      var provider = providers[config.provider];
      if (!provider) {
        logger.error('Unknown AI provider:', config.provider);
        throw new Error('Unknown AI provider: ' + config.provider);
      }
      logger.info('Using AI provider:', provider.displayName || config.provider);

      // Initialize usage tracker
      var totalUsage = tokenTracker.createEmptyUsage();

      // Concurrent batch size (3 = good balance between speed and rate limits)
      var BATCH_SIZE = 3;
      var objectSummaries = [];
      var completedCount = 0;

      // Helper to analyze single object with error handling
      async function analyzeWithErrorHandling(obj, index) {
        try {
          var endTimer = logger.time('Object ' + obj.id + ' analysis');
          var result = await self.analyzeObject(obj, selections, config, provider);
          endTimer();

          logger.debug('Summary for', obj.id + ':', result.text);

          return {
            index: index,
            data: {
              id: obj.id,
              title: obj.title,
              type: obj.type,
              summary: result.text,
              showHoverMenu: obj.showHoverMenu,
              timestamp: new Date().toISOString(),
              usage: result.usage
            }
          };
        } catch (err) {
          logger.error('Error analyzing object', obj.id + ':', err.message);
          return {
            index: index,
            data: {
              id: obj.id,
              title: obj.title,
              type: obj.type,
              summary: 'Analysis failed: ' + err.message,
              showHoverMenu: obj.showHoverMenu,
              error: true,
              timestamp: new Date().toISOString(),
              usage: null
            }
          };
        }
      }

      // Process objects in concurrent batches
      logger.info('Processing', filteredObjects.length, 'objects in batches of', BATCH_SIZE);

      for (var batchStart = 0; batchStart < filteredObjects.length; batchStart += BATCH_SIZE) {
        // Check cancellation before each batch
        if (cancelToken.cancelled) {
          throw new Error('Analysis cancelled');
        }

        var batchEnd = Math.min(batchStart + BATCH_SIZE, filteredObjects.length);
        var batch = filteredObjects.slice(batchStart, batchEnd);

        // Update progress with batch info
        var progressMsg = 'Analyzing ' + (batchStart + 1) + '-' + batchEnd + ' of ' + filteredObjects.length;
        onProgress(progressMsg);
        logger.info('Batch:', progressMsg);

        // Create promises for this batch
        var batchPromises = batch.map(function(obj, batchIndex) {
          var globalIndex = batchStart + batchIndex;
          logger.info('Analyzing object', (globalIndex + 1) + '/' + filteredObjects.length + ':', obj.id, '(' + obj.type + ')');
          return analyzeWithErrorHandling(obj, globalIndex);
        });

        // Wait for all objects in batch to complete
        var batchResults = await Promise.all(batchPromises);

        // Process batch results
        batchResults.forEach(function(result) {
          // Aggregate usage
          if (result.data.usage) {
            tokenTracker.addUsage(totalUsage, result.data.usage);
          }
          // Remove usage from summary object (not needed in final result)
          delete result.data.usage;
          // Store at correct index to maintain order
          objectSummaries[result.index] = result.data;
          completedCount++;
        });

        // Update progress after batch completes
        onProgress('Completed ' + completedCount + '/' + filteredObjects.length + ' objects');
      }

      // Filter out any undefined entries (shouldn't happen but safety check)
      objectSummaries = objectSummaries.filter(function(s) { return s; });

      // Check cancellation before sheet summary
      if (cancelToken.cancelled) {
        throw new Error('Analysis cancelled');
      }

      // Generate sheet-level summary (with all objects data!)
      onProgress('Generating sheet summary...');
      logger.info('Generating sheet-level summary...');
      var endSheetTimer = logger.time('Sheet summary generation');
      var sheetResult = await self.generateSheetSummary(
        filteredObjects,  // Pass full objects with data
        objectSummaries,
        selections,
        config,
        provider
      );
      endSheetTimer();

      // Aggregate sheet summary usage
      if (sheetResult.usage) {
        tokenTracker.addUsage(totalUsage, sheetResult.usage);
      }

      // Calculate estimated cost
      totalUsage.estimatedCost = tokenTracker.calculateCost(
        config.provider,
        config.model,
        totalUsage.inputTokens,
        totalUsage.outputTokens
      );

      logger.info('Sheet analysis complete');
      logger.debug('Sheet summary:', sheetResult.text);
      logger.info('Total usage:', totalUsage);

      return {
        sheetSummary: sheetResult.text,
        objectSummaries: objectSummaries,
        analyzedObjects: filteredObjects,  // Include objects for dive deeper suggestions
        usage: totalUsage,
        timestamp: new Date().toISOString()
      };
    },

    /**
     * Analyze a single object
     * @param {Object} obj - Object details
     * @param {Array} selections - Current selections
     * @param {Object} config - Configuration
     * @param {Object} provider - AI provider
     * @returns {Promise<Object>} { text: string, usage: object }
     */
    analyzeObject: async function(obj, selections, config, provider) {
      var language = config.language || 'en';
      var dataFormat = config.dataFormat || 'compressed';
      var prompt = promptBuilder.buildObjectPrompt(obj, selections, config.customPrompt, language, dataFormat);
      logger.debug('Prompt for', obj.id + ' (length: ' + prompt.length + ', format: ' + dataFormat + ')');

      var maxTokens = Math.min(100, Math.floor(config.maxCharsPerObject / 4) || 75);
      logger.debug('Max tokens for response:', maxTokens);

      var result = await provider.generateSummary(prompt, {
        apiKey: config.apiKey,
        model: config.model,
        maxTokens: maxTokens
      });

      // Handle both old (string) and new ({ text, usage }) return formats
      var text = typeof result === 'string' ? result : result.text;
      var usage = typeof result === 'object' ? result.usage : null;

      // Truncate if necessary (using smart truncation to preserve markdown)
      var maxChars = config.maxCharsPerObject || 300;
      if (text.length > maxChars) {
        logger.debug('Truncating summary from', text.length, 'to', maxChars, 'chars');
        text = smartTruncate(text, maxChars);
      }

      return { text: text, usage: usage };
    },

    /**
     * Generate sheet-level summary from all objects data
     * @param {Array} objects - Full objects with data
     * @param {Array} objectSummaries - Individual object summaries
     * @param {Array} selections - Current selections
     * @param {Object} config - Configuration
     * @param {Object} provider - AI provider
     * @returns {Promise<Object>} { text: string, usage: object }
     */
    generateSheetSummary: async function(objects, objectSummaries, selections, config, provider) {
      var language = config.language || 'en';
      var dataFormat = config.dataFormat || 'compressed';
      var customSheetPrompt = config.customSheetPrompt || '';
      var prompt = promptBuilder.buildSheetPrompt(objects, objectSummaries, selections, language, dataFormat, customSheetPrompt);
      logger.debug('Sheet prompt length:', prompt.length, ', format:', dataFormat);

      var result = await provider.generateSummary(prompt, {
        apiKey: config.apiKey,
        model: config.model,
        maxTokens: 1000  // More tokens for comprehensive sheet summary (GPT-5.2 needs higher limit)
      });

      // Handle both old (string) and new ({ text, usage }) return formats
      var text = typeof result === 'string' ? result : result.text;
      var usage = typeof result === 'object' ? result.usage : null;

      return { text: text, usage: usage };
    },

    /**
     * Inject footnotes to objects
     * @param {Object} app - Qlik app object
     * @param {Array} objectSummaries - Summaries to inject
     * @returns {Promise<Object>} Results with success/failure counts
     */
    injectFootnotes: async function(app, objectSummaries) {
      var validSummaries = objectSummaries.filter(function(obj) { return !obj.error; });
      logger.info('Injecting footnotes to', validSummaries.length, 'objects');

      var results = { success: 0, failed: 0, errors: [] };

      // Process each object individually to handle partial failures
      for (var i = 0; i < validSummaries.length; i++) {
        var obj = validSummaries[i];
        try {
          var timestamp = new Date(obj.timestamp).toLocaleString();
          // Strip markdown for plain text footnote
          var plainSummary = stripMarkdown(obj.summary);
          var footnote = plainSummary + '\n[AI Summary | ' + timestamp + ']';
          logger.debug('Injecting footnote for', obj.id, '- length:', footnote.length);

          await engineService.updateObjectFootnote(app, obj.id, footnote);
          results.success++;
          logger.info('Footnote injected for object:', obj.id);
        } catch (err) {
          results.failed++;
          results.errors.push({ id: obj.id, error: err.message });
          logger.error('Failed to inject footnote for', obj.id, ':', err.message);
        }
      }

      logger.info('Footnote injection complete. Success:', results.success, 'Failed:', results.failed);
      if (results.failed > 0) {
        logger.warn('Some footnote injections failed:', results.errors);
      }

      return results;
    },

    /**
     * Clear footnotes from analyzed objects (requires edit mode)
     * @param {Object} app - Qlik app object
     * @param {Array} objectSummaries - Objects to clear footnotes from
     * @returns {Object} Results with success/failure counts
     */
    clearFootnotes: async function(app, objectSummaries) {
      var validSummaries = objectSummaries.filter(function(obj) { return !obj.error && obj.id; });
      logger.info('Clearing footnotes from', validSummaries.length, 'objects');

      var results = { success: 0, failed: 0, errors: [] };

      for (var i = 0; i < validSummaries.length; i++) {
        var obj = validSummaries[i];
        try {
          logger.debug('Clearing footnote for', obj.id);
          await engineService.updateObjectFootnote(app, obj.id, '');
          results.success++;
          logger.info('Footnote cleared for object:', obj.id);
        } catch (err) {
          results.failed++;
          results.errors.push({ id: obj.id, error: err.message });
          logger.error('Failed to clear footnote for', obj.id, ':', err.message);
        }
      }

      logger.info('Footnote clearing complete. Success:', results.success, 'Failed:', results.failed);
      if (results.failed > 0) {
        logger.warn('Some footnote clearings failed:', results.errors);
      }

      return results;
    },

    /**
     * Inject insight badges onto analyzed objects (works for all users)
     * @param {Array} objectSummaries - Summaries to display
     * @param {Object} badgeSettings - Badge display settings
     * @returns {Object} Results with success/failure counts
     */
    injectInsightBadges: function(objectSummaries, badgeSettings) {
      badgeSettings = badgeSettings || {};
      var badgeVisibility = badgeSettings.visibility || 'hover';
      var badgeShift = badgeSettings.shift !== false; // default true
      var alertStatuses = badgeSettings.alertStatuses || {};  // { objectId: 'warning' | 'positive' | 'neutral' }
      var validSummaries = objectSummaries.filter(function(obj) { return !obj.error; });
      logger.info('Injecting insight badges to', validSummaries.length, 'objects');

      // First, remove any existing badges and popups (and cleanup listeners)
      this.removeInsightBadges();

      var results = { success: 0, failed: 0 };

      // Create a single popup container in body (for fixed positioning)
      // Check if one already exists to prevent duplicates
      var popupContainer = document.getElementById('q2r-popup-container');
      if (!popupContainer) {
        popupContainer = document.createElement('div');
        popupContainer.id = 'q2r-popup-container';
        document.body.appendChild(popupContainer);
      }

      validSummaries.forEach(function(obj) {
        try {
          // Find the object's DOM element - try multiple selectors for Qlik Cloud
          var objectEl = null;
          var selectors = [
            '[data-qid="' + obj.id + '"]',
            '.qv-object[tid="' + obj.id + '"]',
            '[data-testid*="' + obj.id + '"]',
            'article[data-qid="' + obj.id + '"]',
            '[class*="' + obj.id + '"]'
          ];

          // Try all selectors until one finds the element
          for (var i = 0; i < selectors.length; i++) {
            objectEl = document.querySelector(selectors[i]);
            if (objectEl) {
              logger.debug('Found object with selector:', selectors[i]);
              break;
            }
          }

          if (!objectEl) {
            logger.debug('Could not find DOM element for object:', obj.id);
            results.failed++;
            return;
          }

          // Ensure the parent has position relative for badge positioning
          var parentStyle = window.getComputedStyle(objectEl);
          if (parentStyle && parentStyle.position === 'static') {
            objectEl.style.position = 'relative';
          }

          // Create the badge element
          var badge = document.createElement('div');
          var alertStatus = alertStatuses[obj.id] || 'neutral';
          badge.className = 'q2r-insight-badge' + (alertStatus !== 'neutral' ? ' q2r-badge-' + alertStatus : '');
          badge.setAttribute('data-q2r-object-id', obj.id);

          // Badge icon based on alert status
          var icon = document.createElement('span');
          icon.className = 'q2r-insight-badge-icon';
          if (alertStatus === 'warning') {
            icon.textContent = '⚠️';
          } else if (alertStatus === 'positive') {
            icon.textContent = '✅';
          } else {
            icon.textContent = '✨';
          }
          badge.appendChild(icon);

          // Default position: far right
          badge.style.setProperty('left', 'auto', 'important');
          badge.style.setProperty('right', '8px', 'important');
          badge.style.setProperty('transition', 'right 0.2s ease, opacity 0.2s ease', 'important');

          // Badge visibility setting
          if (badgeVisibility === 'hover') {
            badge.style.setProperty('opacity', '0', 'important');
            badge.style.setProperty('pointer-events', 'none', 'important');
          }

          var mouseEnterHandler = function() {
            // Show badge on hover
            if (badgeVisibility === 'hover') {
              badge.style.setProperty('opacity', '1', 'important');
              badge.style.setProperty('pointer-events', 'auto', 'important');
            }
            // Shift badge if enabled
            if (badgeShift) {
              badge.style.setProperty('right', '100px', 'important');
            }
          };

          var mouseLeaveHandler = function() {
            // Hide badge if hover-only mode
            if (badgeVisibility === 'hover') {
              badge.style.setProperty('opacity', '0', 'important');
              badge.style.setProperty('pointer-events', 'none', 'important');
            }
            // Reset position
            badge.style.setProperty('right', '8px', 'important');
          };

          objectEl.addEventListener('mouseenter', mouseEnterHandler);
          objectEl.addEventListener('mouseleave', mouseLeaveHandler);
          activeEventListeners.push({ element: objectEl, type: 'mouseenter', handler: mouseEnterHandler });
          activeEventListeners.push({ element: objectEl, type: 'mouseleave', handler: mouseLeaveHandler });

          // Create popup (appended to body for proper z-index)
          var popup = document.createElement('div');
          popup.className = 'q2r-insight-popup';
          popup.id = 'q2r-popup-' + obj.id;

          // Popup header with close button (color matches badge alert status)
          var popupHeader = document.createElement('div');
          popupHeader.className = 'q2r-insight-popup-header' + (alertStatus !== 'neutral' ? ' q2r-popup-header-' + alertStatus : '');

          var headerTitle = document.createElement('span');
          headerTitle.textContent = '🤖 ' + (obj.title || obj.type);
          popupHeader.appendChild(headerTitle);

          var closeBtn = document.createElement('span');
          closeBtn.className = 'q2r-popup-close';
          closeBtn.textContent = '✕';
          var closeBtnHandler = function(e) {
            e.stopPropagation();
            popup.classList.remove('q2r-popup-visible');
          };
          closeBtn.addEventListener('click', closeBtnHandler);
          activeEventListeners.push({ element: closeBtn, type: 'click', handler: closeBtnHandler });
          popupHeader.appendChild(closeBtn);
          popup.appendChild(popupHeader);

          // Popup content
          var popupContent = document.createElement('div');
          popupContent.className = 'q2r-insight-popup-content';
          popupContent.innerHTML = markdownToHtml(obj.summary);
          popup.appendChild(popupContent);

          // Popup footer
          var popupFooter = document.createElement('div');
          popupFooter.className = 'q2r-insight-popup-footer';
          var timestamp = obj.timestamp ? new Date(obj.timestamp).toLocaleString() : '';
          popupFooter.textContent = 'Generated: ' + timestamp;
          popup.appendChild(popupFooter);

          // Add popup to body
          popupContainer.appendChild(popup);

          // Click handler for badge - toggle popup
          var badgeClickHandler = function(e) {
            e.stopPropagation();
            e.preventDefault();

            if (!badge || !document.body.contains(badge)) {
              return;
            }

            // Close all other popups
            document.querySelectorAll('.q2r-insight-popup').forEach(function(p) {
              p.classList.remove('q2r-popup-visible');
            });

            // Position popup based on badge position
            var rect = badge.getBoundingClientRect();
            var popupWidth = 300;
            var popupHeight = 280;
            var left;

            if (badge.classList.contains('q2r-badge-shifted')) {
              // Badge on left, popup to right
              left = rect.right + 10;
            } else {
              // Badge on right, popup to left
              left = rect.left - popupWidth - 10;
            }

            if (left < 10) {
              left = rect.right + 10;
            }
            if (left + popupWidth > window.innerWidth) {
              left = window.innerWidth - popupWidth - 10;
            }

            // Vertical positioning
            var top = rect.top;
            if (top + popupHeight > window.innerHeight) {
              top = window.innerHeight - popupHeight - 10;
            }
            if (top < 10) {
              top = 10;
            }

            popup.style.left = left + 'px';
            popup.style.top = top + 'px';
            popup.classList.add('q2r-popup-visible');

            logger.debug('Popup shown for object:', obj.id);
          };
          badge.addEventListener('click', badgeClickHandler);
          activeEventListeners.push({ element: badge, type: 'click', handler: badgeClickHandler });

          // Insert badge into the object
          objectEl.appendChild(badge);

          logger.debug('Badge injected for object:', obj.id);
          results.success++;
        } catch (err) {
          logger.error('Failed to inject badge for', obj.id, ':', err.message);
          results.failed++;
        }
      });

      // Close popup when clicking outside - only add once
      if (!documentClickHandler) {
        documentClickHandler = function(e) {
          // Add null checks to prevent errors if e.target is null
          if (!e || !e.target) return;
          try {
            if (!e.target.closest('.q2r-insight-badge') && !e.target.closest('.q2r-insight-popup')) {
              document.querySelectorAll('.q2r-insight-popup').forEach(function(p) {
                p.classList.remove('q2r-popup-visible');
              });
            }
          } catch (err) {
            // Ignore errors from detached elements
            logger.debug('documentClickHandler error:', err.message);
          }
        };
        document.addEventListener('click', documentClickHandler);
      }

      logger.info('Badge injection complete. Success:', results.success, 'Failed:', results.failed);
      return results;
    },

    /**
     * Remove all insight badges from objects and cleanup all resources
     */
    removeInsightBadges: function() {
      // CRITICAL: Copy arrays before iterating to prevent mutation issues
      // (timeouts may self-remove during iteration)
      var listenersCopy = activeEventListeners.slice();
      var timeoutsCopy = activeTimeouts.slice();

      // Clear original arrays first to prevent new items being added during cleanup
      activeEventListeners = [];
      activeTimeouts = [];

      // Remove all event listeners
      logger.debug('Removing', listenersCopy.length, 'event listeners');
      listenersCopy.forEach(function(item) {
        try {
          item.element.removeEventListener(item.type, item.handler);
        } catch (e) {
          logger.debug('Event listener removal error:', e.message);
        }
      });

      // Clear all pending timeouts
      logger.debug('Clearing', timeoutsCopy.length, 'pending timeouts');
      timeoutsCopy.forEach(function(timeoutId) {
        try {
          clearTimeout(timeoutId);
        } catch (e) {
          logger.debug('Timeout clear error:', e.message);
        }
      });

      // Remove document click handler
      if (documentClickHandler) {
        document.removeEventListener('click', documentClickHandler);
        documentClickHandler = null;
      }

      // Remove badges
      var badges = document.querySelectorAll('.q2r-insight-badge');
      badges.forEach(function(badge) {
        badge.remove();
      });

      // Remove popup container
      var popupContainer = document.getElementById('q2r-popup-container');
      if (popupContainer) {
        popupContainer.remove();
      }

      // Also remove any orphaned popups
      var popups = document.querySelectorAll('.q2r-insight-popup');
      popups.forEach(function(popup) {
        popup.remove();
      });

      logger.info('Cleanup complete. Removed', badges.length, 'badges,', listenersCopy.length, 'listeners,', timeoutsCopy.length, 'timeouts');
    },

    /**
     * Full cleanup - call when extension is destroyed
     */
    destroy: function() {
      logger.info('Analyzer destroy called - cleaning up all resources');
      this.removeInsightBadges();
    }
  };
});
