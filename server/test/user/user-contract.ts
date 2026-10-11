/**
 * What every UserRepository must do. The in-memory and the PostgreSQL repositories both run these tests,
 * so they cannot drift apart. Each test uses its own email, so the tests can share one repository.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { UserStoreError, type UserRepository } from "../../user/user-repository.js";

export function userRepositoryContract(
  title: string,
  setup: () => Promise<{ repo: UserRepository; teardown: () => Promise<void> }>,
) {
  describe(title, () => {
    let repo: UserRepository;
    let teardown: () => Promise<void>;
    before(async () => {
      ({ repo, teardown } = await setup());
    });
    after(async () => {
      await teardown();
    });

    const freshEmail = () => `user-${randomUUID()}@example.test`;

    /** Rejects with a UserStoreError of this code, and the message carries none of the given values */
    async function assertUserError(promise: Promise<unknown>, code: string, secrets: string[] = []) {
      const error = await promise.then(
        () => assert.fail("expected a UserStoreError"),
        (e: unknown) => e,
      );
      assert.ok(error instanceof UserStoreError, String(error));
      assert.equal(error.code, code);
      const text = `${error.message} ${JSON.stringify(error)}`;
      for (const secret of secrets) assert.equal(text.includes(secret), false, "error must not carry user data");
    }

    test("create keeps the email in lower case, trims the name, and gives no password", async () => {
      const email = freshEmail();
      const created = await repo.create(`  ${email.toUpperCase()} `, "  Ana López  ");
      assert.equal(created.email, email);
      assert.equal(created.name, "Ana López");
      assert.equal(created.passwordHash, null);
      assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      assert.equal(new Date(created.createdAt).toISOString(), created.createdAt);
    });

    test("findByEmail finds the user in any case and with spaces around the address", async () => {
      const email = freshEmail();
      const created = await repo.create(email, "Bea");
      assert.deepEqual(await repo.findByEmail(`  ${email.toUpperCase()}  `), created);
      assert.equal(await repo.findByEmail(freshEmail()), undefined);
    });

    test("findById finds the user by its id; an unknown id, or one that is not a UUID, is not found", async () => {
      const created = await repo.create(freshEmail(), "Carlos");
      assert.deepEqual(await repo.findById(created.id), created);
      assert.equal(await repo.findById(randomUUID()), undefined);
      assert.equal(await repo.findById("not-a-uuid"), undefined);
    });

    test("a second user with the same email, in any case, is refused and the first one is unchanged", async () => {
      const email = freshEmail();
      const first = await repo.create(email, "Dani");
      await assertUserError(repo.create(email.toUpperCase(), "Otra persona"), "email_taken", [email]);
      assert.deepEqual(await repo.findByEmail(email), first);
    });

    test("an email that is not valid is refused, and the message does not repeat it", async () => {
      for (const bad of ["", "sin-arroba", "a@b", "con espacio@ejemplo.es", `${"x".repeat(250)}@ejemplo.es`]) {
        await assertUserError(repo.create(bad, "Eva"), "invalid_email", bad.trim() ? [bad.trim()] : []);
      }
    });

    test("a name that is empty or too long is refused", async () => {
      await assertUserError(repo.create(freshEmail(), "   "), "invalid_name");
      await assertUserError(repo.create(freshEmail(), "x".repeat(101)), "invalid_name");
      const longest = await repo.create(freshEmail(), "y".repeat(100));
      assert.equal(longest.name.length, 100);
    });
  });
}
