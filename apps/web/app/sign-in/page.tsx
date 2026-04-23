import Link from "next/link";
import { BetaAccessForm } from "@/components/BetaAccessForm";
import { PublicShell } from "@/components/PublicShell";
import { isBetaAuthEnabled } from "@/lib/beta-auth";

interface SignInPageProps {
  searchParams?: Promise<{
    next?: string;
  }>;
}

function normalizeNextPath(nextPath: string | undefined): string {
  if (!nextPath || !nextPath.startsWith("/")) {
    return "/chat";
  }

  return nextPath;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const nextPath = normalizeNextPath(params?.next);
  const betaProtected = isBetaAuthEnabled();

  return (
    <PublicShell
      eyebrow="Public beta"
      title={betaProtected ? "Access the live Karna beta" : "Karna is currently open"}
      description={
        betaProtected
          ? "The live dashboard, chat surface, and write APIs are invite-gated while Karna is still in public beta."
          : "Invite gating is not enabled right now, so you can go straight into the live product."
      }
    >
      {betaProtected ? (
        <BetaAccessForm nextPath={nextPath} />
      ) : (
        <div className="max-w-xl rounded-3xl border border-dark-700 bg-dark-800/70 p-8 shadow-2xl shadow-black/20">
          <h2 className="text-2xl font-semibold text-white">No access code needed</h2>
          <p className="mt-4 text-sm leading-7 text-dark-300">
            The beta gate is currently off for this deployment. You can head straight into Karna or
            check production status first.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={nextPath}
              className="rounded-full bg-accent-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-500"
            >
              Open Karna
            </Link>
            <Link
              href="/status"
              className="rounded-full border border-dark-600 px-5 py-3 text-sm font-semibold text-dark-200 transition-colors hover:border-dark-500 hover:text-white"
            >
              Check live status
            </Link>
          </div>
        </div>
      )}
    </PublicShell>
  );
}

