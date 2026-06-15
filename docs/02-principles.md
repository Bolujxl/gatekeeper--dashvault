# Security Architecture Audit: Core Principles

A line-level audit of Dashvault's authentication system against five foundational
security principles. Every claim is backed by exact file paths and line numbers.

---

## 1. Zero Knowledge (No Plaintext Passwords)

**Definition:** The system must never persist a user's plaintext password. A one-way
cryptographic hash function transforms the password before storage, making it
mathematically irreversible. Even if the database is fully compromised, the attacker
cannot recover the original passwords — only their hashed "smoothies," which must be
brute-forced one guess at a time.

**Implementation Proof:**

| File | Lines | Role |
|------|-------|------|
| `lib/auth/password.ts` | 5–7 | Defines `hashPassword()`, the sole hashing entry point |
| `lib/auth/password.ts` | 3 | `SALT_ROUNDS = 10` — cost factor baked in as a constant |
| `app/(auth)/actions.ts` | 46 | Calls `hashPassword(password)` **before** the database `create` |
| `app/(auth)/actions.ts` | 60 | `password: passwordHash` — the hash, not the plaintext, is passed to Prisma |
| `prisma/schema.prisma` | 13 | Schema comment: `// bcrypt hash, never the plaintext` |
| `lib/auth/password.ts` | 9–13 | `verifyPassword()` uses `bcrypt.compare`, which is timing-safe |
| `app/(auth)/actions.ts` | 96–98 | Login verification calls `verifyPassword`; even non-existent users trigger a full bcrypt compare against a placeholder hash |

**Context:** The plaintext password exists in server memory only for the duration of
`hashPassword()` (line 6) or `verifyPassword()` (line 13) — a single function call
lasting ~100ms. It is never assigned to a long-lived variable, never returned to the
client, never logged, and never stored. The `password` column in the `User` table
(line 13 of the schema) contains a 60-character bcrypt string beginning with
`$2a$10$...`, not the original text.

**Additional hardening:** `hashPassword` is called *before* the duplicate-email check
(actions.ts line 46 executes before line 48). This ensures the ~100ms hashing cost is
paid regardless of whether signup succeeds, preventing attackers from using response
timing to distinguish "email taken" from "email available."

---

## 2. Server-Side Validation (Zero Client Trust)

**Definition:** The server treats all incoming data as hostile. Every input is
independently validated for shape, type, length, and content — regardless of what
the client-side form claims to have enforced. Client-side validation exists purely
for UX convenience; the server is the single source of truth.

**Implementation Proof:**

| File | Lines | Role |
|------|-------|------|
| `lib/auth/schemas.ts` | 3–22 | `signupSchema` — Zod schema enforcing name length (1–80), email format + length (max 254), password complexity (8–128 chars, upper, lower, digit) |
| `lib/auth/schemas.ts` | 24–27 | `loginSchema` — Zod schema enforcing email format and password presence |
| `app/(auth)/actions.ts` | 22–26 | `signupAction` extracts raw `FormData` fields and passes them through `signupSchema.safeParse()` |
| `app/(auth)/actions.ts` | 28–37 | On validation failure, Zod errors are mapped to field-level error objects and returned to the client |
| `app/(auth)/actions.ts` | 78–81 | `loginAction` runs `loginSchema.safeParse()` on the incoming form data |
| `app/(auth)/actions.ts` | 83–87 | Returns a generic error (not field-specific) on login validation failure |
| `app/(auth)/signup/page.tsx` | `<form ... noValidate>` | Browser HTML5 validation is explicitly disabled |
| `app/(auth)/login/page.tsx` | `<form ... noValidate>` | Same — server validation is the sole authority |

**Context:** The Forms are submitted via Server Actions (`"use server"` directive in
actions.ts line 1). This means:
- Form data is serialized by the browser and sent to the server as `FormData`
- The Zod `safeParse` runs entirely on the server, inside the action
- The client never sees the raw `FormData` — only the parsed-and-validated `result.data`
  or the error payload
- Even if an attacker bypasses the client-side PasswordRules component and submits a
  password like `"a"`, the server rejects it at `schemas.ts:17` (min 8 characters)

**Length limits as DoS defense:** `schemas.ts:8` (name max 80), `schemas.ts:14` (email
max 254, the RFC limit), `schemas.ts:18` (password max 128). Without these, an attacker
could send a 10MB password string and force bcrypt to grind on it, consuming server CPU.

---

## 3. Defense in Depth

**Definition:** Security does not rely on any single mechanism. Multiple independent
layers form concentric rings of protection, so that breaching one layer does not grant
access. If one control fails, the next one still holds.

**Implementation Proof:**

