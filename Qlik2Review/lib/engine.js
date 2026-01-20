define(['qlik', './logger'], function(qlik, logger) {
  'use strict';

  /**
   * Engine Service - Handles communication with Qlik Engine API
   * Works with both Cloud and On-Premise environments
   */
  return {
    /**
     * Detect if running in Cloud or On-Premise environment
     * @returns {string} 'cloud' or 'onprem'
     */
    detectEnvironment: function() {
      // Check for cloud-specific indicators
      if (window.location.hostname.includes('.qlikcloud.com') ||
          window.location.hostname.includes('.eu.qlikcloud.com') ||
          window.location.hostname.includes('.us.qlikcloud.com')) {
        logger.info('Environment detected: Cloud');
        return 'cloud';
      }
      logger.info('Environment detected: On-Premise');
      return 'onprem';
    },

    /**
     * Get current sheet ID - handles both Cloud and On-Prem
     * @returns {Promise<string>} Sheet ID
     */
    getCurrentSheetId: function() {
      return new Promise(function(resolve, reject) {
        // Log what's available
        logger.info('qlik object:', typeof qlik);
        logger.info('qlik.navigation:', typeof qlik !== 'undefined' ? typeof qlik.navigation : 'qlik undefined');

        try {
          // Method 1: qlik.navigation.getCurrentSheetId()
          if (typeof qlik !== 'undefined' && qlik.navigation && qlik.navigation.getCurrentSheetId) {
            var result = qlik.navigation.getCurrentSheetId();
            logger.info('getCurrentSheetId result:', JSON.stringify(result));

            if (result && typeof result.then === 'function') {
              result.then(function(sheetInfo) {
                logger.info('Promise resolved:', JSON.stringify(sheetInfo));
                resolve(sheetInfo.sheetId || sheetInfo);
              }).catch(function(err) {
                logger.info('Promise rejected, trying fallbacks');
                tryFallbacks(resolve, reject);
              });
              return;
            } else if (result && result.sheetId) {
              logger.info('Direct sheetId:', result.sheetId);
              resolve(result.sheetId);
              return;
            } else if (typeof result === 'string') {
              logger.info('String result:', result);
              resolve(result);
              return;
            }
          }

          // If we get here, navigation API didn't work
          logger.info('Navigation API failed, trying fallbacks');
          tryFallbacks(resolve, reject);

        } catch (err) {
          logger.info('Exception:', err.message);
          tryFallbacks(resolve, reject);
        }
      });

      function tryFallbacks(resolve, reject) {
        // Fallback 1: DOM
        var domSheetId = extractSheetIdFromDom();
        if (domSheetId) {
          resolve(domSheetId);
          return;
        }
        // Fallback 2: URL
        var urlSheetId = extractSheetIdFromUrl();
        if (urlSheetId) {
          logger.info('Sheet ID from URL:', urlSheetId);
          resolve(urlSheetId);
          return;
        }
        reject(new Error('Unable to get current sheet ID'));
      }

      // Helper to extract sheet ID from URL
      function extractSheetIdFromUrl() {
        var url = window.location.href;
        // Multiple patterns for different environments
        var patterns = [
          /\/sheet\/([a-f0-9-]+)/i,           // /sheet/UUID
          /sheet=([a-f0-9-]+)/i,               // sheet=UUID
          /sheetId=([a-f0-9-]+)/i,             // sheetId=UUID
          /\/sheets\/([a-f0-9-]+)/i,           // /sheets/UUID
          /[?&]sheet=([a-f0-9-]+)/i            // ?sheet=UUID or &sheet=UUID
        ];
        for (var i = 0; i < patterns.length; i++) {
          var match = url.match(patterns[i]);
          if (match) return match[1];
        }
        return null;
      }

      // Helper to extract sheet ID from DOM
      function extractSheetIdFromDom() {
        // Try multiple selectors for sheet container
        var selectors = [
          '[data-qid].qvt-sheet',
          '.qvt-sheet[data-qid]',
          'article.qvt-sheet[data-qid]',
          '[class*="sheet"][data-qid]',
          '[data-testid*="sheet"]',
          '.sheet-container[data-qid]'
        ];

        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (el) {
            var qid = el.getAttribute('data-qid') || el.getAttribute('data-testid');
            if (qid) {
              logger.info('Sheet ID from DOM (' + selectors[i] + '):', qid);
              return qid;
            }
          }
        }

        // Try finding any element with sheet-like ID pattern
        var allWithQid = document.querySelectorAll('[data-qid]');
        for (var j = 0; j < allWithQid.length; j++) {
          var el = allWithQid[j];
          var className = el.className || '';
          if (className.indexOf('sheet') !== -1) {
            var qid = el.getAttribute('data-qid');
            if (qid) {
              logger.info('Sheet ID from DOM (class contains sheet):', qid);
              return qid;
            }
          }
        }

        return null;
      }
    },

    /**
     * Container types that may hold nested objects
     */
    containerTypes: [
      'container',
      'sn-layout-container',
      'qlik-tab-container',
      'sn-tabbed-container',
      'tabcontainer',
      'layoutcontainer'
    ],

    /**
     * Maximum recursion depth for nested containers
     */
    MAX_CONTAINER_DEPTH: 5,

    /**
     * Check if object type is a container (exact match only)
     * @param {string} type - Object type
     * @returns {boolean}
     */
    isContainer: function(type) {
      if (!type) return false;
      var lowerType = type.toLowerCase();
      // Use exact match to avoid false positives
      return this.containerTypes.some(function(ct) {
        return lowerType === ct.toLowerCase();
      });
    },

    /**
     * Get all visualization objects on the current sheet (including nested in containers)
     * @param {Object} app - Qlik app object
     * @param {string} extensionId - Optional extension ID to find its parent sheet
     * @param {number} rowLimit - Maximum rows to extract per object (default: 50)
     * @returns {Promise<Array>} Array of sheet objects with metadata
     */
    getSheetObjects: async function(app, extensionId, rowLimit) {
      var self = this;
      var maxRows = rowLimit || 50;

      // Try to get sheetId, but don't fail if we can't
      var sheetId = null;
      try {
        sheetId = await this.getCurrentSheetId();
        logger.info('Current sheet ID:', sheetId);
      } catch (err) {
        logger.info('Could not get sheetId via navigation, trying alternative methods');
      }

      // If no sheetId, try to find it by looking for the extension's parent sheet
      if (!sheetId && extensionId) {
        logger.info('Trying to find sheet containing extension:', extensionId);
        sheetId = await this.findSheetByExtensionId(app, extensionId);
      }

      // If still no sheetId, try getting all sheets and use the first one (mobile fallback)
      if (!sheetId) {
        logger.info('Trying mobile fallback: get sheet list');
        sheetId = await this.getFirstSheetId(app);
      }

      if (!sheetId) {
        logger.error('Could not determine current sheet ID');
        return [];
      }

      return new Promise(function(resolve, reject) {
        app.getObject(sheetId).then(function(sheetModel) {
          sheetModel.getLayout().then(async function(layout) {
            var cells = layout.cells || [];
            logger.info('Found', cells.length, 'top-level cells on sheet');

            try {
              // Get all objects including nested ones in containers
              // Pass depth=0 and empty seenIds set for deduplication
              var seenIds = {};
              var allObjects = await self.getObjectsRecursive(app, cells, 0, seenIds, maxRows);

              logger.info('Retrieved', allObjects.length, 'total objects (including nested, row limit:', maxRows + ')');
              logger.debug('Objects:', allObjects.map(function(o) {
                return { id: o.id, type: o.type, title: o.title };
              }));
              resolve(allObjects);
            } catch (err) {
              logger.error('Failed to get object details:', err.message);
              reject(err);
            }

          }).catch(function(err) {
            logger.error('Failed to get sheet layout:', err.message);
            reject(err);
          });
        }).catch(function(err) {
          logger.error('Failed to get sheet object:', err.message);
          reject(err);
        });
      });
    },

    /**
     * Find sheet ID by searching for a sheet that contains the given extension ID
     * @param {Object} app - Qlik app object
     * @param {string} extensionId - Extension object ID
     * @returns {Promise<string|null>} Sheet ID or null
     */
    findSheetByExtensionId: function(app, extensionId) {
      return new Promise(function(resolve) {
        try {
          app.getList('sheet', function(reply) {
            var sheets = reply.qAppObjectList.qItems || [];
            logger.info('Found', sheets.length, 'sheets in app');

            if (sheets.length === 0) {
              resolve(null);
              return;
            }

            // Check each sheet for our extension
            var checkSheet = function(index) {
              if (index >= sheets.length) {
                logger.info('Extension not found in any sheet');
                resolve(null);
                return;
              }

              var sheet = sheets[index];
              var sheetId = sheet.qInfo.qId;

              app.getObject(sheetId).then(function(sheetModel) {
                sheetModel.getLayout().then(function(layout) {
                  var cells = layout.cells || [];
                  var found = cells.some(function(cell) {
                    return cell.name === extensionId || cell.ref === extensionId;
                  });

                  if (found) {
                    logger.info('Found extension in sheet:', sheetId);
                    resolve(sheetId);
                  } else {
                    checkSheet(index + 1);
                  }
                }).catch(function() {
                  checkSheet(index + 1);
                });
              }).catch(function() {
                checkSheet(index + 1);
              });
            };

            checkSheet(0);
          });
        } catch (err) {
          logger.error('Error finding sheet by extension ID:', err.message);
          resolve(null);
        }
      });
    },

    /**
     * Get the first sheet ID from the app (mobile fallback)
     * @param {Object} app - Qlik app object
     * @returns {Promise<string|null>} First sheet ID or null
     */
    getFirstSheetId: function(app) {
      return new Promise(function(resolve) {
        try {
          app.getList('sheet', function(reply) {
            var sheets = reply.qAppObjectList.qItems || [];
            if (sheets.length > 0) {
              var sheetId = sheets[0].qInfo.qId;
              logger.info('Using first sheet as fallback:', sheetId);
              resolve(sheetId);
            } else {
              logger.error('No sheets found in app');
              resolve(null);
            }
          });
        } catch (err) {
          logger.error('Error getting first sheet:', err.message);
          resolve(null);
        }
      });
    },

    /**
     * Recursively get objects from cells, expanding containers
     * @param {Object} app - Qlik app object
     * @param {Array} cells - Array of cell objects with 'name' property
     * @param {number} depth - Current recursion depth (for safety limit)
     * @param {Object} seenIds - Object tracking seen IDs to prevent duplicates
     * @param {number} rowLimit - Maximum rows to extract per object
     * @returns {Promise<Array>} Flattened array of all objects
     */
    getObjectsRecursive: async function(app, cells, depth, seenIds, rowLimit) {
      var self = this;
      var allObjects = [];
      var maxRows = rowLimit || 50;

      // Safety: prevent infinite recursion
      if (depth > self.MAX_CONTAINER_DEPTH) {
        logger.warn('Max container depth reached (' + self.MAX_CONTAINER_DEPTH + '), stopping recursion');
        return allObjects;
      }

      for (var i = 0; i < cells.length; i++) {
        var cell = cells[i];
        var objectId = cell.name || cell.ref;

        if (!objectId) continue;

        // Skip if already processed (deduplication)
        if (seenIds[objectId]) {
          logger.debug('Skipping duplicate object:', objectId);
          continue;
        }
        seenIds[objectId] = true;

        try {
          var objDetail = await self.getObjectDetails(app, objectId, maxRows);

          if (!objDetail) continue;

          // Check if this is a container - if so, get nested objects
          if (self.isContainer(objDetail.type)) {
            logger.info('Found container:', objDetail.id, '(' + objDetail.type + ') at depth', depth, '- extracting nested objects');
            var nestedObjects = await self.getContainerChildren(app, objectId, depth + 1, seenIds, maxRows);
            allObjects = allObjects.concat(nestedObjects);
          } else {
            // Regular visualization object
            allObjects.push(objDetail);
          }
        } catch (err) {
          logger.warn('Failed to process object', objectId, ':', err.message);
        }
      }

      return allObjects;
    },

    /**
     * Get children objects from a container
     * @param {Object} app - Qlik app object
     * @param {string} containerId - Container object ID
     * @param {number} depth - Current recursion depth
     * @param {Object} seenIds - Object tracking seen IDs to prevent duplicates
     * @param {number} rowLimit - Maximum rows to extract per object
     * @returns {Promise<Array>} Array of child objects
     */
    getContainerChildren: async function(app, containerId, depth, seenIds, rowLimit) {
      var self = this;
      var childObjects = [];
      var maxRows = rowLimit || 50;

      try {
        var model = await new Promise(function(resolve, reject) {
          app.getObject(containerId).then(resolve).catch(reject);
        });

        var layout = await new Promise(function(resolve, reject) {
          model.getLayout().then(resolve).catch(reject);
        });

        // Different container types store children differently
        var children = [];

        // Layout container - children in 'children' array
        if (layout.children && Array.isArray(layout.children)) {
          children = layout.children.map(function(child) {
            return { name: child.refId || child.ref || child.name };
          }).filter(function(c) { return c.name; });
          logger.debug('Layout container has', children.length, 'children');
        }

        // Tab container - children in 'tabs' array
        if (layout.tabs && Array.isArray(layout.tabs)) {
          layout.tabs.forEach(function(tab) {
            if (tab.children && Array.isArray(tab.children)) {
              tab.children.forEach(function(child) {
                children.push({ name: child.refId || child.ref || child.name });
              });
            }
            // Some tab containers use 'ref' directly
            if (tab.ref) {
              children.push({ name: tab.ref });
            }
          });
          logger.debug('Tab container has', children.length, 'children across tabs');
        }

        // Old container format - cells array
        if (layout.cells && Array.isArray(layout.cells)) {
          children = children.concat(layout.cells.map(function(cell) {
            return { name: cell.name || cell.ref };
          }).filter(function(c) { return c.name; }));
          logger.debug('Container cells:', children.length);
        }

        // qlik-object style children
        if (layout.qChildren && Array.isArray(layout.qChildren)) {
          layout.qChildren.forEach(function(qChild) {
            if (qChild.qId) {
              children.push({ name: qChild.qId });
            }
          });
        }

        // Recursively process children (they might be nested containers too)
        if (children.length > 0) {
          childObjects = await self.getObjectsRecursive(app, children, depth, seenIds, maxRows);
        }

        logger.info('Extracted', childObjects.length, 'objects from container', containerId);

      } catch (err) {
        logger.warn('Failed to get container children for', containerId, ':', err.message);
      }

      return childObjects;
    },

    /**
     * Get details for a specific object including its data
     * @param {Object} app - Qlik app object
     * @param {string} objectId - Object ID
     * @param {number} rowLimit - Maximum rows to extract (default: 50)
     * @returns {Promise<Object>} Object details with data
     */
    getObjectDetails: async function(app, objectId, rowLimit) {
      var self = this;
      var maxRows = rowLimit || 50;

      return new Promise(function(resolve) {
        logger.debug('Getting details for object:', objectId);

        app.getObject(objectId).then(function(model) {
          // Get both layout and properties to find showHoverMenu setting
          Promise.all([
            model.getLayout(),
            model.getProperties()
          ]).then(async function(results) {
            var layout = results[0];
            var props = results[1];

            // Look for showHoverMenu in multiple possible locations
            var showHoverMenu = true; // default to true

            // Check properties first (this is where Qlik stores it)
            if (props.showHoverMenu !== undefined) {
              showHoverMenu = props.showHoverMenu;
              logger.debug('Object', objectId, 'showHoverMenu from props:', showHoverMenu);
            } else if (props.menu && props.menu.showHoverMenu !== undefined) {
              showHoverMenu = props.menu.showHoverMenu;
              logger.debug('Object', objectId, 'showHoverMenu from props.menu:', showHoverMenu);
            }
            // Also check layout
            else if (layout.showHoverMenu !== undefined) {
              showHoverMenu = layout.showHoverMenu;
              logger.debug('Object', objectId, 'showHoverMenu from layout:', showHoverMenu);
            }

            // Log all top-level props keys for debugging
            logger.debug('Object', objectId, 'props keys:', Object.keys(props).join(', '));

            var objectInfo = {
              id: objectId,
              type: layout.visualization || (layout.qInfo && layout.qInfo.qType) || 'unknown',
              title: layout.title || (layout.qMeta && layout.qMeta.title) || 'Untitled',
              subtitle: layout.subtitle || '',
              footnote: layout.footnote || '',
              showHoverMenu: showHoverMenu, // Native Qlik setting for this object
              dimensions: [],
              measures: [],
              data: null
            };

            logger.info('Object', objectId, 'type:', objectInfo.type, 'showHoverMenu:', showHoverMenu);

            // Extract dimension info
            if (layout.qHyperCube) {
              objectInfo.dimensions = (layout.qHyperCube.qDimensionInfo || []).map(function(dim) {
                // qGroupFieldDefs contains the actual field expression like ["Product"] or ["=Year(Date)"]
                var fieldDef = dim.qGroupFieldDefs && dim.qGroupFieldDefs[0];
                return {
                  label: dim.qFallbackTitle || fieldDef || 'Dimension',
                  field: fieldDef || dim.qFallbackTitle || 'Dimension',
                  cardinality: dim.qCardinal || 0
                };
              });

              // Get measure definitions from props.qHyperCubeDef (has expressions) or layout.qHyperCubeDef
              var measDefs = (props.qHyperCubeDef && props.qHyperCubeDef.qMeasures) ||
                             (layout.qHyperCubeDef && layout.qHyperCubeDef.qMeasures) || [];

              objectInfo.measures = (layout.qHyperCube.qMeasureInfo || []).map(function(meas, idx) {
                // Try to get the actual expression from qHyperCubeDef
                var expr = null;
                var libId = null;
                if (measDefs[idx]) {
                  // Check for inline expression
                  if (measDefs[idx].qDef && measDefs[idx].qDef.qDef) {
                    expr = measDefs[idx].qDef.qDef;
                  }
                  // Check for master measure library ID
                  if (measDefs[idx].qLibraryId) {
                    libId = measDefs[idx].qLibraryId;
                  }
                }
                return {
                  label: meas.qFallbackTitle || 'Measure',
                  expression: expr,
                  libraryId: libId,
                  min: meas.qMin,
                  max: meas.qMax
                };
              });

              // Check if we have data in layout, if not fetch it explicitly (needed for tables)
              var dataPages = layout.qHyperCube.qDataPages || [];
              var hasData = dataPages.length > 0 && dataPages[0].qMatrix && dataPages[0].qMatrix.length > 0;

              if (!hasData && (objectInfo.type === 'table' || objectInfo.type === 'pivot-table')) {
                // Tables often don't have data pre-loaded - fetch it explicitly
                logger.debug('Fetching hypercube data for table:', objectId, '(limit:', maxRows, ')');
                var totalCols = objectInfo.dimensions.length + objectInfo.measures.length;
                var fetchedData = await new Promise(function(resolveData) {
                  model.getHyperCubeData('/qHyperCubeDef', [
                    { qTop: 0, qLeft: 0, qWidth: totalCols, qHeight: Math.min(maxRows, 500) }
                  ]).then(function(pages) {
                    resolveData(pages);
                  }).catch(function(err) {
                    logger.debug('getHyperCubeData failed:', err.message);
                    resolveData(null);
                  });
                });

                if (fetchedData && fetchedData[0] && fetchedData[0].qMatrix) {
                  objectInfo.data = self.extractHyperCubeDataFromMatrix(
                    fetchedData[0].qMatrix,
                    objectInfo.dimensions.length,
                    objectInfo.measures.length,
                    maxRows
                  );
                  logger.debug('Fetched', objectInfo.data.length, 'rows for table', objectId);
                }
              } else {
                // Get actual data from hypercube (already in layout)
                objectInfo.data = self.extractHyperCubeData(layout.qHyperCube, maxRows);
              }

              logger.debug('Object', objectId, 'has', objectInfo.dimensions.length, 'dimensions,',
                objectInfo.measures.length, 'measures,', (objectInfo.data ? objectInfo.data.length : 0), 'data rows');
            }

            // Handle KPI objects - extract primary and secondary measures
            if (layout.qHyperCube && objectInfo.type === 'kpi') {
              var kpiDataPages = layout.qHyperCube.qDataPages;
              if (kpiDataPages && kpiDataPages[0] && kpiDataPages[0].qMatrix && kpiDataPages[0].qMatrix[0]) {
                var kpiRow = kpiDataPages[0].qMatrix[0];
                // First measure (primary KPI value)
                if (kpiRow[0]) {
                  objectInfo.kpiValue = kpiRow[0].qText || kpiRow[0].qNum;
                  logger.debug('KPI primary value:', objectInfo.kpiValue);
                }
                // Second measure (comparison/trend value) if exists
                if (kpiRow[1]) {
                  objectInfo.kpiSecondaryValue = kpiRow[1].qText || kpiRow[1].qNum;
                  objectInfo.kpiSecondaryNum = kpiRow[1].qNum;
                  logger.debug('KPI secondary value:', objectInfo.kpiSecondaryValue, 'num:', objectInfo.kpiSecondaryNum);
                }
              }
            }

            resolve(objectInfo);
          }).catch(function(err) {
            logger.warn('Failed to get layout/properties for object', objectId, ':', err.message);
            resolve(null);
          });
        }).catch(function(err) {
          logger.warn('Failed to get object', objectId, ':', err.message);
          resolve(null);
        });
      });
    },

    /**
     * Extract data from HyperCube structure
     * @param {Object} hyperCube - Qlik HyperCube object
     * @param {number} rowLimit - Maximum rows to extract (default: 50)
     * @returns {Array} Extracted data rows
     */
    extractHyperCubeData: function(hyperCube, rowLimit) {
      var data = [];
      var dataPages = hyperCube.qDataPages || [];

      if (dataPages.length === 0) {
        logger.debug('No data pages in hypercube');
        return data;
      }

      var matrix = dataPages[0].qMatrix || [];
      var dimCount = (hyperCube.qDimensionInfo || []).length;
      var measCount = (hyperCube.qMeasureInfo || []).length;

      return this.extractHyperCubeDataFromMatrix(matrix, dimCount, measCount, rowLimit);
    },

    /**
     * Extract data from a matrix (shared by extractHyperCubeData and table fetching)
     * @param {Array} matrix - qMatrix data
     * @param {number} dimCount - Number of dimensions
     * @param {number} measCount - Number of measures
     * @returns {Array} Extracted data rows
     */
    extractHyperCubeDataFromMatrix: function(matrix, dimCount, measCount, rowLimit) {
      var data = [];

      if (!matrix || matrix.length === 0) {
        return data;
      }

      // Use provided row limit or default to 50
      var limit = rowLimit || 50;
      var maxRows = Math.min(matrix.length, limit);
      logger.debug('Extracting', maxRows, 'rows from matrix (total:', matrix.length, ', limit:', limit, ')');

      for (var i = 0; i < maxRows; i++) {
        var row = matrix[i];
        var rowData = {
          dimensions: [],
          measures: []
        };

        for (var j = 0; j < dimCount; j++) {
          rowData.dimensions.push(row[j] ? row[j].qText : '');
        }

        for (var k = 0; k < measCount; k++) {
          var cell = row[dimCount + k];
          rowData.measures.push({
            text: cell ? cell.qText : '',
            num: cell ? cell.qNum : null
          });
        }

        data.push(rowData);
      }

      return data;
    },

    /**
     * Update object footnote with summary
     * @param {Object} app - Qlik app object
     * @param {string} objectId - Object ID
     * @param {string} footnote - New footnote text
     * @returns {Promise<boolean>}
     */
    updateObjectFootnote: async function(app, objectId, footnote) {
      return new Promise(function(resolve, reject) {
        logger.info('Updating footnote for object:', objectId);

        app.getObject(objectId).then(function(model) {
          logger.debug('Got model for object:', objectId);

          model.getProperties().then(function(props) {
            logger.debug('Current properties for', objectId, '- has footnote:', !!props.footnote);
            logger.debug('Object properties keys:', Object.keys(props).join(', '));

            // Update footnote property
            props.footnote = footnote;

            logger.debug('Setting new footnote (length:', footnote.length, ')');

            model.setProperties(props).then(function() {
              logger.info('Footnote updated successfully for object:', objectId);
              resolve(true);
            }).catch(function(err) {
              logger.error('Failed to setProperties for', objectId, ':', err.message);
              logger.debug('setProperties error details:', err);
              reject(err);
            });
          }).catch(function(err) {
            logger.error('Failed to getProperties for', objectId, ':', err.message);
            logger.debug('getProperties error details:', err);
            reject(err);
          });
        }).catch(function(err) {
          logger.error('Failed to getObject', objectId, ':', err.message);
          logger.debug('getObject error details:', err);
          reject(err);
        });
      });
    },

    /**
     * Check if user can edit objects (has edit permissions)
     * Returns false for published apps, public sheets, or view-only users
     * @param {Object} app - Qlik app object
     * @returns {Promise<boolean>}
     */
    canEditObjects: async function(app) {
      try {
        // Method 1: Check navigation mode (mobile-safe)
        var mode = null;
        try {
          if (qlik && qlik.navigation && typeof qlik.navigation.getMode === 'function') {
            mode = qlik.navigation.getMode();
            logger.debug('Current navigation mode:', mode);
          }
        } catch (navErr) {
          logger.debug('Could not get navigation mode (mobile?):', navErr.message);
        }

        // 'edit' mode means user can edit, 'analysis' means view-only
        if (mode === 'analysis') {
          logger.info('User is in analysis mode - cannot edit objects');
          return false;
        }

        // Method 2: Check if app is published (global property)
        return new Promise(function(resolve) {
          app.model.getAppLayout().then(function(appLayout) {
            var isPublished = appLayout.published || false;
            logger.debug('App published status:', isPublished);

            if (isPublished) {
              logger.info('App is published - cannot edit objects');
              resolve(false);
            } else {
              // Method 3: Try a test to see if we can modify
              // If we're in edit mode and app is not published, we can edit
              logger.info('User has edit permissions');
              resolve(true);
            }
          }).catch(function(err) {
            logger.warn('Could not check app layout:', err.message);
            // Default to false (safer) if we can't determine
            resolve(false);
          });
        });
      } catch (err) {
        logger.warn('Error checking edit permissions:', err.message);
        return false;
      }
    },

    /**
     * Get current selections context
     * Uses selectionState() for reliable, real-time selection data
     * @param {Object} app - Qlik app object
     * @returns {Promise<Array>} Current selections
     */
    getCurrentSelections: async function(app) {
      return new Promise(function(resolve) {
        logger.debug('Getting current selections...');

        try {
          // Method 1: Use selectionState() - most reliable for real-time data
          var selState = app.selectionState();
          if (selState && selState.selections && selState.selections.length > 0) {
            var selections = selState.selections.map(function(sel) {
              // selectionState format: { fieldName, qField, selectedValues, ... }
              var selectedItems = [];
              if (sel.selectedValues && Array.isArray(sel.selectedValues)) {
                selectedItems = sel.selectedValues.map(function(v) {
                  return v.qName || v;
                });
              } else if (sel.qSelected) {
                selectedItems = [sel.qSelected];
              }
              return {
                field: sel.fieldName || sel.qField || sel.field,
                selected: selectedItems,
                count: sel.selectedCount || sel.qSelectedCount || selectedItems.length
              };
            });
            logger.info('Current selections (selectionState):', selections.length, 'fields');
            logger.debug('Selection details:', selections);
            resolve(selections);
            return;
          }

          // Method 2: Fallback to getList for older Qlik versions
          app.getList('SelectionObject', function(reply) {
            var qSelections = reply.qSelectionObject ? reply.qSelectionObject.qSelections : [];
            var selections = qSelections.map(function(sel) {
              var selectedItems = sel.qSelectedFieldSelectionInfo ? sel.qSelectedFieldSelectionInfo.map(function(s) {
                return s.qName;
              }) : [];
              return {
                field: sel.qField,
                selected: selectedItems,
                count: sel.qSelectedCount
              };
            });

            logger.info('Current selections (getList):', selections.length, 'fields');
            logger.debug('Selection details:', selections);
            resolve(selections);
          });
        } catch (e) {
          logger.debug('Selection error:', e.message);
          resolve([]);
        }
      });
    }
  };
});
