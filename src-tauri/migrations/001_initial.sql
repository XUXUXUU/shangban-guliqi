BEGIN;
CREATE TABLE profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL CHECK (json_valid(payload))
);
PRAGMA user_version = 1;
COMMIT;
