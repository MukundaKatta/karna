import { PublicShell } from "@/components/PublicShell";

const sections = [
  {
    title: "Beta product",
    body:
      "Karna is still evolving. Features, models, integrations, uptime characteristics, and access controls may change while the product is in beta.",
  },
  {
    title: "Acceptable use",
    body:
      "Do not use Karna to break the law, abuse other people, violate third-party rights, or intentionally probe the hosted service for weaknesses. If access is invite-gated, do not share access codes broadly without permission.",
  },
  {
    title: "No guaranteed availability",
    body:
      "The hosted app is offered on a best-effort basis during beta. There is no guarantee of uninterrupted uptime, permanent storage, or backwards compatibility across every deploy.",
  },
  {
    title: "User responsibility",
    body:
      "You are responsible for what you send through Karna, what tools or channels you connect, and whether the output is appropriate for your own use case. Always review important actions before relying on them.",
  },
  {
    title: "Feedback",
    body:
      "If you share feedback, issues, or suggestions, Karna may use that input to improve the product unless you explicitly flag something as confidential and the project agrees to treat it that way.",
  },
  {
    title: "Suspension or changes",
    body:
      "Access may be limited, suspended, or changed if the service is being abused, if safety or infrastructure risks appear, or if the beta needs to be tightened before a wider rollout.",
  },
];

export default function TermsPage() {
  return (
    <PublicShell
      eyebrow="Terms"
      title="Karna beta terms of use"
      description="These terms set expectations for the hosted Karna beta in a straightforward way. They are focused on product reality, not marketing gloss."
    >
      <div className="grid gap-4">
        {sections.map((section) => (
          <section key={section.title} className="rounded-3xl border border-dark-700 bg-dark-800/60 p-6">
            <h2 className="text-lg font-semibold text-white">{section.title}</h2>
            <p className="mt-3 text-sm leading-8 text-dark-300">{section.body}</p>
          </section>
        ))}
      </div>
    </PublicShell>
  );
}

