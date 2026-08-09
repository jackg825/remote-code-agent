import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { mkdir, open, unlink, type FileHandle } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type IPty } from "node-pty";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  isValidSessionName,
  parseClientMessage,
  type AgentLaunch,
  type ServerMessage,
} from "./protocol.js";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 7681;
const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const KEEPALIVE_MS = 25_000;
const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_CONFIGURED_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_FILENAME_BYTES = 255;

function integerFromEnvironment(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535
    ? parsed
    : fallback;
}

function executableFromPath(command: string): string {
  return findExecutable(command) ?? command;
}

function findExecutable(command: string): string | null {
  if (command.includes("/")) {
    try {
      accessSync(command, constants.X_OK);
      return command;
    } catch {
      return null;
    }
  }

  for (const directory of (process.env.PATH || "").split(delimiter)) {
    const candidate = join(directory, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }

  return null;
}

function sessionFromRequest(request: IncomingMessage, fallback: string): string | null {
  const url = new URL(request.url ?? "/ws", "http://localhost");
  const requested = url.searchParams.get("session") ?? fallback;
  return isValidSessionName(requested) ? requested : null;
}

function legacySessionFromRequest(request: IncomingMessage): string | null | undefined {
  const requested = new URL(request.url ?? "/ws", "http://localhost").searchParams.get(
    "session",
  );
  if (requested === null) {
    return undefined;
  }
  return isValidSessionName(requested) ? requested : null;
}

function hasAllowedOrigin(request: IncomingMessage, publicHostname?: string): boolean {
  if (!publicHostname) {
    return true;
  }

  const origin = request.headers.origin;
  if (!origin) {
    return false;
  }

  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "https:" &&
      parsed.port === "" &&
      parsed.hostname.toLowerCase() === publicHostname.toLowerCase()
    );
  } catch {
    return false;
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function rejectUpgrade(request: IncomingMessage, socket: NodeJS.WritableStream): void {
  socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  if ("destroy" in socket && typeof socket.destroy === "function") {
    socket.destroy();
  }
}

function sendJson(response: ServerResponse, status: number, body: object): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

const port = integerFromEnvironment(process.env.PORT, DEFAULT_PORT);
const workspace = resolve(process.env.WORKSPACE_DIR || process.cwd());
const fallbackSession = process.env.DEFAULT_SESSION || "main";
const tmuxBin = executableFromPath(process.env.TMUX_BIN || "tmux");
const tmuxSocket = process.env.TMUX_SOCKET || "remote-code-agent";
const publicHostname = process.env.PUBLIC_HOSTNAME?.trim();
const maxUploadBytes = (() => {
  const parsed = Number(process.env.MAX_UPLOAD_BYTES);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_CONFIGURED_UPLOAD_BYTES
    ? parsed
    : DEFAULT_MAX_UPLOAD_BYTES;
})();
const uploadDirectory = resolve(
  process.env.UPLOAD_DIR || join(workspace, ".remote-code-agent", "uploads"),
);

if (process.env.NODE_ENV === "production" && !publicHostname) {
  throw new Error("PUBLIC_HOSTNAME is required when NODE_ENV=production");
}

if (!isValidSessionName(fallbackSession)) {
  throw new Error("DEFAULT_SESSION must contain only letters, numbers, underscores, or dashes");
}

if (!isValidSessionName(tmuxSocket)) {
  throw new Error("TMUX_SOCKET must contain only letters, numbers, underscores, or dashes");
}

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmuxConfig = process.env.TMUX_CONFIG || join(rootDirectory, "config", "tmux.conf");

function ensureSession(session: string): void {
  const commonArguments = ["-L", tmuxSocket, "-f", tmuxConfig];
  const hasSession = () =>
    spawnSync(tmuxBin, [...commonArguments, "has-session", "-t", `=${session}`], {
      stdio: "ignore",
    });

  const current = hasSession();
  if (current.error) {
    throw current.error;
  }
  if (current.status === 0) {
    return;
  }

  const created = spawnSync(
    tmuxBin,
    [...commonArguments, "new-session", "-d", "-s", session, "-c", workspace],
    { encoding: "utf8" },
  );

  if (created.error) {
    throw created.error;
  }
  if (created.status !== 0 && hasSession().status !== 0) {
    throw new Error(created.stderr.trim() || "Unable to create tmux session");
  }
}

function agentCommand(launch: AgentLaunch): { executable: string; arguments: string[] } {
  if (launch.agent === "claude") {
    const modes: Record<Extract<AgentLaunch, { agent: "claude" }>["mode"], string[]> = {
      manual: ["--permission-mode", "manual"],
      auto: ["--permission-mode", "auto"],
      plan: ["--permission-mode", "plan"],
      bypass: ["--dangerously-skip-permissions"],
    };
    return { executable: "claude", arguments: modes[launch.mode] };
  }

  const modes: Record<Extract<AgentLaunch, { agent: "codex" }>["mode"], string[]> = {
    default: ["--sandbox", "workspace-write", "--ask-for-approval", "untrusted"],
    "read-only": ["--sandbox", "read-only", "--ask-for-approval", "never"],
    auto: ["--sandbox", "workspace-write", "--ask-for-approval", "never"],
    bypass: ["--dangerously-bypass-approvals-and-sandbox"],
  };
  return { executable: "codex", arguments: modes[launch.mode] };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function launchAgentWindow(session: string, launch: AgentLaunch): { window: string; created: boolean } {
  const command = agentCommand(launch);
  const executable = findExecutable(command.executable);
  if (!executable) {
    throw new Error(`${command.executable} is not installed or is missing from PATH`);
  }

  const commonArguments = ["-L", tmuxSocket, "-f", tmuxConfig];
  const windowName = `agent-${launch.agent}-${launch.mode}`;
  const windows = spawnSync(
    tmuxBin,
    [...commonArguments, "list-windows", "-t", `=${session}`, "-F", "#{window_name}"],
    { encoding: "utf8" },
  );
  if (windows.error) {
    throw windows.error;
  }
  if (windows.status !== 0) {
    throw new Error(windows.stderr.trim() || "Unable to inspect tmux windows");
  }

  const exists = windows.stdout.split("\n").includes(windowName);
  if (!exists) {
    const currentPathResult = spawnSync(
      tmuxBin,
      [...commonArguments, "display-message", "-p", "-t", `=${session}:`, "#{pane_current_path}"],
      { encoding: "utf8" },
    );
    const currentPath = currentPathResult.status === 0 ? currentPathResult.stdout.trim() : "";
    const workingDirectory = (() => {
      try {
        return currentPath && statSync(currentPath).isDirectory() ? currentPath : workspace;
      } catch {
        return workspace;
      }
    })();
    const shellCommand = [executable, ...command.arguments].map(shellQuote).join(" ");
    const created = spawnSync(
      tmuxBin,
      [
        ...commonArguments,
        "new-window",
        "-d",
        "-t",
        `=${session}`,
        "-n",
        windowName,
        "-c",
        workingDirectory,
        shellCommand,
      ],
      { encoding: "utf8" },
    );
    if (created.error) {
      throw created.error;
    }
    if (created.status !== 0) {
      throw new Error(created.stderr.trim() || `Unable to start ${launch.agent}`);
    }
  }

  const selected = spawnSync(
    tmuxBin,
    [...commonArguments, "select-window", "-t", `${session}:${windowName}`],
    { encoding: "utf8" },
  );
  if (selected.error) {
    throw selected.error;
  }
  if (selected.status !== 0) {
    throw new Error(selected.stderr.trim() || "Unable to switch tmux windows");
  }

  return { window: windowName, created: !exists };
}

function safeUploadName(value: string, maxBytes: number): string {
  const cleaned = value
    .replaceAll(/[/\\]/g, "_")
    .replaceAll(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  let name = "";
  let size = 0;

  for (const character of cleaned) {
    const characterBytes = Buffer.byteLength(character);
    if (size + characterBytes > maxBytes) {
      break;
    }
    name += character;
    size += characterBytes;
  }

  return name || "upload";
}

async function writeAll(file: FileHandle, data: Buffer): Promise<void> {
  let offset = 0;
  while (offset < data.length) {
    const { bytesWritten } = await file.write(data, offset, data.length - offset, null);
    if (bytesWritten === 0) {
      throw new Error("Unable to write uploaded file");
    }
    offset += bytesWritten;
  }
}

async function handleUpload(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  if (!hasAllowedOrigin(request, publicHostname)) {
    response.statusCode = 403;
    response.end();
    return;
  }

  const session = sessionFromRequest(request, fallbackSession);
  const requestedName = url.searchParams.get("name");
  if (!session || !requestedName) {
    sendJson(response, 400, { error: "A valid session and file name are required" });
    return;
  }

  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxUploadBytes) {
    sendJson(response, 413, { error: `File exceeds the ${maxUploadBytes}-byte limit` });
    return;
  }

  const directory = join(uploadDirectory, session);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const prefix = `${Date.now()}-${randomUUID().slice(0, 8)}-`;
  const name = safeUploadName(requestedName, MAX_FILENAME_BYTES - Buffer.byteLength(prefix));
  const path = join(directory, `${prefix}${name}`);
  const file = await open(path, "wx", 0o600);
  let size = 0;
  let tooLarge = false;

  try {
    for await (const chunk of request) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += data.length;
      if (size > maxUploadBytes) {
        tooLarge = true;
        continue;
      }
      await writeAll(file, data);
    }
  } catch (error) {
    await file.close();
    await unlink(path).catch(() => undefined);
    throw error;
  }
  await file.close();

  if (tooLarge) {
    await unlink(path).catch(() => undefined);
    sendJson(response, 413, { error: `File exceeds the ${maxUploadBytes}-byte limit` });
    return;
  }

  sendJson(response, 201, { name, path, size });
}

async function handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/healthz") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "PUT" && url.pathname === "/api/upload") {
    await handleUpload(request, response, url);
    return;
  }

  response.statusCode = 404;
  response.end();
}

