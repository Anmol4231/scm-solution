"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { clampDateStr, dateInputMin, dateInputMax, minYear, maxYear } from "@/lib/datetime";

/**
 * Fully controlled date input — a drop-in replacement for <input type="date">.
 *
 * WHY this exists: the native date widget renders a segmented spinner whose
 * internal state JS cannot read. It lets users type 5–6 digit years (275760 =
 * JS max date) and, when only the year segment is filled, input.value is "" so
 * no onChange clamp can ever fire. There is no reliable way to enforce a year
 * range with the native widget.
 *
 * This component owns the value end-to-end:
 *  - A masked TEXT field (dd-mm-yyyy). The year segment is physically capped at
 *    4 digits, so 275760 / 9325 cannot even be typed.
 *  - Any year outside [minYear, maxYear] is clamped the instant the date is
 *    complete, so an invalid year can never remain visible.
 *  - A custom calendar popup whose month/year selectors are bounded to the
 *    valid range, so the calendar path is constrained too.
 *  - It only ever emits a fully-valid, in-range YYYY-MM-DD (or "") via onChange,
 *    so submit/filter guards never receive a bad value.
 *
 * Contract is identical to the old wrapper: `value` is YYYY-MM-DD and `onChange`
 * receives an event whose `target.value` is YYYY-MM-DD (or "").
 */

interface DateInputProps {
  value?: string;
  onChange?: (e: { target: { value: string } }) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  "aria-label"?: string;
  /** Drop the bordered wrapper so the field blends into a custom container. */
  bare?: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "YYYY-MM-DD" -> "dd-mm-yyyy" for display. Tolerates full ISO timestamps
 * ("2030-01-01T00:00:00Z") by reading the leading date, so existing DB values
 * are never rendered blank. Pure string ops — no Date(), so no timezone shift.
 */
function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso || "").slice(0, 10));
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Build the masked display string from raw digits (max 8: ddmmyyyy). */
function digitsToDisplay(digits: string): string {
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  if (digits.length <= 2) return dd;
  if (digits.length <= 4) return `${dd}-${mm}`;
  return `${dd}-${mm}-${yyyy}`;
}