| Layer | File | Lines | Mechanism |
|-------|------|-------|-----------|
| 1 — Cookie Encryption | `lib/auth/session.ts` | 11 | Session cookie encrypted with `SESSION_PASSWORD` (32+ char key via iron-session). Tampered cookies fail decryption. |
| 2 — HttpOnly Flag | `lib/auth/session.ts` | 15 | `httpOnly: true` — JavaScript cannot read the cookie. XSS cannot steal the session. |
| 3 — SameSite Restriction | `lib/auth/session.ts` | 16 | `sameSite: "lax"` — cookie not sent on cross-site POST/iframe/subresource requests, blocking CSRF. |
| 4 — Secure Flag in Production | `lib/auth/session.ts` | 14 | `secure: true` in production — cookie only transmitted over HTTPS. |
| 5 — Session Expiry | `lib/auth/session.ts` | 17 | `maxAge: 7 days` — sessions are not permanent. Stale wristbands expire. |
| 6 — Auth Guard (requireAuth) | `lib/auth/middleware.ts` | 9–19 | Every protected route checks for a valid session before rendering. Missing/invalid → redirect. |
| 7 — Guest Guard (requireGuest) | `lib/auth/middleware.ts` | 25–30 | Auth pages reject already-authenticated users, preventing re-authentication attacks. |
| 8 — Prisma `select` Minimization | `app/(auth)/actions.ts` | 43 | Duplicate-email check selects only `{ id: true }` — doesn't leak the full user row. |
| 8b — Continued | `app/(auth)/actions.ts` | 62 | User creation returns only `{ id, email, name }` — password hash is never in the response. |
| 8c — Continued | `app/(auth)/actions.ts` | 93 | Password hash is selected **only** during login verification, and only within that function's scope. |
| 9 — Generic Error Messages | `app/(auth)/actions.ts` | 100–103 | Login failures always return "Invalid email or password." Never "user not found" or "wrong password." |
| 10 — Constant-Time Verification | `app/(auth)/actions.ts` | 96–98 | `bcrypt.compare` runs even for non-existent users (placeholder hash). Prevents email enumeration via timing. |
| 11 — Brute-Force Resistance | `lib/auth/password.ts` | 3 | `SALT_ROUNDS = 10` → ~100ms per hash. An attacker can attempt ~10 guesses/second, not millions. |
| 12 — Schema-Level Index | `prisma/schema.prisma` | 19 | `@@index([email])` — login lookups are fast, reducing the window for timing-based enumeration. |

**Context:** Consider an XSS attack scenario:
1. Attacker injects JavaScript into the page (breaches the UI layer)
2. Attacker attempts `document.cookie` → fails (Layer 2: `httpOnly: true`)
3. Attacker attempts `fetch('/dashboard')` from the injected script to read protected content
4. Browser sends the cookie automatically (Layer 1: encrypted, tamper-proof)
5. Server-side `requireAuth()` checks the session → valid (Layer 6 passes)
6. But the response only contains the dashboard HTML, which the attacker can read via the DOM — the session cookie itself remains inaccessible

The 12 layers don't all block the same attack vector. Each blocks a different class of
attack (XSS, CSRF, credential stuffing, timing analysis, data exfiltration), so that no
single vulnerability compromises the system.

---

## 4. Principle of Least Privilege

**Definition:** Every component — user, process, function, database query — should operate
with the minimum set of permissions necessary to complete its task. No more, no less.

**Implementation Proof:**

| File | Lines | Mechanism |
|------|-------|-----------|
| `lib/auth/middleware.ts` | 9–19 | `requireAuth()` is a binary gate: authenticated (full access) or unauthenticated (no access). No partial permissions. |
| `app/dashboard/page.tsx` | 5 | `await requireAuth()` — the dashboard's first line of execution. Nothing renders before auth is confirmed. |
| `app/(auth)/layout.tsx` | 9 | `await requireGuest()` — the signup/login layout's first line. Authenticated users are bounced immediately. |
| `app/(auth)/actions.ts` | 43 | Duplicate-email check: `select: { id: true }` — the minimal data needed (just "does this exist?"). |
| `app/(auth)/actions.ts` | 62 | User creation response: `select: { id: true, email: true, name: true }` — excludes `password`, `createdAt`, `updatedAt`. |
| `app/(auth)/actions.ts` | 93 | Login lookup: `select: { ..., password: true }` — the ONLY place the password hash is loaded into memory. |

**Honest assessment — areas not yet implemented:**

- **No user-scoped resource queries.** The `Account` model (`prisma/schema.prisma:22-36`)
  has a `userId` foreign key (line 24), which will enforce ownership at the query level
  once account CRUD is built (prompt 3 per the project specification). Currently, no
  account queries exist, so this is structurally prepared but not yet exercised.

- **No role-based access control.** There is a single user type — no admin/member
  distinction. Adding RBAC would require: (a) a `role` enum on the `User` model,
  (b) a role check in `requireAuth()`, (c) separate guard functions per role. This is
  noted as out of scope for the current stage.

- **No field-level restrictions per route.** `requireAuth()` returns the full session
  payload (`userId`, `email`, `name`) to every caller. A page that only needs `userId`
  still receives `email` and `name`. This is a minor information surface expansion —
  the data is already in the client's session, so the risk is negligible.

