var fluid = require("infusion"); 

require("./index.js");

var job = fluid.data.loadJob("%forgiving-data/jobs/WeCount-ODC.json5", "%forgiving-data/data");

job.then(function (result) {
    console.log("Success");
}, function (err) {
    console.log("Got ERROUR", err);
});
