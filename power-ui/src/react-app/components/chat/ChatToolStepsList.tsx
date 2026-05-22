import { CheckOutlined, LoadingOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import type { ChatToolStep } from "../../lib/chat-tool-status";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function StepStatusIcon({ complete, active }: { complete: boolean; active: boolean }) {
  if (complete) {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 ring-1 ring-slate-200/90"
        aria-hidden
      >
        <CheckOutlined className="text-[11px]" />
      </span>
    );
  }
  if (active) {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200/90"
        aria-hidden
      >
        <LoadingOutlined spin className="text-[12px]" />
      </span>
    );
  }
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200/70"
      aria-hidden
    >
      <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
    </span>
  );
}

export type ChatToolStepsPhase = "running" | "waiting_reply" | "done";

type Props = {
  steps: ChatToolStep[];
  phase: ChatToolStepsPhase;
  /** 仅 loading 等短内容时收窄气泡，避免占满整行 */
  fitContent?: boolean;
  /** 与步骤同卡展示：流式正文或等待首 token */
  children?: ReactNode;
};

function phaseTitle(phase: ChatToolStepsPhase, stepCount: number): string {
  if (phase === "running") {
    return "正在处理";
  }
  if (phase === "waiting_reply") {
    return "正在生成回复";
  }
  return stepCount > 0 ? "处理完成" : "处理中";
}

export function ChatToolStepsList({ steps, phase, fitContent = false, children }: Props) {
  if (steps.length === 0 && !children) {
    return null;
  }

  const hasActiveStep = steps.some((step) => !step.complete);
  const activeIndex = steps.findIndex((step) => !step.complete);
  const showSteps = steps.length > 0;

  return (
    <div
      className="flex w-full justify-start"
      aria-live={phase === "running" || phase === "waiting_reply" ? "polite" : "off"}
    >
      <div
        className={cn(
          "max-w-[min(100%,42rem)] rounded-[22px] rounded-bl-lg border border-slate-200/65 bg-white/92 text-slate-700 shadow-sm shadow-slate-200/25",
          fitContent ? "w-fit" : "w-full",
        )}
      >
        {showSteps ? (
          <div className="px-4 py-3">
            <p className="mb-2.5 flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500">
              <span>{phaseTitle(phase, steps.length)}</span>
              {steps.length > 1 ? (
                <span className="font-normal tabular-nums text-slate-400">
                  共 {steps.length} 步
                </span>
              ) : null}
            </p>
            <ol className="m-0 list-none space-y-0 p-0">
              {steps.map((step, index) => {
                const isActive = !step.complete && index === activeIndex;
                return (
                  <li
                    key={step.key}
                    className={cn(
                      "relative grid grid-cols-[1.25rem_1.25rem_minmax(0,1fr)] gap-x-2.5",
                      index < steps.length - 1 ? "pb-2" : "",
                    )}
                  >
                    {index < steps.length - 1 ? (
                      <span
                        className="pointer-events-none absolute left-[1.625rem] top-6 bottom-0 w-px bg-slate-200/90"
                        aria-hidden
                      />
                    ) : null}
                    <span
                      className="mt-0.5 text-right text-[11px] font-semibold tabular-nums text-slate-400"
                      aria-hidden
                    >
                      {index + 1}
                    </span>
                    <div className="mt-0.5">
                      <StepStatusIcon complete={step.complete} active={isActive} />
                    </div>
                    <div className="min-w-0 pt-px">
                      <p
                        className={cn(
                          "text-[13px] font-medium leading-snug",
                          step.complete ? "text-slate-600" : "text-slate-800",
                        )}
                      >
                        {step.label}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {phase === "waiting_reply" && !hasActiveStep ? (
              <p className="mt-2.5 flex items-center gap-2 text-[12px] text-slate-500">
                <LoadingOutlined spin className="text-[11px]" aria-hidden />
                正在整理回复内容…
              </p>
            ) : null}
          </div>
        ) : null}
        {children ? (
          <div
            className={cn(
              "text-[15px] leading-relaxed text-slate-800",
              fitContent ? "px-3.5 py-2.5" : "px-4 pb-3",
              showSteps ? "border-t border-slate-200/50 pt-3" : fitContent ? "" : "pt-3",
            )}
          >
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
