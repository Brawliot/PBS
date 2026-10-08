/**
 * The connection pool to PostgreSQL, with its limits. Each limit has a default and an environment variable
 * that changes it (see README.md). The SSL mode is not set here: it comes from DATABASE_URL (sslmode=...),
 * which the driver reads as it is.
 */

import { Pool } from "pg";
import { logFailure } from "../log.js";

export interface PoolLimits {
  /** Most connections open at once */
  max: number;
  /** Milliseconds to wait for a free connection before the request fails */
  connectionTimeoutMillis: number;
  /** Milliseconds a connection may stay idle before it is closed */
  idleTimeoutMillis: number;
  /** Milliseconds a single statement may run before PostgreSQL cancels it (error code 57014) */
  statementTimeoutMillis: number;
}

export const POOL_DEFAULTS: Readonly<PoolLimits> = {
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statementTimeoutMillis: 10_000,
};

/** The environment variable of each limit */
const VARIABLES: Record<keyof PoolLimits, string> = {
  max: "DB_POOL_MAX",
  connectionTimeoutMillis: "DB_CONNECT_TIMEOUT_MS",
  idleTimeoutMillis: "DB_IDLE_TIMEOUT_MS",
  statementTimeoutMillis: "DB_STATEMENT_TIMEOUT_MS",
};

/**
 * The limits from the environment. A variable that is set but is not a positive whole number refuses to start
 * (the error names the variable and nothing else): a typo must not silently give the default.
 */
export function poolLimits(env: Record<string, string | undefined>): PoolLimits {
  const limits = { ...POOL_DEFAULTS };
  for (const key of Object.keys(VARIABLES) as (keyof PoolLimits)[]) {
    const raw = env[VARIABLES[key]];
    if (raw === undefined || raw === "") continue;
    if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`${VARIABLES[key]} must be a positive whole number`);
    limits[key] = Number(raw);
  }
  return limits;
}

/**
 * The pool for the connection string. `PoolClass` is injectable so a test can see the settings it receives.
 */
export function createPool(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
  PoolClass: typeof Pool = Pool,
): Pool {
  const limits = poolLimits(env);
  const pool = new PoolClass({
    connectionString,
    max: limits.max,
    connectionTimeoutMillis: limits.connectionTimeoutMillis,
    idleTimeoutMillis: limits.idleTimeoutMillis,
    statement_timeout: limits.statementTimeoutMillis,
  });
  pool.on("error", (error) => logFailure("postgres pool", error));
  return pool;
}
