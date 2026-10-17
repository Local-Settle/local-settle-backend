export const MAX_CHAT_MESSAGE_LENGTH = 4000;

export type ChatMessageValidation =
  | { valid: true; content: string }
  | {
      valid: false;
      reason: 'empty' | 'too_long' | 'control_character' | 'not_string';
    };

/** Shared content policy for HTTP and websocket chat writes. */
export function validateChatMessageContent(
  value: unknown,
): ChatMessageValidation {
  if (typeof value !== 'string') return { valid: false, reason: 'not_string' };

  const content = value.replace(/\r\n?/g, '\n').trim();
  if (!content) return { valid: false, reason: 'empty' };
  if (content.length > MAX_CHAT_MESSAGE_LENGTH) {
    return { valid: false, reason: 'too_long' };
  }
  // Tabs and line breaks are useful formatting; reject other C0/C1 controls.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(content)) {
    return { valid: false, reason: 'control_character' };
  }

  return { valid: true, content };
}
