import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type postgres from 'postgres';

export type WebAuthSession = { id: string; userId: string; accessToken: string; refreshToken?: string; expiresAt: Date };

export class WebAuthSessionStore {
  private readonly key: Buffer;
  public constructor(private readonly client: postgres.Sql, secret: string) { this.key = createHash('sha256').update(secret).digest(); }

  public async create(userId: string, accessToken: string, refreshToken: string | undefined, expiresAt: Date): Promise<string> {
    const access = encrypt(accessToken, this.key);
    const refresh = refreshToken ? encrypt(refreshToken, this.key) : null;
    const rows = await this.client<{ id: string }[]>`INSERT INTO web_auth_sessions (user_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at) VALUES (${userId}, ${access}, ${refresh}, ${expiresAt.toISOString()}) RETURNING id`;
    const row = rows[0];
    if (!row) throw new Error('web_session_create_failed');
    return row.id;
  }

  public async read(id: string): Promise<WebAuthSession | null> {
    const rows = await this.client<{ id: string; user_id: string; access_token_ciphertext: Buffer; refresh_token_ciphertext: Buffer | null; token_expires_at: Date | string }[]>`SELECT id, user_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at FROM web_auth_sessions WHERE id = ${id} AND revoked_at IS NULL`;
    const row = rows[0];
    if (!row) return null;
    const session: WebAuthSession = { id: row.id, userId: row.user_id, accessToken: decrypt(row.access_token_ciphertext, this.key), expiresAt: new Date(row.token_expires_at) };
    if (row.refresh_token_ciphertext) session.refreshToken = decrypt(row.refresh_token_ciphertext, this.key);
    return session;
  }

  public async revoke(id: string): Promise<void> { await this.client`UPDATE web_auth_sessions SET revoked_at = now() WHERE id = ${id} AND revoked_at IS NULL`; }
}

function encrypt(value: string, key: Buffer): Buffer { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]); }
function decrypt(value: Buffer, key: Buffer): string { const iv = value.subarray(0, 12); const tag = value.subarray(12, 28); const ciphertext = value.subarray(28); const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'); }
