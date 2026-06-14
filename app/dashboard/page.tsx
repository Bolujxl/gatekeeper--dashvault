import { requireAuth } from "@/lib/auth/middleware";

export default async function DashboardPage() {
  const user = await requireAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-on-background">
        Hello, {user.name}. Dashboard — built in a later prompt.
      </p>
    </div>
  );
}
