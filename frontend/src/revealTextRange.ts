// Textarea не гарантирует прокрутку при setSelectionRange.
// Измеряем позицию с тем же шрифтом и переносами, включая длинные строки.
export function revealTextRange(
  field: HTMLTextAreaElement,
  start: number,
  end: number,
) {
  const style = getComputedStyle(field);
  const mirror = document.createElement("div");
  mirror.style.cssText =
    "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;";
  for (const property of [
    "font",
    "line-height",
    "letter-spacing",
    "padding",
    "border",
    "box-sizing",
    "tab-size",
    "text-indent",
    "word-spacing",
  ]) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  mirror.style.width =
    field.clientWidth +
    parseFloat(style.borderLeftWidth) +
    parseFloat(style.borderRightWidth) +
    "px";
  mirror.textContent = field.value.slice(0, start);
  const marker = document.createElement("span");
  marker.textContent = field.value.slice(start, end) || "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  try {
    const top =
      marker.getClientRects()[0].top - mirror.getBoundingClientRect().top;
    field.focus({ preventScroll: true });
    field.setSelectionRange(start, end);
    field.scrollTop = Math.max(
      0,
      top - field.clientHeight / 2 + parseFloat(style.lineHeight) / 2,
    );
    field.scrollLeft = 0;
    field.scrollIntoView({ block: "center", behavior: "instant" });
  } finally {
    mirror.remove();
  }
}
