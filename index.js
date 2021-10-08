"use strict";

var fluid = require("infusion");

fluid.module.register("forgiving-data", __dirname, require);

require("./src/CSVEncoding.js");
require("./src/JSONEncoding.js");
require("./src/forgivingJoin.js");
require("./src/dataPipeline.js");
require("./src/processPipes.js");
require("./src/ioPipes.js");
require("./src/processPipes.js");
require("./src/environmentResolver.js");

fluid.dataPipeline.loadAll("%forgiving-data/pipelines");
