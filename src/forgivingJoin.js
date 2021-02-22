/* eslint-env node */

"use strict";

var fluid = require("infusion");
var fs = require("fs"),
    path = require("path");
var simpleGit = require("simple-git");

require("./readJSON.js");
require("./settleStructure.js");

fluid.registerNamespace("fluid.data");

fluid.data.gitUrlToPrefix = function (url) {
    // cf. https://github.com/inclusive-design/data-update-github/blob/main/scripts/fetchODCDataFilesUtils.js#L171
    var pattern = /https:\/\/github.com\/(.*)\/(.*)/;
    console.log(url);
    var matches = pattern.exec(url);
    var user = matches[1];
    var repo = matches[2];
    return "github-" + user + "-" + repo + "/";
};

fluid.data.loadJob = function (filename, workingDir) {
    var resolved = fluid.module.resolvePath(filename);
    var job = fluid.data.readJSONSync(resolved);
    var working = fluid.module.resolvePath(workingDir);
    var git = simpleGit(working);
    var csvPromises = fluid.transform(job.datasets, function (dataset) {
        var prefix = fluid.data.gitUrlToPrefix(dataset.repository);
        console.log("prefix " + prefix);
        var repoPath = path.join(working, prefix);
        console.log("Checking " + repoPath);
        var cloneAction;
        if (fs.existsSync(repoPath)) {
            cloneAction = fluid.promise().resolve();
        } else {
            cloneAction = git.clone(dataset.repository, prefix);
        }
        var togo = fluid.promise();
        cloneAction.then(function () {
            var fullPath = path.join(repoPath, dataset.path);
            var text = fs.readFileSync(fullPath, "utf-8");
            fluid.promise.follow(fluid.resourceLoader.parsers.csv(text, {resourceSpec: {}}), togo);
        });
        return togo;
    });
    var togo = fluid.promise();
    return fluid.promise.map(fluid.settleStructure(csvPromises), function (csvs) {
        fluid.each(csvs, function (onecsv, key) {
            // Less sleazy would be an applyImmutable if we had it - note that this is an interesting case where
            // we can apply an "overlay" structure with one fewer clone if we can see the whole thing up front
            job.datasets[key] = onecsv;
        });
        return job;
    });
    return togo;
};

// Returns hash to true of column members
fluid.data.columnToKeys = function (data, key) {
    var column = fluid.getMembers(data, key);
    return fluid.arrayToHash(column);
};

// Returns hash of keys to hash of true
/** Convert a loaded CSV structure to a hash of its columns to a hash of its value space to true
 * @param {CSV} csv - A loaded CSV structure
 * @return {Object<String, Object<String, true>>} A hash of value spaces
 */
fluid.data.dataToKeys = function (csv) {
    var headerHash = fluid.arrayToHash(csv.headers);
    return fluid.transform(headerHash, function (troo, header) {
        return fluid.data.columnToKeys(csv.data, header);
    });
};

/** Counts the intersection or relative complement of two value space hashes
 * @param {Object<String, true>} leftHash - The left hash to be compared
 * @param {Object<String, true>} rightHash - The right hash to be comapred
 * @param {Boolean} [rightComplement] - If `true`, will count left keys that do not appear in rightHash, that is,
 * the relative complement of leftHash by rightHash, rather than their intersection
 * @return {Object} Members:
 *     {Integer} count - The number of common or disparate keys in the value hashes
 *     {Object<String, true>} - The common or disparate keys
 */
fluid.data.intersect = function (leftHash, rightHash, rightComplement) {
    var count = 0;
    var keys = {};
    var expected = !rightComplement;
    fluid.each(leftHash, function (troo, key) {
        if (!!rightHash[key] === expected) {
            ++count;
            keys[key] = true;
        }
    });
    return {
        count: count,
        keys: keys
    };
};

/** Indexes CSV data by given column name
 * @param {Object[]} data - The data to be indexed
 * @param {String} key - The column name to index by
 * @return {Object<String, Object>} The rows in `data` indexed by the values in column `key`
 */
fluid.data.indexByColumn = function (data, key) {
    var togo = {};
    data.forEach(function (row) {
        togo[row[key]] = row;
    });
    return togo;
};

/** Copies data from a source object into a target object applying a period-separated prefix to each member name
 * @param {Object} target - The object to receive the new properties. *This will be modified by the call*
 * @param {Object} source - The source object from which all properties will be copied
 * @param {String} prefix - The prefix which will be applied to each property name, separated from it by a period.
 */
fluid.data.copyWithPrefix = function (target, source, prefix) {
    fluid.each(source, function (value, key) {
        target[prefix + "." + key] = source[key];
    });
};

/** Undoes the prefixing effect of `fluid.data.copyWithPrefix' and extracts the period-separated prefix from a property name
 * @param {String} prefixedKey - The property name for which the prefix and key is to be extracted
 * @return {Object} A structure containing members:
 *     {String} dataset The prefix in the supplied key
 *     {String} key The suffix in the supplied key
 */
fluid.data.parsePrefixedKey = function (prefixedKey) {
    var dotpos = prefixedKey.indexOf(".");
    return {
        dataset: prefixedKey.substring(0, dotpos),
        key: prefixedKey.substring(dotpos + 1)
    };
};

