/* eslint-env node */

"use strict";

var fluid = require("infusion");
var Papa = require("papaparse");
var fs = require("fs");

fluid.registerNamespace("fluid.data");

// Taken from %covid-data-monitor/src/js/CSVResource.js

fluid.resourceLoader.parsers.csv = function (resourceText, options) {
    var defaultOptions = {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true
    };
    var parseOptions = fluid.extend({}, defaultOptions, options.resourceSpec.csvOptions);

    var parsed = Papa.parse(resourceText, parseOptions);
    var togo = fluid.promise();
    if (parsed.errors.length > 0) {
        togo.reject(parsed.errors);
    } else {
        togo.resolve({
            meta: parsed.meta,
            headers: parsed.meta.fields,
            data: parsed.data
        });
    }
    return togo;
};

fluid.data.writeCSV = function (filename, data) {
    var outputString = Papa.unparse(data, {
        newline: "\n"
    }) + "\n";
    fs.writeFileSync(filename, outputString, "utf-8");
    console.log("Written " + outputString.length + " bytes (" + data.length + " columns, " + Object.keys(data[0]).length + " rows) to " + filename);
};
