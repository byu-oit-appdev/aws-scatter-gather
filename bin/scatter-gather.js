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
const defer             = require('./defer');
const EventRecord       = require('./event-record');
const EventInterface    = require('./event-interface');
const Log               = require('./log');
const Subscriptions     = require('./subscription');
const schemas           = require('./schemas');
const uuid              = require('uuid').v4;

const Req = Log('SCATHER_REQUEST');
const Res = Log('SCATHER_RESPONSE');

/**
 * Create an aggregator function that can be called to make scatter-gather requests.
 * @param {object} configuration
 * @returns {aggregator}
 */
exports.aggregator = function(configuration) {
    const config = schemas.request.normalize(configuration || {});
    const responseArn = config.responseArn || config.topicArn;
    const gatherers = [];

    // subscribe the aggregator to the topic arn
    Subscriptions.subscribe(responseArn, config.functionName, runGatherers);

    // define the aggregator function
    function aggregator(data, callback) {
        if (!aggregator.subscribed) {
            return Promise.reject(Error('Request aggregator has been unsubscribed. It will no longer gather requests.'));
        }

        const attributes = {
            ScatherDirection: 'request',
            ScatherFunctionName: config.functionName,
            ScatherResponseArn: responseArn,
            ScatherRequestId: uuid()
        };
        const deferred = defer();
        const event = EventRecord.createPublishEvent(config.topicArn, data, attributes);
        const missing = config.expects.slice(0);
        const result = {};
        var minTimeoutReached = false;

        // if minimum delay is reached and nothing is missing then resolve
        setTimeout(function() {
            minTimeoutReached = true;
            if (missing.length === 0 && deferred.promise.isPending()) deferred.resolve(result);
        }, config.minWait);

        // if maximum delay is reached then resolve
        setTimeout(function() {
            if (deferred.promise.isPending()) deferred.resolve(result);
        }, config.maxWait);

        // publish the request event
        EventInterface.fire(EventInterface.PUBLISH, event);
        Req.info('Sent request ' + attributes.ScatherRequestId + ' to topic ' + config.topicArn + ' with data: ' + data);

        // store active data
        const active = {
            gatherer: gatherer,
            promise: deferred.promise
        };
        gatherers.push(active);

        // remove active data once promise is not pending
        deferred.promise.finally(function() {
            const index = gatherers.indexOf(active);
            gatherers.slice(index, 1);
        });

        // define the gatherer
        function gatherer(event) {

            // if already resolved or not subscribed then exit now
            if (!deferred.promise.isPending()) return;

            // pull records out of the event that a responses to the request event
            const records = EventRecord.extractScatherRecords(event, function(data, record) {
                return data.attributes.ScatherDirection === 'response' &&
                    data.attributes.ScatherRequestId === attributes.ScatherRequestId;
            });

            // process each record and store
            records.forEach(function(record) {
                const senderName = record.attributes.ScatherFunctionName;

                // delete reference from the wait map
                const index = missing.indexOf(senderName);
                if (index !== -1) missing.splice(index, 1);

                // store the result
                result[senderName] = record.message;

                Req.info('Received response to request ' + attributes.ScatherRequestId + ' from ' + senderName);
            });

            // all expected responses received and min timeout passed, so resolve the deferred promise
            if (missing.length === 0 && minTimeoutReached) {
                deferred.resolve(result);
            }
        }

        // use appropriate async paradigm
        return defer.paradigm(deferred.promise, callback);
    }

    // run all gatherers that are active
    function runGatherers(event) {
        gatherers.forEach(function(item) { item.gatherer(event) });
    }
    
    // unsubscribe the aggregator
    function unsubscribe() {
        const promises = [];
        gatherers.forEach(function(item) { promises.push(item.promise.catch(fnUndefined)) });
        return Promise.all(promises)
            .then(function() {
                aggregator.subscribed = false;
                return Subscriptions.unsubscribe(responseArn, runGatherers);
            });
    }

    // add some properties to the aggregator function
    aggregator.subscribed = true;
    aggregator.unsubscribe = unsubscribe;

    return aggregator;
};

/**
 * Wrap a lambda function so that it only works on event records that represent scather requests.
 * @param {function} handler A function with signature: function (data, metadata [, callback ]). If the callback is omitted then the returned value will be used.
 * @returns {Function}
 */
exports.response = function(handler) {
    // validate input parameters
    if (typeof handler !== 'function') throw Error('Scather.response must be called with a function as its first parameter.');

    const handlerTakesCallback = callbackArguments(handler).length >= 3;
    return function(event, context, callback) {
        const promises = [];

        // validate the context
        if (!context || typeof context !== 'object') throw Error('Invalid context. Expected an object.');
        if (!context.functionName || typeof context.functionName !== 'string') throw Error('Invalid context functionName. Value must be a non-empty string.');

        const records = EventRecord.extractScatherRecords(event, function(r) {
            return r.attributes.ScatherDirection === 'request';
        });
        records.forEach(function(record) {
            const deferred = defer();
            promises.push(deferred.promise);

            Res.info('Responding to event data: ' + record.message);

            // add attributes to context
            const innerContext = Object.assign({}, context);
            innerContext.scather = record.attributes;

            // callback paradigm
            if (handlerTakesCallback) {
                try {
                    handler(record.message, innerContext, function (err, data) {
                        if (err) return deferred.reject(err);
                        deferred.resolve(data);
                    });
                } catch (err) {
                    deferred.reject(err);
                }

            // promise paradigm
            } else {
                try {
                    const result = handler(record.message, innerContext);
                    deferred.resolve(result);
                } catch (err) {
                    deferred.reject(err);
                }
            }

            // publish an event with the response
            deferred.promise
                .then(function(message) {
                    const event = EventRecord.createPublishEvent(record.attributes.ScatherResponseArn, message, {
                        ScatherDirection: 'response',
                        ScatherFunctionName: context.functionName,
                        ScatherResponseArn: innerContext.scather.ScatherResponseArn,
                        ScatherRequestId: innerContext.scather.ScatherRequestId
                    });
                    EventInterface.fire(EventInterface.PUBLISH, event);
                    Res.info('Sent response for ' + innerContext.scather.ScatherRequestId +
                        ' to topic ' + innerContext.scather.ScatherResponseArn + ' with data: ' + message);
                });

        });

        // get a promise that all records have been processed
        const promise = Promise.all(promises);
        promise.then(function() {
            Res.info('Responded to ' + records.length + ' records');
        });

        // respond to callback or promise paradigm
        if (handlerTakesCallback) {
            promise.then(function(data) { callback(null, data); }, function(err) { callback(err, null); });
        } else {
            return promise;
        }
    };
};

function callbackArguments(callback) {
    if (typeof callback !== 'function') throw Error('Expected a function.');

    const rx = /^(?:function\s?)?([\s\S]+?)\s?(?:=>\s?)?\{/;
    const match = rx.exec(callback.toString());

    var args = match[1];
    if (/^\([\s\S]*?\)$/.test(args)) args = args.substring(1, args.length - 1);
    args = args.split(/,\s?/);

    return args && args.length === 1 && !args[0] ? [] : args;
}








function fnTrue() {
    return true;
}

function fnUndefined() {
    return undefined;
}