import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { trust: false, strict: "warn", maxExpand: 1000 }],
        ]}
        urlTransform={(url, key) =>
          key === "src"
            ? /^\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
                url,
              )
              ? url
              : ""
            : /^https?:\/\//i.test(url) ||
                /^\/(?!\/)/.test(url) ||
                /^#[\w-]+$/.test(url)
              ? url
              : ""
        }
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              rel="noopener noreferrer"
              target={href?.startsWith("http") ? "_blank" : undefined}
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) =>
            src ? (
              <img src={src} alt={alt || ""} loading="lazy" />
            ) : (
              <span>[Изображение недоступно]</span>
            ),
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
