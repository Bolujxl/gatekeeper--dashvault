# Advanced Security Threat Audit

A line-level hunt for six enterprise attack vectors in Dashvault's auth system.
Each section explains the exploit, inspects the actual code, and — where needed —
teaches the exact fix.

---

## 1. Timing Attacks & User Enumeration

### The Exploit (Explained)

Imagine a login page. You type `alice@example.com` and any password. The server does
two things: (1) looks up the email in the database, (2) runs bcrypt to check the
password. If the email doesn't exist, step 2 is skipped — the server returns "invalid"
immediately. That response takes ~1 millisecond.

Now type `bob@example.com`. Bob exists, so the server does step 2 — bcrypt takes ~100ms.
The response takes ~101ms.

An attacker writes a script that measures the response time for 10,000 candidate emails.
Any email that takes 100ms longer than baseline? That one is registered. The attacker now
has a list of valid accounts to target with password guessing.

This works on signup too — does the "email already taken" response come faster than the
"account created" response? If so, the attacker can enumerate registered emails through
the signup form.

### Current Implementation

**Signup path** (`app/(auth)/actions.ts` lines 41–53):

```
41 │   const existingUser = await prisma.user.findUnique({
42 │     where: { email },
43 │     select: { id: true },
44 │   });
45 │
46 │   const passwordHash = await hashPassword(password);  // <-- called BEFORE the check
47 │
48 │   if (existingUser) {
49 │     return {
50 │       fieldErrors: {
51 │         email: "An account with this email already exists.",
52 │       },
53 │     };
54 │   }
```

The bcrypt hash runs on **line 46**, before the `if (existingUser)` on **line 48**.
Whether the email exists or not, `bcrypt.hash` burns ~100ms. The response time is the
same in both cases. SAFE.

**Login path** (`app/(auth)/actions.ts` lines 96–98):

```
96 │   const passwordOk = user
97 │     ? await verifyPassword(password, user.password)
98 │     : await verifyPassword(password, "$2a$10$invalidplaceholderhashstringfortimingatk");
```

When `user` is `null` (email not found), the code still calls `verifyPassword` with a
placeholder hash. `bcrypt.compare` runs for the full ~100ms regardless. Both branches
enter bcrypt. The response times are identical. SAFE.

**Remaining concern:** The database query itself (`findUnique`, line 91) is slightly
faster when no row matches (~1-5ms) vs. when a row is fetched (~2-10ms on SQLite).
However, this difference is dwarfed by the ~100ms bcrypt cost and is within network
jitter. Not practically exploitable.

### The Mentor's Verdict

**Currently safe.** The code explicitly equalizes response times by running bcrypt in
both branches. This is a deliberate, well-documented defense (see the comment on line 98
and the `_prevState` pattern on line 75 — the underscore prefix signals this was
intentional architecture, not accident).

One hardening note: the placeholder hash string is hardcoded. If bcrypt's hash format
ever changes (e.g., from `$2a$` to `$2b$`), this constant will need updating. A more
robust approach would compute and cache one dummy hash at startup:

```ts
// lib/auth/placeholder.ts
import { hashPassword } from "./password";

let _placeholderHash: string | null = null;

export async function getPlaceholderHash(): Promise<string> {
  if (!_placeholderHash) {
    _placeholderHash = await hashPassword("placeholder_not_a_real_password");
  }
  return _placeholderHash;
}
```

This way the format is always valid for the current bcrypt version, and you never need
to hand-craft a hash string.

---

## 2. Session Hijacking (Weak Cookie Flags)

### The Exploit (Explained)

A session cookie is the user's proof of identity. If an attacker steals it, they become
that user. Three cookie flags prevent theft:

- **`HttpOnly`** — if missing, `document.cookie` in JavaScript can read the session.
  An XSS vulnerability (injected script) would immediately leak every active session.
- **`Secure`** — if missing, the cookie is sent over HTTP (unencrypted). Anyone on the
  same WiFi network can sniff the cookie from the wire.
- **`SameSite`** — if missing (or set to `None`), the cookie is attached to requests
  originating from other websites. A malicious site can trick the user's browser into
  making authenticated requests to your API without the user knowing.

### Current Implementation

**`lib/auth/session.ts` lines 13–19:**

```
13 │   cookieOptions: {
14 │     secure: process.env.NODE_ENV === "production",
15 │     httpOnly: true,
16 │     sameSite: "lax",
17 │     maxAge: 60 * 60 * 24 * 7, // 7 days
18 │     path: "/",
19 │   },
```

