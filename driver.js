"use strict";

var fluid = require("infusion");

require("./index.js");

var job = fluid.data.loadJob("%forgiving-data/jobs/WeCount-ODC.json5", "%forgiving-data/data");

job.then(function (result) {
    console.log("Data loaded successfully");
    fluid.data.executePipeline(result);
}, function (err) {
    console.log("Data loading error", err);
});
