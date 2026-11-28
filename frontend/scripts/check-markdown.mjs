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
  const { imageBlock, imageURLs, invalidImage, selectedImageAlt } =
    await server.ssrLoadModule("/src/editorMedia.ts");
  const url = "/media/30000000-0000-4000-8000-000000000001";
  const uploadedTag = "![Схема](" + url + ")";
  // A selected placeholder (or old image) becomes a standalone Markdown block.
  for (const separator of ["", "\n", "\n\n"]) {
    const before = "Описание" + separator;
    const after = separator + "# Заголовок";
    const original = before + "Рисунок" + after;
    const inserted = imageBlock(original, before.length, before.length + "Рисунок".length, uploadedTag);
    const result = before + inserted + after;
    assert.equal(result, "Описание\n\n" + uploadedTag + "\n\n# Заголовок");
    assert(render(result).includes("<h1>Заголовок</h1>"));
  }
  assert.equal(imageBlock("", 0, 0, uploadedTag), uploadedTag + "\n\n");
  const withImages = [
    "![Схема](" + url + ")",
    "![Повтор][scheme]",
    "[scheme]: " + url,
    "`![Пример](sample.png)`",
    "[Источник](https://example.org)",
    "```md\n![Пример в блоке](local.png)\n```",
  ].join("\n\n");
  assert.deepEqual(imageURLs(withImages), [url]);
  assert.deepEqual(imageURLs("![Внешняя](https://example.org/file.png)"), [
    "https://example.org/file.png",
  ]);
  const tag = "![Схема (рис. 1)](fusion-pipeline.png)";
  const source = "Пример в коде: `" + tag + "`\n\n" + tag;
  const start = source.lastIndexOf(tag);
  assert.deepEqual(invalidImage(source), {
    url: "fusion-pipeline.png",
    alt: "Схема (рис. 1)",
    start,
    end: start + tag.length,
  });
  assert.equal(
    selectedImageAlt(source, start, source.length),
    "Схема (рис. 1)",
  );
  assert.equal(selectedImageAlt(source, start + 1, source.length), "");
  assert.equal(invalidImage(withImages), undefined);
  const code = render(
    [
      "```python\ndef predict(frame):\n    return 'face'\n```",
      "```javascript\nconst label = 'gesture';\n```",
      "```unknown-language\nUnchanged text <tag>\n```",
      "```\nPlain text\n```",
      "$$\nx^2\n$$",
    ].join("\n\n"),
  );
  assert(code.includes("hljs-keyword") && code.includes("hljs-string"));
  assert(
    code.includes("language-python") && code.includes("language-javascript"),
  );
  assert(code.includes("Unchanged text &lt;tag&gt;"));
  assert(code.includes("Plain text") && code.includes("katex-display"));
  const { topicLabel } = await server.ssrLoadModule("/src/shared.tsx");
  assert.equal(topicLabel("Модели FER.  "), "Модели FER");
  assert.equal(topicLabel("A. B и C"), "A. B и C");
  const formula = render("$\\href{javascript:alert(1)}{x}$");
  assert(!formula.includes('href="javascript:'));
  console.log(
    "Markdown: таблицы, формулы, подсветка кода, изображения, метаданные и блокировка опасных URL/HTML — OK",
  );
} finally {
  await server.close();
}
