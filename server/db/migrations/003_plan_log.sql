-- Log of the decisions on facts and proposals: only rows are added, the trigger refuses any change or removal.
CREATE TABLE plan_log (
  id bigserial PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES plans (id),
  at timestamptz NOT NULL,
  actor text NOT NULL CHECK (actor IN ('user', 'ai', 'system')),
  kind text NOT NULL CHECK (kind IN (
    'fact_proposed', 'fact_confirmed', 'fact_rejected',
    'proposal_created', 'proposal_accepted', 'proposal_rejected'
  )),
  ref_id text NOT NULL
);
CREATE INDEX plan_log_plan_id_id ON plan_log (plan_id, id);

CREATE FUNCTION plan_log_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'plan_log is append-only';
END;
$$;

CREATE TRIGGER plan_log_append_only
  BEFORE UPDATE OR DELETE ON plan_log
  FOR EACH ROW EXECUTE FUNCTION plan_log_refuse_change();
