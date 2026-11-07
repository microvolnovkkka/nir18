import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});
try {
  const { Markdown } = await server.ssrLoadModule("/src/Markdown.tsx");
  const render = (text) =>
    renderToStaticMarkup(createElement(Markdown, { text }));
  const unsafe = render(
    "<script>alert(1)</script>\n\n[x](javascript:alert%281%29)\n\n![x](https://example.com/tracker.png)\n\n[x](//example.com)",
  );
  assert(!/<script|src="https?:|href="javascript:|href="\/\//i.test(unsafe));
  const safe = render(
    "| A | B |\n|---|---|\n| 1 | 2 |\n\n$x^2$\n\n![Схема](/media/30000000-0000-4000-8000-000000000001)\n\n[Источник](https://example.com)",
  );
  assert(
    safe.includes("<table>") &&
      safe.includes("katex") &&
      safe.includes('src="/media/'),
  );
  assert(safe.includes('rel="noopener noreferrer"'));
  const formula = render("$\\href{javascript:alert(1)}{x}$");
  assert(!formula.includes('href="javascript:'));
  console.log(
    "Markdown: таблицы, формулы, изображения и блокировка опасных URL/HTML — OK",
  );
} finally {
  await server.close();
}
