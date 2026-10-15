/**
 * Finds the place a description names, without a model: a whole-word match against the places list. The longest
 * name wins, so "Malasaña" in a city's neighbourhood beats the city itself. Names that are also everyday words
 * are never matched alone.
 */

import { PLACES, type Place } from "../data/es-places.js";

/** Names that are also everyday words in Spanish: they count only with a longer name around them, never alone */
export const COMMON_WORDS: ReadonlySet<string> = new Set(["real", "mar", "vera", "ribera", "fuente"]);

/** Lower case, no accents, words separated by single spaces: the comparison used for every name */
export const normalizeWords = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

interface Entry {
  match: string; // normalized name
  label: string; // what the planner shows: "Malasaña, Madrid" or "Sevilla"
}

const entriesOf = (places: readonly Place[]): Entry[] =>
  places.map((place) => ({
    match: normalizeWords(place.name),
    label: place.city ? `${place.name}, ${place.city}` : place.name,
  }));

/** The place named in the text, or null when none is. `places` is the list, PLACES by default. */
export function findPlace(idea: string, places: readonly Place[] = PLACES): string | null {
  const text = ` ${normalizeWords(idea)} `;
  let best: Entry | null = null;
  for (const entry of entriesOf(places)) {
    if (!entry.match || !text.includes(` ${entry.match} `)) continue;
    if (!entry.match.includes(" ") && COMMON_WORDS.has(entry.match)) continue;
    if (!best || entry.match.length > best.match.length) best = entry;
  }
  return best?.label ?? null;
}
