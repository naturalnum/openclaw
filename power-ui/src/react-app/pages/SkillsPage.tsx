import { InboxOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Input, Pagination, Select, Space, Spin, Switch, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { SkillStatusEntry } from "../../compat/types";
import { PageScaffold } from "../components/ui/PageScaffold";
import { StatusPill } from "../components/ui/StatusPill";
import { useGatewayWorkbenchAdapter } from "../hooks/useGatewayWorkbenchAdapter";
import { usePowerUiSettings } from "../hooks/usePowerUiSettings";
import { useSkillsStatus } from "../hooks/useSkillsStatus";
import { ROUTES } from "../router/paths";

const { Text, Paragraph } = Typography;

type InstallFilter = "all" | "installed" | "not_installed";
type SortKey = "comprehensive" | "downloads" | "updated";

const PAGE_SIZE = 12;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function encodeUint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function hasSetupIssues(skill: SkillStatusEntry): boolean {
  return (
    skill.blockedByAllowlist ||
    !skill.eligible ||
    skill.missing.bins.length > 0 ||
    skill.missing.env.length > 0 ||
    skill.missing.config.length > 0 ||
    skill.missing.os.length > 0
  );
}

function matchesInstallFilter(skill: SkillStatusEntry, filter: InstallFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "installed") {
    return !skill.disabled;
  }
  return skill.disabled;
}

