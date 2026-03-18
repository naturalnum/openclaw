import {
  buildAgentMainSessionKey,
  parseAgentSessionKey,
} from "../../../src/routing/session-key.ts";
import type {
  AgentFileEntry,
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  CronJob,
  ModelCatalogEntry,
  SessionsListResult,
  SkillStatusEntry,
  SkillStatusReport,
  ToolsCatalogResult,
} from "../../../ui/src/ui/types.ts";
import type {
  WorkbenchAdapter,
  WorkbenchAdapterEvent,
  WorkbenchSendResult,
} from "../adapters/workbench-adapter.ts";

type MockMessage = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
};

type MockSession = {
  key: string;
  label: string;
  subject: string;
  projectId: string;
  updatedAt: number;
  totalTokens: number;
  messages: MockMessage[];
};

type MockProject = {
  id: string;
  name: string;
  owner: string;
  workspace: string;
  files: AgentFileEntry[];
  sessions: MockSession[];
};

type MockSnapshotArgs = {
  projectId: string | null;
  sessionKey: string | null;
};

export type MockWorkbenchSnapshot = {
  assistantName: string;
  currentProjectId: string | null;
  currentSessionKey: string;
  agentsList: AgentsListResult;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentFilesList: AgentsFilesListResult | null;
  sessionsResult: SessionsListResult;
  chatMessages: unknown[];
  skillsReport: SkillStatusReport;
  cronJobs: CronJob[];
  modelCatalog: ModelCatalogEntry[];
  toolsCatalogResult: ToolsCatalogResult | null;
};

export type WorkbenchSnapshot = MockWorkbenchSnapshot;

function nowMinus(minutes: number) {
  return Date.now() - minutes * 60 * 1000;
}

function createSkill(
  overrides: Partial<SkillStatusEntry> & Pick<SkillStatusEntry, "skillKey" | "name">,
): SkillStatusEntry {
  return {
    skillKey: overrides.skillKey,
    name: overrides.name,
    description: overrides.description ?? "Skill description",
    source: overrides.source ?? "Official",
    filePath: overrides.filePath ?? `skills/${overrides.skillKey}/SKILL.md`,
    baseDir: overrides.baseDir ?? `skills/${overrides.skillKey}`,
    bundled: overrides.bundled ?? true,
    primaryEnv: overrides.primaryEnv,
    emoji: overrides.emoji,
    homepage: overrides.homepage,
    always: overrides.always ?? false,
    disabled: overrides.disabled ?? false,
    blockedByAllowlist: overrides.blockedByAllowlist ?? false,
    eligible: overrides.eligible ?? true,
    requirements: overrides.requirements ?? {
      bins: [],
      env: overrides.primaryEnv ? [overrides.primaryEnv] : [],
      config: [],
      os: [],
    },
    missing: overrides.missing ?? {
      bins: [],
      env: [],
      config: [],
      os: [],
    },
    configChecks: overrides.configChecks ?? [],
    install: overrides.install ?? [],
  };
}

function sessionMessage(role: MockMessage["role"], text: string, timestamp: number): MockMessage {
  return { role, text, timestamp };
}

function buildReply(projectName: string, text: string, modelId: string) {
  return `已进入 ${projectName} 的原型上下文。接下来我会围绕“${text.trim()}”拆任务、列文件位和工具位，并按 ${modelId} 的展示风格返回工作台结果。`;
}

