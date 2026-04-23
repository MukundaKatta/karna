"use client";

import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl rounded-3xl border border-dark-700 bg-dark-800/70 p-8 text-center shadow-2xl shadow-black/20">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-danger-400">Runtime error</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
          Karna hit an unexpected failure
        </h1>
        <p className="mt-4 text-sm leading-7 text-dark-300">
          Refresh or retry if this looked transient. If it keeps happening, use the support page and
          include the route you were on plus any screenshots.
        </p>
        {error.digest ? (
          <p className="mt-4 text-xs uppercase tracking-[0.16em] text-dark-500">
            Error digest: {error.digest}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-full bg-accent-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-500"
          >
            Try again
          </button>
          <Link
            href="/support"
            className="rounded-full border border-dark-600 px-5 py-3 text-sm font-semibold text-dark-200 transition-colors hover:border-dark-500 hover:text-white"
          >
            Open support
          </Link>
        </div>
      </div>
    </div>
  );
}

