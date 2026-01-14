define(['qlik'], function(qlik) {
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
        return 'cloud';
      }
      return 'onprem';
    },

    /**
     * Get all visualization objects on the current sheet
     * @param {Object} app - Qlik app object
     * @returns {Promise<Array>} Array of sheet objects with metadata
     */
    getSheetObjects: async function(app) {
      const self = this;

      return new Promise(function(resolve, reject) {
        // Get current sheet ID
        qlik.navigation.getCurrentSheetId().then(function(sheetInfo) {
          const sheetId = sheetInfo.sheetId;

          // Get sheet object
          app.getObject(sheetId).then(function(sheetModel) {
            // Get sheet layout to find all objects
            sheetModel.getLayout().then(function(layout) {
              const objects = [];
              const cells = layout.cells || [];

              // Process each cell (object) on the sheet
              const promises = cells.map(function(cell) {
                return self.getObjectDetails(app, cell.name);
              });

              Promise.all(promises).then(function(objectDetails) {
                resolve(objectDetails.filter(function(obj) {
                  return obj !== null;
                }));
              }).catch(reject);

            }).catch(reject);
          }).catch(reject);
        }).catch(reject);
      });
    },

    /**
     * Get details for a specific object including its data
     * @param {Object} app - Qlik app object
     * @param {string} objectId - Object ID
     * @returns {Promise<Object>} Object details with data
     */
    getObjectDetails: async function(app, objectId) {
      const self = this;

      return new Promise(function(resolve) {
        app.getObject(objectId).then(function(model) {
          model.getLayout().then(function(layout) {
            const objectInfo = {
              id: objectId,
              type: layout.visualization || layout.qInfo?.qType || 'unknown',
              title: layout.title || layout.qMeta?.title || 'Untitled',
              subtitle: layout.subtitle || '',
              footnote: layout.footnote || '',
              dimensions: [],
              measures: [],
              data: null
            };

            // Extract dimension info
            if (layout.qHyperCube) {
              objectInfo.dimensions = (layout.qHyperCube.qDimensionInfo || []).map(function(dim) {
                return {
                  label: dim.qFallbackTitle || dim.qGroupFieldDefs?.[0] || 'Dimension',
                  cardinality: dim.qCardinal || 0
                };
              });

              objectInfo.measures = (layout.qHyperCube.qMeasureInfo || []).map(function(meas) {
                return {
                  label: meas.qFallbackTitle || 'Measure',
                  min: meas.qMin,
                  max: meas.qMax
                };
              });

              // Get actual data from hypercube
              objectInfo.data = self.extractHyperCubeData(layout.qHyperCube);
            }

            // Handle KPI objects
            if (layout.qHyperCube && objectInfo.type === 'kpi') {
              const kpiData = layout.qHyperCube.qDataPages?.[0]?.qMatrix?.[0];
              if (kpiData && kpiData[0]) {
                objectInfo.kpiValue = kpiData[0].qText || kpiData[0].qNum;
              }
            }

            resolve(objectInfo);
          }).catch(function() {
            resolve(null);
          });
        }).catch(function() {
          resolve(null);
        });
      });
    },

    /**
     * Extract data from HyperCube structure
     * @param {Object} hyperCube - Qlik HyperCube object
     * @returns {Array} Extracted data rows
     */
    extractHyperCubeData: function(hyperCube) {
      const data = [];
      const dataPages = hyperCube.qDataPages || [];

      if (dataPages.length === 0) {
        return data;
      }

      const matrix = dataPages[0].qMatrix || [];
      const dimCount = (hyperCube.qDimensionInfo || []).length;
      const measCount = (hyperCube.qMeasureInfo || []).length;

      // Limit to first 50 rows for summary purposes
      const maxRows = Math.min(matrix.length, 50);

      for (let i = 0; i < maxRows; i++) {
        const row = matrix[i];
        const rowData = {
          dimensions: [],
          measures: []
        };

        for (let j = 0; j < dimCount; j++) {
          rowData.dimensions.push(row[j]?.qText || '');
        }

        for (let k = 0; k < measCount; k++) {
          const cell = row[dimCount + k];
          rowData.measures.push({
            text: cell?.qText || '',
            num: cell?.qNum
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
        app.getObject(objectId).then(function(model) {
          model.getProperties().then(function(props) {
            // Update footnote property
            props.footnote = footnote;

            model.setProperties(props).then(function() {
              resolve(true);
            }).catch(reject);
          }).catch(reject);
        }).catch(reject);
      });
    },

    /**
     * Get current selections context
     * @param {Object} app - Qlik app object
     * @returns {Promise<Array>} Current selections
     */
    getCurrentSelections: async function(app) {
      return new Promise(function(resolve) {
        app.getList('SelectionObject', function(reply) {
          const selections = (reply.qSelectionObject?.qSelections || []).map(function(sel) {
            return {
              field: sel.qField,
              selected: sel.qSelectedFieldSelectionInfo?.map(function(s) {
                return s.qName;
              }) || [],
              count: sel.qSelectedCount
            };
          });
          resolve(selections);
        });
      });
    }
  };
});
