import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Optional icon (e.g. a lucide icon element) shown in a tinted bubble. */
  icon?: React.ReactNode;
  /** Primary message — what's empty. */
  title: string;
  /** Optional supporting line giving context or a next step. */
  description?: string;
  /** Optional call-to-action (button / link). */
  action?: React.ReactNode;
  className?: string;
}

/**
 * EmptyState — a consistent, friendly placeholder for "no data yet" views.
 *
 * Replaces the ad-hoc centered-text empty blocks scattered across the dashboard
 * with a single component: tinted icon bubble, title, optional description, and
 * an optional action. Keeps the existing card chrome (rounded border + dark
 * surface) so it drops into the same slots without layout changes.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dark-700 bg-dark-800 px-5 py-12",
        "flex flex-col items-center justify-center text-center",
        className,
      )}
    >
      {icon && (
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-dark-700/70 text-dark-300 mb-4">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-dark-200">{title}</p>
      {description && (
        <p className="mt-1 text-sm text-dark-400 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
