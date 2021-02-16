/* eslint-env node */

"use strict";

var fluid = require("infusion");
var json5 = require("json5");
var simpleGit = require("simple-git");

require("./readJSON.js");

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
    var job = fluid.readJSONSync(resolved);
    var working = fluid.module.resolvePath(workingDir);
    var git = simpleGit(working);
    var actions = fluid.transform(job.datasets, function (dataset, key) {
        var prefix = fluid.data.gitUrlToPrefix(dataset.repository);
        console.log("prefix " + prefix);
        var action = git.clone(dataset.repository, prefix);
        return action;
    });
    var work = fluid.promise.sequence(fluid.hashToArray(actions));
    return work;
};
