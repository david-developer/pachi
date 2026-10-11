import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IdentityError, PublicListingStore, type PublicListingFilters } from '@pachi/database';
import { LocalPrivateMediaStorage } from '@pachi/media';
import type { PublicListingQuery } from '@pachi/contracts';

@Controller('public/listings')
export class PublicListingController {
  public constructor(
    @Inject('PUBLIC_LISTING_STORE') private readonly store: PublicListingStore,
    @Inject('LOCAL_PRIVATE_MEDIA_STORAGE') private readonly storage: LocalPrivateMediaStorage,
  ) {}

  @Get()
  public async search(@Query() query: PublicListingQuery, @Res({passthrough:true}) response: Response) {
    response.setHeader('Cache-Control','no-store');
    try {
      const filters: PublicListingFilters = {};
      if (query.purpose !== undefined) filters.purpose = query.purpose;
      if (query.region !== undefined) filters.region = query.region;
      if (query.city !== undefined) filters.city = query.city;
      if (query.neighborhood !== undefined) filters.neighborhood = query.neighborhood;
      if (query.property_type !== undefined) filters.propertyType = query.property_type;
      const numeric = [['minPrice', query.min_price], ['maxPrice', query.max_price], ['minBedrooms', query.min_bedrooms], ['minBathrooms', query.min_bathrooms], ['limit', query.limit]] as const;
      for (const [key, value] of numeric) { const parsed = numberQuery(value); if (parsed !== undefined) filters[key] = parsed; }
      if (query.furnishing !== undefined) filters.furnishing = query.furnishing;
      if (query.available_from !== undefined) filters.availableFrom = query.available_from;
      if (query.sort !== undefined) filters.sort = query.sort;
      if (query.cursor !== undefined) filters.cursor = query.cursor;
      return await this.store.search(filters);
    } catch (error) { throw this.error(error, true); }
  }

  @Get(':id')
  public async detail(@Param('id') id: string, @Res({passthrough:true}) response: Response) {
    response.setHeader('Cache-Control','no-store');
    if (!isUuid(id)) throw new NotFoundException('Listing is not available');
    try { return await this.store.detail(id); }
    catch (error) { throw this.error(error, false); }
  }

  @Get(':listingId/media/:mediaId/variants/:width')
  public async media(@Param('listingId') listingId: string, @Param('mediaId') mediaId: string, @Param('width') width: string, @Res() response: Response): Promise<void> {
    if (!isUuid(listingId) || !isUuid(mediaId)) throw new NotFoundException('Listing media is not available');
    try {
      const media = await this.store.media(listingId, mediaId, Number(width));
      const bytes = await this.storage.readVariant(media.storageReference, Number(width));
      response.status(200).set({ 'content-type': media.mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).send(bytes);
    } catch (error) { throw this.error(error, false); }
  }

  private error(error: unknown, isSearch: boolean): Error {
    if (error instanceof IdentityError) {
      if (error.code === 'PUBLIC_FILTER_INVALID' || error.code === 'PUBLIC_CURSOR_INVALID') return new BadRequestException('Listing filters are invalid');
      if (error.code === 'PUBLIC_LISTING_NOT_FOUND') return new NotFoundException('Listing is not available');
    }
    return isSearch ? new BadRequestException('Listing search is unavailable') : new NotFoundException('Listing is not available');
  }
}

function numberQuery(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
