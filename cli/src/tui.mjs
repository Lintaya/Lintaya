import React, {useCallback, useEffect, useState} from "react";
import {Box, Text, render, useApp, useInput} from "ink";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const {defaultConfigPath, readConfig} = require("./config.js");
const {getJson} = require("./http-client.js");
const {VERSION, completionCandidates, run} = require("./index.js");
const h = React.createElement;

const CYAN = "#25e6e8";
const GLOW = "#9cfbff";
const INK = "#102a43";
const STEEL = "#7f96a8";
const MUTED = "gray";
const BRAND = "⛯ Lintaya";
const PIXEL_MARK = [
  [{text: "        ▄", color: INK}],
  [{text: "      ▄", color: INK}, {text: "█████", color: CYAN}, {text: "▄", color: INK}],
  [{text: "    ▄", color: INK}, {text: "█████████", color: STEEL}, {text: "▄", color: INK}],
  [{text: "    █", color: INK}, {text: " ▓ ▓ ▓ ", color: GLOW}, {text: "█", color: INK}],
  [{text: "    ▀", color: INK}, {text: "█████████", color: STEEL}, {text: "▀", color: INK}],
  [{text: "        █", color: STEEL}, {text: "●", color: CYAN}, {text: "█", color: STEEL}],
  [{text: "        █", color: STEEL}, {text: " │", color: INK}],
  [{text: "        █", color: STEEL}, {text: " │", color: INK}],
  [{text: "   ●────", color: CYAN}, {text: "┘", color: INK}, {text: " └────", color: STEEL}],
];
const COMMANDS = [
  {name: "logs", argument: "[connector]", description: "Show audited connector activity."},
  {name: "show", argument: "[connector]", description: "Show a connector detail panel."},
  {name: "refresh", argument: "", description: "Reload connectors, status, and logs."},
  {name: "help", argument: "", description: "Open this command reference."},
  {name: "quit", argument: "", description: "Exit the TUI."},
];

