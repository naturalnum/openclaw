function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type PowerBrandMarkProps = {
  compact?: boolean;
  showSubtitle?: boolean;
};

/** 侧栏品牌区：统一 logo 与标题样式 */
export function PowerBrandMark({ compact = false, showSubtitle = !compact }: PowerBrandMarkProps) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center bg-gradient-to-br from-[#30343a] to-[#5b6068] font-semibold tracking-tight text-white",
          compact
            ? "h-8 w-8 rounded-lg text-[12px] shadow-sm shadow-slate-300/25"
            : "h-9 w-9 rounded-xl text-[13px] shadow-sm shadow-slate-300/35 ring-1 ring-white/70",
        )}
        aria-hidden
      >
        小
      </span>
      {!compact ? (
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight tracking-tight text-slate-900">
            小龙虾助手
          </p>
          {showSubtitle ? (
            <p className="truncate text-[10px] leading-snug text-slate-500">智能工作台</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
