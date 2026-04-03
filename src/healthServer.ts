import * as sessionManager from "./sessionManager.js";
import * as userBuffers from "./userBuffers.js";
import * as chunkManager from "./chunkManager.js";

export function startHealthServer(port: number): void {
  Bun.serve({
    port,
    fetch() {
      const session = sessionManager.getSession();
      const body = {
        ok: true,
        timestamp: new Date().toISOString(),
        session: session
          ? {
              active: true,
              paused: session.paused,
              durationMs: Date.now() - session.startTime,
              bufferedAudioMs: Math.round(userBuffers.getTotalBufferedMs()),
              activeSpeakers: chunkManager.getActiveSpeakers().size,
              chunksTranscribed: session.transcriptIds.length,
            }
          : { active: false },
      };
      return Response.json(body);
    },
  });

  console.log(`[health] Listening on port ${port}`);
}
