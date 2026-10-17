export const ChatEvent = {
  JOIN_ORDER: 'join-order',
  LEAVE_ORDER: 'leave-order',
  SEND_MESSAGE: 'send-message',
  MARK_READ: 'mark-read',
  MESSAGE_RECEIPT: 'message-receipt',
  MESSAGE_CREATED: 'message-created',
  CHAT_ERROR: 'chat-error',
  USER_JOINED: 'user-joined',
  USER_LEFT: 'user-left',
} as const;

export const ChatErrorCode = {
  INVALID_JWT: 'INVALID_JWT',
  INVALID_ORDER_ID: 'INVALID_ORDER_ID',
  UNAUTHORIZED_ORDER_ACCESS: 'UNAUTHORIZED_ORDER_ACCESS',
  EMPTY_MESSAGE: 'EMPTY_MESSAGE',
  NOT_IN_ORDER_ROOM: 'NOT_IN_ORDER_ROOM',
  MESSAGE_PERSISTENCE_FAILED: 'MESSAGE_PERSISTENCE_FAILED',
} as const;

export type ChatErrorCode = (typeof ChatErrorCode)[keyof typeof ChatErrorCode];

export interface ChatError {
  code: ChatErrorCode;
  message: string;
  orderId?: string;
}

export interface ChatAck<T = undefined> {
  ok: boolean;
  data?: T;
  error?: ChatError;
}
