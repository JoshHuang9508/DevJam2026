'use client'

import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  children: string
  streaming?: boolean
}

// 串流游標用 ::after 掛在最後一個區塊元素上，才能跟在文字尾端同一行；
// 用獨立的 span 會因為 markdown 產生的是 block 元素而被推到下一行。
const CURSOR =
  "[&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:animate-pulse [&>*:last-child]:after:text-neutral-400 [&>*:last-child]:after:content-['▍']"

const H = ({ children }: { children?: ReactNode }) => (
  <strong className="mt-2 block text-[13px] font-semibold text-neutral-900 first:mt-0">{children}</strong>
)

export function MarkdownMessage({ children, streaming }: Props) {
  return (
    <div
      className={`text-[13px] leading-relaxed text-neutral-700 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${
        streaming ? CURSOR : ''
      }`}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1.5 whitespace-pre-wrap">{children}</p>,
          h1: H,
          h2: H,
          h3: H,
          h4: H,
          h5: H,
          h6: H,
          strong: ({ children }) => <strong className="font-semibold text-neutral-900">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-4">{children}</ol>,
          li: ({ children }) => <li className="[&>p]:my-0">{children}</li>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-900"
            >
              {children}
            </a>
          ),
          code: ({ children, className }) =>
            className?.includes('language-') ? (
              <code className="block font-mono text-[12px] leading-relaxed">{children}</code>
            ) : (
              <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-800">{children}</code>
            ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-lg bg-neutral-100 px-2.5 py-2">{children}</pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-neutral-300 pl-2.5 text-neutral-500">{children}</blockquote>
          ),
          hr: () => <hr className="my-2.5 border-neutral-200" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-neutral-200 bg-neutral-50 px-2 py-1 text-left font-semibold text-neutral-900">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border border-neutral-200 px-2 py-1 align-top">{children}</td>,
        }}
      >
        {children}
      </Markdown>
    </div>
  )
}
