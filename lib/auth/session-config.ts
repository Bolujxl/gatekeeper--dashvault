import { SessionOptions } from "iron-session";

export interface SessionData {
  userId?: string;
  email?: string;
  name?: string;
  createdAt?: number;
  lastActiveAt?: number;
}

function getSessionPassword(): string {
  const pwd = process.env.SESSION_PASSWORD;

  if (!pwd || pwd.length < 32) {
    throw new Error(
      "[FATAL] SESSION_PASSWORD must be set in .env and be at least 32 characters.\n" +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }

  const uniqueChars = new Set(pwd).size;
  if (uniqueChars < 10) {
    throw new Error(
      `[FATAL] SESSION_PASSWORD has too little entropy (${uniqueChars} unique characters).\n` +
        'Generate a proper key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }

  return pwd;
}

export const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export const sessionOptions: SessionOptions = {
  get password() {
    return getSessionPassword();
  },
  cookieName: "dashvault_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: ABSOLUTE_TIMEOUT_MS / 1000,
    path: "/",
  },
};
