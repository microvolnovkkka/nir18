import { useRef, useState } from "react";

type Dates = { date_from: string; date_to: string };

export function dateError(value: string): string {
  if (!value) return "";
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) {
    return "Введите дату полностью: день, месяц и четырёхзначный год (1000–9999).";
  }
  const parsed = new Date(value + "T00:00:00Z");
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    return "Такой даты нет. Проверьте день и месяц.";
  }
  return "";
}

export function dateRangeError(dates: Dates): string {
  return (
    dateError(dates.date_from) ||
    dateError(dates.date_to) ||
    (dates.date_from && dates.date_to && dates.date_from > dates.date_to
      ? "Дата «с» должна быть не позже даты «по»."
      : "")
  );
}

export function DateFilters({
  value,
  onApply,
}: {
  value: Record<string, string>;
  onApply: (dates: Dates) => void;
}) {
  // Нативное поле хранит незавершённые сегменты; читаем оба поля только при применении.
  const inputs = useRef<Record<keyof Dates, HTMLInputElement | null>>({
    date_from: null,
    date_to: null,
  });
  const [error, setError] = useState("");
  function apply() {
    const draft = {
      date_from: inputs.current.date_from?.value || "",
      date_to: inputs.current.date_to?.value || "",
    };
    const incomplete = Object.values(inputs.current).some(
      (input) => input?.validity.badInput,
    );
    const message = incomplete
      ? "Завершите ввод даты или полностью очистите поле."
      : dateRangeError(draft);
    setError(message);
    if (
      !message &&
      (draft.date_from !== (value.date_from || "") ||
        draft.date_to !== (value.date_to || ""))
    )
      onApply(draft);
  }
  return (
    <>
      {(
        [
          ["date_from", "Обновлено с"],
          ["date_to", "Обновлено по"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            type="date"
            min="1000-01-01"
            max="9999-12-31"
            ref={(input) => {
              inputs.current[key] = input;
            }}
            defaultValue={value[key] || ""}
            aria-invalid={Boolean(error)}
            aria-describedby="date-help"
            onInput={() => setError("")}
            onBlur={apply}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        </label>
      ))}
      <p
        id="date-help"
        className={"date-help" + (error ? " field-error" : "")}
        aria-live="polite"
      >
        {error || "Даты применяются после выхода из поля или Enter."}
      </p>
    </>
  );
}
