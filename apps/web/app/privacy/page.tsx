import { PublicShell } from "@/components/PublicShell";

const sections = [
  {
    title: "What Karna processes",
    body:
      "Karna may process prompts, replies, transcript history, memory entries, workflow state, and diagnostic signals needed to run the product. If you connect external channels or tools, Karna may also process the content you send through those integrations.",
  },
  {
    title: "How the data is used",
    body:
      "The hosted app uses this data to deliver chat responses, keep sessions coherent, run workflows, store memory, debug incidents, and improve the reliability of the service. The goal is product operation, not hidden resale.",
  },
  {
    title: "Providers and subprocessors",
    body:
      "Karna can call third-party model providers and infrastructure services to fulfill requests. In the current hosted deployment, model traffic is routed through the configured LLM provider and the app is hosted on Render-backed infrastructure.",
  },
  {
    title: "Retention and operator access",
    body:
      "Conversation and memory data can persist so Karna remains useful across sessions. Operators may access logs, traces, or stored records when diagnosing failures, abuse, or data integrity issues.",
  },
  {
    title: "Security posture",
    body:
      "Karna uses production transport security, gateway authentication, invite gating for protected beta deployments, and service-side controls intended to reduce accidental exposure. No internet service can promise perfect security, so avoid using Karna for secrets you are not willing to entrust to the current beta.",
  },
  {
    title: "Your choices",
    body:
      "You can stop using the hosted app at any time. For support or data-related questions, use the support page or the project issue tracker so the request is visible and actionable.",
  },
];

export default function PrivacyPage() {
  return (
    <PublicShell
      eyebrow="Privacy"
      title="Karna beta privacy notice"
      description="This page explains the practical data behavior of the hosted Karna beta in plain language. It is meant to help users understand the product as it exists today."
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

