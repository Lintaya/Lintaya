const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { analyzeRepository } = require(".");

function withRepository(files, test) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-hq-analysis-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
    }
    test(root, analyzeRepository(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

withRepository({
  "README.md": "# Demo",
  "LICENSE": "MIT",
  ".gitignore": ".venv/",
  ".github/workflows/test.yml": "name: test",
  "pyproject.toml": "[project]\nname='demo'\n[tool.ruff]\n",
  "tests/test_app.py": "def test_ok(): assert True\n",
  "app.py": "app.run(debug=True)\n",
}, (_root, report) => {
  assert(report.technologies.includes("python"));
  assert(report.findings.some((finding) => finding.id.startsWith("python.debug.")));
  assert(!report.findings.some((finding) => finding.id === "python.manifest"));
});

withRepository({
  "README.md": "# Monorepo",
  "LICENSE": "MIT",
  ".gitignore": "node_modules/",
  "server/package.json": JSON.stringify({ scripts: { test: "node test.js", lint: "eslint ." } }),
  "server/package-lock.json": "{}",
  "server/index.js": "console.log('ok');",
  "server/test.js": "// test",
}, (_root, report) => {
  assert(report.technologies.includes("javascript"));
  assert(!report.findings.some((finding) => finding.id === "javascript.package-json-missing"));
  assert(!report.findings.some((finding) => finding.id === "javascript.lockfile"));
  assert(!report.findings.some((finding) => finding.id === "javascript.test-script"));
});

withRepository({
  "README.md": "# Parent",
  "LICENSE": "MIT",
  ".gitignore": "nested/",
  "nested/.git/HEAD": "ref: refs/heads/main",
  "nested/app.py": "app.run(debug=True)",
}, (_root, report) => {
  assert(!report.technologies.includes("python"));
  assert(!report.findings.some((finding) => finding.id.startsWith("python.debug.")));
});

withRepository({
  "README.md": "# Safe",
  "LICENSE": "MIT",
  ".gitignore": "*.marker",
  "setup.py": "require('node:fs').writeFileSync('executed.marker', 'bad')",
}, (root, report) => {
  assert(report.technologies.includes("python"));
  assert.equal(fs.existsSync(path.join(root, "executed.marker")), false);
});

withRepository({
  "README.md": "# Laravel API",
  "LICENSE": "MIT",
  ".gitignore": "/vendor/\n.env",
  "composer.json": JSON.stringify({ require: { php: "^8.3", "laravel/framework": "^12.0" } }),
  "composer.lock": JSON.stringify({ packages: [{ name: "laravel/framework", version: "v12.1.0" }] }),
  "routes/api.php": "<?php Route::get('/health', fn () => 'ok');",
}, (_root, report) => {
  assert(report.technologies.includes("php"));
  assert.equal(report.classification.primary, "api-backend");
  assert(report.inventory.some((item) => item.name === "PHP" && item.constraint === "^8.3"));
  assert(report.inventory.some((item) => item.name === "Laravel" && item.version === "v12.1.0"));
});

withRepository({
  "README.md": "# Spring API",
  "LICENSE": "MIT",
  ".gitignore": "target/",
  "pom.xml": `<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.5.1</version></parent><properties><java.version>21</java.version></properties><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>`,
  "mvnw": "#!/bin/sh",
  "src/main/java/demo/Controller.java": "class Controller {}",
  "src/main/resources/application.properties": "server.port=8080",
  "src/test/java/demo/ControllerTest.java": "class ControllerTest {}",
}, (_root, report) => {
  assert(report.technologies.includes("java"));
  assert.equal(report.classification.primary, "api-backend");
  assert(report.inventory.some((item) => item.name === "Java" && item.version === "21"));
  assert(report.inventory.some((item) => item.name === "Spring Boot" && item.version === "3.5.1"));
});

withRepository({
  "README.md": "# Static",
  "LICENSE": "MIT",
  ".gitignore": ".DS_Store",
  "index.html": "<!doctype html><html lang='es'><head><meta name='viewport' content='width=device-width'><title>Demo</title></head><body></body></html>",
  "assets/site.css": "body {}",
}, (_root, report) => {
  assert.equal(report.classification.primary, "static-site");
});

withRepository({
  "README.md": "# Library",
  "LICENSE": "MIT",
  ".gitignore": "node_modules/",
  "package.json": JSON.stringify({ name: "web-utils", main: "index.js", scripts: { test: "node test.js", lint: "eslint ." } }),
  "package-lock.json": "{}",
  "index.js": "module.exports = {};",
  "test.js": "// test",
}, (_root, report) => {
  assert.equal(report.classification.primary, "web-library");
});

withRepository({
  "README.md": "# CLI",
  "LICENSE": "MIT",
  ".gitignore": "node_modules/",
  "package.json": JSON.stringify({ name: "web-cli", bin: { "web-cli": "cli.js" }, scripts: { test: "node test.js", lint: "eslint ." } }),
  "package-lock.json": "{}",
  "cli.js": "#!/usr/bin/env node",
  "test.js": "// test",
}, (_root, report) => {
  assert.equal(report.classification.primary, "cli-desktop");
});

withRepository({
  "README.md": "# Notes",
  "LICENSE": "MIT",
  ".gitignore": "*.tmp",
  "archive.bin": "contenido sin formato reconocible",
}, (_root, report) => {
  assert.equal(report.classification.primary, "unknown");
});

withRepository({
  "README.md": "# Manual\n\n[Guía](docs/guide.md)",
  "LICENSE": "CC-BY-4.0",
  "docs/index.md": "# Índice\n\n[Guía](guide.md)",
  "docs/guide.md": "# Guía\n\n### Inicio\n\n[No existe](missing.md)",
}, (_root, report) => {
  assert.equal(report.classification.primary, "documentation");
  assert(report.findings.some((finding) => finding.id.startsWith("documentation.broken-link.")));
  assert(report.findings.some((finding) => finding.id.startsWith("documentation.heading-jump.")));
  assert(!report.findings.some((finding) => finding.id === "common.tests"));
  assert(!report.findings.some((finding) => finding.id === "common.ci"));
  assert(!report.findings.some((finding) => finding.id === "common.gitignore"));
});

withRepository({
  "README.md": "# API contract",
  "LICENSE": "MIT",
  "openapi.yaml": "openapi: 3.1.0\n",
}, (_root, report) => {
  assert(report.classification.types.some((type) => type.id === "specification"));
  assert(report.classification.types.some((type) => type.id === "api-backend"));
  assert(report.findings.some((finding) => finding.id === "specification.info.openapi.yaml"));
  assert(report.findings.some((finding) => finding.id === "specification.operations.openapi.yaml"));
});

withRepository({
  "README.md": "# Infrastructure",
  "LICENSE": "MIT",
  ".gitignore": ".terraform/",
  "main.tf": "terraform {}\nresource \"null_resource\" \"demo\" {}",
}, (_root, report) => {
  assert.equal(report.classification.primary, "infrastructure");
  assert(report.findings.some((finding) => finding.id === "infrastructure.terraform-lock"));
  assert(report.findings.some((finding) => finding.id === "infrastructure.terraform-version"));
});

withRepository({
  "README.md": "# Production delivery",
  "LICENSE": "MIT",
  ".gitignore": ".env",
  "clusters/prod/application.yaml": `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: web
spec:
  source:
    repoURL: http://git.example.test/platform/config.git
    targetRevision: HEAD
    path: clusters/prod
---
apiVersion: networking.k8s.io/v1beta1
kind: Ingress
metadata:
  name: web
---
apiVersion: v1
kind: Secret
metadata:
  name: web-token
stringData:
  token: plain-text
`,
}, (_root, report) => {
  assert(report.technologies.includes("gitops"));
  assert.equal(report.classification.primary, "infrastructure");
  assert(report.inventory.some((item) => item.name === "Argo CD"));
  assert(report.findings.some((finding) => finding.id === "gitops.detected"));
  assert(report.findings.some((finding) => finding.id.startsWith("gitops.argo-automated.")));
  assert(report.findings.some((finding) => finding.id.startsWith("gitops.insecure-source.")));
  assert(report.findings.some((finding) => finding.id.startsWith("gitops.removed-api.")));
  assert(report.findings.some((finding) => finding.id.startsWith("gitops.plain-secret.")));
  assert(report.findings.some((finding) => finding.id === "gitops.codeowners"));
  assert(report.findings.some((finding) => finding.id === "gitops.manifest-validation"));
});

withRepository({
  "README.md": "# Flux GitOps\n\nBootstrap, reconciliation and rollback are documented.",
  "LICENSE": "MIT",
  ".gitignore": ".env",
  ".github/CODEOWNERS": "clusters/ @platform-team",
  ".github/workflows/validate.yml": "name: validate\nsteps:\n  - run: kubeconform clusters/",
  "clusters/prod/flux-system/gotk-sync.yaml": `apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: flux-system
spec:
  interval: 1m
  url: https://git.example.test/platform/config.git
  ref:
    branch: main
---
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: flux-system
spec:
  interval: 10m
  prune: true
  sourceRef:
    kind: GitRepository
    name: flux-system
`,
}, (_root, report) => {
  assert(report.technologies.includes("gitops"));
  assert(report.inventory.some((item) => item.name === "Flux"));
  assert(!report.findings.some((finding) => finding.id === "gitops.codeowners"));
  assert(!report.findings.some((finding) => finding.id === "gitops.manifest-validation"));
  assert(!report.findings.some((finding) => finding.id.startsWith("gitops.flux-interval.")));
  assert(!report.findings.some((finding) => finding.id.startsWith("gitops.flux-suspended.")));
});

withRepository({
  "README.md": "# Dataset",
  "LICENSE": "CC0-1.0",
  "data/people.csv": "id,name\n1,Ada\n",
}, (_root, report) => {
  assert.equal(report.classification.primary, "data-notebook");
  assert(report.findings.some((finding) => finding.id === "data.schema"));
});

withRepository({
  "README.md": "# Starter",
  "LICENSE": "MIT",
  "cookiecutter.json": "{\"project_name\": \"demo\"}",
  "{{cookiecutter.project_name}}/README.md": "# Generated project",
}, (_root, report) => {
  assert.equal(report.classification.primary, "template-example");
});

withRepository({
  "README.md": "# Community",
  "LICENSE": "MIT",
  "CODE_OF_CONDUCT.md": "# Code of conduct",
  "CONTRIBUTING.md": "# Contributing",
  "GOVERNANCE.md": "# Governance",
}, (_root, report) => {
  assert.equal(report.classification.primary, "community");
});

withRepository({
  "README.md": "# Brand assets",
  "LICENSE": "CC-BY-4.0",
  "assets/logo.png": "image",
  "assets/banner.svg": "<svg></svg>",
}, (_root, report) => {
  assert.equal(report.classification.primary, "assets");
});

withRepository({
  "README.md": "# Full stack monorepo",
  "LICENSE": "MIT",
  ".gitignore": "node_modules/\ntarget/",
  "frontend/package.json": JSON.stringify({ name: "frontend", private: true, dependencies: { react: "^19.0.0" }, scripts: { test: "node test.js", lint: "eslint ." } }),
  "frontend/package-lock.json": "{}",
  "frontend/app.jsx": "export function App() { return null; }",
  "frontend/test.js": "// test",
  "backend/pom.xml": "<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.5.1</version></parent><properties><java.version>21</java.version></properties></project>",
  "backend/mvnw": "#!/bin/sh",
  "backend/src/main/java/App.java": "class App {}",
  "backend/src/test/java/AppTest.java": "class AppTest {}",
}, (_root, report) => {
  assert(report.classification.traits.some((trait) => trait.id === "monorepo"));
  assert(report.classification.traits.some((trait) => trait.id === "mixed"));
});

console.log("analysis tests: ok");
