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

/**
 * A layer structure as stored within a fluid.tangledMat.
 * @typedef {Object} ProvenancedTable
 * @property {Object<String, String>[]} value - Array of CSV row values
 * @property {Object<String, String>[]} provenanceMap - Isomorphic to `value` - an array of provenance records for each row
 * @property {Object} provenanceMap A map of provenance strings to records resolving the provenance - either a dataset record or another pipeline record
 */

/** Hierarchy for primitive dataPipes based around simple functions **/

/** Root of the dataPipe function hierarchy. These functions accept a single `options` structure, assembled from the contents
 * of their `options` block by resolving any data references, and return either a ProvenancedTable or a promise yielding one
 */
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

// A component which wraps a "simple function" dataPipe as a fluid.dataPipeComponent - manages its lifecycle, loading its
// data dependencies and interpreting its output as a provenance layer if necessary

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
    // innerType: grade name of the function pipe - descended from fluid.dataPipe
    // innerOptions: options sent to the function pipe
});

// A compound dataPipeComponent which forms a "gyre" as described in https://docs.google.com/presentation/d/12vLg_zWS6uXaHRy8LWQLzfNPBYa1E6L-WWyLqH1iWJ4
// Accepts a pipeline description as "elements" which is then upgraded to a standard Infusion subcomponent definition appearing in dynamicComponents.elements

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

// A grade for an entire pipeline - just as a marker grade since there is no additional functionality beyond fluid.compoundElement

fluid.defaults("fluid.dataPipeline", {
    gradeNames: "fluid.compoundElement"
});

/** Determine which is the pipeline element which will form the output of this compound element, and bind our own completion
 * promise to its one
 * @param {fluid.compoundElement} that - The compound element which is to be searched for its exit element
 */
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
    // TODO: Should interpret "return" option here rather than necessarily looking for element which is not depended on

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

/** Monkey-patch Infusion's computation of computeDynamicComponentKey so that for a dynamic component named "elements", its
 * member name is simply its source key. This seemed to be the cheapest way to arrange, e.g. for an element whose key was
 * "joined" to be resolvable under the context name "joined". We never arranged for fluid.computeNickName to be configurable
 * either.
 * @param {String} recordKey - The dynamic component definition's  key in its parent's options block
 * @param {String} sourceKey - The key of the dynamic component instance within its `sources` record
 * @return {String} The member name to be used in the parent component to register the dynamic component instance. If the
 * key is `elements`, we subvert the algorithm to simply return `sourceKey`, otherwise defer to Infusion's core algorithm.
 */
fluid.computeDynamicComponentKey = function (recordKey, sourceKey) {
    if (recordKey === "elements") {
        return sourceKey;
    } else {
        return fluid.computeDynamicComponentKeyCore(recordKey, sourceKey);
    }
};

/** Determine whether a component has another as a (direct or indirect) parent
 * @param {fluid.component} parent - The possible parent to be tested
 * @param {fluid.component} child - The possible child to be tested
 * @return {Boolean} `true` if `parent` is a parent of `child`
 */
fluid.isParentComponent = function (parent, child) {
    var parentPath = fluid.pathForComponent(parent);
    var childPath = fluid.pathForComponent(child);
    return parentPath.every(function (parentSeg, i) {
        return parentSeg === childPath[i];
    });
};

/** Computes the helpful `waitSet` record attached at top level to a dataPipeWrapper component. This is computed by
 * traversing its `innerOptions` record by means of `fluid.data.findWaitSet` - the data dependency references found in
 * it are then resolved onto components by means of a modified version of Infusion's core algorithm (see slide
 * 16 of https://docs.google.com/presentation/d/12vLg_zWS6uXaHRy8LWQLzfNPBYa1E6L-WWyLqH1iWJ4 ). Finally, a promise sequence
 * which waits for completion of all of these dependencies is bound to a firing of the component's `launchPipe` event.
 * @param {fluid.dataPipeWrapper} that - The component for which the waitSet is to be computed
 */
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

/** Determines the path of a pipeline element within its parent pipeline. This is useful for computing provenance keys
 * used to record in the element's provenance output record which element computed it.
 * @param {fluid.component} that - The pipeline element whose path is to be computed
 * @return {String[]} An array of path segments encoding the pipeline element's relative path
 */
