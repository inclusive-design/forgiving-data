/* eslint-env node */

"use strict";

var fluid = require("infusion");

fluid.defaults("fluid.resolvers.env", {
    gradeNames: ["fluid.component", "fluid.resolveRootSingle"],
    singleRootType: "fluid.resolvers.env",
    listeners: {
        "onCreate.mountResolver": "fluid.resolvers.env.mountResolver"
    }
});

fluid.resolvers.env.mountResolver = function (that) {
    that.resolvePathSegment = function (name) {
        return process.env[name];
    };
};

fluid.resolvers.env();