function createLocalId() {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class MockWorkbenchAdapter implements WorkbenchAdapter {
  readonly kind = "mock" as const;
  private projects: MockProject[];
  private skills: SkillStatusEntry[];
  private cronJobs: CronJob[];
  private models: ModelCatalogEntry[];
  private nextProjectNumber = 4;
  private nextSessionNumber = 12;
  private listeners = new Set<(event: WorkbenchAdapterEvent) => void>();
  private pendingRuns = new Map<
    string,
    {
      sessionKey: string;
      replyText: string;
      deltaTimer: number | null;
      finalTimer: number | null;
    }
  >();

  constructor() {
    this.models = [
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        provider: "OpenAI",
        contextWindow: 200000,
        reasoning: true,
        input: ["text", "image"],
      },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        provider: "OpenAI",
        contextWindow: 128000,
        input: ["text", "image"],
      },
      {
        id: "claude-sonnet-4.5",
        name: "Claude Sonnet 4.5",
        provider: "Anthropic",
        contextWindow: 200000,
        reasoning: true,
        input: ["text"],
      },
    ];

    this.skills = [
      createSkill({
        skillKey: "skill-creator",
        name: "skill-creator",
        description: "Guide for creating or updating repeatable skills for your team.",
        source: "Official",
      }),
      createSkill({
        skillKey: "video-generator",
        name: "video-generator",
        description: "Professional AI video production workflow for structured campaigns.",
        source: "Official",
        disabled: true,
      }),
      createSkill({
        skillKey: "research-pipeline",
        name: "research-pipeline",
        description: "Workspace skill for evidence capture, synthesis, and project handoff.",
        source: "Workspace",
        primaryEnv: "OPENAI_API_KEY",
        missing: { bins: [], env: ["OPENAI_API_KEY"], config: [], os: [] },
      }),
      createSkill({
        skillKey: "excel-analyst",
        name: "excel-analyst",
        description: "Analyze spreadsheet-heavy workflows and draft stakeholder summaries.",
        source: "Installed",
        disabled: true,
        install: [
          {
            id: "npm-install",
            kind: "node",
            label: "Install",
            bins: ["node"],
          },
        ],
        missing: { bins: ["node"], env: [], config: [], os: [] },
      }),
    ];

    this.projects = [
      {
        id: "brand-studio",
        name: "Brand Studio",
        owner: "Jing Chao",
        workspace: "/workspace/brand-studio",
        files: [
          {
            name: "brief.md",
            path: "brief.md",
            missing: false,
            size: 18432,
            updatedAtMs: nowMinus(30),
          },
          {
            name: "requirements.txt",
            path: "requirements.txt",
            missing: false,
            size: 1200,
            updatedAtMs: nowMinus(55),
          },
          {
            name: "copy-deck.md",
            path: "copy-deck.md",
            missing: false,
            size: 9832,
            updatedAtMs: nowMinus(120),
          },
        ],
        sessions: [
          {
            key: buildAgentMainSessionKey({ agentId: "brand-studio" }),
            label: "Landing page rewrite",
            subject: "Revise hero narrative for the product launch page",
            projectId: "brand-studio",
            updatedAt: nowMinus(18),
            totalTokens: 18400,
            messages: [
              sessionMessage("user", "先梳理这个项目的落地页信息架构。", nowMinus(22)),
              sessionMessage(
                "assistant",
                "我会先按 hero、proof、feature blocks 和 CTA 流水线拆解结构。",
                nowMinus(21),
              ),
              sessionMessage("user", "重点看首屏和转化路径。", nowMinus(19)),
            ],
          },
          {
            key: "agent:brand-studio:visual-direction",
            label: "Visual direction",
            subject: "Explore bold visual directions for the redesign",
            projectId: "brand-studio",
            updatedAt: nowMinus(150),
            totalTokens: 9900,
            messages: [
              sessionMessage("user", "我想看三种不一样的视觉方向。", nowMinus(170)),
              sessionMessage(
                "assistant",
                "可以走 editorial、product-lab、campaign poster 三条路线。",
                nowMinus(168),
              ),
            ],
          },
        ],
      },
      {
        id: "checkout-lab",
        name: "Checkout Lab",
        owner: "Yun Han",
        workspace: "/workspace/checkout-lab",
        files: [
          {
            name: "flow-map.md",
            path: "docs/flow-map.md",
            missing: false,
            size: 6120,
            updatedAtMs: nowMinus(70),
          },
          {
            name: "risk-list.csv",
            path: "data/risk-list.csv",
            missing: false,
            size: 4023,
            updatedAtMs: nowMinus(95),
          },
        ],
        sessions: [
          {
            key: buildAgentMainSessionKey({ agentId: "checkout-lab" }),
            label: "Payment friction audit",
            subject: "Reduce drop-off across the checkout funnel",
            projectId: "checkout-lab",
            updatedAt: nowMinus(40),
            totalTokens: 22100,
            messages: [
              sessionMessage("user", "找出支付页里最影响转化的阻塞项。", nowMinus(42)),
              sessionMessage(
                "assistant",
                "我先按输入负担、信任信号、失败恢复三块整理。",
                nowMinus(41),
              ),
            ],
          },
          {
            key: "agent:checkout-lab:promo-rules",
            label: "Promo rules",
            subject: "Untangle coupon logic and error messaging",
            projectId: "checkout-lab",
            updatedAt: nowMinus(210),
            totalTokens: 8700,
            messages: [
              sessionMessage("user", "优惠券和会员价冲突时怎么提示更清楚？", nowMinus(215)),
              sessionMessage(
                "assistant",
                "建议拆成 eligibility、priority、resolution 三层说明。",
                nowMinus(213),
              ),
            ],
          },
        ],
      },
      {
        id: "support-hub",
        name: "Support Hub",
        owner: "Mia Lin",
        workspace: "/workspace/support-hub",
        files: [
          {
            name: "kb-structure.md",
            path: "knowledge/kb-structure.md",
            missing: false,
            size: 7400,
            updatedAtMs: nowMinus(160),
          },
          {
            name: "search-prompts.md",
            path: "knowledge/search-prompts.md",
            missing: false,
            size: 3210,
            updatedAtMs: nowMinus(180),
          },
          {
            name: "faq.txt",
            path: "faq.txt",
            missing: false,
            size: 920,
            updatedAtMs: nowMinus(250),
          },
        ],
        sessions: [
          {
            key: buildAgentMainSessionKey({ agentId: "support-hub" }),
            label: "Search relevance revamp",
            subject: "Improve transcript search and answer retrieval",
            projectId: "support-hub",
            updatedAt: nowMinus(65),
            totalTokens: 14300,
            messages: [
              sessionMessage("user", "把帮助中心搜索改得像真正能找内容的系统。", nowMinus(67)),
              sessionMessage(
                "assistant",
                "先补 query intent、result ranking 和 snippet context 三层。",
                nowMinus(66),
              ),
            ],
          },
        ],
      },
    ];

    this.cronJobs = [
      {
        id: "daily-brand-review",
        agentId: "brand-studio",
        name: "Daily brand review",
        description: "Summarize copy and design changes every morning.",
        enabled: true,
        createdAtMs: nowMinus(1440),
        updatedAtMs: nowMinus(55),
        schedule: { kind: "every", everyMs: 1000 * 60 * 60 * 24 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "agentTurn", message: "Summarize overnight project changes." },
        delivery: { mode: "none" },
        state: { lastStatus: "ok", nextRunAtMs: Date.now() + 1000 * 60 * 60 * 8 },
      },
      {
        id: "checkout-funnel-watch",
        agentId: "checkout-lab",
        name: "Checkout funnel watch",
        description: "Review payment errors and flag new blockers.",
        enabled: true,
        createdAtMs: nowMinus(2880),
        updatedAtMs: nowMinus(140),
        schedule: { kind: "every", everyMs: 1000 * 60 * 60 * 12 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "agentTurn", message: "Review new checkout issues and cluster them." },
        delivery: { mode: "none" },
        state: {
          lastStatus: "error",
          lastError: "Mock API unavailable",
          nextRunAtMs: Date.now() + 1000 * 60 * 60 * 3,
        },
      },
      {
        id: "support-weekly-digest",
        agentId: "support-hub",
        name: "Support weekly digest",
        description: "Weekly summary of search and ticket themes.",
        enabled: false,
        createdAtMs: nowMinus(6000),
        updatedAtMs: nowMinus(320),
        schedule: { kind: "cron", expr: "0 10 * * 1", tz: "Asia/Shanghai" },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "agentTurn", message: "Summarize support knowledge gaps." },
        delivery: { mode: "none" },
        state: { lastStatus: "skipped" },
      },
    ];
  }

  getDefaultModelId() {
    return this.models[0]?.id ?? "gpt-5.4";
  }

  subscribe(listener: (event: WorkbenchAdapterEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async request<T>(_method: string, _params?: unknown): Promise<T> {
    throw new Error("Mock adapter does not implement direct gateway RPC requests.");
  }

  getDefaultSelection() {
    const project = this.projects[0] ?? null;
    return {
      projectId: project?.id ?? null,
      sessionKey: null,
    };
  }

  async snapshot(args: MockSnapshotArgs): Promise<WorkbenchSnapshot> {
    const selectedProject =
      this.projects.find((project) => project.id === args.projectId) ??
      this.projects.find((project) =>
        args.sessionKey
          ? project.sessions.some((session) => session.key === args.sessionKey)
          : false,
      ) ??
      this.projects[0] ??
      null;
    const currentSessionKey = args.sessionKey ?? "";
    const currentSession =
      this.projects
        .flatMap((project) => project.sessions)
        .find((session) => session.key === currentSessionKey) ?? null;
    const agentIdentityById = Object.fromEntries(
      this.projects.map((project) => [
        project.id,
        {
          agentId: project.id,
          name: project.owner,
          avatar: "",
        } satisfies AgentIdentityResult,
      ]),
    );

    return {
      assistantName: "Power UI Prototype",
      currentProjectId: selectedProject?.id ?? null,
      currentSessionKey,
      agentsList: {
        defaultId: this.projects[0]?.id ?? "main",
        mainKey: "main",
        scope: "mock",
        agents: this.projects.map((project) => ({
          id: project.id,
          name: project.name,
        })),
      },
      agentIdentityById,
      agentFilesList: selectedProject
        ? {
            agentId: selectedProject.id,
            workspace: selectedProject.workspace,
            files: [...selectedProject.files],
          }
        : null,
      sessionsResult: {
        ts: Date.now(),
        path: "mock://sessions",
        count: this.projects.reduce((total, project) => total + project.sessions.length, 0),
        defaults: {
          model: this.getDefaultModelId(),
          contextTokens: 200000,
        },
        sessions: this.projects.flatMap((project) =>
          project.sessions.map((session) => ({
            key: session.key,
            kind: "direct" as const,
            label: session.label,
            displayName: session.label,
            subject: session.subject,
            updatedAt: session.updatedAt,
            totalTokens: session.totalTokens,
            model: this.getDefaultModelId(),
            modelProvider: "OpenAI",
          })),
        ),
      },
      chatMessages:
        currentSession?.messages.map((message) => ({
          role: message.role,
          text: message.text,
          timestamp: message.timestamp,
        })) ?? [],
      skillsReport: {
        workspaceDir: "/mock/workspace",
        managedSkillsDir: "/mock/skills",
        skills: [...this.skills],
      },
      cronJobs: [...this.cronJobs],
      modelCatalog: [...this.models],
      toolsCatalogResult: null,
    };
  }

  async createProjectFromFolder(files: File[]) {
    if (files.length === 0) {
      return null;
    }
    const firstRelativePath = (
      (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? ""
    ).trim();
    const folderName =
      firstRelativePath.split("/").filter(Boolean)[0] || `project-${this.nextProjectNumber}`;
    const id = toProjectId(folderName);
    const name = folderName;
    this.nextProjectNumber += 1;
    this.projects.unshift({
      id,
      name,
      owner: "Prototype Owner",
      workspace: `/${folderName}`,
      files: files.slice(0, 12).map((file) => {
        const relativePath = (
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name
        ).trim();
        const parts = relativePath.split("/").filter(Boolean);
        const filePath = parts.length > 1 ? parts.slice(1).join("/") : file.name;
        return {
          name: file.name,
          path: filePath || file.name,
          missing: false,
          size: file.size,
          updatedAtMs: Date.now(),
        } satisfies AgentFileEntry;
      }),
      sessions: [],
    });
    return id;
  }

  async startTask(projectId: string, text: string, _modelId: string): Promise<WorkbenchSendResult> {
    const project = this.requireProject(projectId);
    const timestamp = Date.now();
    const sessionKey = `agent:${projectId}:task-${this.nextSessionNumber}`;
    this.nextSessionNumber += 1;
    const subject = text.trim() || "New project task";
    const session: MockSession = {
      key: sessionKey,
      label: toSessionLabel(subject),
      subject,
      projectId,
      updatedAt: timestamp,
      totalTokens: 1200,
      messages: [],
    };
    project.sessions.unshift(session);
    return {
      sessionKey,
      runId: null,
    };
  }

  async addUserMessage(
    sessionKey: string,
    text: string,
    modelId: string,
  ): Promise<WorkbenchSendResult> {
    const session = this.requireSession(sessionKey);
    const project = this.requireProject(session.projectId);
    const timestamp = Date.now();
    session.messages.push(sessionMessage("user", text, timestamp));
    session.updatedAt = timestamp;
    session.totalTokens += 900;
    const runId = createLocalId();
    this.scheduleMockReply(runId, sessionKey, buildReply(project.name, text, modelId));
    return {
      sessionKey,
      runId,
    };
  }

  async abortRun(_sessionKey: string, runId: string | null) {
    if (!runId) {
      return;
    }
    const pending = this.pendingRuns.get(runId);
    if (!pending) {
      return;
    }
    if (pending.deltaTimer !== null) {
      window.clearTimeout(pending.deltaTimer);
    }
    if (pending.finalTimer !== null) {
      window.clearTimeout(pending.finalTimer);
    }
    this.pendingRuns.delete(runId);
    this.emit({
      type: "chat",
      sessionKey: pending.sessionKey,
      runId,
      state: "aborted",
      text: pending.replyText,
    });
  }

  async setSkillEnabled(skillKey: string, enabled: boolean) {
    const skill = this.requireSkill(skillKey);
    skill.disabled = !enabled;
  }

  async saveSkillKey(skillKey: string, value: string) {
    const skill = this.requireSkill(skillKey);
    if (!skill.primaryEnv) {
      return { ok: true, message: `${skill.name} does not require an API key.` };
    }
    if (!value.trim()) {
      return { ok: false, message: `Enter ${skill.primaryEnv} before saving.` };
    }
    skill.missing = { ...skill.missing, env: [] };
    return { ok: true, message: `${skill.primaryEnv} saved for ${skill.name}.` };
  }

  async installSkill(skillKey: string) {
    const skill = this.requireSkill(skillKey);
    skill.install = [];
    skill.missing = { ...skill.missing, bins: [] };
    skill.source = "Installed";
    return { ok: true, message: `${skill.name} is now installed in the prototype catalog.` };
  }

  private emit(event: WorkbenchAdapterEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private scheduleMockReply(runId: string, sessionKey: string, replyText: string) {
    const entry = {
      sessionKey,
      replyText,
      deltaTimer: null as number | null,
      finalTimer: null as number | null,
    };
    entry.deltaTimer = window.setTimeout(() => {
      this.emit({
        type: "chat",
        sessionKey,
        runId,
        state: "delta",
        text: replyText,
      });
    }, 180);
    entry.finalTimer = window.setTimeout(() => {
      const session = this.requireSession(sessionKey);
      const timestamp = Date.now();
      session.messages.push(sessionMessage("assistant", replyText, timestamp));
      session.updatedAt = timestamp;
      session.totalTokens += 1400;
      this.pendingRuns.delete(runId);
      this.emit({
        type: "chat",
        sessionKey,
        runId,
        state: "final",
        text: replyText,
        message: {
          role: "assistant",
          text: replyText,
          timestamp,
        },
      });
    }, 720);
    this.pendingRuns.set(runId, entry);
  }

  private requireProject(projectId: string) {
    const project = this.projects.find((entry) => entry.id === projectId);
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    return project;
  }

  private requireSession(sessionKey: string) {
    const session = this.projects
      .flatMap((project) => project.sessions)
      .find((entry) => entry.key === sessionKey);
    if (!session) {
      const parsed = parseAgentSessionKey(sessionKey);
      throw new Error(`Unknown session: ${parsed?.rest ?? sessionKey}`);
    }
    return session;
  }

  private requireSkill(skillKey: string) {
    const skill = this.skills.find((entry) => entry.skillKey === skillKey);
    if (!skill) {
      throw new Error(`Unknown skill: ${skillKey}`);
    }
    return skill;
  }
}

function toSessionLabel(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return "New task";
  }
  return trimmed.length > 42 ? `${trimmed.slice(0, 39)}...` : trimmed;
}

function toProjectId(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || `project-${Date.now()}`
  );
}
