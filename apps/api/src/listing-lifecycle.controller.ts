import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  IdentityError,
  ListingLifecycleStore,
  type ListingLifecycleCommand,
  type ListingLifecycleState,
} from "@pachi/database";
import { AuthGuard, type AuthenticatedRequest } from "./auth.guard.js";
import { OrganizationOwnerNoStoreGuard } from "./organization-owner.controller.js";

@Controller("account/listings/:id/lifecycle")
@UseGuards(OrganizationOwnerNoStoreGuard, AuthGuard)
export class ListingLifecycleController {
  constructor(
    @Inject("LISTING_LIFECYCLE_STORE")
    private readonly store: ListingLifecycleStore,
  ) {}
  @Get()
  read(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.run(() => this.store.read(this.actor(request), id));
  }
  @Post("market")
  market(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.run(() =>
      this.store.execute(
        this.actor(request),
        id,
        this.command(body, key, "MARKET"),
      ),
    );
  }
  @Post("freshness")
  freshness(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.run(() =>
      this.store.execute(
        this.actor(request),
        id,
        this.command(body, key, "FRESHNESS"),
      ),
    );
  }
  private actor(request: AuthenticatedRequest) {
    const principal = request.principal;
    if (!principal) throw new UnauthorizedException("AUTH_REQUIRED");
    return {
      userId: principal.userId,
      sessionId: principal.session.id,
      securityVersion: principal.session.securityVersion,
    };
  }
  private command(
    input: unknown,
    key: string | undefined,
    operation: "MARKET" | "FRESHNESS",
  ): ListingLifecycleCommand {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new BadRequestException("INVALID_INPUT");
    const body = input as Record<string, unknown>;
    const allowed = [
      "expected_version",
      "expected_revision_id",
      "expected_offering_version_id",
      ...(operation === "MARKET" ? ["market_status"] : []),
    ];
    if (Object.keys(body).some((k) => !allowed.includes(k)))
      throw new BadRequestException("INVALID_INPUT");
    // The database's strict schema validates types and UUIDs before any write.
    return {
      operation,
      expectedVersion: body.expected_version,
      expectedRevisionId: body.expected_revision_id,
      expectedOfferingVersionId: body.expected_offering_version_id,
      idempotencyKey: key,
      ...(operation === "MARKET" ? { marketStatus: body.market_status } : {}),
    } as ListingLifecycleCommand;
  }
  private async run(action: () => Promise<ListingLifecycleState>) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof IdentityError) {
        if (error.code === "AUTH_REQUIRED")
          throw new UnauthorizedException("AUTH_REQUIRED");
        if (error.code === "RESOURCE_SCOPE_DENIED")
          throw new NotFoundException("RESOURCE_UNAVAILABLE");
        if (error.code === "CAPABILITY_RESTRICTED")
          throw new ForbiddenException("CAPABILITY_RESTRICTED");
        if (error.code === "INVALID_INPUT")
          throw new BadRequestException("INVALID_INPUT");
        throw new ConflictException(
          [
            "STALE_VERSION",
            "IDEMPOTENCY_KEY_REUSED",
            "INVALID_STATE",
            "PUBLICATION_REQUIREMENTS_BLOCKED",
          ].includes(error.code)
            ? error.code
            : "REQUEST_CONFLICT",
        );
      }
      throw error;
    }
  }
}