const server = createServer((request, response) => {
  void handleHttpRequest(request, response).catch((error) => {
    console.error(
      JSON.stringify({
        event: "http_request_failed",
        path: new URL(request.url ?? "/", "http://localhost").pathname,
        reason: error instanceof Error ? error.name : "unknown",
      }),
    );
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    response.end(JSON.stringify({ error: "Internal error" }));
  });
});
const webSockets = new WebSocketServer({ noServer: true, maxPayload: 70_000 });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws" || !hasAllowedOrigin(request, publicHostname)) {
    rejectUpgrade(request, socket);
    return;
  }

  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    webSockets.emit("connection", webSocket, request);
  });
});

webSockets.on("connection", (socket, request) => {
  const legacySession = legacySessionFromRequest(request);
  if (legacySession === null) {
    send(socket, { type: "error", message: "Invalid session name" });
    socket.close(1008, "Invalid session name");
    return;
  }

  type TerminalAttachment = {
    terminal: IPty;
    output: { dispose(): void };
    exit: { dispose(): void };
  };

  const attachments = new Map<string, TerminalAttachment>();

  const detachSession = (session: string): void => {
    const attachment = attachments.get(session);
    if (!attachment) {
      return;
    }
    attachments.delete(session);
    attachment.output.dispose();
    attachment.exit.dispose();
    try {
      attachment.terminal.kill();
    } catch {
      // The PTY may already have exited while the WebSocket was closing.
    }
  };

  const attachSession = (session: string): void => {
    if (attachments.has(session)) {
      send(socket, { type: "ready", session });
      return;
    }

    let terminal: IPty;
    try {
      ensureSession(session);
      terminal = spawn(
        tmuxBin,
        [
          "-L",
          tmuxSocket,
          "-f",
          tmuxConfig,
          "-u",
          "attach-session",
          "-t",
          `=${session}`,
        ],
        {
          name: "xterm-256color",
          cols: DEFAULT_COLS,
          rows: DEFAULT_ROWS,
          cwd: workspace,
          env: {
            ...process.env,
            COLORTERM: "truecolor",
            TERM: "xterm-256color",
          },
        },
      );
    } catch (error) {
      send(socket, {
        type: "error",
        session,
        message: error instanceof Error ? error.message : "Unable to start tmux",
      });
      send(socket, { type: "closed", session });
      return;
    }

    const attachment: TerminalAttachment = {
      terminal,
      output: terminal.onData((data) => {
        send(socket, { type: "output", session, data });
      }),
      exit: { dispose() {} },
    };
    attachment.exit = terminal.onExit(() => {
      if (attachments.get(session) !== attachment) {
        return;
      }
      attachments.delete(session);
      attachment.output.dispose();
      attachment.exit.dispose();
      send(socket, { type: "closed", session });
    });
    attachments.set(session, attachment);
    send(socket, { type: "ready", session });
  };

  let alive = true;
  socket.on("pong", () => {
    alive = true;
  });

  socket.on("message", (raw: RawData) => {
    const message = parseClientMessage(raw.toString(), legacySession);
    if (!message) {
      send(socket, { type: "error", message: "Invalid terminal message" });
      return;
    }

    if (message.type === "ping") {
      send(socket, { type: "pong" });
      return;
    }
    if (message.type === "subscribe") {
      attachSession(message.session);
      return;
    }
    if (message.type === "unsubscribe") {
      detachSession(message.session);
      return;
    }

    const attachment = attachments.get(message.session);
    if (!attachment) {
      send(socket, {
        type: "error",
        session: message.session,
        message: "Session is not subscribed",
      });
      return;
    }

    if (message.type === "input") {
      attachment.terminal.write(message.data);
    } else if (message.type === "resize") {
      attachment.terminal.resize(message.cols, message.rows);
    } else {
      try {
        const launched = launchAgentWindow(message.session, message);
        send(socket, { ...message, type: "agent", ...launched });
      } catch (error) {
        send(socket, {
          type: "error",
          session: message.session,
          message: error instanceof Error ? error.message : "Unable to start agent",
        });
      }
    }
  });

  socket.on("close", () => {
    for (const session of Array.from(attachments.keys())) {
      detachSession(session);
    }
  });

  if (legacySession) {
    attachSession(legacySession);
  }

  const keepalive = setInterval(() => {
    if (!alive) {
      socket.terminate();
      clearInterval(keepalive);
      return;
    }
    alive = false;
    socket.ping();
  }, KEEPALIVE_MS);

  socket.once("close", () => clearInterval(keepalive));
});

server.listen(port, LOOPBACK_HOST, () => {
  console.log(`Remote Code Agent listening on http://${LOOPBACK_HOST}:${port}`);
});

function shutdown(): void {
  webSockets.clients.forEach((socket) => socket.close(1001, "Server restarting"));
  webSockets.close();
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
