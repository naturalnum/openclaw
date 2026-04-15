import { Type } from "@sinclair/typebox";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import type { ConnectorProviderRuntime } from "../types.js";

function readBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = (normalizeOptionalString(value) ?? "").trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return fallback;
}

function readPort(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const normalized = normalizeOptionalString(value) ?? "";
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readRequiredString(value: unknown) {
  return normalizeOptionalString(value) ?? "";
}

async function testSmtp(config: Record<string, unknown>, secrets: Record<string, string>) {
  const host = readRequiredString(config.smtpHost);
  const user = readRequiredString(config.smtpUser);
  const password = secrets.smtpPassword ?? "";
  if (!host || !user || !password) {
    return;
  }
  const transport = nodemailer.createTransport({
    host,
    port: readPort(config.smtpPort, 465),
    secure: readBoolean(config.smtpSecure, true),
    auth: {
      user,
      pass: password,
    },
  });
  await transport.verify();
}

async function withImapClient<T>(
  config: Record<string, unknown>,
  secrets: Record<string, string>,
  run: (client: ImapFlow) => Promise<T>,
) {
  const client = new ImapFlow({
    host: readRequiredString(config.imapHost),
    port: readPort(config.imapPort, 993),
    secure: readBoolean(config.imapSecure, true),
    auth: {
      user: readRequiredString(config.imapUser),
      pass: secrets.imapPassword ?? "",
    },
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export const emailConnectorProvider: ConnectorProviderRuntime = {
  definition: {
    id: "email",
    displayName: "Email",
    description: "Connect to SMTP/IMAP mailboxes for send and inbox access.",
    category: "email",
    authType: "basic",
    configFields: [
      {
        key: "defaultFrom",
        label: "Default From",
        kind: "text",
        required: true,
        placeholder: "bot@example.com",
      },
      { key: "smtpHost", label: "SMTP Host", kind: "text", placeholder: "smtp.example.com" },
      { key: "smtpPort", label: "SMTP Port", kind: "number", placeholder: "465" },
      { key: "smtpSecure", label: "SMTP Secure", kind: "boolean" },
      { key: "smtpUser", label: "SMTP User", kind: "text", placeholder: "bot@example.com" },
      { key: "imapHost", label: "IMAP Host", kind: "text", placeholder: "imap.example.com" },
      { key: "imapPort", label: "IMAP Port", kind: "number", placeholder: "993" },
      { key: "imapSecure", label: "IMAP Secure", kind: "boolean" },
      { key: "imapUser", label: "IMAP User", kind: "text", placeholder: "bot@example.com" },
    ],
    secretFields: [
      {
        key: "smtpPassword",
        label: "SMTP Password or SecretRef",
        kind: "text",
        placeholder: "${SMTP_PASSWORD}",
      },
      {
        key: "imapPassword",
        label: "IMAP Password or SecretRef",
        kind: "text",
        placeholder: "${IMAP_PASSWORD}",
      },
    ],
    actions: [
      {
        name: "email.messages.list",
        displayName: "List Messages",
        description: "List recent messages from the selected mailbox.",
        access: "read",
        riskLevel: "low",
        defaultPolicy: "allow",
        inputSchema: Type.Object(
          {
            mailbox: Type.Optional(Type.String({ minLength: 1 })),
            limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
          },
          { additionalProperties: false },
        ),
      },
      {
        name: "email.messages.get",
        displayName: "Get Message",
        description: "Fetch message headers and body text.",
        access: "read",
        riskLevel: "medium",
        defaultPolicy: "allow",
        inputSchema: Type.Object(
          {
            uid: Type.Number({ minimum: 1 }),
            mailbox: Type.Optional(Type.String({ minLength: 1 })),
          },
          { additionalProperties: false },
        ),
      },
      {
        name: "email.send",
        displayName: "Send Email",
        description: "Send an email through SMTP.",
        access: "write",
        riskLevel: "high",
        defaultPolicy: "approval",
        inputSchema: Type.Object(
          {
            to: Type.String({ minLength: 1 }),
            subject: Type.String({ minLength: 1 }),
            text: Type.Optional(Type.String()),
            html: Type.Optional(Type.String()),
            from: Type.Optional(Type.String({ minLength: 1 })),
            cc: Type.Optional(Type.String({ minLength: 1 })),
            bcc: Type.Optional(Type.String({ minLength: 1 })),
          },
          { additionalProperties: false },
        ),
      },
    ],
  },
  async validate(params) {
    const errors: string[] = [];
    if (!readRequiredString(params.config.defaultFrom)) {
      errors.push("defaultFrom is required");
    }
    const hasSmtp = Boolean(readRequiredString(params.config.smtpHost));
    const hasImap = Boolean(readRequiredString(params.config.imapHost));
    if (!hasSmtp && !hasImap) {
      errors.push("configure at least SMTP or IMAP");
    }
    if (hasSmtp) {
      if (!readRequiredString(params.config.smtpUser)) {
        errors.push("smtpUser is required when smtpHost is configured");
      }
      if (!normalizeOptionalString(params.secretInputs.smtpPassword)) {
        errors.push("smtpPassword is required when smtpHost is configured");
      }
    }
    if (hasImap) {
      if (!readRequiredString(params.config.imapUser)) {
        errors.push("imapUser is required when imapHost is configured");
      }
      if (!normalizeOptionalString(params.secretInputs.imapPassword)) {
        errors.push("imapPassword is required when imapHost is configured");
      }
    }
    return errors.length ? { ok: false, errors } : { ok: true };
  },
  async testConnection(params) {
    try {
      await testSmtp(params.config, params.secrets);
      const hasImap = Boolean(readRequiredString(params.config.imapHost));
      if (hasImap) {
        await withImapClient(params.config, params.secrets, async () => undefined);
      }
      return { ok: true, message: "Email connector connection succeeded." };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
  async invoke(params) {
    try {
      if (params.action === "email.send") {
        const transport = nodemailer.createTransport({
          host: readRequiredString(params.config.smtpHost),
          port: readPort(params.config.smtpPort, 465),
          secure: readBoolean(params.config.smtpSecure, true),
          auth: {
            user: readRequiredString(params.config.smtpUser),
            pass: params.secrets.smtpPassword ?? "",
          },
        });
        const info = await transport.sendMail({
          from:
            normalizeOptionalString(params.args.from) ??
            readRequiredString(params.config.defaultFrom),
          to: normalizeOptionalString(params.args.to) ?? "",
          cc: normalizeOptionalString(params.args.cc) ?? undefined,
          bcc: normalizeOptionalString(params.args.bcc) ?? undefined,
          subject: normalizeOptionalString(params.args.subject) ?? "",
          text: normalizeOptionalString(params.args.text) ?? "",
          html: normalizeOptionalString(params.args.html) ?? undefined,
        });
        return {
          ok: true,
          data: {
            messageId: info.messageId,
            accepted: info.accepted,
            rejected: info.rejected,
          },
        };
      }
      const mailbox = normalizeOptionalString(params.args.mailbox) ?? "INBOX";
      return await withImapClient(params.config, params.secrets, async (client) => {
        await client.mailboxOpen(mailbox);
        if (params.action === "email.messages.list") {
          const limit = Math.max(1, Math.min(50, Number(params.args.limit ?? 20)));
          const messages = [];
          for await (const message of client.fetch("1:*", {
            uid: true,
            envelope: true,
            flags: true,
          })) {
            messages.push({
              uid: message.uid,
              subject: message.envelope?.subject ?? "",
              from:
                message.envelope?.from
                  ?.map((item) => item.address)
                  .filter(Boolean)
                  .join(", ") ?? "",
              date: message.envelope?.date?.toISOString?.() ?? null,
              flags: Array.from(message.flags ?? []),
            });
            if (messages.length >= limit) {
              break;
            }
          }
          return {
            ok: true,
            data: messages,
          };
        }
        if (params.action === "email.messages.get") {
          const uid = Number(params.args.uid ?? 0);
          if (!Number.isFinite(uid) || uid <= 0) {
            throw new Error("uid is required");
          }
          const message = await client.fetchOne(String(uid), {
            uid: true,
            envelope: true,
            source: true,
          });
          if (message === false) {
            throw new Error(`message not found: ${uid}`);
          }
          const envelope = message.envelope;
          return {
            ok: true,
            data: {
              uid: message.uid,
              subject: envelope?.subject ?? "",
              from:
                envelope?.from
                  ?.map((item: { address?: string | null }) => item.address ?? "")
                  .filter(Boolean)
                  .join(", ") ?? "",
              to:
                envelope?.to
                  ?.map((item: { address?: string | null }) => item.address ?? "")
                  .filter(Boolean)
                  .join(", ") ?? "",
              date: envelope?.date?.toISOString?.() ?? null,
              source: message.source?.toString("utf8") ?? "",
            },
          };
        }
        throw new Error(`unsupported action: ${params.action}`);
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
