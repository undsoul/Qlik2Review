define(['./logger'], function(logger) {
  'use strict';

  /**
   * Retry Utility - Handles API call retries with exponential backoff
   */

  /**
   * Error types for classification
   */
  var ErrorTypes = {
    AUTH_ERROR: 'auth_error',
    RATE_LIMIT: 'rate_limit',
    NETWORK_ERROR: 'network_error',
    SERVER_ERROR: 'server_error',
    VALIDATION_ERROR: 'validation_error',
    TIMEOUT_ERROR: 'timeout_error',
    UNKNOWN_ERROR: 'unknown_error'
  };

  /**
   * Classify an error based on response status or error type
   * @param {Error} error - The error object
   * @param {Response} [response] - Optional fetch response
   * @returns {string} Error type from ErrorTypes
   */
  function classifyError(error, response) {
    // Check response status first
    if (response) {
      var status = response.status;
      if (status === 401 || status === 403) return ErrorTypes.AUTH_ERROR;
      if (status === 429) return ErrorTypes.RATE_LIMIT;
      if (status === 400) return ErrorTypes.VALIDATION_ERROR;
      if (status >= 500 && status < 600) return ErrorTypes.SERVER_ERROR;
    }

    // Check error message patterns
    var message = (error.message || '').toLowerCase();
    if (message.includes('timeout') || message.includes('timed out')) {
      return ErrorTypes.TIMEOUT_ERROR;
    }
    if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
      return ErrorTypes.NETWORK_ERROR;
    }
    if (message.includes('api key') || message.includes('unauthorized') || message.includes('authentication')) {
      return ErrorTypes.AUTH_ERROR;
    }
    if (message.includes('rate') || message.includes('limit') || message.includes('quota')) {
      return ErrorTypes.RATE_LIMIT;
    }

    return ErrorTypes.UNKNOWN_ERROR;
  }

  /**
   * Check if an error is retryable
   * @param {string} errorType - Error type from classifyError
   * @returns {boolean}
   */
  function isRetryable(errorType) {
    var retryableTypes = [
      ErrorTypes.RATE_LIMIT,
      ErrorTypes.NETWORK_ERROR,
      ErrorTypes.SERVER_ERROR,
      ErrorTypes.TIMEOUT_ERROR
    ];
    return retryableTypes.indexOf(errorType) !== -1;
  }

  /**
   * Sleep for a given duration
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise}
   */
  function sleep(ms) {
    return new Promise(function(resolve) {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Get retry delay with exponential backoff and jitter
   * @param {number} attempt - Current attempt number (0-based)
   * @param {number} baseDelay - Base delay in ms
   * @param {number} maxDelay - Maximum delay in ms
   * @returns {number} Delay in ms
   */
  function getRetryDelay(attempt, baseDelay, maxDelay) {
    // Exponential backoff: baseDelay * 2^attempt
    var exponentialDelay = baseDelay * Math.pow(2, attempt);
    // Add jitter (random 0-30% of delay)
    var jitter = exponentialDelay * Math.random() * 0.3;
    var totalDelay = exponentialDelay + jitter;
    // Cap at maxDelay
    return Math.min(totalDelay, maxDelay);
  }

  /**
   * Parse retry-after header
   * @param {Response} response - Fetch response
   * @returns {number|null} Retry delay in ms, or null if not present
   */
  function parseRetryAfter(response) {
    var retryAfter = response.headers.get('retry-after');
    if (!retryAfter) return null;

    // Check if it's a number (seconds) or a date
    var seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }

    // Try parsing as date
    var date = new Date(retryAfter);
    if (!isNaN(date.getTime())) {
      return Math.max(0, date.getTime() - Date.now());
    }

    return null;
  }

  /**
   * Execute a function with retry logic
   * @param {Function} fn - Async function to execute
   * @param {Object} [options] - Retry options
   * @param {number} [options.maxRetries=3] - Maximum retry attempts
   * @param {number} [options.baseDelay=1000] - Base delay in ms
   * @param {number} [options.maxDelay=30000] - Maximum delay in ms
   * @param {Function} [options.onRetry] - Callback on retry (attempt, error, delay)
   * @returns {Promise} Result of fn
   */
  async function withRetry(fn, options) {
    options = options || {};
    var maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
    var baseDelay = options.baseDelay || 1000;
    var maxDelay = options.maxDelay || 30000;
    var onRetry = options.onRetry || function() {};

    var lastError;
    var lastResponse;

    for (var attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        lastResponse = error.response;

        var errorType = classifyError(error, lastResponse);
        logger.debug('API call failed (attempt ' + (attempt + 1) + '/' + (maxRetries + 1) + '):', errorType, error.message);

        // Don't retry on final attempt or non-retryable errors
        if (attempt === maxRetries || !isRetryable(errorType)) {
          logger.error('API call failed permanently:', errorType, error.message);
          throw error;
        }

        // Calculate delay
        var delay;
        if (errorType === ErrorTypes.RATE_LIMIT && lastResponse) {
          // Use retry-after header if available
          delay = parseRetryAfter(lastResponse) || getRetryDelay(attempt, baseDelay * 2, maxDelay);
        } else {
          delay = getRetryDelay(attempt, baseDelay, maxDelay);
        }

        logger.info('Retrying in ' + Math.round(delay / 1000) + 's... (attempt ' + (attempt + 2) + '/' + (maxRetries + 1) + ')');
        onRetry(attempt, error, delay);

        await sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Create a wrapped fetch function with retry logic and timeout
   * @param {string} url - URL to fetch
   * @param {Object} fetchOptions - Fetch options
   * @param {Object} [retryOptions] - Retry options
   * @param {number} [retryOptions.timeout=30000] - Request timeout in ms
   * @returns {Promise<Response>}
   */
  async function fetchWithRetry(url, fetchOptions, retryOptions) {
    retryOptions = retryOptions || {};
    var timeout = retryOptions.timeout !== undefined ? retryOptions.timeout : 30000;  // 30s default

    return withRetry(async function() {
      // Create AbortController for timeout
      var controller = new AbortController();
      var timeoutId = setTimeout(function() {
        controller.abort();
      }, timeout);

      try {
        // Merge abort signal with fetch options
        var optionsWithSignal = Object.assign({}, fetchOptions, {
          signal: controller.signal
        });

        var response = await fetch(url, optionsWithSignal);

        // Treat error responses as errors for retry logic
        if (!response.ok) {
          var error = new Error('HTTP ' + response.status + ': ' + response.statusText);
          error.response = response;
          error.status = response.status;

          // Try to get error details from response body
          try {
            var errorData = await response.clone().json();
            if (errorData.error && errorData.error.message) {
              error.message = errorData.error.message;
            }
          } catch (e) {
            // Ignore JSON parse errors
          }

          throw error;
        }

        return response;
      } catch (error) {
        // Convert AbortError to timeout error
        if (error.name === 'AbortError') {
          var timeoutError = new Error('Request timed out after ' + (timeout / 1000) + ' seconds');
          timeoutError.type = ErrorTypes.TIMEOUT_ERROR;
          throw timeoutError;
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }, retryOptions);
  }

  return {
    ErrorTypes: ErrorTypes,
    classifyError: classifyError,
    isRetryable: isRetryable,
    withRetry: withRetry,
    fetchWithRetry: fetchWithRetry,
    sleep: sleep,
    getRetryDelay: getRetryDelay,
    parseRetryAfter: parseRetryAfter
  };
});
