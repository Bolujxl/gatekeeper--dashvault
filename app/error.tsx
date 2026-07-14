"use client";

import { useEffect } from "react";
import Button from "@/app/components/Button";
import Wordmark from "@/app/components/Wordmark";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <Wordmark size="md" />
      <div className="space-y-2 max-w-sm">
        <h1 className="text-xl font-semibold text-on-background">
          Something went wrong.
        </h1>
        <p className="text-sm text-on-surface-variant">
          The error has been logged. You can try again, or come back later.
        </p>
      </div>
      <div className="w-full max-w-xs">
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
