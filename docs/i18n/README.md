# Bilingual documentation

English | [Español](README.es.md)

Lintaya documentation is maintained in English and Spanish. Both languages have
equal authority: an update can originate in either language, but its counterpart
must express the same behavior, warning, prerequisite, example, and scope.

## Pairing contract

Every document in scope is a three-file sibling pair:

```text
foo.md             English
foo.es.md          Español
foo.i18n.yaml      last confirmed-consistent hashes
```

The `.i18n.yaml` file records the Git blob hash of each document after a human
or reviewer has confirmed that they are equivalent. It does not translate text
and it does not prove semantic quality by itself; it makes an unpaired edit
visible in review and CI.

After changing a pair, update both documents and record the reviewed state:

```powershell
node scripts/verify-translation-pairing.mjs --write docs/example.md
node scripts/verify-translation-pairing.mjs docs/example.md
```

Run without a path to inspect the whole corpus. `--all` is required for a
deliberate corpus-wide re-recording.

During the migration, CI runs `--recorded`: every pair that has an
`.i18n.yaml` record is enforced automatically, while documents awaiting their
first translation remain visible in `--list`. Once every document is paired,
CI must switch to the pathless whole-corpus command.

## What the verifier checks

- Complete English, Spanish, and record files.
- Language switchers immediately below the title.
- Recorded blob hashes.
- Matching heading levels, fenced code blocks, list shapes, table shapes, and
  semantic Markdown link targets.

It intentionally does not decide whether a translation is correct. Reviewers
use [translation rules](translation-rules.md) and the
[terminology](terminology.md) table for that judgment.

## Scope

All Markdown documentation in the repository is in scope, including root
guides, `docs/`, `cli/`, `server/`, connector READMEs, asset READMEs, and agent
guides. The only current exclusion is `terminology.md`, which is bilingual by
construction. Exclusions live in
[`scripts/translation-pairing.manifest.json`](../../scripts/translation-pairing.manifest.json)
and must be explicit.
