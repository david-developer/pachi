CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS "foundation_metadata" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "foundation_metadata" ("name") VALUES ('local-foundation') ON CONFLICT ("name") DO NOTHING;
