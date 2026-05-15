import { NavLink, Outlet } from "react-router-dom";

import { PageScaffold } from "../../components/ui/PageScaffold";
import { SETTINGS_NAV_ITEMS } from "../../router/settings-nav";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * 设置区：白底内容壳 + 下划线式子导航（轻量，避免与侧栏「设置」同为粗分段控件）。
 */
export function SettingsLayout() {
  return (
    <PageScaffold
      maxWidthClass="max-w-6xl"
      innerClassName="gap-4 px-4 py-5 sm:px-5 sm:py-6"
    >
      <div className="overflow-hidden rounded-2xl border border-slate-200/85 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        <nav
          className="flex flex-wrap gap-x-0.5 border-b border-slate-200/80 bg-slate-50/40 px-2 sm:px-3"
          aria-label="设置分区"
        >
          {SETTINGS_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end
              title={item.description}
              className={({ isActive }) =>
                cn(
                  "relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-[13px] font-medium transition sm:px-3",
                  isActive
                    ? "border-[#0d6b52] text-[#0d6b52]"
                    : "border-transparent text-slate-500 hover:text-slate-800",
                )
              }
            >
              <span className="flex h-[1.125rem] w-[1.125rem] shrink-0 items-center justify-center text-[13px] leading-none opacity-90">
                {item.icon}
              </span>
              <span className="whitespace-nowrap">{item.title}</span>
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 p-4 sm:p-5">
          <Outlet />
        </div>
      </div>
    </PageScaffold>
  );
}
