"use strict";

/* eslint-env node */

var fluid = require("infusion");

require("../index.js");

var jqUnit = fluid.require("node-jqunit");
require("./testUtils/testUtils.js");

jqUnit.module("Pipeline Tests");

fluid.registerNamespace("fluid.tests.dataPipeline");

fluid.tests.dataPipeline.truncateDate = function (options) {
    var rows = options.input.value.data;
    var truncatedData = fluid.transform(rows, function (row) {
        var date = new Date(row.observationDate);
        return {
            observationDate: date.toISOString().substring(0, 10)
        };
    });
    console.log("Outputting data ", truncatedData);
    return {
        value: {
            headers: options.input.value.headers,
            data: truncatedData
        }
    };
};

fluid.defaults("fluid.tests.dataPipeline.truncateDate", {
    gradeNames: "fluid.overlayProvenancePipe"
});

fluid.defaults("fluid.tests.dataPipeline.testOutput", {
    gradeNames: "fluid.dataPipe"
});

fluid.tests.dataPipeline.testOutput = async function (options) {
    var input = options.input;

    var expectedJoin = await fluid.tests.fetchCSVFile("%forgiving-data/tests/data/expectedTruncatedJoin.csv");
    var expectedProvenance = await fluid.tests.fetchCSVFile("%forgiving-data/tests/data/expectedTruncatedProvenance.csv");

    // console.log("Got output ", JSON.stringify(rows, null, 2));
    jqUnit.assertDeepEq("Expected pipeline output", expectedJoin.data, input.value.data);
    jqUnit.assertDeepEq("Expected output provenance", expectedProvenance.data, input.provenance);
};

jqUnit.test("Test merging pipeline", function () {
    jqUnit.expect(2);
    fluid.data.loadAllPipelines("%forgiving-data/tests/pipelines");

    var pipeline = fluid.data.loadPipeline(["fluid.tests.pipelines.truncateDate", "fluid.tests.pipelines.testOutput"]);
    return pipeline.completionPromise;
});
