// Why `bw unlock` failed.
//
// The Bitwarden CLI reports every failure the same way — a non-zero exit and
// text on stderr — so the unlock route used to flatten all of them into "the
// master password was rejected". A self-hosted vault server that is simply not
// running then reads as a typing mistake: the person retypes a correct password
// several times, and the one thing they need to be told, that the server is
// down, is the one thing the message never says.

const CLI_MISSING = /\bENOENT\b|exit 127|is not recognized as an internal or external command/i;
const UNREACHABLE = /\bECONNREFUSED\b|\bENOTFOUND\b|\bEAI_AGAIN\b|\bETIMEDOUT\b|\bECONNRESET\b|socket hang up|Unable to fetch ServerConfig/i;
const TLS_REFUSED = /self[- ]signed certificate|unable to verify the first certificate|DEPTH_ZERO_SELF_SIGNED_CERT|CERT_HAS_EXPIRED/i;
const NOT_LOGGED_IN = /not logged in/i;

// The CLI is configured with its server URL outside this process, so the most
// reliable place to learn it is the failure itself — a refused connection names
// the address it tried.
function serverUrlFrom(text) {
  return text.match(/https?:\/\/[^\s/"']+/)?.[0] || null;
}

// Order matters. A stopped server produces a long error that mentions several
// things at once, so the unambiguous transport codes are matched before the
// broader wording.
function classifyVaultUnlockFailure(error, options = {}) {
  const text = String(error?.message || error || "");
  const serverUrl = options.serverUrl || serverUrlFrom(text) || "the configured Bitwarden server";

  if (CLI_MISSING.test(text)) {
    return {
      code: "BW_CLI_NOT_INSTALLED",
      status: 503,
      message: "Bitwarden CLI (bw) is not installed on the server. Run: npm install -g @bitwarden/cli",
    };
  }

  if (UNREACHABLE.test(text)) {
    return {
      code: "VAULT_SERVER_UNREACHABLE",
      status: 503,
      message: `The vault server at ${serverUrl} is not responding — start it and try again. This is not a wrong master password.`,
    };
  }

  if (TLS_REFUSED.test(text)) {
    return {
      code: "VAULT_SERVER_TLS_REJECTED",
      status: 502,
      message: `The vault server at ${serverUrl} answered with a certificate this server would not accept. This is not a wrong master password.`,
    };
  }

  if (NOT_LOGGED_IN.test(text)) {
    return {
      code: "VAULT_CLI_NOT_LOGGED_IN",
      status: 503,
      message: "The Bitwarden CLI is not logged in on this server. Log in once with your API key, then unlock again.",
    };
  }

  // Everything left really does look like a credential the server rejected.
  return {
    code: "WRONG_MASTER_PASSWORD",
    status: 401,
    message: "The master password was rejected.",
  };
}

module.exports = { classifyVaultUnlockFailure };
