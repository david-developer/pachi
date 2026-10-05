import { createHmac } from 'node:crypto';
import type postgres from 'postgres';
import { z } from 'zod';
import { analyticsSnapshotSchema } from './analytics-context.js';
import { responseTimeBucket } from './conversation.js';

export const ANALYTICS_CONSUMER = 'g2-analytics-v1';
export const RESPONSE_FILTER_VERSION = 'provider-response-v1';
export const ANALYTICS_STREAMS = [
  'listing_revision_moderation_outbox',
  'interaction_outbox',
  'communication_outbox',
] as const;
export type AnalyticsStream = (typeof ANALYTICS_STREAMS)[number];
type Classification = 'PRODUCTION' | 'TEST';
type Dimensions = {
  environment: string;
  classification: Classification;
  region: string | null;
  purpose: string | null;
  provider_types: string[] | null;
  verification_claim: string | null;
  verification_status: string | null;
  exclusion_reason: string | null;
};
type Source = {
  id: string;
  event_name: string;
  occurred_at: string;
  safe_payload: Record<string, unknown>;
  listing_id: string;
  provider_account_id: string;
  interaction_id: string | null;
  message_id: string | null;
  submission_id: string | null;
  revision_id: string | null;
  actor_id: string | null;
  schema_version: number;
};
type Contact = Dimensions & {
  event_id: string;
  listing_id: string;
  provider_account_id: string;
  duration_ms: number;
};
export type ResponseSegments = {
  region?: 'Southwest' | 'Littoral';
  purpose?: 'RENT' | 'SALE' | 'SHORT_LET';
  provider_type?:
    | 'OWNER'
    | 'INDEPENDENT_AGENT'
    | 'PROPERTY_MANAGER'
    | 'ORGANIZATION';
  verification_status?: 'VERIFIED' | 'NOT_VERIFIED';
  verification_claim?: 'PROVIDER_IDENTITY';
  provider_account_id?: string;
};
export type ResponseReportInput = {
  window_start?: string;
  window_end?: string;
  as_of: string;
  environment?: 'development' | 'test' | 'staging' | 'production';
  classification?: Classification;
  segments?: ResponseSegments;
};

const segmentsSchema = z
  .object({
    region: z.enum(['Southwest', 'Littoral']).optional(),
    purpose: z.enum(['RENT', 'SALE', 'SHORT_LET']).optional(),
    provider_type: z
      .enum(['OWNER', 'INDEPENDENT_AGENT', 'PROPERTY_MANAGER', 'ORGANIZATION'])
      .optional(),
    verification_status: z.enum(['VERIFIED', 'NOT_VERIFIED']).optional(),
    verification_claim: z.literal('PROVIDER_IDENTITY').optional(),
    provider_account_id: z.uuid().optional(),
  })
  .strict();

// Preserve PostgreSQL's microseconds for exact maturity/deadline comparisons.
function utcTimestamp(value: string): string {
  if (
    !z.iso.datetime({ offset: true }).safeParse(value).success ||
    (value.match(/\.(\d+)/)?.[1]?.length ?? 0) > 6
  )
    throw new Error('ANALYTICS_INVALID_REPORT_WINDOW');
  const extra = value.match(/\.\d{3}(\d{1,3})/)?.[1] ?? '';
  return new Date(value).toISOString().replace('Z', `${extra}Z`);
}

function sourceDimensions(
  payload: Record<string, unknown>,
): Dimensions & { dimension_provenance: string } {
  if (payload.analytics === undefined)
    return {
      environment: 'unknown',
      classification: 'TEST',
      region: null,
      purpose: null,
      provider_types: null,
      verification_claim: null,
      verification_status: null,
      exclusion_reason: 'INCOMPLETE_SOURCE_CONTEXT',
      dimension_provenance: 'UNKNOWN_LEGACY',
    };
  const snapshot = analyticsSnapshotSchema.safeParse(payload.analytics);
  if (!snapshot.success) throw new Error('ANALYTICS_INVALID_SOURCE_CONTEXT');
  const { version: _version, ...dimensions } = snapshot.data;
  return {
    ...dimensions,
    exclusion_reason: null,
    dimension_provenance: 'SOURCE_SNAPSHOT_V1',
  };
}

