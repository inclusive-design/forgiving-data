"use strict";

var fluid = require("infusion");

fluid.registerNamespace("fluid.tangledMat");

fluid.tangledMat = function () {
    var that = {
        layers: [ // Array of {
            // layer: Object|Array
            // name: String
        ],
        // Every "top" object wraps a target (which is the proxy target) and its path
        top: {
            target: null,
            path: []
        },
        writeLayer: null,
        writeLayerIndex: -1
    };
    return that;
};

fluid.tangledMat.addLayer = function (mat, layer, layerName) {
    mat.layers.push({
        layer: layer,
        name: layerName
    });
};

fluid.tangledMat.getRoot = function (mat) {
    if (!mat.root) {
        var target = fluid.tangledMat.topValue(mat, []);
        mat.root = fluid.tangledMat.makeProxy(mat, [], target);
    }
    return mat.root;
};

fluid.tangledMat.pathToRoot = function (mat, path) {
    var root = fluid.tangledMat.getRoot(mat);
    var togo = [root];
    for (var i = 0; i < path.length - 1; ++i) {
        togo[i] = togo[i - 1][path[i]];
    };
    return togo;
};

fluid.tangledMat.topValue = function (mat, path) {
    for (var i = mat.layers.length - 1; i >= 0; --i) {
        var value = fluid.getImmediate(mat.layers[i].layer, path);
        if (value !== undefined) {
            return {
                value: value,
                layerIndex: i,
                layerName: mat.layers[i].name
            };
        }
    }
    return undefined;
};

fluid.tangledMat.readMember = function (mat, path, holder, member) {
    var cached = holder[member];
    if (cached) {
        return cached;
    } else {
        var longPath = path.concat(member);
        var cache = fluid.tangledMat.topValue(mat, longPath);
        if (cache) {
            if (!fluid.isPrimitive(cache.value)) {
                cache.proxy = fluid.tangledMat.makeProxy(mat, longPath, cache);
            }
            holder[member] = cache;
            return cache;
        } else {
            return undefined;
        }
    }
};

fluid.tangledMat.ensureContainer = function (holder, seg, exemplar) {
    if (fluid.typeCode(holder[seg]) !== fluid.typeCode(exemplar)) {
        var newContainer = fluid.freshContainer(exemplar);
        holder[seg] = newContainer;
    }
    return holder[seg];
};



fluid.tangledMat.getLayerMap = function (mat) {
    var root = fluid.tangledMat.getRoot(mat);

};

fluid.tangledMat.makeProxy = function (mat, path, target) {
    var proxy = new Proxy(target, {
        get: function (target, member) {
            var cache = fluid.tangledMat.readMember(mat, path, target, member);
            // TODO: eliminate conditional on every access
            return cache ? cache.proxy || cache.value : undefined;
        },
        set: function (target, member, value) {
            if (!mat.writeLayerIndex === -1) {
                fluid.fail("Cannot write ", value, " to path ", path, " for mat without write layer set");
            } else {
                var layer = mat.layers[mat.writeLayerIndex];
                var pathToRoot = fluid.tangledMat.pathToRoot(mat, path);
                var move = layer;
                for (var i = 0; i < path.length - 1; ++i) {
                    var seg = i === 0 ? "layer" : path[i - 1];
                    move = fluid.tangledMat.ensureContainer(move, seg, pathToRoot[i]);
                }
                move[member] = value;
            }
        }
        // TODO: need to add ownKeys() so that object can be stringified
    });
    return proxy;
};

fluid.tangledMat.getMembers = function (mat, path) {
    return mat.layers.map(function (oneLayer) {
        return fluid.getImmediate(oneLayer, path);
    });
};

fluid.tangledMat.findLayer = function (mat, layerName) {
    return mat.layers.findIndex(function (entry) {
        return entry.name === layerName;
    });
};

fluid.tangledMat.setWriteableLayer = function (mat, layerName) {
    var index = fluid.tangledMat.findLayer(mat, layerName);
    mat.writeLayer = layerName;
    mat.writeLayerIndex = index;
};
