-- Authorization foundation only: no public creation, invitation or mutation API.
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','ACTIVE','RESTRICTED','SUSPENDED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('OWNER','ADMIN','LISTING_MANAGER','AGENT','ANALYST')),
  state text NOT NULL CHECK (state IN ('INVITED','ACTIVE','SUSPENDED','REVOKED','DECLINED','EXPIRED')),
  changed_by uuid NOT NULL REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organization_current_member ON organization_memberships(organization_id,user_id)
  WHERE state IN ('INVITED','ACTIVE','SUSPENDED');
-- Terminal episodes retain attribution; future invitation/mutation workflows must
-- add audited transitions and final-owner preservation before exposing writes.
