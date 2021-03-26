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
// How can we possibly ensure interop with normal code? We're just going to have to parse it out via an "RSON-like" approach
// Otherwise we'll never know what the path of anything was.

/**
 * A layer structure as stored within a fluid.tangledMat.
 * @typedef {Object} Layer
 * @property {Object|Array} value - The actual object stored in the layer which will be merged into the mat structure
 * @property {String} name - The name of the layer
 * @property {Object|Array} [provenance] - Optional provenance structure, isomorphic to `value` which records Strings at each leaf
 * value representing the leaf's provenance at a fine-grained level. If this member is omitted, the provenance of the entire layer
 * will be assumed to be given by `name`
 */

/** "Constructor" function for fluid.tangledMat. This does not use "new".
 * @param {Layer[]} [layersIn] - Optional array of layers to initialse the mat
 * @param {Boolean} useProxies - If `true`, the mat root dispensed from `mat.getRoot` will be a proxy which activates evaluation of the mat path on evaluation and also
 * permits writing to the writable mat layer configured via `mat.setWritableLayer`
 * @return {fluid.tangledMat} An initialised mat
 */
fluid.tangledMat = function (layersIn, useProxies) {
    var that = { // "Goodbye to All That"
        layers: layersIn || [ // Array of {
            // value: Object|Array
            // name: String
            // [provenance: Object|Array (isomorphic to layer)]
            // }
        ],
        // root: lazily initialised from fluid.tangledMat.getMetadataRoot - since we can't know what its type is without seeing layers
        // Note that the overall root must be [] or {} otherwise we would have nowhere to put the metadata
        writeLayerIndex: -1,
        useProxies: useProxies
    };
    Object.setPrototypeOf(that, fluid.tangledMat);
    return that;
};

// A special symbol used to store nested metadata at any level of the mat - see diagram for use via "$m"
fluid.tangledMat.metadata = Symbol("metadata");

/** Add a new layer into the mat
 * @param {Object|Array} value - The data held in the layer
 * @param {String} layerName - The name of the layer. Will be used as its provenance when computing `getProvenance` unless a dedicated provenance map is supplied
 * @param {Object|Array} [provenance] - optional - a structure isomorphic to "value" encoding the provenance of each leaf value in it
 */
