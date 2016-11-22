/**
 *  @license
 *    Copyright 2016 Brigham Young University
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 **/
'use strict';
const chalk                 = require('chalk');

var longestName = 0;

module.exports = debug;

function debug(name, color) {
    var prefix;
    var labelLength = -1;
    if (!color) color = 'reset';

    if (name.length > longestName) longestName = name.length;
    return function(message, event) {
        if (labelLength !== longestName) {
            const pid = process.send ? chalk.dim('' + process.pid) : '' + process.pid;
            const length = pid.length + (process.pid > .9 * Math.pow(10, pid.length) ? 3 : 2);// + (process.send ? 4 : 0);
            labelLength = longestName;
            prefix = '  ' + chalk[color].bold(name) + fixedLength('', labelLength - name.length) +
                '  ' + fixedLength(pid, length);
        }

        if (debug[name] || debug['*']) {
            const o = Object.assign({}, event || {}, { pid: process.pid });
            const details = debug.verbose ? ('\n' + JSON.stringify(o, null, 2)).replace(/\n/g, '\n    ') : '';
            console.log(prefix + message + details);
        }
    }
}

// read command arguments to determine what debug output to turn on
process.argv.slice(2)
    .forEach(function(arg) {
        if (arg.indexOf('debug=') === 0) {
            arg.substr(6)
                .split(',')
                .forEach(function(name) {
                    debug[name] = true;
                });
        }
    });




/*const debug                 = require('debug');

const verbose = process.argv.slice(2).filter(function(v) { return v === '-v'; }).length > 0;

module.exports = function(name) {
    const fn = debug(name);
    const pid = '' + process.pid;
    const length = pid.length + (process.pid > .9 * Math.pow(10, pid.length) ? 3 : 2);
    const prefix = fixedLength('', 12 - name.length) + fixedLength(pid, length);
    return function(message, event) {
        var details = '';
        if (verbose && event) details = ('\n' + JSON.stringify(event, null, 2)).replace(/\n/g, '\n    ');
        fn(prefix + message + details);
    }
};*/

function fixedLength(str, length) {
    str = str.substr(0, length);
    while (str.length < length) str += ' ';
    return str;
}