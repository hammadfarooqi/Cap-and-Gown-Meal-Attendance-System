/**
 * Decide which people a card's printed name could refer to.
 *
 * A name never identifies anybody — spec A8. This produces candidates for a
 * human to choose between, and every caller shows a netID beside each one so
 * the choice can be checked. Measured against the real 196-member roster,
 * 194 people produce exactly one candidate and two produce two, because two
 * members share a full name.
 *
 * The comparison is chunk to chunk rather than word to word. A flat bag of
 * words lets one hyphenated surname supply two shared words by itself, which
 * made a card match a relative who shares that surname on the surname alone.
 * Two relatives at the same club is not a hypothetical.
 */

/** How many chunks must correspond before two names are considered a match. */
export const MIN_CORRESPONDING = 2;

/**
 * Every form one chunk of a name might legitimately take.
 *
 * Both the joined and the split forms of a hyphenated chunk are kept, because
 * we do not know whether a stripe preserves the hyphen and only one real card
 * has ever been read.
 */
function chunkForms(chunk: string): Set<string> {
  const cleaned = chunk
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining marks: Renée -> Renee
    .replace(/['’.]/g, ""); // straight and curly apostrophes: O'Brien -> OBrien

  const forms = new Set<string>();

  const joined = cleaned.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (joined.length > 1) forms.add(joined);

  for (const part of cleaned.split(/[^A-Za-z]+/)) {
    // One letter is a middle initial, which carries no matching power.
    if (part.length > 1) forms.add(part.toUpperCase());
  }

  return forms;
}

/** A name as a list of chunks, each the set of forms it might take. */
export function nameChunks(name: string): Set<string>[] {
  return name
    .trim()
    .split(/\s+/)
    .map(chunkForms)
    .filter((forms) => forms.size > 0);
}

/**
 * How many card chunks correspond to a *distinct* roster chunk.
 *
 * Claiming each roster chunk at most once is what stops a single surname
 * satisfying the threshold on its own.
 */
function corresponding(card: Set<string>[], roster: Set<string>[]): number {
  const claimed = new Set<number>();
  let count = 0;

  for (const chunk of card) {
    for (let i = 0; i < roster.length; i++) {
      if (claimed.has(i)) continue;

      let shares = false;
      for (const form of chunk) {
        if (roster[i].has(form)) {
          shares = true;
          break;
        }
      }

      if (shares) {
        claimed.add(i);
        count += 1;
        break;
      }
    }
  }

  return count;
}

/** True when the card's name and a person's name correspond well enough. */
export function namesMatch(cardName: string[], fullName: string): boolean {
  const card = nameChunks(cardName.join(" "));
  if (card.length < MIN_CORRESPONDING) return false;
  return corresponding(card, nameChunks(fullName)) >= MIN_CORRESPONDING;
}

/**
 * Everyone the card's name could refer to.
 *
 * Matched against BOTH names a person may have: the roster's `fullName`,
 * which is what the club calls them, and `directoryName`, which is what the
 * University does. A card is printed from the University's record, so for
 * anyone whose roster entry is a preferred name the two disagree — measured
 * at 5 of 196 members, four of them a nickname against a legal first name.
 * Either name matching is enough.
 *
 * Order follows the list given, so a caller that passes people in a stable
 * order gets a stable screen.
 */
export function nameCandidates<T extends { fullName: string; directoryName?: string | null }>(
  cardName: string[],
  people: T[],
): T[] {
  const card = nameChunks(cardName.join(" "));
  if (card.length < MIN_CORRESPONDING) return [];

  const matches = (name: string | null | undefined) =>
    Boolean(name) && corresponding(card, nameChunks(name!)) >= MIN_CORRESPONDING;

  return people.filter((person) => matches(person.fullName) || matches(person.directoryName));
}
