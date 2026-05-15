import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** 更紧凑的字号与间距，适合表单密集页 */
  compact?: boolean;
};

/**
 * 主区标题区：偏 ChatGPT 设置页的留白与字重。
 */
export function PageHeader({ title, description, meta, actions, compact }: PageHeaderProps) {
  return (
    <div className={compact ? "flex flex-wrap items-start justify-between gap-2" : "flex flex-wrap items-start justify-between gap-4"}>
      <div className={compact ? "min-w-0 space-y-0.5" : "min-w-0 space-y-1"}>
        <h1
          className={
            compact
              ? "text-lg font-semibold tracking-tight text-slate-900"
              : "text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl"
          }
        >
          {title}
        </h1>
        {description ? (
          <p className={compact ? "max-w-3xl text-xs leading-snug text-slate-600" : "max-w-2xl text-sm leading-relaxed text-slate-600"}>
            {description}
          </p>
        ) : null}
        {meta ? <div className={compact ? "text-[11px] text-slate-500" : "text-xs text-slate-500"}>{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