function tokenizeCommand(input) {
  const tokens = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s]+)/g;
  let match;
  while ((match = pattern.exec(input.trim()))) tokens.push((match[1] ?? match[2] ?? match[3]).replace(/\\(["'\\])/g, "$1"));
  return tokens;
}

function outputCapture() {
  let content = "";
  return {
    stream: {write(chunk) { content += String(chunk); return true; }},
    read() { return content.trimEnd(); },
  };
}

function coreSuggestionItems(commandText) {
  const tokens = tokenizeCommand(commandText);
  const candidates = completionCandidates(tokens);
  const startsNewWord = /\s$/.test(commandText);
  const prefix = startsNewWord ? tokens.join(" ") : tokens.slice(0, -1).join(" ");
  const current = startsNewWord ? "" : tokens.at(-1) || "";
  return candidates
    .filter(candidate => candidate.startsWith(current))
    .map(candidate => ({
      value: prefix ? `${prefix} ${candidate}` : candidate,
      label: prefix ? `${prefix} ${candidate}` : candidate,
      description: "CLI command",
    }));
}

function shortDate(value) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Never" : date.toISOString().slice(0, 16).replace("T", " ");
}

function connectorStatus(connector) {
  if (connector.liveStatus?.status) return connector.liveStatus.status.toUpperCase();
  return connector.configured ? "UNTESTED" : "NOT CONFIGURED";
}

function statusColor(status) {
  if (status === "OK") return "green";
  if (status === "ERROR") return "red";
  return "yellow";
}

function PixelMark() {
  return h(Box, {flexDirection: "column", flexShrink: 0},
    ...PIXEL_MARK.map((segments, index) => h(Text, {key: index},
      ...segments.map((segment, segmentIndex) => h(Text, {key: segmentIndex, color: segment.color}, segment.text)),
    )),
  );
}

function Detail({connector}) {
  if (!connector) return h(Text, {color: MUTED}, "No connectors are configured for this profile.");
  const status = connectorStatus(connector);
  const capabilities = connector.capabilities?.slice(0, 6).join(", ") || "None declared";
  const lastError = connector.liveStatus?.lastError;
  return h(Box, {flexDirection: "column", paddingX: 1},
    h(Box, {gap: 1},
      h(Text, {bold: true, color: CYAN}, connector.name),
      h(Text, {color: statusColor(status), bold: true}, status),
    ),
    h(Text, {color: MUTED}, `${connector.kind || connector.type || "Connector"} · ${connector.tier || "local"}`),
    h(Box, {marginTop: 1, flexDirection: "column"},
      h(Text, null, h(Text, {color: MUTED}, "Last sync: "), shortDate(connector.liveStatus?.lastSync)),
      h(Text, null, h(Text, {color: MUTED}, "Items: "), String(connector.liveStatus?.itemsSynced ?? "—")),
      h(Text, null, h(Text, {color: MUTED}, "Capabilities: "), capabilities),
      h(Text, null, h(Text, {color: MUTED}, "Modules: "), connector.modules?.map(module => module.label || module.id).join(", ") || "None"),
      h(Text, null, h(Text, {color: MUTED}, "Blocks: "), connector.blocks?.map(block => block.title || block.id).join(", ") || "None"),
    ),
    lastError ? h(Box, {marginTop: 1}, h(Text, {color: "red"}, `Last error: ${lastError}`)) : null,
  );
}

function LogViewer({connector}) {
  const entries = [...(connector?.log || [])].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 8);
  return h(Box, {flexDirection: "column", paddingX: 1},
    h(Text, {bold: true, color: CYAN}, `ACTIVITY LOG · ${connector?.name || "No connector selected"}`),
    entries.length === 0 ? h(Text, {color: MUTED}, "No audit entries for this connector.") : entries.map((entry, index) => h(Box, {key: `${entry.ts || "entry"}-${index}`, gap: 1},
      h(Text, {color: MUTED}, shortDate(entry.ts)),
      h(Text, {color: entry.level === "err" ? "red" : entry.level === "warn" ? "yellow" : "green"}, String(entry.level || "info").toUpperCase()),
      h(Text, {wrap: "truncate-end"}, entry.msg || entry.message || "Activity recorded"),
    )),
  );
}

function CommandHelp() {
  return h(Box, {flexDirection: "column", paddingX: 1},
    h(Text, {bold: true, color: CYAN}, "TUI COMMANDS"),
    ...COMMANDS.map(command => h(Text, {key: command.name}, h(Text, {color: "yellow"}, `${command.name} ${command.argument}`.trim()), `  ${command.description}`)),
    h(Text, {color: MUTED}, "All read-only CLI commands also work after ':'."),
    h(Text, {color: MUTED}, "Examples: :status · :connectors list · :block 1 · :boards list"),
    h(Text, {color: MUTED}, "Press : to enter a command, ? for this reference, and Tab to autocomplete."),
    h(Text, {color: MUTED}, "Profile mutations and completion setup remain normal-terminal commands."),
  );
}

function suggestionsFor(commandText, connectors) {
  const [verb = "", argument = ""] = commandText.trimStart().toLowerCase().split(/\s+/, 2);
  if ((verb === "logs" || verb === "show") && commandText.includes(" ")) {
    return connectors
      .filter(connector => connector.id.toLowerCase().startsWith(argument))
      .map(connector => ({value: `${verb} ${connector.id}`, label: `${verb} ${connector.id}`, description: connector.name}));
  }
  const tuiSuggestions = COMMANDS
    .filter(command => command.name.startsWith(verb))
    .map(command => ({value: command.name + (command.argument ? " " : ""), label: `${command.name} ${command.argument}`.trim(), description: command.description}));
  return tuiSuggestions.length || !commandText.trim() ? tuiSuggestions : coreSuggestionItems(commandText);
}

function CommandOutput({command, content, error}) {
  const lines = String(content || error || "No output.").split("\n");
  const visible = lines.slice(0, 18);
  return h(Box, {flexDirection: "column", paddingX: 1},
    h(Text, {bold: true, color: error ? "red" : CYAN}, `${error ? "COMMAND ERROR" : "CLI RESULT"} · :${command}`),
    h(Box, {marginTop: 1, flexDirection: "column"},
      ...visible.map((line, index) => h(Text, {key: index, color: error ? "red" : undefined, wrap: "truncate-end"}, line || " ")),
      lines.length > visible.length ? h(Text, {color: MUTED}, `… ${lines.length - visible.length} more lines. Run the command outside the TUI for the complete output.`) : null,
    ),
  );
}

function Dashboard({profile, env, configPath}) {
  const {exit} = useApp();
  const [connectors, setConnectors] = useState([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commandError, setCommandError] = useState("");
  const [commandMode, setCommandMode] = useState(false);
  const [commandText, setCommandText] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [panel, setPanel] = useState("details");
  const [commandResult, setCommandResult] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [data, statusById] = await Promise.all([
        getJson({baseUrl: profile.url, token: profile.token, requestPath: "/api/connectors"}),
        getJson({baseUrl: profile.url, token: profile.token, requestPath: "/api/connectors/status"}),
      ]);
      const enriched = (Array.isArray(data) ? data : []).map(connector => ({...connector, log: statusById?.[connector.id]?.log || []}));
      setConnectors(enriched);
      setSelected(current => Math.min(current, Math.max(0, enriched.length - 1)));
      setUpdatedAt(new Date());
    } catch (fetchError) {
      setError(fetchError.message);
      setConnectors([]);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runCommand = useCallback(() => {
    const tokens = tokenizeCommand(commandText);
    const [verb = "", connectorId] = tokens.map(token => token.toLowerCase());
    const targetIndex = connectorId ? connectors.findIndex(connector => connector.id.toLowerCase() === connectorId) : selected;
    setCommandMode(false);
    setCommandText("");
    setCommandError("");
    if (!verb) return;
    if (verb === "help" || verb === "?") return setPanel("help");
    if (verb === "refresh") return refresh();
    if (verb === "quit" || verb === "exit") return exit();
    if (verb === "logs" || verb === "show") {
      if (targetIndex < 0 || !connectors[targetIndex]) return setCommandError(`Connector '${connectorId}' was not found.`);
      setSelected(targetIndex);
      return setPanel(verb === "logs" ? "logs" : "details");
    }
    if (["tui", "completion", "__complete"].includes(verb) || (verb === "profile" && ["add", "use", "remove"].includes(connectorId))) {
      return setCommandError(`Run ':${verb}' from the normal terminal, not inside the TUI.`);
    }
    const capture = outputCapture();
    run(tokens, {env, configPath, stdout: capture.stream})
      .then(() => {
        setCommandResult({command: commandText.trim(), content: capture.read(), error: ""});
        setPanel("command");
      })
      .catch(runError => {
        setCommandResult({command: commandText.trim(), content: "", error: runError.message});
        setPanel("command");
      });
  }, [commandText, configPath, connectors, env, exit, refresh, selected]);

  const suggestions = suggestionsFor(commandText, connectors);

  useInput((input, key) => {
    if (commandMode) {
      if (key.escape) {
        setCommandMode(false);
        setCommandText("");
        return;
      }
      if (key.return) return runCommand();
      if (key.tab) {
        const suggestion = suggestions[suggestionIndex % Math.max(1, suggestions.length)];
        if (suggestion) {
          setCommandText(suggestion.value);
          setSuggestionIndex(current => current + 1);
        }
        return;
      }
      if (key.backspace || key.delete) return setCommandText(current => current.slice(0, -1));
      if (input && !key.ctrl && !key.meta) {
        setSuggestionIndex(0);
        setCommandText(current => current + input);
      }
      return;
    }
    if (input === "q" || key.escape) exit();
    if (input === "?") {
      setPanel("help");
      return;
    }
    if (input === ":") {
      setCommandMode(true);
      setCommandText("");
      return;
    }
    if (input === "r") refresh();
    if (key.downArrow || input === "j") {
      setPanel("details");
      setSelected(current => Math.min(current + 1, Math.max(0, connectors.length - 1)));
    }
    if (key.upArrow || input === "k") {
      setPanel("details");
      setSelected(current => Math.max(current - 1, 0));
    }
  }, {isActive: true});

  const selectedConnector = connectors[selected];
  return h(Box, {flexDirection: "column", width: "100%"},
    h(Box, {borderStyle: "round", borderColor: CYAN, flexDirection: "column", paddingX: 1},
      h(Box, {justifyContent: "space-between"},
        h(Text, {bold: true, color: CYAN}, `${BRAND}  CLI ${VERSION}`),
        h(Text, {color: MUTED}, "Terminal Operations Console"),
      ),
      h(Box, {marginTop: 1, gap: 2},
        h(PixelMark),
        h(Box, {flexDirection: "column", justifyContent: "center", paddingBottom: 1},
          h(Text, {bold: true, color: CYAN}, "L I N T A Y A"),
          h(Text, {bold: true}, "Signal clarity for your connected work."),
          h(Text, {color: MUTED}, `Profile: ${profile.name}  ·  ${profile.url}`),
          h(Text, {color: MUTED}, loading ? "Refreshing connectors…" : `Updated: ${updatedAt?.toLocaleTimeString() || "—"}`),
        ),
      ),
      h(Box, {marginTop: 1, borderStyle: "single", borderColor: "gray", minHeight: 14},
        h(Box, {width: "42%", flexDirection: "column", paddingX: 1},
          h(Text, {bold: true, color: CYAN}, `CONNECTORS (${connectors.length})`),
          loading ? h(Text, {color: MUTED}, "Loading…") : null,
          connectors.map((connector, index) => {
            const active = index === selected;
            const status = connectorStatus(connector);
            return h(Text, {key: connector.id, inverse: active, color: active ? "black" : statusColor(status)}, `${active ? "›" : " "} ${connector.name}  ${status}`);
          }),
        ),
        h(Box, {width: "58%", borderStyle: "single", borderLeft: true, borderTop: false, borderRight: false, borderBottom: false, borderColor: "gray", flexDirection: "column"},
      error ? h(Box, {padding: 1}, h(Text, {color: "red"}, error)) : panel === "logs" ? h(LogViewer, {connector: selectedConnector}) : panel === "help" ? h(CommandHelp) : panel === "command" ? h(CommandOutput, commandResult || {}) : h(Detail, {connector: selectedConnector}),
        ),
      ),
      commandError ? h(Text, {color: "red"}, commandError) : null,
      commandMode ? h(Box, {flexDirection: "column", borderStyle: "single", borderColor: CYAN, paddingX: 1},
        h(Box, null, h(Text, {color: CYAN}, ":"), h(Text, null, commandText), h(Text, {color: MUTED}, "▌")),
        ...suggestions.slice(0, 4).map((suggestion, index) => h(Text, {key: suggestion.value, color: index === suggestionIndex % Math.max(1, suggestions.length) ? CYAN : MUTED}, `${index === suggestionIndex % Math.max(1, suggestions.length) ? "›" : " "} ${suggestion.label}  ${suggestion.description}`)),
      ) : null,
      h(Box, {marginTop: 1, justifyContent: "space-between"},
        h(Text, {color: MUTED}, "↑/↓ or j/k navigate · : commands · ? help · r refresh · q quit"),
        h(Text, {color: CYAN}, BRAND),
      ),
    ),
  );
}

function SetupRequired() {
  const {exit} = useApp();
  useInput((input, key) => {
    if (input === "q" || key.escape) exit();
  });
  return h(Box, {borderStyle: "round", borderColor: CYAN, flexDirection: "column", padding: 1},
    h(Text, {bold: true, color: CYAN}, `${BRAND}  CLI ${VERSION}`),
    h(PixelMark),
    h(Text, {bold: true}, "No active profile."),
    h(Text, {color: MUTED}, "Create one first:"),
    h(Text, {color: "yellow"}, "lintaya profile add local --url http://localhost:3001"),
    h(Text, {color: MUTED}, "Press q or Esc to quit."),
  );
}

export async function startTui({env = process.env, configPath = defaultConfigPath(env)} = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("lintaya tui requires an interactive terminal");
  }
  const config = await readConfig(configPath);
  const profileName = config.activeProfile;
  const profile = profileName && config.profiles[profileName];
  const tree = profile ? h(Dashboard, {profile: {...profile, name: profileName}, env, configPath}) : h(SetupRequired);
  const app = render(tree, {exitOnCtrlC: true});
  await app.waitUntilExit();
}
