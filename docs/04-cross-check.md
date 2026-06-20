# Security Cross-Check & Adversarial Audit Comparison

An adversarial, deeply skeptical re-examination of Dashvault's authentication and
session management pipelines. This audit was executed independently before reading
`docs/03-audit.md`, then cross-referenced to expose blindspots.

**Audit Scope:** `lib/auth/*`, `app/(auth)/actions.ts`, `app/(auth)/**`, `app/dashboard/page.tsx`,
`prisma/schema.prisma`, `lib/db.ts`, `.env`, `.env.example`, `.gitignore`, `next.config.ts`,
`package.json`

---

## 1. Deeper Cryptographic & Architectural Vulnerabilities

### Vector A: Session Fixation — No Cookie Regeneration on Privilege Escalation

* **Technical Risk:** High
* **Deep Analysis:**

When a user logs in via `loginAction` (`app/(auth)/actions.ts` lines 106–110), the
code writes user data into the *existing* iron-session cookie:

```
106 │   const session = await getSession();
107 │   session.userId = user.id;
108 │   session.email = user.email;
109 │   session.name = user.name;
110 │   await session.save();
```

The problem: `getSession()` retrieves whatever cookie already exists (even an
anonymous/empty one). The session **identifier is never regenerated**. This means
the same encrypted cookie blob that existed *before* authentication is now upgraded
to carry authenticated session data.

In a classic session fixation attack:
1. Attacker obtains an unauthenticated session cookie value by visiting the site.
2. Attacker injects this cookie value into the victim's browser (via XSS, a
   subdomain cookie, or a man-in-the-middle on first HTTP request).
3. Victim logs in. The server upgrades *that same cookie* with the victim's
   `userId`, `email`, and `name`.
4. Attacker uses the same cookie value — now it carries the victim's session.

**Mitigating factor:** iron-session encrypts and seals cookies with `SESSION_PASSWORD`,
so the attacker cannot *read* or *forge* the cookie contents. The cookie value
changes on every `session.save()` because iron-session re-encrypts the full payload.
This makes classical fixation mostly theoretical here — the encrypted blob post-login
is a completely different ciphertext than pre-login.

However, the **correct architectural pattern** is to explicitly destroy and recreate
the session on privilege escalation, providing defense-in-depth:

* **The Remediated Code:**

```ts
// app/(auth)/actions.ts — loginAction, replace lines 106–110
const session = await getSession();
session.destroy();                      // kill the old session entirely

const freshSession = await getSession(); // new empty session
freshSession.userId = user.id;
freshSession.email = user.email;
freshSession.name = user.name;
await freshSession.save();              // sealed under a new encryption nonce
```

Apply the same pattern to `signupAction` (lines 65–69):

```ts
const session = await getSession();
session.destroy();

const freshSession = await getSession();
freshSession.userId = user.id;
freshSession.email = user.email;
freshSession.name = user.name;
await freshSession.save();
```

---

### Vector B: No Next.js Edge Middleware — Auth Enforced Only at Render Time

* **Technical Risk:** High
* **Deep Analysis:**

The project has **zero** Next.js edge middleware files. A `find` for `middleware.ts`
at the project root (`dashvault/middleware.ts`) returned zero results. The only
"middleware" is `lib/auth/middleware.ts`, which exports `requireAuth()` and
`requireGuest()` — these are plain async functions called *inside* Server Components
and Server Actions, not Next.js Middleware.

This means authentication is enforced **at render time inside each page**, not at
the routing/edge layer. The consequences:

1. **Any new route is unprotected by default.** A developer adding
   `app/dashboard/settings/page.tsx` who forgets to call `requireAuth()` at the
   top of that component exposes an unauthenticated route. There is no fail-closed
   routing layer.

2. **Static assets and API routes are unprotected.** If someone adds a
   `app/api/accounts/route.ts` handler, it will be fully accessible without
   authentication unless the developer manually imports and calls `requireAuth()`.

3. **Layout-level guards don't protect nested route segments loaded via parallel
   routes or intercepting routes.** The `(auth)/layout.tsx` calls `requireGuest()`,
   but `dashboard/page.tsx` calls `requireAuth()` directly — there is no
   `dashboard/layout.tsx` acting as a catch-all guard.

* **The Remediated Code:**

Create a proper Next.js Edge Middleware at the project root:

