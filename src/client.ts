import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "./client.css";
import {
  resolveLocale,
  translate,
  type Locale,
  type TranslationKey,
} from "./i18n.js";
import {
  isValidSessionName,
  type AgentLaunch,
  type ClientMessage,
  type ServerMessage,
} from "./protocol.js";

type Agent = AgentLaunch["agent"];
type AgentMode = AgentLaunch["mode"];

type ModeOption = {
  mode: AgentMode;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  danger?: boolean;
};

type ConnectionState = "connecting" | "connected" | "offline";

type SessionTab = {
  name: string;
  container: HTMLDivElement;
  terminal: Terminal;
  fitAddon: FitAddon;
  subscribeTimer: number | undefined;
  subscribeDelay: number;
  state: ConnectionState;
  activeAgent: Agent | null;
  draft: string;
  closed: boolean;
};

const AGENT_MODES: Record<Agent, ModeOption[]> = {
  claude: [
    {
      mode: "manual",
      labelKey: "claudeManualLabel",
      descriptionKey: "claudeManualDescription",
    },
    {
      mode: "auto",
      labelKey: "claudeAutoLabel",
      descriptionKey: "claudeAutoDescription",
    },
    {
      mode: "plan",
      labelKey: "claudePlanLabel",
      descriptionKey: "claudePlanDescription",
    },
    {
      mode: "bypass",
      labelKey: "claudeBypassLabel",
      descriptionKey: "claudeBypassDescription",
      danger: true,
    },
  ],
  codex: [
    {
      mode: "default",
      labelKey: "codexDefaultLabel",
      descriptionKey: "codexDefaultDescription",
    },
    {
      mode: "read-only",
      labelKey: "codexReadOnlyLabel",
      descriptionKey: "codexReadOnlyDescription",
    },
    {
      mode: "auto",
      labelKey: "codexAutoLabel",
      descriptionKey: "codexAutoDescription",
    },
    {
      mode: "bypass",
      labelKey: "codexBypassLabel",
      descriptionKey: "codexBypassDescription",
      danger: true,
    },
  ],
};

const terminalViews = requiredElement<HTMLDivElement>("terminal-views");
const terminalShell = requiredElement<HTMLElement>("terminal-shell");
const sessionTabsElement = requiredElement<HTMLDivElement>("session-tabs");
const addSessionButton = requiredElement<HTMLButtonElement>("add-session");
const sessionPanelOverlay = requiredElement<HTMLDivElement>("session-panel-overlay");
const closeSessionPanelButton = requiredElement<HTMLButtonElement>("close-session-panel");
const sessionInput = requiredElement<HTMLInputElement>("session-input");
const sessionNameError = requiredElement<HTMLParagraphElement>("session-name-error");
const createSessionButton = requiredElement<HTMLButtonElement>("create-session");
const widthButton = requiredElement<HTMLButtonElement>("terminal-width");
const localeButton = requiredElement<HTMLButtonElement>("locale-toggle");
const statusElement = requiredElement<HTMLSpanElement>("connection-status");
const sessionElement = requiredElement<HTMLSpanElement>("session-name");
const composer = requiredElement<HTMLTextAreaElement>("composer");
const ctrlButton = requiredElement<HTMLButtonElement>("modifier-ctrl");
const altButton = requiredElement<HTMLButtonElement>("modifier-alt");
const quickClaudeButton = requiredElement<HTMLButtonElement>("quick-claude");
const quickCodexButton = requiredElement<HTMLButtonElement>("quick-codex");
const agentSettingsButton = requiredElement<HTMLButtonElement>("agent-settings");
const pickFilesButton = requiredElement<HTMLButtonElement>("pick-files");
const fileInput = requiredElement<HTMLInputElement>("file-input");
const notice = requiredElement<HTMLParagraphElement>("notice");
const agentPanelOverlay = requiredElement<HTMLDivElement>("agent-panel-overlay");
const closeAgentPanelButton = requiredElement<HTMLButtonElement>("close-agent-panel");
const agentModeOptions = requiredElement<HTMLDivElement>("agent-mode-options");
const agentModeHelp = requiredElement<HTMLParagraphElement>("agent-mode-help");

const sessionTabs = new Map<string, SessionTab>();
let activeSession: SessionTab | null = null;
let connectionSocket: WebSocket | null = null;
let connectionTimeout: number | undefined;
let reconnectTimer: number | undefined;
let reconnectDelay = 500;
let heartbeatTimer: number | undefined;
let heartbeatTimeout: number | undefined;
let closedByPage = false;
let ctrlLatched = false;
let altLatched = false;
let useTuiWidth = false;
let panelAgent: Agent = "claude";
let noticeTimer: number | undefined;
let locale = preferredLocale();

function preferredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem("remote-code-agent:locale");
    if (stored === "en-US" || stored === "zh-TW") {
      return stored;
    }
  } catch {
    // Browser language detection remains available when storage is disabled.
  }
  return resolveLocale(
    window.navigator.languages.length > 0
      ? window.navigator.languages
      : [window.navigator.language],
  );
}

function storedMode(agent: Agent, fallback: AgentMode): AgentMode {
  try {
    const stored = window.localStorage.getItem(`remote-code-agent:${agent}:mode`);
    if (AGENT_MODES[agent].some((option) => option.mode === stored)) {
      return stored as AgentMode;
    }
  } catch {
    // Storage may be unavailable in private browsing; in-memory defaults still work.
  }
  return fallback;
}

const selectedModes: Record<Agent, AgentMode> = {
  claude: storedMode("claude", "auto"),
  codex: storedMode("codex", "auto"),
};

const TUI_COLUMNS = 80;
const CONNECTION_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id}`);
  }
  return element as T;
}

function text(
  key: TranslationKey,
  values: Record<string, string | number> = {},
): string {
  return translate(locale, key, values);
}

function applyLocale(): void {
  document.documentElement.lang = locale;

  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    element.textContent = text(element.dataset.i18n as TranslationKey);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((element) => {
    element.title = text(element.dataset.i18nTitle as TranslationKey);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", text(element.dataset.i18nAriaLabel as TranslationKey));
  });
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-i18n-placeholder]")
    .forEach((element) => {
      element.placeholder = text(element.dataset.i18nPlaceholder as TranslationKey);
    });

  renderSessionTabs();
  updateActiveStatus();
  updateAgentButtons();
  if (!agentPanelOverlay.hidden) {
    renderAgentPanel();
  }
  fitAndResize();
}

const SESSION_TABS_STORAGE_KEY = "remote-code-agent:session-tabs";

function sessionName(): string {
  return activeSession?.name ?? "main";
}

function sessionFromLocation(): string {
  const requested = new URLSearchParams(window.location.search).get("session");
  return requested && isValidSessionName(requested) ? requested : "main";
}

function storedSessionNames(): string[] {
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(SESSION_TABS_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(stored)) {
      return [];
    }
    return stored.filter(
      (value, index): value is string =>
        typeof value === "string" &&
        isValidSessionName(value) &&
        stored.indexOf(value) === index,
    );
  } catch {
    return [];
  }
}

function saveSessionTabs(): void {
  try {
    window.localStorage.setItem(
      SESSION_TABS_STORAGE_KEY,
      JSON.stringify(Array.from(sessionTabs.keys())),
    );
  } catch {
    // Session tabs remain available until the page is closed when storage is unavailable.
  }
}

function statusKey(state: ConnectionState): TranslationKey {
  return state === "connected"
    ? "connected"
    : state === "offline"
      ? "reconnecting"
      : "connecting";
}

function updateActiveStatus(): void {
  if (!activeSession) {
    return;
  }
  const key = statusKey(activeSession.state);
  statusElement.dataset.state = activeSession.state;
  statusElement.dataset.i18n = key;
  statusElement.textContent = text(key);
}

function setSessionState(tab: SessionTab, state: ConnectionState): void {
  tab.state = state;
  renderSessionTabs();
  if (tab === activeSession) {
    updateActiveStatus();
  }
}

function renderSessionTabs(): void {
  const keepOne = sessionTabs.size === 1;
  sessionTabsElement.replaceChildren(
    ...Array.from(sessionTabs.values(), (tab) => {
      const item = document.createElement("div");
      const select = document.createElement("button");
      const status = document.createElement("span");
      const label = document.createElement("span");
      const close = document.createElement("button");
      const selected = tab === activeSession;

      item.className = "session-tab";
      item.classList.toggle("active", selected);
      item.dataset.state = tab.state;

      select.type = "button";
      select.className = "session-tab-select";
      select.dataset.sessionName = tab.name;
      select.setAttribute("role", "tab");
      select.setAttribute("aria-controls", tab.container.id);
      select.setAttribute("aria-selected", String(selected));
      select.tabIndex = selected ? 0 : -1;
      select.title = `${tab.name} · ${text(statusKey(tab.state))}`;
      select.addEventListener("click", () => activateSession(tab.name));

      status.className = "session-tab-status";
      status.setAttribute("aria-hidden", "true");
      label.className = "session-tab-label";
      label.textContent = tab.name;
      select.append(status, label);

      close.type = "button";
      close.className = "session-tab-close";
      close.textContent = "×";
      close.disabled = keepOne;
      close.title = keepOne
        ? text("keepOneSession")
        : text("closeSession", { session: tab.name });
      close.setAttribute("aria-label", close.title);
      close.addEventListener("click", () => closeSessionTab(tab.name));

      item.append(select, close);
      return item;
    }),
  );
}

function updateLocation(session: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("session", session);
  window.history.replaceState(null, "", url);
}

function activateSession(name: string): void {
  const next = sessionTabs.get(name);
  if (!next) {
    return;
  }

  if (activeSession) {
    activeSession.draft = composer.value;
    activeSession.container.hidden = true;
  }
  activeSession = next;
  next.container.hidden = false;
  composer.value = next.draft;
  terminalShell.scrollLeft = 0;
  sessionElement.textContent = next.name;
  document.title = `${next.name} · Remote Code`;
  updateLocation(next.name);
  updateActiveStatus();
  updateAgentButtons();
  renderSessionTabs();
  saveSessionTabs();

  window.requestAnimationFrame(() => {
    fitAndResize();
    next.terminal.focus();
    Array.from(sessionTabsElement.querySelectorAll<HTMLButtonElement>(".session-tab-select"))
      .find((button) => button.dataset.sessionName === next.name)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

function createTerminal(container: HTMLDivElement): { terminal: Terminal; fitAddon: FitAddon } {
  const terminal = new Terminal({
    allowProposedApi: true,
    allowTransparency: false,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: "bar",
    drawBoldTextInBrightColors: true,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 14,
    letterSpacing: 0,
    lineHeight: 1.15,
    scrollback: 20_000,
    theme: {
      background: "#090d0b",
      foreground: "#e4ede8",
      cursor: "#9af5b3",
      cursorAccent: "#090d0b",
      selectionBackground: "#2a6b46aa",
      black: "#111814",
      red: "#ff7b72",
      green: "#7ee787",
      yellow: "#e3b341",
      blue: "#79c0ff",
      magenta: "#d2a8ff",
      cyan: "#a5d6ff",
      white: "#e6edf3",
      brightBlack: "#6e7681",
      brightRed: "#ffa198",
      brightGreen: "#aff5b4",
      brightYellow: "#f2cc60",
      brightBlue: "#a5d6ff",
      brightMagenta: "#d8b9ff",
      brightCyan: "#b6e3ff",
      brightWhite: "#ffffff",
    },
  });
  const fitAddon = new FitAddon();
  const unicodeAddon = new Unicode11Addon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(unicodeAddon);
  terminal.loadAddon(
    new WebLinksAddon((_event, uri) => {
      window.open(uri, "_blank", "noopener,noreferrer");
    }),
  );
  terminal.unicode.activeVersion = "11";
  terminal.open(container);
  return { terminal, fitAddon };
}

function attachTerminalTouch(tab: SessionTab): void {
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let axis: "pending" | "horizontal" | "vertical" = "pending";
  const reset = () => {
    axis = "pending";
  };

  tab.container.addEventListener("touchstart", (event) => {
    const touch = event.touches.length === 1 ? event.touches.item(0) : null;
    if (!touch) {
      reset();
      return;
    }
    startX = touch.clientX;
    startY = touch.clientY;
    lastY = touch.clientY;
    axis = "pending";
  }, { passive: true });

  tab.container.addEventListener("touchmove", (event) => {
    const touch = event.touches.length === 1 ? event.touches.item(0) : null;
    if (!touch) {
      reset();
      return;
    }
    if (axis === "pending") {
      const horizontalDistance = Math.abs(touch.clientX - startX);
      const verticalDistance = Math.abs(touch.clientY - startY);
      if (Math.max(horizontalDistance, verticalDistance) < 8) {
        return;
      }
      axis = verticalDistance > horizontalDistance ? "vertical" : "horizontal";
    }
    if (axis !== "vertical") {
      return;
    }
    const deltaY = lastY - touch.clientY;
    lastY = touch.clientY;
    event.preventDefault();
    tab.terminal.element?.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY,
    }));
  }, { passive: false });

  tab.container.addEventListener("touchend", reset, { passive: true });
  tab.container.addEventListener("touchcancel", reset, { passive: true });
}

function createSessionTab(name: string): SessionTab {
  const container = document.createElement("div");
  container.id = `terminal-${name}`;
  container.className = "terminal-view";
  container.hidden = true;
  container.setAttribute("role", "tabpanel");
  container.setAttribute("aria-label", name);
  terminalViews.append(container);

  const { terminal, fitAddon } = createTerminal(container);
  const tab: SessionTab = {
    name,
    container,
    terminal,
    fitAddon,
    subscribeTimer: undefined,
    subscribeDelay: 500,
    state: "connecting",
    activeAgent: null,
    draft: "",
    closed: false,
  };
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown" || event.isComposing || (!ctrlLatched && !altLatched)) {
      return true;
    }
    const data = modifiedKey(event.key);
    if (!data) {
      return true;
    }
    event.preventDefault();
    sendSessionInput(tab, data);
    clearModifiers();
    return false;
  });
  terminal.onData((data) => sendSessionInput(tab, data));
  attachTerminalTouch(tab);
  sessionTabs.set(name, tab);
  return tab;
}

function openSessionTab(name: string): void {
  const existing = sessionTabs.get(name);
  if (existing) {
    activateSession(name);
    showNotice(text("sessionAlreadyOpen", { session: name }));
    return;
  }
  const tab = createSessionTab(name);
  activateSession(name);
  subscribeSession(tab);
  connectTerminal();
}

function closeSessionTab(name: string): void {
  if (sessionTabs.size === 1) {
    return;
  }
  const tab = sessionTabs.get(name);
  if (!tab) {
    return;
  }

  const names = Array.from(sessionTabs.keys());
  const index = names.indexOf(name);
  const wasActive = tab === activeSession;
  if (wasActive) {
    tab.draft = composer.value;
    activeSession = null;
  }
  sendConnectionMessage({ type: "unsubscribe", session: name });
  tab.closed = true;
  window.clearTimeout(tab.subscribeTimer);
  tab.terminal.dispose();
  tab.container.remove();
  sessionTabs.delete(name);

  if (wasActive) {
    activateSession(names[index + 1] ?? names[index - 1]!);
  } else {
    renderSessionTabs();
    saveSessionTabs();
  }
  showNotice(text("sessionClosed", { session: name }));
}

function connectionUrl(): URL {
  const url = new URL("/ws", window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.search = "";
  return url;
}

function sendConnectionMessage(message: ClientMessage): boolean {
  if (connectionSocket?.readyState !== WebSocket.OPEN) {
    return false;
  }
  try {
    connectionSocket.send(JSON.stringify(message));
    return true;
  } catch {
    replaceConnection(reconnectDelay);
    return false;
  }
}

function subscribeSession(tab: SessionTab): void {
  if (tab.closed) {
    return;
  }
  window.clearTimeout(tab.subscribeTimer);
  tab.subscribeTimer = undefined;
  setSessionState(tab, "connecting");
  sendConnectionMessage({ type: "subscribe", session: tab.name });
}

function scheduleSessionSubscribe(tab: SessionTab): void {
  if (tab.closed) {
    return;
  }
  window.clearTimeout(tab.subscribeTimer);
  setSessionState(tab, "offline");
  tab.subscribeTimer = window.setTimeout(() => {
    tab.subscribeTimer = undefined;
    if (connectionSocket?.readyState === WebSocket.OPEN) {
      subscribeSession(tab);
    } else {
      connectTerminal();
    }
  }, tab.subscribeDelay);
  tab.subscribeDelay = Math.min(tab.subscribeDelay * 2, 10_000);
}

function clearConnectionTimers(): void {
  window.clearTimeout(connectionTimeout);
  window.clearInterval(heartbeatTimer);
  window.clearTimeout(heartbeatTimeout);
  connectionTimeout = undefined;
  heartbeatTimer = undefined;
  heartbeatTimeout = undefined;
}

function scheduleReconnect(delay = reconnectDelay): void {
  if (closedByPage) {
    return;
  }
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(connectTerminal, delay);
  if (delay > 0) {
    reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
  }
}

function markSessionsOffline(): void {
  for (const tab of sessionTabs.values()) {
    window.clearTimeout(tab.subscribeTimer);
    tab.subscribeTimer = undefined;
    setSessionState(tab, "offline");
  }
}

function replaceConnection(delay = 0): void {
  const socket = connectionSocket;
  connectionSocket = null;
  clearConnectionTimers();
  if (socket) {
    try {
      socket.close();
    } catch {
      // A connecting browser socket can reject close; dropping the reference is sufficient.
    }
  }
  markSessionsOffline();
  scheduleReconnect(delay);
}

function probeConnection(): void {
  const socket = connectionSocket;
  if (!socket) {
    scheduleReconnect(0);
    return;
  }
  if (socket.readyState !== WebSocket.OPEN) {
    if (socket.readyState !== WebSocket.CONNECTING) {
      replaceConnection();
    }
    return;
  }
  if (heartbeatTimeout !== undefined) {
    return;
  }
  if (!sendConnectionMessage({ type: "ping" })) {
    return;
  }
  heartbeatTimeout = window.setTimeout(() => {
    if (connectionSocket === socket) {
      replaceConnection();
    }
  }, HEARTBEAT_TIMEOUT_MS);
}

function connectTerminal(): void {
  if (closedByPage || connectionSocket) {
    return;
  }
  window.clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  for (const tab of sessionTabs.values()) {
    setSessionState(tab, "connecting");
  }

  const socket = new WebSocket(connectionUrl());
  connectionSocket = socket;
  connectionTimeout = window.setTimeout(() => {
    if (connectionSocket === socket && socket.readyState !== WebSocket.OPEN) {
      replaceConnection(reconnectDelay);
    }
  }, CONNECTION_TIMEOUT_MS);

  socket.addEventListener("open", () => {
    if (connectionSocket !== socket) {
      return;
    }
    window.clearTimeout(connectionTimeout);
    connectionTimeout = undefined;
    reconnectDelay = 500;
    for (const tab of sessionTabs.values()) {
      subscribeSession(tab);
      if (connectionSocket !== socket) {
        return;
      }
    }
    heartbeatTimer = window.setInterval(probeConnection, HEARTBEAT_INTERVAL_MS);
  });

  socket.addEventListener("message", (event) => {
    if (connectionSocket !== socket) {
      return;
    }
    const message = parseServerMessage(event.data);
    if (!message) {
      return;
    }

    if (message.type === "pong") {
      window.clearTimeout(heartbeatTimeout);
      heartbeatTimeout = undefined;
      return;
    }

    const tab =
      "session" in message && typeof message.session === "string"
        ? sessionTabs.get(message.session)
        : undefined;
    if (message.type === "output") {
      tab?.terminal.write(message.data);
    } else if (message.type === "ready" && tab) {
      window.clearTimeout(tab.subscribeTimer);
      tab.subscribeTimer = undefined;
      tab.subscribeDelay = 500;
      setSessionState(tab, "connected");
      if (tab === activeSession) {
        tab.terminal.focus();
        fitAndResize();
      }
    } else if (message.type === "closed" && tab) {
      scheduleSessionSubscribe(tab);
    } else if (message.type === "agent" && tab) {
      selectedModes[message.agent] = message.mode;
      tab.activeAgent = message.agent;
      if (tab === activeSession) {
        updateAgentButtons();
        showNotice(
          text(message.created ? "agentOpened" : "agentSwitched", {
            agent: agentName(message.agent),
            mode: modeLabel(message.agent, message.mode),
          }),
        );
      }
    } else if (message.type === "error") {
      tab?.terminal.writeln(`\r\n\x1b[31m${message.message}\x1b[0m`);
      if (!tab || tab === activeSession) {
        showNotice(message.message, "error", 6_000);
      }
    }
  });

  socket.addEventListener("close", () => {
    if (connectionSocket !== socket) {
      return;
    }
    connectionSocket = null;
    clearConnectionTimers();
    markSessionsOffline();
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    if (connectionSocket === socket) {
      replaceConnection(reconnectDelay);
    }
  });
}

function showNotice(message: string, state: "ok" | "error" = "ok", timeout = 4_000): void {
  window.clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.dataset.state = state;
  notice.hidden = false;
  noticeTimer = window.setTimeout(() => {
    notice.hidden = true;
  }, timeout);
}

function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const message: unknown = JSON.parse(raw);
    return message && typeof message === "object" && "type" in message
      ? message as ServerMessage
      : null;
  } catch {
    return null;
  }
}

function sendInput(data: string): void {
  if (activeSession) {
    sendSessionInput(activeSession, data);
  }
}

function sendSessionInput(tab: SessionTab, data: string): void {
  if (tab.state === "connected") {
    sendConnectionMessage({ type: "input", session: tab.name, data });
  }
}

function agentName(agent: Agent): string {
  return agent === "claude" ? "Claude" : "Codex";
}

function modeOption(agent: Agent, mode = selectedModes[agent]): ModeOption {
  return (
    AGENT_MODES[agent].find((option) => option.mode === mode) ??
    AGENT_MODES[agent][0]!
  );
}

function modeLabel(agent: Agent, mode = selectedModes[agent]): string {
  return text(modeOption(agent, mode).labelKey);
}

function updateAgentButtons(): void {
  quickClaudeButton.textContent = `Claude · ${modeLabel("claude")}`;
  quickCodexButton.textContent = `Codex · ${modeLabel("codex")}`;
  quickClaudeButton.classList.toggle("active", activeSession?.activeAgent === "claude");
  quickCodexButton.classList.toggle("active", activeSession?.activeAgent === "codex");
}

function selectMode(agent: Agent, mode: AgentMode): void {
  selectedModes[agent] = mode;
  try {
    window.localStorage.setItem(`remote-code-agent:${agent}:mode`, mode);
  } catch {
    // Keep the current page selection when persistent storage is unavailable.
  }
  updateAgentButtons();
  renderAgentPanel();
}

function renderAgentPanel(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-agent-choice]").forEach((button) => {
    const selected = button.dataset.agentChoice === panelAgent;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });

  agentModeOptions.replaceChildren(
    ...AGENT_MODES[panelAgent].map((option) => {
      const button = document.createElement("button");
      const title = document.createElement("strong");
      const description = document.createElement("span");
      button.type = "button";
      button.className = "agent-mode";
      button.classList.toggle("active", option.mode === selectedModes[panelAgent]);
      button.classList.toggle("danger", Boolean(option.danger));
      button.setAttribute("aria-pressed", String(option.mode === selectedModes[panelAgent]));
      title.textContent = text(option.labelKey);
      description.textContent = text(option.descriptionKey);
      button.append(title, description);
      button.addEventListener("click", () => selectMode(panelAgent, option.mode));
      return button;
    }),
  );

  const selected = modeOption(panelAgent);
  agentModeHelp.textContent = selected.danger
    ? text("modeDangerHelp")
    : text("modeCurrent", {
        agent: agentName(panelAgent),
        mode: text(selected.labelKey),
      });
}

function openAgentPanel(): void {
  renderAgentPanel();
  agentPanelOverlay.hidden = false;
  closeAgentPanelButton.focus();
}

function closeAgentPanel(): void {
  agentPanelOverlay.hidden = true;
  agentSettingsButton.focus();
}

function launchAgent(agent: Agent): void {
  const selected = modeOption(agent);
  if (
    selected.danger &&
    !window.confirm(
      text("bypassConfirm", {
        agent: agentName(agent),
        mode: text(selected.labelKey),
      }),
    )
  ) {
    return;
  }

  if (!activeSession || activeSession.state !== "connected") {
    showNotice(text("terminalUnavailable"), "error");
    return;
  }

  const launch = { agent, mode: selectedModes[agent] } as AgentLaunch;
  sendConnectionMessage({
    type: "launch",
    session: activeSession.name,
    ...launch,
  });
  showNotice(text("agentOpening", { agent: agentName(agent), mode: text(selected.labelKey) }));
}

function fitAndResize(): void {
  if (!activeSession || !terminalShell.clientWidth || !terminalShell.clientHeight) {
    return;
  }

  const { container: terminalElement, fitAddon, terminal } = activeSession;
  try {
    terminalElement.style.width = "100%";

    if (useTuiWidth) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const dimensions = fitAddon.proposeDimensions();
        if (!dimensions || dimensions.cols >= TUI_COLUMNS) {
          break;
        }

        const width = terminalElement.getBoundingClientRect().width;
        terminalElement.style.width = `${Math.ceil(
          (width * TUI_COLUMNS) / Math.max(dimensions.cols, 1),
        )}px`;
      }
    }

    fitAddon.fit();
    widthButton.textContent = useTuiWidth
      ? text("widthFixed", { columns: TUI_COLUMNS })
      : text("widthAuto");
    widthButton.setAttribute("aria-pressed", String(useTuiWidth));
    widthButton.title = useTuiWidth
      ? text("widthFixedTitle", { columns: terminal.cols })
      : text("widthAutoTitle", { columns: terminal.cols });

    if (activeSession.state === "connected") {
      sendConnectionMessage({
        type: "resize",
        session: activeSession.name,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    }
  } catch {
    // The next ResizeObserver event retries once the element has dimensions.
  }
}

widthButton.addEventListener("click", () => {
  useTuiWidth = !useTuiWidth;
  terminalShell.scrollLeft = 0;
  fitAndResize();
  activeSession?.terminal.focus();
});

localeButton.addEventListener("click", () => {
  locale = locale === "zh-TW" ? "en-US" : "zh-TW";
  try {
    window.localStorage.setItem("remote-code-agent:locale", locale);
  } catch {
    // Keep the selection for the current page when storage is unavailable.
  }
  applyLocale();
});

function updateModifierButtons(): void {
  ctrlButton.classList.toggle("active", ctrlLatched);
  ctrlButton.setAttribute("aria-pressed", String(ctrlLatched));
  altButton.classList.toggle("active", altLatched);
  altButton.setAttribute("aria-pressed", String(altLatched));
}

function clearModifiers(): void {
  ctrlLatched = false;
  altLatched = false;
  updateModifierButtons();
}

function modifiedKey(key: string): string | null {
  const specialKeys: Record<string, string> = {
    Enter: "\r",
    Tab: "\t",
    Escape: "\x1b",
    Backspace: "\x7f",
    ArrowUp: "\x1b[A",
    ArrowDown: "\x1b[B",
    ArrowRight: "\x1b[C",
    ArrowLeft: "\x1b[D",
    Home: "\x1b[H",
    End: "\x1b[F",
    Delete: "\x1b[3~",
    PageUp: "\x1b[5~",
    PageDown: "\x1b[6~",
  };

  let data = specialKeys[key] ?? (key.length === 1 ? key : null);
  if (!data) {
    return null;
  }

  if (ctrlLatched) {
    const lower = key.toLowerCase();
    if (lower >= "a" && lower <= "z") {
      data = String.fromCharCode(lower.charCodeAt(0) - 96);
    } else {
      const controlKeys: Record<string, string> = {
        " ": "\x00",
        "@": "\x00",
        "[": "\x1b",
        "\\": "\x1c",
        "]": "\x1d",
        "^": "\x1e",
        _: "\x1f",
        "?": "\x7f",
      };
      data = controlKeys[key] ?? data;
    }
  }

  return altLatched ? `\x1b${data}` : data;
}

document.querySelectorAll<HTMLButtonElement>("[data-key]").forEach((button) => {
  button.addEventListener("click", () => {
    sendInput(button.dataset.key || "");
    clearModifiers();
    activeSession?.terminal.focus();
  });
});

ctrlButton.addEventListener("click", () => {
  ctrlLatched = !ctrlLatched;
  updateModifierButtons();
  activeSession?.terminal.focus();
});

altButton.addEventListener("click", () => {
  altLatched = !altLatched;
  updateModifierButtons();
  activeSession?.terminal.focus();
});

requiredElement<HTMLButtonElement>("paste").addEventListener("click", async () => {
  try {
    activeSession?.terminal.paste(await navigator.clipboard.readText());
    activeSession?.terminal.focus();
  } catch {
    composer.focus();
  }
});

requiredElement<HTMLButtonElement>("copy").addEventListener("click", async () => {
  const selection = activeSession?.terminal.getSelection();
  if (selection) {
    await navigator.clipboard.writeText(selection);
  }
  activeSession?.terminal.focus();
});

function nextSessionName(): string {
  let index = sessionTabs.size + 1;
  while (sessionTabs.has(`session-${index}`)) {
    index += 1;
  }
  return `session-${index}`;
}

function openSessionPanel(): void {
  sessionInput.value = nextSessionName();
  sessionNameError.hidden = true;
  sessionPanelOverlay.hidden = false;
  sessionInput.focus();
  sessionInput.select();
}

function closeSessionPanel(): void {
  sessionPanelOverlay.hidden = true;
  addSessionButton.focus();
}

function submitSession(): void {
  const name = sessionInput.value.trim();
  if (!isValidSessionName(name)) {
    sessionNameError.textContent = text("invalidSessionName");
    sessionNameError.hidden = false;
    sessionInput.focus();
    return;
  }
  closeSessionPanel();
  openSessionTab(name);
}

addSessionButton.addEventListener("click", openSessionPanel);
closeSessionPanelButton.addEventListener("click", closeSessionPanel);
createSessionButton.addEventListener("click", submitSession);
sessionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitSession();
  }
});
sessionPanelOverlay.addEventListener("click", (event) => {
  if (event.target === sessionPanelOverlay) {
    closeSessionPanel();
  }
});

sessionTabsElement.addEventListener("keydown", (event) => {
  if (!(event.target instanceof HTMLButtonElement) ||
      !event.target.classList.contains("session-tab-select")) {
    return;
  }
  const names = Array.from(sessionTabs.keys());
  const current = names.indexOf(sessionName());
  const target = event.key === "ArrowRight"
    ? names[(current + 1) % names.length]
    : event.key === "ArrowLeft"
      ? names[(current - 1 + names.length) % names.length]
      : event.key === "Home"
        ? names[0]
        : event.key === "End"
          ? names[names.length - 1]
          : undefined;
  if (target) {
    event.preventDefault();
    activateSession(target);
  }
});

quickClaudeButton.addEventListener("click", () => launchAgent("claude"));
quickCodexButton.addEventListener("click", () => launchAgent("codex"));
agentSettingsButton.addEventListener("click", () => openAgentPanel());
closeAgentPanelButton.addEventListener("click", closeAgentPanel);

document.querySelectorAll<HTMLButtonElement>("[data-agent-choice]").forEach((button) => {
  button.addEventListener("click", () => {
    panelAgent = button.dataset.agentChoice === "codex" ? "codex" : "claude";
    renderAgentPanel();
  });
});

agentPanelOverlay.addEventListener("click", (event) => {
  if (event.target === agentPanelOverlay) {
    closeAgentPanel();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !agentPanelOverlay.hidden) {
    event.preventDefault();
    closeAgentPanel();
  } else if (event.key === "Escape" && !sessionPanelOverlay.hidden) {
    event.preventDefault();
    closeSessionPanel();
  }
});

pickFilesButton.addEventListener("click", () => fileInput.click());

async function uploadFile(file: File, session: string): Promise<string> {
  const url = new URL("/api/upload", window.location.href);
  url.searchParams.set("session", session);
  url.searchParams.set("name", file.name);
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const payload = (await response.json().catch(() => null)) as
    | { path?: unknown; error?: unknown }
    | null;
  if (!response.ok || typeof payload?.path !== "string") {
    const detail = typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return payload.path;
}

function quoteTerminalArgument(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files ?? []);
  const uploadSession = activeSession;
  if (files.length === 0 || !uploadSession) {
    return;
  }

  uploadSession.draft = composer.value;
  pickFilesButton.disabled = true;
  const paths: string[] = [];
  const failures: string[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    showNotice(
      text("uploadProgress", {
        current: index + 1,
        total: files.length,
        file: file.name,
      }),
      "ok",
      30_000,
    );
    try {
      paths.push(await uploadFile(file, uploadSession.name));
    } catch (error) {
      failures.push(
        text("uploadFailure", {
          file: file.name,
          error: error instanceof Error ? error.message : text("uploadFailed"),
        }),
      );
    }
  }

  pickFilesButton.disabled = false;
  fileInput.value = "";

  if (paths.length > 0) {
    const fileReferences = text("uploadedFiles", {
      paths: paths.map(quoteTerminalArgument).join(" "),
    });
    const draft = uploadSession === activeSession ? composer.value : uploadSession.draft;
    uploadSession.draft = draft.trim()
      ? `${draft.trimEnd()} ${fileReferences}`
      : fileReferences;
    if (uploadSession === activeSession) {
      composer.value = uploadSession.draft;
      composer.focus();
    }
  }

  if (failures.length > 0) {
    const summary = paths.length > 0
      ? text("uploadPartial", { success: paths.length, failed: failures.length })
      : failures[0] ?? text("uploadFailed");
    showNotice(summary, "error", 6_000);
  } else {
    showNotice(
      paths.length === 1
        ? text("uploadSuccessOne")
        : text("uploadSuccessMany", { count: paths.length }),
      "ok",
      6_000,
    );
  }
});

function composerText(): string {
  return composer.value.replace(/\r?\n/g, "\r");
}

requiredElement<HTMLButtonElement>("insert-command").addEventListener("click", () => {
  sendInput(composerText());
  composer.value = "";
  if (activeSession) {
    activeSession.draft = "";
    activeSession.terminal.focus();
  }
});

requiredElement<HTMLButtonElement>("run-command").addEventListener("click", () => {
  const command = composerText();
  sendInput(command ? `${command}\r` : "\r");
  composer.value = "";
  if (activeSession) {
    activeSession.draft = "";
    activeSession.terminal.focus();
  }
});

composer.addEventListener("input", () => {
  if (activeSession) {
    activeSession.draft = composer.value;
  }
});

composer.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    requiredElement<HTMLButtonElement>("run-command").click();
  }
});

const resizeObserver = new ResizeObserver(fitAndResize);
resizeObserver.observe(terminalShell);
window.visualViewport?.addEventListener("resize", fitAndResize);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    fitAndResize();
    probeConnection();
  }
});
window.addEventListener("pageshow", () => {
  closedByPage = false;
  probeConnection();
});
window.addEventListener("online", probeConnection);

window.addEventListener("beforeunload", () => {
  closedByPage = true;
  window.clearTimeout(reconnectTimer);
  clearConnectionTimers();
  connectionSocket?.close();
  connectionSocket = null;
});

const requestedSession = sessionFromLocation();
const initialSessionNames = [
  requestedSession,
  ...storedSessionNames().filter((name) => name !== requestedSession),
];
for (const name of initialSessionNames) {
  createSessionTab(name);
}
activateSession(requestedSession);
applyLocale();
connectTerminal();
