"use strict";

var fluid = require("infusion");

/**
 * "Flat object scheme"
 *
 * Why is this mechanism implemented?
 *
 * Part of it is a kind of "farewell to that-ism" as anciently written up at https://wiki.fluidproject.org/display/fluid/About+this+and+that
 * Almost all of the thinking in that 2008 posting is now appearing as incorrect. Prototypalism is/was a highly attractive
 * intermediate solution to producing malleable and open software, and the concerns about hijacking and privacy are pretty
 * irrelevant. In addition, "that-ism" is a highly inefficient and verbose scheme for producing "implementation units" -
 * we need a fresh function instance and closure for each method, as well as paying the costs for attaching them
 * afresh to each instance.
 *
 * The "tangled mat" was very nearly written in a pure "this-ist" style until it appeared that there was a final,
 * irremovable design cost to "this-ism" - the fact that the "this" argument, in the function implementation, is implicit,
 * and there is no means to distinguish a function which is intended to be used as a standalone pure function from
 * one which is a method, other than by reading its body for any use of "this" (or, perhaps, reading its documentation).
 * Also, the inability to use "literal syntax" for initialising the original "that" record is a stylistic annoyance.
 *
 * This is somewhat mitigated in the ES6 style of sugared classes, but with an attendant lack of open-ness - all
 * methods need to written physically nested within the class definition.
 *
 * I thought - is there a way to create an object which can be used in an idiomatic "this-ist" manner but whose
 * implementation is notionally open, expressed as visibly pure functions, and which doesn't incur any per-instance
 * cost for allocating methods attached to the object, using the ES5 Object.defineProperty scheme - note that
 * this answer https://stackoverflow.com/a/42709301 indicates that the property should be attached to the prototype
 * to avoid performance issues.
 *
 * It turns out that there is - at the cost of creating a set of "thunks" which rebind the hidden "this" argument
 * onto a visible first argument. The cost of these thunks might be significant in some contexts but should be
 * generally cheap - far more so than general Proxies, e.g.
 *
 * The client of this class declares all functions which they want to be attached to the prototype via thunks
 * in this way in a sub-namespace of the prototype itself named "methods" - e.g. for fluid.tangledMat, these
 * functions are written in fluid.tangledMat.methods. After they have all been defined, a call to
 * fluid.flatObject.defineMethodProperties attaches them to the prototype.
 *
 * The question is whether this facility is worth any cost at all? Especially given the value of the "open-ness"
 * is really pretty negligible and seen only to the implementor. By the time the user sees the object, it behaves
 * exactly like a standard this-ist method (although they will be annoyed by seeing the thunks in the debugger).
 *
 * Standard economics would dictate that a facility which costs anything to the user and is valuable only to the author is faulty.
 *
 * Whilst this is to some extent an "amusement" I think that the idea isn't irrelevant to a future Infusion where
 * we see more use being made of "good functions" being defined at particular points in a "namespace soup" expressed
 * in RSON. This kind of object implementation (with or without thunks) might end up being a "personality" of the
 * future Infusion where an inspection of the definition shows that the implementation can be honoured in a
 * this-ist style.
 *
 * One interesting piece of auto-ethnography is the observation that, whilst "old Infusion" did absolutely nothing
 * to privilege "method-like" invoker definitions where the object is the first argument - in fact, it made them
 * annoyingly bulky - the great majority of invoker definitions still ended up essentially being those of methods,
 * e.g.
 *     someMethod: {
 *         funcName: "namespace.someMethod",
 *         args: ["{that}", "{arguments}.0", "{arguments}.1"]
 *     }
 * etc.
 * whether this means that there is an intrinsic remnant value to OO-style method definitions, or whether our brains
 * are just irretrievably broken by all the bad OO books we read in the 90s is up for grabs. All the same, it seems
 * like we need to do something to assist users to write method-like definitions concisely, with an efficient
 * implementation.
 *
 */

fluid.registerNamespace("fluid.flatObject");

fluid.flatObject.dispatch0 = function (func, target) {
    return func(target);
};

fluid.flatObject.dispatch1 = function (func, target, args) {
    return func(target, args[0]);
};

fluid.flatObject.dispatch2 = function (func, target, args) {
    return func(target, args[0], args[1]);
};

fluid.flatObject.dispatch3 = function (func, target, args) {
    return func(target, args[0], args[1], args[2]);
};

fluid.flatObject.dispatch4 = function (func, target, args) {
    return func(target, args[0], args[1], args[2], args[3]);
};

fluid.flatObject.dispatch5 = function (func, target, args) {
    return func(target, args[0], args[1], args[2], args[3], args[4]);
};

/** Produce the "properties" hash by inspection of namespace.methods suitable to be attached to its prototype
 * @param {Object} namespace - The namespace (actually the prototype itself) to which the method definitions are
 * attached
 * @return {Object<String, Property>} A hash of property definitions suitable to be attached directly to the
 * prototype by means of Object.defineProperties
 */
fluid.flatObject.makeProperties = function (namespace) {
    var methods = namespace.methods;
    return fluid.transform(methods, function (func) {
        var arity = func.length;
        var dispatcher = fluid.getGlobalValue("fluid.flatObject.dispatch" + arity);
        return {
            value: function () {
                return dispatcher(func, this, arguments);
            }
        };
    });
};

fluid.flatObject.defineMethodProperties = function (namespace) {
    Object.defineProperties(namespace, fluid.flatObject.makeProperties(namespace));
};
