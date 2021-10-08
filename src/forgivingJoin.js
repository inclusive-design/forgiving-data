/* eslint-env node */

"use strict";

var fluid = require("infusion");

fluid.registerNamespace("fluid.data");

// Returns hash to true of column members
fluid.data.columnToKeys = function (data, key) {
    var column = fluid.getMembers(data, key);
    return fluid.arrayToHash(column);
};

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

fluid.forgivingJoin = function (options) {
    var left = options.left.value;
    var right = options.right.value;

    var leftName = options.left.provenanceKey;
    var rightName = options.right.provenanceKey;

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
    console.log("Best join columns - left : " + leftName + "." + best.leftKey + " and right: " + rightName + "." + best.rightKey + ": count " + best.count);
    var leftHash = leftKeys[best.leftKey];
    console.log("Left complement: " + (Object.keys(leftHash).length - best.count));
    var rightHash = rightKeys[best.rightKey];
    console.log("Right complement: " + (Object.keys(rightHash).length - best.count));

    var leftComplement = Object.keys(fluid.data.intersect(leftHash, best.keys, true).keys);
    var rightComplement = Object.keys(fluid.data.intersect(rightHash, best.keys, true).keys);

    var leftAddition = options.outerLeft ? leftComplement : [];
    console.log((leftAddition.length ? "Retaining " : "Discarding ") + leftComplement.length + " left keys:\n ", leftComplement.join("\n  "));

    var rightAddition = options.outerRight ? rightComplement : [];
    console.log((rightAddition.length ? "Retaining " : "Discarding ") + rightComplement.length + " right keys:\n ", rightComplement.join("\n  "));

    var leftIndex = fluid.data.indexByColumn(left.data, best.leftKey);
    var rightIndex = fluid.data.indexByColumn(right.data, best.rightKey);
    // Assemble the "full join" structure containing all prefixed keys mapped over all rows which are in common (the inner join core)
    var fullJoin = Object.keys(best.keys).map(function (key) {
        var toadd = {};
        fluid.data.copyWithPrefix(toadd, leftIndex[key], leftName);
        fluid.data.copyWithPrefix(toadd, rightIndex[key], rightName);
        return toadd;
    });
    // An array of {dataset, key} for each key demanded in the output column set
    var parsedOutputColumns = fluid.transform(options.outputColumns, fluid.data.parsePrefixedKey);

    // Assemble the core output values from the inner join, by mapping to the final column names the values in "fullJoin"
    var output = fullJoin.map(function (row) {
        return fluid.transform(options.outputColumns, function (inputColumn, outIndex) {
            return {
                value: row[inputColumn],
                // TODO: Copy over here the compound provenance from options.left/right.provenance
                provenance: parsedOutputColumns[outIndex].dataset
            };
        });
    });
    // Add any complement (which may be empty, if `outerLeft` was not set in the join record) consisting of rows present in the left record
    // which don't appear in the join (a "left outer join")
    var leftOutput = leftAddition.map(function (leftKey) {
        return fluid.transform(options.outputColumns, function (inputColumn, outIndex) {
            var parsedKey = parsedOutputColumns[outIndex];
            return parsedKey.dataset === leftName ? {
                value: leftIndex[leftKey][parsedKey.key],
                provenance: parsedKey.dataset
            } : {};
        });
    });
    // Add any complement (which may be empty, if `outerRight` was not set in the join record) consisting of rows present in the left record
    // which don't appear in the join (a "right outer join")
    var rightOutput = rightAddition.map(function (rightKey) {
        return fluid.transform(options.outputColumns, function (inputColumn, outIndex) {
            var parsedKey = parsedOutputColumns[outIndex];
            return parsedKey.dataset === rightName ? {
                value: rightIndex[rightKey][parsedKey.key],
                provenance: parsedKey.dataset
            } : {};
        });
    });
    var fullOutput = fluid.flatten([output, leftOutput, rightOutput]);
    var fullOutputValue = fluid.getMembersDeep(fullOutput, ["value"]);
    var fullOutputProvenance = fluid.getMembersDeep(fullOutput, ["provenance"]);
    var provenanceMap = {
        [leftName]: options.left.provenanceMap[leftName],
        [rightName]: options.right.provenanceMap[rightName]
    };
    var headers = Object.keys(options.outputColumns);

    return {
        value: {
            headers: headers,
            data: fullOutputValue
        },
        joinKeys: {
            left: best.leftKey,
            right: best.rightKey
        },
        provenance: {
            headers: headers,
            data: fullOutputProvenance
        },
        provenanceMap: provenanceMap
    };
};
