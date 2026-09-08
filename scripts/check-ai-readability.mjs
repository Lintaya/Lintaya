#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];

function read(relativePath) {
  const file = join(root, relativePath);
  if (!existsSync(file)) {
    failures.push(`${relativePath}: missing`);
    return "";
  }
  return readFileSync(file, "utf8");
}

// Landmarks get their accessible name from t(<i18n key>) since the EN/ES
// toggle shipped — checking for a hardcoded Spanish literal here would fail
// on the correct, translated markup. Checking for the t() call instead
// verifies the same contract (this landmark has SOME accessible name) without
// pinning it to one language; app/i18n.js is the source of truth for the
// actual ES/EN strings.
const appShell = read("app/app.jsx");
const mainCount = (appShell.match(/<main\b/g) || []).length;
if (mainCount !== 1) failures.push(`app/app.jsx: expected one document-level <main>, found ${mainCount}`);
if (!appShell.includes('aria-label={t("shell.mainContent")}')) failures.push("app/app.jsx: main needs an accessible name");
if (!appShell.includes('data-lintaya-surface="workspace"')) failures.push("app/app.jsx: workspace surface marker is missing");
if ((appShell.match(/<nav\b/g) || []).length < 2) failures.push("app/app.jsx: expected primary and workspace navigation landmarks");
for (const label of ['aria-label={t("shell.primaryNav")}', 'aria-label={t("nav.workspace"']) {
  if (!appShell.includes(label)) failures.push(`app/app.jsx: missing ${label}`);
}

const appFiles = readdirSync(join(root, "app"))
  .filter(file => file.endsWith(".jsx"))
  .map(file => `app/${file}`)
  .filter(file => file !== "app/app.jsx");
for (const file of appFiles) {
  const content = read(file);
  if (/<main\b/.test(content)) failures.push(`${file}: nested <main> is not allowed; use a labelled section or aside`);
}

const connectorsView = read("app/connectors.jsx");
for (const marker of ['data-lintaya-surface="connectors"', 'role="list" aria-label={t("connectors.view.listAria")}', 'role="dialog" aria-modal="true" aria-label={t("connectors.export.title")}']) {
  if (!connectorsView.includes(marker)) failures.push(`app/connectors.jsx: missing audited accessibility marker ${marker}`);
}

const blockBuilder = read("app/block-builder.jsx");
for (const marker of ['id="block-builder-title"', 'htmlFor="block-builder-description"', 'role="dialog" aria-modal="true" aria-label="Choose a block icon"']) {
  if (!blockBuilder.includes(marker)) failures.push(`app/block-builder.jsx: missing audited accessibility marker ${marker}`);
}

const boardBuilder = read("app/module-builder.jsx");
for (const marker of ['id="board-builder-title"', 'onZoneKeyDown', 'onGripKeyDown', 'aria-valuenow={ratio}']) {
  if (!boardBuilder.includes(marker)) failures.push(`app/module-builder.jsx: missing audited accessibility marker ${marker}`);
}

const boardWorkspace = read("app/custom-page-view.jsx");
for (const marker of ['data-lintaya-entity="board"', 'role="separator"', 'aria-valuenow={percent}', 'aria-label={window.I18N.t("ui.boards.empty"', 'removeLabel: window.I18N.t("ui.boards.closeBlock"', 'contentScroll: !mobile', 'contentScrollLabel:']) {
  if (!boardWorkspace.includes(marker)) failures.push(`app/custom-page-view.jsx: missing audited accessibility marker ${marker}`);
}

for (const file of ["llms.txt", "llms.es.txt"]) {
  if (!read(file).trim()) failures.push(`${file}: must not be empty`);
}

const llms = read("llms.txt");
for (const reference of ["README.md", "ARCHITECTURE.md", "/api/ai-context"]) {
  if (!llms.includes(reference)) failures.push(`llms.txt: missing ${reference}`);
}

if (failures.length) {
  console.error(`AI readability checks failed:\n${failures.map(value => `- ${value}`).join("\n")}`);
  process.exit(1);
}

console.log("AI readability: ok (semantic shell, agent indexes, and practice guides)");
