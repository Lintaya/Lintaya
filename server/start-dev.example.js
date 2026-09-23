// start-dev.example.js — Dev entry-point with environment configuration.
// Copy this file to start-dev.js and fill in your real values.
// start-dev.js is gitignored so your secrets stay local.
// Leave LINTAYA_TOKEN unset and the server generates one on first start, stores
// it in the gitignored server/.lintaya-token and prints it once. Set it here
// only to pin a token of your own — and then make it long and unique, because
// every value that ships in this repository is public by definition.
// process.env.LINTAYA_TOKEN = "<your own long, unique token>";
process.env.VAULT_MODE    = process.env.VAULT_MODE    || "demo"; // "demo" | "bitwarden"
process.env.LINTAYA_SECRET_STORE = process.env.LINTAYA_SECRET_STORE || "legacy"; // "legacy" | "local"
// Required when LINTAYA_SECRET_STORE=local (16 characters minimum); keep it
// outside the repository. Unused in "legacy" mode, which is the default.
// process.env.LINTAYA_SECRET_KEY = "<a strong key kept outside git>";
// Master password for the demo vault. Without it the Passwords tab stays
// locked and answers VAULT_MASTER_PASSWORD_NOT_CONFIGURED — there is no default.
// process.env.VAULT_MASTER_PASSWORD = "<your own demo vault password>";
process.env.PORT          = process.env.PORT          || "3000";
// Where connectors that do not ship with Lintaya are installed (ADR-014).
// Defaults to ~/.lintaya/connectors/; set it only to keep them somewhere else.
// A missing directory is fine — most installs have no private connector.
// process.env.LINTAYA_CONNECTORS_DIR = "D:/lintaya-connectors";

// Only needed when VAULT_MODE=bitwarden:
process.env.BW_CLIENTID     = process.env.BW_CLIENTID     || "user.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
process.env.BW_CLIENTSECRET = process.env.BW_CLIENTSECRET || "your-bw-client-secret-here";

// Optional — force the committer identity Lintaya uses for commits on local
// clones, per connection. Normally you set this from the connector's detail
// panel ("Commit identity"), which stores it in the database; this env var is
// the fallback for headless/CI installs with no UI session. Either way, leave
// it unset to keep whatever identity the machine's git config resolves.
// process.env.GIT_COMMIT_IDENTITY = JSON.stringify({
//   gitlab: { name: "Your Work Name", email: "you@work.example" },
// });

// Allow self-signed cert on local Bitwarden Docker instance
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

require("./server.js").startServer();
