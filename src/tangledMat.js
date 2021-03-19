"use strict";

var fluid = require("infusion");

// Unclear whether the variety with proxies is workable for any high-performance requirement.
// See prior art on "membranes" at https://github.com/ajvincent/es-membrane and
// https://tvcutsem.github.io/js-membranes
// Note that equality will not work the way we want wrt. immutability -
// if the proxy "slips" it will still apparently compare equal to the prior version
// Also, if we want large "free space" object to be usable without cloning, we're going to have to embed
// parent object links on them - but of course we can't do these for the primitives at the leaves. We're going
// to have to ensure all access occurs via iterators.
// This is so stuffed - how can we possibly ensure interop with normal code? We're just going to have to parse it out.
// Otherwise we'll never know what the path of anything was.

fluid.tangledMat = function (layersIn, useProxies) {
    var that = { // "Goodbye to All That"
        layers: layersIn || [ // Array of {
            // value: Object|Array
            // name: String
            // [provenanceMap: Object|Array (isomorphic to layer)]
            // }
        ],
        // root: lazily initialised from fluid.tangledMat.getMetadataRoot - since we can't know what its type is without seeing layers
        // Note that the overall root must be [] or {} otherwise we would have nowhere to put the metadata
        writeLayer: null,
        writeLayerIndex: -1,
        useProxies: useProxies
    };
    Object.setPrototypeOf(that, fluid.tangledMat);
    return that;
};

fluid.tangledMat.metadata = Symbol("metadata");

fluid.tangledMat.addLayer = function (value, layerName) {
    var mat = this;
    mat.layers.push({
        value: value,
        name: layerName
    });
};

/** Evaluate the mat root if it has not already been evaluated, and return the metadata root
 * @return {Object|Array} The mat root or proxy to it
 */
fluid.tangledMat.getMetadataRoot = function () {
    var $m = fluid.tangledMat.metadata,
        mat = this;
    var holder = mat.metadataRoot;
    if (!holder) {
        var cell = mat.mergedValueCell([]);
        holder = fluid.freshContainer(cell.value);
        holder[$m] = cell;
        if (mat.useProxies) {
            cell.proxy = mat.makeProxy([], holder);
        }
        mat.metadataRoot = holder;
    }
    return holder;
};

/** Evaluate the mat root if it has not already been evaluated, and return either the "value root" or the proxied root.
 * @return {Object|Array} The mat root or proxy to it
 */
fluid.tangledMat.getRoot = function () {
    var $m = fluid.tangledMat.metadata,
        mat = this;
    var holder = mat.getMetadataRoot();
    var cell = holder[$m];
    return mat.useProxies ? cell.proxy : cell.value;
};

/** Returns an array of all the (currently evaluated) members found from the mat's root object along a given path
 * @param {String[]} path - Path to be evaluated
 * @return {Object[]} A path with the same number of segments as path, containing the objects encountered, with the
 * mat root as the first, and the holder of the final path segment as the last (does not evaluate path[path.length - 1])
 */
fluid.tangledMat.pathToRoot = function (path) {
    var $m = fluid.tangledMat.metadata,
        mat = this;
    var root = mat.getMetadataRoot()[$m].value;
    var togo = [root];
    for (var i = 0; i < path.length - 1; ++i) {
        togo[i + 1] = togo[i][path[i]];
    };
    return togo;
};

/** Compute mat top value by searching from right to left at a given path, returns cell
 * @param {String[]} path - Path to be evaluated
 * @return {ValueCell|undefined} Structure describing value found, containing members value, layerIndex, provenance - or undefined
 */
fluid.tangledMat.mergedValueCell = function (path) {
    var mat = this;
    for (var i = mat.layers.length - 1; i >= 0; --i) {
        var layer = mat.layers[i];
        var value = fluid.getImmediate(layer.value, path);
        if (value !== undefined) {
            return {
                value: value,
                layerIndex: i,
                provenance: layer.provenanceMap && !fluid.isPrimitive(value) ? fluid.getImmediate(layer.provenanceMap, path) : layer.name
            };
        }
    }
    return undefined;
};

/** Read what should be a member value of a "mat top" given the holder of the value, path to it and member name. This is assigned
 * into the structure by either readMember or getRoot
 * @param {String[]} path - Path to the value holding the member to be read
 * @param {Any} holder - Metadata mat top record corresponding to value to be read. This must be a "trunk holder" with a cell at $m
 * @param {String} member - Member name to be read
 * @return {Any|undefined} The read value as a cell containing {value, provenance, layerIndex, [proxy]}
 */
