import type { ClubRow } from "@/lib/analytics/queries";

/**
 * Guests by club. A table, not a chart — the question is "which clubs, and how
 * many", which a reader answers by looking up a row, not by comparing lengths.
 */
export function GuestLedger({ rows }: { rows: ClubRow[] }) {
  const totalVisits = rows.reduce((sum, r) => sum + r.visits, 0);

  return (
    <section className="viz-root rounded-xl p-5" style={{ border: "1px solid var(--viz-border)" }}>
      <h2 className="text-lg font-semibold">Guests by club</h2>
      <p className="mb-3 text-sm" style={{ color: "var(--text-secondary)" }}>
        {totalVisits === 0
          ? "No guests in this range."
          : `${totalVisits} guest ${totalVisits === 1 ? "visit" : "visits"} in this range.`}
      </p>

      {rows.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead style={{ color: "var(--text-muted)" }}>
            <tr>
              <th scope="col" className="py-2 font-normal">Club</th>
              <th scope="col" className="py-2 font-normal">Visits</th>
              <th scope="col" className="py-2 font-normal">People</th>
            </tr>
          </thead>
          <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
            {rows.map((row) => (
              <tr key={row.homeClub} style={{ borderTop: "1px solid var(--gridline)" }}>
                <td className="py-2">
                  {row.homeClub === "None" ? "Not in a club" : row.homeClub}
                </td>
                <td className="py-2">{row.visits}</td>
                <td className="py-2">{row.people}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
