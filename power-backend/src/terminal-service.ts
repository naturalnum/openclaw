import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { PowerTerminalConfig, PowerTerminalInfo, PowerTerminalReadResult } from "./types.js";

type PtyExitEvent = { exitCode: number; signal?: number };
type PtyDisposable = { dispose: () => void };
type PtyHandle = {
  pid: number;
  write: (data: string | Buffer) => void;
  onData: (listener: (value: string) => void) => PtyDisposable | void;
  onExit: (listener: (event: PtyExitEvent) => void) => PtyDisposable | void;
  resize?: (cols: number, rows: number) => void;
  kill?: (signal?: string) => void;
};
type PtySpawn = (
  file: string,
  args: string[] | string,
  options: {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
  },
) => PtyHandle;
type PtyModule = {
  spawn?: PtySpawn;
  default?: {
    spawn?: PtySpawn;
  };
};

type TerminalSession = {
  ownerId: string;
  info: PowerTerminalInfo;
  pty: PtyHandle;
  buffer: string;
  bufferStart: number;
  dataListener: PtyDisposable | null;
  exitListener: PtyDisposable | null;
  cleanupTimer: NodeJS.Timeout | null;
};

type CreateTerminalInput = {
  ownerId: string;
  cwd: string;
  title?: string | null;
  cols?: number | null;
  rows?: number | null;
};

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const DEFAULT_HISTORY_MAX_CHARS = 250_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const WRAPPER_FILE_NAME = "power-ui-claude";
const execFile = promisify(execFileCallback);

