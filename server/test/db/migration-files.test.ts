import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { orderMigrations } from "../../db/migration-files.js";
import { MIGRATIONS_DIRECTORY } from "../../db/migrate.js";

describe("orderMigrations", () => {
  test("orders the numbered files and ignores other files", () => {
    const order = orderMigrations(["002_b.sql", "README.md", "001_a.sql", "003_c_d.sql"]);
    assert.deepEqual(order, [
      { number: 1, name: "001_a.sql" },
      { number: 2, name: "002_b.sql" },
      { number: 3, name: "003_c_d.sql" },
    ]);
  });

  test("an empty directory has no migrations", () => {
    assert.deepEqual(orderMigrations([]), []);
  });

  test("a repeated number is refused", () => {
    assert.throws(() => orderMigrations(["001_a.sql", "002_b.sql", "002_c.sql"]), /Migration number 2 is used twice/);
  });

  test("a gap is refused", () => {
    assert.throws(() => orderMigrations(["001_a.sql", "003_c.sql"]), /Migration number 2 is missing/);
  });

  test("a sequence that does not start at 1 is refused", () => {
    assert.throws(() => orderMigrations(["002_b.sql"]), /Migration number 1 is missing/);
  });

  test("a .sql file whose name does not match NNN_name.sql is refused", () => {
    for (const name of ["1_a.sql", "001-a.sql", "001_A.sql", "001_a.SQL", "0001_a.sql"]) {
      assert.throws(() => orderMigrations([name]), /not NNN_name\.sql/, name);
    }
  });

  test("the real migrations directory is a valid sequence", async () => {
    const names = (await readdir(MIGRATIONS_DIRECTORY)).filter((name) => name.endsWith(".sql"));
    assert.deepEqual(orderMigrations(names).map((file) => file.number), names.map((_, index) => index + 1));
    assert.ok(names.includes("001_plans.sql"));
  });
});
