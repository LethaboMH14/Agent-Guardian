CREATE TABLE IF NOT EXISTS nanopayments (
  id SERIAL PRIMARY KEY,
  transaction_id TEXT,
  amount NUMERIC NOT NULL,
  action TEXT NOT NULL,
  session_id TEXT,
  from_wallet TEXT,
  to_wallet TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE nanopayments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_nanopayments" ON nanopayments
  FOR SELECT USING (true);

CREATE INDEX ON nanopayments (created_at DESC);
CREATE INDEX ON nanopayments (action);