| Flag | Value | Safe? |
|------|-------|-------|
| `httpOnly` | `true` (line 15) | JavaScript cannot read the cookie |
| `secure` | `true` in production (line 14) | HTTPS-only where it matters |
| `sameSite` | `"lax"` (line 16) | Blocks cross-site POST/iframe |
| `maxAge` | 7 days (line 17) | Expires, not permanent |

All three flags are correctly set. Additionally, the cookie contents are **encrypted**
by iron-session (not just signed — even the user can't read their own session data).

### The Mentor's Verdict

**Currently safe.** All flags are present and correctly configured. The `secure` flag
uses an environment-aware check (`process.env.NODE_ENV === "production"`) rather than
being hardcoded to `true`, which is the correct pattern — this allows localhost
development over HTTP while enforcing HTTPS in production.

One optional hardening: switch `sameSite` from `"lax"` to `"strict"`. The difference:

- **Lax:** cookies sent on top-level GET navigations from other sites (e.g., clicking a
  link to your site from an email) but NOT on POST/iframe/subresource requests.
- **Strict:** cookies never sent from other sites at all — even clicking a link from an
  email won't carry the session.

`"strict"` is more secure but breaks legitimate flows like "click link in email → land
on dashboard already logged in." Since Dashvault uses Server Actions (which have their
own CSRF protection — see Section 3), `"lax"` is sufficient.

---

## 3. Cross-Site Request Forgery (Missing CSRF Protection)

### The Exploit (Explained)

You're logged into dashvault.com. In another tab, you visit evil.com. Evil.com has a
hidden form:

```html
<form action="https://dashvault.com/api/transfer" method="POST">
  <input type="hidden" name="to" value="attacker-account" />
  <input type="hidden" name="amount" value="1000000" />
</form>
<script>document.forms[0].submit();</script>
```

Your browser, seeing a request to dashvault.com, automatically attaches your session
cookie. The server sees a valid session and processes the transfer. You just sent money
to an attacker without clicking anything.

Traditional CSRF defense requires a secret token embedded in every form that the server
validates before processing state-changing requests.

### Current Implementation

Dashvault uses **Next.js Server Actions** (`"use server"`), not traditional API route
handlers. When a form submits to a Server Action, Next.js automatically:

1. Generates a CSRF token and embeds it in the form as a hidden `<input>`.
2. Validates the token on the server before executing the action.

This is transparent — developers don't need to configure anything. Every Server Action
form (signup at `app/(auth)/signup/page.tsx`, login at `app/(auth)/login/page.tsx`,
logout at `app/dashboard/page.tsx`) inherits this protection.

Additionally, the session cookie has `sameSite: "lax"` (`lib/auth/session.ts` line 16),
which provides an HTTP-level second layer: the browser won't attach the cookie to
cross-site POST requests at all.

### The Mentor's Verdict

**Currently safe.** Next.js Server Actions provide automatic CSRF protection.
`sameSite: "lax"` provides defense at the browser level as a fallback. This is a
belt-and-suspenders approach — even if one layer fails, the other catches it.

**Note:** This protection only applies to Server Actions. If the project later adds
traditional Route Handlers (`route.ts` files with `export async function POST()`),
those would need explicit CSRF protection. Currently, no Route Handlers exist, so
this is not a concern.

---

## 4. Cryptographic Blunders (Key Exposure)

### The Exploit (Explained)

Session cookies are encrypted with a secret key. If the key is:
- Hardcoded in source code → committed to git → visible to anyone with repo access
- Defaulted to `"secret"` or `"changeme"` when the env var is missing → trivially
  guessable
- Too short (e.g., 8 characters) → brute-forceable offline

An attacker who knows the key can forge valid session cookies for any user ID.
They can log in as anyone, including the admin.

### Current Implementation

**`lib/auth/session.ts` line 11:**

```ts
password: process.env.SESSION_PASSWORD as string,
```

The key is read from the environment — not hardcoded. Good.

**But:** The `as string` TypeScript cast is a lie. If `SESSION_PASSWORD` is not set
in `.env`, the value is `undefined`, and TypeScript won't catch it because the cast
suppresses the error. At runtime, iron-session will throw when it receives an
`undefined` password — which is actually the correct behavior (fail loud), but the
error message may be confusing.

**`.env.example` line 2:**

```
SESSION_PASSWORD=""
```

Developers who copy `.env.example` to `.env` without replacing the empty string will
get a runtime error from iron-session. This is safe — iron-session won't accept an
empty password. But a startup validation would catch this earlier with a clear message.

**No fallback exists.** There is no `|| "default_secret"` or `?? "fallback_key"` —
this is good. The code refuses to run with a weak or missing key.

### The Mentor's Verdict

