define([], function() {
  'use strict';

  /**
   * Debug Logger Utility
   * Centralized logging with enable/disable support
   */

  var isEnabled = false;
  var PREFIX = '[Qlik2Review]';

  return {
    /**
     * Enable or disable logging
     * @param {boolean} enabled
     */
    setEnabled: function(enabled) {
      isEnabled = !!enabled;
      if (isEnabled) {
        this.info('Debug logging ENABLED');
      }
    },

    /**
     * Check if logging is enabled
     * @returns {boolean}
     */
    isEnabled: function() {
      return isEnabled;
    },

    /**
     * Log info message
     * @param {string} message
     * @param {...*} args
     */
    info: function(message) {
      if (!isEnabled) return;
      var args = Array.prototype.slice.call(arguments);
      args[0] = PREFIX + ' [INFO] ' + message;
      console.log.apply(console, args);
    },

    /**
     * Log debug message (more verbose)
     * @param {string} message
     * @param {...*} args
     */
    debug: function(message) {
      if (!isEnabled) return;
      var args = Array.prototype.slice.call(arguments);
      args[0] = PREFIX + ' [DEBUG] ' + message;
      console.log.apply(console, args);
    },

    /**
     * Log warning message
     * @param {string} message
     * @param {...*} args
     */
    warn: function(message) {
      if (!isEnabled) return;
      var args = Array.prototype.slice.call(arguments);
      args[0] = PREFIX + ' [WARN] ' + message;
      console.warn.apply(console, args);
    },

    /**
     * Log error message (always logs, regardless of enabled state)
     * @param {string} message
     * @param {...*} args
     */
    error: function(message) {
      var args = Array.prototype.slice.call(arguments);
      args[0] = PREFIX + ' [ERROR] ' + message;
      console.error.apply(console, args);
    },

    /**
     * Log object data in a formatted way
     * @param {string} label
     * @param {*} data
     */
    data: function(label, data) {
      if (!isEnabled) return;
      console.log(PREFIX + ' [DATA] ' + label + ':');
      console.log(data);
    },

    /**
     * Log timing information
     * @param {string} label
     * @returns {function} Call returned function to log elapsed time
     */
    time: function(label) {
      if (!isEnabled) {
        return function() {};
      }
      var start = performance.now();
      var self = this;
      return function() {
        var elapsed = (performance.now() - start).toFixed(2);
        self.info(label + ' completed in ' + elapsed + 'ms');
      };
    },

    /**
     * Log a group of related messages
     * @param {string} groupName
     * @param {function} fn - Function containing log calls
     */
    group: function(groupName, fn) {
      if (!isEnabled) {
        fn();
        return;
      }
      console.group(PREFIX + ' ' + groupName);
      fn();
      console.groupEnd();
    }
  };
});
