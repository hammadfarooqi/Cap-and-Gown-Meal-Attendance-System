import { NextResponse } from "next/server";
import { requireAdminApi, removeAdmin, resetAdminPassword, LastAdminError } from "@/lib/auth/admin";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { userId } = await params;

  try {
    await removeAdmin(userId);
    return NextResponse.json({ removed: userId });
  } catch (error) {
    if (error instanceof LastAdminError) {
      // Locking every officer out cannot be undone from inside the dashboard.
      return NextResponse.json(
        { error: "You cannot remove the last officer — nobody could sign in." },
        { status: 409 },
      );
    }
    throw error;
  }
}

/** Reset somebody's password. This is why no email is ever needed. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { userId } = await params;
  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";

  if (password.length < 12) {
    return NextResponse.json({ error: "Use at least 12 characters." }, { status: 400 });
  }

  await resetAdminPassword(userId, password);
  return NextResponse.json({ userId });
}
