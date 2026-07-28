import {
  DeleteOutlined,
  DownloadOutlined,
  InboxOutlined,
  ReloadOutlined,
  StarOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Input,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Spin,
  Typography,
} from "antd";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  DEFAULT_SKILLS_INSTALL_FILTER,
  DEFAULT_SKILLS_REGISTRY_PAGINATION,
  DEFAULT_SKILLS_SORT_BY,
  createScopedSkillsMarketClient,
  importRegistrySkillArchive,
  loadSkillsMarket,
  setSkillsCategory,
  setSkillsFilter,
  setSkillsInstallFilter,
  setSkillsPage,
  setSkillsSortBy,
  showAllSkills,
  toggleRegistrySkillInstall,
  type SkillMessage,
  type SkillsMarketState,
} from "../../compat/skills-market-controller";
import type {
  SkillsRegistryCatalogItem,
  SkillsRegistryCategory,
  SkillsRegistrySortBy,
} from "../../compat/types";
import { PageScaffold } from "../components/ui/PageScaffold";
import { StatusPill } from "../components/ui/StatusPill";
import { useLocalUsers } from "../context/LocalUsersContext";
import { useGatewayWorkbenchAdapter } from "../hooks/useGatewayWorkbenchAdapter";
import { usePowerUiSettings } from "../hooks/usePowerUiSettings";
import { ROUTES } from "../router/paths";

const { Text, Paragraph } = Typography;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: value < 1000 ? 0 : 1,
  }).format(value);
}

