# Auth Flow: Find the Lie

Five statements about how Dashvault's auth flow works. Four are true. One is false.

## The statements

1. When a login attempt fails — whether because the email doesn't exist or the password is wrong — the server returns the exact same error message: "Invalid email or password."

2. When a user logs in, the server explicitly destroys any existing session before creating a new one, preventing session fixation attacks.

3. On signup, bcrypt hashes the password before the code checks whether the email is already taken. This means bcrypt runs every time, regardless of whether signup will succeed.

4. The password complexity rules enforced by Zod — uppercase, lowercase, digit, minimum 8 characters — are applied during signup only. The login schema only checks that a password is present.

5. The session cookie has `httpOnly: true` and `sameSite: 'lax'`. The `httpOnly` flag prevents JavaScript from reading the cookie; the `lax` setting blocks cross-site POST requests but allows cross-site top-level GET navigation.

## Your answer

**Which one do you think is the lie?**

The lie is statement 5 

---

## The reveal

**The lie was statement 2.** Statement 5 is true.

### What statement 2 claims

> When a user logs in, the server explicitly destroys any existing session before creating a new one, preventing session fixation attacks.

### What the code actually does

`app/(auth)/actions.ts` lines 106–110:

```ts
const session = await getSession();
session.userId = user.id;
session.email = user.email;
session.name = user.name;
await session.save();
```

There is no call to `session.destroy()` before the session is overwritten.
The code directly stamps new values onto whatever session object `getSession()`
returns and saves it. That object overwrites the cookie's contents. It does not
destroy the old session first; it mutates it in place.

### Why statement 2 sounds plausible

Session fixation is a real attack: an attacker sets a known session ID on a
victim's browser, the victim logs in, and the session ID stays the same —
now the attacker's known ID grants access to the victim's account. The standard
defense is to call `session.destroy()` (or `session.regenerate()`) on login so
the session ID changes. This codebase does not do that.

### Why it's not actually vulnerable

The `requireGuest()` guard in `lib/auth/middleware.ts` line 25–30 runs inside
`app/(auth)/layout.tsx` before the login page renders. Any user who already has
a valid session gets redirected to `/dashboard` before they can even see the
login form. So no one can reach the login page with an existing session to
overwrite — the fixation scenario can't occur through the normal login flow.

But the claim was that the server "explicitly destroys" the session, which it
*does not*. The guard makes it practically safe, but the code doesn't do what
statement 2 says it does.

### Why statement 5 is true

`lib/auth/session.ts` lines 15–16:

```ts
httpOnly: true,
sameSite: "lax",
```

- `httpOnly: true` — `document.cookie` in JavaScript returns nothing for this
  cookie. XSS cannot read it.
- `sameSite: "lax"` — the browser will NOT attach this cookie to cross-site
  POST requests, iframe loads, or AJAX calls. It WILL attach it to cross-site
  top-level GET navigations (e.g., clicking a link from an email). This is
  exactly what statement 5 describes.

### Statement-by-statement verdict

| # | Claim | True/False | Proof |
|---|-------|------------|-------|
| 1 | Login error message is always "Invalid email or password." | True | `actions.ts:102` — single return for both `!user` and `!passwordOk` |
| 2 | Server destroys old session before creating a new one on login. | **False** | `actions.ts:106–110` — no `destroy()` call, only overwrite |
| 3 | bcrypt runs on signup before the duplicate-email check. | True | `actions.ts:46` (hash) runs before `actions.ts:48` (check) |
| 4 | Password complexity rules apply at signup only, not login. | True | `schemas.ts:15–21` (signup) vs `schemas.ts:26` (login, only `min(1)`) |
| 5 | Cookie has `httpOnly: true` and `sameSite: 'lax'` with described behavior. | True | `session.ts:15–16` matches the description exactly |
