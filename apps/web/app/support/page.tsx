import Link from "next/link";
import { PublicShell } from "@/components/PublicShell";

const supportCards = [
  {
    title: "Product issues",
    copy:
      "If chat, sessions, workflows, memory, or dashboard behavior feels wrong, open an issue with screenshots, the route you were on, and what you expected to happen.",
    href: "https://github.com/MukundaKatta/karna/issues",
    label: "Open GitHub issues",
  },
  {
    title: "Deployment help",
    copy:
      "If you are running your own Karna deploy, start with the deployment guide for Render, Vercel, gateway wiring, and hosted environment variables.",
    href: "https://github.com/MukundaKatta/karna/blob/main/docs/DEPLOYMENT.md",
    label: "Read deployment guide",
  },
  {
    title: "Live incidents",
    copy:
      "Check the public status page before reporting outages. It shows whether the hosted web and gateway are currently healthy.",
    href: "/status",
    label: "Open status page",
  },
];

const issueChecklist = [
  "Route or feature you were using",
  "What you expected to happen",
  "What actually happened instead",
  "Whether it reproduced more than once",
  "Screenshots or logs if you have them",
];

export default function SupportPage() {
  return (
    <PublicShell
      eyebrow="Support"
      title="How to get help with Karna"
      description="Start here if something is broken, unclear, or risky. This page is meant to reduce guesswork for both operators and invited beta users."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        {supportCards.map((card) => (
          <article key={card.title} className="rounded-3xl border border-dark-700 bg-dark-800/60 p-6">
            <h2 className="text-lg font-semibold text-white">{card.title}</h2>
            <p className="mt-3 text-sm leading-7 text-dark-300">{card.copy}</p>
            <Link
              href={card.href}
              className="mt-6 inline-flex rounded-full border border-dark-600 px-4 py-2 text-sm font-medium text-dark-200 transition-colors hover:border-dark-500 hover:text-white"
            >
              {card.label}
            </Link>
          </article>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-dark-700 bg-dark-800/60 p-6">
          <h2 className="text-lg font-semibold text-white">What to include in a bug report</h2>
          <p className="mt-3 text-sm leading-7 text-dark-300">
            Good reports speed up fixes dramatically. If you open an issue, include as many of these
            as you can so the failure is reproducible.
          </p>
          <ul className="mt-5 space-y-3 text-sm text-dark-200">
            {issueChecklist.map((item) => (
              <li key={item} className="rounded-2xl border border-dark-700 bg-dark-900/70 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl border border-dark-700 bg-dark-800/60 p-6">
          <h2 className="text-lg font-semibold text-white">Fast triage order</h2>
          <ol className="mt-4 space-y-3 text-sm leading-7 text-dark-300">
            <li>1. Check the public status page.</li>
            <li>2. Refresh the route and retry once.</li>
            <li>3. If it still fails, open a GitHub issue.</li>
            <li>4. For self-hosted installs, include your deploy setup and env details.</li>
          </ol>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/status"
              className="rounded-full bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-500"
            >
              View status
            </Link>
            <Link
              href="/terms"
              className="rounded-full border border-dark-600 px-4 py-2 text-sm font-medium text-dark-200 transition-colors hover:border-dark-500 hover:text-white"
            >
              Beta terms
            </Link>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}

