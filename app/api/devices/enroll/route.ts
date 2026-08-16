import { NextResponse } from "next/server";
import { redeemEnrollmentCode } from "@/lib/auth/device";

/**
 * The only station endpoint that does not require a device token — it is how
 * a tablet gets one. A stranger who finds this URL still needs a code an
 * admin generated in the last fifteen minutes.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.code || typeof body.code !== "string") {
    return NextResponse.json({ error: "code required" }, { status: 400 });
  }

  const result = await redeemEnrollmentCode(body.code);
  if (!result) {
    return NextResponse.json({ error: "invalid or expired code" }, { status: 401 });
  }

  return NextResponse.json(result);
}
