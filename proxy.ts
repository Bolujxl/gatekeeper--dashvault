import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  sessionOptions,
  SessionData,
} from "@/lib/auth/session-config";

const PROTECTED_ROUTES = ["/dashboard"];
const GUEST_ONLY_ROUTES = ["/login", "/signup"];

/**
 * Fail-closed perimeter: requireAuth()/requireGuest() only protect a route if
 * a developer remembers to call them inside that page. This runs at the edge
 * for every request under the matcher below, so a forgotten guard on a future
 * page (e.g. app/dashboard/settings/page.tsx) still redirects instead of
 * rendering.
 *
 * This is also the only place idle/absolute session timeouts are enforced.
 * Next.js forbids writing cookies during a Server Component render, so a
 * page's requireAuth() can only read the session — refreshing lastActiveAt on
 * activity, or destroying an expired session, has to happen here instead,
 * where NextResponse allows cookie writes.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_ROUTES.some((route) => pathname.startsWith(route));
  const isGuestOnly = GUEST_ONLY_ROUTES.some((route) => pathname.startsWith(route));

  if (!isProtected && !isGuestOnly) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);

  if (isProtected) {
    if (!session.userId) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    const now = Date.now();
    const expiredAbsolute =
      session.createdAt !== undefined && now - session.createdAt > ABSOLUTE_TIMEOUT_MS;
    const expiredIdle =
      session.lastActiveAt !== undefined && now - session.lastActiveAt > IDLE_TIMEOUT_MS;

    if (expiredAbsolute || expiredIdle) {
      const redirectRes = NextResponse.redirect(new URL("/login", req.url));
      const expiredSession = await getIronSession<SessionData>(req, redirectRes, sessionOptions);
      expiredSession.destroy();
      return redirectRes;
    }

    session.lastActiveAt = now;
    await session.save();
    return res;
  }

  if (session.userId) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup"],
};
