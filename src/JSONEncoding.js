/* eslint-env node */

"use strict";

var fluid = require("infusion");
var kettle = require("kettle");
var fs = require("fs");

fluid.registerNamespace("fluid.data");

// Taken from %bagatelle/src/dataProcessing/readJSON.js

fluid.data.readJSONSync = function (fileName, message) {
    var promise = kettle.JSON.readFileSync(fileName, message + " " + fileName);
    var togo;
    promise.then(function (parsed) {
        togo = parsed;
    }, function (err) {
        throw err;
    });
    return togo;
};

fluid.data.encodeJSON = function (value) {
    return JSON.stringify(value, null, 4) + "\n";
};

// Taken from %bagatelle/src/dataProcessing/writeJSON.js

fluid.data.writeJSONSync = function (filename, doc) {
    var formatted = fluid.data.encodeJSON(doc);
    fs.writeFileSync(filename, formatted);
    console.log("Written " + formatted.length + " bytes to " + filename);
};
