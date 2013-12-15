// Copyright 2013 The Closure Library Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS-IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Runs tests using phantomjs. This script should only be run in a
 * phantomjs env, and only on html files that require goog.testing.jsunit.  See
 * test.js for the API.
 *
 * Anything called in a page.evaluate() call runs in the PhantomJS sandbox,
 * and so doesn't obey the normal rules of lexical closure.
 *
 * @author nicholas.j.santos@gmail.com (Nick Santos)
 * @nocompile
 */

var webpage = require('webpage');
var Q = require('q');
var system = require('system');
var fs = require('fs');


/** @const {number} */
var PAGE_LOAD_TIMEOUT_MS = 5000;

/** @const {number} */
var TEST_RUN_TIMEOUT_MS = 10000;

/** @const {number} */
var TEST_TRY_TIMEOUT_MS = 200;

/**
 * @param {string} url
 * @constructor
 */
function TestPage(page) {
  /** @private {string} */
  this.url_ = page;

  /** @private {Webpage} */
  this.page_ = null;

  /** @private {boolean} */
  this.success_ = false;
}


/**
 * @return {boolean} If this completed successfully.
 */
TestPage.prototype.isSuccess = function() {
  return this.success_;
};


/**
 * Close the test page and free up its memory.
 */
TestPage.prototype.close = function() {
  if (this.page_) {
    this.page_.close();
    this.page_ = null;
  }
};


/**
 * Opens the page and runs the tests.
 * @return {Q.<void>} A promise that resolves when the test finishes,
 *     regardless of whether it was a success or failure.
 */
TestPage.prototype.run = function() {
  this.page_ = webpage.create();

  var self = this;

  // Create 2 separate promises: one to resolve when the page loads,
  // and one to resolve when the test finishes running.
  var runDefer = Q.defer();
  var openDefer = Q.defer();
  this.page_.open(this.url_, function() {
    openDefer.resolve();
  });

  this.page_.onError = function(e) {
    runDefer.reject(e);
    openDefer.reject(e);
  };

  // We only care about resource errors if they happen during page load.  Many
  // of our tests trigger spurious resource errors (e.g., missing images)
  // mid-test.
  this.page_.onResourceError = function(e) {
    openDefer.reject(e);
  };

  return openDefer.promise.timeout(PAGE_LOAD_TIMEOUT_MS).then(function() {
    self.resolveTestResult_(runDefer, self.page_);
    return runDefer.promise.timeout(TEST_RUN_TIMEOUT_MS);
  }).then(function() {
    self.success_ = true;
  }).fail(function(e) {
    console.error('Error', self.url_, e.stack || e.errorString || e);
    self.success_ = false;
  });
};

/**
 * @return {string} Get the test report, if available.
 */
TestPage.prototype.getTestReport = function() {
  if (!this.page_) {
    return '';
  }
  return this.page_.evaluate(function() {
    return window.G_testRunner && window.G_testRunner.getReport &&
        window.G_testRunner.getReport()
  })
};

/**
 * A helper that polls the page until the test finishes. Called recursively.
 * @param {Q.defer} defer A deferred to resolve when the page
 *     is finished.
 * @param {number=} retriesLeft
 * @private
 */
TestPage.prototype.resolveTestResult_ = function(defer, opt_retriesLeft) {
  if (!this.page_) {
    return; // The TestPage was closed.
  }

  var retriesLeft = opt_retriesLeft;
  if (typeof retriesLeft != 'number') {
    retriesLeft = Math.round(TEST_RUN_TIMEOUT_MS / TEST_TRY_TIMEOUT_MS);
  }

  var isFinished = this.page_.evaluate(function() {
    return window.G_testRunner && window.G_testRunner.isFinished &&
        window.G_testRunner.isFinished();
  });
  if (isFinished) {
    var isSuccess = this.page_.evaluate(function() {
      return window.G_testRunner && window.G_testRunner.isSuccess &&
          window.G_testRunner.isSuccess();
    });
    if (isSuccess) {
      defer.resolve();
    } else {
      defer.reject(new Error('Failure'));
    }
  } else if (retriesLeft <= 0) {
    defer.reject(new Error('Timeout'));
  } else {
    var self = this
    setTimeout(function() {
      self.resolveTestResult_(defer, retriesLeft - 1);
    }, TEST_TRY_TIMEOUT_MS);
  }
}

/**
 * @param {string} url
 * @return {Q.<boolean>} A promise when the test completes.
 */
function runOneTest(url) {
  var testPage = new TestPage(url);
  return testPage.run().then(function() {
    return testPage.getTestReport();
  }).then(function(report) {
    if (report) {
      console.log(report);
    }
    testPage.close();
    return testPage.isSuccess();
  })
}

/**
 * Grab the test files from the command-line and run them.
 */
function run() {
  var testList = getTestFiles();
  if (!testList.length) {
    console.error('No tests to run');
    phantom.exit(1);
  }

  var failures = [];

  // TODO(nicksantos): Currently, this runs the tests in serial.
  // We might be able to run them a lot faster by parallelizing.
  function advance() {
    var testFile = testList.shift();
    var testUrl = (testFile.indexOf('/') == 0) ?
        ('file://' + testFile) : // unix
        ('file:///' + testFile.replace(/\\/g, '/')) // windows
    return runOneTest(testUrl).then(function(success) {
      if (!success) failures.push(testFile);

      if (testList.length) {
        return advance();
      } else if (failures.length) {
        console.error('Failed tests:\n' + failures.join('\n'));
        phantom.exit(1);
      } else {
        console.error('All passed');
        phantom.exit(0);
      }
    });
  }

  advance().done();
}

/**
 * Grab a list of files to test, asynchronously.
 * @return {Q.<Array.<string>>}
 */
function getTestFiles() {
  var tests = [];
  var filePatterns = system.args.slice(0);
  while (filePatterns.length) {
    var pattern = filePatterns.shift();
    if (fs.isDirectory(pattern)) {
      var inDir = fs.list(pattern).filter(function(f) {
        return f.indexOf('.') != 0;
      }).map(function(f) {
        return pattern + fs.separator + f;
      });

      // Unshift each file in the directory to the front of the
      // array, so that they are in the right order.
      while (inDir.length) {
        filePatterns.unshift(inDir.pop());
      }
    // Poor man's endsWith
    } else if (pattern.lastIndexOf('_test.html') ===
               Math.max(pattern.length - 10, 0)) {
      tests.push(pattern);
    }
  }
  return tests;
}

run();
