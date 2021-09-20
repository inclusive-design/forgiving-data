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

/**
 * An in-memory CSV value with separate entries for headers and data. Whilst the header information could be
 * recovered from the keys of a row, we store these separately to ensure that we can properly represent case of a 0-row
 * CSV file.
 * @typedef {Object} CSVValue
 * @param {String[]} headers - Array of header names
 * @param {Object<String, String>[]} data - Array of rows
 * @param {Object} [meta] - Optional information about the CSV structure recovered from the parse process - currently
 * implementation-specific fields stored by "papaparse"
 */

/** Encode a CSV value into a String
 * @param {CSVValue} value - The CSV value to be encoded
 * @return {String} The encoded value suitable to be written to a file
 */
fluid.data.encodeCSV = function (value) {
    return Papa.unparse({
        data: value.data,
        fields: value.headers
    }, {
        newline: "\n"
    }) + "\n";
};

fluid.data.parseCSV = function (text) {
    return fluid.resourceLoader.parsers.csv(text, {resourceSpec: {}});
};

/** Synchronously write a CSV value to a file with the UTF-8 encoding
 * @param {String} filename - The file to which the CSV value is to be written
 * @param {CSVValue} value - The value to be written
 */
fluid.data.writeCSV = function (filename, value) {
    var encoded = fluid.data.encodeCSV(value);

    fs.writeFileSync(filename, encoded, "utf-8");
    console.log("Written " + encoded.length + " bytes (" + value.headers.length + " columns, " + value.data.length + " rows) to " + filename);
};