fluid.tangledMat.addLayer = function (value, layerName, provenance) {
    var mat = this;
    mat.layers.push({
        value: value,
        name: layerName,
        provenance: provenance
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
        var cell = mat.topValueCell([]);
        if (!cell) {
            fluid.fail("Attempt to get root for mat which has not configured sufficient layers to define a root");
        }
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
 * @param {Boolean} metadata - If `true`, the function returns a path through the metadata rather than the values
 * @param {Integer} uncess - The number of path segments from the end of `path` to skip evaluating of - this will typically be 0, or
 * 1 (in the case that a write to the path is imminent)
 * @return {Object[]} An array of length `path.length + 1 - uncess` with each object encountered along the path from the root in one element -
 */
fluid.tangledMat.pathFromRoot = function (path, metadata, uncess) {
// cf. role of "uncess" in fluid.model.traverseSimple
    var $m = fluid.tangledMat.metadata,
        mat = this;
    uncess = uncess || 0;
    var root = mat.getMetadataRoot();
    var togo = [metadata ? root : root[$m].value];
    for (var i = 0; i < path.length - uncess; ++i) {
        if (togo[i]) {
            togo[i + 1] = togo[i][path[i]];
        }
    };
    return togo;
};

/** Compute mat top value by searching from right to left at a given path, returns a freshly allocated cell, suitable to be part of "metadata map"
 * @param {String[]} path - Path to be evaluated
 * @return {ValueCell|undefined} Structure describing value found, containing members value, layerIndex, provenance - or undefined
 */
fluid.tangledMat.topValueCell = function (path) {
    var mat = this;
    for (var i = mat.layers.length - 1; i >= 0; --i) {
        var layer = mat.layers[i];
        var value = fluid.getImmediate(layer.value, path);
        if (value !== undefined) {
            return {
                value: value,
                layerIndex: i,
                provenance: (layer.provenance && fluid.isPrimitive(value)) ? fluid.getImmediate(layer.provenance, path) : layer.name
            };
        }
    }
    return undefined;
};

/** Fork all mat top members along the path to `path` from the mat root which have not already been forked. This forking scheme
 * attempts to economise on unnecessary clones, but in order to release full efficiency we also need a "free space map" which avoids
 * recording metadata structures at all for elements which are in an unshared, "free space" portion of the merged object
 * @param {String} path - Array of path segments specifying the mat top element whose ancestors should be forked
 */
fluid.tangledMat.forkToRoot = function (path) {
    var $m = fluid.tangledMat.metadata,
        mat = this;
    var toRoot = mat.pathFromRoot(path, true);
    var forkedValue;
    for (var i = 0; i < toRoot.length; ++i) {
        var metadata = toRoot[i];
        var value = metadata[$m].value;
        if (!metadata[$m].matTop) {
            var freshValue = fluid.freshContainer(value);
            Object.assign(freshValue, value);
            metadata[$m].matTop = true;
            metadata[$m].value = freshValue;
            if (i > 0) {
                forkedValue[path[i - 1]] = freshValue;
            }
            forkedValue = freshValue;
        } else {
            forkedValue = value;
        }
    };
};

fluid.tangledMat.checkConsistency = function () {
    var $m = fluid.tangledMat.metadata,
        mat = this;
    var root = mat.getMetadataRoot();
    var cell = root[$m];
    fluid.each(cell.value, function (subValue, key) {
        var subCell = root[key];
        if (subCell) {
            if (subCell[$m].value !== subValue) {
                fluid.fail("Failure at key ", key, " value from root has ", subValue, " whereas value from subcell has ", subCell[$m].value);
            }
        }
    });
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
        var childCell = mat.topValueCell(longPath);
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
            if (childCell.layerIndex !== holder[$m].layerIndex) {
                mat.forkToRoot(path);
                holder[$m].value[member] = childCell.value;
            }
            mat.checkConsistency();
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

/** Fully evaluate the entire mat and return its provenance structure, which will be isomorphic to the overall mat
 * @return {Object|Array} A fully evaluated provenance map for the entire mat
 */
fluid.tangledMat.getProvenance = function () {
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

/** Evaluate all members found in any mat member at a particular path. This is a transitional, inefficient implementation.
 * @param {String[]} path - An array of path segments representing the element for which the complete set of members should be evaluated
 * @return {Object<String, true>} A map of members found to `true`
 */
fluid.tangledMat.allMembersForPath = function (path) {
    var mat = this;
    var members = {};
    for (var i = mat.layers.length - 1; i >= 0; --i) {
        var layer = mat.layers[i];
        var value = fluid.getImmediate(layer.value, path);
        if (fluid.isPlainObject(value)) {
            fluid.each(value, function (member, key) {
                // TODO: Test case for supplying layer with undefined members
                if (member !== undefined) {
                    members[key] = true;
                }
            });
        }
    }
    return members;
};

/** Fully evaluate the mat top element at the specified path, as well as all its children
 * @param {String[]} path - The path to the element to be evaluated fully
 * @return {Any} The fully evaluated mat value
 */
fluid.tangledMat.evaluateFully = function (path) {
    var $m = fluid.tangledMat.metadata,
        mat = this;
    var move = mat.getMetadataRoot();
    for (var i = 0; i < path.length; ++i) {
        var shortPath = path.substring(0, i);
        move = mat.readMember(shortPath, move, path[i]);
    }
    var evaluate = function (holder, path) {
        var members = mat.allMembersForPath(path);
        fluid.each(members, function (value, key) {
            var childHolder = mat.readMember(path, holder, key);
            if (childHolder[$m]) {
                var longPath = path.concat(key);
                evaluate(childHolder, longPath);
            }
        });
    };
    evaluate(move, path);
    return move[$m].value;
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
                var pathFromRoot = mat.pathFromRoot(path, false, 1);
                var move = layer;
                for (var i = 0; i < path.length - 1; ++i) {
                    var seg = i === 0 ? "layer" : path[i - 1];
                    // Ensure that we make backing containers in the writable layer whose type matches that of the top value
                    move = fluid.tangledMat.ensureContainer(move, seg, pathFromRoot[i]);
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

/** Find the index of a layer with the supplied name, or -1 if no such layer was found
 * @param {String} layerName - The name of the layer to be found
 * @return {Integer} The index of the layer, or -1 if no such layer was configured
 */
fluid.tangledMat.findLayer = function (layerName) {
    var mat = this;
    return mat.layers.findIndex(function (entry) {
        return entry.name === layerName;
    });
};

/** Configures a particular layer of the mat as Writable - this is necessary before any attempts to assign into the
 * mat via the proxy accessor
 * @param {String} layerName - The name of the layer to be made writable
 */
fluid.tangledMat.setWritableLayer = function (layerName) {
    var mat = this;
    var index = mat.findLayer(layerName);
    if (index === -1) {
        fluid.fail("Error making " + layerName + " writable which was not found in this mat - configured layers are ") + fluid.getMembers(mat.layers, "name").join(", ");
    } else {
        mat.writeLayerIndex = index;
    }
};