export function SkillsPage() {
  const { message } = App.useApp();
  const { settings } = usePowerUiSettings();
  const adapter = useGatewayWorkbenchAdapter(settings);
  const { report, loading, error, refetch, setSkillEnabled, busyKey } = useSkillsStatus(adapter);

  const [query, setQuery] = useState("");
  const [installFilter, setInstallFilter] = useState<InstallFilter>("all");
  const [sortBy, setSortBy] = useState<SortKey>("comprehensive");
  const [page, setPage] = useState(1);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const missingGateway = !settings.gatewayUrl.trim();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = report?.skills ?? [];
    const afterInstall = source.filter((row) => matchesInstallFilter(row, installFilter));
    const searched = !q
      ? afterInstall
      : afterInstall.filter(
          (row) =>
            row.name.toLowerCase().includes(q) ||
            row.skillKey.toLowerCase().includes(q) ||
            row.source.toLowerCase().includes(q) ||
            row.description.toLowerCase().includes(q),
        );
    const sorted = [...searched];
    if (sortBy === "downloads") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "updated") {
      sorted.sort((a, b) => a.skillKey.localeCompare(b.skillKey));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    }
    return sorted;
  }, [installFilter, query, report?.skills, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageSlice = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setPage(1);
  }, [query, installFilter, sortBy]);

  const handleImportArchive = useCallback(
    async (file: File) => {
      if (!adapter) {
        return;
      }
      const name = file.name.trim();
      if (!name.toLowerCase().endsWith(".zip")) {
        message.error("只支持导入 .zip 技能包");
        return;
      }
      setArchiveBusy(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await adapter.request("skills.registry.installArchive", {
          fileName: name,
          archiveBase64: encodeUint8ArrayToBase64(bytes),
        });
        message.success("技能包已导入");
        await refetch();
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        setArchiveBusy(false);
      }
    },
    [adapter, message, refetch],
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
              请先在 <Link to={ROUTES.settingsConnection}>设置</Link> 页面填写服务地址，才能加载技能列表。
            </span>
          }
        />
      </PageScaffold>
    );
  }

  return (
    <PageScaffold maxWidthClass="max-w-[min(100%,1680px)]" innerClassName="gap-5 px-4 py-5 sm:px-6 sm:py-7">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[26px] sm:leading-snug">
              探索技能
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">浏览、搜索并启用工作区内的技能</p>
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
                  void handleImportArchive(file);
                }
              }}
            />
            <Button loading={archiveBusy} disabled={archiveBusy || loading} onClick={() => importInputRef.current?.click()}>
              {archiveBusy ? "导入中…" : "导入技能包"}
            </Button>
            <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={() => void refetch()}>
              刷新
            </Button>
          </Space>
        </div>

        <div className="rounded-2xl border border-slate-200/85 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)] sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
              <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-[#0d6b52]/20 bg-[#0d6b52]/8 px-3 py-1 text-xs font-medium text-[#0d6b52]">
                <InboxOutlined />
                本地技能
              </span>
              <Input
                allowClear
                size="large"
                placeholder="搜索技能名称或标识…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-1"
              />
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Text type="secondary" className="text-sm whitespace-nowrap">
                  排序
                </Text>
                <Select<SortKey>
                  value={sortBy}
                  onChange={(v) => setSortBy(v)}
                  className="min-w-[9.5rem]"
                  options={[
                    { value: "comprehensive", label: "综合" },
                    { value: "downloads", label: "下载量" },
                    { value: "updated", label: "更新时间" },
                  ]}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {(
                [
                  { key: "all" as const, label: "全部" },
                  { key: "installed" as const, label: "已安装" },
                  { key: "not_installed" as const, label: "未安装" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setInstallFilter(tab.key)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                    installFilter === tab.key
                      ? "border-[#0d6b52] bg-[#0d6b52] text-white shadow-sm"
                      : "border-slate-200/90 bg-slate-50/80 text-slate-600 hover:border-slate-300 hover:bg-white",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 sm:text-sm">
              <span>共 {filtered.length} 个技能</span>
              <span className="tabular-nums">
                第 {safePage} / {totalPages} 页
              </span>
            </div>
          </div>
        </div>

        {error ? <Alert type="error" showIcon message={error} closable /> : null}

        <Spin spinning={loading}>
          {pageSlice.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 py-14 text-center text-sm text-slate-500">
              {loading ? "加载中…" : "暂无匹配技能"}
            </div>
          ) : (
            <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
              {pageSlice.map((skill) => (
                <SkillMarketCard
                  key={skill.skillKey}
                  skill={skill}
                  busy={busyKey === skill.skillKey}
                  onToggle={async (checked) => {
                    try {
                      await setSkillEnabled(skill.skillKey, checked);
                      message.success(checked ? `已启用 ${skill.name}` : `已停用 ${skill.name}`);
                    } catch {
                      message.error(`更新失败：${skill.name}`);
                    }
                  }}
                />
              ))}
            </ul>
          )}
        </Spin>

        {totalPages > 1 ? (
          <div className="flex justify-center pt-1">
            <Pagination
              current={safePage}
              pageSize={PAGE_SIZE}
              total={filtered.length}
              onChange={(p) => setPage(p)}
              showSizeChanger={false}
            />
          </div>
        ) : null}
      </div>
    </PageScaffold>
  );
}

function SkillMarketCard({
  skill,
  busy,
  onToggle,
}: {
  skill: SkillStatusEntry;
  busy: boolean;
  onToggle: (checked: boolean) => Promise<void>;
}) {
  const blockedByPolicy = skill.blockedByAllowlist;
  /** 不满足依赖时仍应允许切换启用（由网关落盘；不可用状态用标签提示） */
  const switchDisabled = blockedByPolicy || busy;
  const switchChecked = !skill.disabled;

  const tags: string[] = ["local"];
  if (skill.disabled) {
    tags.push("disabled");
  } else {
    tags.push("enabled");
  }
  if (hasSetupIssues(skill) && !skill.disabled) {
    tags.push("needs-setup");
  } else if (!skill.disabled && skill.eligible) {
    tags.push("ready");
  }
  if (skill.bundled) {
    tags.push("bundled");
  }

  return (
    <li>
      <article
        className={cn(
          "flex h-full min-h-[220px] flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm sm:p-5",
          "transition hover:border-slate-300/90 hover:shadow-md",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="line-clamp-2 min-w-0 flex-1 text-base font-semibold leading-snug text-slate-900 sm:text-lg" title={skill.name}>
            {skill.emoji ? <span className="mr-1">{skill.emoji}</span> : null}
            {skill.name}
          </h2>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Text type="secondary" className="text-[11px] leading-none">
              {busy ? "处理中" : switchChecked ? "开" : "关"}
            </Text>
            <Switch
              size="small"
              checked={switchChecked}
              disabled={switchDisabled}
              loading={busy}
              onChange={(v) => void onToggle(v)}
            />
          </div>
        </div>

        <Paragraph
          className="!mb-0 line-clamp-3 flex-1 text-sm leading-relaxed text-slate-600"
          title={skill.description}
        >
          {skill.description || "暂无描述"}
        </Paragraph>

        <div className="flex flex-wrap gap-1.5">
          {tags.slice(0, 5).map((t) => (
            <StatusPill key={t}>{t}</StatusPill>
          ))}
        </div>

        <div className="mt-auto border-t border-slate-100 pt-2.5 text-xs text-slate-500">
          <span className="truncate" title={skill.source}>
            {skill.source || "openclaw"}
          </span>
        </div>
      </article>
    </li>
  );
}
