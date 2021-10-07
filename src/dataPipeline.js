/* eslint-env node */

"use strict";

var fluid = require("infusion");
var fs = require("fs"),
    axios = require("axios"),
    path = require("path");
var octokitCore = require("@octokit/core");

var gitOpsApi = require("git-ops-api");

require("./JSONEncoding.js");
require("./tangledMat.js");

fluid.registerNamespace("fluid.data");
fluid.registerNamespace("fluid.dataPipe");

/**
 * A provenanced CSV value
 * @typedef {Object} ProvenancedTable
 * @property {CSVValue} value - CSV value stored as entries {headers, data}
 * @property {Object<String, String>[]} provenanceMap - Isomorphic to `value.data` - an array of provenance records for each row
 * @property {Object} provenanceMap - A map of provenance strings to records resolving the provenance - either a dataset record or another pipeline record
 */

/** Hierarchy for primitive dataPipes based around simple functions **/

/** Root of the dataPipe function hierarchy. These functions accept a single `options` structure, assembled from the contents
 * of their `options` block by resolving any data references, and return either a ProvenancedTable or a promise yielding one
 */
fluid.defaults("fluid.dataPipe", {
    gradeNames: "fluid.function"
});

// A pipe which outputs a record to an isomorphically named provenance record for its pipeline
fluid.defaults("fluid.provenancePipe", {
    gradeNames: "fluid.dataPipe",
    // A hash of option paths which will be output into the provenance record
    provenanceMap: {
    }
});

// A pipe which sources data in a purely algorithmic way, and so the provenance of any data it writes is taken solely from its own definition
fluid.defaults("fluid.overlayProvenancePipe", {
    gradeNames: "fluid.dataPipe"
});

// A pipe which contributes a simple, uniform provenance record covering all its output - e.g. a file loader
// Currently disused - fluid.fetchGitCSV fills in its own provenance
fluid.defaults("fluid.selfProvenancePipe", {
    gradeNames: "fluid.provenancePipe"
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
    gradeNames: "fluid.compoundElement",
    mergePolicy: {
        require: {
            noexpand: true,
            func: fluid.arrayConcatPolicy
        }
    },
    evaluateRequire: "@expand:fluid.dataPipeline.evaluateRequire({that}.options.require)"
    // require: String|String[] for code to be loaded on startup
});

fluid.dataPipeline.evaluateRequire = function (requires) {
    fluid.each(requires, function (require) {
        fluid.require(require);
    });
    return true;
};

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
 * @param {fluid.component} that - The component representing the element
 * @param {Object} options - The element's "inner" options
 * @param {Object[]} waitSet - The waitSet to be computed. **This is supplied as an empty array and populated by this function**
 * @param {String[]} segs - The array of path segments to the traversed options **This is supplied as an empty array and is modified by this function**
 * @return {Object} The supplied options, with any references to data dependencies censored - this is suitable for use as a provenance record
 */
