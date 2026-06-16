import { requireGuest } from "@/lib/auth/middleware";
import Wordmark from "@/app/components/Wordmark";
import SecurityGuarantees from "@/app/components/SecurityGuarantees";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireGuest();

  return (
    <div className="min-h-screen bg-background grid grid-cols-1 lg:grid-cols-[40fr_60fr]">

      {/* LEFT — brand + tagline + guarantees */}
      <aside className="relative hidden lg:flex flex-col justify-between p-10 border-r border-outline-variant">
        <Wordmark size="md" />

        <div className="max-w-md">
          <p className="text-2xl font-normal text-on-background leading-snug tracking-tight">
            Your accounts,<br />
            behind a door you build.
          </p>
        </div>

        <SecurityGuarantees />
      </aside>

      {/* RIGHT — form area */}
      <main className="flex flex-col">
        <div className="lg:hidden p-6 border-b border-outline-variant">
          <Wordmark size="sm" />
        </div>

        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>

    </div>
  );
}
