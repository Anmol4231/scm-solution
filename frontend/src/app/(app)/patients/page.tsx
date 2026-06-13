"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { OperationsTabs } from "@/components/layout/operations-tabs";

interface Patient {
  id: string;
  patientId: string;
  firstName: string;
  lastName: string;
  gender: string;
  age: number;
  phoneNumber?: string;
}

export default function PatientsPage() {
  const hasAccess = useRequirePermission("patients");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    api<Patient[]>(`/patients?q=${encodeURIComponent(q)}`)
      .then(setPatients)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load patients"));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const search = (e: React.FormEvent) => { e.preventDefault(); setError(""); load(); };

  if (!hasAccess) return null;

  return (
    <div className="space-y-4">
      <OperationsTabs />

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <form onSubmit={search} className="flex gap-2 sm:max-w-md">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9 text-base" placeholder="Search by name, patient ID, or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button type="submit" variant="outline">Search</Button>
      </form>

      <div className="space-y-2">
        {patients.map((p) => (
          <Link key={p.id} href={`/patients/${p.id}`}>
            <Card className="transition hover:border-medflow-300">
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-base font-semibold">{p.firstName} {p.lastName}</p>
                  <p className="text-sm text-muted-foreground">{p.patientId} · {p.gender}, {p.age}y{p.phoneNumber ? ` · ${p.phoneNumber}` : ""}</p>
                </div>
                <span className="text-sm font-medium text-medflow-600">View →</span>
              </CardContent>
            </Card>
          </Link>
        ))}
        {patients.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No patients found.</p>}
      </div>
    </div>
  );
}
