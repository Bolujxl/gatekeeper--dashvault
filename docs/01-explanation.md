# How It Works: The Journey of a Secret

This is Dashvault's authentication system, explained as if you're a very smart seven-year-old
who happens to be interested in cryptography and HTTP. Every metaphor maps directly to a real
line of code in this project.

---

## 1. The Blender: Hashing Passwords

### The Metaphor

Imagine you have an apple. You put the apple into a blender, press the button, and out comes
a smoothie. The smoothie tastes exactly like the apple — but you can never, ever turn the
smoothie back into the original apple. No amount of freezing, reverse-blending, or wishing
will recover the apple's original shape.

That's what a **hash function** does to your password. It takes your secret word (the apple),
runs it through a mathematical blender (bcrypt), and produces a fixed-length scrambled string
(the smoothie). The smoothie is stored in the database. If a bad guy steals the database, all
they get is smoothies — they can't drink the smoothie backwards to learn your password.

**This is NOT encryption.** Encryption is like putting your apple in a locked box and carrying
the key. Hashing is blending — one-way, irreversible, and intentionally slow to make guessing
hard.

### Line-by-Line Breakdown

**Where the blending recipe lives:** `lib/auth/password.ts`

```
1 │ import bcrypt from "bcryptjs";
```

We import `bcryptjs`, the pure-JavaScript implementation of bcrypt. (The native `bcrypt`
package requires compiled binaries that often break in serverless environments — `bcryptjs`
is slower but works everywhere.)

```
3 │ const SALT_ROUNDS = 10;
```

**What is a salt?** Before we blend the apple, we sprinkle it with a unique, random spice
called a *salt*. The salt is a random string — unique per password — that gets mixed into
the smoothie. This means even if two people pick the exact same password ("password123"),
their smoothies will look completely different because they got different salt sprinkles.

The number `10` is the **cost factor**. Each round of bcrypt doubles the work required.
At 10 rounds, hashing takes roughly 100 milliseconds on average hardware. This is fast
enough that a real user doesn't notice the delay, but slow enough that an attacker trying
to guess millions of passwords per second would need centuries.

```
5 │ export async function hashPassword(plaintext: string): Promise<string> {
6 │   return bcrypt.hash(plaintext, SALT_ROUNDS);
7 │ }
```

`hashPassword` takes the plain text password as input and returns a 60-character string
that begins with `$2a$10$...`. The `$2a$` identifies the algorithm, `$10$` declares the
cost factor, and the rest is the salt and the hashed output mashed together. Everything
needed to verify this password later is baked into this single string.

```
 9 │ export async function verifyPassword(
10 │   plaintext: string,
11 │   hash: string
12 │ ): Promise<boolean> {
13 │   return bcrypt.compare(plaintext, hash);
14 │ }
```

`verifyPassword` takes the password the user just typed and the stored hash from the
database. It extracts the salt from the stored hash, re-runs the blending with the same
salt on the new input, and checks if the two smoothies match.

**Critical detail:** `bcrypt.compare` runs in **constant time**. It doesn't return early
if the first character is wrong — it checks every character, every time. This prevents
timing attacks where an attacker measures how long the comparison takes to figure out
which characters are correct.

**Where blending happens during signup:** `app/(auth)/actions.ts` → `signupAction`

```
46 │   const passwordHash = await hashPassword(password);
```

Line 46: The plaintext password from the signup form is passed through `hashPassword`.
The result is the 60-character bcrypt string. Notice the hash is computed *before* we
check if the email already exists (line 41-44). This is deliberate — even if the email
is taken, we still spend the ~100ms to hash the password. Without this, an attacker
could measure response times to figure out which emails are registered.

```
56 │   const user = await prisma.user.create({
57 │     data: {
58 │       email,
59 │       name,
60 │       password: passwordHash,   // <-- the smoothie, not the apple
61 │     },
62 │     select: { id: true, email: true, name: true },
63 │   });
```

Line 60: The bcrypt hash is stored in the `password` column. Despite the column name
`password`, it never contains the actual password — it contains the smoothie. (See
`prisma/schema.prisma` line 13: `password  String   // bcrypt hash, never the plaintext`.)

Line 62: The `select` clause only returns `id`, `email`, and `name` — the password hash
is not returned to the action, limiting where it can leak.

**Where blending happens during login:** `app/(auth)/actions.ts` → `loginAction`

```
91 │   const user = await prisma.user.findUnique({
92 │     where: { email },
93 │     select: { id: true, email: true, name: true, password: true },
94 │   });
```

Line 91-94: We look up the user by email. Note this is the ONLY place in the entire
codebase where we `select: { password: true }`. The hash is fetched only because we're
about to verify it — and it lives only within this function's scope, never returned to
a client.

