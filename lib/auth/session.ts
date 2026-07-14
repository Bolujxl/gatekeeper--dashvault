import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, SessionData } from "./session-config";

export type { SessionData };
export { sessionOptions };

// Reads only. Next.js forbids writing cookies during a Server Component
// render, so idle/absolute timeout enforcement (which needs to refresh or
// destroy the cookie) lives in proxy.ts instead, where NextResponse allows
// writes. This keeps requireAuth()/requireGuest() safe to call from pages.
export async function getSession() {
  return await getIronSession<SessionData>(await cookies(), sessionOptions);
}
