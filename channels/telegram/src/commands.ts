import type { Bot, Context } from "grammy";
import type pino from "pino";

// ─── Command Definitions ────────────────────────────────────────────────────

interface BotCommand {
  command: string;
  description: string;
}

const COMMANDS: BotCommand[] = [
  { command: "start", description: "Start the bot and get a welcome message" },
  { command: "status", description: "Check the current agent status" },
  { command: "help", description: "Show available commands and usage" },
  { command: "reset", description: "Reset your conversation session" },
  { command: "skills", description: "List available agent skills" },
];

// ─── Register Commands ──────────────────────────────────────────────────────

export function registerCommands(bot: Bot, logger: pino.Logger): void {
  // Set the command menu in Telegram
  void bot.api.setMyCommands(COMMANDS).catch((error) => {
    logger.warn({ error }, "Failed to set bot commands menu");
  });

  bot.command("start", async (ctx: Context) => {
    await handleStart(ctx, logger);
  });

  bot.command("status", async (ctx: Context) => {
    await handleStatus(ctx, logger);
  });

  bot.command("help", async (ctx: Context) => {
    await handleHelp(ctx);
  });

  bot.command("reset", async (ctx: Context) => {
    await handleReset(ctx, logger);
  });

  bot.command("skills", async (ctx: Context) => {
    await handleSkills(ctx, logger);
  });

  bot.command("approve", async (ctx: Context) => {
    await handleApprove(ctx, logger);
  });

  bot.command("deny", async (ctx: Context) => {
    await handleDeny(ctx, logger);
  });

  logger.info("Bot commands registered");
}

// ─── Command Handlers ───────────────────────────────────────────────────────

async function handleStart(ctx: Context, logger: pino.Logger): Promise<void> {
  const chatId = ctx.chat?.id;
  const firstName = ctx.from?.first_name ?? "there";

  logger.info({ chatId, userId: ctx.from?.id }, "User started bot");

  const welcomeMessage = [
    `Hello, ${firstName}! I'm *Karna*, your loyal AI agent.`,
    ``,
    `I can help you with a wide range of tasks. Just send me a message and I'll do my best to assist you.`,
    ``,
    `Here are some things you can do:`,
    `  /help — See all available commands`,
    `  /status — Check if I'm connected and ready`,
    `  /skills — See what skills I have`,
    `  /reset — Start a fresh conversation`,
    ``,
    `Go ahead, ask me anything!`,
  ].join("\n");

  try {
    await ctx.reply(welcomeMessage, { parse_mode: "Markdown" });
  } catch {
    await ctx.reply(welcomeMessage.replace(/\*/g, ""));
  }
}

async function handleStatus(ctx: Context, logger: pino.Logger): Promise<void> {
  const chatId = ctx.chat?.id;
  logger.debug({ chatId }, "Status command received");

  // In a full implementation, this would query the gateway for real status
  const statusMessage = [
    `*Agent Status*`,
    ``,
    `Status: Online`,
    `Channel: Telegram`,
    `Chat ID: \`${chatId}\``,
    ``,
    `_Use /help for available commands._`,
  ].join("\n");

  try {
    await ctx.reply(statusMessage, { parse_mode: "Markdown" });
  } catch {
    await ctx.reply(`Agent Status\n\nStatus: Online\nChannel: Telegram\nChat ID: ${chatId}`);
  }
}

async function handleHelp(ctx: Context): Promise<void> {
  const helpMessage = [
    `*Available Commands*`,
    ``,
    ...COMMANDS.map((cmd) => `/${cmd.command} — ${cmd.description}`),
    ``,
    `*Chat Commands*`,
    `/approve — Approve a pending tool execution`,
    `/deny — Deny a pending tool execution`,
    ``,
    `*Tips*`,
    `- Send any text message to chat with the AI agent`,
    `- Send photos, documents, or voice messages for multimodal interaction`,
    `- The agent can use tools to help with complex tasks`,
    `- High-risk tool usage requires your approval`,
  ].join("\n");

  try {
    await ctx.reply(helpMessage, { parse_mode: "Markdown" });
  } catch {
    await ctx.reply(helpMessage.replace(/\*/g, ""));
  }
}

async function handleReset(ctx: Context, logger: pino.Logger): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  logger.info({ chatId }, "User requested session reset");

  // Note: The actual session reset is handled by the adapter via the resetSession method.
  // This command simply notifies the user.
  await ctx.reply(
    "Session has been reset. You can start a fresh conversation now.",
  );
}

async function handleSkills(ctx: Context, logger: pino.Logger): Promise<void> {
  const chatId = ctx.chat?.id;
  logger.debug({ chatId }, "Skills command received");

  // In a full implementation, this would query the gateway for real skill data
  const skillsMessage = [
    `*Available Skills*`,
    ``,
    `Skills are loaded from your Karna configuration. Use the CLI (\`karna skills list\`) to manage skills.`,
    ``,
    `_Contact your administrator if you need specific skills enabled._`,
  ].join("\n");

  try {
    await ctx.reply(skillsMessage, { parse_mode: "Markdown" });
  } catch {
    await ctx.reply("Available Skills\n\nUse the CLI (karna skills list) to manage skills.");
  }
}

async function handleApprove(ctx: Context, logger: pino.Logger): Promise<void> {
  const chatId = ctx.chat?.id;
  logger.info({ chatId }, "User approved tool execution");

  await ctx.reply("Tool execution approved. Processing...");
}

async function handleDeny(ctx: Context, logger: pino.Logger): Promise<void> {
  const chatId = ctx.chat?.id;
  logger.info({ chatId }, "User denied tool execution");

  await ctx.reply("Tool execution denied.");
}
