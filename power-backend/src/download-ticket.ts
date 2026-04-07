import { randomUUID } from "node:crypto";

export type PowerFsDownloadTicketRecord = {
  ticket: string;
  agentId: string;
  filePath: string;
  expiresAtMs: number;
};

export class PowerFsDownloadTicketStore {
  private readonly records = new Map<string, PowerFsDownloadTicketRecord>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly now = () => Date.now(),
  ) {}

  issue(agentId: string, filePath: string): PowerFsDownloadTicketRecord {
    this.pruneExpired();
    const record: PowerFsDownloadTicketRecord = {
      ticket: randomUUID(),
      agentId,
      filePath,
      expiresAtMs: this.now() + this.ttlMs,
    };
    this.records.set(record.ticket, record);
    return record;
  }

  consume(ticketRaw: string | null | undefined): PowerFsDownloadTicketRecord | null {
    this.pruneExpired();
    const ticket = ticketRaw?.trim();
    if (!ticket) {
      return null;
    }
    const record = this.records.get(ticket) ?? null;
    if (!record) {
      return null;
    }
    this.records.delete(ticket);
    if (record.expiresAtMs <= this.now()) {
      return null;
    }
    return record;
  }

  private pruneExpired() {
    const now = this.now();
    for (const [ticket, record] of this.records) {
      if (record.expiresAtMs <= now) {
        this.records.delete(ticket);
      }
    }
  }
}
