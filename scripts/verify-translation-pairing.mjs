#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifestPath = join(root, "scripts", "translation-pairing.manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function toRepoPath(file) {
  return relative(root, file).split(sep).join("/");
}

function isExcluded(file) {
  return manifest.excluded.some(entry => entry.endsWith("/") ? file.startsWith(entry) : file === entry);
}

function repositoryFiles(pattern) {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", pattern], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`could not list repository files: ${result.stderr.trim()}`);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function documentationFiles() {
  return repositoryFiles("*.md");
}

function isSource(file) {
  return file.endsWith(".md") && !file.endsWith(".es.md") && !isExcluded(file);
}

function pairPaths(anchor) {
  const source = anchor.endsWith(".es.md")
    ? `${anchor.slice(0, -6)}.md`
    : anchor.endsWith(".i18n.yaml")
      ? `${anchor.slice(0, -10)}.md`
      : anchor;
  if (!source.endsWith(".md")) throw new Error(`'${anchor}' must name a Markdown source, Spanish counterpart, or i18n record`);
  return {
    source,
    spanish: `${source.slice(0, -3)}.es.md`,
    record: `${source.slice(0, -3)}.i18n.yaml`,
  };
}

function readRepo(file) {
  const fullPath = join(root, file);
  return existsSync(fullPath) ? readFileSync(fullPath) : null;
}

