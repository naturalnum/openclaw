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
};

/** 浅色顶栏：与对话区一致，避免与「我发送的气泡」共用深色块 */
export function ChatModelPicker({ models, valueRef, onChange, disabled }: ChatModelPickerProps) {
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
      return;
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
        暂无可用模型（请检查网关与模型目录）
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative inline-block max-w-[min(100vw-2rem,320px)]">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        title={selected ? modelPickerSubtitle(selected) : undefined}
        className={cn(
          "inline-flex w-max max-w-full min-w-0 items-center gap-1.5 rounded-lg border border-slate-200/90 bg-slate-50 px-2.5 py-1.5 text-left shadow-sm",
          "text-slate-800 hover:bg-white hover:border-slate-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d6b52]/20 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
          open && "border-slate-300/90 bg-white",
          disabled && "pointer-events-none opacity-45",
        )}
      >
        <span className="truncate text-sm font-semibold tracking-tight">
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
          className="absolute left-0 top-[calc(100%+0.35rem)] z-50 min-w-full max-w-[min(calc(100vw-1.5rem),20rem)] rounded-2xl border border-slate-200/90 bg-white py-1 shadow-lg shadow-slate-300/40"
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
                  void onChange(ref);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2.5 text-left transition",
                  active ? "bg-emerald-50" : "hover:bg-slate-50",
                )}
              >
                <span className="min-w-0 flex-1 pr-1">
                  <span className="block truncate text-sm font-semibold leading-tight text-slate-900">
                    {displayName(m)}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                    {modelPickerSubtitle(m)}
                  </span>
                </span>
                <span className="shrink-0 self-center text-sm text-emerald-700" aria-hidden>
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
