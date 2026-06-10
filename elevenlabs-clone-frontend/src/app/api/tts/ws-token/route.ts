import { createHmac } from "crypto";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

// GET /api/tts/ws-token
// Returns a short-lived signed token the browser passes to the WS proxy
// sidecar (`ws://…:3001/tts?token=…`). Lifetime: 60 s — long enough to
// open the socket, too short to be useful if leaked.
//
// Token format: base64url(JSON.stringify({uid,exp})) "." HMAC-SHA256(payload).
// We don't pull in a JWT lib for one tiny token — keep deps lean.
function sign(payload: object): string {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json).toString("base64url");
  const sig = createHmac("sha256", env.WS_PROXY_SECRET)
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

export async function GET() {
  const session = await auth();
  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Reject up front if the user can't afford a typical chunk — same
  // 50-credit floor as sync/stream so the WS session can't run for free.
  const user = await db.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { credits: true },
  });
  if (user.credits < 50) {
    return Response.json({ error: "Insufficient credits" }, { status: 402 });
  }

  const token = sign({
    uid: session.user.id,
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  return Response.json({
    token,
    wsUrl: `${process.env.NEXT_PUBLIC_WS_PROXY_URL ?? "ws://localhost:3001/tts"}?token=${encodeURIComponent(token)}`,
  });
}