```
96 │   const passwordOk = user
97 │     ? await verifyPassword(password, user.password)
98 │     : await verifyPassword(password, "$2a$10$invalidplaceholderhashstringfortimingatk");
```

Lines 96-98: **This is the most security-critical code in the project.**

If the user exists, we call `verifyPassword` with the real hash. If the user does NOT
exist, we call `verifyPassword` with a fake hash. Both paths run bcrypt.compare —
which takes the same ~100ms either way.

Without this, the timing difference would leak information:
- User exists + wrong password → ~100ms
- User doesn't exist → ~1ms (just a failed DB lookup)

An attacker measuring response times could enumerate which emails are registered.
The fake hash makes both paths take the same time. The fake hash is a structurally
valid bcrypt string (starts with `$2a$10$...`) that will never match any real password.

```
100 │   if (!user || !passwordOk) {
101 │     return {
102 │       error: "Invalid email or password.",
103 │     };
104 │   }
```

Line 100-103: The error message is deliberately generic. We never say "wrong password"
or "user not found" — both reveal information. Both failure states return the exact
same string: "Invalid email or password."

---

## 2. The Magic Wristband: Session Cookies

### The Metaphor

Imagine you go to an amusement park. At the entrance, you show your ID and buy a ticket.
The ticket person gives you a **special wristband** — it's made of magic paper that can't
be counterfeited. For the rest of the day, at every single ride, you just flash your
wristband. You don't need to pull out your ID and prove who you are at every rollercoaster.

HTTP is like an amusement park with **amnesia**. Every single request your browser makes to
the server is brand new — the server has no memory of who you are or what you did 5 seconds
ago. Without the wristband, you'd have to type your email and password on every single page
load. Every click. Every image. That would be terrible.

The session cookie IS the wristband. After you log in, the server gives your browser a
cookie that says "this is User #xyz, and I, the server, personally signed this." From
then on, your browser automatically attaches this wristband to every request without you
thinking about it.

### How the wristband can't be faked

The wristband isn't just a sticker that says "User #123." That would be trivially
forgeable — you could just change the number to 456 and become someone else.

Instead, iron-session uses **encrypted cookies**. The entire session data (`userId`,
`email`, `name`) is sealed inside an encrypted envelope using a secret key that only
the server knows. When the browser sends the cookie back, the server decrypts the
envelope and reads the contents. If anyone tries to tamper with the cookie — even
changing a single character — the decryption fails and the session is rejected.

This is why the `SESSION_PASSWORD` in `.env` must be a long, random string. It's the
encryption key. Anyone who knows this key can forge valid wristbands for any user.

