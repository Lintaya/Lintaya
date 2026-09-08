#!/usr/bin/env node
const { main } = require("../src");

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`lintaya: ${error.message}\n`);
  process.exitCode = 1;
});
