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


fluid.defaults("fluid.dataPipeComponent", {
    gradeNames: "fluid.component",
    completionPromise: "@expand:fluid.promise()"  
});

fluid.defaults("fluid.dataPipeline", {
    gradeNames: "fluid.dataPipeComponent"
});

fluid.defaults("fluid.compoundElement", {
    gradeNames: "fluid.dataPipeComponent",
    mergePolicy: {
        elements: {
            noexpand: true,
            func: fluid.arrayConcatPolicy
        }
    }
});

fluid.defaults("fluid.dataPipeWrapper", {
    gradeNames: "fluid.dataPipeComponent",
    mergePolicy: {
        innerOptions: {
            noexpand: true
        }
    },
    events: {
        launchPipe: null
    },
    listeners: {
        "onCreate.computeWaitSet": "fluid.dataPipeWrapper.computeWaitSet({that})",
        "launchPipe.launch": "fluid.dataPipeWrapper.launch({that})"
    }
    // innerType:
    // innerOptions
});
// At top level arrives - data

fluid.dataPipeWrapper.computeWaitSet = function (that) {
    var waitSet = [];
    fluid.data.findWaitSet(that.options.innerOptions, waitSet, []);
    that.waitSet = waitSet;
    var waitCompletions = fluid.transform(waitSet, function (oneWait) {
        var resolved = fluid.resolveContext(oneWait.parsed.context);
        var failMid = "context reference " + oneWait.ref + " to a component at path " + oneWait.parsed.path + " in dataPipe options " + JSON.stringify(that.options.innerOptions, null, 2);
        if (!resolved) {
            fluid.fail("Could not resolve " + failMid + " to a component");
        }
        if (!resolved.completionPromise) {
            fluid.fail("Resolved " + failMid + " to a non dataPipe component");
        }
        return resolved.completionPromise;
    });
    var allCompletions = fluid.promise.sequence(waitCompletions);
    allCompletions.then(that.events.launchPipe.fire);
};

fluid.data.pathWithinPipeline = function (that) {
    var pipeline = fluid.resolveContext("fluid.dataPipeline", that);
    var pipelinePath = fluid.pathForComponent(pipeline);
    var ourPath = fluid.pathForComponent(that);
    var pathWithinPipeline = ourPath.slice(pipelinePath.length);
    return pathWithinPipeline.join(".");
};

