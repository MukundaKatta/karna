import { cn } from "@/lib/utils";

/**
 * Skeleton — a low-key shimmer placeholder for content that is loading.
 *
 * Uses `animate-pulse` (already covered by the global prefers-reduced-motion
 * guard, so it stills for motion-sensitive users) and is marked aria-hidden so
 * screen readers ignore the placeholder. Pair with an aria-live "Loading…"
 * status elsewhere if you need an announcement.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-dark-700/60", className)}
    />
  );
}

/**
 * SkeletonCard — a placeholder shaped like the catalog/list cards used across
 * the dashboard (icon + title + description lines), so loading states don't
 * shift the layout when real content arrives.
 */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    </div>
  );
}

/**
 * SkeletonCardGrid — a responsive grid of {@link SkeletonCard}s matching the
 * catalog grid (`md:grid-cols-2 xl:grid-cols-3`).
 */
export function SkeletonCardGrid({ count = 6 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/**
 * SkeletonListRow — a placeholder shaped like the full-width row cards used in
 * list views (icon + title/subtitle + trailing action).
 */
export function SkeletonListRow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-xl border border-dark-700 bg-dark-800 p-5", className)}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-8 w-20 rounded-md shrink-0" />
      </div>
    </div>
  );
}

/** SkeletonList — a stack of {@link SkeletonListRow}s for vertical list views. */
export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonListRow key={i} />
      ))}
    </div>
  );
}
