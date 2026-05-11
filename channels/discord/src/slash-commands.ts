import {
  ActionRowBuilder,
  REST,
  Routes,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type StringSelectMenuInteraction,
} from "discord.js";
import type pino from "pino";
import type { DiscordAdapter } from "./adapter.js";

// ─── Command Definitions ────────────────────────────────────────────────────

const SKILL_SELECT_CUSTOM_ID = "karna:skill-select";

const commands = [
  new SlashCommandBuilder()
    .setName("chat")
    .setDescription("Send a message to the Karna AI agent")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("Your message to the agent")
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask Karna a question")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("Your question for Karna")
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("remember")
    .setDescription("Ask Karna to remember something")
    .addStringOption((option) =>
      option
        .setName("text")
        .setDescription("The note, fact, or context Karna should remember")
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check the current agent status"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show available commands and usage"),

  new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Reset your conversation session"),

  new SlashCommandBuilder()
    .setName("skills")
    .setDescription("List available agent skills"),
];

// ─── Register Commands ──────────────────────────────────────────────────────

export async function registerSlashCommands(
  botToken: string,
  clientId: string,
  logger: pino.Logger,
): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(botToken);

  try {
    logger.info("Registering Discord slash commands");

    await rest.put(Routes.applicationCommands(clientId), {
      body: commands.map((cmd) => cmd.toJSON()),
    });

    logger.info("Slash commands registered successfully");
  } catch (error) {
    logger.error({ error }, "Failed to register slash commands");
  }
}

// ─── Handle Commands ────────────────────────────────────────────────────────

export async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
  logger: pino.Logger,
): Promise<void> {
  const { commandName } = interaction;

  switch (commandName) {
    case "ask":
    case "chat":
      await handleChat(interaction, adapter, logger);
      break;
    case "remember":
      await handleRemember(interaction, adapter, logger);
      break;
    case "status":
      await handleStatus(interaction);
      break;
    case "help":
      await handleHelp(interaction);
      break;
    case "reset":
      await handleReset(interaction, adapter, logger);
      break;
    case "skills":
      await handleSkills(interaction);
      break;
    default:
      await interaction.reply({
        content: "Unknown command.",
        ephemeral: true,
      });
  }
}

// ─── Command Handlers ───────────────────────────────────────────────────────

async function handleChat(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
  logger: pino.Logger,
): Promise<void> {
  const message = interaction.options.getString("message", true);
  const channelId = interaction.channelId;

  logger.debug(
    { channelId, userId: interaction.user.id },
    "Chat command received",
  );

  await interaction.deferReply();

  // Forward to gateway
  await adapter.forwardToGateway(channelId, message, {
    userId: interaction.user.id,
    isDirectMessage: !interaction.guildId,
    agentMentioned: Boolean(interaction.guildId),
  });

  // The actual response will come via the gateway callback
  // For now, acknowledge that the message was sent
  await interaction.editReply(`Processing: "${message}"`);
}

async function handleStatus(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("Agent Status")
    .addFields(
      { name: "Status", value: "Online", inline: true },
      { name: "Channel", value: "Discord", inline: true },
      {
        name: "Server",
        value: interaction.guild?.name ?? "DM",
        inline: true,
      },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleRemember(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
  logger: pino.Logger,
): Promise<void> {
  const text = interaction.options.getString("text", true);
  const channelId = interaction.channelId;

  logger.debug(
    { channelId, userId: interaction.user.id },
    "Remember command received",
  );

  await interaction.deferReply();

  await adapter.forwardToGateway(channelId, `Remember this: ${text}`, {
    userId: interaction.user.id,
    isDirectMessage: !interaction.guildId,
    agentMentioned: Boolean(interaction.guildId),
  });

  await interaction.editReply("Saving that with Karna.");
}

export function getDiscordSlashCommandNames(): string[] {
  return commands.map((command) => String(command.toJSON().name));
}

async function handleHelp(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Karna AI Agent - Help")
    .setDescription("I'm Karna, your AI agent. Here's how to interact with me:")
    .addFields(
      {
        name: "/ask or /chat",
        value: "Send a message to the AI agent",
      },
      {
        name: "/remember",
        value: "Save a note, fact, or context with Karna",
      },
      {
        name: "/status",
        value: "Check if the agent is online and connected",
      },
      {
        name: "/reset",
        value: "Start a fresh conversation session",
      },
      {
        name: "/skills",
        value: "List available agent capabilities",
      },
      {
        name: "Direct Messages",
        value: "You can also DM me directly without using slash commands",
      },
      {
        name: "Mentions",
        value: "In channels, mention me to start a conversation",
      },
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleReset(
  interaction: ChatInputCommandInteraction,
  adapter: DiscordAdapter,
  logger: pino.Logger,
): Promise<void> {
  const channelId = interaction.channelId;

  logger.info(
    { channelId, userId: interaction.user.id },
    "User requested session reset",
  );

  adapter.resetSession(channelId);

  await interaction.reply({
    content: "Session has been reset. You can start a fresh conversation now.",
    ephemeral: true,
  });
}

async function handleSkills(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Available Skills")
    .setDescription(
      "Skills are loaded from your Karna configuration. Use the CLI (`karna skills list`) to manage skills.",
    )
    .setFooter({
      text: "Contact your administrator if you need specific skills enabled.",
    });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(SKILL_SELECT_CUSTOM_ID)
    .setPlaceholder("Choose a skill area")
    .addOptions(
      {
        label: "Chat",
        value: "chat",
        description: "Ask questions and continue the current conversation",
      },
      {
        label: "Memory",
        value: "memory",
        description: "Save or recall notes, facts, and context",
      },
      {
        label: "Tools",
        value: "tools",
        description: "Run configured agent tools with approval when needed",
      },
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    selectMenu,
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true,
  });
}

export async function handleSkillSelectInteraction(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (interaction.customId !== SKILL_SELECT_CUSTOM_ID) return;

  const selected = interaction.values[0] ?? "chat";
  const label =
    selected === "memory"
      ? "Use /remember to save context, or ask Karna to recall what it knows."
      : selected === "tools"
        ? "Ask Karna to perform a task; approval buttons appear for gated tools."
        : "Use /ask or /chat to continue the conversation.";

  await interaction.reply({
    content: label,
    ephemeral: true,
  });
}
