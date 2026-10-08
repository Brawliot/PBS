-- Plans: one JSON document per row. version is the optimistic lock: every change adds one.
CREATE TABLE plans (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  title text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  schema_version integer NOT NULL CHECK (schema_version >= 1),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- History of the steps. Only rows are added: the trigger refuses any change or removal.
CREATE TABLE plan_events (
  id bigserial PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES plans (id),
  step_id text NOT NULL,
  at timestamptz NOT NULL,
  actor text NOT NULL CHECK (actor IN ('user', 'ai', 'system')),
  action text NOT NULL CHECK (action IN (
    'launch', 'attach_output', 'answer', 'confirm_output', 'reject_output', 'submit_proof',
    'wait_third_party', 'third_party_responded', 'reopen', 'change_executor'
  )),
  status_from text NOT NULL CHECK (status_from IN (
    'not_started', 'running', 'waiting_user', 'waiting_third_party', 'done', 'rejected'
  )),
  status_to text NOT NULL CHECK (status_to IN (
    'not_started', 'running', 'waiting_user', 'waiting_third_party', 'done', 'rejected'
  )),
  executor_from text CHECK (executor_from IN ('ai', 'user', 'third_party')),
  executor_to text CHECK (executor_to IN ('ai', 'user', 'third_party')),
  CHECK ((executor_from IS NULL) = (executor_to IS NULL))
);
CREATE INDEX plan_events_plan_id_id ON plan_events (plan_id, id);

CREATE FUNCTION plan_events_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'plan_events is append-only';
END;
$$;

CREATE TRIGGER plan_events_append_only
  BEFORE UPDATE OR DELETE ON plan_events
  FOR EACH ROW EXECUTE FUNCTION plan_events_refuse_change();
