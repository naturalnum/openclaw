import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR } from "../utils.js";

export type ConnectorAuditEntry = {
  id: string;
  ts: number;
  instanceId: string;
  providerId: string;
  action: string;
  ok: boolean;
  actor: string;
  message: string;
};

function resolveAuditDir() {
  return path.join(CONFIG_DIR, "connectors", "audit");
}

function resolveAuditFileName(date = new Date()) {
  return `${date.toISOString().slice(0, 10)}.jsonl`;
}

export async function appendConnectorAudit(entry: ConnectorAuditEntry): Promise<void> {
  const dir = resolveAuditDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(
    path.join(dir, resolveAuditFileName(new Date(entry.ts))),
    `${JSON.stringify(entry)}\n`,
    "utf8",
  );
}

export async function listConnectorAuditEntries(limit = 100): Promise<ConnectorAuditEntry[]> {
  const dir = resolveAuditDir();
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name)
    .toSorted()
    .toReversed();
  const items: ConnectorAuditEntry[] = [];
  for (const file of files) {
    if (items.length >= limit) {
      break;
    }
    const raw = await fs.readFile(path.join(dir, file), "utf8").catch(() => "");
    if (!raw) {
      continue;
    }
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .toReversed();
    for (const line of lines) {
      try {
        items.push(JSON.parse(line) as ConnectorAuditEntry);
      } catch {
        // ignore malformed lines
      }
      if (items.length >= limit) {
        break;
      }
    }
  }
  return items.toSorted((a, b) => b.ts - a.ts).slice(0, limit);
}
