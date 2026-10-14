ALTER TABLE lead_submissions ADD COLUMN tool TEXT NOT NULL DEFAULT 'shiplog' CHECK (tool = 'shiplog');

-- Separate tool interest does not overwrite a Shiplog lead from the same page.
CREATE TABLE tool_interest_requests (
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('follow_up_social', 'follow_up_people', 'follow_up_agents')),
  tool TEXT NOT NULL CHECK (tool IN ('social', 'people', 'agents')),
  created_at TEXT NOT NULL,
  topic TEXT NOT NULL,
  message TEXT,
  PRIMARY KEY (email, purpose, tool)
);