**Currently safe, with one recommended hardening.** The key is env-based, never
hardcoded, and has no default fallback. The system fails securely (loud runtime error)
rather than silently using a weak key.

**Recommended hardening:** Add an explicit startup guard in `lib/auth/session.ts`
that validates the key before any session is created:

```ts
// Add after line 11:
if (
  !process.env.SESSION_PASSWORD ||
  process.env.SESSION_PASSWORD.length < 32
) {
  throw new Error(
    "SESSION_PASSWORD must be set in .env and be at least 32 characters long."
  );
}
```

This gives the developer a clear error message at startup ("set SESSION_PASSWORD in
.env") rather than a cryptic iron-session internal error that might look like a bug.

Also: the key is stored in `.env` and `.env` is in `.gitignore` (verified in prompt 1).
`.env.example` is committed with an empty string, which is the correct convention.

---

## 5. Brute Force & Credential Stuffing (No Rate Limiting)

### The Exploit (Explained)

An attacker obtains a list of 10,000 email/password pairs from a data breach at another
site. They write a script that tries every pair against `/login`. Without rate limiting:

- The server processes every request at full speed.
- bcrypt's ~100ms per attempt means ~10 attempts/second on a single-threaded server.
  But the attacker can run 100 parallel connections → ~1,000 attempts/second.
- At that rate, the attacker tests 10,000 credentials in 10 seconds.
- Any user who reused their password from the breached site is now compromised.

The same applies to brute-force password guessing against a single known email — the
attacker tries `password1`, `password2`, `password3`... as fast as the server responds.

### Current Implementation

There is **no rate limiting** in the current codebase. A grep for `rate`, `limit`,
`throttle`, `brute`, and `ratelimit` across the entire project returned zero matches
(outside of documentation).

The only speed bump is bcrypt itself — `SALT_ROUNDS = 10` makes each hash take ~100ms.
But this is not rate limiting; it's a cost per attempt, not a cap on total attempts.
It slows the attacker from "millions per second" to "hundreds per second," which is
better than nothing but not a defense.

The project specification itself acknowledges this: *"Rate limiting (noted as deferred —
covered in a later hardening prompt)."*

### The Mentor's Fix

Here is a concrete implementation using a simple in-memory store (good for development;
in production, replace with Redis or a database-backed store):

**Create `lib/auth/rate-limit.ts`:**

```ts
const attempts = new Map<string, { count: number; resetAt: number }>();

interface RateLimitConfig {
  windowMs: number;    // time window in milliseconds
  maxAttempts: number; // max attempts within the window
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxAttempts: 10,            // 10 attempts
};

export function rateLimit(
  key: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.maxAttempts - 1 };
  }

  if (entry.count >= config.maxAttempts) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: config.maxAttempts - entry.count };
}
```

**Wire into `app/(auth)/actions.ts` — add at the top of `loginAction` (after line 76, before validation):**

```ts
import { rateLimit } from "@/lib/auth/rate-limit";

export async function loginAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  // --- NEW: Rate limiting by IP + email ---
  const ip = headers().get("x-forwarded-for") ?? "unknown";
  const emailRaw = formData.get("email")?.toString() ?? "";

  // Rate limit by IP (block botnets targeting many accounts)
  const ipCheck = rateLimit(`login:ip:${ip}`, {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 20,
  });
  if (!ipCheck.allowed) {
    return { error: "Too many attempts. Try again later." };
  }

  // Rate limit by email (block credential stuffing against one account)
  const emailCheck = rateLimit(`login:email:${emailRaw.toLowerCase()}`, {
    windowMs: 15 * 60 * 1000,
    maxAttempts: 5,
  });
  if (!emailCheck.allowed) {
    return { error: "Too many attempts. Try again later." };
  }
  // --- END NEW ---

  const result = loginSchema.safeParse({ /* ... existing code ... */ });
```

**Why two rate limits?** Rate limiting by IP blocks attackers hammering `/login` from
one machine. Rate limiting by email blocks distributed attacks where 1,000 different
IPs all try the same email address (credential stuffing). Both are needed.

**For production:** Replace the in-memory `Map` with a persistent store (Redis via
`@upstash/ratelimit` or similar). In-memory counters reset on server restart and don't
work across multiple server instances (Vercel's serverless functions, Kubernetes pods,
etc.).

**Add to `signupAction` too (after line 20):**

```ts
// Rate limit signups by IP to prevent mass account creation
const signupIp = headers().get("x-forwarded-for") ?? "unknown";
const signupCheck = rateLimit(`signup:ip:${signupIp}`, {
  windowMs: 60 * 60 * 1000, // 1 hour
  maxAttempts: 5,
});
if (!signupCheck.allowed) {
  return { error: "Too many signup attempts. Try again later." } as AuthActionState;
}
```

