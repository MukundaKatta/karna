"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/Badge";

interface WebHealthResponse {
  status?: string;
  configured?: boolean;
  gateway?: {
    serverUrlConfigured?: boolean;
    publicUrlConfigured?: boolean;
    webSocketUrlConfigured?: boolean;
  };
  errors?: string[];
  timestamp?: string;
}

interface GatewayHealthResponse {
  status?: string;
  uptimeHuman?: string;
  sessions?: number;
  connections?: number;
  database?: string;
  version?: string;
  memoryUsage?: {
    heapUsedMB?: number;
    rssMB?: number;
  };
}

function statusVariant(status?: string): "success" | "warning" | "danger" {
  if (status === "healthy") {
    return "success";
  }

  if (status === "degraded") {
    return "warning";
  }

  return "danger";
}

export function StatusPageClient({ betaProtected }: { betaProtected: boolean }) {
  const [webHealth, setWebHealth] = useState<WebHealthResponse | null>(null);
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      try {
        setLoading(true);
        setError(null);

        const [webResponse, gatewayResponse] = await Promise.all([
          fetch("/api/health", { cache: "no-store" }),
          fetch("/api/gateway", { cache: "no-store" }),
        ]);

        const [webPayload, gatewayPayload] = await Promise.all([
          webResponse.json() as Promise<WebHealthResponse>,
          gatewayResponse.json() as Promise<GatewayHealthResponse>,
        ]);

        if (cancelled) {
          return;
        }

        setWebHealth(webPayload);
        setGatewayHealth(gatewayPayload);
        setLastChecked(new Date().toLocaleString());
      } catch {
        if (!cancelled) {
          setError("Unable to load live production status right now.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadStatus();

    const intervalId = window.setInterval(() => {
      void loadStatus();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const overallHealthy = webHealth?.status === "healthy" && gatewayHealth?.status === "healthy";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-3xl border border-dark-700 bg-dark-800/60 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-dark-400">Overall</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                {loading ? "Checking..." : overallHealthy ? "Operational" : "Attention needed"}
              </h2>
            </div>
            <Badge variant={loading ? "default" : overallHealthy ? "success" : "warning"}>
              {loading ? "Loading" : overallHealthy ? "healthy" : "degraded"}
            </Badge>
          </div>
          <p className="mt-4 text-sm leading-7 text-dark-300">
            {betaProtected
              ? "Karna is running as an invite-gated public beta."
              : "Karna is currently open without an invite gate."}
          </p>
        </article>

        <article className="rounded-3xl border border-dark-700 bg-dark-800/60 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-dark-400">Web app</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">{webHealth?.status ?? "..."}</h2>
            </div>
            <Badge variant={statusVariant(webHealth?.status)}>{webHealth?.status ?? "unknown"}</Badge>
          </div>
          <p className="mt-4 text-sm leading-7 text-dark-300">
            Gateway wiring:{" "}
            {webHealth?.configured
              ? "configured"
              : "not configured"}
          </p>
        </article>

        <article className="rounded-3xl border border-dark-700 bg-dark-800/60 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-dark-400">Gateway</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                {gatewayHealth?.status ?? "..."}
              </h2>
            </div>
            <Badge variant={statusVariant(gatewayHealth?.status)}>
              {gatewayHealth?.status ?? "unknown"}
            </Badge>
          </div>
          <p className="mt-4 text-sm leading-7 text-dark-300">
            Uptime: {gatewayHealth?.uptimeHuman ?? "unknown"}
          </p>
        </article>

        <article className="rounded-3xl border border-dark-700 bg-dark-800/60 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-dark-400">Last checked</p>
              <h2 className="mt-2 text-xl font-semibold text-white">
                {lastChecked ?? "Waiting for first check"}
              </h2>
            </div>
            <Badge variant="accent">30s refresh</Badge>
          </div>
          <p className="mt-4 text-sm leading-7 text-dark-300">
            {error ?? "This page polls the same production health endpoints the hosted app uses."}
          </p>
        </article>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-dark-700 bg-dark-800/60 p-6">
          <h3 className="text-lg font-semibold text-white">Live production signals</h3>
          <p className="mt-2 text-sm leading-7 text-dark-300">
            These values come from the hosted web and gateway health endpoints, not from hardcoded docs.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-dark-700 bg-dark-900/70 p-4">
              <p className="text-sm text-dark-400">Gateway URL wiring</p>
              <ul className="mt-3 space-y-2 text-sm text-dark-200">
                <li>Server proxy configured: {webHealth?.gateway?.serverUrlConfigured ? "yes" : "no"}</li>
                <li>Public URL configured: {webHealth?.gateway?.publicUrlConfigured ? "yes" : "no"}</li>
                <li>WebSocket URL configured: {webHealth?.gateway?.webSocketUrlConfigured ? "yes" : "no"}</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-dark-700 bg-dark-900/70 p-4">
              <p className="text-sm text-dark-400">Gateway activity</p>
              <ul className="mt-3 space-y-2 text-sm text-dark-200">
                <li>Active sessions: {gatewayHealth?.sessions ?? "unknown"}</li>
                <li>Live connections: {gatewayHealth?.connections ?? "unknown"}</li>
                <li>Database backend: {gatewayHealth?.database ?? "unknown"}</li>
                <li>Gateway version: {gatewayHealth?.version ?? "unknown"}</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-dark-700 bg-dark-800/60 p-6">
          <h3 className="text-lg font-semibold text-white">Need help?</h3>
          <p className="mt-2 text-sm leading-7 text-dark-300">
            If the product is up but something feels wrong, use the support page first. If this page
            is red, treat it as a platform issue.
          </p>

          <div className="mt-6 space-y-3 text-sm">
            <a
              href="/support"
              className="block rounded-2xl border border-dark-700 bg-dark-900/70 px-4 py-3 text-dark-200 transition-colors hover:border-dark-500 hover:text-white"
            >
              Open support guide
            </a>
            <a
              href="https://github.com/MukundaKatta/karna/issues"
              className="block rounded-2xl border border-dark-700 bg-dark-900/70 px-4 py-3 text-dark-200 transition-colors hover:border-dark-500 hover:text-white"
            >
              Report a GitHub issue
            </a>
            <a
              href="/terms"
              className="block rounded-2xl border border-dark-700 bg-dark-900/70 px-4 py-3 text-dark-200 transition-colors hover:border-dark-500 hover:text-white"
            >
              Review beta terms
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