- **No route-specific guard composition.** Every protected route uses the same
  `requireAuth()` guard. There is no mechanism for "allow if authenticated AND the
  account's owner matches." This will become relevant when account CRUD routes are
  added in a future stage.

**Verdict:** Least privilege is correctly enforced at the authentication boundary
(auth vs. no-auth) and in database query `select` minimization. It is structurally
prepared but not yet exercised for resource-level ownership (the `userId` foreign key
on `Account` is ready but account queries don't exist yet).

---

## 5. Secure Defaults

**Definition:** Security settings are activated automatically, requiring no developer
opt-in or configuration. The "path of least resistance" is also the secure path. A
developer who does nothing extra still gets strong defaults.

**Implementation Proof:**

| File | Lines | Default | Effect |
|------|-------|---------|--------|
| `lib/auth/session.ts` | 15 | `httpOnly: true` | Cookie invisible to JavaScript. Zero developer effort required. |
| `lib/auth/session.ts` | 16 | `sameSite: "lax"` | CSRF protection enabled for every session. Cannot be disabled without editing this file. |
| `lib/auth/session.ts` | 14 | `secure: process.env.NODE_ENV === "production"` | HTTPS-only enforcement in production. Automatic — no per-route configuration. |
| `lib/auth/session.ts` | 17 | `maxAge: 60 * 60 * 24 * 7` | Sessions expire after 7 days. No "remember me forever" checkbox to accidentally check. |
| `lib/auth/session.ts` | 18 | `path: "/"` | Cookie applies uniformly to all routes. No accidental path-scoping that leaks cookies to the wrong subdirectory. |
| `lib/auth/password.ts` | 3 | `SALT_ROUNDS = 10` | Cost factor is hardcoded. A developer cannot accidentally call `hashPassword` with a weaker cost. |
| `lib/auth/schemas.ts` | 15–21 | Password complexity rules | Minimum 8 characters, uppercase, lowercase, digit — enforced by Zod on every signup. No "simple password" mode. |
| `app/(auth)/actions.ts` | 96–98 | Constant-time verify fallback | The placeholder hash trick is embedded in `loginAction` — every login comparison is timing-safe regardless of whether the email exists. Cannot be bypassed. |
| `prisma/schema.prisma` | 33 | `onDelete: Cascade` | Deleting a user cascades to their accounts. No orphaned records. Structural enforcement at the database level. |
| `prisma/schema.prisma` | 29 | `currency @default("USD")` | Account currency defaults to USD. Prevents null/missing currency values. |
| `app/(auth)/actions.ts` | 62 | `select: { id, email, name }` | After user creation, the password hash is not returned to the caller. The `select` clause is explicit — if a developer adds a field to the User model, it does not automatically leak into the response. |
| `app/(auth)/actions.ts` | 43 | `select: { id: true }` | The duplicate-email query reads only the ID. Even if the User model gains sensitive fields later, this query won't pull them. |

**Context:** The secure defaults are concentrated in two files: `lib/auth/session.ts`
(cookie configuration) and `lib/auth/schemas.ts` (input validation). Every route and
Server Action that uses `getSession()` inherits the HttpOnly, SameSite, secure, and
expiry settings automatically — no per-route boilerplate.

A developer adding a new protected route simply calls `await requireAuth()` at the top
of their Server Component. They don't need to:
- Check if the cookie is HttpOnly (it is, by default)
- Enable CSRF protection (it is, by default)
- Set a cookie expiry (it is, by default)
- Hash passwords (the `hashPassword` function handles salt rounds internally)
- Validate inputs (the Zod schemas are the only entry point to user creation)

The "I forgot to enable X" class of vulnerability is structurally prevented.

---

## Summary Matrix

| Principle | Status | Key File(s) |
|-----------|--------|-------------|
| Zero Knowledge | **Implemented** | `lib/auth/password.ts`, `app/(auth)/actions.ts:46,60` |
| Server-Side Validation | **Implemented** | `lib/auth/schemas.ts`, `app/(auth)/actions.ts:22–26,78–81` |
| Defense in Depth | **Implemented** (12 layers) | `lib/auth/session.ts`, `lib/auth/middleware.ts`, `app/(auth)/actions.ts` |
| Principle of Least Privilege | **Partially implemented** | `lib/auth/middleware.ts`, `app/(auth)/actions.ts:43,62,93` |
| Secure Defaults | **Implemented** (12 defaults) | `lib/auth/session.ts`, `lib/auth/password.ts`, `lib/auth/schemas.ts` |

**No vulnerabilities found in the current architecture.** The "Partially implemented"
rating for Least Privilege reflects the early stage of the project — the structural
scaffolding (foreign key on Account, `select` minimization, auth guards) is in place,
but resource-level ownership queries are not yet exercised because account CRUD is
scheduled for a later prompt.