fluid.data.findWaitSet = function (that, options, waitSet, segs) {
    return fluid.transform(options, function (value, key) {
        var togo;
        segs.push(key);
        // TODO: In future configuration might include "safe" references to non-data - we should resolve the component
        // here and determine whether this really is a data dependency
        if (fluid.isIoCReference(value)) {
            var parsed = fluid.parseContextReference(value);
            parsed.segs = fluid.model.parseEL(parsed.path);
            var isData = parsed.segs[0] === "data";
            if (isData) {
                waitSet.push({
                    ref: value,
                    parsed: parsed,
                    sourceSegs: fluid.copy(segs)
                });
                togo = fluid.NO_VALUE;
            } else {
                togo = fluid.expandImmediate(value, that);
            }
        } else if (fluid.isPlainObject(value)) {
            togo = fluid.data.findWaitSet(that, value, waitSet, segs);
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
 * As a side-effect, this function also computes the `provenanceRecord' member which is assigned as a top-level member
 * of the component - this consists of its `innerOptions` record with all data dependencies censored, and the `innerType`
 * member of `innerOptions` assigned to its member `type` (corresponding to the original `type` member of the pipeline
 * element).
 * @param {fluid.dataPipeWrapper} that - The component for which the waitSet is to be computed
 */
fluid.dataPipeWrapper.computeWaitSet = function (that) {
    var waitSet = [];
    that.provenanceRecord = fluid.data.findWaitSet(that, that.options.innerOptions, waitSet, []);
    // TODO: Naturally we would like to be more accurate about this - we would like to locate where the code sits
    // implementing this grade, and then locate which revision of it was executed
    that.provenanceRecord.type = that.options.innerType;
    that.waitSet = waitSet;
    var waitCompletions = fluid.transform(waitSet, function (oneWait) {
        var resolved = fluid.resolveContext(oneWait.parsed.context, that);
        if (!resolved) {
            fluid.fail("Computing waitSet of " + fluid.dumpComponentAndPath(that) + ": could not resolve context reference {" + oneWait.parsed.context + "} to a component");
        }
        // Special-case this context resolution to, e.g. resolve by priority onto joined.joined, contrary to standard Infusion scoping rules
        if (fluid.isParentComponent(resolved, that)) {
            resolved = resolved[oneWait.parsed.context] || resolved;
        }
        oneWait.target = resolved;
        if (!resolved.completionPromise) {
            fluid.fail("Resolved {" + oneWait.parsed.context + "} to a non dataPipe component");
        }
        return resolved.completionPromise;
    });
    console.log("Component at path " + fluid.pathForComponent(that) + " waiting on set " + fluid.getMembers(waitSet, "parsed.context"));
    // TODO: In theory we could short-circuit some of the work in fluid.dataPipeWrapper.launch by making this a fluid.settleStructure
    var allCompletions = fluid.promise.sequence(waitCompletions);
    allCompletions.then(function () {
        console.log("Wait complete for component at path " + fluid.pathForComponent(that) + " - launching");
        that.events.launchPipe.fire();
    }); // TODO: in the case of a rejection, launch some variant error process that perhaps allows rescuing
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

/** Given the path of a pipe within a pipeline, return a provenance key, by suitably collapsing repeated path
 * segments. Under the terms of open interception, the provenance of a pipe, e.g. at path "ODC.ODC" should simply
 * be "ODC" reflecting the fact that the true provenance of the record was generated at the nested site, and that
 * any consumer of the data and its provenance should be ignorant of whether it was intercepted or not - unless,
 * of course, the interception process itself rewrote some of the data
 * @param {String[]} path - The path of the pipe within its pipeline
 * @return {String} A suitable provenance key, collapsing paths whose segments are identical
 */
fluid.data.getProvenanceKey = function (path) {
    var counts = new Map();
    path.reduce(function (counts, seg) {
        return counts.set(seg, (counts.get(seg) || 0) + 1);
    }, counts);
    if (counts.size === 1) {
        return [...counts.keys()][0];
    } else {
        return path.join(".");
    }
};

/** Interprets the result from a `fluid.dataPipe` function by looking up a suitable algorithm from its grade content
 * (currently `fluid.overlayProvenancePipe` and `fluid.selfProvenancePipe` are recognised.
 * @param {ProvenancedTable} result - A (possibly incomplete) provenanced tabular value **This will be modified by the action of this function**
 * @param {String} provenanceKey - The provenenace key assigned to the pipe
 * @param {Object} options - The argument set to the pipe
 * @param {fluid.dataPipeWrapper} that - The component wrapping the pipe - its `innerType` record will be used to look up
 * a resolution algorithm.
 * @return {ProvenancedTable} A more completely filled out provenanced value
 */
fluid.dataPipeWrapper.interpretPipeResult = function (result, provenanceKey, options, that) {

    var upDefaults = fluid.defaults(that.options.innerType);

    if (fluid.hasGrade(upDefaults, "fluid.overlayProvenancePipe")) {
        var input = options.input;

        var mat = fluid.tangledMat([{
            value: input.value.data,
            provenance: input.provenance.data,
            name: "input"}, {
            value: result.value.data,
            name: provenanceKey
        }], true);
        result.value = {
            data: mat.evaluateFully([]),
            headers: input.value.headers
        };
        result.provenance = {
            data: mat.getProvenance(),
            headers: input.value.headers
        };
        result.provenanceKey = provenanceKey;
        result.provenanceMap = fluid.extend({}, input.provenanceMap, {
            [provenanceKey]: that.provenanceRecord
        });
    } else if (fluid.hasGrade(upDefaults, "fluid.selfProvenancePipe")) {
        result.provenance = provenanceKey; // TODO: Abbreviated provenenance would currently only be interpreted by tangledMap
        result.provenanceMap = {
            [provenanceKey]: that.provenanceRecord
        };
    }
    return result;
};

/** Produce an "isomorphic skeleton" of a deeply structured object, preserving its container structure but omitting
 *  any primitive values at the leaves.
 * @param {Any} tocopy - The value to be copied
 * @return {Any} The skeleton of the copied value
 */
fluid.data.makeSkeleton = function (tocopy) {
    if (fluid.isPrimitive(tocopy)) {
        return fluid.NO_VALUE;
    } else {
        return fluid.transform(tocopy, fluid.data.makeSkeleton);
    }
};

// Implementation note: because of our limitations on asynchrony in the crusty old framework, we have to conflate the idea
// of "a data dependency" with "anything sourced asynchronously". So in the covid-assessment-centres pipeline, we scrape
// a page in order to determine a URL for another pipeline step. This requires the author to stick the url in the "data"
// section of the pipeline's output which then means it is ordinarily not available in the provenance record which is
// computed statically. Naturally the "new framework" will put synchronous and asynchronously available options on the
// same footing.
/** Copy any data-sourced dependencies that are mentioned in the pipe's provenanceMap options into its provenance record.
 * @param {Object} provenanceRecord - The statically computed provenance record for the component **This structure will be modified**
 * @param {Object} upDefaults - The option defaults for the component's "inner type"
 * @param {Object} overlay - The isomorphic structure holding dynamic data-sourced dependencies
 */
fluid.dataPipe.enhanceProvenanceRecord = function (provenanceRecord, upDefaults, overlay) {
    if (fluid.hasGrade(upDefaults, "fluid.provenancePipe")) {
        fluid.each(upDefaults.provenanceMap, function (troo, path) {
            var existing = fluid.get(provenanceRecord, path);
            if (existing === undefined) {
                var dynamic = fluid.get(overlay, path);
                fluid.set(provenanceRecord, path, dynamic);
            }
        });
    }
};

/** Launch the `fluid.dataPipe` function wrapped within a `fluid.dataPipeWrapper` by resolving its input options
 * with respect to the `waitSet` computed by `fluid.dataPipeWrapper.computeWaitSet`, and then interpreting its
 * output into a data provenance record by means of fluid.dataPipeWrapper.interpretPipeResult. This result is then
 * bound to the component's `completionPromise`.
 * @param {fluid.dataPipeWrapper} that - The `fluid.dataPipeWrapper` element to be launched
 */
fluid.dataPipeWrapper.launch = function (that) {
    var overlay = fluid.data.makeSkeleton(that.provenanceRecord);
    fluid.each(that.waitSet, function (oneWait) {
        var fetched = fluid.get(oneWait.target, oneWait.parsed.segs);
        fluid.set(overlay, oneWait.sourceSegs, fetched);
    });
    var provenanceKey = fluid.data.getProvenanceKey(fluid.data.pathWithinPipeline(that));

    var upDefaults = fluid.defaults(that.options.innerType);
    fluid.dataPipe.enhanceProvenanceRecord(that.provenanceRecord, upDefaults, overlay);
    // TODO: Upgrade to an extensible interpretation system
    if (fluid.hasGrade(upDefaults, "fluid.dataPipe.withOctokit")) {
        var octokitComponent = fluid.resolveContext("fluid.octokit", that);
        fluid.set(overlay, "octokit", octokitComponent.octokit);
    }
    var expanded = fluid.extend(true, {}, that.provenanceRecord, overlay);
    expanded.provenanceKey = provenanceKey;
    expanded.provenanceRecord = that.provenanceRecord;
    var result = fluid.invokeGlobalFunction(that.options.innerType, [expanded]);
    var promise = fluid.toPromise(result);
    var promiseTogo = fluid.promise.map(promise, function (value) {
        return fluid.dataPipeWrapper.interpretPipeResult(value, provenanceKey, expanded, that);
    });
    fluid.promise.follow(promiseTogo, that.completionPromise);
};


/** Convert any top-level options definitions in a grade definition into "members" to that they can be referenced
 * as top-level material. This is forward-looking to Infusion 6 where there will no longer be such a silly distinction
 * as "options" vs any other material - see https://issues.fluidproject.org/browse/FLUID-5750 for details of the
 * "options flattening revolution".
 * This function distinguishes between component and `fluid.dataPipe` style pipes by means of the `innerOptions`
 * argument.
 * @param {Object} record - The original options record supplied to the `element`.
 * @param {Boolean} innerOptions - `true` if this is a `fluid.dataPipe` definition and we instead need to promote
 * options from the inner `innerOptions` record within the supplied record rather than its own top-level entries.
 * @return {Object} A set of options suitable to be overlaid onto a {type: ... , options: ... } record
 * for Infusion 1-5 style component construction.
 */
fluid.data.optionsToMembers = function (record, innerOptions) {
    var nonCore = innerOptions ? record.options.innerOptions : fluid.censorKeys(record.options, ["elements", "gradeNames", "require"]);
    var memberOptions = {
        members: fluid.transform(nonCore, function (value, key) {
            return "{that}.options." + (innerOptions ? "innerOptions." : "") + key;
        })
    };
    return fluid.extend(true, {
        options: memberOptions
    }, record);
};

/** Convert an `elements` style definition found as the options to a `fluid.dataPipeComponent` into a definition
 * interpretable as an Infusion subcomponent definition -
 * - `parents` are converted to `gradeNames`
 * - Options are unflattened with all elements other than `type` shifted into `options`
 * - Any non-core options are additionally converted into `members` definitions allowing them to be referenced from the
 * top level of the component
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
        return fluid.data.optionsToMembers(togo, false);
    } else {
        return fluid.data.optionsToMembers({
            type: "fluid.dataPipeWrapper",
            options: {
                innerType: togo.type,
                innerOptions: togo.options
            }
        }, true);
    }
};

/** Register a pipeline definition as loaded in from JSON as an Infusion grade definition by converting it via `fluid.data.elementToGrade`.
 * @param {Object} pipeline - The top-level pipeline definition as loaded from JSON
 */
fluid.dataPipeline.register = function (pipeline) {
    var rec = fluid.data.elementToGrade(pipeline, "fluid.dataPipeline");
    console.log("Registering ", rec.options, " under type ", rec.type);
    fluid.defaults(rec.type, rec.options);
};

/** Load and construct a pipeline merging the supplied pipeline grade names --- these must already have been loaded as Infusion defaults.
 * This will construct and return a pipeline component which will begin to load immediately. Completion will be signalled
 * by the top-level member `completionPromise`, yielding any final output {ProvenancedTable}, although it is expected that
 * this will be in practice delivered to some side-effect yielding final pipeline member.
 * @param {String|String[]} types - The pipeline grades to be merged and loaded.
 * @return {fluid.dataPipeline} The instantiated pipeline component
 */
fluid.dataPipeline.build = function (types) {
    var that = fluid.dataPipeline({
        gradeNames: types
    });
    return that;
};

/** Load a single pipeline definition file into an Infusion grade structures
 * @param {String} filename - An Infusion module-qualified pipeline definition file to be loaded
 */
fluid.dataPipeline.load = function (filename) {
    var resolved = fluid.module.resolvePath(filename);
    var defaults = fluid.data.readJSONSync(resolved, "Loading pipeline definition");
    fluid.dataPipeline.register(defaults);
};

/** Load all the pipeline definitions in a supplied directory into Infusion grade structures
 * @param {String} directory - An Infusion module-qualified directory name from which all directly nested files will be loaded
 */
fluid.dataPipeline.loadAll = function (directory) {
    var resolved = fluid.module.resolvePath(directory);
    fs.readdirSync(resolved).forEach(function (filename) {
        fluid.dataPipeline.load(resolved + "/" + filename);
    });
};

/** Execute a loaded "run configuration" for a particular pipeline run
 * @param {Object} config - The run configuration to be loaded, containing members
 *     {String|String[]} config.loadDirectory - [optional] A directory or list of directories in which all pipeline files are to be loaded
 *     {String|String[]} config.loadPipeline - [optional] One or more filenames of pipeline files to be loaded
 *     {String} config.execPipeline - A single grade name of the pipeline to be executed
 *     {String[]} config.execMergedPipeline - Multiple names of grades of pipeline to be merged together to be executed
 * @return {fluid.dataPipeline} The loaded and running pipeline
 */
fluid.dataPipeline.execRunConfig = function (config) {
    fluid.makeArray(config.loadDirectory).forEach(fluid.dataPipeline.loadAll);
    fluid.makeArray(config.loadPipeline).forEach(fluid.dataPipeline.load);
    var grades = fluid.makeArray(config.execPipeline).concat(config.execMergedPipeline);
    return fluid.dataPipeline.build(grades);
};

/** Execute a "run configuration" from the specified filesystem path
 * @param {String} filename - A potentially module-qualified filename holding a pipeline run configuration as JSON or JSON5
 * @return {fluid.dataPipeline} The loaded and running pipeline
 */
fluid.dataPipeline.execFSRunConfig = function (filename) {
    var resolved = fluid.module.resolvePath(filename);
    var config = fluid.data.readJSONSync(resolved, "Loading pipeline run configuration");
    return fluid.dataPipeline.execRunConfig(config);
};

/** The CLI driver function for running a data pipeline. This interprets the pipeline completion result and converts it
 * to a successful or failed process exit
 * @param {String} filename - A potentially module-qualified filename holding a pipeline run configuration as JSON or JSON5
 * @return {fluid.dataPipeline} The loaded and running pipeline
 */
fluid.dataPipeline.runCLI = function (filename) {
    var pipeline = fluid.dataPipeline.execFSRunConfig(filename);

    pipeline.completionPromise.then(function () {
        console.log("Pipeline executed successfully");
    }, function (err) {
        console.log("Pipeline execution error", err);
        if (!err.softAbort) {
            process.exit(-1);
        }
    });
    return pipeline;
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

/** Do the work of STRUCTURAL PROMOTION for "short" records that are found to the left of
 * of a taller one. So far we have discovered a `fluid.compoundElement` at path `path` and index `currentLayer` and we
 * now scan elements to the right which are not compound in order to upgrade them.
 * @param {Object[]} layers - The unmerged `layers` records found within the `fluid.compoundElement` parent's merging options.
 * **A layer in this structure may be modified through the structural promotion operation **
 * @param {Integer} currentLayer - The layer number at which we found a compound element scanning to the left
 * @param {String[]} path - Array of path segments of the location at which the compound element was found
 */
fluid.data.upgradeElements = function (layers, currentLayer, path) {
    for (var i = currentLayer - 1; i >= 0; --i) {
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
 * @return {Object} A merged hash of element definitions, also converted into standard Infusion grade definitions
 */
fluid.data.mergeElements = function (layers) {
    // Elements on the right composite on top of elements to the left
    for (var i = layers.length - 1; i >= 0; --i) {
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


fluid.data.flatProvenance = function (data, provenanceKey) {
    return fluid.transform(data, function (row) {
        return fluid.transform(row, function () {
            return provenanceKey;
        });
    });
};

fluid.defaults("fluid.octokit", {
    gradeNames: "fluid.component",
    octokitOptions: {
        // auth: String
    },
    members: {
        octokit: "@expand:fluid.makeOctokit({that}, {that}.options.octokitOptions)"
    }
});

fluid.defaults("fluid.dataPipe.withOctokit", {
    gradeNames: "fluid.dataPipe"
});

fluid.makeOctokit = function (that, options) {
    // TODO: Framework bug - because subcomponent records arrive via dynamicComponents total options their options
    // do not get expanded properly.
    var expanded = fluid.expandImmediate(options, that);
    return new octokitCore.Octokit(expanded);
};


/** Assemble a return structure from a data source which is to be considered providing flat provenance - e.g.
 * an external data source such fetch from a URL or unmanaged GitHub repository.
 * @param {String} data - The data value fetched from the source, as a string
 * @param {Object} options - The options structure governing the fetch - this should contain members, as
 * supplied by `fluid.dataPipeWrapper.launch`,
 *    {String} options.provenanceKey - The provenance key computed for this source
 *    {Object} options.provenanceRecord - The provenance record derived from this source's options
 * @param {Object} provenanceExtra - Extra provenance information supplied by the source - e.g. access time or
 * commit info
 * @return {ProvenancedTable} A provenancedTable structure
 */
fluid.flatProvenanceCSVSource = async function (data, options, provenanceExtra) {
    var parsed = await fluid.data.parseCSV(data);
    var provenanceKey = options.provenanceKey;
    return {
        value: parsed,
        provenance: {
            headers: parsed.headers,
            data: fluid.data.flatProvenance(parsed.data, provenanceKey)
        },
        provenanceKey: provenanceKey,
        provenanceMap: {
            [options.provenanceKey]: fluid.extend(true, {}, options.provenanceRecord, provenanceExtra)
        }
    };
};


fluid.defaults("fluid.fetchGitCSV", {
    gradeNames: ["fluid.provenancePipe", "fluid.dataPipe.withOctokit"],
    provenanceMap: {
        repoOwner: true,
        repoName: true,
        filePath: true,
        branchName: true
    }
});

//(from gitOpsApi.js)
/**
 * An object that contains required information for fetching a file.
 * @typedef {Object} FetchRemoteFileOptions
 * @param {String} repoOwner - The repo owner.
 * @param {String} repoName - The repo name.
 * @param {String} [branchName] - The name of the remote branch to operate.
 * @param {String} filePath - The location of the file including the path and the file name.
 * @param {Octokit} octokit - The octokit instance to be used
 */

// TODO: Refactor this as a DataSource + CV decoder + provenance decoder, and produce a dedicated dataSourceDataPipe component
/** A function fetching a single CSV file from a GitHub repository URL. It will be returned as a barebones
 * `ProvenancedTable` with just a value. The provenance will be assumed to be filled in by the loader, e.g.
 * fluid.dataPipeWrapper
 * @param {FetchRemoteFileOptions} options - An options structure specifying the file to be loaded
 * @return {Promise<ProvenancedTable>} A promise for the loaded CSV structure
 */
fluid.fetchGitCSV = async function (options) {
    var commonOptions = fluid.filterKeys(options, ["repoOwner", "repoName", "filePath", "branchName"]);
    var octokit = options.octokit;
    var result = await gitOpsApi.fetchRemoteFile(octokit, commonOptions);
    var commitInfo = await gitOpsApi.getFileLastCommit(octokit, commonOptions);
    return fluid.flatProvenanceCSVSource(result.content, options, {
        commitInfo: commitInfo
    });
};

fluid.defaults("fluid.fetchUrlCSV", {
    gradeNames: "fluid.provenancePipe",
    provenanceMap: {
        url: true
    }
});

// TODO: Similarly turn into DataSource - and resolve our issues with promotion of encoding
fluid.fetchUrlCSV = async function (options) {
    let response = await axios.get(options.url);

    return fluid.flatProvenanceCSVSource(response.data, options, {
        fetchedAt: new Date().toISOString()
    });
};

/** Accepts a structure holding a member `filePath`, and returns a shallow copy of it including additional
 * members encoding relative paths `provenancePath` and `provenanceMapPath` which can be used to store provenenace
 * and provenance map structures respectively.
 * @param {Object} options - An options structure holding `filePath`
 * @return {Object} A shallow copy of `options` including additional members encoding provenance paths
 */
fluid.filePathToProvenancePath = function (options) {
    var filePath = options.filePath;
    var extpos = filePath.lastIndexOf(".");
    return {
        ...options,
        provenancePath: filePath.substring(0, extpos) + "-provenance.csv",
        provenanceMapPath: filePath.substring(0, extpos) + "-provenanceMap.json"
    };
};



/**
 * Representation of a pathed file and its contents (generally on its way to be written, e.g. by gitOpsApi's commitMultipleFiles
 * @typedef {Object} FileEntry
 * @param {String} path - The path of the data to be written
 * @param {String} content - The content of the data to be written
 */

/**
 * An object that contains required information for fetching a file.
 * @typedef {Object} ProvenancedTableWriteOptions
 * @param {String} filePath - The path where the main data value is to be written
 * @param {ProvenancedTable} input - The data to be written
 * @param {Boolean} writeProvenance - `true` if provenance data is to be written alongside the supplied file in the same directory
 */

/** Converts a provenanced table record to data suitable for writing (e.g. either to the filesystem or as a
 *  git commit).
 * @param {ProvenancedTableWriteOptions} options - Options determining the data to be written
 * @param {Function} encoder - A function to encode the supplied data
 * @return {FileEntry[]} files - An array of objects. Each object contains a file information in a structure of
 * [{path: {String}, content: {String}}, ...].
 */
fluid.provenancedDataToWritable = function (options, encoder) {
    var input = options.input;
    var files = [{
        path: options.filePath,
        content: encoder(input.value)
    }];
    if (options.writeProvenance) {
        var provOptions = fluid.filePathToProvenancePath(options);
        files.push({
            path: provOptions.provenancePath,
            content: encoder(input.provenance)
        });
        files.push({
            path: provOptions.provenanceMapPath,
            content: fluid.data.encodeJSON(input.provenanceMap)
        });
    }
    return files;
};

/** Write a set of prepared file entries as files to the filesystem
 * @param {FileEntry[]} entries - File entries to be written
 */
fluid.writeFileEntries = function (entries) {
    entries.forEach(function (entry) {
        var dirName = path.dirname(entry.path);
        fs.mkdirSync(dirName, { recursive: true });
        fs.writeFileSync(entry.path, entry.content);
        console.log("Written " + entry.content.length + " bytes to " + entry.path);
    });
};

fluid.defaults("fluid.csvFileOutput", {
    gradeNames: "fluid.dataPipe"
});

/** A pipeline entry which outputs a provenance record to a grouped set of files
 * @param {ProvenancedTableWriteOptions} options - Options determining the data to be written
 */
fluid.csvFileOutput = function (options) {
    var entries = fluid.provenancedDataToWritable(options, fluid.data.encodeCSV);
    fluid.writeFileEntries(entries);
};

fluid.defaults("fluid.dataPipe.commitMultipleFiles", {
    gradeNames: "fluid.dataPipe.withOctokit"
});

/** Commits multiple files into a github repository as a single commit, applying suitable encoding to the files to be
 * written as well as any post-processing.
 *
 * @param {CommitMultipleFilesOptions} options - The options governing the files to be committed. The FileEntry options can contain
 * extra entries
 *     {String} encoder - Name of a global function encoding an individual file
 *     {String|String[]} convertEntry - Name of a global function contributing further fileEntries to the collection
 * @return {Promise} Promise for success or failure of the operation as returned from gitOpsApi.commitMultipleFiles
 */
fluid.dataPipe.commitMultipleFiles = async function (options) {
    var entries = options.files.map(function (fileOptions) {
        var encoder = fluid.getGlobalValue(fileOptions.encoder);
        var innerEntries = fluid.provenancedDataToWritable(fileOptions, encoder);
        var extras = fluid.transform(fluid.makeArray(fileOptions.convertEntry), function (converterName) {
            var converter = fluid.getGlobalValue(converterName);
            return converter(fileOptions, innerEntries);
        });
        return innerEntries.concat(extras);
    });
    var flatEntries = fluid.flatten(entries);
    return gitOpsApi.commitMultipleFiles(options.octokit, {
        repoOwner: options.repoOwner,
        repoName: options.repoName,
        branchName: options.branchName,
        files: flatEntries,
        commitMessage: options.commitMessage
    });
};


fluid.defaults("fluid.dataPipe.gitFileNotExists", {
    gradeNames: "fluid.dataPipe.withOctokit"
});

/** Converts the existence of a file in a Github repository into a rejection. Useful to abort a pipeline if a
 * particular output exists already.
 * @param {FetchRemoteFileOptions} options - Accepts a structure as for fetchGitCSV determining the coordinates of the file
 * to be checked
 * @return {Promise} A promise which rejects if the file with given coordinates exists already, or if an error occurs.
 * If the file does not exist, the promise will resolve.
 */
fluid.dataPipe.gitFileNotExists = async function (options) {
    var coords = {
        repoOwner: options.repoOwner,
        repoName: options.repoName,
        branchName: options.branchName,
        filePath: options.filePath
    };
    var promise = gitOpsApi.fetchRemoteFile(options.octokit, coords);
    console.log("Checking for existence of file ", coords);
    var togo = fluid.promise();
    promise.then(function (res) {
        if (!res.exists) { // The nonexistence of the file is converted to a resolution which continues the pipeline
            togo.resolve(res);
        } else { // The existence of the file is converted to a rejection which aborts the pipeline
            togo.reject({
                exists: true,
                softAbort: true, // Interpreted by CLI driver to not set process exit error
                message: "File at path " + coords.filePath + " already exists"
            });
        }
    }, function (err) {
        togo.reject(err);
    });
    return togo;
};
