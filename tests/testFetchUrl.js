"use strict";

/* eslint-env node */

var fluid = require("infusion");

require("../index.js");

var jqUnit = fluid.require("node-jqunit");
require("./testUtils/testUtils.js");

jqUnit.module("URL Fetch Tests");

fluid.registerNamespace("fluid.tests.dataPipeline");


fluid.tests.dataPipeline.testFetchOutput = async function (options) {
    var input = options.input;
    var joinLeft = await fluid.tests.fetchCSVFile("%forgiving-data/tests/data/joinLeft.csv");
    jqUnit.assertDeepEq("Expected data fetched", joinLeft.data, input.value.data);

    var expectedProvenance = {
        type: "fluid.fetchUrlCSV",
        url: "https://raw.githubusercontent.com/inclusive-design/forgiving-data/main/tests/data/joinLeft.csv"
    };

    jqUnit.assertLeftHand("Expected provenance structure", expectedProvenance, input.provenanceMap.ODC);
    var date = new Date(input.provenanceMap.ODC.fetchedAt);
    var difference = new Date().getTime() - date.getTime();
    jqUnit.assertTrue("Recent fetch date", difference < 1000 * 10);
};

jqUnit.test("Test fetch URL", function () {
    jqUnit.expect(3);
    fluid.dataPipeline.load("%forgiving-data/tests/pipelines/fetchUrl.json5");

    var pipeline = fluid.dataPipeline.build(["fluid.tests.pipelines.fetchUrl"]);
    return pipeline.completionPromise;
});
