/**
 * Which migration files there are and in which order they run. Pure: it only reads the names it is
 * given. A migration is NNN_name.sql, numbered 001, 002... with no repeats and no gaps; any other
 * .sql name is an error, so a file cannot be silently skipped.
 */

export interface MigrationFile {
  number: number;
  name: string;
}

const MIGRATION_NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

/** The .sql files of the directory in order. Other files are ignored. Throws on a bad name, a repeat or a gap. */
export function orderMigrations(names: readonly string[]): MigrationFile[] {
  // Any case of .sql counts, so that a misnamed file is an error and never skipped
  const files = names.filter((name) => /\.sql$/i.test(name)).map((name) => {
    const match = MIGRATION_NAME.exec(name);
    if (!match) throw new Error(`Migration file name is not NNN_name.sql: ${name}`);
    return { number: Number(match[1]), name };
  });
  files.sort((a, b) => a.number - b.number);

  files.forEach((file, index) => {
    const expected = index + 1;
    if (file.number === files[index - 1]?.number) throw new Error(`Migration number ${file.number} is used twice`);
    if (file.number !== expected) throw new Error(`Migration number ${expected} is missing`);
  });
  return files;
}
