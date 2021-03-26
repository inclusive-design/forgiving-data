"use strict";

var fluid = require("infusion");

fluid.module.register("forgiving-data", __dirname, require);

require("./src/CSVResource.js");
require("./src/forgivingJoin.js");
require("./src/dataPipeline.js");

// project-specific includes - presumably include a pipeline directive for these
require("./src/inventCovid.js");

fluid.registerNamespace("fluid.data");
