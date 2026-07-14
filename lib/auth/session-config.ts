import { SessionOptions } from "iron-session";

export interface SessionData {
  userId?: string;
  email?: string;
  name?: string;
  createdAt?: number; // when this session was first issued (ms epoch)
  lastActiveAt?: number; // last request that passed requireAuth (ms epoch)
}

const sessionPassword = process.env.SESSION_PASSWORD;

if (!sessionPassword || sessionPassword.length < 32) {
  throw new Error(
    "[FATAL] SESSION_PASSWORD must be set in .env and be at least 32 characters.\n" +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
  );
}

const uniqueChars = new Set(sessionPassword).size;
if (uniqueChars < 10) {
  throw new Error(
    `[FATAL] SESSION_PASSWORD has too little entropy (${uniqueChars} unique characters).\n` +
      'Generate a proper key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
  );
}

// For a financial app, a 7-day sliding cookie is too generous. 8 hours matches
// OWASP's guidance for an absolute session ceiling on sensitive applications.
export const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// Kept dependency-free (no next/headers) so the root Edge Middleware can
// import it directly alongside lib/auth/session.ts's Server Component helpers.
export const sessionOptions: SessionOptions = {
  password: sessionPassword,
  cookieName: "dashvault_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: ABSOLUTE_TIMEOUT_MS / 1000,
    path: "/",
  },
};
