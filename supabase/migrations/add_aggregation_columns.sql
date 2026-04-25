ALTER TABLE aggregation_batches 
  ADD COLUMN IF NOT EXISTS estimated_gas_saved NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aggregation_time_ms INTEGER DEFAULT 0;

-- Update existing rows with derived values
UPDATE aggregation_batches SET
  estimated_gas_saved = gas_used * gas_saved_pct / 100,
  aggregation_time_ms = latency_ms
WHERE estimated_gas_saved = 0;
