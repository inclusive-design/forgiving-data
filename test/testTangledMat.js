"use strict";

/* eslint-env node */

var fluid = require("infusion");

require("../src/tangledMat.js");

var jqUnit = fluid.require("node-jqunit");

jqUnit.module("Tangled Mat");

jqUnit.test("Test Basic Mat", function () {
    jqUnit.expect(5);
    var mat = fluid.tangledMat([], true);
    var baseLayer =   [{a: 1}];
    var extendLayer = [{b: 2}];
    mat.addLayer(baseLayer, "base");
    mat.addLayer(extendLayer, "extend");
    var root = mat.getRoot();
    var first = root[0];
    jqUnit.assertEquals("Contains base property", 1, first.a);
    jqUnit.assertEquals("Contains extended property", 2, first.b);
    var provenanceMap = mat.getProvenanceMap();
    var expected = [ {
        a: "base",
        b: "extend"
    }];
    jqUnit.assertDeepEq("Expected provenance map", expected, provenanceMap);
    jqUnit.assertDeepEq("Base layer uncorrupted",   [{a: 1}], baseLayer);
    jqUnit.assertDeepEq("Extend layer uncorrupted", [{b: 2}], extendLayer);    
});
