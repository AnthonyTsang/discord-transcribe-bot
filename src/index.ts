// CRITICAL: Patch setTimeout BEFORE any @discordjs/voice import.
// Bun can pass negative delay values which crash the internal audio scheduler.
const _origSetTimeout = globalThis.setTimeout.bind(globalThis);
(globalThis as unknown as Record<string, unknown>).setTimeout = (
  fn: (...args: unknown[]) => void,
  ms = 0,
  ...args: unknown[]
) => _origSetTimeout(fn, Math.max(0, ms), ...args);

import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  type TextChannel,
  type VoiceChannel,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  joinVoiceChannel,
  getVoiceConnection,
  type DiscordGatewayAdapterCreator,
} from "@discordjs/voice";
import { config } from "./config.js";
import { setupVoiceHandler } from "./voiceHandler.js";
import * as chunkManager from "./chunkManager.js";
import { init as initChunkManager } from "./chunkManager.js";
import { transcribe } from "./transcriber.js";
import * as sessionManager from "./sessionManager.js";
import * as transcriptLogger from "./transcriptLogger.js";
import * as userBuffers from "./userBuffers.js";
import { addWord, removeWord, getWords } from "./wordBoostDb.js";
import {
  getVoiceChannelId,
  getTextChannelId,
  setVoiceChannelId,
  setTextChannelId,
} from "./channelDb.js";
import {
  canUseBot,
  addAllowedRole,
  removeAllowedRole,
  getAllowedRoles,
  addAllowedUser,
  removeAllowedUser,
  getAllowedUsers,
} from "./accessControl.js";
import { muteUser, unmuteUser, getMutedUsers } from "./muteDb.js";
import { startHealthServer } from "./healthServer.js";

// ── Discord client ────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// ── Slash command definitions ─────────────────────────────────────────────────

const slashCommands = [
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join the configured voice channel (use /startsession to begin recording)"),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Leave the voice channel (ends any active session first)"),
  new SlashCommandBuilder()
    .setName("startsession")
    .setDescription("Start a transcription session — audio is only recorded while a session is active"),
  new SlashCommandBuilder()
    .setName("endsession")
    .setDescription("End the current transcription session, generate a summary, and archive the thread"),
  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause transcription (bot stays in the channel)"),
  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume transcription after a pause"),
  new SlashCommandBuilder()
    .setName("wordboost")
    .setDescription("Manage the word-boost list for improved transcription accuracy")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a word or phrase to the boost list")
        .addStringOption((opt) =>
          opt.setName("word").setDescription("Word or phrase to add").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a word or phrase from the boost list")
        .addStringOption((opt) =>
          opt.setName("word").setDescription("Word or phrase to remove").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Show all boosted words")
    ),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show the current bot status"),
  new SlashCommandBuilder()
    .setName("allowrole")
    .setDescription("Manage roles permitted to control the bot")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Grant a role access to all bot commands")
        .addRoleOption((opt) =>
          opt.setName("role").setDescription("Role to allow").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Revoke a role's access")
        .addRoleOption((opt) =>
          opt.setName("role").setDescription("Role to remove").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Show all allowed roles")
    ),
  new SlashCommandBuilder()
    .setName("allowuser")
    .setDescription("Manage individual users permitted to control the bot")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Grant a user access to all bot commands")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User to allow").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Revoke a user's access")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User to remove").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Show all allowed users")
    ),
  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Prevent a user's audio from being recorded or transcribed")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("User to mute").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Allow a previously muted user's audio to be recorded again")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("User to unmute").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Configure which channels the bot uses")
    .addSubcommand((sub) =>
      sub
        .setName("voice")
        .setDescription("Set the voice channel to record (defaults to your current voice channel)")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Voice channel to record")
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("text")
        .setDescription("Set the text channel for transcript output (defaults to this channel)")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Text channel for transcripts")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    ),
].map((cmd) => cmd.toJSON());

// ── Runtime channel references (resolved at startup and via /setchannel) ─────

let voiceChannel: VoiceChannel | null = null;
let textChannel: TextChannel | null = null;

// ── Voice connection management ───────────────────────────────────────────────

