import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { api, APIError } from "./api";

export function markdownImages(markdown: string) {
  const tree = fromMarkdown(markdown);
  const definitions = new Map<string, string>();
  visit(tree, "definition", (node) => {
    if (!definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
  });
  const images: {
    url: string;
    alt: string;
    start: number;
    end: number;
    referenceType?: string;
  }[] = [];
  visit(tree, (node) => {
    if (
      (node.type !== "image" && node.type !== "imageReference") ||
      !node.position
    )
      return;
    images.push({
      ...(node.type === "imageReference"
        ? { referenceType: node.referenceType }
        : {}),
      url:
        node.type === "image"
          ? node.url
          : definitions.get(node.identifier) || "",
      alt: node.alt || "",
      start: node.position.start.offset!,
      end: node.position.end.offset!,
    });
  });
  return images;
}
export function imageURLs(markdown: string) {
  return [...new Set(markdownImages(markdown).map((image) => image.url))];
}

export function imageBlock(
  markdown: string,
  start: number,
  end: number,
  tag: string,
) {
  const before = markdown.slice(0, start);
  const after = markdown.slice(end);
  const prefix =
    !before || /\n[ \t]*\n$/.test(before)
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const suffix = /^\n[ \t]*\n/.test(after)
    ? ""
    : after.startsWith("\n")
      ? "\n"
      : "\n\n";
  return prefix + tag + suffix;
}

export function selectedImageAlt(markdown: string, start: number, end: number) {
  if (start === end) return "";
  return (
    markdownImages(markdown).find(
      (image) =>
        image.start >= start &&
        image.end <= end &&
        !markdown.slice(start, image.start).trim() &&
        !markdown.slice(image.end, end).trim(),
    )?.alt || ""
  );
}
export function invalidImage(markdown: string) {
  return markdownImages(markdown).find(
    (image) => !internalMediaURL.test(image.url),
  );
}
export const internalMediaURL =
  /^\/media\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
export async function leaseImages(markdown: string, csrf: string) {
  const urls = imageURLs(markdown);
  const ids = urls
    .filter((url) => internalMediaURL.test(url))
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
