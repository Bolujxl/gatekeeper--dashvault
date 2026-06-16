import Link from "next/link";
import Wordmark from "./components/Wordmark";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="p-6">
        <Wordmark size="md" />
      </header>

      <main className="flex-1 flex items-center justify-center px-6 -mt-12">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="space-y-3">
            <h1 className="text-4xl font-bold text-on-background tracking-tight">
              Your accounts,<br />behind a door you build.
            </h1>
            <p className="text-on-surface-variant">
              A private vault for your financial records.
            </p>
          </div>

          <div className="flex flex-col gap-3 pt-4">
            <Link
              href="/signup"
              className="w-full py-3 px-6 rounded-lg bg-primary text-on-primary font-semibold hover:opacity-90 transition-opacity"
            >
              Open your vault
            </Link>
            <Link
              href="/login"
              className="w-full py-3 px-6 rounded-lg border border-outline text-on-background hover:bg-surface-variant transition-colors"
            >
              I already have one
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
