import { useEffect, useId, useRef, useState } from "react";
import type { ModelCatalogEntry } from "../../../compat/types";
import { modelPickerSubtitle } from "../../lib/configured-chat-models";
import { formatCatalogModelRef } from "../../lib/model-catalog";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function displayName(entry: ModelCatalogEntry): string {
  return (entry.name ?? entry.id).trim() || entry.id;
}

type ChatModelPickerProps = {
  models: ModelCatalogEntry[];
  valueRef: string;
  onChange: (ref: string) => void;
  disabled?: boolean;
  placement?: "top" | "bottom";
  compact?: boolean;
};

/** 浅色顶栏：与对话区一致，避免与「我发送的气泡」共用深色块 */
export function ChatModelPicker({
  models,
  valueRef,
  onChange,
  disabled,
  placement = "bottom",
  compact = false,
}: ChatModelPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected =
    models.find((m) => {
      const r = formatCatalogModelRef(m) || m.id;
      const v = valueRef.trim();
      return Boolean(v && (r === v || m.id === v));
    }) ?? models[0];

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onDoc = (ev: MouseEvent) => {
      const el = rootRef.current;
      if (el && ev.target instanceof Node && !el.contains(ev.target)) {
        setOpen(false);
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!models.length) {
    return (
      <div className="max-w-[min(100vw-2rem,280px)] rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2.5 py-2 text-left text-xs leading-snug text-slate-500">
        未配置模型（请先在设置中配置模型）
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative inline-block max-w-[min(100vw-2rem,320px)]",
        compact && "max-w-[10.5rem]",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        title={selected ? modelPickerSubtitle(selected) : undefined}
        className={cn(
          "inline-flex w-max max-w-full min-w-0 items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white/72 text-left shadow-sm shadow-slate-200/25",
          compact ? "h-8 rounded-full px-2.5 py-0 text-xs" : "px-2.5 py-1.5",
          "text-slate-700 hover:border-slate-300 hover:bg-white hover:text-slate-900",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
          open && "border-slate-300 bg-white text-slate-900",
          disabled && "pointer-events-none opacity-45",
        )}
      >
        <span
          className={cn(
            "truncate font-semibold tracking-tight",
            compact ? "max-w-[7.25rem] text-[11.5px]" : "text-sm",
          )}
        >
          {selected ? displayName(selected) : "—"}
        </span>
        <span
          className={cn(
            "shrink-0 text-[10px] font-normal leading-none text-slate-500 transition-transform duration-200",
            open ? "rotate-180" : "",
          )}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="切换模型"
          className={cn(
            "absolute z-50 max-w-[min(calc(100vw-1.5rem),18rem)] rounded-2xl border border-slate-200/80 bg-white/96 py-1.5 shadow-xl shadow-slate-300/32 backdrop-blur",
            compact ? "w-52" : "w-72",
            placement === "top"
              ? "bottom-[calc(100%+0.35rem)] right-0"
              : "left-0 top-[calc(100%+0.35rem)]",
          )}
        >
          {models.map((m) => {
            const ref = formatCatalogModelRef(m) || m.id;
            const v = valueRef.trim();
            const active = Boolean(v && (ref === v || m.id === v));
            return (
              <button
                key={ref}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(ref);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2.5 text-left transition",
                  active ? "bg-slate-100/90 text-slate-900" : "hover:bg-slate-50",
                )}
              >
                <span className="min-w-0 flex-1 pr-1">
                  <span className="block truncate text-sm font-semibold leading-tight text-slate-900">
                    {displayName(m)}
                  </span>
                  {!compact ? (
                    <>
                      <span className="mt-0.5 block font-mono text-[10px] leading-snug text-slate-400">
                        {ref}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                        {modelPickerSubtitle(m)}
                      </span>
                    </>
                  ) : null}
                </span>
                <span className="shrink-0 self-center text-sm text-slate-600" aria-hidden>
                  {active ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
