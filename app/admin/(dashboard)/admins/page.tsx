import { requireAdmin } from "@/lib/auth/admin";
import { AdminsView } from "./AdminsView";

export default async function AdminsPage() {
  const { email } = await requireAdmin();
  return <AdminsView me={email} />;
}
