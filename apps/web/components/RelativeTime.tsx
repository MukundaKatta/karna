"use client";

import { useEffect, useState } from "react";
import { formatRelativeTime } from "@/lib/utils";

/**
 * Render a relative timestamp (e.g. "less than a minute ago") without
 * triggering a React hydration mismatch.
 *
 * `formatDistanceToNow` depends on the current clock, so the value rendered
 * on the server at prerender time will almost always differ from the value
 * the client computes at hydration time. That produces React error #418
 * ("text content did not match"). Rendering a stable placeholder until the
 * component has mounted on the client avoids the mismatch.
 */
export function RelativeTime({
  timestamp,
  fallback = "",
  className,
}: {
  timestamp: number;
  fallback?: string;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [label, setLabel] = useState(fallback);

  useEffect(() => {
    setMounted(true);
    setLabel(formatRelativeTime(timestamp));

    // Refresh every 30s so "less than a minute ago" eventually ticks over.
    const timer = setInterval(() => {
      setLabel(formatRelativeTime(timestamp));
    }, 30_000);
    return () => clearInterval(timer);
  }, [timestamp]);

  // suppressHydrationWarning is belt-and-braces — the fallback already
  // matches between server and initial client render, but a consumer that
  // passes a non-empty fallback could still get a momentary mismatch.
  return (
    <span className={className} suppressHydrationWarning>
      {mounted ? label : fallback}
    </span>
  );
}
