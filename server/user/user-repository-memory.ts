/**
 * In-memory UserRepository for the unit tests. It applies the same checks as the database one, and a read
 * gives a new copy, so a caller cannot change what is stored.
 */

import { randomUUID } from "node:crypto";
import { isUserId, prepareUser, UserStoreError, type StoredUser, type UserRepository } from "./user-repository.js";

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, StoredUser>();

  async create(email: string, name: string, passwordHash: string | null = null): Promise<StoredUser> {
    const prepared = prepareUser(email, name);
    if ([...this.users.values()].some((user) => user.email === prepared.email)) throw new UserStoreError("email_taken");
    const user: StoredUser = {
      id: randomUUID(),
      email: prepared.email,
      name: prepared.name,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    return { ...user };
  }

  async findByEmail(email: string): Promise<StoredUser | undefined> {
    const wanted = email.trim().toLowerCase();
    const user = [...this.users.values()].find((candidate) => candidate.email === wanted);
    return user && { ...user };
  }

  async findById(id: string): Promise<StoredUser | undefined> {
    const user = isUserId(id) ? this.users.get(id) : undefined;
    return user && { ...user };
  }
}
