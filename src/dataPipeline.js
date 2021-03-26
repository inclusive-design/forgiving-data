/* eslint-env node */

"use strict";

var fluid = require("infusion");
var fs = require("fs"),
    path = require("path");
var simpleGit = require("simple-git");
var rimraf = require("rimraf");

require("./readJSON.js");
require("./settleStructure.js");
require("./tangledMat.js");

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

/** Given a github URL, produces a filesystem path which uniquely represents it
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

/** Load a pipeline job structure and resolve all git repository references in its `datasets` area
 * @param {String} filename - The filename of the JSON/JSON5 pipeline definition
 * @param {String} workingDir - The working directory where git repositories are to be checked out. This need not be
 * empty at start, but its contents will be destroyed and recreated by this function
 * @return {Object} A resolved pipeline job structure with elements `value` and `revision` filled in in the datasets area,
 * holding the CSV data and git revision hash of the relevant repository respectively
 */
fluid.data.loadJob = function (filename, workingDir) {
    var resolved = fluid.module.resolvePath(filename);
    var job = fluid.data.readJSONSync(resolved);
    var working = fluid.module.resolvePath(workingDir);
    console.log("Removing directory " + working);
    rimraf.sync(working);
    fs.mkdirSync(working, { recursive: true });
    var git = simpleGit(working);
    var gitsByPath = {};
    var datasetLoad = fluid.transform(job.datasets, function (dataset) {
        var prefix = fluid.data.gitUrlToPrefix(dataset.repository);
        console.log("prefix " + prefix);
        var repoPath = path.join(working, prefix);
        console.log("Checking " + repoPath);
        var cloneAction = fluid.getImmediate(gitsByPath, [repoPath, "cloneAction"]);
        if (!cloneAction) {
            cloneAction = git.clone(dataset.repository, prefix);
            fluid.model.setSimple(gitsByPath, [repoPath, "cloneAction"], cloneAction);
        }
        var togo = {
            value: fluid.promise(),
            revision: fluid.promise()
        };
        cloneAction.then(function () {
            var fullPath = path.join(repoPath, dataset.path);
            var subgit = simpleGit(repoPath);
            fluid.model.setSimple(gitsByPath, [repoPath, "git"], subgit);
            var text = fs.readFileSync(fullPath, "utf-8");
            var csvPromise = fluid.resourceLoader.parsers.csv(text, {resourceSpec: {}});
            fluid.promise.follow(csvPromise, togo.value);
            var revParsePromise = subgit.revparse(["HEAD"]);
            fluid.promise.follow(revParsePromise, togo.revision);
        });
        return togo;
    });
    var togo = fluid.promise();
    return fluid.promise.map(fluid.settleStructure(datasetLoad), function (overlay) {
        var jobWithData = fluid.extend(true, {}, job, {
            datasets: overlay
        });
        return jobWithData;
    });
    return togo;
};

fluid.defaults("fluid.fileOutput", {
    gradeNames: "fluid.simpleInputPipe"
});

fluid.fileOutput = function (record, result) {
    fs.mkdirSync(record.path, { recursive: true });

    fluid.data.writeCSV(path.join(record.path, record.value), result.value);
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

/** Executes a pipeline job as loaded via `fluid.data.loadJob`.
 * @param {Object} job - The pipeline job as loaded via `fluid.data.loadJob`
 */
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
            args = [onePipe, input];
        } else { // TODO: Currently only the join itself - produce a declarative syntax for it to locate its own arguments
            args = [onePipe, job.datasets, pipeOutputs];
        }
        var result = fluid.invokeGlobalFunction(onePipe.type, args);
        if (fluid.hasGrade(grade, "fluid.selfProvenancePipe")) {
            var newProvenanceName = fluid.data.uniqueProvenanceName(job.datasets, key);
            var mat = fluid.tangledMat([input, {
                value: result.value,
                name: newProvenanceName
            }], true);
            result.value = mat.evaluateFully([]);
            result.provenance = mat.getProvenance();
            result.provenanceMap = fluid.extend({}, input.provenanceMap, {
                [newProvenanceName]: onePipe
            });
        }
        pipeOutputs[key] = result;
    };
};
