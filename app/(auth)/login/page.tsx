"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type AuthActionState } from "../actions";
import Input from "@/app/components/Input";
import Button from "@/app/components/Button";

const initialState: AuthActionState = {};

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(
    loginAction,
    initialState
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold text-on-background tracking-tight">
          Welcome back
        </h1>
        <p className="text-on-surface-variant text-sm">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="text-primary hover:underline font-medium"
          >
            Open one
          </Link>
          .
        </p>
      </div>

      <form action={formAction} className="space-y-4" noValidate>
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />

        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />

        {state.error && (
          <div
            className="p-3 rounded-lg bg-error-container text-on-error-container text-sm"
            role="alert"
          >
            {state.error}
          </div>
        )}

        <Button type="submit" loading={isPending}>
          Unlock vault
        </Button>
      </form>
    </div>
  );
}
