import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { api, APIError } from "./api";

export function imageURLs(markdown: string) {
  const tree = fromMarkdown(markdown);
  const definitions = new Map<string, string>();
  visit(tree, "definition", (node) => {
    if (!definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
  });
  const urls = new Set<string>();
  visit(tree, (node) => {
    if (node.type === "image") urls.add(node.url);
    if (node.type === "imageReference")
      urls.add(definitions.get(node.identifier) || "");
  });
  return [...urls];
}
const internal = /^\/media\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
export async function leaseImages(
  markdown: string,
  csrf: string,
  beforeSave = false,
) {
  const urls = imageURLs(markdown);
  if (beforeSave && urls.some((url) => !internal.test(url)))
    throw new Error(
      "Загрузите изображения через редактор и замените ссылки на локальные или внешние файлы.",
    );
  const ids = urls
    .filter((url) => internal.test(url))
    .map((url) => url.slice("/media/".length));
  if (ids.length > 100)
    throw new Error("В статье может быть до 100 изображений.");
  if (!ids.length) return;
  try {
    await api("/api/media/lease", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ ids }),
    });
  } catch (error) {
    if (error instanceof APIError && error.status === 404)
      throw new Error(
        "Одно из изображений недоступно этому аккаунту. Загрузите свой файл и замените ссылку в статье.",
      );
    throw error;
  }
}
