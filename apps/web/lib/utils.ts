import { clsx, type ClassValue } from "clsx";
import { format, formatDistanceToNow, isValid } from "date-fns";

/** Merge Tailwind classes with clsx */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/** Format a Unix timestamp (ms) to readable date string */
export function formatDate(timestamp: number, pattern = "MMM d, yyyy HH:mm"): string {
  const date = new Date(timestamp);
  if (!isValid(date)) return "Invalid date";
  return format(date, pattern);
}

/** Format a Unix timestamp (ms) to relative time */
export function formatRelativeTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (!isValid(date)) return "Invalid date";
  return formatDistanceToNow(date, { addSuffix: true });
}

/** Format cost in USD */
export function formatCost(costUsd: number): string {
  if (costUsd < 0.01) {
    return `$${costUsd.toFixed(4)}`;
  }
  return `$${costUsd.toFixed(2)}`;
}

/** Format token count with K/M suffix */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

/** Truncate a string to maxLen characters */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "\u2026";
}

/** Generate a simple unique ID */
export function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Risk level color mapping */
export function riskColor(level: string): string {
  switch (level) {
    case "low":
      return "text-success-400";
    case "medium":
      return "text-warning-400";
    case "high":
      return "text-danger-400";
    case "critical":
      return "text-red-600";
    default:
      return "text-dark-300";
  }
}

/** Risk level background color mapping */
export function riskBgColor(level: string): string {
  switch (level) {
    case "low":
      return "bg-success-500/20 text-success-400";
    case "medium":
      return "bg-warning-500/20 text-warning-400";
    case "high":
      return "bg-danger-500/20 text-danger-400";
    case "critical":
      return "bg-red-900/40 text-red-400";
    default:
      return "bg-dark-700 text-dark-300";
  }
}

/** Status color mapping */
export function statusColor(status: string): string {
  switch (status) {
    case "active":
    case "running":
    case "ready":
    case "completed":
      return "bg-success-500/20 text-success-400";
    case "idle":
    case "paused":
    case "pending":
      return "bg-warning-500/20 text-warning-400";
    case "error":
    case "failed":
    case "terminated":
      return "bg-danger-500/20 text-danger-400";
    case "suspended":
    case "stopped":
      return "bg-dark-600 text-dark-300";
    default:
      return "bg-dark-700 text-dark-300";
  }
}
