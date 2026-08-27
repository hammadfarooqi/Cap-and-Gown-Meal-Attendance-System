import { redirect } from "next/navigation";

/**
 * Nobody should ever land on a framework splash page.
 *
 * A tablet is pointed at /station and stays there; anyone else typing the
 * bare address is an officer looking for the dashboard.
 */
export default function Home() {
  redirect("/admin");
}
