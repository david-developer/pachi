import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, Inject, NotFoundException, Param, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { BlockStore, IdentityError, type BlockActor } from '@pachi/database';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import { OrganizationNoStoreGuard } from './organization.controller.js';
import { organizationRequestId } from './logging.js';

const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
function resource(id:string) {if(!uuid(id))throw new NotFoundException('RESOURCE_UNAVAILABLE');return id;}
function key(id:unknown) {if(!uuid(id))throw new BadRequestException('INVALID_IDEMPOTENCY_KEY');return id;}
function fields(input:unknown,allowed:string[]) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(k=>!allowed.includes(k)) || allowed.some(k=>!(k in input)))throw new BadRequestException('INVALID_INPUT');
  return input as Record<string,unknown>;
}
@Controller('account')
@UseGuards(OrganizationNoStoreGuard,AuthGuard)
export class BlockController {
  constructor(@Inject('BLOCK_STORE') private readonly store:BlockStore){}
  private actor(request:AuthenticatedRequest):BlockActor {
    const p=request.principal;if(!p)throw new UnauthorizedException('AUTH_REQUIRED');
    return {userId:p.userId,sessionId:p.session.id,securityVersion:p.session.securityVersion};
  }
  private async run<T>(work:()=>Promise<T>):Promise<T> {
    try{return await work();}catch(e){
      if(!(e instanceof IdentityError))throw e;
      if(e.code==='AUTH_REQUIRED')throw new UnauthorizedException('AUTH_REQUIRED');
      if(e.code==='RESOURCE_SCOPE_DENIED')throw new NotFoundException('RESOURCE_UNAVAILABLE');
      if(e.code==='INVALID_INPUT')throw new BadRequestException('INVALID_INPUT');
      if(e.code==='CAPABILITY_RESTRICTED')throw new ForbiddenException('CAPABILITY_RESTRICTED');
      throw new ConflictException(e.code);
    }
  }
  @Post('interactions/:interactionId/block')
  blockInteraction(@Req() r:AuthenticatedRequest,@Param('interactionId') id:string,@Headers('idempotency-key') k:unknown,@Body() body:unknown) {
    fields(body,[]);return this.run(()=>this.store.block(this.actor(r),'interaction',resource(id),{idempotencyKey:key(k),requestId:organizationRequestId(r)}));
  }
  @Post('listings/:listingId/block-provider')
  blockListing(@Req() r:AuthenticatedRequest,@Param('listingId') id:string,@Headers('idempotency-key') k:unknown,@Body() body:unknown) {
    fields(body,[]);return this.run(()=>this.store.block(this.actor(r),'listing',resource(id),{idempotencyKey:key(k),requestId:organizationRequestId(r)}));
  }
  @Get('interactions/:interactionId/contact-safety')
  interactionSafety(@Req() r:AuthenticatedRequest,@Param('interactionId') id:string) {return this.run(()=>this.store.safety(this.actor(r),'interaction',resource(id)));}
  @Get('listings/:listingId/contact-safety')
  listingSafety(@Req() r:AuthenticatedRequest,@Param('listingId') id:string) {return this.run(()=>this.store.safety(this.actor(r),'listing',resource(id)));}
  @Get('blocks')
  list(@Req() r:AuthenticatedRequest,@Query() query:Record<string,unknown>) {
    if(Object.keys(query).some(k=>!['cursor','limit'].includes(k)) || (query.cursor!==undefined&&!uuid(query.cursor)) || (query.limit!==undefined&&(typeof query.limit!=='string'||!/^([1-9]|[1-4][0-9]|50)$/.test(query.limit))))throw new BadRequestException('INVALID_INPUT');
    return this.run(()=>this.store.list(this.actor(r),query.cursor as string|undefined,query.limit===undefined?20:Number(query.limit)));
  }
  @Post('blocks/:blockId/unblock')
  unblock(@Req() r:AuthenticatedRequest,@Param('blockId') id:string,@Headers('idempotency-key') k:unknown,@Body() input:unknown) {
    const body=fields(input,['expected_version']);if(!Number.isSafeInteger(body.expected_version)||Number(body.expected_version)<1)throw new BadRequestException('INVALID_INPUT');
    return this.run(()=>this.store.unblock(this.actor(r),resource(id),{expectedVersion:Number(body.expected_version),idempotencyKey:key(k),requestId:organizationRequestId(r)}));
  }
}
