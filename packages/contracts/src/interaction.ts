export type InteractionState = 'OPEN' | 'CLOSED' | 'RESTRICTED';
export type InteractionResponse = { interaction_id: string; conversation_id: string; listing_id: string; state: InteractionState; opened_at: string; created: boolean };
export type InteractionReadResponse = InteractionResponse & { title: string | null; listing_visible: boolean };
export type InquiryCreateResponse = InteractionResponse;
