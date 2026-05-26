function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type PowerBrandMarkProps = {
  compact?: boolean;
  showSubtitle?: boolean;
};

function LobsterTrialIcon() {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label="龙虾试验版">
      <path
        d="M12 7.2v9.6M8.1 10.2c-1.7-.5-2.8-1.6-3-3.2M15.9 10.2c1.7-.5 2.8-1.6 3-3.2M8.2 16.2h7.6M9 19h6M9.2 7.7 6.7 5.2M14.8 7.7l2.5-2.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M6.2 4.3c-1.1 0-2 .9-2 2M17.8 4.3c1.1 0 2 .9 2 2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

/** 侧栏品牌区：统一 logo 与标题样式 */
export function PowerBrandMark({ compact = false, showSubtitle = !compact }: PowerBrandMarkProps) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center bg-[#343840] text-white",
          compact
            ? "h-8 w-8 rounded-lg shadow-sm shadow-slate-300/25 [&_svg]:h-4 [&_svg]:w-4"
            : "h-9 w-9 rounded-xl shadow-sm shadow-slate-300/35 ring-1 ring-white/70 [&_svg]:h-[18px] [&_svg]:w-[18px]",
        )}
        aria-hidden
      >
        <LobsterTrialIcon />
      </span>
      {!compact ? (
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight tracking-tight text-slate-900">
            龙虾试验版
          </p>
          {showSubtitle ? (
            <p className="truncate text-[10px] leading-snug text-slate-500">智能工作台</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