fluid.tangledMat.readMember = function (path, holder, member) {
    var $m = fluid.tangledMat.metadata,
        mat = this;
    var childHolder = holder[member]; // If the mat top already has such a member, it is surely correct
    if (childHolder) {
        return childHolder;
    } else {
        var longPath = path.concat(member);
        var childCell = mat.mergedValueCell(longPath);
        if (childCell) {
            var primitiveValue = fluid.isPrimitive(childCell.value);
            if (primitiveValue) {
                holder[member] = childCell;
            } else {
                holder[member] = fluid.freshContainer(childCell.value);
                holder[member][$m] = childCell;
            }
            if (!primitiveValue && mat.useProxies) {
                childCell.proxy = mat.makeProxy(longPath, holder[member]);
            }
            // NOTE: At this site, we need to fork the mat top if necessary, this will currently overwrite some layer contents if they are shared
            return holder[member];
        } else {
            return undefined;
        }
    }
};


// NOTE: Not this-ist!
fluid.tangledMat.ensureContainer = function (holder, seg, exemplar) {
    if (fluid.typeCode(holder[seg]) !== fluid.typeCode(exemplar)) {
        var newContainer = fluid.freshContainer(exemplar);
        holder[seg] = newContainer;
    }
    return holder[seg];
};

fluid.tangledMat.getProvenanceMap = function () {
    var $m = fluid.tangledMat.metadata,
        mat = this;
    mat.evaluateFully([]);
    var transform = function (metadata) {
        return fluid.transform(metadata, function (member) {
            return member[$m] ? transform(member) : member.provenance;
        });
    };
    return transform(mat.metadataRoot);
};

fluid.tangledMat.getAllMembers = function (path) {
    var mat = this;
    var members = {};
    for (var i = mat.layers.length - 1; i >= 0; --i) {
        var layer = mat.layers[i];
        var value = fluid.getImmediate(layer.value, path);
        if (fluid.isPlainObject(value)) {
            fluid.each(value, function (member, key) {
                members[key] = true;
            });
        }
    }
    return members;
};

fluid.tangledMat.evaluateFully = function (path) {
    var $m = fluid.tangledMat.metadata,
        mat = this;
    var move = mat.getMetadataRoot();
    for (var i = 1; i < path.length; ++i) {
        var shortPath = path.substring(0, i);
        move = mat.readMember(shortPath, move, path[i]);
    }
    var evaluate = function (holder, path) {
        var members = mat.getAllMembers(path);
        fluid.each(members, function (value, key) {
            var childHolder = mat.readMember(path, holder, key);
            if (childHolder[$m]) {
                var longPath = path.concat(key);
                evaluate(childHolder, longPath);
            }
        });
    };
    evaluate(move, path);
};

/** Construct the proxy object to be used when dispensed wrapping a particular mat top path. These will be produced when the
 * `useProxies` argument is set to `true` when constructing the mat.
 * @param {String[]} path - Path segments leading to the value
 * @param {Object|Array} holder - The "holder" of the mat value. This will be isomorphic to the value, and will contain a metadata
 * `cell` at member $m
 * @return {Proxy} A proxy which will force evaluation of the mat members when its properties are read, and write to the
 * writable layer of the mat when they are written
 */
fluid.tangledMat.makeProxy = function (path, holder) {
    var $m = fluid.tangledMat.metadata,
        mat = this;
    var proxy = new Proxy(holder[$m].value, {
        get: function (target, member) {
            var childHolder = mat.readMember(path, holder, member);
            // TODO: eliminate conditionals on every access
            return childHolder ? (childHolder[$m] ? childHolder[$m].proxy : childHolder.value) : undefined;
        },
        set: function (target, member, value) {
            if (!mat.writeLayerIndex === -1) {
                fluid.fail("Cannot write ", value, " to path ", path, " for mat without write layer set");
            } else {
                var layer = mat.layers[mat.writeLayerIndex];
                var pathToRoot = mat.pathToRoot(path);
                var move = layer;
                for (var i = 0; i < path.length - 1; ++i) {
                    var seg = i === 0 ? "layer" : path[i - 1];
                    // Ensure that we make backing containers in the writeable layer whose type matches that of the top value
                    move = fluid.tangledMat.ensureContainer(move, seg, pathToRoot[i]);
                }
                move[member] = value;
                // TODO: Remember to purge any cached mat top value
            }
        },
        ownKeys: function () {
            mat.evaluateFully(path);
            return Reflect.ownKeys(holder[$m].value);
        }
    });
    return proxy;
};

fluid.tangledMat.findLayer = function (layerName) {
    var mat = this;
    return mat.layers.findIndex(function (entry) {
        return entry.name === layerName;
    });
};

fluid.tangledMat.setWriteableLayer = function (layerName) {
    var mat = this;
    var index = mat.findLayer(layerName);
    mat.writeLayer = layerName;
    mat.writeLayerIndex = index;
};
