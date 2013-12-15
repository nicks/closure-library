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
 * @fileoverview Boots up a phantomjs runner and runs all the _test.html
 * files in the given directories.
 *
 * Usage:
 * node closure/bin/test/test.js base_test.html string
 *
 * Runs base_test.html and all the _test.html files in string/
 *
 * If no target is specified, we will automatically find all the _test.html
 * files in the current working directory, recursively.
 *
 * TODO(nicksantos): This is currently experimental. Most of the
 * tests pass, but not all of them.
 *
 * @author nicholas.j.santos@gmail.com (Nick Santos)
 * @nocompile
 */

var childProcess = require('child_process');
var glob = require('glob');
var path = require('path');
var phantomjs = require('phantomjs');
var Q = require('q');

var binPath = phantomjs.path;

// Make all the paths absolute relative to the current working dir.
var fileArgs = process.argv.slice(2).map(function (arg) {
  return path.join(process.cwd(), arg);
});
if (!fileArgs.length) {
  // Default to all _test.html files in the current dir.
  fileArgs = [process.cwd()];
}

var childArgs = [
  path.join(__dirname, 'phantomjs-driver.js')
].concat(fileArgs);

var child = childProcess.execFile(binPath, childArgs, function(err) {
  if (err) console.error(err);
  process.exit(err ? 1 : 0);
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
