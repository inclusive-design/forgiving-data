# forgiving-data

## What is this?

Algorithms for processing and relating data in ways which promote ownership, representation and inclusion,
maintaining rather than effacing provenance. See slide 2 in presentation
[Openly authored data pipelines](https://docs.google.com/presentation/d/12vLg_zWS6uXaHRy8LWQLzfNPBYa1E6L-WWyLqH1iWJ4)
for a recap of [Project WeCount](https://wecount.inclusivedesign.ca/)'s pluralistic data infrastructure goals.

## How to use it?

This is early-stage work. The file [pipelines/WeCount-ODC.json5](jobs/WeCount-ODC.json5) contains a very simple three-element
data pipeline which loads two CSV files from git repositories to use as inputs for a "forgiving data merge".
Merged outputs together with provenance information linking back to the source data will be written
into directory `dataOutput` by means of the overlay pipe [pipelines/WeCount-ODC-fileOutput.json5](jobs/WeCount-ODC-fileOutput.json5).
Pipeline [pipelines/WeCount-ODC-synthetic.json5](jobs/WeCount-ODC-synthetic.json5) interposes into these pipelines via
an open composition process to interpolate synthetic accessibility data into the joined dataset, whilst recording
into the provenance file that this data is synthetic &mdash; any genuine data resulting from the join is preserved,
along with noting its provenance as genuine.

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
    type {String} The name of the overall pipeline - a grade name
    parents {String|String[]} Any parent pipelines that this pipeline should be composited together with
     
    elements: { // Free hash of pipeline elements, where each element contains fields
        <element-key>: {
            type: <String - global function name>
            parents: <String|String[] - parent element grades>
            <other type-dependent properties>
        }
    }
}
````

An example pipeline can be seen at [WeCount-ODC.json5](./demos/pipelines/WeCount-ODC.json5).

#### Data handled by pipeline elements

Simple pipeline elements are JavaScript functions registered in the global Infusion namespace. These functions accept
and return tabular data as records of the following triple, of type `ProvenancedTable`:

````text
    {
        value: <Array of CSV row values, as loaded from the dataset, with each row as a hash>
        provenance: <Isomorphic to value, with a provenance string for each data value - as per tangled mat's provenance> 
        provenanceMap: <A map of provenance strings to records resolving the provenance - usually an element's options minus its data references>
    }
````

#### Referring to data produced from other pipeline elements

Elements may refer to the data output by other pipelines by referring to them with Infusion-style context-qualified
references in their options - e.g.

````text
    joined: {
        type: "fluid.forgivingJoin",
        left: "{WeCount}.data",
        right: "{ODC}.data",
...
````

refers to the data output by two other elements in the pipeline named `WeCount` and `ODC`. Note that these references
do not perfectly follow Infusion's (1.x-4.x) established scoping rules, since they will prioritise siblings over parents.
See slide 16 of presentation https://docs.google.com/presentation/d/12vLg_zWS6uXaHRy8LWQLzfNPBYa1E6L-WWyLqH1iWJ4 for
details.

#### Available pipeline elements

Pipeline elements available include:

##### fluid.fetchGitCSV

Loads a single CSV file from a GitHub repository given its coordinates in an options structure. These are encoded in
its options as follows:

````text
 {String} repoOwner - The repo owner.
 {String} repoName - The repo name.
 {String} [branchName] - [optional] The name of the remote branch to operate.
 {String} filePath - The location of the file including the path and the file name.
````

For example,

````text
    WeCount: {
        type: "fluid.fetchGitCSV",
        repoOwner: "inclusive-design",
        repoName: "covid-assessment-centres",
        filePath: "WeCount/assessment_centre_data_collection_2020_09_02.csv"
    }
````

##### fluid.forgivingJoin

Executes an [inner](https://en.wikipedia.org/wiki/Join_(SQL)#Inner_join) or
[outer join](https://en.wikipedia.org/wiki/Join_(SQL)#Outer_join) given two CSV structures.

This join chooses a single best pair of columns to join on based on a simple
value space intersection performed over all pairs of columns in the provided tables.
An improvement to this algorithm, with increased computational cost, would be
able to select a compound column for the join, as well as providing a ranked
list of choices rather than just a single best choice - these improvements
are ticketed at [DATA-1](https://issues.fluidproject.org/browse/DATA-1).

Accepts options:

````text
    {ProvenancedTableReference} left - The left dataset to join
    {ProvenancedTableReference} right - The right dataset to join
    {Boolean} [outerLeft] - [optional] If `true`, a left outer join will be executed
    {Boolean} [outerRight] - [optional] If `true`, a right outer join will be executed
    {Object} outputColumns - A map of columns to be output in terms of the input columns. The keys of this map record
the names of the columns to be output, and the corresponding values record the corresponding input column, in a two-part
period-qualified format - before the period comes the provenance name of the relevant dataset, and after the period
comes the column name in that dataset 
````

For example:

````text
    joined: {
        type: "fluid.forgivingJoin",
        left: "{WeCount}.data",
        right: "{ODC}.data",
        outerRight: true,
        outputColumns: {
            location_name: "ODC.location_name",
            city:          "ODC.city",
            "Individual Service":   "WeCount.Personalized or individual service is offered",
            "Wait Accommodations":  "WeCount.Queue accommodations"
        }
    }
````

##### fluid.fileOutput

Outputs CSV and provenance data to CSV and JSON files -

Accepts options:

````text
    {ProvenancedTableReference} input - The data to be written
    {String} path - holding the directory where the files are to be written
    {String} `value` holding the filename within `path` where the data is to be written as CSV
    {String} `provenance` holding the filename within `path` where the provenance data is to be written as CSV
    {String} `provenenceMap` holding the filename within `path` where the map of provenance strings to records is to be written as JSON
````

For example:

````text
    output: {
        type: "fluid.fileOutput",
        input: "{joined}.data",
        path: "outputData",
        value: "output.csv",
        provenance: "provenance.csv",
        provenanceMap: "provenanceMap.json"
    }
````

#### Pipeline element provenance marker grades

There are currently two marker grades which can be applied to these elements, configuring the strategy to be used for
intepreting the provenance of data produced by the element. If one of these is not supplied, the element is assumed
to fully fill out the `provenance` and `provenanceMap` return values by itself (as does `fluid.forgivingJoin`):

##### fluid.overlayProvenancePipe

A pipeline element implementing this grade does not fill in its `provenance` or `provenanceMap` elements in its return
value - instead it returns a partial data overlay of CSV values it wishes to edit in `values`, and the pipeline performs
the merge, resolves the resulting provenance, and adds a fresh record into `provenanceMap` indicating that the pipeline
element sourced the data from itself.

There is a sample pipeline element `fluid.covidMap.inventAccessibilityData` implementing `fluid.overlayProvenancePipe` that
synthesizes accessibility data as part of the sample `driver.js` pipeline.

##### fluid.selfProvenancePipe

A simpler variety of element for which the pipeline synthesizes provenance, that assumes that all values produced by the
pipeline have the same provenance (the element itself). This is suitable, for example, for elements which load data from
some persistent source which has not itself encoded any provenance information (e.g. a bare CSV file).

The builtin element `fluid.fetchGitCSV` is of this kind.

#### Loading and running the pipeline

The pipeline structure is loaded by using `fluid.data.loadAllPipelines` and then executed via `fluid.data.loadPipeline`
as per the sample in `driver.js` - e.g.

````javascript
fluid.data.loadAllPipelines("%forgiving-data/pipelines");

var pipeline = fluid.data.loadPipeline(["fluid.pipelines.WeCount-ODC-synthetic", "fluid.pipelines.WeCount-ODC-fileOutput"]);

pipeline.completionPromise.then(function (result) {
    console.log("Pipeline executed successfully");
}, function (err) {
    console.log("Pipeline execution error", err);
});

````
