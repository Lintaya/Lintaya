// vault-seed.example.js — Demo vault data for VAULT_MODE=demo
// Copy this file to vault-seed.js and replace with your own entries.
// This file is safe to commit. vault-seed.js is gitignored.
module.exports = [
  {
    id: "1",
    service: "Example Service",
    user: "admin@example.com",
    secret: "change-me",
    tags: ["infra"],
    url: "https://example.com",
    notes: "",
    strength: "strong",
    lastUsed: "",
  },
];
