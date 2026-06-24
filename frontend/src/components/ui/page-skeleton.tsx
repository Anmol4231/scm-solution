/**
 * Reusable skeleton primitives used by loading.tsx and inline page loading states.
 * All use animate-pulse so the visual language is consistent across the app.
 */

function Bone({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

// ── Full-page skeleton shown by (app)/loading.tsx on every route transition ──
export function PageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Bone className="h-7 w-44" />
          <Bone className="h-4 w-28" />
        </div>
        <Bone className="h-9 w-28" />
      </div>

      {/* Stat / card row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border bg-white p-4">
            <Bone className="h-3 w-20" />
            <Bone className="mt-3 h-6 w-12" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3">
          <Bone className="h-9 w-56" />
        </div>
        <div className="divide-y">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <Bone className="h-4 w-20" />
              <Bone className="h-4 w-32" />
              <Bone className="h-4 flex-1" />
              <Bone className="h-4 w-16" />
              <Bone className="h-7 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Table-row skeletons (drop inside <tbody> while data loads) ──
export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {[...Array(rows)].map((_, i) => (
        <tr key={i}>
          {[...Array(cols)].map((_, j) => (
            <td key={j} className="px-4 py-3.5">
              <Bone className={`h-4 ${j === 0 ? "w-24" : j === cols - 1 ? "w-14" : "w-32"}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ── Card-grid skeletons (drop inside a grid while data loads) ──
export function CardSkeletons({ count = 8 }: { count?: number }) {
  return (
    <>
      {[...Array(count)].map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl border bg-white p-5">
          <Bone className="h-9 w-9 rounded-lg" />
          <Bone className="mt-3 h-4 w-3/4" />
          <Bone className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </>
  );
}

// ── Stat-card skeleton row ──
export function StatCardSkeletons({ count = 5 }: { count?: number }) {
  return (
    <>
      {[...Array(count)].map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl border bg-white p-4">
          <Bone className="h-3 w-16" />
          <Bone className="mt-3 h-7 w-10" />
        </div>
      ))}
    </>
  );
}
