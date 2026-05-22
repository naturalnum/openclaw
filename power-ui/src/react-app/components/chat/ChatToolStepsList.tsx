import { CheckOutlined, LoadingOutlined } from "@ant-design/icons";
import { isGenericToolStepDetail, type ChatToolStep } from "../../lib/chat-tool-status";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function StepStatusIcon({ complete }: { complete: boolean }) {
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
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200/90"
      aria-hidden
    >
      <LoadingOutlined spin className="text-[12px]" />
    </span>
  );
}

type Props = {
  steps: ChatToolStep[];
};

export function ChatToolStepsList({ steps }: Props) {
  if (steps.length === 0) {
    return null;
  }

  const hasActiveStep = steps.some((step) => !step.complete);
  const completedCount = steps.filter((step) => step.complete).length;

  return (
    <div className="flex w-full justify-start" aria-live={hasActiveStep ? "polite" : "off"}>
      <div className="max-w-[min(100%,42rem)] w-full rounded-[20px] rounded-bl-lg border border-slate-200/65 bg-white/86 px-4 py-3 text-xs text-slate-600 shadow-sm shadow-slate-200/25">
        <p className="mb-2.5 flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500">
          <span>执行步骤</span>
          <span className="font-normal tabular-nums text-slate-400">
            {hasActiveStep ? `${completedCount}/${steps.length}` : `${steps.length} 步已完成`}
          </span>
        </p>
        <ol className="m-0 list-none space-y-0 p-0">
          {steps.map((step, index) => (
            <li
              key={step.key}
              className={cn(
                "relative grid grid-cols-[1.25rem_1.25rem_minmax(0,1fr)] gap-x-2.5",
                index < steps.length - 1 ? "pb-2.5" : "",
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
                <StepStatusIcon complete={step.complete} />
              </div>
              <div className="min-w-0 pt-px">
                <p
                  className={cn(
                    "text-[13px] font-medium leading-snug",
                    step.complete ? "text-slate-700" : "text-slate-800",
                  )}
                >
                  {step.label}
                </p>
                {step.detail.trim() && !isGenericToolStepDetail(step.detail) ? (
                  <p className="mt-0.5 break-words leading-relaxed text-slate-500">{step.detail}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
