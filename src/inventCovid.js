/* eslint-env node */

"use strict";

var fluid = require("infusion");

require("./tinyRNG.js");

fluid.registerNamespace("fluid.covidMap");

fluid.covidMap.a11yColumns = [
    "Accessible Entrances",
    "Accessible Washrooms",
    "Accessible Parking",
    "Individual Service",
    "Wait Accommodations"
];

fluid.covidMap.inventAccessibilityRow = function (random) {
    var entries = fluid.covidMap.a11yColumns.map(function (value) {
        var rand = random.nextRange(0, 2);
        return [value, ["No", "Yes"][rand]];
    });
    return Object.fromEntries(entries);
};



fluid.defaults("fluid.covidMap.inventAccessibilityData", {
    gradeNames: "fluid.selfProvenancePipe"
});

fluid.covidMap.inventAccessibilityData = function (options) {
    var value = options.input.value;
    var random = new fluid.tinyRNG(options.seed);
    var additionalValues = fluid.transform(value, function (row) {
        var existing = fluid.filterKeys(row, fluid.covidMap.a11yColumns);
        var anySet = Object.values(existing).some(function (element) {
            return element !== "" && fluid.isValue(element);
        });
        return anySet ? {} : fluid.covidMap.inventAccessibilityRow(random);
    });
    return {
        value: additionalValues
        // provenance, provenanceMap filled in by pipeline
    };
};
