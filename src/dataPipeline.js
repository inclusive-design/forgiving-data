/* eslint-env node */

"use strict";

var fluid = require("infusion");
var fs = require("fs"),
    path = require("path");
var octokitCore = require("@octokit/core");

var octokit = new octokitCore.Octokit({
//  auth: access_token
});

var gitOpsApi = require("data-update-github");

require("./readJSON.js");
require("./settleStructure.js");
require("./tangledMat.js");

fluid.registerNamespace("fluid.data");

/** Hierarchy for primitive dataPipes based around simple functions **/

fluid.defaults("fluid.dataPipe", {
    gradeNames: "fluid.function"
});

// A pipe which sources data in a purely algorithmic way, and so the provenance of any data it writes is taken solely from its own definition
fluid.defaults("fluid.overlayProvenancePipe", {
    gradeNames: "fluid.dataPipe"
});

// A pipe which contributes a simple, uniform provenance record covering all its output - e.g. a file loader
fluid.defaults("fluid.selfProvenancePipe", {
    gradeNames: "fluid.dataPipe"
});


/** Hierarchy for compound dataPipes which are components **/

fluid.defaults("fluid.dataPipeComponent", {
    gradeNames: "fluid.component",
    members: {
        completionPromise: "@expand:fluid.dataPipeComponent.makeCompletionPromise({that})"
    }
});
// At top level arrives - data, after launch is complete

fluid.dataPipeComponent.makeCompletionPromise = function (that) {
    var togo = fluid.promise();
    // Bind this in expander rather than in onCreate since otherwise the onCreate of a different component may bind to
    // it first - naturally this nonsense goes away once we abolish events
    togo.then(function (data) {
        that.data = data;
    });
    return togo;
};

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

fluid.defaults("fluid.compoundElement", {
    gradeNames: "fluid.dataPipeComponent",
    mergePolicy: {
        elements: {
            noexpand: true,
            func: fluid.arrayConcatPolicy
        }
    },
    mergedElements: "@expand:fluid.data.mergeElements({that}.options.elements)",
    dynamicComponents: {
        elements: {
            sources: "{that}.options.mergedElements",
            type: "{source}.type",
            options: "{source}.options"
        }
    },
    listeners: {
        "onCreate.waitCompletion": "fluid.compoundElement.waitCompletion"
    }
});

fluid.defaults("fluid.dataPipeline", {
    gradeNames: "fluid.compoundElement"
});

fluid.compoundElement.waitCompletion = function (that) {
    var allElements = fluid.queryIoCSelector(that, "fluid.dataPipeComponent", true);
    if (allElements.length === 0) {
        fluid.fail("No dataPipes found within " + fluid.dumpComponentAndPath(that));
    }
    fluid.each(allElements, function (element) {
        fluid.each(element.waitSet, function (oneWait) {
            oneWait.target.isConsumed = true;
        });
    });
    var notLasts = allElements.filter(function (nl) {
        return !nl.isConsumed;
    });

    if (notLasts.length === 0) {
        fluid.fail("Cyclic pipeline found at " + fluid.pathForComponent(that) + "\n\nwith wait sets " +
            fluid.getMembers(fluid.getMembers(allElements, "waitSet"), "ref"));
    } else if (notLasts.length > 1) {
        fluid.fail("Didn't find a unique last member in pipeline at " + fluid.pathForComponent(that) + ": elements\n" + fluid.transform(notLasts, function (nl) {
            return fluid.pathForComponent(nl);
        }).join("\n") + " are equally good candidates");
    } else {
        console.log("Pipeline " + fluid.pathForComponent(that) + " waiting for completion of pipeline " + fluid.pathForComponent(notLasts[0]));
        // EXIT GYRE!
        fluid.promise.follow(notLasts[0].completionPromise, that.completionPromise);
    }
};

/** Compute data dependencies of this element by traversing its configuration recursively.
 * @param {Object} options - The element's options
 * @param {Object[]} waitSet - The waitSet to be computed. **This is supplied as an empty array and populated by this function**
 * @param {String[]} segs - The array of path segments to the traversed options **This is supplied as an empty array and is modified by this function**
 * @return {Object} The supplied options, with any references to data dependencies censored - this is suitable for use as a provenance record
 */
fluid.data.findWaitSet = function (options, waitSet, segs) {
    return fluid.transform(options, function (value, key) {
        var togo;
        segs.push(key);
        // TODO: In future configuration might include "safe" references to non-data - we should resolve the component
        // here and determine whether this really is a data dependency
        if (fluid.isIoCReference(value)) {
            waitSet.push({
                ref: value,
                parsed: fluid.parseContextReference(value),
                path: fluid.copy(segs)
            });
            togo = fluid.NO_VALUE;
        } else if (fluid.isPlainObject(value)) {
            togo = fluid.data.findWaitSet(value, waitSet, segs);
        } else {
            togo = value;
        }
        segs.pop();
        return togo;
    });
};

