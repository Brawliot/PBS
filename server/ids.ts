/** The shape of a UUID, in either case. Ids are compared as the server gives them (lowercase), so an upper-case one is simply not found. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
