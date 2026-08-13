/* Persist a user's decision that a placement is not interesting to them.
   Existing rows remain false and all existing placement/application data is unchanged. */

ALTER TABLE placements
  ADD COLUMN IF NOT EXISTS not_interested boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN placements.not_interested IS
  'When true, the placement is hidden from the normal opportunities view and shown in the Not Interested section.';
