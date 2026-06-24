"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { dateInputMin, dateInputMax } from "@/lib/datetime";
import { DateInput } from "@/components/ui/date-input";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/page-skeleton";
import { OperationsTabs } from "@/components/layout/operations-tabs";
import {
  Search, Filter, X, Syringe, Eye, Printer, AlertCircle,
  ChevronDown, Building2,
} from "lucide-react";

interface RxLogEntry {
  id: string;
  prescriptionId: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  prescriptionDate: string;
  doctorName?: string | null;
  patient: { id: string; patientId: string; firstName: string; lastName: string };
  facility: { id: string; name: string };
  medicineCount: number;
  prescribedTotal: number;
  dispensedTotal: number;
  hasControlled: boolean;
}

interface Facility { id: string; name: string; code: string }

const STATUS_COLORS: Record<RxLogEntry["status"], string> = {
  ACTIVE:    "bg-emerald-50 text-emerald-700",
  COMPLETED: "bg-blue-50 text-blue-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

const STATUS_LABELS: Record<RxLogEntry["status"], string> = {
  ACTIVE:    "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const EMPTY_FILTERS = {
  prescriptionId: "",
  patient: "",
  doctor: "",
  facilityId: "",
  status: "",
  dateFrom: "",
  dateTo: "",
  medicine: "",
  controlledOnly: false,
};

export default function PrescriptionLogPage() {
  const hasAccess = useRequirePermission("prescriptions");
  const { user } = useAuth();

  const [list, setList]           = useState<RxLogEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [filters, setFilters]     = useState(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [error, setError]         = useState("");

  useEffect(() => {
    api<Facility[]>("/auth/facilities").then(setFacilities).catch(() => {});
  }, []);

  const buildQuery = useCallback((f: typeof EMPTY_FILTERS) => {
    const p = new URLSearchParams();
    if (f.prescriptionId) p.set("prescriptionId", f.prescriptionId);
    if (f.patient)        p.set("patient", f.patient);
    if (f.doctor)         p.set("doctor", f.doctor);
    if (f.facilityId)     p.set("facilityId", f.facilityId);
    else if (user?.facilityId) p.set("facilityId", user.facilityId);
    if (f.status)         p.set("status", f.status);
    if (f.dateFrom)       p.set("dateFrom", f.dateFrom);
    if (f.dateTo)         p.set("dateTo", f.dateTo);
    if (f.medicine)       p.set("medicine", f.medicine);
    if (f.controlledOnly) p.set("controlledOnly", "true");
    return p.toString();
  }, [user?.facilityId]);

  const load = useCallback((f: typeof EMPTY_FILTERS) => {
    setLoading(true);
    setError("");
    api<RxLogEntry[]>(`/prescriptions?${buildQuery(f)}`)
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load prescriptions"))
      .finally(() => setLoading(false));
  }, [buildQuery]);

  useEffect(() => { load(EMPTY_FILTERS); }, [load]);

  const applyFilters = () => load(filters);
  const clearFilters = () => { setFilters(EMPTY_FILTERS); load(EMPTY_FILTERS); };

  if (!hasAccess) return null;

  const canDispense = can(user?.permissions, "dispensing", "create");
  const showFacility = !user?.facilityId;

  const activeCount = Object.entries(filters).filter(([k, v]) =>
    k === "controlledOnly" ? v === true : !!v
  ).length;

  const colCount = showFacility ? 8 : 7;

  return (
    <div className="space-y-4">
      <OperationsTabs />

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* ── Filters ── */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm font-medium text-slate-700"
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <Filter className="h-4 w-4 text-medflow-600" />
              Filters
              {activeCount > 0 && (
                <span className="rounded-full bg-medflow-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {activeCount}
                </span>
              )}
              <ChevronDown className={`h-4 w-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
            </button>
            <div className="flex gap-2">
              <Button size="sm" onClick={applyFilters}>
                <Search className="mr-1.5 h-3.5 w-3.5" /> Search
              </Button>
              {activeCount > 0 && (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  <X className="mr-1 h-3.5 w-3.5" /> Clear
                </Button>
              )}
            </div>
          </div>

          {filtersOpen && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Prescription Number</label>
                <Input
                  placeholder="RX-..."
                  value={filters.prescriptionId}
                  onChange={(e) => setFilters((f) => ({ ...f, prescriptionId: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Patient (name or ID)</label>
                <Input
                  placeholder="Search…"
                  value={filters.patient}
                  onChange={(e) => setFilters((f) => ({ ...f, patient: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Doctor Name</label>
                <Input
                  placeholder="Search…"
                  value={filters.doctor}
                  onChange={(e) => setFilters((f) => ({ ...f, doctor: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                />
              </div>
              {showFacility && (
                <div>
                  <label className="mb-1 flex items-center gap-1 text-xs text-slate-500">
                    <Building2 className="h-3 w-3" /> Facility
                  </label>
                  <select
                    className="h-10 w-full rounded-lg border bg-white px-3 text-sm"
                    value={filters.facilityId}
                    onChange={(e) => setFilters((f) => ({ ...f, facilityId: e.target.value }))}
                  >
                    <option value="">All facilities</option>
                    {facilities.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs text-slate-500">Status</label>
                <select
                  className="h-10 w-full rounded-lg border bg-white px-3 text-sm"
                  value={filters.status}
                  onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="">All statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>
              <div>
                <label htmlFor="rx-date-from" className="mb-1 block text-xs text-slate-500">Date From</label>
                <DateInput
                  id="rx-date-from"
                  min={dateInputMin()}
                  max={filters.dateTo || dateInputMax()}
                  value={filters.dateFrom}
                  onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="rx-date-to" className="mb-1 block text-xs text-slate-500">Date To</label>
                <DateInput
                  id="rx-date-to"
                  min={filters.dateFrom || dateInputMin()}
                  max={dateInputMax()}
                  value={filters.dateTo}
                  onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Medicine Name</label>
                <Input
                  placeholder="Search…"
                  value={filters.medicine}
                  onChange={(e) => setFilters((f) => ({ ...f, medicine: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="controlledOnly"
                  className="h-4 w-4 accent-medflow-600"
                  checked={filters.controlledOnly}
                  onChange={(e) => setFilters((f) => ({ ...f, controlledOnly: e.target.checked }))}
                />
                <label htmlFor="controlledOnly" className="cursor-pointer text-sm text-slate-700">
                  Controlled Drug Only
                </label>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Table ── */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <tbody><SkeletonRows rows={8} cols={colCount} /></tbody>
              </table>
            </div>
          ) : list.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">No prescriptions found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="border-b bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="p-3 pl-4">Prescription No.</th>
                    <th className="p-3">Patient</th>
                    <th className="p-3">Doctor</th>
                    {showFacility && <th className="p-3">Facility</th>}
                    <th className="p-3">Date</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Medicines</th>
                    <th className="p-3">Dispensed</th>
                    <th className="p-3 text-right pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.map((rx) => {
                    const pct = rx.prescribedTotal > 0
                      ? Math.min(100, Math.round((rx.dispensedTotal / rx.prescribedTotal) * 100))
                      : rx.dispensedTotal > 0 ? 100 : 0;
                    const isActive = rx.status === "ACTIVE";

                    return (
                      <Fragment key={rx.id}>
                        <tr className="hover:bg-slate-50/60">
                          <td className="p-3 pl-4 font-medium">
                            <Link
                              href={`/prescriptions/${rx.id}`}
                              className="text-medflow-700 hover:underline"
                            >
                              {rx.prescriptionId}
                            </Link>
                            {rx.hasControlled && (
                              <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                                <AlertCircle className="h-3 w-3" /> Controlled
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            <span className="font-medium">
                              {rx.patient.firstName} {rx.patient.lastName}
                            </span>
                            <span className="ml-1.5 text-xs text-slate-400">{rx.patient.patientId}</span>
                          </td>
                          <td className="p-3 text-slate-600">{rx.doctorName || "—"}</td>
                          {showFacility && (
                            <td className="p-3 text-slate-600">{rx.facility.name}</td>
                          )}
                          <td className="p-3 text-slate-600">
                            {new Date(rx.prescriptionDate).toLocaleDateString()}
                          </td>
                          <td className="p-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[rx.status]}`}>
                              {STATUS_LABELS[rx.status]}
                            </span>
                          </td>
                          <td className="p-3 text-right">{rx.medicineCount}</td>
                          <td className="p-3">
                            {rx.prescribedTotal > 0 ? (
                              <div className="flex items-center gap-1.5">
                                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
                                  <div
                                    className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-emerald-500" : "bg-medflow-500"}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-xs text-slate-500">
                                  {rx.dispensedTotal}/{rx.prescribedTotal}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">
                                {rx.dispensedTotal > 0 ? `${rx.dispensedTotal} disp.` : "—"}
                              </span>
                            )}
                          </td>
                          <td className="p-3 pr-4">
                            <div className="flex items-center justify-end gap-0.5">
                              <Link href={`/prescriptions/${rx.id}`}>
                                <Button size="sm" variant="ghost" title="View">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </Link>
                              <Link href={`/prescriptions/${rx.id}`} target="_blank">
                                <Button size="sm" variant="ghost" title="Print (opens in new tab)">
                                  <Printer className="h-4 w-4" />
                                </Button>
                              </Link>
                              {canDispense && isActive && (
                                <Link href={`/dispense?patientId=${rx.patient.id}&rxId=${rx.id}`}>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    title="Dispense"
                                    className="text-medflow-600 hover:bg-medflow-50 hover:text-medflow-700"
                                  >
                                    <Syringe className="h-4 w-4" />
                                  </Button>
                                </Link>
                              )}
                                </div>
                          </td>
                        </tr>

                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