```ts
// dashvault/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session/edge";
import { sessionOptions, SessionData } from "@/lib/auth/session";

const PROTECTED_ROUTES = ["/dashboard"];
const GUEST_ONLY_ROUTES = ["/login", "/signup"];

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);

  const { pathname } = req.nextUrl;

  // Protected routes: redirect to /login if not authenticated
  if (PROTECTED_ROUTES.some((r) => pathname.startsWith(r))) {
    if (!session.userId) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
  }

  // Guest-only routes: redirect to /dashboard if already authenticated
  if (GUEST_ONLY_ROUTES.some((r) => pathname.startsWith(r))) {
    if (session.userId) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup"],
};
```

This creates a **fail-closed** perimeter: every route under `/dashboard` is
automatically protected without developer opt-in per page.

---

### Vector C: Wasted CPU — Bcrypt Hash Computed Before Duplicate-Email Short-Circuit

* **Technical Risk:** Medium (DoS amplification vector)
* **Deep Analysis:**

In `signupAction` (`app/(auth)/actions.ts` lines 41–54):

```
41 │   const existingUser = await prisma.user.findUnique({
42 │     where: { email },
43 │     select: { id: true },
44 │   });
45 │
46 │   const passwordHash = await hashPassword(password);  // ~100ms bcrypt
47 │
48 │   if (existingUser) {
49 │     return {                                           // hash is WASTED
50 │       fieldErrors: {
51 │         email: "An account with this email already exists.",
52 │       },
53 │     };
54 │   }
```

`hashPassword(password)` on line 46 runs `bcrypt.hash` with 10 salt rounds (~100ms
CPU per call). If the email already exists (`existingUser` is truthy on line 48), the
computed hash is **thrown away** — it was created for nothing.

`docs/03-audit.md` lauded this as a timing-attack mitigation: *"Whether the email
exists or not, bcrypt.hash burns ~100ms. The response time is the same in both cases.
SAFE."*

This is a **false equivalence**. The timing-attack defense is only needed on the
**login** path (where knowing if an email exists is useful for enumeration). On
the **signup** path, the response already leaks whether the email exists via the
`"An account with this email already exists."` message on line 51. The timing
equalization serves no security purpose here — it only wastes ~100ms of server CPU
on every duplicate signup attempt.

An attacker can exploit this as a **computational DoS amplifier**: send thousands of
signup requests for `admin@dashvault.com` (a known-existing email). Each request
burns ~100ms of server CPU on a bcrypt hash that is immediately discarded. This is
strictly **worse** than the login path, where at least the bcrypt serves the real
purpose of verifying the password.

* **The Remediated Code:**

```ts
// app/(auth)/actions.ts — signupAction, reorder lines 41–54
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

// Only burn CPU on bcrypt AFTER confirming the email is fresh
const passwordHash = await hashPassword(password);
```

If you still want timing equalization on signup (to hide email enumeration), the
correct fix is to **remove the explicit error message** and return a generic response
regardless, NOT to burn CPU:

```ts
if (existingUser) {
  return {
    error: "Check your inbox. If this email is registered, you'll receive a confirmation.",
  };
}
```

---

### Vector D: Overly Long Session Lifetime With No Absolute Timeout or Idle Timeout

* **Technical Risk:** Medium
* **Deep Analysis:**

In `lib/auth/session.ts` line 17:

```
17 │     maxAge: 60 * 60 * 24 * 7, // 7 days
```

The session cookie lives for 7 days. There is no:

1. **Idle timeout** — if a user logs in and never uses the app again, the session
   remains valid for 7 full days. If the cookie is stolen during that window (via
   network sniffing before HSTS kicks in, or via a compromised shared computer),
   the attacker has a week-long access window.

2. **Absolute timeout** — the 7-day window is a *sliding* window based on when the
   cookie was set. There is no mechanism to force re-authentication after a maximum
   lifetime (e.g., 24 hours). A session that was created 6.9 days ago (just under
   the limit) is treated identically to one created 5 minutes ago.

3. **Session activity tracking** — the `SessionData` interface (`session.ts`
   lines 4–8) stores only `userId`, `email`, and `name`. There is no `createdAt`
   or `lastActiveAt` timestamp, making it impossible to implement server-side
   timeout logic without modifying the session schema.

For a **financial application** (Dashvault stores bank account balances in
`Account.balanceCents`), OWASP recommends a maximum session lifetime of **15–30
minutes** for sensitive applications, and an absolute maximum of **4–8 hours**.
7 days is **an order of magnitude too long**.

