/**
 * The places the detection can find in a description. A municipality is { name }: the INE list of Spanish
 * municipalities (name and province). A neighbourhood is { name, city }: the neighbourhoods of the big cities.
 *
 * NOT YET FILLED. The INE list could not be downloaded in the environment that built this file (www.ine.es is
 * not in its allowed domains), and no list is written here from memory. Until it is filled, the detection finds
 * no place from the text and the location question is asked as before.
 */

export interface Place {
  name: string;
  city?: string;
}

export const PLACES: readonly Place[] = [];
