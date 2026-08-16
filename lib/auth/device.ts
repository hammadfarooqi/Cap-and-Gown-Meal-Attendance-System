import { createHash, randomBytes } from "node:crypto";
import { serviceClient } from "@/lib/db/client";

const CODE_TTL_MS = 15 * 60 * 1000;

/** No I, L, O, 0 or 1 — these get misread when someone types a code off a screen. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Device tokens are random 256-bit secrets, so a fast hash is the right tool.
 * Password hashing (bcrypt, argon2) exists to slow down guessing attacks
 * against low-entropy inputs. These inputs are not guessable.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function randomCode(length = 8): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/**
 * Create a one-time code an admin reads out to whoever is holding the tablet.
 * The device's name travels on the code row, so it survives the code being
 * created on one serverless instance and redeemed on another.
 */
export async function createEnrollmentCode(
  name: string,
): Promise<{ code: string; expiresAt: string }> {
  const db = serviceClient();
  const code = randomCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  const { error } = await db
    .from("enrollment_codes")
    .insert({ code, name, expires_at: expiresAt });
  if (error) throw error;

  return { code, expiresAt };
}

/**
 * Exchange a valid code for a device and its long-lived token.
 *
 * The plaintext token is returned exactly once, here. After this it exists
 * only on the tablet — the database keeps a hash.
 */
export async function redeemEnrollmentCode(
  code: string,
): Promise<{ deviceId: string; token: string } | null> {
  const db = serviceClient();

  const { data: row } = await db
    .from("enrollment_codes")
    .select("code, name, expires_at, used_at")
    .eq("code", code)
    .maybeSingle();

  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  const token = randomBytes(32).toString("base64url");

  const { data: device, error } = await db
    .from("devices")
    .insert({ name: row.name, token_hash: hashToken(token) })
    .select("id")
    .single();
  if (error) throw error;

  // Marking the code used only after the device exists means a failure above
  // leaves the code still redeemable rather than burning it.
  await db
    .from("enrollment_codes")
    .update({ used_at: new Date().toISOString(), device_id: device.id })
    .eq("code", code);

  return { deviceId: device.id, token };
}

/**
 * Identify the tablet behind a request, or null if it is not an enrolled and
 * active device. Every station endpoint calls this first.
 */
export async function authenticateDevice(
  req: Request,
): Promise<{ deviceId: string } | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const db = serviceClient();
  const { data } = await db
    .from("devices")
    .select("id, revoked_at")
    .eq("token_hash", hashToken(header.slice("Bearer ".length)))
    .maybeSingle();

  if (!data || data.revoked_at) return null;

  // Drives the "last seen" column in the dashboard's device list, which is how
  // an admin notices a tablet has stopped talking to the server.
  await db
    .from("devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);

  return { deviceId: data.id };
}
