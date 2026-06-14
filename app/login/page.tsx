import { requireGuest } from "@/lib/auth/middleware";

export default async function LoginPage() {
  await requireGuest();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-on-background">Login form — built in the next prompt.</p>
    </div>
  );
}