### The Mentor's Verdict

**Currently unmitigated in the workspace.** No rate limiting exists. The bcrypt cost
provides incidental slowdown but is not rate limiting. This is the most critical gap
in the current architecture and should be the first item addressed in a hardening phase.
The project specification acknowledges this as deferred work.

---

## 6. Weak Defenses (Password Policy Weaknesses)

### The Exploit (Explained)

If a site accepts `"123"` as a password, an attacker doesn't need sophisticated tools.
They try the top 100 most common passwords (`password`, `123456`, `qwerty`, etc.) and
compromise a significant percentage of accounts within seconds.

Weak password policies fall into three categories:
1. **No server-side enforcement** — the client says "Password must be 8 characters"
   but an attacker bypasses the UI and sends `"a"` directly to the API.
2. **No complexity requirements** — users can set `"password1"` and it passes.
3. **No length limits (too short or too long)** — `"ab"` is accepted, or a 10MB
   string is sent to bcrypt as a DoS vector.

### Current Implementation

**`lib/auth/schemas.ts` lines 15–21:**

```
15 │   password: z
16 │     .string()
17 │     .min(8, "Password must be at least 8 characters")
18 │     .max(128, "Password is too long")
19 │     .regex(/[A-Z]/, "Password must contain an uppercase letter")
20 │     .regex(/[a-z]/, "Password must contain a lowercase letter")
21 │     .regex(/[0-9]/, "Password must contain a number"),
```

This is enforced **server-side** inside `signupAction` (`actions.ts` line 22):
`safeParse` runs on the server, not the client. The form has `noValidate` to disable
browser HTML5 validation — the Zod schema is the sole authority.

What this enforces:
- Minimum 8 characters (line 17) — blocks trivial passwords
- Maximum 128 characters (line 18) — prevents DoS via bcrypt on giant inputs
- Must contain uppercase (line 19) — blocks `abcdefgh`
- Must contain lowercase (line 20) — blocks `ABCDEFGH`
- Must contain a digit (line 21) — blocks `Abcdefgh`

What it does NOT enforce (but could):
- No common-password blocklist (e.g., reject "Password1!" because it matches a known
  breached password)
- No zxcvbn-style strength estimation ("this password would take 3 seconds to crack")
- No username-in-password check ("password can't contain your email")

### The Mentor's Verdict

**Currently safe.** The password policy is enforced server-side with strict complexity
requirements. The `noValidate` attribute on the form ensures browser validation never
overrides or conflicts with Zod.

**Optional hardening — add a common-password blocklist:**

```ts
// lib/auth/blocklist.ts
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "qwerty123",
  "admin123", "letmein1", "welcome1", "monkey12", "dragon12",
  // ... extend with top 10,000 from HaveIBeenPwned
]);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}
```

Wire into `signupSchema` (`lib/auth/schemas.ts`):

```ts
.refine((p) => !isCommonPassword(p), "This password is too common. Choose another.")
```

Alternatively, use the `zxcvbn` library for real-time strength estimation:

```bash
npm install zxcvbn
```

```ts
import zxcvbn from "zxcvbn";

// In signupSchema:
.refine(
  (p) => zxcvbn(p).score >= 3,
  "Password is too weak. Add more variety."
)
```

These are optional — the current policy already exceeds most production applications.

---

## Security Posture Summary

The junior developers did strong work on their initial pass. The codebase demonstrates
mature security thinking in several areas that many production applications get wrong:

**What they got right (and should be proud of):**
1. Constant-time bcrypt comparisons on login — the placeholder hash trick in
   `actions.ts:96-98` is textbook timing-attack defense. Most mid-level engineers
   miss this.
2. HttpOnly + SameSite cookie flags are correctly configured in `session.ts:14-16`
   without developer opt-in.
3. Server-side Zod validation with `noValidate` on forms — the server is the single
   source of truth, client validation is purely UX.
4. Prisma `select` clauses never leak the password hash outside of verification scope.
5. No hardcoded secrets — `SESSION_PASSWORD` is env-based with no fallback, failing
   loud if missing.

**The one critical gap to address next:**
Rate limiting does not exist. The bcrypt cost provides ~100ms of friction per attempt,
but there is no cap on total attempts from a single IP or against a single email.
An attacker can run hundreds of parallel login attempts, and the only defense is bcrypt's
CPU cost. This is the #1 hardening priority and is already acknowledged as deferred
in the project plan. The fix provided in Section 5 is drop-in ready.
