/* eslint-env node */

"use strict";

var fluid = require("infusion");

require("../src/tangledMat.js");

var jqUnit = fluid.require("node-jqunit");

jqUnit.module("Tangled Mat");

jqUnit.test("Test Basic Mat", function () {
    jqUnit.expect(2);
    var mat = fluid.tangledMat();
    fluid.tangledMat.addLayer(mat, [{a: 1}], "base");
    fluid.tangledMat.addLayer(mat, [{b: 2}], "extend");
    var root = fluid.tangledMat.getRoot(mat);
    var first = root[0];
    jqUnit.assertEquals("Contains base property", 1, first.a);
    jqUnit.assertEquals("Contains extended property", 2, first.b);
});
