/* eslint-env node */

"use strict";

var fluid = require("infusion");

require("./dataPipeline.js");

fluid.defaults("fluid.dataPipe.filter", {
    gradeNames: "fluid.provenanceDataPipe",
    provenanceMap: {
        func: true
    }
});

// TODO: One day upgrade this to a full Array proxy exposed by TangledMat
/** Given a data package, produce a structure with a "filter" member with the semantics of Array.filter only
 * acting simultaneously on the provenance structure.
 * @param {ProvenancedTable} input - The table structure for which a filter implementation is to be built
 * @return {Object} An object holding a "filter" member with the semantics of Array.filter but acting on the
 * provenanced structure and returning a fresh one.
 */
fluid.dataPipe.makeFilterer = function (input) {
    var filter = function (func) {
        var accepts = input.value.data.map(func);
        return {
            value: {
                data: input.value.data.filter( (value, index) => accepts[index]),
                headers: input.value.headers
            },
            provenance: {
                data: input.provenance.data.filter( (value, index) => accepts[index]),
                headers: input.provenance.headers
            },
            provenanceMap: input.provenanceMap
        };
    };

    return {
        filter: filter
    };
};

fluid.dataPipe.filter = function (options) {
    var filterer = fluid.dataPipe.makeFilterer(options.input);
    var func = typeof(options.func) === "function" ? options.func : fluid.getGlobalValue(options.func);
    return filterer.filter(func);
};
