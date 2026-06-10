"use client";

import { useCallback, useRef, useState } from "react";

// Hook: open a WebSocket to the sidecar proxy (which fronts 60db's
// /ws/tts), maintain one context, send accumulated text on flush, and
// play LINEAR16 audio chunks via a Web Audio queue.
//
// We use LINEAR16 @ 24 kHz here because realtime WS callers care more
// about latency than payload size, and decoding mp3 frames in JS is
// jankier than just queueing raw PCM samples.
export type TtsWsState = "idle" | "connecting" | "ready" | "speaking" | "error";

export function useTtsWebSocket() {
  const [state, setState] = useState<TtsWsState>("idle");
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playheadRef = useRef<number>(0);
  const contextIdRef = useRef<string>("");

  const connect = useCallback(async (voiceId: string) => {
    setState("connecting");
    setError(null);

    // 1. Get short-lived signed token from Next.js.
    const tokRes = await fetch("/api/tts/ws-token");
    if (!tokRes.ok) {
      setError(`Token mint failed: ${tokRes.status}`);
      setState("error");
      return;
    }
    const { wsUrl } = (await tokRes.json()) as { wsUrl: string };

    // 2. Open the WS to the sidecar.
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    const ctx = new AudioContext({ sampleRate: 24000 });
    audioCtxRef.current = ctx;
    playheadRef.current = ctx.currentTime;
    contextIdRef.current = `ctx-${Date.now()}`;

    ws.binaryType = "arraybuffer";

    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(
        typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer),
      ) as Record<string, unknown>;

      if ("connection_established" in msg) {
        ws.send(
          JSON.stringify({
            create_context: {
              context_id: contextIdRef.current,
              voice_id: voiceId,
              audio_config: {
                audio_encoding: "LINEAR16",
                sample_rate_hertz: 24000,
              },
            },
          }),
        );
        return;
      }
      if ("context_created" in msg) {
        setState("ready");
        return;
      }
      if ("audio_chunk" in msg) {
        const chunk = (msg.audio_chunk as { audioContent: string }).audioContent;
        playPcmChunk(chunk, ctx, playheadRef);
        setState("speaking");
        return;
      }
      if ("flush_completed" in msg || "context_closed" in msg) {
        setState("ready");
        return;
      }
    });

    ws.addEventListener("close", () => setState("idle"));
    ws.addEventListener("error", () => {
      setError("WebSocket error");
      setState("error");
    });
  }, []);

  const sendText = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        send_text: { context_id: contextIdRef.current, text },
      }),
    );
  }, []);

  const flush = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({ flush_context: { context_id: contextIdRef.current } }),
    );
  }, []);

  const close = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({ close_context: { context_id: contextIdRef.current } }),
      );
      ws.close();
    }
    audioCtxRef.current?.close().catch(() => undefined);
    wsRef.current = null;
    audioCtxRef.current = null;
    setState("idle");
  }, []);

  return { state, error, connect, sendText, flush, close };
}

// Decode base64 LINEAR16 PCM into Float32 samples and schedule playback
// gapless, advancing a running playhead so back-to-back chunks fuse.
function playPcmChunk(
  base64: string,
  ctx: AudioContext,
  playheadRef: { current: number },
) {
  const bin = atob(base64);
  const pcm16 = new Int16Array(bin.length / 2);
  for (let i = 0; i < pcm16.length; i++) {
    pcm16[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
  }
  const float = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) float[i] = pcm16[i] / 0x8000;

  const buf = ctx.createBuffer(1, float.length, 24000);
  buf.getChannelData(0).set(float);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);

  const startAt = Math.max(playheadRef.current, ctx.currentTime);
  src.start(startAt);
  playheadRef.current = startAt + buf.duration;
}
