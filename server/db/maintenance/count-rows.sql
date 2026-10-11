-- Cuenta las filas de las tablas de planes y de cuántas no tienen un usuario uuid.
-- Solo lee: no cambia nada. Ejecutar antes de borrar nada, para saber qué hay:
--   psql "$DATABASE_URL" -f db/maintenance/count-rows.sql

SELECT 'plans' AS tabla, count(*) AS filas FROM plans
UNION ALL SELECT 'reports', count(*) FROM reports
UNION ALL SELECT 'plan_events', count(*) FROM plan_events
UNION ALL SELECT 'plan_log', count(*) FROM plan_log
-- The check reads the column as text: after migration 004 the column is a uuid, which always passes it
UNION ALL SELECT 'plans con user_id que no es uuid',
  count(*) FROM plans
  WHERE user_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
UNION ALL SELECT 'reports con user_id que no es uuid',
  count(*) FROM reports
  WHERE user_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