export class AnalyticsStore {
  constructor(
    private readonly client: postgres.Sql,
    private readonly pseudonymSecret: string,
  ) {
    if (pseudonymSecret.length < 32)
      throw new Error(
        'ANALYTICS_PSEUDONYM_SECRET must contain at least 32 characters',
      );
  }

  // Locks committed source rows, without interpreting delivered/published as a
  // consumer acknowledgement. Every projection and its receipt share one commit.
  async processAnalyticsOnce(
    options: { streams?: readonly AnalyticsStream[]; limit?: number } = {},
  ) {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('ANALYTICS_INVALID_BATCH_SIZE');
    let consumed = 0,
      deferred = 0;
    for (const stream of options.streams ?? ANALYTICS_STREAMS) {
      if (!ANALYTICS_STREAMS.includes(stream))
        throw new Error('ANALYTICS_INVALID_STREAM');
      const result = await this.client.begin(async (tx) => {
        // Fixed identifiers selected from the allowlist above, never caller SQL.
        const pending = tx`NOT EXISTS (SELECT 1 FROM job_receipts jr WHERE jr.consumer_name=${ANALYTICS_CONSUMER} AND jr.source_stream=${stream} AND jr.source_event_id=o.id)`;
        let sources: Source[];
        if (stream === 'listing_revision_moderation_outbox') {
          sources = await tx<
            Source[]
          >`SELECT o.id,'listing_published' AS event_name,a.created_at::text AS occurred_at,o.safe_payload,a.listing_id,l.provider_account_id,NULL::uuid AS interaction_id,NULL::uuid AS message_id,a.submission_id,a.listing_revision_id AS revision_id,NULL::uuid AS actor_id,1 AS schema_version
            FROM listing_revision_moderation_outbox o JOIN listing_revision_moderation_actions a ON a.id=o.action_id JOIN listings l ON l.id=a.listing_id
            WHERE o.event_type='LISTING_PUBLISHED' AND a.command='APPROVE_AND_PUBLISH' AND ${pending} ORDER BY o.created_at,o.id LIMIT ${limit} FOR UPDATE OF o SKIP LOCKED`;
        } else if (stream === 'interaction_outbox') {
          sources = await tx<
            Source[]
          >`SELECT o.id,o.event_type AS event_name,i.opened_at::text AS occurred_at,o.safe_payload,i.listing_id,i.provider_account_id,i.id AS interaction_id,NULL::uuid AS message_id,NULL::uuid AS submission_id,NULL::uuid AS revision_id,i.seeker_user_id AS actor_id,1 AS schema_version
            FROM interaction_outbox o JOIN interactions i ON i.id=o.interaction_id WHERE ${pending} ORDER BY o.created_at,o.id LIMIT ${limit} FOR UPDATE OF o SKIP LOCKED`;
        } else {
          // Missing contact projections are not selected, so a backlog of orphans
          // cannot starve independent, ready communication rows at the batch limit.
          sources = await tx<
            Source[]
          >`SELECT o.id,o.event_type AS event_name,o.occurred_at::text AS occurred_at,o.safe_payload,i.listing_id,i.provider_account_id,i.id AS interaction_id,o.message_id,NULL::uuid AS submission_id,NULL::uuid AS revision_id,m.sender_user_id AS actor_id,o.schema_version
            FROM communication_outbox o JOIN interactions i ON i.id=o.interaction_id JOIN messages m ON m.id=o.message_id
            WHERE ${pending} AND EXISTS (SELECT 1 FROM analytics_events ae WHERE ae.event_name='interaction_created' AND ae.interaction_id=o.interaction_id)
            ORDER BY o.occurred_at,o.id LIMIT ${limit} FOR UPDATE OF o SKIP LOCKED`;
        }
        let n = 0;
        for (const source of sources) {
          let dimensions: Dimensions & { dimension_provenance: string };
          let contactId: string | null = null,
            bucket: string | null = null,
            duration: number | null = null;
          if (stream === 'communication_outbox') {
            const contacts = await tx<
              Contact[]
            >`SELECT *, (extract(epoch FROM (${source.occurred_at}::timestamptz-occurred_at))*1000)::double precision AS duration_ms FROM analytics_events WHERE event_name='interaction_created' AND interaction_id=${source.interaction_id}`;
            const contact = contacts[0]!;
            if (
              contact.listing_id !== source.listing_id ||
              contact.provider_account_id !== source.provider_account_id ||
              contact.duration_ms < 0
            )
              throw new Error('ANALYTICS_INVALID_CONTACT_CORRELATION');
            dimensions = {
              environment: contact.environment,
              classification: contact.classification,
              region: contact.region,
              purpose: contact.purpose,
              provider_types: contact.provider_types,
              verification_claim: contact.verification_claim,
              verification_status: contact.verification_status,
              exclusion_reason: contact.exclusion_reason,
              dimension_provenance: 'CONTACT_PROJECTION',
            };
            contactId = contact.event_id;
            if (source.event_name === 'provider_first_response') {
              duration = contact.duration_ms;
              bucket = responseTimeBucket(duration);
              if (
                source.schema_version !== 1 ||
                source.safe_payload.response_time_bucket !== bucket
              )
                throw new Error('ANALYTICS_RESPONSE_BUCKET_MISMATCH');
            }
          } else dimensions = sourceDimensions(source.safe_payload);
          const actor = source.actor_id
            ? createHmac('sha256', this.pseudonymSecret)
                .update(`pachi-analytics-user-v1:${source.actor_id}`)
                .digest('hex')
            : null;
          const events = await tx<
            { event_id: string }[]
          >`INSERT INTO analytics_events(event_name,occurred_at,environment,classification,source_stream,source_event_id,listing_id,provider_account_id,interaction_id,contact_event_id,message_id,submission_id,revision_id,region,purpose,provider_types,verification_claim,verification_status,dimension_provenance,actor_pseudonym,response_time_bucket,response_bucket_version,response_duration_ms,exclusion_reason)
            VALUES (${source.event_name},${source.occurred_at}::timestamptz,${dimensions.environment},${dimensions.classification},${stream},${source.id},${source.listing_id},${source.provider_account_id},${source.interaction_id},${contactId},${source.message_id},${source.submission_id},${source.revision_id},${dimensions.region},${dimensions.purpose},${dimensions.provider_types},${dimensions.verification_claim},${dimensions.verification_status},${dimensions.dimension_provenance},${actor},${bucket},${bucket ? 1 : null},${duration},${dimensions.exclusion_reason})
            ON CONFLICT (source_stream,source_event_id) DO NOTHING RETURNING event_id`;
          const eventId =
            events[0]?.event_id ??
            (
              await tx<
                { event_id: string }[]
              >`SELECT event_id FROM analytics_events WHERE source_stream=${stream} AND source_event_id=${source.id}`
            )[0]!.event_id;
          await tx`INSERT INTO job_receipts(consumer_name,source_stream,source_event_id,result_reference) VALUES (${ANALYTICS_CONSUMER},${stream},${source.id},${eventId})`;
          n++;
        }
        return n;
      });
      consumed += result;
    }
    if (
      (options.streams ?? ANALYTICS_STREAMS).includes('communication_outbox')
    ) {
      const rows = await this.client<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM communication_outbox o WHERE NOT EXISTS (SELECT 1 FROM job_receipts jr WHERE jr.consumer_name=${ANALYTICS_CONSUMER} AND jr.source_stream='communication_outbox' AND jr.source_event_id=o.id) AND NOT EXISTS (SELECT 1 FROM analytics_events ae WHERE ae.event_name='interaction_created' AND ae.interaction_id=o.interaction_id)`;
      deferred = rows[0]!.n;
    }
    return { consumed, deferred };
  }

  async providerResponseSummary(input: ResponseReportInput) {
    const asOf = utcTimestamp(input.as_of);
    const end = utcTimestamp(input.window_end ?? input.as_of);
    const start = utcTimestamp(
      input.window_start ??
        new Date(Date.parse(end) - 7 * 86_400_000)
          .toISOString()
          .replace('Z', `${end.match(/\.\d{3}(\d{1,3})/)?.[1] ?? ''}Z`),
    );
    const environment = z
      .enum(['development', 'test', 'staging', 'production'])
      .parse(input.environment ?? 'production');
    const classification = z
      .enum(['PRODUCTION', 'TEST'])
      .parse(input.classification ?? 'PRODUCTION');
    const segments = segmentsSchema.parse(input.segments ?? {});
    const sql = this.client;
    const bounds = await sql<
      { valid: boolean }[]
    >`SELECT ${start}::timestamptz<${end}::timestamptz AND ${end}::timestamptz<=${asOf}::timestamptz AS valid`;
    if (!bounds[0]!.valid) throw new Error('ANALYTICS_INVALID_REPORT_WINDOW');
    const rows = await sql<
      {
        denominator: number;
        numerator: number;
        median_ms: number | null;
        late_responses: number;
        immature: number;
        nonproduction: number;
        incomplete: number;
      }[]
    >`
      WITH contacts AS (
        SELECT ae.*,ae.occurred_at+interval '24 hours' AS deadline FROM analytics_events ae WHERE ae.event_name='interaction_created'
          AND ae.occurred_at>=${start}::timestamptz AND ae.occurred_at<${end}::timestamptz
          ${segments.region === undefined ? sql`` : sql`AND ae.region=${segments.region}`}
          ${segments.purpose === undefined ? sql`` : sql`AND ae.purpose=${segments.purpose}`}
          ${segments.provider_type === undefined ? sql`` : sql`AND ${segments.provider_type}=ANY(ae.provider_types)`}
          ${segments.verification_status === undefined ? sql`` : sql`AND ae.verification_status=${segments.verification_status}`}
          ${segments.verification_claim === undefined ? sql`` : sql`AND ae.verification_claim=${segments.verification_claim}`}
          ${segments.provider_account_id === undefined ? sql`` : sql`AND ae.provider_account_id=${segments.provider_account_id}::uuid`}
      ), cohort AS (
        SELECT c.*,r.occurred_at AS response_at,extract(epoch FROM (r.occurred_at-c.occurred_at))*1000 AS duration_ms,
          c.environment=${environment} AND c.classification=${classification} AND c.exclusion_reason IS NULL AS included
        FROM contacts c LEFT JOIN analytics_events r ON r.contact_event_id=c.event_id AND r.event_name='provider_first_response' AND r.occurred_at<=${asOf}::timestamptz
      ) SELECT
        (count(*) FILTER (WHERE included AND deadline<=${asOf}::timestamptz))::int AS denominator,
        (count(*) FILTER (WHERE included AND deadline<=${asOf}::timestamptz AND response_at<=deadline))::int AS numerator,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE included AND deadline<=${asOf}::timestamptz AND response_at<=deadline) AS median_ms,
        (count(*) FILTER (WHERE included AND deadline<=${asOf}::timestamptz AND response_at>deadline))::int AS late_responses,
        (count(*) FILTER (WHERE included AND deadline>${asOf}::timestamptz))::int AS immature,
        (count(*) FILTER (WHERE environment<>${environment} OR classification<>${classification}))::int AS nonproduction,
        (count(*) FILTER (WHERE exclusion_reason='INCOMPLETE_SOURCE_CONTEXT'))::int AS incomplete FROM cohort`;
    const r = rows[0]!;
    return {
      metric_name: 'provider_response',
      metric_version: 1,
      window_start: start,
      window_end: end,
      as_of: asOf,
      observation_window_hours: 24,
      numerator: r.numerator,
      denominator: r.denominator,
      response_rate: r.denominator ? r.numerator / r.denominator : null,
      unanswered_mature_contacts: r.denominator - r.numerator,
      responded_mature_contacts: r.numerator,
      late_responded_mature_contacts: r.late_responses,
      median_response_duration_ms: r.median_ms,
      median_sample_size: r.numerator,
      sample_size: r.denominator,
      filter_version: RESPONSE_FILTER_VERSION,
      environment,
      classification,
      applied_segment_filters: { ...segments },
      insufficient_sample: r.denominator === 0 ? true : null,
      insufficient_sample_threshold: null,
      sample_threshold_status: 'NOT_YET_FROZEN',
      pilot_contact_minimum: 30,
      pilot_window_minimum_days: 14,
      exclusions: {
        CLASSIFICATION_OR_ENVIRONMENT: r.nonproduction,
        INCOMPLETE_SOURCE_CONTEXT: r.incomplete,
        IMMATURE_CONTACT: r.immature,
      },
      spam_filter_status: 'AWAITING_APPROVED_DURABLE_SIGNAL',
      self_contact_filter: 'STRUCTURALLY_DENIED_BY_INQUIRY_DOMAIN',
    };
  }
}
