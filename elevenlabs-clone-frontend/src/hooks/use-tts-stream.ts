"use client";

import { useCallback, useRef, useState } from "react";

// Hook: POST /api/tts/stream, decode each NDJSON line, append base64 audio
// chunks to a MediaSource SourceBuffer so playback starts before the full
// utterance is synthesized.
//
// Browser support: MediaSource + mp3 works in every evergreen browser.
// Safari needs MIME `audio/mpeg`. We feed exactly what 60db sends back.
export type TtsStreamState = "idle" | "streaming" | "done" | "error";

export function useTtsStream() {
  const [state, setState] = useState<TtsStreamState>("idle");
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback(
    async (args: { text: string; voiceId: string }) => {
      setState("streaming");
      setError(null);

      const mediaSource = new MediaSource();
      const audio = new Audio();
      audio.src = URL.createObjectURL(mediaSource);
      audioRef.current = audio;
      void audio.play().catch(() => {
        /* autoplay may be blocked — UI surfaces this via state */
      });

      const sourceBufferReady = new Promise<SourceBuffer>((resolve, reject) => {
        mediaSource.addEventListener("sourceopen", () => {
          try {
            const sb = mediaSource.addSourceBuffer("audio/mpeg");
            resolve(sb);
          } catch (e) {
            reject(e);
          }
        });
      });

      try {
        const res = await fetch("/api/tts/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: args.text, voice_id: args.voiceId }),
        });
        if (!res.ok || !res.body) {
          throw new Error(`Stream HTTP ${res.status}: ${await res.text()}`);
        }

        const sourceBuffer = await sourceBufferReady;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let leftover = "";

        // SourceBuffer.appendBuffer is async and only accepts one chunk at
        // a time — we queue and drain serially via an updateend latch.
        const appendQueue: Uint8Array[] = [];
        let appending = false;
        const drain = () => {
          if (appending || appendQueue.length === 0) return;
          const next = appendQueue.shift()!;
          appending = true;
          sourceBuffer.appendBuffer(next);
        };
        sourceBuffer.addEventListener("updateend", () => {
          appending = false;
          drain();
        });

        // NDJSON parse loop — split on \n, keep partial line for next read.
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          leftover += decoder.decode(value, { stream: true });
          const lines = leftover.split("\n");
          leftover = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const msg = JSON.parse(trimmed) as {
                type?: string;
                audioContent?: string;
              };
              if (msg.type === "chunk" && msg.audioContent) {
                const bin = atob(msg.audioContent);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++)
                  bytes[i] = bin.charCodeAt(i);
                appendQueue.push(bytes);
                drain();
              } else if (msg.type === "error") {
                throw new Error("Upstream stream error");
              }
            } catch {
              // ignore malformed lines — upstream occasionally pads
            }
          }
        }

        // Wait for the queue to flush, then close the stream so the
        // <audio> element knows the EOF has been reached.
        await new Promise<void>((resolve) => {
          const tick = () => {
            if (!appending && appendQueue.length === 0) {
              if (mediaSource.readyState === "open") {
                try {
                  mediaSource.endOfStream();
                } catch {
                  /* already ended */
                }
              }
              resolve();
            } else {
              setTimeout(tick, 25);
            }
          };
          tick();
        });

        setState("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Stream failed");
        setState("error");
      }
    },
    [],
  );

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setState("idle");
  }, []);

  return { state, error, play, stop };
}
