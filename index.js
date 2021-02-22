"use strict";

var fluid = require("infusion");

fluid.module.register("forgiving-data", __dirname, require);

require("./src/CSVResource.js");
require("./src/forgivingJoin.js");

fluid.registerNamespace("fluid.data");
