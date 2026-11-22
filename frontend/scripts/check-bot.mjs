import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});
try {
  const { botContext, prepareReport, checkReply } =
    await server.ssrLoadModule("/src/botReport.ts");
  const url = "/media/30000000-0000-4000-8000-000000000001";
  const tag = "![График \\[A\\]](" + url + ")";
  const note = "Пример: `" + tag + "`\n\n```md\n" + tag + "\n```";
  const two = note + "\n\n" + tag + "\n\n" + tag;
  const reference = "![График \\[A\\]][fig]\n\n[fig]: " + url;
  assert.equal(botContext(reference), tag + "\n\n[fig]: " + url);
  assert.equal(
    botContext("![fig][]\n\n![fig]\n\n[fig]: " + url),
    "![fig](" + url + ")\n\n![fig](" + url + ")\n\n[fig]: " + url,
  );
  assert.deepEqual(prepareReport(two, two + "\nПравка"), {
    markdown: two,
    moved: false,
  });
  assert.deepEqual(prepareReport(two, ""), { markdown: note, moved: true });
  assert.deepEqual(prepareReport(note, two), {
    markdown: note + "\n\n## Изображения автора\n\n" + tag + "\n\n" + tag,
    moved: true,
  });
  assert.throws(() => prepareReport("```\nнезакрытый блок", two));
  const reply = {
    request_id: "test",
    contract_version: "1.0",
    kind: "report",
    mode: "stub",
    markdown: two,
    warnings: [],
  };
  assert.equal(checkReply(reply, "test", two), reply);
  assert.throws(() => checkReply(reply, "other", two));
  assert.throws(() =>
    checkReply({ ...reply, markdown: note + "\n\n" + tag }, "test", two),
  );
  assert.throws(() =>
    checkReply(
      { ...reply, markdown: two.replaceAll("График", "Схема") },
      "test",
      two,
    ),
  );
  assert.throws(() =>
    checkReply({ ...reply, kind: "clarification" }, "test", two),
  );
  assert.throws(() =>
    checkReply(
      { ...reply, markdown: "![a](https://example.org/x)" },
      "test",
      "",
    ),
  );
  assert.equal(
    checkReply({ ...reply, kind: "clarification", markdown: note }, "test", two)
      .kind,
    "clarification",
  );
  console.log(
    "Бот: контракт, снимки Markdown, точные ссылки, повторы, reference-вставки и примеры в коде — OK",
  );
} finally {
  await server.close();
}
