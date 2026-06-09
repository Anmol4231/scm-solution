"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Search, X, ChevronDown } from "lucide-react";

export interface MedicineOption {
  id: string;
  medicineName: string;
  strengths?: { strength: string }[];
  genericName?: string;
}

export function medicineDisplayLabel(m: MedicineOption): string {
  if (m.strengths?.length) {
    return `${m.medicineName} ${m.strengths.map((s) => s.strength).join(" / ")}`;
  }
  return m.medicineName;
}

interface Props {
  medicines: MedicineOption[];
  value: string;
  onChange: (medicineId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function MedicineCombobox({
  medicines,
  value,
  onChange,
  placeholder = "Search medicine…",
  disabled,
  className,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = medicines.find((m) => m.id === value) ?? null;

  // Pull any h-* class out of className so it goes on the input box, not the wrapper
  const parts = (className ?? "").split(" ");
  const heightClass = parts.find((p) => /^h-/.test(p)) ?? "h-10";
  const outerClass = parts.filter((p) => !/^h-/.test(p)).join(" ");

  // Sync display text when value changes externally
  useEffect(() => {
    setQuery(selected ? medicineDisplayLabel(selected) : "");
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo((): MedicineOption[] => {
    const q = query.trim().toLowerCase();
    if (!q) return medicines.slice(0, 60);
    return medicines
      .filter(
        (m) =>
          m.medicineName.toLowerCase().includes(q) ||
          medicineDisplayLabel(m).toLowerCase().includes(q) ||
          (m.genericName?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 60);
  }, [query, medicines]);

  // Close on outside click — restore selected label if user typed without picking
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(selected ? medicineDisplayLabel(selected) : "");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [selected]);

  // Scroll highlighted option into view
  useEffect(() => {
    const item = listRef.current?.children[highlighted] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const selectOption = (m: MedicineOption) => {
    onChange(m.id);
    setQuery(medicineDisplayLabel(m));
    setOpen(false);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        setOpen(true);
        setHighlighted(0);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[highlighted]) selectOption(filtered[highlighted]);
        break;
      case "Escape":
        setOpen(false);
        setQuery(selected ? medicineDisplayLabel(selected) : "");
        break;
      case "Tab":
        setOpen(false);
        if (!selected) setQuery("");
        break;
    }
  };

  return (
    <div ref={wrapRef} className={`relative ${outerClass}`}>
      <div
        className={`flex ${heightClass} items-center gap-2 rounded-lg border bg-white px-3 text-sm transition-colors ${
          disabled
            ? "cursor-not-allowed bg-slate-50 opacity-50"
            : "focus-within:border-medflow-400 focus-within:ring-1 focus-within:ring-medflow-400"
        }`}
      >
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlighted(0);
            if (!e.target.value) onChange("");
          }}
          onFocus={() => {
            setOpen(true);
            setHighlighted(0);
          }}
          onKeyDown={handleKeyDown}
        />
        {value && !disabled ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Clear selection"
            onClick={clear}
            className="shrink-0 text-slate-400 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <ChevronDown className="pointer-events-none h-4 w-4 shrink-0 text-slate-400" />
        )}
      </div>

      {open && !disabled && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-white text-sm shadow-lg"
        >
          {filtered.length > 0
            ? filtered.map((m, i) => (
                <li
                  key={m.id}
                  role="option"
                  aria-selected={m.id === value}
                  className={`cursor-pointer px-3 py-2 ${
                    i === highlighted ? "bg-medflow-50 text-medflow-700" : "hover:bg-slate-50"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent blur before select fires
                    selectOption(m);
                  }}
                  onMouseEnter={() => setHighlighted(i)}
                >
                  <span className="font-medium">{m.medicineName}</span>
                  {m.strengths?.length ? (
                    <span className="ml-1 text-slate-500">
                      {m.strengths.map((s) => s.strength).join(" / ")}
                    </span>
                  ) : null}
                  {m.genericName ? (
                    <span className="ml-1 text-xs text-slate-400">({m.genericName})</span>
                  ) : null}
                </li>
              ))
            : query.trim() && (
                <li className="px-3 py-2 text-slate-400">
                  No medicines match &ldquo;{query}&rdquo;
                </li>
              )}
        </ul>
      )}
    </div>
  );
}
