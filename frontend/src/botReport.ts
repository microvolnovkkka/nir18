import { internalMediaURL, markdownImages } from "./editorMedia";

export type BotReply = {
  contract_version: "1.0";
  request_id: string;
  mode: "stub" | "model";
  kind: "report" | "clarification";
  markdown: string;
  warnings: string[];
};

// Work on AST image ranges. Examples in code and ordinary links are author text.
function imageSpans(markdown: string) {
  return markdownImages(markdown).map(({ url, start, end, referenceType }) => {
    const raw = markdown.slice(start, end);
    if (!internalMediaURL.test(url))
      throw new Error("Загрузите изображение «" + url + "» через редактор.");
    let tag = raw;
    if (referenceType) {
      const label =
        referenceType === "shortcut"
          ? raw
          : raw.replace(/\[(?:\\[\s\S]|[^\[\]\\])*\]$/, "");
      tag = label + "(" + url + ")";
    } else if (!tag.endsWith("](" + url + ")")) {
      throw new Error(
        "Проверьте формат изображения «" + url + "» в редакторе.",
      );
    }
    return { start, end, tag };
  });
}

function replaceSpans(
  text: string,
  spans: ReturnType<typeof imageSpans>,
  remove: boolean,
) {
  let start = 0;
  const parts: string[] = [];
  for (const span of spans) {
    parts.push(text.slice(start, span.start), remove ? "" : span.tag);
    start = span.end;
  }
  return parts.join("") + text.slice(start);
}
export function botContext(markdown: string) {
  return replaceSpans(markdown, imageSpans(markdown), false);
}
function sameTags(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const sorted = b.slice().sort();
  return a
    .slice()
    .sort()
    .every((tag, i) => tag === sorted[i]);
}
function tags(text: string) {
  return imageSpans(text).map((s) => s.tag);
}
export function checkReply(
  value: unknown,
  id: string,
  context: string,
): BotReply {
  const r = value as BotReply | null;
  if (
    !r ||
    r.contract_version !== "1.0" ||
    r.request_id !== id ||
    !["report", "clarification"].includes(r.kind) ||
    !["stub", "model"].includes(r.mode) ||
    typeof r.markdown !== "string" ||
    !r.markdown.trim() ||
    [...r.markdown].length > 200000 ||
    !Array.isArray(r.warnings) ||
    r.warnings.length > 10 ||
    !r.warnings.every((w) => typeof w === "string" && [...w].length <= 500)
  )
    throw new Error("Получен неполный ответ бота. Повторите запрос.");
  const images = imageSpans(r.markdown);
  if (
    images.some(
      (image) => r.markdown.slice(image.start, image.end) !== image.tag,
    ) ||
    !sameTags(
      images.map((image) => image.tag),
      r.kind === "report" ? tags(context) : [],
    )
  )
    throw new Error(
      "В ответе изменились ссылки на изображения. Повторите запрос.",
    );
  return r;
}
export function prepareReport(report: string, current: string) {
  const images = imageSpans(report);
  const wanted = tags(current);
  if (
    sameTags(
      images.map((i) => i.tag),
      wanted,
    )
  )
    return { markdown: report, moved: false };
  const text = replaceSpans(report, images, true).trimEnd();
  const markdown = wanted.length
    ? text + "\n\n## Изображения автора\n\n" + wanted.join("\n\n")
    : text;
  if (
    !sameTags(tags(markdown), wanted) ||
    !markdown.trim() ||
    [...markdown].length > 200000
  )
    throw new Error(
      "Не удалось безопасно совместить этот ответ с текущими изображениями. Отправьте сообщение с актуальным текстом редактора.",
    );
  return { markdown, moved: true };
}
