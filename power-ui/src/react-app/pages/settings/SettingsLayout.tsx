import { CloseOutlined } from "@ant-design/icons";
import { Modal } from "antd";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ROUTES } from "../../router/paths";
import { SETTINGS_NAV_ITEMS } from "../../router/settings-nav";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * GPT 式设置：单一弹窗 + 左侧分区导航 + 右侧编辑区（子页不再套第二层 Modal）。
 */
export function SettingsLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const open = location.pathname.startsWith(ROUTES.settings);

  const closeSettings = () => {
    // 不用 history.back：在设置子页之间切换后 -1 只会回到上一分区，弹窗仍开着
    navigate(ROUTES.root, { replace: true });
  };

  return (
    <Modal
      open={open}
      onCancel={closeSettings}
      footer={null}
      closable={false}
      centered
      width="min(920px, calc(100vw - 2rem))"
      styles={{
        content: { padding: 0, overflow: "hidden", borderRadius: 16 },
        body: { padding: 0 },
      }}
      destroyOnHidden
    >
      <div className="relative flex max-h-[min(80vh,720px)] min-h-[min(72vh,560px)]">
        <button
          type="button"
          aria-label="关闭设置"
          onClick={closeSettings}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          <CloseOutlined className="text-sm" />
        </button>
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-[#ecebea] bg-[#fbfbfa]">
          <div className="flex items-center border-b border-[#e7e5e4] px-3 py-3">
            <span className="text-sm font-semibold text-slate-900">设置</span>
          </div>
          <nav className="flex-1 overflow-y-auto p-2" aria-label="设置分区">
            {SETTINGS_NAV_ITEMS.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                title={item.description}
                className={({ isActive }) =>
                  cn(
                    "mb-0.5 flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition",
                    isActive
                      ? "bg-white text-slate-900 shadow-sm ring-1 ring-[#e7e5e4]"
                      : "text-slate-600 hover:bg-white/85 hover:text-slate-900",
                  )
                }
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-[14px] text-current ring-1 ring-[#e7e5e4]">
                  {item.icon}
                </span>
                <span className="min-w-0 truncate">{item.title}</span>
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="power-chat-scroll min-w-0 flex-1 overflow-y-auto bg-white p-5 pr-14 sm:p-6 sm:pr-14">
          <Outlet />
        </div>
      </div>
    </Modal>
  );
}
