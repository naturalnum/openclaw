import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

@customElement("power-code-terminal-pane")
export class PowerCodeTerminalPane extends LitElement {
  @property({ type: String }) buffer = "";
  @property({ type: Boolean }) active = false;
  @property({ type: String }) status: "running" | "exited" = "running";

  private readonly term = new Terminal({
    convertEol: false,
    cursorBlink: true,
    fontFamily:
      '"SFMono-Regular", "JetBrains Mono", "IBM Plex Mono", "Fira Code", Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.35,
    scrollback: 10_000,
    theme: {
      background: "#111111",
      foreground: "#f4f4f0",
      cursor: "#f4f4f0",
      black: "#202020",
      red: "#f87171",
      green: "#86efac",
      yellow: "#facc15",
      blue: "#93c5fd",
      magenta: "#f0abfc",
      cyan: "#67e8f9",
      white: "#f3f4f6",
      brightBlack: "#525252",
      brightRed: "#fca5a5",
      brightGreen: "#bbf7d0",
      brightYellow: "#fde047",
      brightBlue: "#bfdbfe",
      brightMagenta: "#f5d0fe",
      brightCyan: "#a5f3fc",
      brightWhite: "#ffffff",
    },
  });
  private readonly fitAddon = new FitAddon();
  private resizeObserver: ResizeObserver | null = null;
  private lastRenderedBuffer = "";
  private opened = false;
  private fitTimer: number | null = null;
  private lastSizeKey = "";

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
  }

  firstUpdated() {
    const mount = this.querySelector<HTMLElement>("[data-terminal-mount]");
    if (!mount) {
      return;
    }
    this.term.loadAddon(this.fitAddon);
    this.term.open(mount);
    this.opened = true;
    this.term.onData((data) => {
      this.dispatchEvent(
        new CustomEvent("terminal-input", {
          detail: { data },
          bubbles: true,
          composed: true,
        }),
      );
    });
    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleFit();
    });
    this.resizeObserver.observe(this);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        this.scheduleFit(true);
        this.syncBuffer(true);
        if (this.active) {
          this.focusTerminal();
        }
      });
    });
  }

  disconnectedCallback() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.fitTimer != null) {
      window.clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
    this.opened = false;
    this.term.dispose();
    super.disconnectedCallback();
  }

  protected override updated(changed: Map<string, unknown>) {
    if (this.opened && changed.has("buffer")) {
      this.syncBuffer();
    }
    if (this.opened && changed.has("active") && this.active) {
      window.requestAnimationFrame(() => {
        this.focusTerminal();
        this.scheduleFit(true);
      });
    }
  }

  private focusTerminal() {
    this.term.focus();
    const textarea = this.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
    textarea?.focus({ preventScroll: true });
  }

  private scheduleFit(immediate = false) {
    if (!this.opened) {
      return;
    }
    if (this.fitTimer != null) {
      window.clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
    const run = () => {
      this.fitTimer = null;
      this.fitTerminal();
    };
    if (immediate) {
      run();
      return;
    }
    this.fitTimer = window.setTimeout(run, 80);
  }

  private fitTerminal() {
    if (!this.opened) {
      return;
    }
    const mount = this.querySelector<HTMLElement>("[data-terminal-mount]");
    const rect = mount?.getBoundingClientRect();
    if (!rect || rect.width < 24 || rect.height < 24) {
      return;
    }
    try {
      this.fitAddon.fit();
    } catch {
      return;
    }
    const sizeKey = `${this.term.cols}x${this.term.rows}`;
    if (sizeKey === this.lastSizeKey) {
      return;
    }
    this.lastSizeKey = sizeKey;
    this.dispatchEvent(
      new CustomEvent("terminal-resize", {
        detail: { cols: this.term.cols, rows: this.term.rows },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private syncBuffer(force = false) {
    if (!this.opened) {
      return;
    }
    if (!force && this.buffer === this.lastRenderedBuffer) {
      return;
    }
    if (!force && this.buffer.startsWith(this.lastRenderedBuffer)) {
      this.term.write(this.buffer.slice(this.lastRenderedBuffer.length));
    } else {
      this.term.reset();
      if (this.buffer) {
        this.term.write(this.buffer);
      }
    }
    this.lastRenderedBuffer = this.buffer;
  }

  render() {
    const showPlaceholder = this.buffer.length === 0;
    return html`
      <div
        class="code-terminal-pane ${this.active ? "is-active" : ""}"
        data-terminal-pane
        @pointerdown=${() => this.focusTerminal()}
      >
        <div class="code-terminal-pane__status">
          ${this.status === "running" ? "Running" : "Exited"}
        </div>
        <div class="code-terminal-pane__mount" data-terminal-mount></div>
        ${showPlaceholder
          ? html`
              <div class="code-terminal-pane__placeholder" aria-hidden="true">
                <div class="code-terminal-pane__placeholder-title">Shell ready</div>
                <div class="code-terminal-pane__placeholder-body">
                  点击终端后直接输入命令，例如
                  <code>pwd</code>
                  、
                  <code>ls</code>
                  或
                  <code>claude</code>
                  。
                </div>
              </div>
            `
          : null}
      </div>
    `;
  }
}
