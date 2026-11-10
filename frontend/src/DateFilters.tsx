import { useRef, useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { DayPicker } from "react-day-picker";
import { ru } from "react-day-picker/locale";
import "react-day-picker/style.css";

const firstDay = "2026-10-01";
const moscowDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const fields = { date_from: "Обновлено с", date_to: "Обновлено по" };
type Key = keyof typeof fields;
type Dates = Record<Key, string>;

function display(iso: string) {
  return iso.split("-").reverse().join(".");
}
function toISO(text: string) {
  return text.split(".").reverse().join("-");
}

export function dateError(
  value: string,
  today = moscowDate.format(new Date()),
) {
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    return "Введите дату целиком в формате ДД.ММ.ГГГГ.";
  if (!isValid(parseISO(value)))
    return "Такой даты нет. Проверьте день и месяц.";
  if (value < firstDay || value > today)
    return `Выберите дату с 01.10.2026 по ${display(today)}.`;
  return "";
}

export function dateRangeError(
  dates: Dates,
  today = moscowDate.format(new Date()),
) {
  return (
    dateError(dates.date_from, today) ||
    dateError(dates.date_to, today) ||
    (dates.date_from && dates.date_to && dates.date_from > dates.date_to
      ? "Дата «с» должна быть не позже даты «по»."
      : "")
  );
}

export function catalogFilters(query: URLSearchParams) {
  const filters = Object.fromEntries(query);
  if (
    dateRangeError({
      date_from: filters.date_from || "",
      date_to: filters.date_to || "",
    })
  ) {
    delete filters.date_from;
    delete filters.date_to;
    delete filters.page;
  }
  return filters;
}

function formatTyping(previous: string, next: string) {
  if (/^\d{8}$/.test(next)) return next.replace(/^(..)(..)(....)$/, "$1.$2.$3");
  if (next.startsWith(previous) && next.length === previous.length + 1) {
    return next.replace(/^(\d{2}(?:\.\d{2})?)(\d)$/, "$1.$2");
  }
  return next;
}

export function DateFilters({
  value,
  onApply,
}: {
  value: Record<string, string>;
  onApply: (dates: Dates) => void;
}) {
  const [draft, setDraft] = useState<Dates>(() => ({
    date_from: display(value.date_from || ""),
    date_to: display(value.date_to || ""),
  }));
  const [error, setError] = useState("");
  const [active, setActive] = useState<Key>("date_from");
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const today = moscowDate.format(new Date());

  function apply(next: Dates) {
    const dates = {
      date_from: toISO(next.date_from),
      date_to: toISO(next.date_to),
    };
    const message = dateRangeError(dates);
    setError(message);
    if (
      !message &&
      (dates.date_from !== (value.date_from || "") ||
        dates.date_to !== (value.date_to || ""))
    ) {
      onApply(dates);
    }
  }
  const other = toISO(draft[active === "date_from" ? "date_to" : "date_from"]);
  const boundary = !dateError(other, today) && other;
  const min = active === "date_to" && boundary ? boundary : firstDay;
  const max = active === "date_from" && boundary ? boundary : today;
  const iso = toISO(draft[active]);
  const selected = iso && !dateError(iso, today) ? parseISO(iso) : undefined;

  return (
    <>
      {(Object.keys(fields) as Key[]).map((key) => (
        <div key={key} className="date-field">
          <label htmlFor={key}>{fields[key]}</label>
          <div>
            <input
              id={key}
              value={draft[key]}
              placeholder="ДД.ММ.ГГГГ"
              inputMode="numeric"
              aria-invalid={Boolean(error)}
              aria-describedby="date-help"
              onChange={(event) => {
                setDraft({
                  ...draft,
                  [key]: formatTyping(draft[key], event.target.value),
                });
                setError("");
              }}
              onBlur={() => apply(draft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <button
              type="button"
              aria-label={`Календарь — ${fields[key]}`}
              aria-haspopup="dialog"
              onClick={() => {
                setActive(key);
                setOpen(true);
                dialog.current?.showModal();
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <rect x="3" y="5" width="18" height="16" rx="3" />
                <path d="M7 3v5m10-5v5M3 11h18" />
              </svg>
            </button>
          </div>
        </div>
      ))}
      <p
        id="date-help"
        className={"date-help" + (error ? " field-error" : "")}
        aria-live="polite"
      >
        {error || "Выберите день в календаре или введите дату и нажмите Enter."}
      </p>
      <dialog
        ref={dialog}
        className="date-dialog"
        aria-labelledby="calendar-title"
        onClose={() => setOpen(false)}
      >
        <div className="calendar-header">
          <strong id="calendar-title">{fields[active]}</strong>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Закрыть календарь"
          >
            ×
          </button>
        </div>
        {open && (
          <DayPicker
            locale={ru}
            mode="single"
            required
            autoFocus
            selected={selected}
            today={parseISO(today)}
            defaultMonth={
              selected && iso >= min && iso <= max
                ? selected
                : parseISO(active === "date_to" && boundary ? min : max)
            }
            startMonth={parseISO(min)}
            endMonth={parseISO(max)}
            disabled={[{ before: parseISO(min) }, { after: parseISO(max) }]}
            onSelect={(day) => {
              const next = { ...draft, [active]: format(day, "dd.MM.yyyy") };
              setDraft(next);
              apply(next);
              dialog.current?.close();
            }}
          />
        )}
      </dialog>
    </>
  );
}
