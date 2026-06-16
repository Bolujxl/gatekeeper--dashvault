"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { signupSchema, loginSchema } from "@/lib/auth/schemas";

export interface AuthActionState {
  error?: string;
  fieldErrors?: {
    name?: string;
    email?: string;
    password?: string;
  };
}

export async function signupAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const result = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    const fieldErrors: AuthActionState["fieldErrors"] = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof NonNullable<AuthActionState["fieldErrors"]>;
      if (field && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { fieldErrors };
  }

  const { name, email, password } = result.data;

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  const passwordHash = await hashPassword(password);

  if (existingUser) {
    return {
      fieldErrors: {
        email: "An account with this email already exists.",
      },
    };
  }

  const user = await prisma.user.create({
    data: {
      email,
      name,
      password: passwordHash,
    },
    select: { id: true, email: true, name: true },
  });

  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.name = user.name;
  await session.save();

  redirect("/dashboard");
}

export async function loginAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const result = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    return {
      error: "Enter a valid email and password.",
    };
  }

  const { email, password } = result.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, password: true },
  });

  const passwordOk = user
    ? await verifyPassword(password, user.password)
    : await verifyPassword(password, "$2a$10$invalidplaceholderhashstringfortimingatk");

  if (!user || !passwordOk) {
    return {
      error: "Invalid email or password.",
    };
  }

  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.name = user.name;
  await session.save();

  redirect("/dashboard");
}

export async function logoutAction() {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}
