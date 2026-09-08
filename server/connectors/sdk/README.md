# Connector SDK (internal preview)

This module is the stable import boundary between connector packages and shared
Lintaya services. It is intentionally small and is exercised by the GitHub,
GitLab, Bitbucket, Outline, and Anthropic packages.

Current capabilities:

- HTTP(S) JSON requests with base-path preservation, timeouts, and cancellation.
- Explicit text responses for source files and build logs that resemble JSON.
- Normalized authentication, rate-limit, HTTP, timeout, and network errors.
- Predictable connector config, data, and status storage keys, with secret
  fields transparently routed through a pluggable `SecretStore`
  (`legacy` plaintext KV, AES-256-GCM `local`, or `bitwarden` — one Secure
  Note per connection in the same vault the Passwords module uses; see
  `server/core/services/secret-store.js`).
- Public configuration views that expose secret presence, never secret values.
- Connector log redaction using the active credential values.
- `guardAsyncRoute()` — wraps an async connector route handler so a thrown
  `vault-locked` (or any other synchronous throw before the handler's own
  try/catch, most commonly from `store.getConfig()`/`setConfig()` under
  `bitwarden` mode with the vault locked) always produces an HTTP response
  instead of leaving the request hanging — Express 4 does not forward a
  rejected async-handler promise to error middleware on its own.

Import services from the SDK instead of reaching into `server/core`:

```js
const {
  createConnectorStore,
  guardAsyncRoute,
  requestJson,
} = require("../../sdk");
```

Every async route handler in a connector package should be wrapped with
`guardAsyncRoute()` unless the connector's `config.schema.json` declares no
`x-lintaya-secret`/`writeOnly` fields at all (e.g. `outlook-local`, which has
no credentials to store) — in that case `store.getConfig()` can never throw
`vault-locked` and wrapping would be a no-op.
