"use strict";

/* eslint-env node */

var fluid = require("infusion");

require("../index.js");

var jqUnit = fluid.require("node-jqunit");
require("./testUtils/testUtils.js");

jqUnit.module("URL Fetch Tests");

fluid.registerNamespace("fluid.tests.dataPipeline");

// Indirect in order to check pipeline's ability to store provenance of data-sourced options
fluid.tests.dataPipeline.indirectUrl = function (options) {
    var togo = fluid.promise();
    togo.resolve(options);
    return togo;
};

// A filter which removes the third element of an array
fluid.tests.dataPipeline.removeThird = function (data) {
    return data.filter(function (row, index) {
        return index !== 2;
    });
};

// Act on data via some kind of isomorphic filter which does not change columns and acts on the provenance in the same way
fluid.tests.dataPipeline.isomorphicPipe = function (input, filter) {
    return {
        value: {
            data: filter(input.value.data),
            headers: input.value.headers
        },
        provenance: {
            data: filter(input.provenance.data),
            headers: input.provenance.headers
        },
        provenanceMap: input.provenanceMap
    };
};

// TODO: Produce a tangledMat that can proxy operations like array.filter!
fluid.tests.dataPipeline.removeThirdPipe = function (options) {
    return fluid.tests.dataPipeline.isomorphicPipe(options.input, fluid.tests.dataPipeline.removeThird);
};

fluid.defaults("fluid.tests.dataPipeline.removeThirdPipe", {
    gradeNames: "fluid.dataPipe"
});

fluid.tests.dataPipeline.testFetchOutput = async function (options) {
    var input = options.input;
    var joinLeft = await fluid.tests.fetchCSVFile("%forgiving-data/tests/data/joinLeft.csv");
    var filtered = fluid.tests.dataPipeline.removeThird(joinLeft.data);
    jqUnit.assertDeepEq("Expected data fetched", filtered, input.value.data);

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