* **The Remediated Code:**

```ts
// lib/auth/session.ts — enhanced SessionData and options
export interface SessionData {
  userId?: string;
  email?: string;
  name?: string;
  createdAt?: number;   // Unix timestamp (ms) when session was first created
  lastActiveAt?: number; // Unix timestamp (ms) of last authenticated request
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_PASSWORD as string,
  cookieName: "dashvault_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 hours max cookie lifetime (browser-enforced)
    path: "/",
  },
};

const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;  // 8 hours
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;           // 30 minutes

export async function getValidatedSession() {
  const session = await getSession();
  if (!session.userId) return session;

  const now = Date.now();

  // Absolute timeout: force re-auth after 8 hours regardless of activity
  if (session.createdAt && now - session.createdAt > ABSOLUTE_TIMEOUT_MS) {
    session.destroy();
    return await getSession(); // return empty session
  }

  // Idle timeout: force re-auth after 30 minutes of inactivity
  if (session.lastActiveAt && now - session.lastActiveAt > IDLE_TIMEOUT_MS) {
    session.destroy();
    return await getSession();
  }

  // Update last-active timestamp
  session.lastActiveAt = now;
  await session.save();
  return session;
}
```

Update `loginAction` and `signupAction` to set `createdAt`:

```ts
freshSession.createdAt = Date.now();
freshSession.lastActiveAt = Date.now();
```

Update `requireAuth()` in `lib/auth/middleware.ts` to use `getValidatedSession()`
instead of `getSession()`.

---

### Vector E: Prisma Query Logging Leaks Sensitive Data in Development

* **Technical Risk:** Medium
* **Deep Analysis:**

In `lib/db.ts` line 12:

```
12 │     log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
```

With `log: ["query"]` enabled, Prisma logs every SQL query and its parameters to
`stdout`. This includes:

```sql
prisma:query SELECT "User"."id", "User"."email", "User"."name", "User"."password"
  FROM "User" WHERE "User"."email" = 'alice@example.com'
```

The **bcrypt password hash** is included in the `SELECT` result and is logged to the
terminal. In the `loginAction` path, `prisma.user.findUnique` selects
`{ id, email, name, password }` (`actions.ts` line 93) — so the full bcrypt hash
appears in development logs.

If these logs are captured by a logging service (Vercel's function logs, a Docker
log driver, or `npm run dev > app.log`), they become a persistent record of password
hashes alongside their associated emails.

* **The Remediated Code:**

```ts
// lib/db.ts — remove "query" from dev logging or use event-based redaction
function createPrismaClient() {
  const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL! });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development"
      ? ["error", "warn"]        // remove "query" — never log raw SQL params
      : ["error"],
  });
}
```

If you need query logging for development debugging, use Prisma's event-based
logging with a custom handler that redacts the `password` column:

```ts
const client = new PrismaClient({
  adapter,
  log: [{ level: "query", emit: "event" }, "error", "warn"],
});

client.$on("query", (e) => {
  // Redact any param that looks like a bcrypt hash
  const sanitized = e.params.replace(/\$2[aby]\$\d+\$[./A-Za-z0-9]{53}/g, "[REDACTED_HASH]");
  console.log(`prisma:query ${e.query} — params: ${sanitized} — duration: ${e.duration}ms`);
});
```

---

### Vector F: Missing `SESSION_PASSWORD` Length Validation — Silent Cryptographic Weakening

* **Technical Risk:** Medium
* **Deep Analysis:**

In `lib/auth/session.ts` line 11:

```ts
password: process.env.SESSION_PASSWORD as string,
```

iron-session v8 requires the password to be at least 32 characters. If the `.env`
contains a password shorter than 32 characters, iron-session will throw at runtime.
But there is no application-level validation that catches this **before** the first
session operation, which could happen deep inside a request handler and produce a
confusing 500 error.

More critically: there is no validation that the password has sufficient *entropy*.
A developer could set `SESSION_PASSWORD="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"` (34
`a` characters) — it passes iron-session's length check but has near-zero entropy.

The `.env.example` file contains `SESSION_PASSWORD=""` with **no guidance** on how
to generate a cryptographically secure value. A developer unfamiliar with key
generation might set something like `SESSION_PASSWORD="mysupersecretpassword12345678"`.

* **The Remediated Code:**

