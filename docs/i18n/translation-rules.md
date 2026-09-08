# Translation rules

English | [Español](translation-rules.es.md)

## Faithfulness

- The counterpart must preserve every product behavior, prerequisite, warning,
  limitation, version claim, and example from the edited side.
- Write natural technical prose in the target language. Translate meaning, not
  idioms or word order.
- If the two documents disagree, correct the inaccurate statement and update
  both documents in the same change.

## Preserve technical structure

- Keep commands, flags, API paths, JSON keys, environment variables, file
  paths, identifiers, version numbers, and code blocks byte-for-byte identical.
- Keep headings, lists, tables, links, and examples structurally equivalent.
- English links point to `.md`; Spanish links point to the matching `.es.md`
  when that document belongs to the bilingual corpus.

## Spanish writing

- Use clear, neutral technical Spanish suitable for Latin American developers.
- Use a term from [terminology.md](terminology.md) consistently.
- Keep established product and technical names in English when the glossary says
  so; introduce an explanatory Spanish term only where the glossary requires it.
- Do not add an English gloss repeatedly after its first necessary mention.

## Review

The pairing script detects mechanical drift. A reviewer must still confirm
meaning, terminology, safety warnings, commands, and examples before running
`--write` for a pair.
