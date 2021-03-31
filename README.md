# forgiving-data

## What is this?

Algorithms for processing and relating data in ways which promote ownership, representation and inclusion,
maintaining rather than effacing provenance.

## How to use it?

This is very early-stage work. The file [jobs/WeCount-ODC.json5](jobs/WeCount-ODC.json5) contains a very simple three-element
data pipeline which will check out git repositories to use as inputs for a "forgiving data merge".
Merged outputs together with provenance information linking back to the source data will be written
into directory `dataOutput`.

Run the sample pipeline by running

    node driver.js

## What does it contain?

This package contains two primary engines - firstly, the "tangled mat" structure which is used to track the provenance
in overlaid data structures, and secondly the data pipeline which orchestrates tasks consuming and producing CSV files
also tracking provenance.

There is also a sample pipeline consuming data from [covid-assessment-centres](https://github.com/inclusive-design/covid-assessment-centres),
performing an outer right join, and synthesizing accessibility data suitable for visualisation with
[covid-data-monitor](https://github.com/inclusive-design/covid-data-monitor).

### The tangled mat

The basic operation of the tangled mat is illustrated in diagram [Tangled Mat](https://docs.google.com/drawings/d/1OIT6zN0jwwuyt4ZmFeA-eWJiFEert8uM2zLtReqkve0/edit).
Several layers of arbitrary JSON shape may be combined, with a resulting structure which is the result of a deep merge
as if they had been combined using

    jQuery/fluid.merge(true, []/{}, layer1, layer2 ...)

With the difference that

1. The merging is performed in a lazy manner - a result in the merged structure is only evaluated at the point it is
demanded,
2. The provenance of each final object in the merged structure is available in a "provenance map" which is isomorphic
to the merged value, recording which layer each resulting leaf value was drawn from
3. As with traditional merge, the arguments are not modified - however, in the case where a portion of the mat is
"uncontested" (drawn from a single argument), the argument will not be cloned, and treated as immutable by producer
and consumer

The primary API of the mat consists of its creator function `fluid.tangledMat`, and methods `addLayer`, `getRoot`,
`readMember`, `getProvenance`, `evaluateFully` and `setWritableLayer` - see JSDocs. An example session interacting with the
mat mirroring the example drawing:

````javascript
var mat = fluid.tangledMat([{
    value: {
        a: 1
    },
    name: "Layer1"
}, {
    value: {
        b: 2
    },
    name: "Layer2"
}]);

mat.addLayer(
    {
        c: {
            d: 4
        }
    }, "Layer3"
);

var provenanceMap = mat.getProvenance();
// returns {
//     a: "Layer1",
//     b: "Layer2",
//     c: {
//        d: "Layer3"
//     }
// }
````

#### Forward-looking notes on the "Tangled Mat"

The implementation here is of a basic quality which is sufficient for operating on modest amounts of tabular data
in pipelines as seen here. However, this provenance-tracking structure will be the basis of the reimplementation
of Infusion (probably as "Infusion 5") of which the signature feature is the "Infusion Compiler" loosely written up
as [FLUID-5304](https://issues.fluidproject.org/browse/FLUID-5304). The key architecture will be that each grade
definition ends up as a mat layer, which will then appear in multiple mats, one mat for each co-occurring set of
grade definitions (and/or distributions). These mats will be then indexed in a
[Trie](https://en.wikipedia.org/wiki/Trie)-like structure allowing for quick lookup of partially evaluated merged
structures.

Key improvements that are required to bring this implementation to the quality needed for FLUID-5304:

* Ability to store mats with primitive elements at the root, or otherwise to more clearly distinguish where
"mutable roots" occur in the structure (in terms of current semantics, where there "is a component", but in future these
will be far smaller, lightweight structures)
* Ability to chain evaluation of nested mats and their provenance structures (improvement of current
"compound provenance" model)
* Ability to invalidate previously evaluated parts of mats when their constituents change
* Ability to register "change listeners" responsive to changes of parts of mat structure, which are themselves encoded
as mat contents, and can also specify their semantics for evaluation (that is, whether they require full evaluation as in
[FLUID-5891](https://issues.fluidproject.org/browse/FLUID-5981)
* Where a region of the mat is "uncontested" (see above), no metadata entry will be allocated in the mat top. This
implies that all access will be made through iterators which are capable of tracking which was the last visited part of
the mat top before we fell off it.

### The data pipeline

The pipeline is configured by a JSON5 structure with top-level elements

````text
{
    type {String} The name of the overall pipeline (will eventually become a grade name of some sort) 
     
    datasets: { // Free hash of dataset structures each with elements
        sourceType: "git", (currently the only supported type)
        repository: <git repository URL, e.g. "https://github.com/inclusive-design/covid-assessment-centres">
        path: <String path within the repository, e.g. "WeCount/assessment_centre_data_collection_2020_09_02.csv">
    },

    pipeline: { // Free hash of pipeline elements with elements
        type: <String - global function name>
        <other type-dependent properties>
    }
}
````

An example pipeline can be seen at [WeCount-ODC.json5](./jobs/WeCount-ODC.json5).

Pipeline elements available include

#### fluid.forgivingJoin

Executes an [inner](https://en.wikipedia.org/wiki/Join_(SQL)#Inner_join) or
[outer join](https://en.wikipedia.org/wiki/Join_(SQL)#Outer_join) given two CSV structures

#### fluid.fileOutput

Outputs CSV and provenance data to CSV and JSON files - this is a `fluid.simpleInputPipe` as below

Pipeline elements are simply functions registered in the global Infusion namespace. These functions accept and return
tabular data as records of the following triple, of type `ProvenancedTable`:

````text
    {
        value: <Array of CSV row values, as loaded from the dataset, with each row as a hash>
        provenance: <Isomorphic to value, with a provenance string for each data value - as per tangled mat's provenance> 
        provenanceMap: <A map of provenance strings to records resolving the provenance - either a dataset record or another pipeline record>
    }
````

There are currently two signature grades recognised for these elements:

#### fluid.simpleInputPipe

The function accepts a signature (record, input) where `record` is the pipeline's configuration record, and `input`
is resolved from the record's member `input` by indirecting it into `datasets`. In addition, the special input value
`_` is recognised, which refers to the output of the previous pipeline element.

#### fluid.selfProvenancePipe

A pipeline element implementing this grade does not fill in its `provenance` or `provenanceMap` elements in its return
value - instead it returns a partial data overlay of CSV values it wishes to edit in `values`, and the pipeline performs
the merge, resolves the resulting provenance, and adds a fresh record into `provenanceMap` indicating that the pipeline
element sourced the data from itself.

There is a sample pipeline element `fluid.covidMap.inventAccessibilityData` implementing `fluid.selfProvenancePipe` that
synthesizes accessibility data as part of the sample `driver.js` pipeline.

#### Loading and running the pipeline

The pipeline structure is loaded by using `fluid.data.loadJob` and then executed via `fluid.executeJob` as per the
sample in `driver.js` - e.g.

````javascript
var job = fluid.data.loadJob("%forgiving-data/jobs/WeCount-ODC.json5", "%forgiving-data/data");

job.then(function (result) {
    console.log("Data loaded successfully");
    fluid.data.executePipeline(result);
}, function (err) {
    console.log("Data loading error", err);
});
````
