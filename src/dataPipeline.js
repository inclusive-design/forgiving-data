/* eslint-env node */

"use strict";

var fluid = require("infusion");
var fs = require("fs"),
    path = require("path");
var simpleGit = require("simple-git");
var rimraf = require("rimraf");

require("./readJSON.js");
require("./settleStructure.js");

fluid.registerNamespace("fluid.data");

fluid.defaults("fluid.dataPipe", {
    gradeNames: "fluid.function"
});

fluid.defaults("fluid.simpleInputPipe", {
    gradeNames: "fluid.dataPipe"
});

// A pipe which sources data in a purely algorithmic way, and so whose provenance is taken solely from its own definition
fluid.defaults("fluid.selfProvenancePipe", {
    gradeNames: "fluid.simpleInputPipe"
});

/** Given a githib URL, produces a filesystem path which uniquely represents it
 * @param {String} url - A URL to a github repository
 * @return {String} A directory name containing filesystem-safe characters which can be used to uniquely clone the repository
 */
fluid.data.gitUrlToPrefix = function (url) {
    // cf. https://github.com/inclusive-design/data-update-github/blob/main/scripts/fetchODCDataFilesUtils.js#L171
    var pattern = /https:\/\/github.com\/(.*)\/(.*)/;
    console.log(url);
    var matches = pattern.exec(url);
    var user = matches[1];
    var repo = matches[2];
    return "github-" + user + "-" + repo + "/";
};

fluid.data.loadJob = function (filename, workingDir) {
    var resolved = fluid.module.resolvePath(filename);
    var job = fluid.data.readJSONSync(resolved);
    var working = fluid.module.resolvePath(workingDir);
    rimraf.sync(working);
    fs.mkdirSync(working, { recursive: true });
    var git = simpleGit(working);
    var csvPromises = fluid.transform(job.datasets, function (dataset) {
        var prefix = fluid.data.gitUrlToPrefix(dataset.repository);
        console.log("prefix " + prefix);
        var repoPath = path.join(working, prefix);
        console.log("Checking " + repoPath);
        var cloneAction;
        if (fs.existsSync(repoPath)) {
            cloneAction = fluid.promise().resolve();
        } else {
            cloneAction = git.clone(dataset.repository, prefix);
        }
        var togo = fluid.promise();
        cloneAction.then(function () {
            var fullPath = path.join(repoPath, dataset.path);
            var text = fs.readFileSync(fullPath, "utf-8");
            fluid.promise.follow(fluid.resourceLoader.parsers.csv(text, {resourceSpec: {}}), togo);
        });
        return togo;
    });
    var togo = fluid.promise();
    return fluid.promise.map(fluid.settleStructure(csvPromises), function (csvs) {
        fluid.each(csvs, function (onecsv, key) {
            // Less sleazy would be an applyImmutable if we had it - note that this is an interesting case where
            // we can apply an "overlay" structure with one fewer clone if we can see the whole thing up front
            job.datasets[key] = onecsv;
        });
        return job;
    });
    return togo;
};



fluid.fileOutput = function (record, datasets, pipeOutputs) {
    var result = pipeOutputs[record.input];
    fs.mkdirSync(record.path, { recursive: true });

    fluid.data.writeCSV(path.join(record.path, record.values), result.output);
    fluid.data.writeCSV(path.join(record.path, record.provenance), result.provenance);
    fluid.data.writeJSONSync(path.join(record.path, record.provenanceMap), result.provenanceMap);
};

fluid.data.uniqueProvenanceName = function (datasets, name) {
    var testName = name,
        count = 0;
    while (datasets[testName]) {
        ++count;
        testName = name + "-" + count;
    };
    return testName;
};

fluid.data.executePipeline = function (job) {
    var pipeOutputs = {};
    var pipeKeys = Object.keys(job.pipeline);
    // TODO: Turn dataset input themselves into a pipeline element and turn this into some kind of transform chain
    for (var i = 0; i < pipeKeys.length; ++i) {
        var key = pipeKeys[i];
        var prevKey = pipeKeys[i - 1];
        var onePipe = job.pipeline[key];
        console.log("Applying pipeline element " + onePipe.type + " for key " + key + " at index " + i);
        var grade = fluid.defaults(onePipe.type);
        var args, input;
        if (fluid.hasGrade(grade, "fluid.simpleInputPipe")) {
            var prevOutput = prevKey ? pipeOutputs[prevKey] : {};
            input = onePipe.input === "_" ? prevOutput : pipeOutputs[onePipe.input];
            args = [onePipe.type, input];
        } else { // TODO: Currently only the join itself - produce a declarative syntax for it to locate its own arguments
            args = [onePipe, job.datasets, pipeOutputs];
        }
        var result = fluid.invokeGlobalFunction(onePipe.type, args);
        if (fluid.hasGrade(grade, "fluid.selfProvenancePipe")) {
            var mat = fluid.tangledMat([input, {
                values: result,
                name: fluid.data.uniqueProvenanceName(job.datasets, key)
            }], true);
            result.provenanceMap = mat.getProvenanceMap();
            result.provenance = fluid.extend(job.datasets, {
                key: onePipe
            });
        }
        pipeOutputs[key] = result;
    };
};
