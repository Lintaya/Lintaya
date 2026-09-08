// Resolving a package that may not be installed.
//
// The public build ships the community connector tier only, so a core file that
// still references an enterprise or development package must tolerate its
// absence: a connector that is not installed has to degrade to a missing
// feature, never to a server that will not boot. ADR-014 removes these
// references entirely; until then this is how they are held.
//
// Only the package's own absence is tolerated. A package that is present but
// throws while loading — a syntax error, a dependency it forgot to declare —
// still fails loudly, because silently disabling a connector the operator did
// install would be worse than crashing.

function requireOptional(request, load = require) {
  try {
    return load(request);
  } catch (error) {
    if (error?.code !== "MODULE_NOT_FOUND") throw error;
    // Node reports the same code when the package itself is missing and when
    // something the package requires is missing. Only the first is expected, so
    // the error has to name this request to be treated as "not installed".
    if (!String(error.message || "").includes(request)) throw error;
    return null;
  }
}

module.exports = { requireOptional };
