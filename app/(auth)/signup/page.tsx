"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { signupAction, type AuthActionState } from "../actions";
import Input from "@/app/components/Input";
import Button from "@/app/components/Button";
import PasswordRules from "@/app/components/PasswordRules";

const initialState: AuthActionState = {};

export default function SignupPage() {
  const [state, formAction, isPending] = useActionState(
    signupAction,
    initialState
  );
  const [password, setPassword] = useState("");

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold text-on-background tracking-tight">
          Open your vault
        </h1>
        <p className="text-on-surface-variant text-sm">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-primary hover:underline font-medium"
          >
            Log in
          </Link>
          .
        </p>
      </div>

      <form action={formAction} className="space-y-4" noValidate>
        <Input
          label="Name"
          name="name"
          type="text"
          autoComplete="name"
          required
          error={state.fieldErrors?.name}
        />

        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={state.fieldErrors?.email}
        />

        <div>
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            error={state.fieldErrors?.password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordRules password={password} />
        </div>

        <Button type="submit" loading={isPending}>
          Open vault
        </Button>
      </form>
    </div>
  );
}
