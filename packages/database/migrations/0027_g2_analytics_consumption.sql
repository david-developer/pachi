-- Application-owned, privacy-allowlisted G2 projection. Source delivery flags are untouched.
CREATE TABLE analytics_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL CHECK (event_name IN ('listing_published','interaction_created','message_sent','provider_first_response')),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  environment text NOT NULL CHECK (environment IN ('development','test','staging','production','unknown')),
  classification text NOT NULL CHECK (classification IN ('PRODUCTION','TEST')),
  source_stream text NOT NULL CHECK (source_stream IN ('listing_revision_moderation_outbox','interaction_outbox','communication_outbox')),
  source_event_id uuid NOT NULL,
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  provider_account_id uuid NOT NULL REFERENCES provider_accounts(id) ON DELETE RESTRICT,
  interaction_id uuid REFERENCES interactions(id) ON DELETE RESTRICT,
  contact_event_id uuid REFERENCES analytics_events(event_id) ON DELETE RESTRICT,
  message_id uuid REFERENCES messages(id) ON DELETE RESTRICT,
  submission_id uuid REFERENCES listing_submissions(id) ON DELETE RESTRICT,
  revision_id uuid REFERENCES listing_revisions(id) ON DELETE RESTRICT,
  region text CHECK (region IN ('Southwest','Littoral')),
  purpose text CHECK (purpose IN ('RENT','SALE','SHORT_LET')),
  provider_types text[] CHECK (provider_types <@ ARRAY['OWNER','INDEPENDENT_AGENT','PROPERTY_MANAGER','ORGANIZATION']::text[] AND cardinality(provider_types)>0),
  verification_claim text CHECK (verification_claim='PROVIDER_IDENTITY'),
  verification_status text CHECK (verification_status IN ('VERIFIED','NOT_VERIFIED')),
  dimension_provenance text NOT NULL CHECK (dimension_provenance IN ('SOURCE_SNAPSHOT_V1','CONTACT_PROJECTION','UNKNOWN_LEGACY')),
  actor_pseudonym text CHECK (actor_pseudonym ~ '^[a-f0-9]{64}$'),
  response_time_bucket text CHECK (response_time_bucket IN ('LT_5M','M5_TO_15M','M15_TO_60M','H1_TO_4H','H4_TO_24H','GT_24H')),
  response_bucket_version integer CHECK (response_bucket_version=1),
  response_duration_ms double precision CHECK (response_duration_ms>=0),
  filter_version text NOT NULL DEFAULT 'provider-response-v1' CHECK (filter_version='provider-response-v1'),
  exclusion_reason text CHECK (exclusion_reason IN ('INCOMPLETE_SOURCE_CONTEXT')),
  UNIQUE (source_stream,source_event_id),
  CHECK (classification<>'PRODUCTION' OR environment='production'),
  CHECK ((event_name='listing_published' AND source_stream='listing_revision_moderation_outbox' AND interaction_id IS NULL AND contact_event_id IS NULL AND message_id IS NULL AND submission_id IS NOT NULL AND revision_id IS NOT NULL)
    OR (event_name='interaction_created' AND source_stream='interaction_outbox' AND interaction_id IS NOT NULL AND contact_event_id IS NULL AND message_id IS NULL)
    OR (event_name IN ('message_sent','provider_first_response') AND source_stream='communication_outbox' AND interaction_id IS NOT NULL AND contact_event_id IS NOT NULL AND message_id IS NOT NULL)),
  CHECK ((event_name='provider_first_response' AND response_time_bucket IS NOT NULL AND response_bucket_version IS NOT NULL AND response_duration_ms IS NOT NULL)
    OR (event_name<>'provider_first_response' AND response_time_bucket IS NULL AND response_bucket_version IS NULL AND response_duration_ms IS NULL))
);
CREATE UNIQUE INDEX analytics_contact_unique ON analytics_events(interaction_id) WHERE event_name='interaction_created';
CREATE UNIQUE INDEX analytics_first_response_unique ON analytics_events(interaction_id) WHERE event_name='provider_first_response';
CREATE INDEX analytics_cohort_idx ON analytics_events(environment,classification,occurred_at) WHERE event_name='interaction_created';
CREATE INDEX analytics_contact_idx ON analytics_events(contact_event_id);

-- Generic consumer receipts; result_reference can identify a result in any consumer-owned store.
CREATE TABLE job_receipts (
  consumer_name text NOT NULL,
  source_stream text NOT NULL,
  source_event_id uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  result_reference uuid NOT NULL,
  PRIMARY KEY (consumer_name,source_stream,source_event_id)
);
