import type { PropsWithChildren, ReactNode } from "react";

type PageScaffoldProps = PropsWithChildren<{
  actions?: ReactNode;
  /** Tailwind max-width class for inner column (default: max-w-3xl). */
  maxWidthClass?: string;
  /** Extra classes on the inner content column (padding, gap, etc.). */
  innerClassName?: string;
}>;

/**
 * Shared full-height page scaffold for routed React pages.
 */
export function PageScaffold({
  children,
  actions,
  maxWidthClass = "max-w-3xl",
  innerClassName = "gap-6 px-4 py-8 sm:px-6",
}: PageScaffoldProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-slate-50">
      <div className={`mx-auto flex w-full flex-col ${innerClassName} ${maxWidthClass}`}>
        {actions ? <div className="flex items-center justify-end">{actions}</div> : null}
        {children}
      </div>
    </div>
  );
}