fluid.data.pathWithinPipeline = function (that) {
    var pipeline = fluid.resolveContext("fluid.dataPipeline", that);
    var pipelinePath = fluid.pathForComponent(pipeline);
    var ourPath = fluid.pathForComponent(that);
    var pathWithinPipeline = ourPath.slice(pipelinePath.length);
    return pathWithinPipeline;
};


/** Interprets the result from a `fluid.dataPipe` function by looking up a suitable algorithm from its grade content
 * (currently `fluid.overlayProvenancePipe` and `fluid.selfProvenancePipe` are recognised.
 * @param {ProvenancedTable} result - A (possibly incomplete) provenanced tabular value
 * @param {fluid.dataPipeWrapper} that - The component wrapping the pipe - its `innerType` record will be used to look up
 * a resolution algorithm.
 * @return {ProvenancedTable} A more completely filled out provenanced value
 */
fluid.dataPipeWrapper.interpretPipeResult = function (result, that) {

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

/** Launch the `fluid.dataPipe` function wrapped within a `fluid.dataPipeWrapper` by resolving its input options
 * with respect to the `waitSet` computed by `fluid.dataPipeWrapper.computeWaitSet`, and then interpreting its
 * output into a data provenance record by means of fluid.dataPipeWrapper.interpretPipeResult. This result is then
 * bound to the component's `completionPromise`.
 * @param {fluid.dataPipeWrapper} that - The `fluid.dataPipeWrapper` element to be launched
 */
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
        return fluid.dataPipeWrapper.interpretPipeResult(value, that);
    });
    fluid.promise.follow(promiseTogo, that.completionPromise);
};

/** Convert an `elements` style definition found as the options to a `fluid.dataPipeComponent` into a definitions
 * interpretable as an Infusion subcomponent definition -
 * - `parents` are converted to `gradeNames`
 * - Options are unflattened with all elements other than `type` shifted into `options`
 * - Any primitive `fluid.dataPipe` definitions are housed inside `fluid.dataPipeWrapper` components
 * This is invoked either by top-level `fluid.data.registerPipeline` or by the `fluid.data.mergeElements` promotion algorithm
 * @param {Object} element - `element`-style configuration for the pipeline
 * @param {String} [baseGrade] - [optional] An optional gradeName to be applied to the root of the pipeline definition - usually `fluid.dataPipeline` for
 * standalone top-level definitions
 * @return {Object} The `element` definition in Infusion style
 */
