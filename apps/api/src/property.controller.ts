import { Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IdentityError, PropertyDraftStore, type ListingDraft, type PropertyDraft } from '@pachi/database';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AuthGuard } from './auth.guard.js';
import type { ListingDraftCreateRequest, ListingDraftResponse, ListingDraftUpdateRequest, PropertyCreateRequest, PropertyDraftResponse } from '@pachi/contracts';

@Controller('account')
@UseGuards(AuthGuard)
export class PropertyController {
  public constructor(@Inject('PROPERTY_DRAFT_STORE') private readonly store: PropertyDraftStore) {}

  @Get('properties')
  public async properties(@Req() request: AuthenticatedRequest): Promise<{ properties: PropertyDraftResponse[] }> {
    try { return { properties: (await this.store.properties(this.userId(request))).map(propertyResponse) }; }
    catch (error) { throw this.error(error); }
  }

  @Post('properties')
  public async createProperty(@Req() request: AuthenticatedRequest, @Body() body: PropertyCreateRequest): Promise<PropertyDraftResponse> {
    try { return propertyResponse(await this.store.createProperty(this.userId(request), propertyInput(body))); }
    catch (error) { throw this.error(error); }
  }

  @Get('listing-drafts')
  public async drafts(@Req() request: AuthenticatedRequest): Promise<{ drafts: ListingDraftResponse[] }> {
    try { return { drafts: (await this.store.drafts(this.userId(request))).map(draftResponse) }; }
    catch (error) { throw this.error(error); }
  }

  @Get('listing-drafts/:id')
  public async draft(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<ListingDraftResponse> {
    try { return draftResponse(await this.store.draft(this.userId(request), id)); }
    catch (error) { throw this.error(error); }
  }

  @Post('listing-drafts')
  public async createDraft(@Req() request: AuthenticatedRequest, @Body() body: ListingDraftCreateRequest): Promise<ListingDraftResponse> {
    try { return draftResponse(await this.store.createDraft(this.userId(request), draftInput(body))); }
    catch (error) { throw this.error(error); }
  }

  @Patch('listing-drafts/:id')
  public async updateDraft(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: ListingDraftUpdateRequest): Promise<ListingDraftResponse> {
    try { return draftResponse(await this.store.updateDraft(this.userId(request), id, updateInput(body))); }
    catch (error) { throw this.error(error); }
  }

  private userId(request: AuthenticatedRequest): string { if (!request.principal) throw new UnauthorizedException('Authentication required'); return request.principal.userId; }
  private error(error: unknown): Error { return error instanceof IdentityError ? error.code === 'DRAFT_READ_FAILED' ? new NotFoundException('Listing draft is not available') : new ConflictException(error.message) : error as Error; }
}

function propertyInput(body: PropertyCreateRequest) { return { propertyType: body.property_type, region: body.region, city: body.city, neighborhood: body.neighborhood, landmark: body.landmark, bedrooms: body.bedrooms, bathrooms: body.bathrooms, sizeSqm: body.size_sqm, furnishing: body.furnishing, relationshipType: body.relationship_type }; }
function draftInput(body: ListingDraftCreateRequest) { return { propertyId: body.property_id, purpose: body.purpose, title: body.title, description: body.description, amountMinor: body.amount_minor, pricingPeriod: body.pricing_period, negotiable: body.negotiable, depositAmountMinor: body.deposit_amount_minor, advanceMonths: body.advance_months, minimumLeaseMonths: body.minimum_lease_months, utilitiesIncluded: body.utilities_included, serviceChargeAmountMinor: body.service_charge_amount_minor, weeklyAmountMinor: body.weekly_amount_minor, minimumNights: body.minimum_nights, guestLimit: body.guest_limit, checkInTime: body.check_in_time, checkOutTime: body.check_out_time, cleaningFeeMinor: body.cleaning_fee_minor, availableFrom: body.available_from }; }
function updateInput(body: ListingDraftUpdateRequest) { return { title: body.title, description: body.description, amountMinor: body.amount_minor, pricingPeriod: body.pricing_period, negotiable: body.negotiable, depositAmountMinor: body.deposit_amount_minor, advanceMonths: body.advance_months, minimumLeaseMonths: body.minimum_lease_months, utilitiesIncluded: body.utilities_included, serviceChargeAmountMinor: body.service_charge_amount_minor, weeklyAmountMinor: body.weekly_amount_minor, minimumNights: body.minimum_nights, guestLimit: body.guest_limit, checkInTime: body.check_in_time, checkOutTime: body.check_out_time, cleaningFeeMinor: body.cleaning_fee_minor, availableFrom: body.available_from }; }
function propertyResponse(property: PropertyDraft): PropertyDraftResponse { return { id: property.id, property_type: property.propertyType, region: property.region, city: property.city, neighborhood: property.neighborhood, landmark: property.landmark, bedrooms: property.bedrooms, bathrooms: property.bathrooms, size_sqm: property.sizeSqm, furnishing: property.furnishing, relationship_id: property.relationshipId, relationship_type: property.relationshipType, authorization_status: property.authorizationStatus }; }
function draftResponse(draft: ListingDraft): ListingDraftResponse { return { id: draft.id, property_id: draft.propertyId, provider_account_id: draft.providerAccountId, purpose: draft.purpose, publication_status: 'DRAFT', revision_id: draft.revisionId, version: draft.version, title: draft.title, description: draft.description, offering_id: draft.offeringId, offering_version_id: draft.offeringVersionId, currency: 'XAF', amount_minor: draft.amountMinor, pricing_period: draft.pricingPeriod, negotiable: draft.negotiable, deposit_amount_minor: draft.depositAmountMinor, advance_months: draft.advanceMonths, minimum_lease_months: draft.minimumLeaseMonths, utilities_included: draft.utilitiesIncluded, service_charge_amount_minor: draft.serviceChargeAmountMinor, weekly_amount_minor: draft.weeklyAmountMinor, minimum_nights: draft.minimumNights, guest_limit: draft.guestLimit, check_in_time: draft.checkInTime, check_out_time: draft.checkOutTime, cleaning_fee_minor: draft.cleaningFeeMinor, available_from: draft.availableFrom }; }
