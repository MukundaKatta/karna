"use client";

import { useEffect, useMemo, useState } from "react";
import { Flag, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/Badge";
import { formatDate } from "@/lib/utils";
import { SkeletonList } from "@/components/Skeleton";

interface ModerationItem {
  kind: "filtered" | "reported";
  id: string;
  sessionId: string;
  messageId?: string;
  timestamp: number;
  reasons: string[];
  level?: "off" | "moderate" | "strict";
  contentHash?: string;
  content?: string;
  replacementContent?: string;
  reporterId?: string;
  details?: string;
}

export default function ModerationPage() {
  const [items, setItems] = useState<ModerationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "filtered" | "reported">("all");

  useEffect(() => {
    let cancelled = false;

    async function fetchModerationItems() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/moderation?limit=100", { cache: "no-store" });
        if (!response.ok) throw new Error(`Moderation request failed with ${response.status}`);
        const payload = (await response.json()) as { items?: ModerationItem[] };
        if (!cancelled) setItems(payload.items ?? []);
      } catch (fetchError) {
        if (!cancelled) {
          setItems([]);
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load moderation queue");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchModerationItems();

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleItems = useMemo(
    () => items.filter((item) => filter === "all" || item.kind === filter),
    [filter, items],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Moderation</h1>
        <p className="text-sm text-dark-400 mt-1">Review filtered and user-reported AI responses.</p>
      </div>

      <div className="flex gap-2">
        {(["all", "filtered", "reported"] as const).map((value) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`rounded-md border px-3 py-2 text-sm ${
              filter === value
                ? "border-primary-500 bg-primary-500/10 text-primary-200"
                : "border-dark-700 bg-dark-900 text-dark-300"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {isLoading ? (
          <SkeletonList count={3} />
        ) : visibleItems.length === 0 ? (
          <div className="rounded-md border border-dark-800 bg-dark-900 p-6 text-sm text-dark-400">
            No moderation items match this view.
          </div>
        ) : (
          visibleItems.map((item) => (
            <article key={item.id} className="rounded-md border border-dark-800 bg-dark-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {item.kind === "filtered" ? (
                    <ShieldAlert size={16} className="text-amber-300" />
                  ) : (
                    <Flag size={16} className="text-red-300" />
                  )}
                  <span className="text-sm font-medium text-white">{item.kind}</span>
                  {item.level && <Badge variant="warning">{item.level}</Badge>}
                </div>
                <span className="text-xs text-dark-500">{formatDate(item.timestamp)}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {item.reasons.map((reason) => (
                  <Badge key={reason} variant="default">{reason}</Badge>
                ))}
              </div>

              <dl className="mt-3 grid gap-2 text-xs text-dark-400 md:grid-cols-2">
                <div>Session: <span className="text-dark-200">{item.sessionId}</span></div>
                {item.messageId && <div>Message: <span className="text-dark-200">{item.messageId}</span></div>}
                {item.reporterId && <div>Reporter: <span className="text-dark-200">{item.reporterId}</span></div>}
                {item.contentHash && <div>Hash: <span className="text-dark-200">{item.contentHash.slice(0, 16)}</span></div>}
              </dl>

              {item.details && <p className="mt-3 text-sm text-dark-300">{item.details}</p>}
              {item.content && (
                <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap rounded-md bg-dark-950 p-3 text-xs text-dark-200">
                  {item.content}
                </pre>
              )}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
