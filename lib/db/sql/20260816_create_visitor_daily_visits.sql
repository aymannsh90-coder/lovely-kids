CREATE TABLE IF NOT EXISTS visitor_daily_visits (
  id SERIAL PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  visit_date DATE NOT NULL,
  country TEXT NOT NULL DEFAULT 'XX',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS visitor_daily_visits_visitor_day_idx
  ON visitor_daily_visits(visitor_id, visit_date);

CREATE INDEX IF NOT EXISTS visitor_daily_visits_date_idx
  ON visitor_daily_visits(visit_date);

CREATE INDEX IF NOT EXISTS visitor_daily_visits_country_date_idx
  ON visitor_daily_visits(country, visit_date);

ALTER TABLE visitor_daily_visits ENABLE ROW LEVEL SECURITY;
