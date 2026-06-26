export type ThreadRealtimeEvent =
  | {
      type: 'message.created';
      conversationId: string;
      messageId: string;
    }
  | {
      type: 'timeline.event';
      conversationId: string;
      eventId: string;
    };

export type RealtimeStateSync = {
  connectionId: string;
  subscribedConversationIds: string[];
};
