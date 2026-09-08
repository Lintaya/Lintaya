const php = require("./php");
const java = require("./java");
const javascript = require("./javascript");
const python = require("./python");
const gitops = require("./gitops");
const { uniqueComponents } = require("./helpers");

const DETECTORS = [php, java, javascript, python, gitops];

function buildInventory(ctx) {
  return uniqueComponents(DETECTORS.flatMap((detector) => detector.detect(ctx)));
}

module.exports = { buildInventory };
