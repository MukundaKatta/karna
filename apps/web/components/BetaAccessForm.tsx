"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function BetaAccessForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/beta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessCode }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Unable to verify the beta access code.");
        return;
      }

      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("Unable to reach Karna right now. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-xl rounded-3xl border border-dark-700 bg-dark-800/70 p-8 shadow-2xl shadow-black/20"
    >
      <div className="mb-6">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-accent-400">
          Invite-only access
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-white">Enter your beta access code</h2>
        <p className="mt-3 text-sm leading-7 text-dark-300">
          This keeps the live operator surface, chat workspace, and write APIs limited to invited
          users while Karna is still in public beta.
        </p>
      </div>

      <label className="block">
        <span className="mb-2 block text-sm font-medium text-dark-200">Beta access code</span>
        <input
          type="password"
          autoComplete="one-time-code"
          value={accessCode}
          onChange={(event) => setAccessCode(event.target.value)}
          className="w-full rounded-2xl border border-dark-600 bg-dark-900 px-4 py-3 text-base text-white outline-none transition-colors placeholder:text-dark-500 focus:border-accent-500"
          placeholder="Enter the invite code"
          required
        />
      </label>

      {error ? (
        <div className="mt-4 rounded-2xl border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-400">
          {error}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-accent-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? "Checking access..." : "Open Karna"}
        </button>
        <p className="text-sm text-dark-400">
          Need access? Start with the{" "}
          <a href="/support" className="text-accent-400 hover:text-accent-300">
            support page
          </a>
          .
        </p>
      </div>
    </form>
  );
}

