import { redirect } from "next/navigation";
import { getSession } from "./session";

/**
 * Use in Server Components or Server Actions that require an authenticated user.
 * Redirects to /login if no valid session exists.
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
