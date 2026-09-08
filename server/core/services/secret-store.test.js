const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createSecretStore, createBitwardenSecretStore, secretKeyFor } = require("./secret-store");

function memoryStore() {
  const values = new Map();
  return {
    values,
    kvGet: (key) => values.has(key) ? { value: values.get(key) } : null,
    kvSet: (key, value) => values.set(key, value),
  };
}

test("local secret store encrypts values and round-trips them", () => {
  const memory = memoryStore();
  const store = createSecretStore({
    mode: "local",
    key: "a sufficiently long local key",
    ...memory,
  });

  store.set("gitlab2", { token: "gitlab-secret", refreshToken: "refresh-secret" });
  assert.deepEqual(store.get("gitlab2"), {
    token: "gitlab-secret",
    refreshToken: "refresh-secret",
  });
  assert.equal(memory.values.get(secretKeyFor("gitlab2")).ciphertext.includes("gitlab-secret"), false);
});

test("local secret store rejects tampered payloads", () => {
  const memory = memoryStore();
  const store = createSecretStore({ mode: "local", key: "a sufficiently long local key", ...memory });
  store.set("github", { token: "secret" });
  memory.values.get(secretKeyFor("github")).ciphertext = "tampered";
  assert.throws(() => store.get("github"), /could not be decrypted/);
});

test("local secret store clears a connection without affecting another", () => {
  const memory = memoryStore();
  const store = createSecretStore({ mode: "local", key: "a sufficiently long local key", ...memory });
  store.set("gitlab", { token: "a" });
  store.set("gitlab2", { token: "b" });
  store.clear("gitlab2");
  assert.deepEqual(store.get("gitlab"), { token: "a" });
  assert.deepEqual(store.get("gitlab2"), {});
});

// Fake `bw` CLI: a single in-memory table of Secure Note items, addressed the
// same way the real adapter addresses them (list --search by name, then get/
// edit/delete by id) so the adapter's own command construction is exercised,
// not just its JSON shuffling.
function fakeBw() {
  const items = new Map();
  let nextId = 1;
  const run = (args, session) => {
    assert.equal(session, "session-token", "bw commands must carry the unlocked session");
    const [cmd, sub] = args;
    if (cmd === "list" && sub === "items") {
      const search = args[args.indexOf("--search") + 1];
      return JSON.stringify([...items.values()].filter((item) => item.name === search));
    }
    if (cmd === "get" && sub === "notes") {
      return items.get(args[2])?.notes || "";
    }
    if (cmd === "get" && sub === "item") {
      return JSON.stringify(items.get(args[2]) || {});
    }
    if (cmd === "create" && sub === "item") {
      const decoded = JSON.parse(Buffer.from(args[2], "base64").toString("utf8"));
      const id = `item-${nextId++}`;
      items.set(id, { ...decoded, id });
      return JSON.stringify({ ...decoded, id });
    }
    if (cmd === "edit" && sub === "item") {
      const decoded = JSON.parse(Buffer.from(args[3], "base64").toString("utf8"));
      items.set(args[2], { ...decoded, id: args[2] });
      return JSON.stringify({ ...decoded, id: args[2] });
    }
    if (cmd === "delete" && sub === "item") {
      items.delete(args[2]);
      return "";
    }
    throw new Error(`unhandled bw command: ${args.join(" ")}`);
  };
  return { items, run };
}

test("bitwarden secret store creates one secure note per connection and round-trips it", () => {
  const bw = fakeBw();
  const store = createSecretStore({
    mode: "bitwarden",
    getSession: () => "session-token",
    run: bw.run,
  });

  store.set("gitlab2", { token: "gitlab-secret" });
  assert.deepEqual(store.get("gitlab2"), { token: "gitlab-secret" });
  assert.equal(bw.items.size, 1);
  const [item] = [...bw.items.values()];
  assert.equal(item.name, "lintaya-connector-secrets-gitlab2");
  assert.equal(item.type, 2);
  assert.equal(item.notes.includes("gitlab-secret"), true);
});

test("bitwarden secret store edits the existing item instead of duplicating it", () => {
  const bw = fakeBw();
  const store = createSecretStore({ mode: "bitwarden", getSession: () => "session-token", run: bw.run });

  store.set("github", { token: "first" });
  store.set("github", { token: "second" });

  assert.equal(bw.items.size, 1, "a second write must edit the same item, not create another");
  assert.deepEqual(store.get("github"), { token: "second" });
});

test("bitwarden secret store keeps connections independent and clear() only removes one", () => {
  const bw = fakeBw();
  const store = createSecretStore({ mode: "bitwarden", getSession: () => "session-token", run: bw.run });

  store.set("gitlab", { token: "a" });
  store.set("gitlab2", { token: "b" });
  store.clear("gitlab2");

  assert.deepEqual(store.get("gitlab"), { token: "a" });
  assert.deepEqual(store.get("gitlab2"), {});
  assert.equal(bw.items.size, 1);
});

test("bitwarden secret store fails closed with vault-locked when there is no unlocked session", () => {
  const store = createSecretStore({
    mode: "bitwarden",
    getSession: () => null,
    run: () => { throw new Error("bw must not run while locked"); },
  });

  assert.throws(() => store.get("gitlab"), (error) => error.code === "vault-locked");
  assert.throws(() => store.set("gitlab", { token: "x" }), (error) => error.code === "vault-locked");
  assert.throws(() => store.clear("gitlab"), (error) => error.code === "vault-locked");
});

test("bitwarden secret store requires a getSession() function", () => {
  assert.throws(() => createBitwardenSecretStore({}), TypeError);
});
