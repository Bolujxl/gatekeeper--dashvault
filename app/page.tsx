import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-background">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="space-y-3">
          <h1 className="text-5xl font-mono font-medium text-on-background tracking-tight">
            Dashvault
          </h1>
          <p className="text-on-surface-variant text-lg">
            A vault for your financial records.
          </p>
        </div>

        <div className="flex flex-col gap-3 pt-4">
          <Link
            href="/signup"
            className="w-full py-3 px-6 rounded-lg bg-primary text-on-primary font-medium hover:opacity-90 transition-opacity"
          >
            Sign Up
          </Link>
          <Link
            href="/login"
            className="w-full py-3 px-6 rounded-lg border border-outline text-on-background hover:bg-surface-variant transition-colors"
          >
            Log In
          </Link>
        </div>
      </div>
    </div>
  );
}
