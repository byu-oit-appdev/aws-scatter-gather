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
const expect            = require('chai').expect;
const Scather           = require('../index');

const mock              = Scather.mock;
const response          = Scather.response;

describe('Scather.response', function() {
    
    it('is a function', function() {
        expect(response).to.be.a('function');
    });

    it('throw an error if the first parameter is not a function', function() {
        expect(function() { response(); }).to.throw(Error);
    });
    
    it('returns a function', function() {
        expect(response(noop)).to.be.a('function');
    });
    
    describe('returned function', function() {
        
        describe('callback paradigm', function() {
            
            it('returns nothing', function() {
                const fn = response(echo);
                const e = mock.snsEvent('callbackArn', 'Hello');
                const result = fn(e, { functionName: 'echo' }, noop);
                expect(result).to.equal(undefined);
            });

            it('gets response through callback', function() {
                const fn = response(echo);
                const e = mock.snsEvent('callbackArn', 'Hello');
                fn(e, { functionName: 'echo' }, function(err, data) {
                    expect(err).to.equal(null);
                    expect(data).to.equal('Hello');
                });
            });

            it('gets error through callback', function() {
                const fn = response(error);
                const e = mock.snsEvent('callbackArn', 'Hello');
                fn(e, { functionName: 'error' }, function(err, data) {
                    expect(err).to.be.instanceOf(Error);
                    expect(data).to.equal(null);
                });
            });

            it('error nullifies data', function() {
                const fn = response(conflict);
                const e = mock.snsEvent('callbackArn', 'Hello');
                fn(e, { functionName: 'conflict' }, function(err, data) {
                    expect(err).to.be.instanceOf(Error);
                    expect(data).to.equal(null);
                });
            });

            it('uncaught errors are caught', function() {
                const fn = response(uncaught);
                const e = mock.snsEvent('callbackArn', 'Hello');
                fn(e, { functionName: 'uncaught' }, function(err, data) {
                    expect(err).to.be.instanceOf(Error);
                    expect(data).to.equal(null);
                });
            });
            
        });
        
        describe('promise paradigm', function() {
            
        });
        
        
    });
    
});

function conflict(message, attributes, callback) {
    callback(Error('An error occurred'), message);
}

function echo(message, attributes, callback) {
    callback(null, message);
}

function error(message, attributes, callback) {
    callback(Error('An error occurred'), null);
}

function noop() {}

function uncaught(message, attributes, callback) {
    throw Error('Uncaught');
    callback(null, message);
}
