import { html, nothing } from "lit";
import { icons } from "../compat/ui-core.ts";
import type { WorkbenchProps } from "./workbench.ts";
import "../components/code-terminal-pane.ts";

function formatCodeStatus(status: "running" | "exited", exitCode: number | null) {
  if (status === "running") {
    return "Running";
  }
  if (typeof exitCode === "number") {
    return `Exited (${exitCode})`;
  }
  return "Exited";
}

export function renderCodePage(props: WorkbenchProps) {
  const activeTerminal =
    props.codeView.terminals.find(
      (terminal) => terminal.terminalId === props.codeView.activeTerminalId,
    ) ??
    props.codeView.terminals[0] ??
    null;

  return html`
    <section class="workbench-page-shell">
      <div class="workbench-page-shell__body code-page-shell">
        <section class="code-page">
          <header class="code-page__header">
            <div>
              <h2 class="code-page__title">Code</h2>
            </div>
            <div class="code-page__actions">
              ${props.codeView.loading
                ? html`<span class="code-page__meta">Restoring…</span>`
                : nothing}
              ${props.codeView.error
                ? html`<span class="code-page__error">${props.codeView.error}</span>`
                : nothing}
            </div>
          </header>

          <div class="code-tabs" role="tablist" aria-label="Code terminals">
            ${props.codeView.terminals.map(
              (terminal) => html`
                <button
                  type="button"
                  class="code-tabs__tab ${terminal.terminalId === activeTerminal?.terminalId
                    ? "is-active"
                    : ""}"
                  @click=${() => props.codeView.onSelect(terminal.terminalId)}
                >
                  <span class="code-tabs__tab-label">${terminal.title}</span>
                  <span class="code-tabs__tab-status"
                    >${formatCodeStatus(terminal.status, terminal.exitCode)}</span
                  >
                  <span
                    class="code-tabs__tab-close"
                    @click=${(event: Event) => {
                      event.stopPropagation();
                      props.codeView.onClose(terminal.terminalId);
                    }}
                  >
                    ${icons.x}
                  </span>
                </button>
              `,
            )}
            <button
              type="button"
              class="code-tabs__create"
              title="New terminal"
              ?disabled=${props.codeView.creating}
              @click=${props.codeView.onCreate}
            >
              ${icons.plus}
            </button>
          </div>

          ${activeTerminal
            ? html`
                <power-code-terminal-pane
                  .buffer=${props.codeView.buffer}
                  .active=${true}
                  .status=${activeTerminal.status}
                  @terminal-input=${(event: CustomEvent<{ data: string }>) =>
                    props.codeView.onInput(activeTerminal.terminalId, event.detail.data)}
                  @terminal-resize=${(event: CustomEvent<{ cols: number; rows: number }>) =>
                    props.codeView.onResize(
                      activeTerminal.terminalId,
                      event.detail.cols,
                      event.detail.rows,
                    )}
                ></power-code-terminal-pane>
              `
            : html`
                <div class="code-page__empty">
                  <div class="code-page__empty-icon">${icons.terminal}</div>
                  <h3>还没有终端</h3>
                  <p>
                    创建一个 tab 后，就可以在这里直接运行 shell 和
                    <code>claude</code>
                    。
                  </p>
                  <button
                    type="button"
                    class="code-page__empty-action"
                    @click=${props.codeView.onCreate}
                  >
                    ${icons.plus} 新建终端
                  </button>
                </div>
              `}
        </section>
      </div>
    </section>
  `;
}
