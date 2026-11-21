import { useEffect, useRef, useState } from "react";

type Props = {
  id: string;
  label: string;
  placeholder: string;
  options: { id: number | string; name: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
};

export function CatalogSelect({
  id,
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled,
  error,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const selected = options.findIndex((o) => String(o.id) === value);
  const open = active !== null && !disabled && options.length > 0;
  const listId = id + "-options";
  const search = useRef({ text: "", time: 0 });
  function choose(index: number) {
    if (options[index]) onChange(String(options[index].id));
    setActive(null);
  }
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setActive(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(listId + active)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, listId, open]);
  return (
    <div className="catalog-choice" ref={root}>
      <label htmlFor={id} id={id + "-label"}>
        {label}
      </label>
      <button
        type="button"
        id={id}
        role="combobox"
        title={options[selected]?.name || placeholder}
        aria-labelledby={id + "-label"}
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? listId + active : undefined}
        aria-invalid={!!error}
        aria-describedby={error ? id + "-error" : undefined}
        disabled={disabled || !options.length}
        onBlur={() => setActive(null)}
        onClick={() => setActive(open ? null : Math.max(selected, 0))}
        onKeyDown={(e) => {
          const last = options.length - 1;
          switch (e.key) {
            case "Escape":
              if (!open) return;
              setActive(null);
              break;
            case "Enter":
            case " ":
              if (!open) return;
              choose(active!);
              break;
            case "ArrowDown":
              setActive(
                open ? Math.min(last, active! + 1) : Math.max(0, selected),
              );
              break;
            case "ArrowUp":
              setActive(
                open
                  ? Math.max(0, active! - 1)
                  : selected >= 0
                    ? selected
                    : last,
              );
              break;
            case "Home":
              setActive(0);
              break;
            case "End":
              setActive(last);
              break;
            default: {
              if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey)
                return;
              const now = Date.now(),
                prefix =
                  (now - search.current.time < 750 ? search.current.text : "") +
                  e.key.toLowerCase();
              search.current = { text: prefix, time: now };
              const index = options.findIndex((o) =>
                o.name.toLowerCase().startsWith(prefix),
              );
              if (index >= 0) setActive(index);
            }
          }
          e.preventDefault();
        }}
      >
        <span>{options[selected]?.name || placeholder}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      <ul
        id={listId}
        role="listbox"
        aria-labelledby={id + "-label"}
        hidden={!open}
      >
        {open &&
          options.map((o, i) => (
            <li
              key={o.id}
              id={listId + i}
              role="option"
              aria-selected={i === selected}
              data-active={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              {o.name}
            </li>
          ))}
      </ul>
      {error && (
        <small className="field-error" role="alert" id={id + "-error"}>
          {error}
        </small>
      )}
    </div>
  );
}
