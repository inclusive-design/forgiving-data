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

    node demoDriver.js

## What does it contain?

This package contains two primary engines - firstly, the "tangled mat" structure which is used to track the provenance
in overlaid data structures, and secondly the data pipeline which orchestrates tasks consuming and producing CSV files
also tracking provenance.

There is also a sample pipeline consuming data from [covid-assessment-centres](https://github.com/inclusive-design/covid-assessment-centres),
performing an outer right join, and synthesizing accessibility data suitable for visualisation with
[covid-data-monitor](https://github.com/inclusive-design/covid-data-monitor).

Since it is the most directly usable work, the data pipeline system is described first.

### The data pipeline

A data pipeline schedules a free graph of activities, starting from sources of data which may consist of, e.g. HTTP
or GitHub fetches, transformations and syntheses of this data and then finally writing it to sinks. This is
broadly consistent with the industry-standard [ETL](https://en.wikipedia.org/wiki/Extract,_transform,_load)
(Extract, transform, load) pattern of activity, but our implementation in the pluralistic data infrastructure, rather
than being optimised for a large bulk of homogeneous data processed by a scalable infrastructure, is more tuned
towards diverse, heterogeneous data derived from a variety of different kinds of sources, which require whole-dataset
synthesis and transformation, as well as tracking the provenance of data as it passes through the pipeline on a
cell-by-cell basis. This provenance is written to the data sinks as "companion structures" (currently as CSV,
also the primary format in which data is accepted into the system) alongside the output data.

The pipeline is configured by a JSON5 structure with top-level elements

````text
{
    type: {String} The name of the overall pipeline - a grade name
    parents: {String|String[]} Any parent pipelines that this pipeline should be composited together with
    require: {String|String[]} Any module-qualified references to files holding JavaScript code that should be loaded
     
    elements: { // Free hash of pipeline elements, where each element contains fields
        <element-key>: {
            type: <String - global function name>
            parents: <String|String[] - parent element grades>
            <other type-dependent properties>
        }
    }
}
````

The name [grade](https://docs.fluidproject.org/infusion/development/componentgrades) refers to a construct from Fluid's
[Infusion](https://docs.fluidproject.org/infusion/development/) framework in which the pipeline is implemented, but
this isn't a detail relevant to most users. A grade can be thought of as a block of JSON configuration with a
global name, which can be merged together with other similar configuration blocks.

An example pipeline can be seen at [WeCount-ODC.json5](./demos/pipelines/WeCount-ODC.json5).

#### Data handled by pipeline elements

Simple pipeline elements are JavaScript functions registered in the global Infusion namespace. These functions accept
and return tabular data as records of the following triple, of type `ProvenancedTable`:

````text
{
    value: {CSVValue} The data value itself
    provenance: {CSVValue} Isomorphic to `value`, with a provenance string for each data value
    provenanceMap: {Object} A map of provenance strings to records resolving the provenance - derived from an
                            element's options minus its data references, plus any runtime data such as datestamps or
                            commit hashes identifying the particular fetch of the data
}
````

A `CSVValue` takes the following structure:

````text
{
    headers: {String[]} An array of strings forming the CSV file's headers
    data: {Object[]} CSV data as an array, with each row represented by a hash of header names to cell contents
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
do not perfectly follow Infusion's (1.x-5.x) established scoping rules, since they will prioritise siblings over parents.
See slide 16 of presentation https://docs.google.com/presentation/d/12vLg_zWS6uXaHRy8LWQLzfNPBYa1E6L-WWyLqH1iWJ4 for
details.

You can also refer to any of the options configured into another pipeline element by referring to its definition in the
same context-qualified way.

#### Available pipeline elements

Pipeline elements available include:

##### fluid.fetchGitCSV

Loads a single CSV file from a GitHub repository given its coordinates in an options structure. These are encoded in
its options as follows:

````text
{
    repoOwner: {String} The repo owner.
    repoName: {String} The repo name.
    [branchName]: {String} [optional] The name of the remote branch to operate.
    filePath: {String} The location of the file including the path and the file name.
    octokit: {fluid.octokit} The octokit instance holding GitHub credentials - the user does not need to supply
        this option, it is filled in automatically by the pipeline
}
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

The top-level member `data` of this element will resolve to the loaded `ProvenancedTable` referenced by its GitHub coordinates.
The provenance key will be derived from the element's name in the pipeline, and the provenance structure will be
filled in from the GitHub commit info.

##### fluid.fetchUrlCSV

Loads a single CSV file from an HTTP or HTTPS URL. Currently only one option is accepted:

````text
{
    url: {String} The URL from which the CSV file is to be fetched
}
````

For example,

````text
    ODC: {
        type: "fluid.fetchUrlCSV",
        url: "{ODCCoordinates}.data.downloadURL"
    }
````

The top-level member `data` of this element will resolve to the loaded `ProvenancedTable` referenced by the URL.
The provenance key will be derived from the element's name in the pipeline, and the provenance structure will be
filled in from the URL and its access time.

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
    left: {ProvenancedTable} The left dataset to join
    right: {ProvenancedTable} The right dataset to join
    outerLeft: {Boolean} [optional] If `true`, a left outer join will be executed
    outerRight: {Boolean} [optional] If `true`, a right outer join will be executed
    outputColumns: {Object} A map of columns to be output in terms of the input columns. The keys of this map record
                   the names of the columns to be output, and the corresponding values record the corresponding input
                   column, in a two-part period-qualified format - before the period comes the provenance name of the
                   relevant dataset, and after the period comes the column name in that dataset 
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

##### fluid.csvFileOutput

Outputs CSV and provenance data to CSV and JSON files -

Accepts options:

````text
    input: {ProvenancedTable} The data to be written
    filePath: {String} The filename of the data to be written
    writeProvenance: {Boolean} [optional] - If `true`, companion files will be written alongside `filePath` with
        related names, writing the provenance and provenance map structures held in the data 
````

For example:

````text
    output: {
        type: "fluid.csvFileOutput",
        input: "{joined}.data",
        filePath: "outputData/output.csv",
        writeProvenance: true
    }
````

##### fluid.dataPipe.commitMultipleFiles

Outputs a collection of CSV and provenance data as a single git commit to a GitHub repository for which suitable credentials
has been supplied (see the next section).

Accepts options:

````text
    repoOwner: {String} The repository owner.
    repoName: {String} The repository name.
    branchName: {String} [optional] The name of the remote branch to operate.
    commitMessage: {String} The message to be attached to the GitHub commit
    files: {TransformableFileEntry[]} An array of files to be written  
    octokit: {fluid.octokit} The octokit instance holding GitHub credentials - this option is supplied automatically 
                       by the pipeline
````

A `TransformableFileEntry` structure holds the following:

````text
    filePath: {String} The path of the file within its repository 
    writeProvenance: {Boolean} [optional] If `true`, additional files will be written adjacent to the file encoding
                     its provenance
    encoder: {String} The name of a function which will encode the file's contents.
             Currently this should be "fluid.data.encodeCSV"
    convertEntry: {String|String[]} [optional] The name of one or more functions accepting this `FileEntry`
                  structure and returning one or more others representing additional data to be written
    input: {ProvenancedTable} The data to be written
````

#### Working with GitHub credentials

Requests to GitHub's HTTP API are operated via GitHub's standard [Octokit](https://github.com/octokit) library. An
instance of this library is created automatically by any pipeline which derives from the grade `fluid.pipelines.withOctokit`,
which accepts a GitHub authentication token from an environment variable named GITHUB_TOKEN.

A suitable token may be generated via the instructions at [the Github documentation](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token).
You need only tick the `public_repo` permission when generating this.

Alternatively, you can configure an Octokit instance without authentication using the grade `fluid.pipelines.withUnauthOctokit`.
This is suitable for lightweight local testing but note that GitHub will limit the use of such requests to 60 per hour
as described at [Resources in the REST API](https://docs.github.com/en/rest/overview/resources-in-the-rest-api).

Either of `fluid.pipelines.withOctokit` or `fluid.pipelines.withUnauthOctokit` will construct a `{fluid.octokit}`
instance in the pipeline that can be resolved by pipeline elements such as `fluid.fetchGitCSV`,
`fluid.dataPipe.commitMultipleFiles`, etc.

#### Running a pipeline using a run configuration

The library supports a simple JSON structure which allows for the encoding of a particular pipeline run - that is,
which pipelines should be loaded and merged together. This can then be executed using the library's CLI driver named
`runFluidPipeline` by giving it this file as an argument. A run configuration has the following structure:

````text
{
    loadDirectory: {String|String[]} [optional] - One or an array of module-qualified names of directories in which
                                     all files are to be loaded as pipelines
    loadPipeline: {String|String[]} [optional] One or an array of module-qualified names of individual pipeline
    execPipeline: {String} A single pipeline grade names, loaded by the above directives, which will be executed
    execMergedPipeline: {String[]} Multiple pipeline grade names which will be merged together and executed
````

For example, the embedded demo driver at [demoDriver](../demo/runDemo.json5) looks as follows:

````text
{ // Run configuration file for demonstration pipeline
  // Can be run directly from command line via runFluidPipeline %forgiving-data/runDemo.json5
    loadDirectory: "%forgiving-data/demo/pipelines",
    execMergedPipeline: ["fluid.pipelines.WeCount-ODC-synthetic", "fluid.pipelines.WeCount-ODC-fileOutput"]
}
````

Here are some possible ways of running this run configuration:

##### As an npm script of a module for which `forgiving-data` is a dependency

````text
    "scripts": {
        "runFluidPipeline": "runFluidPipeline %forgiving-data/demo/runDemo.json5",
    }
````

From the hosting module you can then run

    npm run runFluidPipeline

##### If forgiving-data is installed as a global module using npm install -g forgiving-data

    runFluidPipeline %forgiving-data/demo/runDemo.json5

##### Via a local npm script as provided in this module

````text
    "scripts": {
        "runFluidPipeline": "node src/cli.js"
    }
````

From this module you can then run

    npm run runFluidPipeline -- %forgiving-data/demo/runDemo.json5

Note that module-qualified references such as `%forgiving-data/runDemo.json5` are described in the Infusion API
page on [fluid.module.resolvePath](https://docs.fluidproject.org/infusion/development/nodeapi#fluidmoduleresolvepathpath).

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
synthesizes accessibility data as part of the sample `demoDriver.js` pipeline.

##### fluid.selfProvenancePipe

A simpler variety of element for which the pipeline synthesizes provenance, that assumes that all values produced by the
pipeline have the same provenance (the element itself). This is suitable, for example, for elements which load data from
some persistent source which has not itself encoded any provenance information (e.g. a bare CSV file).

The builtin element `fluid.fetchGitCSV` is of this kind.

#### Loading and running the pipeline via a "run configuration"

The pipeline system supports a minimal JSON/JSON5 format representing a run configuration of a pipeline, as described
in the [section above](#running-a-pipeline-using-a-run-configuration).

A run of the demo pipeline is encoded by file [runDemo.json5](./demo/runDemo.json5), and can be executed by either
a function call `fluid.dataPipeline.runCLI("%forgiving-data/demo/runDemo.json5")` as seen in the demo driver, or else
at the command line via

    runFluidPipeline %forgiving-data/demo/runDemo.json5

if this package is installed as a local dependency.

#### Loading and running the pipeline manually

The pipeline structure is loaded by using `fluid.dataPipeline.loadAll` and then executed via `fluid.dataPipeline.build`
as per the sample in [demoDriver.js](./demoDriver.js) - e.g.

````javascript
fluid.dataPipeline.loadAll("%forgiving-data/pipelines");

var pipeline = fluid.dataPipeline.build(["fluid.pipelines.WeCount-ODC-synthetic", "fluid.pipelines.WeCount-ODC-fileOutput"]);

pipeline.completionPromise.then(function (result) {
    console.log("Pipeline executed successfully");
}, function (err) {
    console.log("Pipeline execution error", err);
});

````

### The tangled mat

The tangled mat is a low-level implementation structure used in the data pipeline's provenance system. It helps the work
of keeping track of provenance changes to data structures as they are operated in code.

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
