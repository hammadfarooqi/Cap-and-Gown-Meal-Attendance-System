type AvatarProps = {
  name: string;
  /** Null whenever the headshot is missing — an ordinary case, not an error. */
  url: string | null;
  /** "large" fills the check-in screen; "tile" fits several side by side. */
  size?: "large" | "tile";
};

/**
 * 4:5 portraits, not circles.
 *
 * A circle inscribed in a square crop showed a small face with the top of the
 * head already gone. The photos are portraits; drawn as portraits the face
 * fills the frame.
 */
const SIZES = {
  large: "h-64 aspect-[4/5]",
  tile: "h-32 aspect-[4/5]",
} as const;

const TEXT = {
  large: "text-6xl",
  tile: "text-4xl",
} as const;

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
export function Avatar({ name, url, size = "large" }: AvatarProps) {
  if (url) {
    return (
      /* A blob: URL from IndexedDB. next/image cannot optimise it and would
         only add a round trip. The directive has to sit on the line directly
         above the element, or it silently applies to the comment instead. */
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        data-testid="avatar-photo"
        className={`${SIZES[size]} rounded-2xl object-cover shadow-2xl ring-1 ring-white/10`}
      />
    );
  }

  return (
    <div
      data-testid="avatar-initials"
      aria-hidden="true"
      className={`flex ${SIZES[size]} items-center justify-center rounded-2xl bg-oxblood-wash font-display ${TEXT[size]} text-ink-secondary ring-1 ring-line-strong`}
    >
      {initials(name)}
    </div>
  );
}
