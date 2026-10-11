-- Users. Every plan, report and analysis job belongs to one of them.
-- Sign-up and login come later (point 4 of the phase): until then the provisional user below owns everything.
-- There is no birth date and no table for sessions or verification codes: both belong to point 4.
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  -- NULL means this user cannot sign in
  password_hash text,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The provisional user. Point 4 (registration and login) removes it, once the real users exist.
-- The address ends in .invalid, a domain reserved so it can never be a real person's mailbox.
INSERT INTO users (id, email, name, password_hash)
VALUES ('00000000-0000-0000-0000-000000000001', 'provisional@local.invalid', 'Provisional', NULL);

-- The owners must be uuids. The check runs first, so a database with old owners (for example "local")
-- stops here and nothing changes. The message counts rows and never shows their values.
-- To clear that data: server/db/maintenance/clear-plan-data.sql
DO $$
DECLARE
  bad integer;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT user_id FROM plans
    UNION ALL
    SELECT user_id FROM reports
  ) AS owners
  WHERE user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF bad > 0 THEN
    RAISE EXCEPTION 'plans and reports have % rows whose user_id is not a uuid; clear that data first (server/db/maintenance/clear-plan-data.sql)', bad;
  END IF;
END
$$;

ALTER TABLE plans
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid,
  ADD CONSTRAINT plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id);

ALTER TABLE reports
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid,
  ADD CONSTRAINT reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id);
