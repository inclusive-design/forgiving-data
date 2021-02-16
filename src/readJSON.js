/* eslint-env node */

"use strict";

var fluid = require("infusion");
var kettle = require("kettle");

// Taken from %bagatelle/src/dataProcessing/readJSON.js

fluid.readJSONSync = function (fileName, message) {
    var promise = kettle.JSON.readFileSync(fileName, message + " " + fileName);
    var togo;
    promise.then(function (parsed) {
        togo = parsed;
    }, function (err) {
        throw err;
    });
    return togo;
};