function createTerminalId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `terminal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveShell(config: PowerTerminalConfig) {
  return config.shell.trim() || process.env.SHELL?.trim() || "/bin/zsh";
}

function toStringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value == null) {
      continue;
    }
    output[key] = value;
  }
  return output;
}

async function loadPtySpawn(): Promise<PtySpawn> {
  const module = (await import("@lydell/node-pty")) as unknown as PtyModule;
  const spawn = module.spawn ?? module.default?.spawn;
  if (!spawn) {
    throw new Error("PTY support is unavailable (node-pty spawn not found).");
  }
  return spawn;
}

async function ensureClaudeWrapperPath() {
  const wrapperDir = path.join(os.tmpdir(), "power-ui-terminal");
  const wrapperPath = path.join(wrapperDir, WRAPPER_FILE_NAME);
  await fs.mkdir(wrapperDir, { recursive: true });
  await fs.writeFile(
    wrapperPath,
    [
      "#!/bin/sh",
      'if [ -z "${POWER_BACKEND_CLAUDE_COMMAND:-}" ]; then',
      '  echo "POWER_BACKEND_CLAUDE_COMMAND is not configured." >&2',
      "  exit 1",
      "fi",
      'if [ "$#" -eq 0 ]; then',
      "  exec /bin/sh -lc 'eval \"$POWER_BACKEND_CLAUDE_COMMAND\"'",
      "fi",
      'exec /bin/sh -lc \'eval "$POWER_BACKEND_CLAUDE_COMMAND" "$@"\' power-ui-claude "$@"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return { wrapperDir, wrapperPath };
}

export class PowerTerminalService {
  private readonly config: PowerTerminalConfig;
  private readonly sessions = new Map<string, TerminalSession>();
  private wrapperDirPromise: Promise<string | null> | null = null;

  constructor(config: PowerTerminalConfig) {
    this.config = {
      ...config,
      idleTimeoutMs: Math.max(config.idleTimeoutMs, 1_000),
      historyMaxChars: Math.max(config.historyMaxChars, 4_096),
    };
  }

  isEnabled() {
    return this.config.enabled;
  }

  private assertEnabled() {
    if (!this.config.enabled) {
      throw new Error("Terminal support is disabled.");
    }
  }

  private touch(session: TerminalSession) {
    session.info.lastActiveAt = Date.now();
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
    }
    session.cleanupTimer = setTimeout(() => {
      void this.close(session.ownerId, session.info.terminalId);
    }, this.config.idleTimeoutMs || DEFAULT_IDLE_TIMEOUT_MS);
    session.cleanupTimer.unref();
  }

  private toInfo(session: TerminalSession): PowerTerminalInfo {
    return { ...session.info };
  }

  private getOwnedSession(ownerId: string, terminalId: string) {
    const session = this.sessions.get(terminalId);
    if (!session || session.ownerId !== ownerId) {
      throw new Error("Terminal not found.");
    }
    return session;
  }

  private trimBuffer(session: TerminalSession) {
    const maxChars = this.config.historyMaxChars || DEFAULT_HISTORY_MAX_CHARS;
    if (session.buffer.length <= maxChars) {
      return;
    }
    const trimmed = session.buffer.length - maxChars;
    session.buffer = session.buffer.slice(trimmed);
    session.bufferStart += trimmed;
  }

  private async resolveWrapperDir() {
    if (!this.config.claudeCommand?.trim()) {
      return null;
    }
    if (!this.wrapperDirPromise) {
      this.wrapperDirPromise = ensureClaudeWrapperPath()
        .then(({ wrapperDir }) => wrapperDir)
        .catch((error: unknown) => {
          this.wrapperDirPromise = null;
          throw error;
        });
    }
    return await this.wrapperDirPromise;
  }

  private async buildTerminalEnv() {
    const env = toStringEnv(process.env);
    for (const [key, value] of Object.entries(this.config.env)) {
      env[key] = value;
    }
    if (this.config.claudeCommand?.trim()) {
      env.POWER_BACKEND_CLAUDE_COMMAND = this.config.claudeCommand.trim();
      const wrapperDir = await this.resolveWrapperDir();
      if (wrapperDir) {
        env.PATH = env.PATH ? `${wrapperDir}:${env.PATH}` : wrapperDir;
      }
    }
    env.TERM = env.TERM || "xterm-256color";
    return env;
  }

  async create(input: CreateTerminalInput): Promise<PowerTerminalInfo> {
    this.assertEnabled();
    const spawn = await loadPtySpawn();
    const now = Date.now();
    const terminalId = createTerminalId();
    const shell = resolveShell(this.config);
    const env = await this.buildTerminalEnv();
    const pty = spawn(shell, ["-i"], {
      cwd: input.cwd,
      env,
      name: env.TERM || "xterm-256color",
      cols: input.cols ?? DEFAULT_COLS,
      rows: input.rows ?? DEFAULT_ROWS,
    });
    const session: TerminalSession = {
      ownerId: input.ownerId,
      info: {
        terminalId,
        title: input.title?.trim() || path.basename(input.cwd) || "Terminal",
        cwd: input.cwd,
        status: "running",
        createdAt: now,
        lastActiveAt: now,
        exitCode: null,
      },
      pty,
      buffer: "",
      bufferStart: 0,
      dataListener: null,
      exitListener: null,
      cleanupTimer: null,
    };
    session.dataListener =
      pty.onData((value) => {
        session.buffer += value;
        this.trimBuffer(session);
        this.touch(session);
      }) ?? null;
    session.exitListener =
      pty.onExit((event) => {
        session.info.status = "exited";
        session.info.exitCode = event.exitCode ?? null;
        this.touch(session);
      }) ?? null;
    this.sessions.set(terminalId, session);
    this.touch(session);
    setTimeout(() => {
      try {
        if (session.info.status === "running") {
          session.pty.write("\n");
        }
      } catch {
        // ignore prompt bootstrap errors
      }
    }, 40).unref();
    return this.toInfo(session);
  }

  list(ownerId: string): PowerTerminalInfo[] {
    this.assertEnabled();
    return Array.from(this.sessions.values())
      .filter((session) => session.ownerId === ownerId)
      .toSorted((left, right) => right.info.lastActiveAt - left.info.lastActiveAt)
      .map((session) => this.toInfo(session));
  }

  read(ownerId: string, terminalId: string, cursor?: number | null): PowerTerminalReadResult {
    this.assertEnabled();
    const session = this.getOwnedSession(ownerId, terminalId);
    this.touch(session);
    const requestedCursor =
      typeof cursor === "number" && Number.isFinite(cursor)
        ? Math.max(cursor, 0)
        : session.bufferStart;
    if (requestedCursor < session.bufferStart) {
      return {
        terminal: this.toInfo(session),
        data: session.buffer,
        nextCursor: session.bufferStart + session.buffer.length,
        reset: true,
      };
    }
    const relativeCursor = Math.max(requestedCursor - session.bufferStart, 0);
    const data = session.buffer.slice(relativeCursor);
    return {
      terminal: this.toInfo(session),
      data,
      nextCursor: session.bufferStart + session.buffer.length,
      reset: false,
    };
  }

  write(ownerId: string, terminalId: string, data: string) {
    this.assertEnabled();
    const session = this.getOwnedSession(ownerId, terminalId);
    if (session.info.status !== "running") {
      throw new Error("Terminal has already exited.");
    }
    session.pty.write(data);
    this.touch(session);
  }

  resize(ownerId: string, terminalId: string, cols: number, rows: number) {
    this.assertEnabled();
    const session = this.getOwnedSession(ownerId, terminalId);
    if (typeof session.pty.resize === "function") {
      session.pty.resize(Math.max(20, Math.floor(cols)), Math.max(5, Math.floor(rows)));
    }
    this.touch(session);
    return this.toInfo(session);
  }

  async resolveCurrentWorkingDirectory(ownerId: string, terminalId: string) {
    this.assertEnabled();
    const session = this.getOwnedSession(ownerId, terminalId);
    this.touch(session);
    try {
      const { stdout } = await execFile("/usr/sbin/lsof", [
        "-a",
        "-p",
        String(session.pty.pid),
        "-d",
        "cwd",
        "-Fn",
      ]);
      const cwdLine = stdout
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("n"));
      const cwd = cwdLine?.slice(1).trim();
      if (cwd) {
        session.info.cwd = cwd;
        return cwd;
      }
    } catch {
      // fall back to the last known cwd when lsof is unavailable
    }
    return session.info.cwd;
  }

  async close(ownerId: string, terminalId: string) {
    this.assertEnabled();
    const session = this.getOwnedSession(ownerId, terminalId);
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = null;
    }
    try {
      if (typeof session.pty.kill === "function" && session.info.status === "running") {
        session.pty.kill("SIGKILL");
      }
    } catch {
      // ignore kill errors
    }
    try {
      session.dataListener?.dispose();
    } catch {
      // ignore listener cleanup errors
    }
    try {
      session.exitListener?.dispose();
    } catch {
      // ignore listener cleanup errors
    }
    this.sessions.delete(terminalId);
  }
}
