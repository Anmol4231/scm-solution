import { PageSkeleton } from "@/components/ui/page-skeleton";

/**
 * Route-group loading fallback for all (app)/ routes.
 * Next.js shows this skeleton immediately when a Link is clicked, before the
 * destination page's component has rendered — eliminating the "old page stays
 * visible" behaviour caused by startTransition holding the previous UI.
 */
export default function Loading() {
  return <PageSkeleton />;
}
