import { NextResponse } from "next/server";
import { requireAdminApi, adminOrNull, listAdmins, addAdmin } from "@/lib/auth/admin";

export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  return NextResponse.json({ admins: await listAdmins() });
}

export async function POST(req: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const me = await adminOrNull();
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email.includes("@")) {
    return NextResponse.json({ error: "That is not an email address." }, { status: 400 });
  }
  if (password.length < 12) {
    return NextResponse.json(
      { error: "Use at least 12 characters. This account can see every student's data." },
      { status: 400 },
    );
  }

  try {
    const { userId } = await addAdmin(email, password, me?.userId ?? null);
    return NextResponse.json({ userId, email });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create that account.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
