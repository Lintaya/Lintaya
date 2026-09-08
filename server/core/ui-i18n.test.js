const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const babel = require("../../vendor/babel.min.js");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, "app", file), "utf8");
function runtime() {
  let locale = "en";
  const context = vm.createContext({
    window: { dispatchEvent() {} }, navigator: { language: "en-US" },
    document: { getElementById: () => ({}), createElement: () => ({}), head: { appendChild() {} } },
    localStorage: { getItem: () => locale, setItem: (_, value) => { locale = value; } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    React: {
      useState: initial => [typeof initial === "function" ? initial() : initial, () => {}],
      useEffect() {}, useCallback: fn => fn, useRef: initial => ({ current: initial }),
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    },
  });
  vm.runInContext(read("i18n.js"), context);
  return context;
}
function visit(node, callback) {
  if (!node?.type) return;
  callback(node);
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "comments", "leadingComments", "trailingComments", "innerComments"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => visit(child, callback));
    else if (value?.type) visit(value, callback);
  }
}

test("Plane board blocks reuse task controls and read the selected connection", async () => {
  const context = runtime();
  const effects = [];
  const requests = [];
  context.window.addEventListener = () => {};
  context.window.removeEventListener = () => {};
  context.React.useEffect = effect => effects.push(effect);
  context.window.HQ_API = { request: async url => { requests.push(url); return { issues: [], members: [] }; } };
  vm.runInContext(`(() => { ${babel.transform(read("home.jsx"), { presets: ["react"] }).code} })()`, context);
  const panelProps = { contentScroll: true, fillHeight: false };
  const component = context.window.ConnectorBlockPanel({
    block: { connectorId: "plane-team", connectorType: "plane", blockId: "my-issues" }, panelProps,
  });
  const tree = component.type(component.props);
  const panel = tree.props.children[0];
  assert.equal(panel.props.contentScroll, true);
  assert.equal(panel.props.fillHeight, false);
  assert.match(renderedText(panel.props.titleExtra), /assigned to me/i);
  effects.forEach(effect => effect());
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(requests.includes("/api/connectors/plane-team/members"));
  assert.ok(requests.includes("/api/connectors/plane-team/issues?mine=true&limit=10"));
  assert.ok(requests.every(url => url.startsWith("/api/connectors/plane-team/")));
});
function renderedText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(renderedText).join(" ");
  if (typeof node !== "object") return String(node);
  if (typeof node.type === "function") return renderedText(node.type(node.props));
  return [node.props.title, node.props["aria-label"], node.props.placeholder, renderedText(node.props.children)].filter(Boolean).join(" ");
}

// `window.I18N.t` / `window.I18N?.t`, however it is spelled at the call site.
function isI18nT(node) {
  if (node?.type !== "MemberExpression" && node?.type !== "OptionalMemberExpression") return false;
  if (node.property?.name !== "t") return false;
  return node.object?.property?.name === "I18N" || node.object?.name === "I18N";
}

// Every view file gives window.I18N.t a short local name — `dsh`, `bct`, `mbt`,
// `vt`, and a dozen more. Those names are read out of the file itself so a new
// one is covered without anyone remembering to list it here.
function translationNames(ast) {
  const names = new Set();
  visit(ast, node => {
    if (node.type !== "VariableDeclarator" || node.id?.type !== "Identifier" || !node.init) return;
    if (isI18nT(node.init)) { names.add(node.id.name); return; }   // const t = window.I18N.t
    // An expression body on purpose: a plain function that merely translates
    // something deep inside it (repos.jsx's runGitAction, in its catch) is not
    // a translation helper, and treating it as one reads its own arguments as
    // translation keys.
    if (node.init.type !== "ArrowFunctionExpression" || node.init.body?.type === "BlockStatement") return;
    let delegates = false;
    visit(node.init.body, inner => { if (isI18nT(inner)) delegates = true; });
    if (delegates) names.add(node.id.name);
  });
  return names;
}

// Matching on the callee rather than on the key's prefix. Keying off `ui.` and
// `settings.` left about 60% of the strings unguarded — `connectors.*` among
// them, 346 keys covering the whole onboarding — which is how Spanish shipped
// reading "Auto-sync Todo cada 5 min": `Every` had been translated as `Todo`,
// and no test looked at that key.
test("all frontend JSX compiles and literal translation calls resolve in both languages", () => {
  const { strings } = runtime().window.I18N;
  for (const file of fs.readdirSync(path.join(root, "app")).filter(file => file.endsWith(".jsx"))) {
    const { ast } = babel.transform(read(file), { presets: ["react"], ast: true });
    const names = translationNames(ast);
    visit(ast, node => {
      if (node.type !== "CallExpression" && node.type !== "OptionalCallExpression") return;
      const callee = node.callee;
      if (!isI18nT(callee) && !(callee?.type === "Identifier" && names.has(callee.name))) return;
      const key = node.arguments?.[0]?.value;
      if (typeof key !== "string") return;
      for (const locale of ["en", "es"]) assert.ok(strings[locale][key], `${file}: missing ${locale} translation for ${key}`);
    });
  }
});

// Same widening as above, for the same reason: `boards.edit` was declared twice
// in each language block and only the later one survived, so the first — meant
// for the aria-label of a Dashboard's edit button — was dead and its call site
// had Spanish written into it by hand instead.
test("UI messages have matching interpolation fields and unique keys", () => {
  const { strings } = runtime().window.I18N;
  const fields = text => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();
  for (const key of Object.keys(strings.en)) {
    assert.ok(strings.es[key], key);
    assert.deepEqual(fields(strings.es[key]), fields(strings.en[key]), key);
  }
  const { ast } = babel.transform(read("i18n.js"), { ast: true, code: false });
  visit(ast, node => {
    if (node.type !== "ObjectExpression") return;
    const keys = node.properties.map(prop => prop.key?.value).filter(key => typeof key === "string");
    assert.equal(new Set(keys).size, keys.length, "duplicate translation key");
  });
});

test("assistant suggestions and built-in block rules follow language changes without reloading", () => {
  const context = runtime();
  for (const file of ["ai-chat.jsx", "block-builder.jsx"]) {
    vm.runInContext(`(() => { ${babel.transform(read(file), { presets: ["react"] }).code}
      window.${file === "ai-chat.jsx" ? "suggestions = getSuggestions" : "rules = BB_MD_RULES"}; })()`, context);
  }
  assert.match(context.window.suggestions()[0], /Summarize/);
  assert.match(context.window.rules(), /Rules for the Markdown/);
  context.window.I18N.setLocale("es");
  assert.match(context.window.suggestions()[0], /Resumen/);
  assert.match(context.window.rules(), /Reglas para el Markdown/);
});

test("approval empty state and container timestamps render in the selected language", () => {
  const context = runtime();
  vm.runInContext(`(() => { ${babel.transform(read("approvals.jsx"), { presets: ["react"] }).code} })()`, context);
  vm.runInContext(`(() => { ${babel.transform(read("containers.jsx"), { presets: ["react"] }).code} window.containerTimeAgo = timeAgo; })()`, context);
  for (const [locale, expected, timePattern] of [["en", "actions require human confirmation", /ago/], ["es", "acciones requieren confirmación humana", /hace/]]) {
    context.window.I18N.setLocale(locale);
    const text = renderedText(context.window.ApprovalCenterView());
    assert.ok(text.includes(expected), text);
    assert.match(context.window.containerTimeAgo(Date.now() - 300000), timePattern);
    assert.ok(!text.includes("{count}"));
  }
});
