import { redirect } from "next/navigation";
import { getSession } from "./session";

/**
 * Use in Server Components or Server Actions that require an authenticated user.
 * Redirects to /login if no session exists. This is a read-only check — idle/
 * absolute timeout enforcement (which requires writing/destroying the cookie)
 * happens earlier, in proxy.ts, before the request ever reaches this page.
 * Returns the session's user info (userId, email, name) if authenticated.
 */
export async function requireAuth() {
  const session = await getSession();
  if (!session.userId) {
    redirect("/login");
  }
  return {
    userId: session.userId,
    email: session.email!,
    name: session.name!,
  };
}

/**
 * Use in routes that should redirect AWAY if the user is already logged in.
 * (e.g., /login should send you to /dashboard if you're already authenticated)
 */
export async function requireGuest() {
  const session = await getSession();
  if (session.userId) {
    redirect("/dashboard");
  }
}
