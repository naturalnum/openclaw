type PowerBrandMarkProps = {
  compact?: boolean;
  showSubtitle?: boolean;
};

/** 侧栏品牌区：统一 logo 与标题样式 */
export function PowerBrandMark({ compact = false, showSubtitle = !compact }: PowerBrandMarkProps) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-sky-600 text-[13px] font-semibold tracking-tight text-white shadow-sm shadow-blue-200/60 ring-1 ring-white/70"
        aria-hidden
      >
        小
      </span>
      {!compact ? (
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight tracking-tight text-slate-950">
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