// This had always meant to be configurable, as the comment suggests
fluid.computeDynamicComponentKeyCore = fluid.computeDynamicComponentKey;

fluid.computeDynamicComponentKey = function (recordKey, sourceKey) {
    if (recordKey === "elements") {
        return sourceKey;
    } else {
        return fluid.computeDynamicComponentKeyCore(recordKey, sourceKey);
    }
};

fluid.isParentComponent = function (parent, child) {
    var parentPath = fluid.pathForComponent(parent);
    var childPath = fluid.pathForComponent(child);
    return parentPath.every(function (parentSeg, i) {
        return parentSeg === childPath[i];
    });
};

fluid.dataPipeWrapper.computeWaitSet = function (that) {
    var waitSet = [];
    that.provenanceRecord = fluid.data.findWaitSet(that.options.innerOptions, waitSet, []);
    that.waitSet = waitSet;
    var waitCompletions = fluid.transform(waitSet, function (oneWait) {
        var resolved = fluid.resolveContext(oneWait.parsed.context, that);
        var failMid = "context reference " + oneWait.ref + " to a component at path " + oneWait.parsed.path + " in dataPipe options " + JSON.stringify(that.options.innerOptions, null, 2);
        if (!resolved) {
            fluid.fail("Computing waitSet of " + fluid.dumpComponentAndPath(that) + ": could not resolve data reference " + failMid + " to a component");
        }
        // Special-case this context resolution to, e.g. resolve by priority onto joined.joined, contrary to standard Infusion scoping rules
        if (fluid.isParentComponent(resolved, that)) {
            resolved = resolved[oneWait.parsed.context] || resolved;
        }
        if (!resolved.completionPromise) {
            fluid.fail("Resolved " + failMid + " to a non dataPipe component");
        }
        oneWait.target = resolved;
        return resolved.completionPromise;
    });
    console.log("Component at path " + fluid.pathForComponent(that) + " waiting on set " + fluid.getMembers(waitSet, "parsed.context"));
    // TODO: In theory we could short-circuit some of the work in fluid.dataPipeWrapper.launch by making this a fluid.settleStructure
    var allCompletions = fluid.promise.sequence(waitCompletions);
    allCompletions.then(function () {
        console.log("Wait complete for component at path " + fluid.pathForComponent(that) + " - launching");
        that.events.launchPipe.fire();
    });
};

fluid.data.pathWithinPipeline = function (that) {
    var pipeline = fluid.resolveContext("fluid.dataPipeline", that);
    var pipelinePath = fluid.pathForComponent(pipeline);
    var ourPath = fluid.pathForComponent(that);
    var pathWithinPipeline = ourPath.slice(pipelinePath.length);
    return pathWithinPipeline;
};

fluid.data.interpretPipeResult = function (result, that) {

    var upDefaults = fluid.defaults(that.options.innerType);
    var provenanceName = fluid.data.pathWithinPipeline(that).join(".");

    if (fluid.hasGrade(upDefaults, "fluid.overlayProvenancePipe")) {
        var input = that.options.innerOptions.input;

        var mat = fluid.tangledMat([input, {
            value: result.value,
            name: provenanceName
        }], true);
        result.value = mat.evaluateFully([]);
        result.provenance = mat.getProvenance();
        result.provenanceMap = fluid.extend({}, input.provenanceMap, {
            [provenanceName]: that.provenanceRecord
        });
    } else if (fluid.hasGrade(upDefaults, "fluid.selfProvenancePipe")) {
        result.provenance = provenanceName;
        result.provenanceMap = {
            [provenanceName]: that.provenanceRecord
        };
    }
    return result;
};

fluid.dataPipeWrapper.launch = function (that) {
    var overlay = {};
    fluid.each(that.waitSet, function (oneWait) {
        var fetched = fluid.get(oneWait.target, oneWait.parsed.path);
        fluid.set(overlay, oneWait.path, fetched);
    });
    var expanded = fluid.extend(true, {}, that.options.innerOptions, overlay);
    var result = fluid.invokeGlobalFunction(that.options.innerType, [expanded]);
    var promise = fluid.toPromise(result);
    var promiseTogo = fluid.promise.map(promise, function (value) {
        return fluid.data.interpretPipeResult(value, that);
    });
    fluid.promise.follow(promiseTogo, that.completionPromise);
};


fluid.data.elementToGrade = function (element, baseGrade) {
    var nonCore = fluid.censorKeys(element, ["type", "parents"]);
    var togo = {
        type: element.type,
        options: nonCore
    };
    var gradeNames = fluid.makeArray(element.parents).concat(baseGrade || []);
    togo.options.gradeNames = gradeNames;
    console.log("type ", element.type, " gradeNames ", gradeNames);
    var upDefaults = baseGrade ? fluid.defaults(baseGrade) : fluid.getMergedDefaults(element.type, gradeNames);
    console.log("upDefaults ", upDefaults);
    if (fluid.hasGrade(upDefaults, "fluid.component")) {
        return togo;
    } else {
        return {
            type: "fluid.dataPipeWrapper",
            options: {
                innerType: togo.type,
                innerOptions: togo.options
            }
        };
    }

    return togo;
};