// El hash identifica el CONTENIDO del par, no los bytes del checkout. Sin
// normalizar, .gitattributes entrega estos .md con CRLF en Windows y con LF en
// el Linux de CI, así que el mismo documento daba dos hashes y el check fallaba
// en una plataforma y pasaba en la otra. Normalizar deja el resultado igual en
// las tres.
function gitBlobHash(content) {
  const normalized = Buffer.from(content.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
  return createHash("sha1")
    .update(Buffer.from(`blob ${normalized.length}\0`))
    .update(normalized)
    .digest("hex");
}

function relativeLink(from, to) {
  const target = relative(dirname(from), to).split(sep).join("/");
  return target || to.split("/").at(-1);
}

function stripLocale(path) {
  return path.endsWith(".es.md") ? `${path.slice(0, -6)}.md` : path;
}

function semanticTarget(target, from) {
  if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) return target;
  const [pathPart, fragment = ""] = target.split(/(?=[?#])/, 2);
  const resolved = toRepoPath(normalize(join(root, dirname(from), pathPart)));
  return `${stripLocale(resolved)}${fragment}`;
}

function collectFences(lines) {
  const fences = [];
  let current = null;
  for (const line of lines) {
    const start = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!current && start) {
      current = { marker: start[1][0], size: start[1].length, info: start[2], lines: [line] };
    } else if (current) {
      current.lines.push(line);
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === current.marker && close[1].length >= current.size) {
        fences.push(current.lines.join("\n"));
        current = null;
      }
    }
  }
  if (current) fences.push(current.lines.join("\n"));
  return fences;
}

function markdownSignature(content, from, counterpart) {
  const lines = content.toString("utf8").replace(/\r\n/g, "\n").split("\n");
  const headings = lines
    .map(line => line.match(/^(#{1,6})\s+/)?.[1].length)
    .filter(Boolean);
  const lists = lines
    .map(line => line.match(/^(\s*)([-*+] |\d+\. )/))
    .filter(Boolean)
    .map(match => ({ indent: match[1].length, type: /^\d/.test(match[2]) ? "ol" : "ul", start: match[2].match(/^\d+/)?.[0] || null }));
  const tables = lines
    .filter(line => /^\s*\|.*\|\s*$/.test(line))
    .map(line => line.split("|").length - 2);
  const links = [...content.toString("utf8").matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)]
    .map(match => match[1])
    .filter(target => target !== counterpart)
    .map(target => semanticTarget(target, from));
  return JSON.stringify({ headings, fences: collectFences(lines), lists, tables, links });
}

function parseRecord(content, record) {
  const entries = new Map([...content.toString("utf8").matchAll(/^([^#\s][^:]+):\s*([a-f0-9]{40})\s*$/gmi)]
    .map(([, file, hash]) => [file.trim(), hash]));
  return entries.size === 2 ? entries : new Map([["__invalid__", record]]);
}

function renderRecord({ source, spanish }, sourceHash, spanishHash) {
  return [
    `# Bilingual-pair consistency record (${source}).`,
    "# After confirming both documents say the same thing, refresh with:",
    `# node scripts/verify-translation-pairing.mjs --write ${source}`,
    "",
    `${source}: ${sourceHash}`,
    `${spanish}: ${spanishHash}`,
    "",
  ].join("\n");
}

function validatePair(pair, { verifyHashes = true } = {}) {
  const errors = [];
  const source = readRepo(pair.source);
  const spanish = readRepo(pair.spanish);
  const record = readRepo(pair.record);
  if (!source) errors.push(`${pair.source}: missing English document`);
  if (!spanish) errors.push(`${pair.spanish}: missing Spanish document`);
  if (!record && verifyHashes) errors.push(`${pair.record}: missing consistency record`);
  if (!source || !spanish) return errors;

  const sourceSwitcher = `English | [Español](${relativeLink(pair.source, pair.spanish)})`;
  const spanishSwitcher = `[English](${relativeLink(pair.spanish, pair.source)}) | Español`;
  const sourceText = source.toString("utf8");
  const spanishText = spanish.toString("utf8");
  if (!sourceText.includes(sourceSwitcher)) errors.push(`${pair.source}: missing language switcher '${sourceSwitcher}'`);
  if (!spanishText.includes(spanishSwitcher)) errors.push(`${pair.spanish}: missing language switcher '${spanishSwitcher}'`);
  if (markdownSignature(source, pair.source, relativeLink(pair.source, pair.spanish)) !== markdownSignature(spanish, pair.spanish, relativeLink(pair.spanish, pair.source))) {
    errors.push(`${pair.source} ↔ ${pair.spanish}: headings, code blocks, lists, tables, or link targets differ`);
  }
  if (verifyHashes && record) {
    const entries = parseRecord(record, pair.record);
    if (entries.get(pair.source) !== gitBlobHash(source) || entries.get(pair.spanish) !== gitBlobHash(spanish)) {
      errors.push(`${pair.source} ↔ ${pair.spanish}: out of sync with ${pair.record}; update both sides, then run --write`);
    }
  }
  return errors;
}

function parseArgs(argv) {
  const request = { mode: "check", all: false, recorded: false, anchors: [] };
  for (const arg of argv) {
    if (arg === "--write") request.mode = "write";
    else if (arg === "--list") request.mode = "list";
    else if (arg === "--all") request.all = true;
    else if (arg === "--recorded") request.recorded = true;
    else if (arg.startsWith("-")) throw new Error(`unknown option '${arg}'`);
    else request.anchors.push(arg.replace(/\\/g, "/"));
  }
  if (request.mode === "write" && !request.all && request.anchors.length === 0) throw new Error("--write requires one or more named pairs, or --all");
  if (request.recorded && (request.all || request.anchors.length > 0 || request.mode !== "check")) {
    throw new Error("--recorded cannot be combined with --write, --list, --all, or document paths");
  }
  return request;
}

let request;
try {
  request = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`verify-translation-pairing: ${error.message}`);
  process.exit(2);
}

const sources = documentationFiles().filter(isSource).sort();
const anchors = request.recorded
  ? repositoryFiles("*.i18n.yaml")
  : request.all || request.anchors.length === 0 ? sources : request.anchors;
const pairs = [...new Map(anchors.map(anchor => {
  const pair = pairPaths(anchor);
  if (!isSource(pair.source)) throw new Error(`${pair.source} is excluded or outside the bilingual documentation scope`);
  return [pair.source, pair];
})).values()];
const errors = [];

for (const pair of pairs) {
  const pairErrors = validatePair(pair, { verifyHashes: request.mode !== "write" });
  if (request.mode === "list") {
    console.log(`${pairErrors.length ? "OUT OF SYNC" : "OK"}  ${pair.source}`);
    continue;
  }
  errors.push(...pairErrors);
  if (request.mode === "write" && pairErrors.length === 0) {
    const source = readRepo(pair.source);
    const spanish = readRepo(pair.spanish);
    writeFileSync(join(root, pair.record), renderRecord(pair, gitBlobHash(source), gitBlobHash(spanish)));
    console.log(`Recorded ${pair.record}`);
  }
}

if (errors.length) {
  console.error(errors.map(error => `verify-translation-pairing: ${error}`).join("\n"));
  process.exit(1);
}
