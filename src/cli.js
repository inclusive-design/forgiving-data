/* eslint-env node */

"use strict";

require("../index.js");

var fluid = require("infusion");

var runFilename = process.argv[2];

if (!runFilename) {
    console.log("Usage: runFluidPipeline <pipelineRunConfigFile>");
    process.exit(-1);
}

fluid.dataPipeline.runCLI(runFilename);
