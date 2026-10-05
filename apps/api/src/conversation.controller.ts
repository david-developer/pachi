import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards
} from '@nestjs/common';
import { ConversationStore, IdentityError } from '@pachi/database';
import type {
  ConversationListResponse,
  MessageListResponse,
  MessageSendRequest,
  MessageSendResponse,
  ReceiptRequest,
  ReceiptResponse
} from '@pachi/contracts';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';

@Controller('account/conversations')
@UseGuards(AuthGuard)
export class ConversationController {
  constructor(
    @Inject('CONVERSATION_STORE') private readonly store: ConversationStore
  ) {}
  @Get()
  async inbox(
    @Req() request: AuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ): Promise<ConversationListResponse> {
    try {
      return await this.store.inbox(
        this.userId(request),
        cursor,
        limit === undefined ? 20 : Number(limit)
      );
    } catch (error) {
      throw this.error(error);
    }
  }
  @Get(':conversationId/messages')
  async messages(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ): Promise<MessageListResponse> {
    try {
      return await this.store.messages(
        this.userId(request),
        id,
        cursor,
        limit === undefined ? 30 : Number(limit)
      );
    } catch (error) {
      throw this.error(error);
    }
  }
  @Post(':conversationId/messages')
  async send(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') id: string,
    @Body() input: MessageSendRequest
  ): Promise<MessageSendResponse> {
    if (
      !input ||
      Object.keys(input).some(
        (key) => !['client_message_id', 'body'].includes(key)
      )
    )
      throw new BadRequestException('Invalid message request');
    try {
      return await this.store.send(this.userId(request), id, input);
    } catch (error) {
      throw this.error(error);
    }
  }
  @Post(':conversationId/receipts')
  async receipts(
    @Req() request: AuthenticatedRequest,
    @Param('conversationId') id: string,
    @Body() input: ReceiptRequest
  ): Promise<ReceiptResponse> {
    if (
      !input ||
      Object.keys(input).some((key) => !['message_ids', 'state'].includes(key))
    )
      throw new BadRequestException('Invalid receipt request');
    try {
      return await this.store.acknowledge(this.userId(request), id, input);
    } catch (error) {
      throw this.error(error);
    }
  }
  private userId(request: AuthenticatedRequest): string {
    if (!request.principal)
      throw new UnauthorizedException('Authentication required');
    return request.principal.userId;
  }
  private error(error: unknown): Error {
    if (error instanceof IdentityError) {
      if (error.code === 'RESOURCE_SCOPE_DENIED')
        return new NotFoundException('Resource is not available');
      if (error.code === 'INVALID_INPUT')
        return new BadRequestException(error.message);
      if (error.code === 'CAPABILITY_RESTRICTED')
        return new ForbiddenException('Messaging is not available');
      if (error.code === 'RATE_LIMITED')
        return new HttpException('Too many messages. Try again shortly.', 429);
      if (error.code === 'CONVERSATION_CLOSED')
        return new ConflictException('Conversation is not open');
      if (error.code === 'IDEMPOTENCY_KEY_REUSED')
        return new ConflictException(
          'Client message ID was used for another request'
        );
    }
    return error as Error;
  }
}
