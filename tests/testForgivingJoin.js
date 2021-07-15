"use strict";

/* eslint-env node */

var fluid = require("infusion");

require("../src/forgivingJoin.js");
require("../src/CSVResource.js");
require("../src/dataPipeline.js"); // for fluid.data.flatProvenance

var jqUnit = fluid.require("node-jqunit");
require("./testUtils/testUtils.js");

jqUnit.module("Forgiving Join");

fluid.registerNamespace("fluid.tests");

fluid.registerNamespace("fluid.tests.forgivingJoin.expected");

fluid.tests.forgivingJoin.expected.basic = {
    joinKeys: {
        "left": "Species",
        "right": "scientificName"
    },
    headers: [
        "observationID",
        "taxonID",
        "observationDate",
        "taxonName",
        "vernacularName"
    ],
    provenanceMap: {
        "left": {
            "path": "%forgiving-data/tests/data/joinLeft.csv"
        },
        "right": {
            "path": "%forgiving-data/tests/data/joinRight.csv"
        }
    }
};

jqUnit.test("Test basic join", async function () {
    var left = await fluid.tests.fetchCSVValue("%forgiving-data/tests/data/joinLeft.csv", "left");
    var right = await fluid.tests.fetchCSVValue("%forgiving-data/tests/data/joinRight.csv", "right");
    var joined = fluid.forgivingJoin({
        left: left,
        right: right,
        outputColumns: {
            observationID: "left.ID",
            taxonID: "right.taxonID",
            observationDate: "left.Date",
            taxonName: "right.scientificName",
            vernacularName: "right.vernacularName"
        }
    });
    console.log("Got data ", JSON.stringify(joined, null, 2));

    var expectedJoin = await fluid.tests.fetchCSVFile("%forgiving-data/tests/data/expectedJoin.csv");
    var expectedProvenance = await fluid.tests.fetchCSVFile("%forgiving-data/tests/data/expectedProvenance.csv");

    var expected = fluid.tests.forgivingJoin.expected.basic;
    jqUnit.assertDeepEq("Join keys as expected", expected.joinKeys, joined.joinKeys);
    jqUnit.assertDeepEq("Headers as expected", expected.headers, joined.value.headers);
    jqUnit.assertDeepEq("Provenance map as expected", expected.provenanceMap, joined.provenanceMap);

    jqUnit.assertDeepEq("Joined value as expected", expectedJoin.data, joined.value.data);
    jqUnit.assertDeepEq("Joined provenance as expected", expectedProvenance.data, joined.provenance);
});
