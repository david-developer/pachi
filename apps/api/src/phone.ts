import { BadRequestException, ConflictException, Controller, Get, HttpException, HttpStatus, Inject, Injectable, NotFoundException, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IdentityError, PhoneVerificationStore } from '@pachi/database';
import type { PhoneConfirmResponse, PhoneRequestResponse } from '@pachi/contracts';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AuthGuard } from './auth.guard.js';

export interface SmsProvider {
  sendOtp(input: { destination: string; purpose: 'PHONE_OWNERSHIP'; code: string; expiresInMinutes: number; idempotencyKey: string }): Promise<void>;
}

export class LocalSmsSink implements SmsProvider {
  public readonly deliveries: Array<{ destination: string; code: string; idempotencyKey: string }> = [];
  public constructor(private readonly environment: string) {
    if (environment === 'production') throw new Error('Local SMS sink is forbidden in production');
  }
  public async sendOtp(input: { destination: string; purpose: 'PHONE_OWNERSHIP'; code: string; expiresInMinutes: number; idempotencyKey: string }): Promise<void> {
    if (input.destination === '+237000000000') throw new Error('synthetic delivery failure');
    this.deliveries.push({ destination: input.destination, code: input.code, idempotencyKey: input.idempotencyKey });
  }

  public delivery(challengeId: string): { destination: string; code: string } | null {
    const item = this.deliveries.find((delivery) => delivery.idempotencyKey === challengeId);
    return item ? { destination: item.destination, code: item.code } : null;
  }
}

export function normalizeCameroonPhone(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('Phone number is required');
  const compact = value.replace(/[\s().-]/g, '');
  if (!/^\+237[1-9][0-9]{8}$/.test(compact)) throw new BadRequestException('Only valid Cameroon E.164 phone numbers are accepted');
  return compact;
}

@Injectable()
export class PhoneVerificationService {
  public constructor(private readonly store: PhoneVerificationStore, private readonly sms: SmsProvider) {}

  public async request(userId: string, rawPhone: unknown, abuseKey?: string): Promise<{ status: 'accepted'; challengeId: string }> {
    const phone = normalizeCameroonPhone(rawPhone);
    let challenge;
    try { challenge = await this.store.createChallenge(userId, phone, abuseKey); }
    catch (error) { throw this.httpError(error); }
    try {
      await this.sms.sendOtp({ destination: phone, purpose: 'PHONE_OWNERSHIP', code: challenge.code, expiresInMinutes: 5, idempotencyKey: challenge.id });
      await this.store.markDelivery(challenge.id, true);
    } catch {
      await this.store.markDelivery(challenge.id, false, 'DELIVERY_FAILED');
      throw new ConflictException('Verification code could not be delivered');
    }
    return { status: 'accepted', challengeId: challenge.id };
  }

  public async confirm(userId: string, rawPhone: unknown, challengeId: unknown, rawCode: unknown): Promise<{ status: 'verified'; activated: boolean }> {
    const phone = normalizeCameroonPhone(rawPhone);
    if (typeof challengeId !== 'string' || !/^[0-9a-f-]{36}$/.test(challengeId)) throw new BadRequestException('Challenge is invalid');
    if (typeof rawCode !== 'string' || !/^\d{6}$/.test(rawCode)) throw new BadRequestException('Verification code is invalid');
    try {
      const result = await this.store.confirm(userId, phone, challengeId, rawCode);
      return { status: 'verified', activated: result.activated };
    } catch (error) { throw this.httpError(error); }
  }

  private httpError(error: unknown): Error {
    if (!(error instanceof IdentityError)) return error as Error;
    if (['OTP_RATE_LIMITED', 'OTP_RESEND_COOLDOWN'].includes(error.code)) return new HttpException('Verification rate limit reached', HttpStatus.TOO_MANY_REQUESTS);
    if (['OTP_INVALID', 'OTP_EXPIRED', 'OTP_NOT_USABLE', 'OTP_ATTEMPTS_EXCEEDED', 'OTP_NOT_FOUND'].includes(error.code)) return new UnauthorizedException('Verification failed');
    if (error.code === 'PHONE_ALREADY_OWNED') return new ConflictException('Verification failed');
    if (error.code === 'CAPABILITY_RESTRICTED') return new ConflictException('Phone verification is not available for this account');
    return new ConflictException('Verification could not be completed');
  }
}

@Controller('account/phone')
@UseGuards(AuthGuard)
export class PhoneVerificationController {
  public constructor(private readonly verification: PhoneVerificationService) {}

  @Post('request')
  public async request(@Req() request: AuthenticatedRequest): Promise<PhoneRequestResponse> {
    const body = request.body as { phone?: unknown };
    if (!request.principal) throw new UnauthorizedException('Authentication required');
    return this.verification.request(request.principal.userId, body?.phone, `${request.ip}:${request.header('user-agent') ?? 'unknown'}`);
  }

  @Post('confirm')
  public async confirm(@Req() request: AuthenticatedRequest): Promise<PhoneConfirmResponse> {
    const body = request.body as { phone?: unknown; challenge_id?: unknown; code?: unknown };
    if (!request.principal) throw new UnauthorizedException('Authentication required');
    return this.verification.confirm(request.principal.userId, body?.phone, body?.challenge_id, body?.code);
  }
}

@Controller('dev/local-sms')
export class LocalSmsDevelopmentController {
  public constructor(@Inject('SMS_PROVIDER') private readonly sink: LocalSmsSink) {}

  @Get(':challengeId')
  public delivery(@Req() request: AuthenticatedRequest): { destination: string; code: string } {
    if (process.env.NODE_ENV !== 'development' || !isLoopback(request)) throw new NotFoundException();
    const challengeId = request.params.challengeId;
    if (typeof challengeId !== 'string' || !/^[0-9a-f-]{36}$/.test(challengeId)) throw new NotFoundException();
    const delivery = this.sink.delivery(challengeId);
    if (!delivery) throw new NotFoundException();
    return delivery;
  }
}

function isLoopback(request: AuthenticatedRequest): boolean {
  const address = request.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

