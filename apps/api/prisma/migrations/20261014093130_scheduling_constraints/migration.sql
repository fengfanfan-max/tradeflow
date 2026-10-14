-- Scheduling invariants, enforced by the database rather than by the service.
--
-- The service checks for a clash before inserting, but two office users booking
-- the same engineer at the same moment both pass that check and both insert. The
-- application check is a courtesy that produces a good error message; this
-- constraint is what actually guarantees the invariant.

-- btree_gist lets one GiST index combine an equality operator (assigneeId) with
-- a range operator, which a plain GiST index cannot do.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- An end before its start is not a schedule. Checked here because a bad range
-- would also make the exclusion constraint below meaningless.
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_schedule_ordered"
  CHECK ("scheduledEnd" > "scheduledStart");

-- No engineer is in two places at once.
--
-- '[)' is deliberate: a job ending at 12:00 and the next starting at 12:00 do
-- not overlap, which is how back-to-back appointments are meant to work.
--
-- CANCELLED jobs are excluded from the constraint, and so are unassigned ones,
-- because neither occupies an engineer's time.
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_no_overlapping_assignments"
  EXCLUDE USING gist (
    "assigneeId" WITH =,
    tstzrange("scheduledStart", "scheduledEnd", '[)') WITH &&
  )
  WHERE ("assigneeId" IS NOT NULL AND status <> 'CANCELLED');