function doJoin(): void {
  if (!voiceChannel) {
    console.error("[bot] doJoin called but voiceChannel is not set.");
    return;
  }
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator:
      voiceChannel.guild.voiceAdapterCreator as unknown as DiscordGatewayAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });

  setupVoiceHandler(connection, client, voiceChannel.guild, voiceChannel.id, () => {
    if (sessionManager.getSession()) {
      console.log("[bot] Scheduling reconnect in 5 s...");
      setTimeout(() => doJoin(), 5_000);
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Tries to fetch and cache a voice channel by ID.
 * Returns null if the ID is missing or the channel isn't a guild voice channel.
 */
async function resolveVoiceChannel(id: string): Promise<VoiceChannel | null> {
  try {
    const ch = await client.channels.fetch(id);
    return ch?.type === ChannelType.GuildVoice ? (ch as VoiceChannel) : null;
  } catch {
    return null;
  }
}

/**
 * Tries to fetch and cache a text channel by ID.
 * Returns null if the ID is missing or the channel isn't a guild text channel.
 */
async function resolveTextChannel(id: string): Promise<TextChannel | null> {
  try {
    const ch = await client.channels.fetch(id);
    return ch?.type === ChannelType.GuildText ? (ch as TextChannel) : null;
  } catch {
    return null;
  }
}

// ── Slash command handlers ────────────────────────────────────────────────────

async function handleJoin(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!voiceChannel) {
    await interaction.reply({
      content: "Voice channel is not configured yet. Use `/setchannel voice` first.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (getVoiceConnection(voiceChannel.guild.id)) {
    await interaction.reply({
      content: "Already in the voice channel. Use `/startsession` to begin recording.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  doJoin();

  await interaction.reply({
    content: `Joined **${voiceChannel.name}**. Use \`/startsession\` to begin recording.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStartSession(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!textChannel) {
    await interaction.reply({
      content: "Text channel is not configured yet. Use `/setchannel text` first.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!voiceChannel || !getVoiceConnection(voiceChannel.guild.id)) {
    await interaction.reply({
      content: "The bot is not in a voice channel. Use `/join` first.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (sessionManager.getSession()) {
    await interaction.reply({
      content: "A session is already active. Use `/endsession` to end it first.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const session = await sessionManager.startSession(textChannel);
  chunkManager.resetForNewSession();

  await interaction.reply({
    content: `Session started — recording to ${session.thread.toString()}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleEndSession(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!sessionManager.getSession()) {
    await interaction.reply({ content: "No active session.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ content: "⏹️ Ending session and generating summary…", flags: MessageFlags.Ephemeral });

  await chunkManager.forceFlushAll();
  await sessionManager.endSession();
}

async function handleLeave(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!voiceChannel || !getVoiceConnection(voiceChannel.guild.id)) {
    await interaction.reply({ content: "Not currently in a voice channel.", flags: MessageFlags.Ephemeral });
    return;
  }

  const hasSession = !!sessionManager.getSession();
  await interaction.reply({
    content: hasSession ? "⏹️ Leaving and generating summary…" : "👋 Leaving voice channel.",
    flags: MessageFlags.Ephemeral,
  });

  await chunkManager.forceFlushAll();
  getVoiceConnection(voiceChannel.guild.id)?.destroy();
  await sessionManager.endSession();
}

async function handlePause(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!sessionManager.getSession()) {
    await interaction.reply({ content: "Not in a session.", flags: MessageFlags.Ephemeral });
    return;
  }
  sessionManager.pause();
  await interaction.reply({ content: "⏸️ Transcription paused.", flags: MessageFlags.Ephemeral });
}

async function handleResume(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!sessionManager.getSession()) {
    await interaction.reply({ content: "Not in a session.", flags: MessageFlags.Ephemeral });
    return;
  }
  sessionManager.resume();
  await interaction.reply({ content: "▶️ Transcription resumed.", flags: MessageFlags.Ephemeral });
}

async function handleWordBoost(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === "add") {
    const word = interaction.options.getString("word", true).trim();
    const inserted = addWord(word);
    await interaction.reply({
      content: inserted
        ? `Added **${word}** to the word-boost list.`
        : `**${word}** is already in the word-boost list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "remove") {
    const word = interaction.options.getString("word", true).trim();
    const deleted = removeWord(word);
    await interaction.reply({
      content: deleted
        ? `Removed **${word}** from the word-boost list.`
        : `**${word}** was not in the word-boost list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "list") {
    const dbWords = getWords();
    const lines: string[] = [];
    if (dbWords.length > 0) {
      lines.push(`**Word-boost list (${dbWords.length}):**\n${dbWords.map((w) => `• ${w}`).join("\n")}`);
    }
    if (lines.length === 0) lines.push("The word-boost list is empty.");
    await interaction.reply({ content: lines.join("\n\n"), flags: MessageFlags.Ephemeral });
  }
}

async function handleSetChannel(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const inSession = !!sessionManager.getSession();

  if (sub === "voice") {
    // Prefer the explicit option; fall back to the member's current voice channel
    const picked = interaction.options.getChannel("channel") as VoiceChannel | null;
    let target: VoiceChannel | null = picked;

    if (!target) {
      const voiceState = interaction.guild?.voiceStates.cache.get(interaction.user.id);
      const memberVC = voiceState?.channel;
      if (!memberVC || memberVC.type !== ChannelType.GuildVoice) {
        await interaction.reply({
          content:
            "You are not in a voice channel. Either join one first or pass a `channel` option.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      target = memberVC as VoiceChannel;
    }

    setVoiceChannelId(target.id);
    voiceChannel = target;

    const note = inSession
      ? " Use `/leave` then `/join` for it to take effect."
      : " Use `/join` to start transcribing.";
    await interaction.reply({
      content: `Voice channel set to **${target.name}**.${note}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "text") {
    // Prefer the explicit option; fall back to the channel where the command was typed
    const picked = interaction.options.getChannel("channel") as TextChannel | null;
    const target = picked ?? (interaction.channel as TextChannel);

    setTextChannelId(target.id);
    textChannel = target;

    const note = inSession
      ? " The change takes effect on the next session."
      : "";
    await interaction.reply({
      content: `Text channel set to ${target.toString()}.${note}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleMute(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = interaction.options.getUser("user", true);
  const added = muteUser(user.id);
  await interaction.reply({
    content: added
      ? `🔇 <@${user.id}> is now muted — their audio will not be recorded.`
      : `<@${user.id}> is already muted.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleUnmute(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = interaction.options.getUser("user", true);
  const removed = unmuteUser(user.id);
  await interaction.reply({
    content: removed
      ? `🔊 <@${user.id}> is now unmuted — their audio will be recorded again.`
      : `<@${user.id}> was not muted.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const session = sessionManager.getSession();
  const lines: string[] = [];

  const inVoice = voiceChannel ? !!getVoiceConnection(voiceChannel.guild.id) : false;
  lines.push(`**Voice:** ${inVoice ? `🔵 Connected to **${voiceChannel!.name}**` : "⚫ Not connected"}`);

  if (session) {
    const elapsed = Date.now() - session.startTime;
    const mins = Math.floor(elapsed / 60_000);
    const secs = Math.floor((elapsed % 60_000) / 1000);
    const stateIcon = session.paused ? "⏸️ Paused" : "🟢 Active";
    lines.push(`**Session:** ${stateIcon} — ${mins}m ${secs}s`);

    const activeSpeakers = chunkManager.getActiveSpeakers();
    lines.push(
      `**Speaking now:** ${activeSpeakers.size > 0 ? [...activeSpeakers].map((id) => `<@${id}>`).join(", ") : "nobody"}`
    );
    lines.push(`**Buffered audio:** ${userBuffers.getTotalBufferedMs().toFixed(0)} ms`);
    lines.push(`**Chunks transcribed:** ${session.transcriptIds.length}`);
  } else {
    lines.push(`**Session:** 🔴 Not running${inVoice ? " — use `/startsession` to begin recording" : ""}`);
  }

  lines.push(`**Voice channel:** ${voiceChannel ? `**${voiceChannel.name}**` : "not set"}`);
  lines.push(`**Text channel:** ${textChannel ? textChannel.toString() : "not set"}`);

  const boostCount = getWords().length;
  lines.push(`**Word boost:** ${boostCount} word${boostCount !== 1 ? "s" : ""}`);

  const roles = getAllowedRoles();
  const users = getAllowedUsers();
  lines.push(
    roles.length === 0 && users.length === 0
      ? "**Access control:** open (no restrictions)"
      : `**Access control:** ${roles.length} role(s), ${users.length} user(s)`
  );

  const muted = getMutedUsers();
  lines.push(
    muted.length > 0
      ? `**Muted:** ${muted.map((id) => `<@${id}>`).join(", ")}`
      : "**Muted:** nobody"
  );

  await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
}

async function handleAllowRole(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === "add") {
    const role = interaction.options.getRole("role", true);
    const added = addAllowedRole(role.id);
    await interaction.reply({
      content: added ? `✅ <@&${role.id}> can now use the bot.` : `<@&${role.id}> was already allowed.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "remove") {
    const role = interaction.options.getRole("role", true);
    const removed = removeAllowedRole(role.id);
    await interaction.reply({
      content: removed ? `✅ Removed <@&${role.id}> from the allow list.` : `<@&${role.id}> was not in the allow list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "list") {
    const roles = getAllowedRoles();
    await interaction.reply({
      content:
        roles.length > 0
          ? `**Allowed roles (${roles.length}):**\n${roles.map((id) => `• <@&${id}>`).join("\n")}`
          : "No roles configured — everyone has access.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleAllowUser(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === "add") {
    const user = interaction.options.getUser("user", true);
    const added = addAllowedUser(user.id);
    await interaction.reply({
      content: added ? `✅ <@${user.id}> can now use the bot.` : `<@${user.id}> was already allowed.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "remove") {
    const user = interaction.options.getUser("user", true);
    const removed = removeAllowedUser(user.id);
    await interaction.reply({
      content: removed ? `✅ Removed <@${user.id}> from the allow list.` : `<@${user.id}> was not in the allow list.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "list") {
    const users = getAllowedUsers();
    await interaction.reply({
      content:
        users.length > 0
          ? `**Allowed users (${users.length}):**\n${users.map((id) => `• <@${id}>`).join("\n")}`
          : "No users configured — everyone has access.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

const commandHandlers: Record<
  string,
  (i: ChatInputCommandInteraction) => Promise<void>
> = {
  join: handleJoin,
  leave: handleLeave,
  startsession: handleStartSession,
  endsession: handleEndSession,
  pause: handlePause,
  resume: handleResume,
  wordboost: handleWordBoost,
  setchannel: handleSetChannel,
  status: handleStatus,
  allowrole: handleAllowRole,
  allowuser: handleAllowUser,
  mute: handleMute,
  unmute: handleUnmute,
};

// ── Client events ─────────────────────────────────────────────────────────────

client.once("clientReady", async (readyClient) => {
  console.log(`[bot] Logged in as ${readyClient.user.tag}`);

  // ── Resolve channels from the database ────────────────────────────────────

  const storedVoiceId = getVoiceChannelId();
  const storedTextId  = getTextChannelId();

  if (storedVoiceId) voiceChannel = await resolveVoiceChannel(storedVoiceId);
  if (storedTextId)  textChannel  = await resolveTextChannel(storedTextId);

  if (!voiceChannel && storedVoiceId) {
    console.warn(`[bot] Could not resolve voice channel ${storedVoiceId}.`);
  }
  if (!textChannel && storedTextId) {
    console.warn(`[bot] Could not resolve text channel ${storedTextId}.`);
  }

  // ── Register slash commands ────────────────────────────────────────────────
  // Guild commands propagate instantly; fall back to global if no guild is known.

  const guildId =
    config.guildId ??
    voiceChannel?.guild.id ??
    textChannel?.guild?.id;

  const rest = new REST().setToken(config.discordToken);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(readyClient.user.id, guildId), {
      body: slashCommands,
    });
    console.log("[bot] Guild slash commands registered.");
  } else {
    await rest.put(Routes.applicationCommands(readyClient.user.id), {
      body: slashCommands,
    });
    console.log("[bot] Global slash commands registered (may take up to 1 h to propagate).");
  }

  // ── Initialise chunkManager with its dependencies ──────────────────────────

  initChunkManager({ config, transcribe, sessionManager, transcriptLogger });

  // ── Auto-join if both channels are available ───────────────────────────────

  if (voiceChannel) {
    doJoin();
    console.log(`[bot] Auto-joined voice channel: ${voiceChannel.name}`);
    console.log("[bot] Use /startsession to begin recording.");
  } else {
    console.log(
      "[bot] Voice channel not configured — use /setchannel voice, then /join and /startsession."
    );
  }

  console.log(`[bot] Min chunk: ${config.minChunkMs} ms | Max chunk: ${config.maxChunkMs} ms`);
  console.log(`[bot] Min confidence : ${config.minConfidence}`);
  console.log(`[bot] Silence threshold: RMS ${config.silenceRmsThreshold} (0 = disabled)`);
  if (config.assemblyAiLanguage) console.log(`[bot] AssemblyAI language: ${config.assemblyAiLanguage}`);
  if (config.gcpLanguage) console.log(`[bot] GCP language: ${config.gcpLanguage}`);

  startHealthServer(config.healthPort);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const handler = commandHandlers[interaction.commandName];
  if (!handler) return;

  // ── Access control check ────────────────────────────────────────────────
  const memberRoles = interaction.member?.roles;
  const roleIds: string[] = !memberRoles
    ? []
    : Array.isArray(memberRoles)
      ? memberRoles
      : [...memberRoles.cache.keys()];

  if (!canUseBot(interaction.user.id, roleIds)) {
    await interaction.reply({
      content: "❌ You don't have permission to use this bot.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await handler(interaction).catch(async (err) => {
    console.error(`[bot] /${interaction.commandName} error:`, err);
    const msg = "An error occurred.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  });
});

client.on("error", (err) => console.error("[bot] Client error:", err));

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[bot] Received ${signal}, flushing and shutting down...`);
  await chunkManager.forceFlushAll();
  if (voiceChannel) getVoiceConnection(voiceChannel.guild.id)?.destroy();
  await sessionManager.endSession();
  client.destroy();
  process.exit(0);
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Boot ──────────────────────────────────────────────────────────────────────

client.login(config.discordToken).catch((err) => {
  console.error("[bot] Login failed:", err);
  process.exit(1);
});
