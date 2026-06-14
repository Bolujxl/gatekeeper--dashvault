import { requireGuest } from "@/lib/auth/middleware";

export default async function SignupPage() {
  await requireGuest();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-on-background">Signup form — built in the next prompt.</p>
    </div>
  );
}
