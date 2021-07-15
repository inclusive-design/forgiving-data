"use strict";

/* eslint-env node */

var fluid = require("infusion");

require("../src/tangledMat.js");

var jqUnit = fluid.require("node-jqunit");

jqUnit.module("Tangled Mat");

jqUnit.test("Test basic mat with proxies", function () {
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
    var provenance = mat.getProvenance();
    var expected = [ {
        a: "base",
        b: "extend"
    }];
    jqUnit.assertDeepEq("Expected provenance map", expected, provenance);
    jqUnit.assertDeepEq("Base layer uncorrupted",   [{a: 1}], baseLayer);
    jqUnit.assertDeepEq("Extend layer uncorrupted", [{b: 2}], extendLayer);
});

jqUnit.test("Test mat with compound provenance without proxies", function () {
    var compoundLayer = fluid.freezeRecursive({
        value: [{
            a: 1,
            b: 2
        }],
        provenance: [{
            a: "base",
            b: "extend"
        }],
        name: "compound"
    });
    var overlayLayer = fluid.freezeRecursive({
        value: [{
            c: 3
        }, {
            d: 4
        }],
        name: "overlay"
    });
    var mat = fluid.tangledMat([compoundLayer, overlayLayer]);
    var expectedValue = [{
        a: 1,
        b: 2,
        c: 3
    }, {
        d: 4
    }];
    var expectedProvenance = [{
        a: "base",
        b: "extend",
        c: "overlay"
    }, {
        d: "overlay"
    }];
    mat.evaluateFully([]);
    jqUnit.assertDeepEq("Expected evaluation", expectedValue, mat.getRoot());
    jqUnit.assertDeepEq("Expected provenance", expectedProvenance, mat.getProvenance());
});

jqUnit.test("Test mat with shared values without proxies", function () {
    var baseLayer = fluid.freezeRecursive({
        value: {
            a: 1,
            b: 2
        },
        name: "base"
    });
    var extendLayer = fluid.freezeRecursive({
        value: {
            a: 3,
            c: {
                d: 4
            }
        },
        name: "extend"
    });
    var mat = fluid.tangledMat([baseLayer, extendLayer]);
    var expectedValue = {
        a: 3,
        b: 2,
        c: {
            d: 4
        }
    };
    var expectedProvenance = {
        a: "extend",
        b: "base",
        c: {
            d: "extend"
        }
    };
    mat.evaluateFully([]);
    jqUnit.assertDeepEq("Expected evaluation", expectedValue, mat.getRoot());
    jqUnit.assertDeepEq("Expected provenance", expectedProvenance, mat.getProvenance());
});
