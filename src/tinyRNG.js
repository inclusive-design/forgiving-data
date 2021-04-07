"use strict";

var fluid = require("infusion");

// JavaScript's RNG is not seedable - see comments and impl ripped off from https://stackoverflow.com/a/424445
// Constants ripped off from https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript/47593316#comment99654434_47593316

fluid.tinyRNG = function (seed) {
    // LCG using some of Pierre L'ecuyer's constants
    this.m = 34359738337; // Fits in 36 bits - JS range is 53 bits
    this.a = 185852; // Fits in 18 bits
    this.c = 1;

    this.state = seed !== undefined ? seed : Math.floor(Math.random() * (this.m - 1));
};

fluid.tinyRNG.prototype.nextInt = function () {
    this.state = (this.a * this.state + this.c) % this.m;
    return this.state;
};

fluid.tinyRNG.prototype.nextFloat = function () {
    // returns in range [0, 1)
    return this.nextInt() / this.m;
};

fluid.tinyRNG.prototype.nextRange = function (start, end) {
    // returns in range [start, end): including start, excluding end
    // can't modulo nextInt because of weak randomness in lower bits
    var rangeSize = end - start;
    var nextFloat = this.nextFloat();
    return start + Math.floor(nextFloat * rangeSize);
};