// Suffix of the "dd-mm-yyyy" mask that hasn't been typed yet, indexed by digit count (0–8).
const GHOST_SUFFIX = ["", "_-mm-yyyy", "-mm-yyyy", "_-yyyy", "-yyyy", "___", "__", "_", ""];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function DateInput({
  value = "",
  onChange,
  min,
  max,
  disabled,
  required,
  className,
  id,
  name,
  placeholder = "dd-mm-yyyy",
  bare,
  ...rest
}: DateInputProps) {
  const effectiveMin = min || dateInputMin();
  const effectiveMax = max || dateInputMax();
  const ariaLabel = rest["aria-label"];

  const [text, setText] = useState<string>(() => isoToDisplay(value));
  const [open, setOpen] = useState(false);
  const focusedRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Sync display from the controlled value when the field is NOT being edited
  // (e.g. a parent "Clear" button, or an external reset). Never clobber while typing.
  useEffect(() => {
    if (!focusedRef.current) setText(isoToDisplay(value));
  }, [value]);

  // Close the calendar on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const emit = (iso: string) => onChange?.({ target: { value: iso } });

  const commitDigits = (rawDigits: string) => {
    let digits = rawDigits.replace(/\D/g, "").slice(0, 8);

    // Clamp the year to [minYear, maxYear] the moment all 4 year digits exist,
    // so an out-of-range year is never left visible.
    if (digits.length === 8) {
      let year = Number(digits.slice(4, 8));
      if (year < minYear()) year = minYear();
      else if (year > maxYear()) year = maxYear();
      digits = digits.slice(0, 4) + String(year);
    }

    setText(digitsToDisplay(digits));

    if (digits.length === 8) {
      const iso = `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
      // clampDateStr rejects impossible dates (e.g. 31-02) -> "" and applies min/max bounds.
      emit(clampDateStr(iso, effectiveMin, effectiveMax));
    } else {
      emit(""); // incomplete -> not a usable value
    }
  };

  const onTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    commitDigits(e.target.value);
  };

  const selectFromCalendar = (iso: string) => {
    const clamped = clampDateStr(iso, effectiveMin, effectiveMax);
    setText(isoToDisplay(clamped));
    emit(clamped);
    setOpen(false);
  };

  const showError = text.replace(/\D/g, "").length === 8 && !value;
  const ghost = GHOST_SUFFIX[Math.min(text.replace(/\D/g, "").length, 8)];

  const fieldClasses = bare
    ? cn("bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50", className)
    : cn(
        "relative inline-flex h-11 w-full items-center rounded-lg border bg-background focus-within:ring-2 focus-within:ring-medflow-500",
        showError ? "border-red-500" : "border-input",
        className
      );

  if (bare) {
    // Borderless variant for embedding inside a custom container (no calendar popup).
    return (
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        aria-invalid={showError || undefined}
        placeholder={placeholder}
        className={fieldClasses}
        value={text}
        onFocus={() => { focusedRef.current = true; }}
        onBlur={() => { focusedRef.current = false; setText(isoToDisplay(value)); }}
        onChange={onTextChange}
      />
    );
  }

  return (
    <div ref={wrapRef} className={fieldClasses}>
      {/* Transparent input captures keyboard/focus; the overlay below renders visible text. */}
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        aria-invalid={showError || undefined}
        placeholder={placeholder}
        className="h-full w-full rounded-lg bg-transparent px-3 pr-9 text-base outline-none text-transparent caret-slate-900 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
        value={text}
        onFocus={() => { focusedRef.current = true; }}
        onBlur={() => {
          focusedRef.current = false;
          setText(isoToDisplay(value));
        }}
        onChange={onTextChange}
      />
      {/* Ghost overlay: typed text (dark) + remaining format hint (dim) */}
      <div
        aria-hidden="true"
        className="pointer-events-none select-none absolute inset-0 flex items-center px-3 pr-9 text-base"
      >
        <span className="text-slate-800">{text}</span>
        <span className="text-slate-300">{ghost}</span>
      </div>
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Open calendar"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 disabled:opacity-50"
      >
        <CalendarDays className="h-4 w-4" />
      </button>
      {open && !disabled && (
        <CalendarPopup
          value={value}
          min={effectiveMin}
          max={effectiveMax}
          onSelect={selectFromCalendar}
        />
      )}
    </div>
  );
}

function CalendarPopup({
  value,
  min,
  max,
  onSelect,
}: {
  value: string;
  min: string;
  max: string;
  onSelect: (iso: string) => void;
}) {
  // Parse YYYY-MM-DD by component (NOT new Date(str), which is UTC and can shift
  // the month/day in negative-offset timezones).
  const parse = (s: string): { y: number; m: number } | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((s || "").slice(0, 10));
    return m ? { y: Number(m[1]), m: Number(m[2]) - 1 } : null;
  };
  const valueDate = (value || "").slice(0, 10); // compare selected day TZ-safely
  const minP = parse(min)!;
  const maxP = parse(max)!;
  const today = new Date();
  const initial = parse(value) ?? { y: today.getFullYear(), m: today.getMonth() };
  const [vy, setVy] = useState<number>(Math.min(Math.max(initial.y, minYear()), maxYear()));
  const [vm, setVm] = useState<number>(initial.m);

  const years: number[] = [];
  for (let y = minYear(); y <= maxYear(); y++) years.push(y);

  const startDow = new Date(vy, vm, 1).getDay();
  const daysInMonth = new Date(vy, vm + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const isoOf = (day: number) => `${vy}-${pad(vm + 1)}-${pad(day)}`;
  const dayDisabled = (day: number) => {
    const iso = isoOf(day);
    return iso < min || iso > max;
  };

  const step = (delta: number) => {
    let m = vm + delta;
    let y = vy;
    if (m < 0) { m = 11; y -= 1; }
    else if (m > 11) { m = 0; y += 1; }
    if (y < minYear() || y > maxYear()) return;
    setVy(y);
    setVm(m);
  };

  const prevDisabled = vy < minP.y || (vy === minP.y && vm <= minP.m);
  const nextDisabled = vy > maxP.y || (vy === maxP.y && vm >= maxP.m);

  // Edge-aware placement: render at the default anchor, measure, then flip
  // horizontally/vertically if it would overflow the viewport. Runs before
  // paint (useLayoutEffect) to avoid a visible jump.
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ alignRight: boolean; openUp: boolean }>({ alignRight: false, openUp: false });
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    setPos({
      alignRight: r.right > vw - 8 && r.width <= vw - 8,
      openUp: r.bottom > vh - 8 && r.top - r.height - 8 > 0,
    });
  }, []);

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Choose date"
      className={cn(
        "absolute z-50 w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white p-3 shadow-lg",
        pos.alignRight ? "right-0" : "left-0",
        pos.openUp ? "bottom-full mb-1" : "top-full mt-1"
      )}
    >
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          disabled={prevDisabled}
          onClick={() => step(-1)}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <select
          value={vm}
          onChange={(e) => setVm(Number(e.target.value))}
          className="flex-1 rounded border border-slate-200 px-1 py-1 text-sm"
          aria-label="Month"
        >
          {MONTHS.map((mName, i) => <option key={i} value={i}>{mName}</option>)}
        </select>
        <select
          value={vy}
          onChange={(e) => setVy(Number(e.target.value))}
          className="rounded border border-slate-200 px-1 py-1 text-sm"
          aria-label="Year"
        >
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button
          type="button"
          disabled={nextDisabled}
          onClick={() => step(1)}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs text-slate-500 font-medium">
        {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />;
          const iso = isoOf(day);
          const selected = iso === valueDate;
          const dis = dayDisabled(day);
          return (
            <button
              key={day}
              type="button"
              disabled={dis}
              onClick={() => onSelect(iso)}
              className={cn(
                "h-8 rounded text-sm text-slate-700 hover:bg-medflow-50",
                selected && "bg-medflow-500 text-white hover:bg-medflow-500",
                dis && "cursor-not-allowed text-slate-300 hover:bg-transparent"
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
