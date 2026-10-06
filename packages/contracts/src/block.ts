export type OwnBlockResponse = { id:string; subject_kind:'USER'|'PROVIDER_ACCOUNT'; state:'ACTIVE'|'REVOKED'; created_at:string; revoked_at:string|null; version:number };
export type OwnBlockListResponse = { items:OwnBlockResponse[]; next_cursor:string|null };
export type ContactSafetyResponse = { can_contact:boolean; can_block:boolean; own_block:OwnBlockResponse|null };
export type UnblockRequest = { expected_version:number };
