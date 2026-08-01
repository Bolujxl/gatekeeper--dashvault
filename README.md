# Dashvault

A private vault for your financial records — built as an auth-craft portfolio piece demonstrating correct authentication from the ground up.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 with Material 3 tokens |
| Fonts | Manrope (UI) + IBM Plex Mono (numbers) |
| Database | SQLite via Prisma (Postgres-ready) |
| Hashing | bcryptjs (SALT_ROUNDS = 10) |
| Sessions | iron-session (encrypted cookies) |
| Validation | Zod (server-side enforced) |

## Getting started

```bash
git clone https://github.com/Bolujxl/gatekeeper--dashvault.git
cd gatekeeper--dashvault
npm install
```

Copy `.env.example` to `.env` and set a `SESSION_PASSWORD` (32+ characters):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Run the database migration:

```bash
npx prisma migrate dev --name init
```

Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project structure

```
app/
├── (auth)/                 # Route group — /signup, /login
│   ├── actions.ts          # Server Actions: signup, login, logout
│   ├── layout.tsx          # Split-screen 40/60 layout + requireGuest guard
│   ├── signup/page.tsx     # Signup form with live password pills
│   └── login/page.tsx      # Login form with generic error handling
├── dashboard/page.tsx      # Protected route — requireAuth guard
├── components/             # Shared: Input, Button, Logo, Wordmark, etc.
├── styles/tokens.css       # Material 3 design tokens (dark + light)
├── globals.css             # Base styles + font setup
├── layout.tsx              # Root layout — Manrope + IBM Plex Mono fonts
└── page.tsx                # Landing page

lib/
├── auth/                   # Portable auth library
│   ├── session.ts          # iron-session configuration
│   ├── password.ts         # bcrypt hash + verify
│   ├── schemas.ts          # Zod signup + login schemas
│   ├── middleware.ts       # requireAuth / requireGuest guards
│   ├── rate-limit.ts       # IP + email rate limiting
│   └── placeholder.ts      # Placeholder hash for timing defense
└── db.ts                   # Prisma singleton

prisma/
└── schema.prisma           # User + Account models (SQLite)
```

## Auth implementation

### Password handling

Passwords are hashed with bcryptjs at cost factor 10 before storage. The plaintext never touches the database. Verification uses `bcrypt.compare` which runs in constant time.

### Session management

Sessions are encrypted cookies via iron-session — no database session table needed. Cookies have `httpOnly: true`, `sameSite: "lax"`, and `secure: true` in production. Sessions expire after 7 days.

### Timing attack defense

On login, `bcrypt.compare` runs against a placeholder hash even when the email doesn't exist, keeping response times identical and preventing email enumeration via timing analysis. On signup, the password is hashed before the duplicate-email check for the same reason.

### Validation

All input is validated server-side via Zod schemas. The browser's HTML5 validation is explicitly disabled (`noValidate`) — the server is the single source of truth.

### Route protection

`requireAuth()` in Server Components checks for a valid session before rendering protected pages. `requireGuest()` redirects authenticated users away from signup/login.

### Rate limiting

IP-based and email-based rate limiting on `/login` and `/signup` with configurable windows and attempt limits. In-memory store suitable for development; swap to Redis for production.

## Documentation

| Doc | Content |
|-----|---------|
| `docs/01-explanation.md` | ELI7 walkthrough of hashing, sessions, and route protection |
| `docs/02-principles.md` | Security architecture audit of 5 core principles |
| `docs/03-audit.md` | Threat audit across 6 attack vectors with fixes |
| `docs/04-cross-check.md` | Adversarial cross-check — 6 blindspots Audit 03 missed |
| `docs/05-tinker.md` | Notes and tinkering |
| `docs/06-liedetector.md` | Self-check exercise — 4 true statements, 1 lie |

## Tradeoffs

- **SQLite → Postgres switch is a one-line schema change** in `prisma.config.ts`. The schema uses standard Prisma types with no SQLite-specific features.
- **iron-session is stateless** — no server-side token revocation. Stolen cookies remain valid until expiry. Acceptable for the current scope; a DB-backed session table would be needed for real financial operations.
- **bcryptjs over bcrypt** — pure JavaScript, no native binaries. Marginally slower but never breaks in serverless environments.
