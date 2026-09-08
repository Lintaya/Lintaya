const assert = require("node:assert/strict");
const { test } = require("node:test");

const { requireOptional } = require("./optional-package");

const REQUEST = "./connectors/enterprise/vcenter";

function notFound(message) {
  return Object.assign(new Error(message), { code: "MODULE_NOT_FOUND" });
}

test("an installed package is returned as the loader gave it", () => {
  const pkg = { vcenterFetch() {} };

  assert.equal(requireOptional(REQUEST, () => pkg), pkg);
});

test("a package that is simply not installed resolves to null", () => {
  const load = () => { throw notFound(`Cannot find module '${REQUEST}'`); };

  assert.equal(requireOptional(REQUEST, load), null);
});

test("a dependency missing inside the package still fails loudly", () => {
  // Node reports MODULE_NOT_FOUND here too. Swallowing it would disable a
  // connector the operator did install, and hide the real defect.
  const load = () => { throw notFound("Cannot find module 'ssh2'"); };

  assert.throws(() => requireOptional(REQUEST, load), /ssh2/);
});

test("any other load failure is not treated as absence", () => {
  const load = () => { throw new SyntaxError("Unexpected token"); };

  assert.throws(() => requireOptional(REQUEST, load), SyntaxError);
});

test("the real loader resolves a package that exists", () => {
  assert.ok(requireOptional("node:path"));
});

test("the real loader returns null for one that does not", () => {
  assert.equal(requireOptional("./definitely-not-a-package-here"), null);
});
