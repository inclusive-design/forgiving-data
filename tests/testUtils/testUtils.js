"use strict";

/* eslint-env node */

var fluid = require("infusion");
var fs = require("fs");

fluid.registerNamespace("fluid.tests");

fluid.tests.fetchCSVFile = function (path) {
    var text = fs.readFileSync(fluid.module.resolvePath(path), "utf8");
    return fluid.resourceLoader.parsers.csv(text, {resourceSpec: {}});
};

// cf. fluid.fetchGitCSV
fluid.tests.fetchCSVValue = async function (path, provenanceKey) {
    var parsed = await fluid.tests.fetchCSVFile(path);
    return {
        value: parsed,
        provenance: fluid.data.flatProvenance(parsed.data, provenanceKey),
        provenanceKey: provenanceKey,
        provenanceMap: {
            [provenanceKey]: {
                path: path
            }
        }
    };
};
