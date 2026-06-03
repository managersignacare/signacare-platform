# Runbook — Backup / Restore Drill

_Placeholder — populated alongside the quality docs set._

Procedure for quarterly drill: take a PG Flexible Server point-in-time restore into a scratch server, validate RLS policies, validate row counts match a known snapshot, run a scripted clinical-workflow smoke pass, retain the drill log as evidence.
