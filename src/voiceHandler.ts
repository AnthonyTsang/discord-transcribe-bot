import type { Client, Guild } from "discord.js";
import {
  EndBehaviorType,
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";
import prism from "prism-media";
import * as userBuffers from "./userBuffers.js";
import * as chunkManager from "./chunkManager.js";
import * as sessionManager from "./sessionManager.js";
import { isUserMuted } from "./muteDb.js";

/**
 * Sets up listening on a voice connection.
 *
 * @param connection      Active VoiceConnection
 * @param client          Discord.js Client (for user cache)
 * @param guild           Guild the connection belongs to (for member display names)
 * @param voiceChannelId  ID of our voice channel (used to detect user departures)
 * @param onNeedReconnect Called when the connection is destroyed unrecoverably;
 *                        the caller should schedule a new joinVoiceChannel call.
 */
export function setupVoiceHandler(
  connection: VoiceConnection,
  client: Client,
  guild: Guild,
  voiceChannelId: string,
  onNeedReconnect: () => void
): void {
  const receiver = connection.receiver;
  const memberNameCache = new Map<string, string>();
  console.log("[voice] Setting up voice handler...");

  /** Resolves a guild member's display name, caching the result. */
  async function resolveDisplayName(userId: string): Promise<string> {
    const cached = memberNameCache.get(userId);
    if (cached) return cached;
    try {
      const member = await guild.members.fetch(userId);
      memberNameCache.set(userId, member.displayName);
      return member.displayName;
    } catch {
      const fallback = client.users.cache.get(userId)?.username ?? userId;
      return fallback;
    }
  }

  // ── Connection state ──────────────────────────────────────────────────────

  connection.on(VoiceConnectionStatus.Connecting, () => {
    console.log("[voice] Connecting...");
  });

  connection.on(VoiceConnectionStatus.Signalling, () => {
    console.log("[voice] Signalling...");
  });

  console.log(`[voice] Connection state on setup: ${connection.state.status}`);
  connection.on("stateChange", (oldState, newState) => {
    console.log(`[voice] State: ${oldState.status} → ${newState.status}`);

    // When entering connecting, hook into the internal networking state machine
    // to see exactly which handshake step is failing.
    if (newState.status === VoiceConnectionStatus.Connecting) {
      const networking = (newState as any).networking;
      if (networking) {
        networking.once("stateChange", (oldNet: any, newNet: any) => {
          const oldCode = oldNet?.code ?? oldNet?.constructor?.name ?? JSON.stringify(oldNet);
          const newCode = newNet?.code ?? newNet?.constructor?.name ?? JSON.stringify(newNet);
          console.log(`[voice] Networking sub-state: ${oldCode} → ${newCode}`);
          if (newNet?.ws) {
            newNet.ws.once("close", (event: CloseEvent) => {
              console.error(`[voice] Voice WebSocket closed: code=${event.code} reason=${event.reason ?? 'unknown'}`);
            });
          }
        });
        networking.on("error", (err: Error) => {
          console.error("[voice] Networking error:", err);
        });
      }
    }
  });
  // entersState resolves immediately if already in the target state,
  // or waits until the state is reached — more reliable than event listeners.
  entersState(connection, VoiceConnectionStatus.Ready, 20_000)
    .then(() => console.log("[voice] Connection ready, listening for speakers..."))
    .catch(() => console.error("[voice] Connection did not reach Ready state within 20s — check bot voice permissions and network."));

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.warn("[voice] Disconnected — attempting to reconnect...");
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      console.log("[voice] Reconnecting...");
    } catch {
      console.error("[voice] Could not reconnect gracefully. Notifying caller.");
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
      }
      if (sessionManager.getSession()) {
        onNeedReconnect();
      }
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    console.warn("[voice] Connection destroyed.");
    if (sessionManager.getSession()) {
      onNeedReconnect();
    }
  });

  // ── Per-user audio subscription ───────────────────────────────────────────

  const subscriptions = new Map<string, boolean>();

  receiver.speaking.on("start", (userId: string) => {
    if (sessionManager.isPaused()) return;
    if (isUserMuted(userId)) return;

    // Start the per-user state machine immediately with a fallback name
    const fallback = client.users.cache.get(userId)?.username ?? userId;
    console.log(`[voice] ${fallback} (${userId}) started speaking.`);
    chunkManager.onUserStartedSpeaking(userId, fallback);

    // Asynchronously resolve their server display name and update the state machine
    resolveDisplayName(userId).then((displayName) => {
      chunkManager.updateUserDisplayName(userId, displayName);
    });

    if (!subscriptions.has(userId)) {
      subscriptions.set(userId, true);

      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.Manual },
      });

      // Decode Opus → raw 16-bit stereo PCM at 48 kHz (3840 bytes per 20 ms frame)
      const pcmStream = opusStream.pipe(
        new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 })
      );

      pcmStream.on("data", (chunk: Buffer) => {
        // Double-check mute on every packet — handles users muted mid-subscription
        if (!sessionManager.isPaused() && !isUserMuted(userId)) {
          userBuffers.writePcm(userId, chunk, Date.now());
        }
      });

      pcmStream.on("error", (err: Error) => {
        console.error(`[voice] PCM stream error for ${userId}:`, err);
      });

      opusStream.on("close", () => {
        subscriptions.delete(userId);
      });
    }
  });

  receiver.speaking.on("end", (userId: string) => {
    if (sessionManager.isPaused()) return;
    const name = memberNameCache.get(userId) ?? client.users.cache.get(userId)?.username ?? userId;
    console.log(`[voice] ${name} (${userId}) stopped speaking.`);
    chunkManager.onUserStoppedSpeaking(userId);
  });

  // ── Cleanup when a user leaves the channel ────────────────────────────────

  client.on("voiceStateUpdate", (oldState, newState) => {
    if (
      oldState.channelId === voiceChannelId &&
      newState.channelId !== voiceChannelId
    ) {
      const userId = oldState.id;
      if (subscriptions.has(userId)) {
        try {
          receiver.subscriptions.get(userId)?.destroy();
        } catch {
          // ignore
        }
        subscriptions.delete(userId);
      }
      // Treat departure as a speaking-stop so their buffer is flushed cleanly
      chunkManager.onUserStoppedSpeaking(userId);
    }
  });
}
