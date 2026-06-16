import { requireAuth } from "@/lib/auth/middleware";
import { logoutAction } from "@/app/(auth)/actions";
import Wordmark from "@/app/components/Wordmark";

export default async function DashboardPage() {
  const user = await requireAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-outline-variant">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Wordmark size="sm" />

          <form action={logoutAction}>
            <button
              type="submit"
              className="text-sm text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Log out
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-on-background tracking-tight">
            Hello, {user.name}.
          </h1>
          <p className="text-on-surface-variant">
            Your vault is empty. Account management is coming next.
          </p>
        </div>
      </main>
    </div>
  );
}
