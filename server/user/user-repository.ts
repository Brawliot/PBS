/**
 * Storage of users: what every repository promises, and the checks a user must pass on the way in.
 * The email is kept in lower case, without the spaces around it, so one address is one user. A user
 * created here has no password: it cannot sign in until the registration of point 4 sets one.
 * The errors carry codes and never the email or the name.
 */

import { UUID } from "../ids.js";

export const MAX_NAME_LENGTH = 100;
export const MAX_EMAIL_LENGTH = 254;

export interface StoredUser {
  id: string;
  /** Always lower case */
  email: string;
  name: string;
  /** Null: this user cannot sign in */
  passwordHash: string | null;
  /** ISO 8601 UTC instant */
  createdAt: string;
}

export type UserCode = "invalid_email" | "invalid_name" | "email_taken";

/** A user that cannot be stored or found. The message is fixed: the code says why, and nothing of the user goes in. */
export class UserStoreError extends Error {
  constructor(readonly code: UserCode) {
    super("User could not be stored");
  }
}

export interface UserRepository {
  /** Creates a user with no password. Throws UserStoreError if the email is not valid or is already used. */
  create(email: string, name: string): Promise<StoredUser>;
  /** The user with this email (any case, any spaces around it), or undefined */
  findByEmail(email: string): Promise<StoredUser | undefined>;
  /** The user with this id, or undefined. An id that is not a UUID is simply not found. */
  findById(id: string): Promise<StoredUser | undefined>;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The email and the name as they are kept. Throws UserStoreError for a value that is not allowed. */
export function prepareUser(email: string, name: string): { email: string; name: string } {
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(cleanEmail)) throw new UserStoreError("invalid_email");
  const cleanName = name.trim();
  if (cleanName.length === 0 || cleanName.length > MAX_NAME_LENGTH) throw new UserStoreError("invalid_name");
  return { email: cleanEmail, name: cleanName };
}

/** The id check the repositories share: a value that is not a UUID is never looked up */
export const isUserId = (id: string): boolean => UUID.test(id);
