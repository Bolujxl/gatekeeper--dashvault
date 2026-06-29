# Tinkering Phase: Insecure Password Verification

An operational experiment observing what happens when we replace robust cryptographic checks with a basic comparison check.

---

## 1. The Verification Function Under Review
We analyzed `verifyPassword` in `lib/auth/password.ts`:

```typescript
export async function verifyPassword(
  plaintext: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
```

---

## 2. Insecure Mutation: Plain String Equality
We temporarily modified the function in `lib/auth/password.ts` to:

```typescript
export async function verifyPassword(
  plaintext: string,
  hash: string
): Promise<boolean> {
  return plaintext === hash;
}
```

---

## 3. Predicted Security & Logistical Consequences (Before Change)

### A. Core Authentication Failure (Logistical Predictor)
1. **Registered users cannot log in:** When a user logs in with their correct plaintext password (e.g. `"CoolDog99"`), the server will compare it directly to their stored bcrypt hash in the database (e.g. `$2a$10$xK3jf8sLq...`). 
   Since `"CoolDog99" === "$2a$10$xK3jf8sLq..."` is false, the login request will fail with an "Invalid email or password" error.
2. **The "Bcrypt Leak" Exploit:** If an attacker extracts a user's bcrypt password hash, they can input **the actual scrambled hash** as their password in the login form. 
   Because `"hash" === "hash"` evaluates to true, the attacker gets **full access to the user's account** without ever knowing the real password.

### B. Timing Vulnerabilities (Security Predictor)
Plain string comparison exits as soon as it sees a character mismatch. This drops the comparison latency from a safe ~100ms (bcrypt speed bump) to less than 1ms, enabling timing-based user enumeration.

---

## 4. Observed Results (During Experimentation)

We simulated login test parameters using `bolujxl2@gmail.com` with the database running:

### Try Login with Wrong Plaintext Password
* **Input Email:** `bolujxl2@gmail.com`
* **Input Password:** `WrongPassword123`
* **Result observed:** Login failed (`Result: FAILURE! Invalid password. (Matched? false)`)
* **Time Taken:** **1ms** (compared to the expected ~100ms of bcrypt checking).

### Try Login with Plaintext Match of the Scrambled Hash (Bcrypt Leak Exploit)
* **Input Email:** `bolujxl2@gmail.com`
* **Input Password:** `$2a$10$HASH_STRING_FROM_DB` *(the raw bcrypt hash itself)*
* **Result observed:** **SUCCESS! Logged in as user.**
* **Time Taken:** **0.7ms**

---

## 5. Security Conclusions
Replacing cryptographic hashing with plain string verification introduces massive vulnerabilities:
1. **Authentication Bypass (Hash Login):** Since the server compares input and hash directly, the hash *becomes* the password. Anyone who can read the database or access server logs can log in instantly without cracking the hash.
2. **Timing Attack Vulnerabilities:** The timing speed bump protecting user accounts was reduced by 99% (from 100ms to 1ms), leaving the login route open to brute force timing analysis.