function formatRelativeTime(ts: number | null): string {
  if (!ts) {
    return "最近更新";
  }
  const diffMs = Date.now() - ts;
  const diffDays = Math.max(0, Math.floor(diffMs / 86_400_000));
  if (diffDays <= 0) {
    return "今天更新";
  }
  if (diffDays < 30) {
    return `${diffDays} 天前更新`;
  }
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths} 个月前更新`;
  }
  return `${Math.floor(diffMonths / 12)} 年前更新`;
}

function isLocalDirectoryInstall(item: SkillsRegistryCatalogItem): boolean {
  return item.installState.installed && item.installState.source === "directory";
}

function isLocalSkillsCategory(category: SkillsRegistryCategory): boolean {
  const id = category.id.trim().toLowerCase();
  const name = category.name.trim();
  return id === "local" || id === "local-skills" || name === "本地技能";
}

function createInitialSkillsState(
  adapter: ReturnType<typeof useGatewayWorkbenchAdapter>,
  userSessionToken: string,
): SkillsMarketState {
  return {
    client: createScopedSkillsMarketClient(adapter, userSessionToken),
    connected: Boolean(adapter),
    skillsLoading: false,
    skillsReport: null,
    skillsError: null,
    skillsBusyKey: null,
    skillsArchiveBusy: false,
    skillMessages: {},
    skillsNotice: null,
    skillsFilter: "",
    skillsCatalog: [],
    skillsCategories: [],
    skillsRegistryBaseUrl: null,
    skillsPagination: { ...DEFAULT_SKILLS_REGISTRY_PAGINATION },
    skillsCategory: null,
    skillsSortBy: DEFAULT_SKILLS_SORT_BY,
    skillsInstallFilter: DEFAULT_SKILLS_INSTALL_FILTER,
  };
}

function useSkillsMarket(
  adapter: ReturnType<typeof useGatewayWorkbenchAdapter>,
  userSessionToken: string,
) {
  const [, bump] = useState(0);
  const stateRef = useRef(createInitialSkillsState(adapter, userSessionToken));

  useEffect(() => {
    const previous = stateRef.current;
    stateRef.current = {
      ...createInitialSkillsState(adapter, userSessionToken),
      skillsFilter: previous.skillsFilter,
      skillsCategory: previous.skillsCategory,
      skillsSortBy: previous.skillsSortBy,
      skillsInstallFilter: previous.skillsInstallFilter,
      skillsPagination: {
        ...previous.skillsPagination,
        page: 1,
      },
    };
    bump((n) => n + 1);
  }, [adapter, userSessionToken]);

  const run = useCallback(async (action: Promise<unknown>) => {
    bump((n) => n + 1);
    try {
      await action;
    } finally {
      bump((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    if (!adapter) {
      return;
    }
    void run(loadSkillsMarket(stateRef.current, { clearMessages: true }));
  }, [adapter, run, userSessionToken]);

  return { state: stateRef.current, run };
}

export function SkillsPage() {
  const { message } = App.useApp();
  const { settings } = usePowerUiSettings();
  const adapter = useGatewayWorkbenchAdapter(settings);
  const localUsers = useLocalUsers();
  const { state, run } = useSkillsMarket(adapter, localUsers.sessionToken);
  const importInputRef = useRef<HTMLInputElement>(null);
  const localSkillsCategory = state.skillsCategories.find(isLocalSkillsCategory) ?? null;
  const visibleSkillCategories = state.skillsCategories.filter(
    (category) => !isLocalSkillsCategory(category),
  );

  const missingGateway = !settings.gatewayUrl.trim();

  const handleImportArchive = useCallback(
    (file: File) => {
      void run(importRegistrySkillArchive(state, file)).then(() => {
        const notice = state.skillsNotice;
        if (notice) {
          if (notice.kind === "error") {
            message.error(notice.message);
          } else {
            message.success(notice.message);
          }
        }
      });
    },
    [message, run, state],
  );

  if (missingGateway) {
    return (
      <PageScaffold>
        <Alert
          type="warning"
          showIcon
          message="还没有配置服务地址"
          description={
            <span>
              请先在 <Link to={ROUTES.settingsConnection}>设置</Link>{" "}
              页面填写服务地址，才能加载技能列表。
            </span>
          }
        />
      </PageScaffold>
    );
  }

  return (
    <PageScaffold
      maxWidthClass="max-w-[min(100%,1680px)]"
      innerClassName="gap-5 px-4 py-5 sm:px-6 sm:py-7"
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[26px] sm:leading-snug">
              探索技能
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              远端技能中心与本地技能目录合并展示，已安装项会自动对齐状态
            </p>
          </div>
          <Space wrap className="shrink-0">
            <input
              ref={importInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(ev) => {
                const file = ev.target.files?.[0];
                ev.target.value = "";
                if (file) {
                  handleImportArchive(file);
                }
              }}
            />
            {state.skillsRegistryBaseUrl ? (
              <Button href={state.skillsRegistryBaseUrl} target="_blank" rel="noreferrer">
                打开技能中心
              </Button>
            ) : null}
            <Button
              icon={<UploadOutlined />}
              loading={state.skillsArchiveBusy}
              disabled={state.skillsArchiveBusy || state.skillsLoading}
              onClick={() => importInputRef.current?.click()}
            >
              {state.skillsArchiveBusy ? "导入中…" : "导入技能包"}
            </Button>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              loading={state.skillsLoading}
              onClick={() =>
                void run(
                  loadSkillsMarket(state, {
                    clearMessages: true,
                  }),
                )
              }
            >
              刷新
            </Button>
          </Space>
        </div>

        <div className="rounded-2xl border border-slate-200/75 bg-white/86 p-4 shadow-sm shadow-slate-300/18 sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
              <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-slate-200/80 bg-[#f7f7f5] px-3 py-1 text-xs font-medium text-slate-700">
                <InboxOutlined />
                技能仓库
              </span>
              <Input
                allowClear
                size="large"
                placeholder="搜索技能名称、标识、作者或标签…"
                value={state.skillsFilter}
                onChange={(e) => void run(setSkillsFilter(state, e.target.value))}
                className="min-w-0 flex-1"
              />
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Text type="secondary" className="text-sm whitespace-nowrap">
                  排序
                </Text>
                <Select<SkillsRegistrySortBy>
                  value={state.skillsSortBy}
                  onChange={(v) => void run(setSkillsSortBy(state, v))}
                  className="min-w-[9.5rem]"
                  options={[
                    { value: "comprehensive", label: "综合" },
                    { value: "downloads", label: "下载量" },
                    { value: "updated", label: "最近更新" },
                  ]}
                />
              </div>
            </div>

            {visibleSkillCategories.length > 0 ? (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <InstallFilterButton
                  selected={state.skillsCategory === null}
                  onClick={() => void run(setSkillsCategory(state, null))}
                >
                  全部
                </InstallFilterButton>
                {visibleSkillCategories.map((category) => (
                  <CategoryButton
                    key={category.id}
                    category={category}
                    selected={state.skillsCategory === category.id}
                    onClick={() =>
                      void run(
                        setSkillsCategory(
                          state,
                          state.skillsCategory === category.id ? null : category.id,
                        ),
                      )
                    }
                  />
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <InstallFilterButton
                selected={
                  state.skillsInstallFilter === "all" &&
                  (!localSkillsCategory || state.skillsCategory !== localSkillsCategory.id)
                }
                onClick={() => void run(showAllSkills(state))}
              >
                全部
              </InstallFilterButton>
              {localSkillsCategory ? (
                <CategoryButton
                  category={localSkillsCategory}
                  selected={state.skillsCategory === localSkillsCategory.id}
                  onClick={() =>
                    void run(
                      setSkillsCategory(
                        state,
                        state.skillsCategory === localSkillsCategory.id
                          ? null
                          : localSkillsCategory.id,
                      ),
                    )
                  }
                />
              ) : null}
              {(
                [
                  { key: "installed" as const, label: "已安装" },
                  { key: "not_installed" as const, label: "未安装" },
                ] as const
              ).map((tab) => (
                <InstallFilterButton
                  key={tab.key}
                  onClick={() => void run(setSkillsInstallFilter(state, tab.key))}
                  selected={state.skillsInstallFilter === tab.key}
                >
                  {tab.label}
                </InstallFilterButton>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 sm:text-sm">
              <span>共 {state.skillsPagination.total} 个技能</span>
              <span className="tabular-nums">
                第 {state.skillsPagination.page} / {state.skillsPagination.totalPages || 1} 页
              </span>
            </div>
          </div>
        </div>

        {state.skillsNotice ? (
          <DismissibleNotice
            notice={state.skillsNotice}
            onClose={() => {
              state.skillsNotice = null;
              void run(Promise.resolve());
            }}
          />
        ) : null}
        {state.skillsError ? (
          <Alert
            type="error"
            showIcon
            closable
            message={state.skillsError}
            onClose={() => {
              state.skillsError = null;
              void run(Promise.resolve());
            }}
          />
        ) : null}

        <Spin spinning={state.skillsLoading}>
          {state.skillsCatalog.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/65 py-14 text-center text-sm text-slate-500">
              {state.skillsLoading ? "加载中…" : "暂无匹配技能"}
            </div>
          ) : (
            <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
              {state.skillsCatalog.map((skill) => (
                <SkillMarketCard
                  key={skill.slug}
                  skill={skill}
                  message={state.skillMessages[skill.slug] ?? null}
                  busy={state.skillsBusyKey === skill.slug}
                  onToggle={() => void run(toggleRegistrySkillInstall(state, skill))}
                />
              ))}
            </ul>
          )}
        </Spin>

        {state.skillsPagination.totalPages > 1 ? (
          <div className="flex justify-center pt-1">
            <Pagination
              current={state.skillsPagination.page}
              pageSize={state.skillsPagination.limit}
              total={state.skillsPagination.total}
              onChange={(p) => void run(setSkillsPage(state, p))}
              showSizeChanger={false}
            />
          </div>
        ) : null}
      </div>
    </PageScaffold>
  );
}

function InstallFilterButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
        selected
          ? "border-[#30343a] bg-[#30343a] text-white shadow-sm shadow-slate-300/30"
          : "border-slate-200/90 bg-white/78 text-slate-600 hover:border-slate-300 hover:bg-[#f7f7f5] hover:text-slate-900",
      )}
    >
      {children}
    </button>
  );
}

function CategoryButton({
  category,
  selected,
  onClick,
}: {
  category: SkillsRegistryCategory;
  selected: boolean;
  onClick: () => void;
}) {
  const icon = category.icon?.trim();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm font-medium transition",
        selected
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200/90 bg-white text-slate-600 hover:border-slate-300 hover:bg-[#f7f7f5] hover:text-slate-900",
      )}
    >
      {icon ? <span className="mr-1">{icon}</span> : null}
      {category.name}
    </button>
  );
}

function DismissibleNotice({ notice, onClose }: { notice: SkillMessage; onClose: () => void }) {
  return (
    <Alert
      showIcon
      closable
      type={notice.kind === "error" ? "error" : "success"}
      message={notice.message}
      onClose={onClose}
    />
  );
}

function SkillMarketCard({
  skill,
  message,
  busy,
  onToggle,
}: {
  skill: SkillsRegistryCatalogItem;
  message: SkillMessage | null;
  busy: boolean;
  onToggle: () => void;
}) {
  const localInstall = isLocalDirectoryInstall(skill);
  const canUninstall = skill.installState.installed && skill.installState.canUninstall;
  const tags = [...skill.tags];
  if (localInstall && !tags.some((tag) => tag.toLowerCase() === "local")) {
    tags.unshift("local");
  }

  return (
    <li>
      <article
        className={cn(
          "flex h-full min-h-[280px] flex-col gap-3 rounded-2xl border border-slate-200/75 bg-white/88 p-4 shadow-sm shadow-slate-300/14 sm:p-5",
          "transition hover:border-slate-300/85 hover:bg-white hover:shadow-md hover:shadow-slate-300/16",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            className="line-clamp-2 min-w-0 flex-1 text-base font-semibold leading-snug text-slate-900 sm:text-lg"
            title={skill.displayName}
          >
            {skill.displayName}
          </h2>
          {skill.installState.installed ? (
            canUninstall ? (
              <Popconfirm
                title="卸载技能"
                description={`确定删除 ${skill.displayName} 吗？`}
                okText="卸载"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={onToggle}
              >
                <Button danger size="small" icon={<DeleteOutlined />} loading={busy}>
                  卸载
                </Button>
              </Popconfirm>
            ) : (
              <Button size="small" disabled>
                已安装
              </Button>
            )
          ) : (
            <Button type="primary" size="small" loading={busy} onClick={onToggle}>
              安装
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1" title={`${skill.downloads} downloads`}>
            <DownloadOutlined />
            {formatCompactNumber(skill.downloads)}
          </span>
          <span className="inline-flex items-center gap-1" title={`${skill.installs} installs`}>
            <StarOutlined />
            {formatCompactNumber(skill.installs)}
          </span>
          <span>{skill.version || "版本未知"}</span>
          {skill.installState.installedVersion &&
          skill.installState.installedVersion !== skill.version ? (
            <StatusPill>已装 {skill.installState.installedVersion}</StatusPill>
          ) : null}
        </div>

        <Paragraph
          className="!mb-0 line-clamp-3 flex-1 text-sm leading-relaxed text-slate-600"
          title={skill.summary}
        >
          {skill.summary || "暂无描述"}
        </Paragraph>

        <div className="flex flex-wrap gap-1.5">
          {tags.slice(0, 5).map((t) => (
            <StatusPill key={t}>{t}</StatusPill>
          ))}
        </div>

        {message ? (
          <div
            className={cn(
              "line-clamp-2 rounded-lg px-2.5 py-2 text-xs",
              message.kind === "error"
                ? "bg-red-50 text-red-700"
                : "bg-emerald-50 text-emerald-700",
            )}
            title={message.message}
          >
            {message.message}
          </div>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
          <span className="min-w-0 flex-1 truncate" title={skill.author ?? "Registry skill"}>
            {skill.author ? `by ${skill.author}` : localInstall ? "本地目录" : "远端仓库"}
          </span>
          <span className="shrink-0">{formatRelativeTime(skill.updatedAt)}</span>
        </div>
      </article>
    </li>
  );
}
