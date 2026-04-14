import { html, nothing, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import {
  renderMessageGroup,
  renderReadingIndicatorGroup,
  renderStreamingGroup,
  normalizeMessage,
  normalizeRoleForGrouping,
  type ChatItem,
  type MessageGroup,
} from "../../../compat/chat.ts";

const CHAT_HISTORY_RENDER_LIMIT = 200;

// Keep the item-building structure intentionally close to
// compat/chat.ts upstream mappings so future chat behavior changes remain
// easy to diff and port without rewiring the power-ui shell.

export type PowerChatThreadProps = {
  messages: unknown[];
  toolMessages: unknown[];
  streamSegments: Array<{ text: string; ts: number }>;
  stream: string | null;
  streamStartedAt: number | null;
  sessionKey: string;
  assistantName: string;
  assistantAvatar: string | null;
  basePath?: string;
  onScroll?: (event: Event) => void;
  emptyState?: TemplateResult | null;
};

export function renderPowerChatThread(props: PowerChatThreadProps) {
  const chatItems = buildChatItems(props);
  const isEmpty = chatItems.length === 0;
  const assistantIdentity = {
    name: props.assistantName,
    avatar: props.assistantAvatar,
  };

  return html`
    <div class="workbench-chat-scroll chat-thread" @scroll=${props.onScroll ?? null}>
      <div class="workbench-chat-thread-inner">
        ${isEmpty ? (props.emptyState ?? nothing) : nothing}
        ${repeat(
          chatItems,
          (item) => item.key,
          (item) => {
            if (item.kind === "divider") {
              return html`
                <div class="chat-divider" role="separator" data-ts=${String(item.timestamp)}>
                  <span class="chat-divider__line"></span>
                  <span class="chat-divider__label">${item.label}</span>
                  <span class="chat-divider__line"></span>
                </div>
              `;
            }
            if (item.kind === "reading-indicator") {
              return renderReadingIndicatorGroup(assistantIdentity, props.basePath);
            }
            if (item.kind === "stream") {
              return renderStreamingGroup(
                item.text,
                item.startedAt,
                undefined,
                assistantIdentity,
                props.basePath,
              );
            }
            if (item.kind === "group") {
              return renderMessageGroup(item, {
                showReasoning: false,
                showToolCalls: true,
                assistantName: props.assistantName,
                assistantAvatar: props.assistantAvatar,
                basePath: props.basePath,
              });
            }
            return nothing;
          },
        )}
      </div>
    </div>
  `;
}

function buildChatItems(props: PowerChatThreadProps): Array<ChatItem | MessageGroup> {
  const items: ChatItem[] = [];
  const history = Array.isArray(props.messages) ? props.messages : [];
  const tools = Array.isArray(props.toolMessages) ? props.toolMessages : [];
  const segments = props.streamSegments ?? [];
  const historyStart = Math.max(0, history.length - CHAT_HISTORY_RENDER_LIMIT);

  if (historyStart > 0) {
    items.push({
      kind: "message",
      key: "chat:history:notice",
      message: {
        role: "system",
        content: `Showing last ${CHAT_HISTORY_RENDER_LIMIT} messages (${historyStart} hidden).`,
        timestamp: Date.now(),
      },
    });
  }

  for (let index = historyStart; index < history.length; index += 1) {
    const message = history[index];
    const normalized = normalizeMessage(message);
    const raw = message as Record<string, unknown>;
    const marker = raw.__openclaw as Record<string, unknown> | undefined;
    if (marker && marker.kind === "compaction") {
      items.push({
        kind: "divider",
        key:
          typeof marker.id === "string"
            ? `divider:compaction:${marker.id}`
            : `divider:compaction:${normalized.timestamp}:${index}`,
        label: "Compaction",
        timestamp: normalized.timestamp ?? Date.now(),
      });
      continue;
    }
    items.push({
      kind: "message",
      key: messageKey(message, index),
      message,
    });
  }

  // Interleave stream segments and tool cards in the same shape as upstream:
  // each segment contains text that streamed before the corresponding tool
  // started, so the visual order stays text -> tool -> text -> tool.
  const maxLen = Math.max(segments.length, tools.length);
  for (let index = 0; index < maxLen; index += 1) {
    if (index < segments.length && segments[index].text.trim().length > 0) {
      items.push({
        kind: "stream",
        key: `stream-seg:${props.sessionKey}:${index}`,
        text: segments[index].text,
        startedAt: segments[index].ts,
      });
    }
    if (index < tools.length) {
      items.push({
        kind: "message",
        key: messageKey(tools[index], index + history.length),
        message: tools[index],
      });
    }
  }

  if (props.stream !== null) {
    const key = `stream:${props.sessionKey}:${props.streamStartedAt ?? "live"}`;
    if (props.stream.trim().length > 0) {
      items.push({
        kind: "stream",
        key,
        text: props.stream,
        startedAt: props.streamStartedAt ?? Date.now(),
      });
    } else {
      items.push({ kind: "reading-indicator", key });
    }
  }

  return groupMessages(items);
}

function groupMessages(items: ChatItem[]): Array<ChatItem | MessageGroup> {
  const result: Array<ChatItem | MessageGroup> = [];
  let currentGroup: MessageGroup | null = null;

  for (const item of items) {
    if (item.kind !== "message") {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push(item);
      continue;
    }

    const normalized = normalizeMessage(item.message);
    const role = normalizeRoleForGrouping(normalized.role);
    const senderLabel = role.toLowerCase() === "user" ? (normalized.senderLabel ?? null) : null;
    const timestamp = normalized.timestamp || Date.now();

    if (
      !currentGroup ||
      currentGroup.role !== role ||
      (role.toLowerCase() === "user" && currentGroup.senderLabel !== senderLabel)
    ) {
      if (currentGroup) {
        result.push(currentGroup);
      }
      currentGroup = {
        kind: "group",
        key: `group:${role}:${item.key}`,
        role,
        senderLabel,
        messages: [{ message: item.message, key: item.key }],
        timestamp,
        isStreaming: false,
      };
      continue;
    }

    currentGroup.messages.push({ message: item.message, key: item.key });
  }

  if (currentGroup) {
    result.push(currentGroup);
  }

  return result;
}

function messageKey(message: unknown, index: number): string {
  const entry = message as Record<string, unknown>;
  const toolCallId = typeof entry.toolCallId === "string" ? entry.toolCallId : "";
  if (toolCallId) {
    return `tool:${toolCallId}`;
  }
  const id = typeof entry.id === "string" ? entry.id : "";
  if (id) {
    return `msg:${id}`;
  }
  const messageId = typeof entry.messageId === "string" ? entry.messageId : "";
  if (messageId) {
    return `msg:${messageId}`;
  }
  const timestamp = typeof entry.timestamp === "number" ? entry.timestamp : null;
  const role = typeof entry.role === "string" ? entry.role : "unknown";
  if (timestamp != null) {
    return `msg:${role}:${timestamp}:${index}`;
  }
  return `msg:${role}:${index}`;
}
