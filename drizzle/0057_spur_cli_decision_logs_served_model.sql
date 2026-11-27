-- P12 R1: the model a backend actually served, per decision row. Nullable and additive: rows
-- written before this migration (and every non-typesafe maker, fallback or rejection) read NULL.
ALTER TABLE decision_logs ADD COLUMN served_model TEXT;