**Important:** This is NOT a JWT. JWTs are signed but not encrypted (anyone can read
the contents, they just can't change them). iron-session cookies are fully encrypted —
not even the user can read what's inside their own wristband.

### Line-by-Line Breakdown

**Where the wristband factory lives:** `lib/auth/session.ts`

```
 1 │ import { getIronSession, SessionOptions } from "iron-session";
 2 │ import { cookies } from "next/headers";
```

Line 1: `iron-session` is the library that handles the encryption and decryption of
session cookies. It uses `iron` (a cryptographic sealing library) under the hood.

Line 2: `cookies()` is Next.js's function to read and write HTTP cookies on the server
side. It returns the cookie jar for the current request.

```
 4 │ export interface SessionData {
 5 │   userId?: string;
 6 │   email?: string;
 7 │   name?: string;
 8 │ }
```

Lines 4-8: This is the shape of data we store inside the wristband. `userId` identifies
the user (a CUID from the database). `email` and `name` are convenience copies — they
let us show the user's name in the dashboard header without hitting the database on every
page load. All fields are optional (`?`) because a logged-out user has no session data at all.

```
10 │ export const sessionOptions: SessionOptions = {
11 │   password: process.env.SESSION_PASSWORD as string,
12 │   cookieName: "dashvault_session",
13 │   cookieOptions: {
14 │     secure: process.env.NODE_ENV === "production",
15 │     httpOnly: true,
16 │     sameSite: "lax",
17 │     maxAge: 60 * 60 * 24 * 7, // 7 days
18 │     path: "/",
19 │   },
20 │ };
```

Lines 10-20: The wristband factory settings.

- **Line 11:** `password` is the 32+ character encryption key from `.env`. If this
  is missing or too short, iron-session throws an error immediately (fail loud).

- **Line 12:** `cookieName: "dashvault_session"` — this is what the cookie will be
  called in the browser's cookie jar.

- **Line 14:** `secure: process.env.NODE_ENV === "production"` — in production,
  the cookie is only sent over HTTPS connections. In development (localhost), HTTP
  is allowed so you can test without setting up SSL certificates.

- **Line 15:** `httpOnly: true` — JavaScript running in the browser CANNOT read
  this cookie. Even if an attacker injects malicious scripts (XSS), they can't steal
  the session token because `document.cookie` won't include it.

- **Line 16:** `sameSite: "lax"` — the cookie is NOT sent on cross-site requests
  (like when a link on evil.com points to your site), except for top-level navigation
  GET requests. This blocks most CSRF attacks while still allowing legitimate redirects
  (like coming back from a payment page).

- **Line 17:** `maxAge: 60 * 60 * 24 * 7` — the wristband expires after 7 days
  (604,800 seconds). After that, the user must log in again.

- **Line 18:** `path: "/"` — the cookie is sent for every path on the domain, not
  just specific subdirectories.

```
22 │ export async function getSession() {
23 │   return await getIronSession<SessionData>(await cookies(), sessionOptions);
24 │ }
```

Lines 22-24: `getSession()` is the single function used everywhere to read or write
the session. It takes the current request's cookie jar and the session options, and
returns a session object with `.userId`, `.email`, and `.name` properties. After
modifying these properties, calling `.save()` writes the encrypted cookie back to the
response. Calling `.destroy()` clears it.

The generic parameter `<SessionData>` (line 23) gives TypeScript autocomplete and
type-checking on the session object — you can't accidentally set `session.age = 42`
because `age` isn't in `SessionData`.

**Where the wristband is handed out:** `app/(auth)/actions.ts` → `signupAction`

```
65 │   const session = await getSession();
66 │   session.userId = user.id;
67 │   session.email = user.email;
68 │   session.name = user.name;
69 │   await session.save();
```

Lines 65-69: After successfully creating a user, we:
1. Get the current session (which is empty — no userId yet).
2. Stamp the user's ID, email, and name onto it.
3. Call `session.save()`. This encrypts the data, wraps it in a cookie, and adds a
   `Set-Cookie: dashvault_session=...` header to the HTTP response.

When the browser receives this response, it stores the cookie in its cookie jar.

**Where the wristband is checked on login:** `app/(auth)/actions.ts` → `loginAction`

```
106 │   const session = await getSession();
107 │   session.userId = user.id;
108 │   session.email = user.email;
109 │   session.name = user.name;
110 │   await session.save();
```

Lines 106-110: Identical pattern to signup — fetch the empty session, stamp the user's
data onto it, save to set the cookie.

**Where the wristband is torn off:** `app/(auth)/actions.ts` → `logoutAction`

```
115 │ export async function logoutAction() {
116 │   const session = await getSession();
117 │   session.destroy();
118 │   redirect("/login");
119 │ }
```

Lines 116-117: `session.destroy()` clears all session data and sends a `Set-Cookie`
header that expires the cookie immediately. The wristband is ripped off. Any subsequent
request will have no session data.

**The automatic re-attachment:** Every subsequent request the browser makes includes
the `Cookie: dashvault_session=...` header automatically. The server calls `getSession()`
in `lib/auth/session.ts` line 23, which reads the cookie, decrypts it with the
`SESSION_PASSWORD`, and populates the session object. The user never sends their password
again — the wristband is all they need.

---

## 3. The Bouncer at the Door: Protected Routes

### The Metaphor

You're at a VIP club. The door has a bouncer. You walk up. The bouncer doesn't ask for
your ID or your name — they just look at your wrist. If you're wearing the club's
official wristband, you walk right in. If you're not wearing one, or if your wristband
looks fake, the bouncer points down the street and says "The public entrance is that way."

In Dashvault, the `/dashboard` page is the VIP room. The `/signup` and `/login` pages
are the public entrance — you're only allowed there if you DON'T have a wristband (why
would you need to sign up again if you're already inside?).

### Line-by-Line Breakdown

**Where the bouncer lives:** `lib/auth/middleware.ts`

```
 1 │ import { redirect } from "next/navigation";
 2 │ import { getSession } from "./session";
```

Line 1: `redirect()` is Next.js's way of saying "send the browser somewhere else."
It throws a special error that Next.js catches and turns into an HTTP 302 redirect.

Line 2: We import `getSession` — the same function from the wristband factory. The
bouncer checks wristbands using the exact same mechanism.

**The VIP bouncer — `requireAuth()`:**

```
 9 │ export async function requireAuth() {
10 │   const session = await getSession();
11 │   if (!session.userId) {
12 │     redirect("/login");
13 │   }
14 │   return {
15 │     userId: session.userId,
16 │     email: session.email!,
17 │     name: session.name!,
18 │   };
19 │ }
```

- **Line 10:** Read the encrypted cookie from the incoming request. `getSession()`
  (from `lib/auth/session.ts` line 23) calls Next.js's `cookies()` to get the
  request's cookie jar, then `iron-session` decrypts it using the `SESSION_PASSWORD`.
  If the cookie exists and is valid, `session.userId` will be set. If not, it's
  `undefined`.

- **Line 11:** The bouncer checks for the wristband. If `session.userId` is missing
  or falsy (no wristband, expired wristband, or tampered wristband that failed
  decryption), the condition is true.

- **Line 12:** No wristband? Redirect to `/login`. The browser receives a 302
  response and navigates to the login page. The user sees the login form instead
  of the dashboard.

- **Lines 14-18:** Wristband found! Extract the `userId`, `email`, and `name` from
  the decrypted session data and return them. The `!` assertions on `email` and `name`
  are safe here because if `userId` exists, those fields were set together during
  login/signup (see `actions.ts` lines 66-68 and 107-109).

- The calling code receives these values and can render the protected page. The user
  never sees a redirect — the page just loads with their data.

**The anti-bouncer — `requireGuest()`:**

```
25 │ export async function requireGuest() {
26 │   const session = await getSession();
27 │   if (session.userId) {
28 │     redirect("/dashboard");
29 │   }
30 │ }
```

- **Line 26:** Same wristband check.

- **Line 27:** But this time the logic is inverted. If the wristband IS present
  (the user is already logged in), redirect them to `/dashboard`. There's no reason
  for an authenticated user to visit the login or signup pages.

- **Line 28:** Redirect to `/dashboard`. The logged-in user trying to visit
  `/signup` gets automatically bounced to their dashboard.

**Where the bouncer is stationed:**

1. **Dashboard:** `app/dashboard/page.tsx`

```
1 │ import { requireAuth } from "@/lib/auth/middleware";
...
4 │ export default async function DashboardPage() {
5 │   const user = await requireAuth();
```

Line 5: This is a Server Component (no `"use client"` directive). It runs entirely
on the server. Before a single line of HTML is generated, `requireAuth()` checks the
wristband. If no valid wristband exists, the function calls `redirect("/login")` (line
12 of middleware.ts) and the dashboard never renders. If the wristband is valid, `user`
receives `{ userId, email, name }` and the page renders with `Hello, {user.name}`.

2. **Auth pages:** `app/(auth)/layout.tsx`

```
1 │ import Link from "next/link";
2 │ import { requireGuest } from "@/lib/auth/middleware";
...
4 │ export default async function AuthLayout({ children }) {
9 │   await requireGuest();
```

Line 9: This layout wraps both `/signup` and `/login` (the `(auth)` route group).
Before rendering the signup or login form, `requireGuest()` checks for an existing
wristband. If the user is already logged in, they're redirected to `/dashboard`.
If not, the layout renders the form.

**The full request lifecycle:**

1. Browser sends `GET /dashboard` with `Cookie: dashvault_session=encrypted_blob`
2. `app/dashboard/page.tsx` line 5 calls `requireAuth()`
3. `requireAuth()` → `getSession()` → `cookies()` reads the `Cookie` header
4. `iron-session` decrypts the cookie using `SESSION_PASSWORD`
5. Decryption succeeds → `session.userId = "clx..."` → bouncer says "come in"
6. Dashboard renders with user data

Or, if the cookie is missing:

1. Browser sends `GET /dashboard` with no `Cookie` header
2. `requireAuth()` → `getSession()` → `cookies()` returns empty jar
3. `session.userId` is `undefined` → bouncer says "nope"
4. `redirect("/login")` → 302 response → browser navigates to `/login`

---

### Summary: The Full Journey

Let's trace a complete lifecycle:

**Step 1 – Signup:**
1. User fills out the signup form and clicks "Create vault"
2. `app/(auth)/actions.ts` line 22: Zod validates the input server-side
3. Line 46: `hashPassword()` blends the password into a bcrypt smoothie
4. Line 56-63: User row created in SQLite — `password` column gets the smoothie
5. Line 65-69: Session wristband created with `userId`, `email`, `name`
6. Line 69: `session.save()` encrypts the wristband → `Set-Cookie` header on response

**Step 2 – Browsing:**
1. User clicks around the dashboard
2. Every request: browser sends `Cookie: dashvault_session=...`
3. Every protected page: `requireAuth()` decrypts the cookie, reads `userId`
4. No database query needed — the user's identity came from the wristband

**Step 3 – Logout:**
1. User clicks "Log out"
2. `app/(auth)/actions.ts` line 117: `session.destroy()` clears the cookie
3. Browser receives `Set-Cookie` with immediate expiry — wristband ripped off
4. Redirect to `/login`

**Step 4 – Login (days later):**
1. User types email + password
2. Line 91-94: Database lookup by email, fetching the password hash
3. Lines 96-98: `verifyPassword()` re-blends the input and checks against stored hash
4. Lines 106-110: New wristband created (old one expired after 7 days)
5. Redirect to `/dashboard` — wristband attached to response

At every point, the plaintext password exists only in the form input and in the server's
memory for the duration of the hash/verify call — milliseconds. It is never stored, never
logged, never returned to the client, and never persisted anywhere.