/** The operation of `fluid.getMembers` but for a structure with two levels of nesting
 * @param {Array|Object} holder - The doubly nested container to be filtered
 * @param {String|String[]} path - An EL path to be fetched from each nested-level member
 * @return {Array|Object} - The desired structure of fetched members
 */
fluid.getMembersDeep = function (holder, path) {
    return fluid.transform(holder, function (oneHolder) {
        return fluid.getMembers(oneHolder, path);
    });
};

fluid.forgivingJoin = function (record, datasets) {
    var left = datasets[record.left];
    var right = datasets[record.right];

    var leftKeys = fluid.data.dataToKeys(left);
    var rightKeys = fluid.data.dataToKeys(right);

    var intersects = [];
    fluid.each(leftKeys, function (leftHash, leftKey) {
        fluid.each(rightKeys, function (rightHash, rightKey) {
            var record = fluid.data.intersect(leftHash, rightHash);
            record.leftKey = leftKey;
            record.rightKey = rightKey;
            intersects.push(record);
        });
    });
    intersects.sort(function (inta, intb) {
        return intb.count - inta.count;
    });
    var best = intersects[0];
    console.log("Best join columns - left : " + record.left + "." + best.leftKey + " and right: " + record.right + "." + best.rightKey + ": count " + best.count);
    var leftHash = leftKeys[best.leftKey];
    console.log("Left complement: " + (Object.keys(leftHash).length - best.count));
    var rightHash = rightKeys[best.rightKey];
    console.log("Right complement: " + (Object.keys(rightHash).length - best.count));

    var leftComplement = Object.keys(fluid.data.intersect(leftHash, best.keys, true).keys);
    var rightComplement = Object.keys(fluid.data.intersect(rightHash, best.keys, true).keys);

    var leftAddition = record.outerLeft ? leftComplement : [];
    console.log((leftAddition.length ? "Retaining " : "Discarding ") + leftComplement.length + " left keys:\n ", leftComplement.join("\n  "));

    var rightAddition = record.outerRight ? rightComplement : [];
    console.log((rightAddition.length ? "Retaining " : "Discarding ") + rightComplement.length + " right keys:\n ", rightComplement.join("\n  "));

    var leftIndex = fluid.data.indexByColumn(left.data, best.leftKey);
    var rightIndex = fluid.data.indexByColumn(right.data, best.rightKey);
    var fullJoin = Object.keys(best.keys).map(function (key) {
        var toadd = {};
        fluid.data.copyWithPrefix(toadd, leftIndex[key], record.left);
        fluid.data.copyWithPrefix(toadd, rightIndex[key], record.right);
        return toadd;
    });
    var parsedOutputColumns = fluid.transform(record.outputColumns, fluid.data.parsePrefixedKey);

    var output = fullJoin.map(function (row) {
        return fluid.transform(record.outputColumns, function (inputColumn, outIndex) {
            return {
                value: row[inputColumn],
                dataset: parsedOutputColumns[outIndex].dataset
            };
        });
    });
    var leftOutput = leftAddition.map(function (leftKey) {
        return fluid.transform(record.outputColumns, function (inputColumn, outIndex) {
            var parsedKey = parsedOutputColumns[outIndex];
            return parsedKey.dataset === record.left ? {
                value: leftIndex[leftKey][parsedKey.key],
                dataset: parsedKey.dataset
            } : {};
        });
    });
    var rightOutput = rightAddition.map(function (rightKey) {
        return fluid.transform(record.outputColumns, function (inputColumn, outIndex) {
            var parsedKey = parsedOutputColumns[outIndex];
            return parsedKey.dataset === record.right ? {
                value: rightIndex[rightKey][parsedKey.key],
                dataset: parsedKey.dataset
            } : {};
        });
    });
    var fullOutput = fluid.flatten([output, leftOutput, rightOutput]);
    var fullOutputValues = fluid.getMembersDeep(fullOutput, ["value"]);
    var fullOutputProvenance = fluid.getMembersDeep(fullOutput, ["dataset"]);

    return {
        output: fullOutputValues,
        provenance: fullOutputProvenance,
        provenanceMap: datasets
    };
};

fluid.fileOutput = function (record, datasets, pipeOutputs) {
    var result = pipeOutputs[record.input];
    fs.mkdirSync(record.path, { recursive: true });

    fluid.data.writeCSV(path.join(record.path, record.output), result.output);
    fluid.data.writeCSV(path.join(record.path, record.provenance), result.provenance);
    fluid.data.writeJSONSync(path.join(record.path, record.provenanceMap), result.provenanceMap);
};

fluid.data.executePipeline = function (job) {
    var pipeOutputs = {};
    fluid.each(job.pipeline, function (onePipe, key) {
        console.log("Applying pipeline element " + onePipe.type + " for key " + key);
        // TODO: Turn dataset input themselves into a pipeline element and turn this into some kind of transform chain
        var result = fluid.invokeGlobalFunction(onePipe.type, [onePipe, job.datasets, pipeOutputs]);
        pipeOutputs[key] = result;
    });
};
