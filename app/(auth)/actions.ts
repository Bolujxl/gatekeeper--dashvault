"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getPlaceholderHash } from "@/lib/auth/placeholder";
import { signupSchema, loginSchema } from "@/lib/auth/schemas";
import { rateLimit } from "@/lib/auth/rate-limit";

export interface AuthActionState {
  error?: string;
  fieldErrors?: {
    name?: string;
    email?: string;
    password?: string;
  };
}

const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for") ?? "unknown";
}

/** Starts a session from scratch so a pre-login cookie is never upgraded in place. */
async function createSession(user: { id: string; email: string; name: string }) {
  const stale = await getSession();
  stale.destroy();

  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.name = user.name;
  const now = Date.now();
  session.createdAt = now;
  session.lastActiveAt = now;
  await session.save();
}

export async function signupAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const ip = await clientIp();
  const signupCheck = rateLimit(`signup:ip:${ip}`, {
    windowMs: 60 * 60 * 1000,
    maxAttempts: 5,
  });
  if (!signupCheck.allowed) {
    return { error: "Too many signup attempts. Try again later." };
  }

  const result = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    const fieldErrors: AuthActionState["fieldErrors"] = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof NonNullable<AuthActionState["fieldErrors"]>;
      if (field && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { fieldErrors };
  }

  const { name, email, password } = result.data;

  // Check first, hash second: the "email already exists" message already tells
  // an attacker whether the account exists, so there's nothing left for a
  // timing-equalized bcrypt call to protect here — it would just burn ~100ms
  // of CPU on every duplicate signup attempt for no security benefit.
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    return {
      fieldErrors: {
        email: "An account with this email already exists.",
      },
    };
  }

  const passwordHash = await hashPassword(password);

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email,
        name,
        password: passwordHash,
      },
      select: { id: true, email: true, name: true },
    });
  } catch (e) {
    // Two concurrent signups for the same email can both pass the check above
    // and race to create() — the DB's unique constraint is the real guard.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        fieldErrors: {
          email: "An account with this email already exists.",
        },
      };
    }
    throw e;
  }

  await createSession(user);

  redirect("/dashboard");
}

export async function loginAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const ip = await clientIp();

  const ipCheck = rateLimit(`login:ip:${ip}`, {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 20,
  });
  if (!ipCheck.allowed) {
    return { error: "Too many attempts. Try again later." };
  }

  const result = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return {
      error: "Enter a valid email and password.",
    };
  }

  const { email, password } = result.data;

  const emailCheck = rateLimit(`login:email:${email}`, {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 5,
  });
  if (!emailCheck.allowed) {
    return { error: "Too many attempts. Try again later." };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      password: true,
      failedLoginAttempts: true,
      lockedUntil: true,
    },
  });

  // A locked account short-circuits before bcrypt runs, which does make a
  // locked account respond faster than an unlocked one. That's an accepted
  // tradeoff: lockout only ever triggers after 5 failed attempts against a
  // real account, so it doesn't hand an attacker a cheap way to enumerate
  // emails that isn't already easier via the signup form's error message.
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    return { error: "Too many failed attempts. Try again later." };
  }

  const passwordOk = user
    ? await verifyPassword(password, user.password)
    : await verifyPassword(password, await getPlaceholderHash());

  if (!user || !passwordOk) {
    if (user) {
      const attempts = user.failedLoginAttempts + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          lockedUntil:
            attempts >= LOGIN_LOCKOUT_THRESHOLD
              ? new Date(Date.now() + LOGIN_LOCKOUT_MS)
              : null,
        },
      });
    }
    return {
      error: "Invalid email or password.",
    };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });

  await createSession(user);

  redirect("/dashboard");
}

export async function logoutAction() {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}
