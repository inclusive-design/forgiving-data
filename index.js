"use strict";

var fluid = require("infusion");

fluid.module.register("forgiving-data", __dirname, require);

require("./src/CSVEncoding.js");
require("./src/JSONEncoding.js");
require("./src/forgivingJoin.js");
require("./src/dataPipeline.js");
require("./src/environmentResolver.js");

fluid.registerNamespace("fluid.data");

fluid.data.loadAllPipelines("%forgiving-data/pipelines");
