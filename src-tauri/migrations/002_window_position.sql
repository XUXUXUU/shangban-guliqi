BEGIN;
CREATE TABLE window_position (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    x INTEGER NOT NULL,
    y INTEGER NOT NULL
);
PRAGMA user_version = 2;
COMMIT;