fluid.data.registerPipeline = function (pipeline) {
    var rec = fluid.data.elementToGrade(pipeline, "fluid.dataPipeline");
    console.log("Registering ", rec.options, " under type ", rec.type);
    fluid.defaults(rec.type, rec.options);
};

// Time-honoured 2008-era function deleted from the framework
// Same return as fluid.model.stepTargetAccess
fluid.data.getPenultimate = function (root, segs) {
    var move = root,
        prev, seg;
    for (var i = 0; i < segs.length; ++i) {
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

fluid.data.upgradeElements = function (layers, currentLayer, path) {
    for (var i = layers.length - 1; i > currentLayer; --i) {
        var thisLayer = layers[i];
        var pen = fluid.data.getPenultimate(thisLayer, path);
        var current = pen.root;
        console.log("Got ", pen, " from path ", path);
        if (fluid.isPlainObject(current, true) && current.type !== "fluid.compoundElement") {
            var upgraded = {
                elements: {
                    [pen.last]: current
                }
            };
            pen.pen[pen.last] = upgraded;
            console.log("After upgrade, layer " + i + " reads ", thisLayer);
        }
    }
};

/** Given an array of element definitions, resolve their fully merged structure by means of STRUCTURAL PROMOTION
 * @param {Object[]} layers - Array of unmerged element definitions
 * @return {Object} A merged hash of element definitions, also convered into standard Infusion grade definitions
 */
fluid.data.mergeElements = function (layers) {
    // Currently elements on the left composite on top of elements to the right - check grade rules
    for (var i = layers.length - 2; i >= 0; --i) {
        var layer = layers[i];
        var path = [];
        console.log("Considering layer ", JSON.stringify(layer, null, 2));
        fluid.each(layer, function (record, key) { // eslint-disable-line no-loop-func
            path.push(key);
            // We've found a compound - check all elements to the right in reverse order to see if they need an upgrade
            if (fluid.isPlainObject(record, true) && record.type === "fluid.compoundElement") {
                fluid.data.upgradeElements(layers, i, path);
            }
            path.pop();
        });
    }
    var mergedElements = fluid.extend(true, {}, ...layers);
    console.log("Got mergedElements ", JSON.stringify(mergedElements, null, 2));
    var mergedComponents = fluid.transform(mergedElements, function (mergedElement) {
        return fluid.data.elementToGrade(mergedElement);
    });
    return mergedComponents;
};


fluid.data.loadAllPipelines = function (directory) {
    var resolved = fluid.module.resolvePath(directory);
    fs.readdirSync(resolved).forEach(function (filename) {
        var defaults = fluid.data.readJSONSync(resolved + "/" + filename, "Loading pipeline definition");
        fluid.data.registerPipeline(defaults);
    });
};

fluid.data.loadPipeline = function (types) {
    var that = fluid.dataPipeline({
        gradeNames: types
    });
    return that;
};


fluid.defaults("fluid.fetchGitCSV", {
    gradeNames: "fluid.selfProvenancePipe"
});

fluid.fetchGitCSV = async function (options) {
    var commonOptions = fluid.filterKeys(options, ["repoOwner", "repoName", "filePath", "branchName"]);
    commonOptions.branchName = commonOptions.branchName || "main";
    var result = await gitOpsApi.fetchRemoteFile(octokit, commonOptions);
    var parsed = await fluid.resourceLoader.parsers.csv(result.content, {resourceSpec: {}});
    return {
        value: parsed
    };
};

fluid.defaults("fluid.fileOutput", {
    gradeNames: "fluid.dataPipe"
});

/**
 * A layer structure as stored within a fluid.tangledMat.
 * @typedef {Object} ProvenancedTable
 * @property {Object<String, String>[]} value - Array of CSV row values
 * @property {Object<String, String>[]} provenanceMap - Isomorphic to `value` - an array of provenance records for each row
 * @property {Object} provenanceMap A map of provenance strings to records resolving the provenance - either a dataset record or another pipeline record
 */

/** A pipeline entry which outputs a provenance record to a grouped set of files
 * @param {Object} options - The pipeline element's record in the configuration, including members
 *     {String} `path` holding the directory where the files are to be written
 *     {String} `value` holding the filename within `path` where the data is to be written as CSV
 *     {String} `provenance` holding the filename within `path` where the provenance data is to be written as CSV
 *     {String} `provenenceMap` holding the filename within `path` where the map of provenance strings to records is to be written as JSON
 *     {ProvenancedTable} input - The data to be written
 */
fluid.fileOutput = function (options) {
    fs.mkdirSync(options.path, { recursive: true });
    var input = options.input;

    fluid.data.writeCSV(path.join(options.path, options.value), input.value);
    fluid.data.writeCSV(path.join(options.path, options.provenance), input.provenance);
    fluid.data.writeJSONSync(path.join(options.path, options.provenanceMap), input.provenanceMap);
};
