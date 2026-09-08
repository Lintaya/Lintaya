# Security policy

English | [Español](SECURITY.es.md)

Lintaya handles repository credentials, local clones and infrastructure
integrations. Treat every repository, connector response and imported file as
untrusted input.

## Supported versions

Lintaya is currently pre-release. Security fixes are applied to the latest code
on the default branch. A version support table will be added with the first
stable release.

## Reporting a vulnerability

Do not disclose vulnerabilities, credentials or exploit details in a public
issue, discussion, pull request or chat transcript.

Use GitHub's **Report a vulnerability** / private security advisory flow for the
repository. If private reporting is not yet enabled, contact the maintainers
privately and request a secure reporting channel without including exploit
details in the first message.

Include, when possible:

- affected component and version or commit;
- impact and realistic attack scenario;
- minimal reproduction steps;
- whether credentials or user data may have been exposed;
- suggested mitigation, if known.

The maintainers aim to acknowledge a report within three business days, provide
an initial assessment within seven business days and coordinate disclosure after
a fix is available. These are response targets, not a contractual SLA.

## Security boundaries

- Never commit `.env` files, vault exports, databases, tokens or private keys.
- Repository execution is not considered safe until the sandbox milestone is
  complete. Do not run untrusted project commands on the host.
- Connector secrets must be read through the configured secret store and must
  never appear in API responses, diagnostics or logs.
- A leaked credential must be revoked or rotated even if it is removed from Git
  history.

Reports made in good faith to improve Lintaya's security are welcome. Do not
access data that is not yours, disrupt services or perform social engineering.
