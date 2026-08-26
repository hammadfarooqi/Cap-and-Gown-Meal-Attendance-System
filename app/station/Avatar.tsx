type AvatarProps = {
  name: string;
  /** Null whenever the headshot is missing — an ordinary case, not an error. */
  url: string | null;
};

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * A member's headshot, or their initials.
 *
 * Headshots are open question O5 and may not arrive before go-live, so the
 * fallback has to look deliberate rather than broken. Counts are unaffected
 * either way.
 */
export function Avatar({ name, url }: AvatarProps) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a blob: URL from
      // IndexedDB; next/image cannot optimise it and would only add a round trip.
      <img
        src={url}
        alt=""
        data-testid="avatar-photo"
        className="h-64 w-64 rounded-full object-cover shadow-2xl ring-1 ring-white/10"
      />
    );
  }

  return (
    <div
      data-testid="avatar-initials"
      aria-hidden="true"
      className="flex h-64 w-64 items-center justify-center rounded-full bg-oxblood-wash font-display text-6xl text-ink-secondary ring-1 ring-line-strong"
    >
      {initials(name)}
    </div>
  );
}
