/* eslint-env node */

"use strict";

var fluid = require("infusion");
var fs = require("fs"),
    axios = require("axios"),
    path = require("path");
var octokitCore = require("@octokit/core");

var gitOpsApi = require("git-ops-api");

require("./JSONEncoding.js");

/** Produce a flat (constant) provenance given some tabular data - an isomorphic structure filled with the supplied string
 * @param {Object[]} data - The data for which flat provenance is required
 * @param {String} provenanceKey - The provenance key to be given to all of the data
 * @return {String[]} A structure isomorphic to `data` filled with the value in `provenanceKey` in each field
 */
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

// TODO: Rationalise all these pipes by putting them in fluid.dataPipe
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
