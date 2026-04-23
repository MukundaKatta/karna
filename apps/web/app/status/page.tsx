import { PublicShell } from "@/components/PublicShell";
import { StatusPageClient } from "@/components/StatusPageClient";
import { isBetaAuthEnabled } from "@/lib/beta-auth";

export const dynamic = "force-dynamic";

export default function StatusPage() {
  return (
    <PublicShell
      eyebrow="Status"
      title="Live production status"
      description="Real-time health for the hosted Karna web app and gateway. Use this page to tell the difference between a platform issue and a product issue."
    >
      <StatusPageClient betaProtected={isBetaAuthEnabled()} />
    </PublicShell>
  );
}