fluid.data.interpretPipeResult = function (result, that) {

    var upDefaults = fluid.defaults(that.options.innerOptions);

    if (fluid.hasGrade(upDefaults, "fluid.selfProvenancePipe")) {
        var newProvenanceName = fluid.data.pathWithinPipeline(that).join(".");
        var newProvenanceName = fluid.data.uniqueProvenanceName(pipeline.datasets, key);
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
    return result;
};

fluid.dataPipeWrapper.launch = function (that) {
    var expanded = fluid.expandImmediate(that.options.innerOptions, that);
    var result = fluid.invokeGlobalFunction(that.options.innerType, [expanded]);
    var promise = fluid.toPromise(result);
    var promiseTogo = fluid.promise.map(promise, function (value) {
        return fluid.data.interpretPipeResult(value, that);
    });
    promiseTogo.then(function (data) {
        that.data = data;
        that.completionPromise.resolve(data);
    });
    return promiseTogo;
};

fluid.data.findWaitSet = function (options, waitSet, segs) {
    fluid.each(options, function (value, key) {
        if (fluid.isIoCReference(value)) {
            waitSet.push({
                ref: value,
                parsed: fluid.parseContextReference(value),
                path: fluid.copy(segs)
            });
        }
        if (fluid.isPlainObject(value)) {
            segs.push(key);
            fluid.data.findWaitSet(value, waitSet);
            segs.pop()
        }
    });
};

fluid.data.elementToGrade = function (element, root) {
    var nonCore = fluid.censorKeys(pipeline, ["type", "parents"]);
    var togo = {
        type: pipeline.type,
        options: nonCore
    };
    var gradeNames = fluid.makeArray(pipeline.parents).concat(root ? "fluid.dataPipeline" : []);
    togo.options.gradeNames = gradeNames;
    var upDefaults = fluid.defaults(pipeline.type, gradeNames);
    if (fluid.hasGrade(upDefaults, "fluid.component")) {
        return togo
    } else {
        return {
            type: "fluid.dataPipeWrapper",
            innerType: togo.type,
            innerOptions: togo.options 
        }
    }

    return togo;
};

fluid.data.registerPipeline = function (pipeline) {
    var rec = fluid.data.elementToGrade(pipeline, true);
    console.log("Registering ", rec.options, " under type ", rec.type);
    fluid.defaults(rec.type, rec.options);
};

// Time-honoured 2008-era function deleted from the framework
// Same return as fluid.model.stepTargetAccess
fluid.data.getPenultimate = function (root, segs) {
    var move = root,
        prev, seg;
    for (var i = 0; i < segs.length; ++ i) {
        prev = move;
        seg = segs[i];
        move = move && move[seg];
    }
    return {
        pen: prev,
        root: move,
        last: seg
    };
};

fluid.data.upgradePipes = function (layers, currentLayer, path) {
    for (var i = layers.length - 1; i > currentLayer; -- i) {
        var thisLayer = layers[i];
        var pen = fluid.data.getPenultimate(thisLayer, path);
        var current = pen.root;
        console.log("Got ", pen, " from path ", path);
        if (fluid.isPlainObject(current, true) && current.type !== "fluid.compoundDataPipe") {
            var upgraded = {
                pipes: {
                    [pen.last] : current 
                }
            };
            pen.pen[pen.last] = upgraded;
            console.log("After upgrade, layer " + i + " reads ", thisLayer);
        }
    }
};

/** Given a pipeline type name, resolve its fully merged structure against its parents (which are assumed to be already loaded)
 * @param {String|String[]} type - The type name of the pipeline to be loaded
 * @return {PipeDef} The fully merged pipeline definition
 */
fluid.data.resolvePipeline = function (type) {
    var types = fluid.makeArray(type);
    var head = types.shift();
    console.log("Reading head type ", head);
    var merged = fluid.copy(fluid.getMergedDefaults(head, types));
    console.log("Got merged ", JSON.stringify(merged, null, 2));
  
    var layers = merged.pipeline;
    // Currently elements on the left composite on top of elements to the right - check grade rules
    for (var i = layers.length - 2; i >= 0; -- i) {
        var layer = layers[i];
        var path = [];
        console.log("Considering layer ", JSON.stringify(layer, null, 2));
        fluid.each(layer, function (record, key) {
            path.push(key);
            // We've found a compound - check all elements to the right in reverse order to see if they need an upgrade
            if (fluid.isPlainObject(record, true) && record.type === "fluid.compoundDataPipe") {
                fluid.data.upgradePipes(layers, i, path);
            }
            path.pop();
        });
    }
    var mergedPipeline = fluid.extend(true, {}, ...layers);
    console.log("Got mergedPipeline ", JSON.stringify(mergedPipeline, null, 2));
    return fluid.extend(true, fluid.censorKeys(merged, ["pipeline"]), {
        pipeline: mergedPipeline
    });
};

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

fluid.data.loadAllPipelines = function (directory) {
    var resolved = fluid.module.resolvePath(directory);
    fs.readdirSync(resolved).forEach(function (filename) {
        var defaults = fluid.data.readJSONSync(resolved + "/" + filename, "Loading pipeline definition");
        fluid.data.registerPipeline(defaults);
    });
};

/** Load a pipeline structure and resolve all git repository references in its `datasets` area
 * @param {Object} pipeDef - The resolved pipeline to be loaded
 * @param {String} workingDir - The working directory where git repositories are to be checked out. This need not be
 * empty at start, but its contents will be destroyed and recreated by this function
 * @return {Object} A resolved pipeline job structure with elements `value` and `revision` filled in in the datasets area,
 * holding the CSV data and git revision hash of the relevant repository respectively
 */
fluid.data.loadPipelineDatasets = function (pipeDef, workingDir) {
    var working = fluid.module.resolvePath(workingDir);
    console.log("Removing directory " + working);
    rimraf.sync(working);
    fs.mkdirSync(working, { recursive: true });
    var git = simpleGit(working);
    var gitsByPath = {};
    var datasetLoad = fluid.transform(pipeDef.datasets, function (dataset) {
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
        var pipelineWithData = fluid.extend(true, {}, pipeDef, {
            datasets: overlay
        });
        return pipelineWithData;
    });
    return togo;
};

fluid.defaults("fluid.fileOutput", {
    gradeNames: "fluid.simpleInputPipe"
});

/**
 * A layer structure as stored within a fluid.tangledMat.
 * @typedef {Object} ProvenancedTable
 * @property {Object<String, String>[]} value - Array of CSV row values
 * @property {Object<String, String>[]} provenanceMap - Isomorphic to `value` - an array of provenance records for each row
 * @property {Object} provenanceMap A map of provenance strings to records resolving the provenance - either a dataset record or another pipeline record
 */

/** A pipeline entry which outputs a provenance record to a grouped set of files
 * @param {Object} record - The pipeline element's record in the configuration, including members
 *     {String} `path` holding the directory where the files are to be written
 *     {String} `value` holding the filename within `path` where the data is to be written as CSV
 *     {String} `provenance` holding the filename within `path` where the provenance data is to be written as CSV
 *     {String} `provenenceMap` holding the filename within `path` where the map of provenance strings to records is to be written as JSON
 * @param {ProvenancedTable} result - The data to be written
 */
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

/** Executes a pipeline as loaded via `fluid.data.loadPipeline`.
 * @param {Object} job - The pipeline job as loaded via `fluid.data.loadPipeline`
 */
fluid.data.executePipeline = function (pipeline) {
    var pipeOutputs = {};
    var pipeKeys = Object.keys(pipeline.pipeline);
    // TODO: Turn dataset input themselves into a pipeline element and turn this into some kind of transform chain
    for (var i = 0; i < pipeKeys.length; ++i) {
        var key = pipeKeys[i];
        var prevKey = pipeKeys[i - 1];
        var onePipe = pipeline.pipeline[key];
        console.log("Applying pipeline element " + onePipe.type + " for key " + key + " at index " + i);
        var grade = fluid.defaults(onePipe.type);
        var args, input;
        if (fluid.hasGrade(grade, "fluid.simpleInputPipe")) {
            var prevOutput = prevKey ? pipeOutputs[prevKey] : {};
            input = onePipe.input === "_" ? prevOutput : pipeOutputs[onePipe.input];
            args = [onePipe, input];
        } else { // TODO: Currently only the join itself - produce a declarative syntax for it to locate its own arguments
            args = [onePipe, pipeline.datasets, pipeOutputs];
        }
        var result = fluid.invokeGlobalFunction(onePipe.type, args);
        if (fluid.hasGrade(grade, "fluid.selfProvenancePipe")) {
            var newProvenanceName = fluid.data.uniqueProvenanceName(pipeline.datasets, key);
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
