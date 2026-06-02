"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";

interface SearchResults {
  patients: { id: string; patientId: string; firstName: string; lastName: string }[];
  medicines: { id: string; medicineName: string }[];
  staff: { id: string; workerId: string; firstName: string; lastName: string }[];
  facilities: { id: string; name: string; code: string }[];
  prescriptions: { id: string; prescriptionId: string }[];
  transfers: { id: string; transferCode: string }[];
  returns: { id: string; returnReason: string }[];
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  const search = useCallback(async (term: string) => {
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const data = await api<SearchResults>(`/search?q=${encodeURIComponent(term)}`);
    setResults(data);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(q), 300);
    return () => clearTimeout(t);
  }, [q, search]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(path: string) {
    router.push(path);
    setOpen(false);
    setQ("");
    setResults(null);
  }

  const hasResults =
    results &&
    (results.patients.length ||
      results.medicines.length ||
      results.staff.length ||
      results.facilities.length ||
      results.prescriptions.length ||
      results.transfers.length ||
      results.returns.length);

  return (
    <div ref={ref} className="relative flex-1 max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          className="h-10 border-slate-200 bg-slate-50/80 pl-9 pr-8 text-sm transition focus:bg-white"
          placeholder="Search patients, medicines, staff… (Ctrl+K)"
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => setQ(e.target.value)}
        />
        {q && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            onClick={() => {
              setQ("");
              setResults(null);
            }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && q.length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl animate-in fade-in slide-in-from-top-1 duration-200">
          {!hasResults && <p className="p-4 text-center text-sm text-slate-500">No results</p>}
          {results?.patients.map((p) => (
            <button
              key={p.id}
              type="button"
              className="search-result-item"
              onClick={() => go(`/patients/${p.id}`)}
            >
              <span className="text-xs text-slate-400">Patient</span>
              {p.firstName} {p.lastName} ({p.patientId})
            </button>
          ))}
          {results?.medicines.map((m) => (
            <button key={m.id} type="button" className="search-result-item" onClick={() => go(`/medicines/${m.id}`)}>
              <span className="text-xs text-slate-400">Medicine</span>
              {m.medicineName}
            </button>
          ))}
          {results?.staff.map((s) => (
            <button key={s.id} type="button" className="search-result-item" onClick={() => go(`/healthcare-workers/${s.id}`)}>
              <span className="text-xs text-slate-400">Staff</span>
              {s.firstName} {s.lastName}
            </button>
          ))}
          {results?.facilities.map((f) => (
            <button key={f.id} type="button" className="search-result-item" onClick={() => go(`/admin/facilities/${f.id}`)}>
              <span className="text-xs text-slate-400">Facility</span>
              {f.name} ({f.code})
            </button>
          ))}
          {results?.prescriptions.map((p) => (
            <button key={p.id} type="button" className="search-result-item" onClick={() => go(`/prescriptions/${p.id}`)}>
              <span className="text-xs text-slate-400">Prescription</span>
              {p.prescriptionId}
            </button>
          ))}
          {results?.transfers.map((t) => (
            <button key={t.id} type="button" className="search-result-item" onClick={() => go(`/transfers`)}>
              <span className="text-xs text-slate-400">Transfer</span>
              {t.transferCode}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
