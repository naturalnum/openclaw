import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const mdComponents: Components = {
  a: ({ children, href }) => (
    <a
      href={href}
      className="font-medium text-slate-700 underline decoration-slate-400 underline-offset-2 hover:text-slate-900"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => (
    <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-snug">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mb-1.5 mt-2 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-2 text-sm font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-1.5 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-4 border-neutral-300 pl-3 text-slate-600">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-neutral-300" />,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-x-auto rounded-lg border border-neutral-300/80">
      <table className="w-full min-w-[12rem] border-collapse text-left text-[13px]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-neutral-50">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-neutral-300/80 px-2 py-1.5 font-semibold text-slate-800">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-neutral-200/80 px-2 py-1.5 text-slate-700">{children}</td>
  ),
  tr: ({ children }) => <tr>{children}</tr>,
  code: ({ className, children, ...props }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[13px] text-slate-800"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={`block font-mono text-[13px] text-slate-800 ${className ?? ""}`} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 max-h-72 overflow-auto rounded-lg border border-neutral-300/80 bg-neutral-50 p-3 leading-snug">
      {children}
    </pre>
  ),
};

type ChatMarkdownBodyProps = {
  source: string;
  className?: string;
};

/** 助手侧 Markdown（GFM）；默认不渲染 raw HTML，由 react-markdown 转义 */
export function ChatMarkdownBody({ source, className }: ChatMarkdownBodyProps) {
  return (
    <div
      className={
        className ??
        "chat-markdown break-words text-sm leading-snug text-slate-800 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      }
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
