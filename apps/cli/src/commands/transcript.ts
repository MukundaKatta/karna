import type { Command } from "commander";
import chalk from "chalk";
import { resolveGatewayHttpUrl } from "../lib/config.js";
import { fetchSessionHistory } from "../lib/sessions.js";

interface TranscriptFlags {
  gateway?: string;
  limit?: string;
  format?: "json" | "md";
  batchSize?: string;
}

export function registerTranscriptCommand(program: Command): void {
  const transcript = program
    .command("transcript")
    .description("View or export persisted JSONL session transcripts")
    .option("-g, --gateway <url>", "Gateway URL");

  transcript
    .command("view <sessionId>")
    .description("View a session transcript")
    .option("-l, --limit <count>", "Limit transcript messages", "50")
    .option("--format <format>", "Output format: json or md", "md")
    .action(async (sessionId: string, options: TranscriptFlags) => {
      const gatewayUrl = await resolveGatewayHttpUrl(transcript.opts().gateway as string | undefined);
      const history = await fetchSessionHistory(
        gatewayUrl,
        sessionId,
        options.limit ? Number(options.limit) : undefined,
      );

      if (options.format === "json") {
        console.log(JSON.stringify(history, null, 2));
        return;
      }

      console.log(renderMarkdownTranscript(history));
    });

  transcript
    .command("export <sessionId>")
    .description("Export a session transcript")
    .option("--format <format>", "Output format: json or md", "md")
    .action(async (sessionId: string, options: TranscriptFlags) => {
      const gatewayUrl = await resolveGatewayHttpUrl(transcript.opts().gateway as string | undefined);
      const history = await fetchSessionHistory(gatewayUrl, sessionId);
      console.log(options.format === "json" ? JSON.stringify(history, null, 2) : renderMarkdownTranscript(history));
    });

  transcript
    .command("import <sessionId>")
    .description("Import a session transcript into Supabase search storage")
    .option("--batch-size <count>", "Messages per Supabase request", "100")
    .action(async (sessionId: string, options: TranscriptFlags) => {
      const gatewayUrl = await resolveGatewayHttpUrl(transcript.opts().gateway as string | undefined);
      const history = await fetchSessionHistory(gatewayUrl, sessionId);
      const imported = await importTranscriptToSupabase(history, Number(options.batchSize ?? 100));
      console.log(chalk.green(`Imported ${imported} transcript messages for ${sessionId}.`));
    });
}

function renderMarkdownTranscript(history: Awaited<ReturnType<typeof fetchSessionHistory>>): string {
  const lines: string[] = [
    `# Transcript ${history.sessionId}`,
    "",
    `Messages: ${history.messages.length}/${history.totalMessages}`,
    "",
  ];

  if (!history.messages.length) {
    lines.push(chalk.yellow("No transcript messages found."));
    return lines.join("\n");
  }

  for (const message of history.messages) {
    lines.push(`## ${message.role} - ${new Date(message.timestamp).toISOString()}`);
    lines.push("");
    lines.push(message.content);
    lines.push("");
  }

  return lines.join("\n");
}

async function importTranscriptToSupabase(
  history: Awaited<ReturnType<typeof fetchSessionHistory>>,
  batchSize: number,
): Promise<number> {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  const normalizedBatchSize = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 100;
  let imported = 0;

  for (let index = 0; index < history.messages.length; index += normalizedBatchSize) {
    const chunk = history.messages.slice(index, index + normalizedBatchSize);
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/transcript_messages`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(
        chunk.map((message) => ({
          id: message.id,
          session_id: message.sessionId,
          role: message.role,
          content: message.content,
          metadata: message.metadata ?? {},
          message_timestamp: new Date(message.timestamp).toISOString(),
        })),
      ),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase transcript import failed: HTTP ${response.status} ${body}`);
    }

    imported += chunk.length;
  }

  return imported;
}
