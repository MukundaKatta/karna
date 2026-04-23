import Link from "next/link";
import { isBetaAuthEnabled } from "@/lib/beta-auth";

interface PublicShellProps {
  eyebrow?: string;
  title: string;
  description: string;
  children: React.ReactNode;
}

const footerLinks = [
  { href: "/status", label: "Status" },
  { href: "/support", label: "Support" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "https://github.com/MukundaKatta/karna", label: "GitHub" },
];

export function PublicShell({
  eyebrow,
  title,
  description,
  children,
}: PublicShellProps) {
  const betaProtected = isBetaAuthEnabled();

  return (
    <div className="min-h-dvh bg-dark-900 text-dark-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-6 py-6 md:px-10">
        <header className="mb-12 flex flex-wrap items-center justify-between gap-4 border-b border-dark-700/80 pb-5">
          <div>
            <Link href="/landing.html" className="text-xl font-semibold tracking-tight text-white">
              Karna
            </Link>
            <p className="mt-1 text-sm text-dark-400">
              AI chief of staff for chats, voice notes, and follow-through
            </p>
          </div>

          <nav className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href="/status"
              className="rounded-full border border-dark-700 px-4 py-2 text-dark-300 transition-colors hover:border-dark-500 hover:text-white"
            >
              Status
            </Link>
            <Link
              href="/support"
              className="rounded-full border border-dark-700 px-4 py-2 text-dark-300 transition-colors hover:border-dark-500 hover:text-white"
            >
              Support
            </Link>
            <Link
              href={betaProtected ? "/sign-in" : "/chat"}
              className="rounded-full bg-accent-600 px-4 py-2 font-medium text-white transition-colors hover:bg-accent-500"
            >
              {betaProtected ? "Join the beta" : "Open Karna"}
            </Link>
          </nav>
        </header>

        <main className="flex-1">
          <section className="max-w-3xl">
            {eyebrow ? (
              <span className="inline-flex rounded-full border border-accent-500/30 bg-accent-600/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-accent-400">
                {eyebrow}
              </span>
            ) : null}
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white md:text-5xl">
              {title}
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-dark-300">{description}</p>
          </section>

          <div className="mt-10">{children}</div>
        </main>

        <footer className="mt-16 border-t border-dark-700/80 pt-6 text-sm text-dark-400">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p>
              Karna is in active public beta. Status, support, and legal pages stay public even when
              the product surface is invite-gated.
            </p>
            <div className="flex flex-wrap gap-4">
              {footerLinks.map((link) => (
                <Link key={link.href} href={link.href} className="transition-colors hover:text-white">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
