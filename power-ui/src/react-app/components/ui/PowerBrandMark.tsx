type PowerBrandMarkProps = {
  compact?: boolean;
  showSubtitle?: boolean;
};

/** 侧栏品牌区：统一 logo 与标题样式 */
export function PowerBrandMark({ compact = false, showSubtitle = !compact }: PowerBrandMarkProps) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0d6b52] to-[#0a4d3c] text-lg shadow-sm ring-1 ring-[#0d6b52]/25"
        aria-hidden
      >
        <span className="drop-shadow-sm">🦞</span>
      </span>
      {!compact ? (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-slate-900">小龙虾助手</p>
          {showSubtitle ? (
            <p className="truncate text-[11px] text-slate-500">智能工作台</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
