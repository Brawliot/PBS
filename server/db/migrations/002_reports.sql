-- Reports: the planner's report, kept by the server and asked for by id. plan_id is set once, when the
-- first plan is made from the report; the unique key allows one plan per report.
CREATE TABLE reports (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  report jsonb NOT NULL,
  plan_id uuid UNIQUE REFERENCES plans (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
