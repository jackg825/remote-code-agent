export type AgentLaunch =
  | { agent: "claude"; mode: "manual" | "auto" | "plan" | "bypass" }
  | { agent: "codex"; mode: "default" | "read-only" | "auto" | "bypass" };

export type ClientMessage =
  | { type: "subscribe"; session: string }
  | { type: "unsubscribe"; session: string }
  | { type: "ping" }
  | { type: "input"; session: string; data: string }
  | { type: "resize"; session: string; cols: number; rows: number }
  | ({ type: "launch"; session: string } & AgentLaunch);

export type ServerMessage =
  | { type: "ready"; session: string }
  | { type: "closed"; session: string }
  | { type: "pong" }
  | { type: "output"; session: string; data: string }
  | ({ type: "agent"; session: string; window: string; created: boolean } & AgentLaunch)
  | { type: "error"; session?: string; message: string };

const SESSION_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidSessionName(value: string): boolean {
  return SESSION_NAME.test(value);
}

function sessionFromMessage(value: object, fallback?: string): string | null {
  const session = "session" in value ? value.session : fallback;
  return typeof session === "string" && isValidSessionName(session) ? session : null;
}

export function parseClientMessage(raw: string, fallbackSession?: string): ClientMessage | null {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object" || !("type" in value)) {
    return null;
  }

  if (value.type === "ping") {
    return { type: "ping" };
  }

  if (value.type === "subscribe" || value.type === "unsubscribe") {
    const session = sessionFromMessage(value);
    return session ? { type: value.type, session } : null;
  }

  const session = sessionFromMessage(value, fallbackSession);
  if (!session) {
    return null;
  }

  if (value.type === "input" && "data" in value) {
    if (typeof value.data === "string" && value.data.length <= 65_536) {
      return { type: "input", session, data: value.data };
    }
    return null;
  }

  if (value.type === "resize" && "cols" in value && "rows" in value) {
    const { cols, rows } = value;
    if (
      Number.isInteger(cols) &&
      Number.isInteger(rows) &&
      typeof cols === "number" &&
      typeof rows === "number" &&
      cols >= 10 &&
      cols <= 500 &&
      rows >= 2 &&
      rows <= 300
    ) {
      return { type: "resize", session, cols, rows };
    }
  }

  if (value.type === "launch" && "agent" in value && "mode" in value) {
    if (
      value.agent === "claude" &&
      typeof value.mode === "string" &&
      ["manual", "auto", "plan", "bypass"].includes(value.mode)
    ) {
      return {
        type: "launch",
        session,
        agent: "claude",
        mode: value.mode as Extract<AgentLaunch, { agent: "claude" }>["mode"],
      };
    }

    if (
      value.agent === "codex" &&
      typeof value.mode === "string" &&
      ["default", "read-only", "auto", "bypass"].includes(value.mode)
    ) {
      return {
        type: "launch",
        session,
        agent: "codex",
        mode: value.mode as Extract<AgentLaunch, { agent: "codex" }>["mode"],
      };
    }
  }

  return null;
}