```ts
// lib/auth/session.ts — add startup validation
const sessionPassword = process.env.SESSION_PASSWORD;

if (!sessionPassword || sessionPassword.length < 32) {
  throw new Error(
    `[FATAL] SESSION_PASSWORD must be at least 32 characters.\n` +
    `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
  );
}

// Entropy check: reject obviously low-entropy passwords
const uniqueChars = new Set(sessionPassword).size;
if (uniqueChars < 10) {
  throw new Error(
    `[FATAL] SESSION_PASSWORD has too little entropy (${uniqueChars} unique chars).\n` +
    `Generate a proper key with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
  );
}

export const sessionOptions: SessionOptions = {
  password: sessionPassword,
  // ...rest
};
```

Update `.env.example` with generation instructions:

```env
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
SESSION_PASSWORD=""
```

---

### Vector G: No Account Lockout After Repeated Failed Logins

* **Technical Risk:** Medium
* **Deep Analysis:**

`docs/03-audit.md` Section 5 correctly identified the lack of rate limiting. But it
proposed **only network-level rate limiting** (by IP and by email, using an in-memory
`Map`). This misses the complementary control: **account-level lockout**.

Rate limiting by IP is trivially bypassed by an attacker using a botnet or rotating
proxies. Rate limiting by email alone (as proposed in `03-audit.md` line 376) limits
attempts to 5 per 15 minutes — but an attacker can simply wait or use a slow,
persistent attack spread across days.

There is no `failedLoginAttempts` or `lockedUntil` field on the `User` model in
`schema.prisma`. An attacker who knows a valid email can try passwords indefinitely
over time without ever triggering any lockout.

* **The Remediated Code:**

Add to `prisma/schema.prisma`:

```prisma
model User {
  id                 String   @id @default(cuid())
  email              String   @unique
  name               String
  password           String
  failedLoginAttempts Int      @default(0)
  lockedUntil        DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  accounts  Account[]
  @@index([email])
}
```

Update `loginAction` in `app/(auth)/actions.ts`:

```ts
const user = await prisma.user.findUnique({
  where: { email },
  select: { id: true, email: true, name: true, password: true,
            failedLoginAttempts: true, lockedUntil: true },
});

// Check lockout BEFORE running bcrypt
if (user?.lockedUntil && user.lockedUntil > new Date()) {
  return { error: "Account temporarily locked. Try again later." };
}

const passwordOk = user
  ? await verifyPassword(password, user.password)
  : await verifyPassword(password, "$2a$10$invalidplaceholderhashstringfortimingatk");

if (!user || !passwordOk) {
  // Increment failed attempts
  if (user) {
    const attempts = user.failedLoginAttempts + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: attempts >= 5
          ? new Date(Date.now() + 15 * 60 * 1000) // lock for 15 min
          : null,
      },
    });
  }
  return { error: "Invalid email or password." };
}

// On successful login, reset the counter
await prisma.user.update({
  where: { id: user.id },
  data: { failedLoginAttempts: 0, lockedUntil: null },
});
```

---

### Vector H: `logoutAction` Lacks CSRF-Resistant Invocation Pattern

* **Technical Risk:** Low
* **Deep Analysis:**

In `app/dashboard/page.tsx` lines 14–21:

```tsx
<form action={logoutAction}>
  <button type="submit" ...>Log out</button>
</form>
```

The `logoutAction` server action (`actions.ts` lines 115–119):

```ts
export async function logoutAction() {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}
```

This is technically protected by Next.js Server Actions' built-in CSRF tokens.
However, `logoutAction` **takes no arguments and performs no validation** — it is a
fire-and-forget action with no confirmation. While Server Actions embed CSRF tokens
automatically, a logout-CSRF attack (tricking a user's browser into calling the
logout endpoint) would succeed in forcing the user to log out.

This is classified as Low risk because the impact is merely annoyance (forced
logout), not data theft. But for a financial application, unexpected forced logout
could be used as part of a phishing workflow: force logout → redirect user to a
fake login page that captures credentials.

* **The Remediated Code:**

No code change strictly required. For hardening, add `sameSite: "strict"` to the
cookie (preventing the cookie from being sent on any cross-site navigation) or add
a confirmation step before logout.

---

## 2. Comparative Analysis (Reviewing docs/03-audit.md)

### 🛡️ Verified Vulnerabilities (Where Both Audits Agree)

1. **No Rate Limiting (03-audit §5):** Both audits identify the complete absence of
   rate limiting as the most critical operational gap. `03-audit.md` correctly notes
   zero grep matches for `rate`, `limit`, or `throttle` and provides a concrete
   in-memory rate limiter implementation. This cross-check concurs and extends the
   finding with account-level lockout (Vector G above).

2. **Cookie Flags Are Correctly Set (03-audit §2):** Both audits confirm `httpOnly:
   true`, `secure: process.env.NODE_ENV === "production"`, and `sameSite: "lax"` in
   `session.ts` lines 13–19. This cross-check agrees these are correctly configured.

3. **Timing-Attack Mitigation on Login (03-audit §1):** Both audits confirm the
   placeholder hash trick on `actions.ts` line 98 successfully equalizes response
   times on the login path. This cross-check concurs this is sound.

4. **CSRF Protection via Server Actions (03-audit §3):** Both audits confirm that
   Next.js Server Actions provide automatic CSRF token generation and validation.
   This cross-check confirms no traditional Route Handlers (`route.ts`) exist that
   would bypass this protection.

5. **No Hardcoded Session Secret (03-audit §4):** Both audits confirm
   `SESSION_PASSWORD` is read from `process.env` with no fallback, and `.env` is
   correctly excluded from git via `.gitignore` line 34. This cross-check verified
   `.env` was never committed to git history.

---

### 🔍 Blindspots Uncovered (What Audit 03 Completely Missed)

#### Blindspot 1: No Next.js Edge Middleware — Fail-Open Routing Architecture

* **Under-the-Radar Exploit:** The entire authentication perimeter relies on
  individual Server Components calling `requireAuth()`. Any new route added without
  this call is silently unprotected. There is no fail-closed routing layer.

* **Why It Was Missed:** `03-audit.md` focused exclusively on the session cookie and
  Server Action mechanics — the "data in flight" layer. It never examined the
  "routing architecture" layer: *how* do requests reach protected pages, and what
  happens when a developer forgets to add the auth check? Checklist-style audits
  verify what IS protected; architectural audits verify what ISN'T.

* **Exploit Scenario:**
  1. A developer adds `app/dashboard/settings/page.tsx` for account management.
  2. They forget to add `await requireAuth()` at the top (easy to miss — it's not
     enforced by TypeScript or linting).
  3. An unauthenticated attacker navigates to `/dashboard/settings` and accesses
     account data without logging in.
  4. There is no middleware to intercept the request before it reaches the component.

#### Blindspot 2: Wasted Bcrypt CPU on Signup Misidentified as a Security Feature

* **Under-the-Radar Exploit:** `03-audit.md` Section 1 explicitly praises the
  `signupAction`'s early bcrypt hash (line 46) as a timing-attack defense: *"Whether
  the email exists or not, bcrypt.hash burns ~100ms. SAFE."* But the signup response
  on line 51 **already reveals whether the email exists** via the error message
  `"An account with this email already exists."` The timing equalization is pointless
  when the response body directly leaks the information.

* **Why It Was Missed:** The first audit applied a pattern match: "Does bcrypt run in
  both branches? Yes → timing safe." It never asked the deeper question: "Is timing
  equalization even *necessary* here, given that the response already leaks the
  answer?" This is a classic case of cargo-cult security — copying a defense from
  one context (login) where it's needed, to another context (signup) where it serves
  no purpose but creates a DoS amplification vector.

* **Exploit Scenario:**
  1. Attacker discovers `admin@dashvault.com` exists (the signup error message tells
     them directly — no timing analysis needed).
  2. Attacker scripts 10,000 concurrent signup requests for `admin@dashvault.com`.
  3. Each request burns ~100ms of server CPU on `bcrypt.hash` that is immediately
     discarded (the email already exists, so the hash is never stored).
  4. At 100 concurrent connections, the server is burning 10 CPU-seconds per second
     on useless bcrypt operations. This starves legitimate users of CPU resources
     for login and signup.

#### Blindspot 3: 7-Day Session Lifetime With No Idle or Absolute Timeout

* **Under-the-Radar Exploit:** `03-audit.md` Section 2 noted `maxAge: 7 days` and
  called it "Expires, not permanent." It never questioned whether 7 days is
  appropriate for a **financial application** that stores bank account balances.

* **Why It Was Missed:** The first audit used a binary checklist: "Is maxAge finite?
  Yes → SAFE." It did not apply domain-specific risk analysis. OWASP's session
  management cheatsheet recommends 15–30 minute idle timeouts and 4–8 hour absolute
  timeouts for applications handling financial data. The 7-day window is 50x–600x
  longer than recommended.

* **Exploit Scenario:**
  1. User logs into Dashvault on a shared/public computer at a library.
  2. User closes the browser tab but does not explicitly log out.
  3. The session cookie persists for 7 days (iron-session sets a persistent cookie
     with `maxAge`, not a session cookie that dies when the browser closes).
  4. Next user opens Chrome, navigates to Dashvault → they're logged in as the
     previous user for the remaining days of the session.

#### Blindspot 4: Prisma Query Logging Exposes Password Hashes in Development

* **Under-the-Radar Exploit:** `03-audit.md` never examined `lib/db.ts`. The Prisma
  client logs every SQL query and its parameters (including selected `password`
  hashes) to stdout when `NODE_ENV === "development"`.

* **Why It Was Missed:** The first audit scoped itself to `lib/auth/*` and
  `app/(auth)/*`. It never examined the database client configuration in `lib/db.ts`.
  Security audits that scope by directory structure rather than by data flow will
  always miss cross-cutting concerns like logging.

* **Exploit Scenario:**
  1. Developer runs `npm run dev` (confirmed running in the project — see terminal
     output).
  2. Every login attempt logs the SQL query including the user's bcrypt hash.
  3. If development logs are forwarded to a centralized logging service (Datadog,
     Vercel Function Logs, etc.), password hashes are now stored in plaintext in
     the logging infrastructure.
  4. A breach of the logging service gives the attacker email + bcrypt hash pairs
     for offline cracking.

#### Blindspot 5: Session Data Contains Email and Name But No Session Metadata

* **Under-the-Radar Exploit:** The `SessionData` interface
  (`lib/auth/session.ts` lines 4–8) stores `userId`, `email`, and `name` but no
  `createdAt`, `lastActiveAt`, or `issuedFromIp`. This makes it impossible to
  implement server-side session timeout, detect session theft across IPs, or audit
  session activity.

* **Why It Was Missed:** The first audit focused on the session *encryption* and
  *cookie flags* — how the session is protected in transit. It never examined the
  session *data model* — what information is stored inside the session and what
  server-side controls are possible with that data.

* **Exploit Scenario:**
  1. User's session cookie is intercepted (e.g., via a browser extension or XSS).
  2. Attacker replays the cookie from a different IP, country, and user-agent.
  3. The server has no metadata to detect that this session is being used from a
     wildly different context than where it was created.
  4. The session remains valid for the full 7-day window with no challenge or
     re-authentication prompt.

---

## 3. Definitive Trust Declaration & Verdict

### Which Audit is More Trustworthy?

**Winner:** `docs/04-cross-check.md`

### The Reasoning

`docs/03-audit.md` is a well-written, pedagogically valuable document that correctly
identifies surface-level security properties of the cookie configuration, CSRF
protection, and timing-attack mitigation. It functions well as a teaching tool and
introductory security review. However, it operates as a **property checklist**: "Is
`httpOnly` set? Yes. Is `sameSite` set? Yes. Is the secret env-based? Yes." Each
finding is evaluated in isolation against a known good/bad binary. This approach
correctly identifies the **presence** of defenses but fundamentally cannot identify
the **absence** of entire defense categories. It missed five critical architectural
blindspots because they cannot be found by inspecting property values — they require
analyzing data flow, state transitions, deployment architecture, and
domain-appropriate threat models (financial application vs. social media vs. blog).

This cross-check (`docs/04-cross-check.md`) operates at the **architectural and
state-machine level**. Rather than checking "is the cookie flag set?", it asks "when
a user's privilege level changes from anonymous to authenticated, does the session
state machine transition correctly?" Rather than checking "is the secret in an env
var?", it asks "can a developer deploy a cryptographically weak secret that passes
all existing runtime checks?" Rather than checking "is Prisma configured correctly?",
it traces the password hash from database → Prisma select → query log → stdout and
asks "where else does this sensitive value appear outside the intended verification
scope?" These are the questions that reveal systemic vulnerabilities — the kind that
survive code reviews, pass CI/CD pipelines, and remain dormant until an attacker maps
the full attack surface rather than probing individual endpoints.
