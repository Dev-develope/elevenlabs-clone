// 60db TTS WebSocket proxy sidecar.
//
// Why this exists:
//   The 60db realtime WS endpoint takes the API key as a `?apiKey=` query
//   param. Browsers can't open that URL directly without leaking the key
//   into client code + network logs. This proxy sits between them:
//
//     browser  ⇄  (ws://this-server:3001/tts?token=...)  ⇄  this  ⇄  wss://api.60db.ai/ws/tts?apiKey=...
//
//   The token is a short-lived HMAC-signed payload minted by the Next.js
//   app at /api/tts/ws-token. This sidecar verifies it before opening the
//   upstream connection; if verification fails it closes the browser
//   socket immediately.
//
// Required env:
//   SIXTYDB_API_KEY   - injected straight into the upstream URL
//   WS_PROXY_SECRET   - HMAC secret shared with the Next.js app
//   SIXTYDB_API_BASE  - optional, default https://api.60db.ai
//   PORT              - optional, default 3001

import http from "node:http";
import { createHmac } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT ?? 3001);
const SIXTYDB_API_KEY = process.env.SIXTYDB_API_KEY;
const WS_PROXY_SECRET = process.env.WS_PROXY_SECRET;
const SIXTYDB_API_BASE =
  process.env.SIXTYDB_API_BASE ?? "https://api.60db.ai";

if (!SIXTYDB_API_KEY || !WS_PROXY_SECRET) {
  console.error(
    "[ws-proxy] fatal: SIXTYDB_API_KEY and WS_PROXY_SECRET must be set",
  );
  process.exit(1);
}

// Same signing scheme as src/app/api/tts/ws-token/route.ts.
// Token = base64url(JSON.stringify({uid,exp})) + "." + HMAC-SHA256(payload).
function verifyToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = createHmac("sha256", WS_PROXY_SECRET)
    .update(payload)
    .digest("base64url");
  if (expected !== sig) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof claims.exp !== "number") return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("60db TTS WS proxy — connect via /tts?token=...\n");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/tts") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  const claims = verifyToken(url.searchParams.get("token"));
  if (!claims) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (clientWs) => {
    handleSession(clientWs, claims);
  });
});

function handleSession(clientWs, claims) {
  const upstreamUrl =
    SIXTYDB_API_BASE.replace(/^http/, "ws") +
    `/ws/tts?apiKey=${encodeURIComponent(SIXTYDB_API_KEY)}`;

  const upstream = new WebSocket(upstreamUrl);
  let upstreamOpen = false;
  const buffered = [];

  console.log(`[ws-proxy] session opened uid=${claims.uid}`);

  upstream.on("open", () => {
    upstreamOpen = true;
    for (const m of buffered) upstream.send(m);
    buffered.length = 0;
  });

  // Bidirectional pipe. We forward raw messages — the protocol shape
  // (create_context, send_text, flush_context, audio_chunk) is owned by
  // 60db, this proxy stays oblivious.
  clientWs.on("message", (data) => {
    if (upstreamOpen) upstream.send(data);
    else buffered.push(data);
  });
  upstream.on("message", (data) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
  });

  const closeBoth = (code, reason) => {
    try {
      clientWs.close(code, reason);
    } catch {}
    try {
      upstream.close(code, reason);
    } catch {}
  };
  clientWs.on("close", () => closeBoth(1000, "client closed"));
  clientWs.on("error", (e) => {
    console.warn(`[ws-proxy] client err uid=${claims.uid}: ${e.message}`);
    closeBoth(1011, "client error");
  });
  upstream.on("close", () => closeBoth(1000, "upstream closed"));
  upstream.on("error", (e) => {
    console.warn(`[ws-proxy] upstream err uid=${claims.uid}: ${e.message}`);
    closeBoth(1011, "upstream error");
  });
}

server.listen(PORT, () => {
  console.log(`[ws-proxy] listening on :${PORT}, upstream=${SIXTYDB_API_BASE}`);
});
