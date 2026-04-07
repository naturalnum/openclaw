import { describe, expect, it, vi } from "vitest";
import { PowerFsDownloadTicketStore } from "../power-backend/src/download-ticket.ts";

describe("PowerFsDownloadTicketStore", () => {
  it("issues a one-time ticket", () => {
    const store = new PowerFsDownloadTicketStore(60_000, () => 1_000);
    const issued = store.issue("main", "/tmp/demo.txt");

    expect(store.consume(issued.ticket)).toEqual(issued);
    expect(store.consume(issued.ticket)).toBeNull();
  });

  it("rejects expired tickets", () => {
    const now = vi.fn(() => 1_000);
    const store = new PowerFsDownloadTicketStore(500, now);
    const issued = store.issue("main", "/tmp/demo.txt");

    now.mockReturnValue(1_501);

    expect(store.consume(issued.ticket)).toBeNull();
  });
});
