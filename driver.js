"use strict";

var fluid = require("infusion");

require("./index.js");

fluid.data.loadAllPipelines("%forgiving-data/pipelines");

var pipeline = fluid.data.loadPipeline(["fluid.pipelines.WeCount-ODC-synthetic", "fluid.pipelines.WeCount-ODC-fileOutput"]);

pipeline.completionPromise.then(function () {
    console.log("Pipeline executed successfully");
}, function (err) {
    console.log("Pipeline execution error", err);
});
