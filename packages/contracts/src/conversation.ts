import type { InteractionState } from './interaction.js';
export type MessageReceipt = {
  recipient_user_id: string;
  delivered_at: string | null;
  read_at: string | null;
};
export type MessageResponse = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  sender_side: 'SEEKER' | 'PROVIDER';
  client_message_id: string;
  body: string | null;
  sequence: string;
  sent_at: string;
  visibility_state: 'VISIBLE' | 'REMOVED';
  receipts: MessageReceipt[];
};
export type MessageSendRequest = { client_message_id: string; body: string };
export type MessageSendResponse = {
  message: MessageResponse;
  created: boolean;
};
export type ReceiptRequest = {
  message_ids: string[];
  state: 'DELIVERED' | 'READ';
};
export type ReceiptResponse = {
  receipts: (MessageReceipt & { message_id: string })[];
};
export type ConversationSummary = {
  conversation_id: string;
  interaction_id: string;
  listing_id: string;
  state: InteractionState;
  opened_at: string;
  title: string | null;
  listing_visible: boolean;
  latest_message_at: string | null;
};
export type ConversationListResponse = {
  items: ConversationSummary[];
  next_cursor: string | null;
};
export type MessageListResponse = {
  items: MessageResponse[];
  next_cursor: string | null;
  can_send: boolean;
  actor_side: 'SEEKER' | 'PROVIDER';
};