fluid.data.elementToGrade = function (element, baseGrade) {
    var nonCore = fluid.censorKeys(element, ["type", "parents"]);
    var togo = {
        type: element.type,
        options: nonCore
    };
    var gradeNames = fluid.makeArray(element.parents).concat(baseGrade || []);
    togo.options.gradeNames = gradeNames;
    var upDefaults = baseGrade ? fluid.defaults(baseGrade) : fluid.getMergedDefaults(element.type, gradeNames);
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

/** Register a pipeline definition as loaded in from JSON as an Infusion grade definition by converting it via `fluid.data.elementToGrade`.
 * @param {Object} pipeline - The top-level pipeline definition as loaded from JSON
 */
fluid.data.registerPipeline = function (pipeline) {
    var rec = fluid.data.elementToGrade(pipeline, "fluid.dataPipeline");
    console.log("Registering ", rec.options, " under type ", rec.type);
    fluid.defaults(rec.type, rec.options);
};


/**
 * The results of navigation via fluid.data.getPenultimate. An intermediate result of what would be the computation fluid.get(root, segs). The
 * expectation is that, if `pen` is defined, that `pen[last] === root` in the returned values. However note that this algorithm isn't as powerful
 * as the one operated by `fluid.set` and will not create undefined intermediate values on the path to output `root`.
 * @typedef {Object} PenultimateNavigation
 * @property {Object|undefined} pen - The object reached as the immediate parent of the final navigation result
 * @property {Object|undefined} root - The object reached as the final navigation result - as would have been the return from fluid.get(root, segs)
 * @property {String} seg - The final path segment of the supplied path. If pen is defined, pen[seg] === root
 */

// Time-honoured 2008-era function deleted from the framework
// Same return as fluid.model.stepTargetAccess
/** Compute the `penultimate` navigation result by moving through the supplied object with a set of pipe segments. Useful
 * for replacing path-specified entries in JSON structures
 * @param {Object} root - The object to be navigated
 * @param {String[]} segs - The path segments to be navigated through `root`
 * @return {PenultimateNavigation} The results of the navigation, including members `pen`, `root`, `last`
 */
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

/** Do the work of STRUCTURAL PROMOTION for "short" records that are found to the right of
 * of a taller one. So far we have discovered a `fluid.compoundElement` at path `path` and index `currentLayer` and we
 * now scan elements to the right which are not compound in order to upgrade them.
 * @param {Object[]} layers - The unmerged `layers` records found within the `fluid.compoundElement` parent's merging options.
 * **A layer in this structure may be modified through the structural promotion operation **
 * @param {Integer} currentLayer - The layer number at which we found a compound element scanning to the left
 * @param {String[]} path - Array of path segments of the location at which the compound element was found
 */
fluid.data.upgradeElements = function (layers, currentLayer, path) {
    for (var i = currentLayer + 1; i < layers.length; ++i) {
        var thisLayer = layers[i];
        var pen = fluid.data.getPenultimate(thisLayer, path);
        var current = pen.root;
        // Taller than the tallest tree, noone here's as tall as me
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
    // Elements on the left composite on top of elements to the right
    for (var i = 0; i < layers.length; ++i) {
        var layer = layers[i];
        var path = [];
        fluid.each(layer, function (record, key) { // eslint-disable-line no-loop-func
            path.push(key);
            // We've found a compound - check all elements to the left in reverse order to see if they need an upgrade
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

/** Load all the pipeline definitions in a supplied directory into Infusion grade structures
 * @param {String} directory - An Infusion module-qualified directory name from which all directly nested files will be loaded
 */
fluid.data.loadAllPipelines = function (directory) {
    var resolved = fluid.module.resolvePath(directory);
    fs.readdirSync(resolved).forEach(function (filename) {
        var defaults = fluid.data.readJSONSync(resolved + "/" + filename, "Loading pipeline definition");
        fluid.data.registerPipeline(defaults);
    });
};

/** Load a pipeline merging the supplied pipeline grade names --- these must already have been loaded as Infusion defaults.
 * This will construct and return a pipeline component which will begin to load immediately. Completion will be signalled
 * by the top-level member `completionPromise`, yielding any final output `ProvenancedTable`, although it is expected that
 * this will be in practice delivered to some side-effect yielding final pipeline member.
 * @param {String|String[]} types - The pipeline grades to be merged and loaded.
 * @return {fluid.dataPipeline} The instantiated pipeline component
 */
fluid.data.loadPipeline = function (types) {
    var that = fluid.dataPipeline({
        gradeNames: types
    });
    return that;
};


fluid.defaults("fluid.fetchGitCSV", {
    gradeNames: "fluid.selfProvenancePipe"
});

//(from gitOpsApi.js)
/**
 * An object that contains required information for fetching a file.
 * @typedef {Object} FetchRemoteFileOptions
 * @param {String} repoOwner - The repo owner.
 * @param {String} repoName - The repo name.
 * @param {String} [branchName] - The name of the remote branch to operate.
 * @param {String} filePath - The location of the file including the path and the file name.
 */

/** A function fetching a single CSV file from a GitHub repository URL. It will be returned as a barebones
 * `ProvenancedTable` with just a value. The provenance will be assumed to be filled in by the loader, e.g.
 * fluid.dataPipeWrapper
 * @param {FetchRemoteFileOptions} options - An options structure specifying the file to be loaded
 * @return {Promise<ProvenancedTable>} A promise for the loaded CSV structure
 */
fluid.fetchGitCSV = async function (options) {
    var commonOptions = fluid.filterKeys(options, ["repoOwner", "repoName", "filePath", "branchName"]);
    var result = await gitOpsApi.fetchRemoteFile(octokit, commonOptions);
    var parsed = await fluid.resourceLoader.parsers.csv(result.content, {resourceSpec: {}});
    return {
        value: parsed
    };
};

fluid.defaults("fluid.fileOutput", {
    gradeNames: "fluid.dataPipe"
});

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
