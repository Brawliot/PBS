-- BORRA todos los planes, informes, historial de pasos y registro de decisiones.
-- No se puede deshacer una vez confirmado. Lo ejecuta el dueño del proyecto, a mano, en la base de
-- datos que corresponda, y solo después de haber leído count-rows.sql.
--
-- Las cuatro tablas van en una sola sentencia: plan_events, plan_log y reports apuntan a plans, y
-- PostgreSQL no deja vaciar plans sola. TRUNCATE no dispara el bloqueo de solo-añadir de plan_events
-- y plan_log: por eso esta limpieza sí puede vaciarlas.
--
-- La transacción va envuelta: si el resultado no es el esperado, escribir ROLLBACK en vez de COMMIT.
--   psql "$DATABASE_URL" -f db/maintenance/clear-plan-data.sql

BEGIN;
TRUNCATE plans, reports, plan_events, plan_log;
COMMIT;
