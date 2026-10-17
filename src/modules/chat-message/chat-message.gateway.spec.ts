import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatMessageGateway } from './chat-message.gateway';
import { ChatMessageService } from './chat-message.service';
import { ChatErrorCode, ChatEvent } from './chat-message.events';
import type { ChatMessage } from '@prisma/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_ORDER_ID = '123e4567-e89b-12d3-a456-426614174000';

/** Build a minimal fake ChatSocket with a controllable `rooms` Set. */
function makeClient(overrides: Record<string, unknown> = {}) {
  const rooms = new Set<string>();
  const emit = jest.fn();
  const join = jest.fn((room: string) => {
    rooms.add(room);
  });
  const leave = jest.fn((room: string) => {
    rooms.delete(room);
  });
  const to = jest.fn().mockReturnValue({ emit });

  return {
    id: 'socket-id-1',
    rooms,
    emit,
    join,
    leave,
    to,
    on: jest.fn(),
    data: { userId: 'user-1', publicKey: undefined } as {
      userId: string;
      publicKey?: string;
    },
    handshake: {
      auth: {} as Record<string, unknown>,
      headers: {} as Record<string, string>,
    },
    ...overrides,
  };
}

/** Accessor that exposes private methods for testing. */
function asAny(gw: ChatMessageGateway): Record<string, unknown> {
  return gw as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockJwtService = {
  verifyAsync: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue(''),
};

const mockChatMessageService = {
  create: jest.fn(),
  createFromChat: jest.fn(),
  getSignedAttachmentsForOrder: jest.fn().mockResolvedValue([]),
  canAccessOrder: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ChatMessageGateway', () => {
  let gateway: ChatMessageGateway;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatMessageGateway,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ChatMessageService, useValue: mockChatMessageService },
      ],
    }).compile();

    gateway = module.get<ChatMessageGateway>(ChatMessageGateway);
  });

  // -------------------------------------------------------------------------
  // extractToken
  // -------------------------------------------------------------------------

  describe('extractToken', () => {
    it('returns token from handshake.auth.token', () => {
      const client = makeClient();
      client.handshake.auth = { token: 'auth-token-123' };

      const token = (
        asAny(gateway).extractToken as (c: typeof client) => string | undefined
      )(client);

      expect(token).toBe('auth-token-123');
    });

    it('returns token from Authorization: Bearer header', () => {
      const client = makeClient();
      client.handshake.auth = {};
      client.handshake.headers = { authorization: 'Bearer header-token-456' };

      const token = (
        asAny(gateway).extractToken as (c: typeof client) => string | undefined
      )(client);

      expect(token).toBe('header-token-456');
    });

    it('prefers handshake.auth.token over Authorization header', () => {
      const client = makeClient();
      client.handshake.auth = { token: 'auth-wins' };
      client.handshake.headers = { authorization: 'Bearer header-loses' };

      const token = (
        asAny(gateway).extractToken as (c: typeof client) => string | undefined
      )(client);

      expect(token).toBe('auth-wins');
    });

    it('returns undefined when no token is present', () => {
      const client = makeClient();
      client.handshake.auth = {};
      client.handshake.headers = {};

      const token = (
        asAny(gateway).extractToken as (c: typeof client) => string | undefined
      )(client);

      expect(token).toBeUndefined();
    });

    it('returns undefined for non-Bearer Authorization scheme', () => {
      const client = makeClient();
      client.handshake.auth = {};
      client.handshake.headers = { authorization: 'Basic dXNlcjpwYXNz' };

      const token = (
        asAny(gateway).extractToken as (c: typeof client) => string | undefined
      )(client);

      expect(token).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // authenticateSocket
  // -------------------------------------------------------------------------

  describe('authenticateSocket', () => {
    it('sets userId and publicKey on client.data for a valid JWT', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({
        sub: 'user-abc',
        publicKey: 'GABC123',
      });
      const client = makeClient();
      client.handshake.auth = { token: 'valid.jwt.token' };
      client.data = { userId: '', publicKey: undefined };

      await (
        asAny(gateway).authenticateSocket as (c: typeof client) => Promise<void>
      )(client);

      expect(client.data.userId).toBe('user-abc');
      expect(client.data.publicKey).toBe('GABC123');
    });

    it('sets userId without publicKey when payload has no publicKey', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({ sub: 'user-xyz' });
      const client = makeClient();
      client.handshake.auth = { token: 'valid.jwt.token' };
      client.data = { userId: '', publicKey: undefined };

      await (
        asAny(gateway).authenticateSocket as (c: typeof client) => Promise<void>
      )(client);

      expect(client.data.userId).toBe('user-xyz');
      expect(client.data.publicKey).toBeUndefined();
    });

    it('throws with INVALID_JWT error when token is missing', async () => {
      const client = makeClient();
      client.handshake.auth = {};
      client.handshake.headers = {};

      await expect(
        (
          asAny(gateway).authenticateSocket as (
            c: typeof client,
          ) => Promise<void>
        )(client),
      ).rejects.toMatchObject({
        data: { code: ChatErrorCode.INVALID_JWT },
      });
    });

    it('throws with INVALID_JWT error when JWT verification fails', async () => {
      mockJwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      const client = makeClient();
      client.handshake.auth = { token: 'expired.token.here' };

      await expect(
        (
          asAny(gateway).authenticateSocket as (
            c: typeof client,
          ) => Promise<void>
        )(client),
      ).rejects.toMatchObject({
        data: { code: ChatErrorCode.INVALID_JWT },
      });
    });

    it('throws with INVALID_JWT error when JWT payload has no sub', async () => {
      mockJwtService.verifyAsync.mockResolvedValue({ publicKey: 'GABC' });
      const client = makeClient();
      client.handshake.auth = { token: 'no-sub.token.here' };

      await expect(
        (
          asAny(gateway).authenticateSocket as (
            c: typeof client,
          ) => Promise<void>
        )(client),
      ).rejects.toMatchObject({
        data: { code: ChatErrorCode.INVALID_JWT },
      });
    });
  });

  // -------------------------------------------------------------------------
  // joinOrder
  // -------------------------------------------------------------------------

  describe('joinOrder', () => {
    it('returns ok:true and joins the room for an authorized user', async () => {
      mockChatMessageService.canAccessOrder.mockResolvedValue(true);
      const client = makeClient();

      const result = await gateway.joinOrder(client as never, {
        orderId: VALID_ORDER_ID,
      });

      expect(result).toEqual({ ok: true });
      expect(client.join).toHaveBeenCalledWith(`order:${VALID_ORDER_ID}`);
    });

    it('emits USER_JOINED to the room when a new participant joins', async () => {
      mockChatMessageService.canAccessOrder.mockResolvedValue(true);
      const client = makeClient();

      await gateway.joinOrder(client as never, { orderId: VALID_ORDER_ID });

      expect(client.to).toHaveBeenCalledWith(`order:${VALID_ORDER_ID}`);
      const toResult = client.to.mock.results[0].value as { emit: jest.Mock };
      expect(toResult.emit).toHaveBeenCalledWith(
        ChatEvent.USER_JOINED,
        expect.objectContaining({
          orderId: VALID_ORDER_ID,
          userId: client.data.userId,
        }),
      );
    });

    it('does not re-join or emit USER_JOINED when already in the room', async () => {
      mockChatMessageService.canAccessOrder.mockResolvedValue(true);
      const client = makeClient();
      client.rooms.add(`order:${VALID_ORDER_ID}`);

      await gateway.joinOrder(client as never, { orderId: VALID_ORDER_ID });

      expect(client.join).not.toHaveBeenCalled();
      expect(client.to).not.toHaveBeenCalled();
    });

    it('returns ok:false and emits chat-error when orderId is invalid', async () => {
      const client = makeClient();

      const result = await gateway.joinOrder(client as never, {
        orderId: 'not-a-uuid',
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.INVALID_ORDER_ID },
      });
      expect(client.emit).toHaveBeenCalledWith(
        ChatEvent.CHAT_ERROR,
        expect.objectContaining({ code: ChatErrorCode.INVALID_ORDER_ID }),
      );
    });

    it('returns ok:false with UNAUTHORIZED_ORDER_ACCESS when user is not a participant', async () => {
      mockChatMessageService.canAccessOrder.mockResolvedValue(false);
      const client = makeClient();

      const result = await gateway.joinOrder(client as never, {
        orderId: VALID_ORDER_ID,
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.UNAUTHORIZED_ORDER_ACCESS },
      });
    });

    it('returns ok:false with INVALID_ORDER_ID when order does not exist', async () => {
      mockChatMessageService.canAccessOrder.mockResolvedValue(null);
      const client = makeClient();

      const result = await gateway.joinOrder(client as never, {
        orderId: VALID_ORDER_ID,
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.INVALID_ORDER_ID },
      });
    });
  });

  // -------------------------------------------------------------------------
  // leaveOrder
  // -------------------------------------------------------------------------

  describe('leaveOrder', () => {
    it('leaves the room and emits USER_LEFT when in the room', async () => {
      const client = makeClient();
      const room = `order:${VALID_ORDER_ID}`;
      client.rooms.add(room);

      const result = await gateway.leaveOrder(client as never, {
        orderId: VALID_ORDER_ID,
      });

      expect(result).toEqual({ ok: true });
      expect(client.leave).toHaveBeenCalledWith(room);
      expect(client.to).toHaveBeenCalledWith(room);
      const toResult = client.to.mock.results[0].value as { emit: jest.Mock };
      expect(toResult.emit).toHaveBeenCalledWith(
        ChatEvent.USER_LEFT,
        expect.objectContaining({
          orderId: VALID_ORDER_ID,
          userId: client.data.userId,
        }),
      );
    });

    it('returns ok:true without leaving when not in the room', async () => {
      const client = makeClient();

      const result = await gateway.leaveOrder(client as never, {
        orderId: VALID_ORDER_ID,
      });

      expect(result).toEqual({ ok: true });
      expect(client.leave).not.toHaveBeenCalled();
    });

    it('returns ok:false with INVALID_ORDER_ID for a non-UUID orderId', async () => {
      const client = makeClient();

      const result = await gateway.leaveOrder(client as never, {
        orderId: 'bad-id',
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.INVALID_ORDER_ID },
      });
    });
  });

  // -------------------------------------------------------------------------
  // sendMessage
  // -------------------------------------------------------------------------

  describe('sendMessage', () => {
    const fakeMessage: ChatMessage = {
      messageId: 'msg-1',
      orderId: VALID_ORDER_ID,
      senderId: 'user-1',
      content: 'Hello!',
      timestamp: new Date(),
    };

    /** Fake WebSocket server stub injected on the gateway instance. */
    let serverEmitToMock: jest.Mock;

    beforeEach(() => {
      serverEmitToMock = jest.fn();
      // Inject a minimal server stub so the gateway can call server.to(room).emit(...)
      (gateway as unknown as { server: unknown }).server = {
        to: jest.fn().mockReturnValue({ emit: serverEmitToMock }),
      };
    });

    it('persists the message, broadcasts message-created, and returns ok:true', async () => {
      mockChatMessageService.canAccessOrder.mockResolvedValue(true);
      mockChatMessageService.createFromChat.mockResolvedValue(fakeMessage);
      const client = makeClient();
      client.rooms.add(`order:${VALID_ORDER_ID}`);

      const result = await gateway.sendMessage(client as never, {
        orderId: VALID_ORDER_ID,
        content: 'Hello!',
      });

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({ content: 'Hello!' });
      expect(mockChatMessageService.createFromChat).toHaveBeenCalledWith({
        orderId: VALID_ORDER_ID,
        senderId: 'user-1',
        content: 'Hello!',
        attachmentEvidenceIds: [],
      });
      expect(serverEmitToMock).toHaveBeenCalledWith(
        ChatEvent.MESSAGE_CREATED,
        expect.objectContaining({ content: 'Hello!' }),
      );
    });

    it('includes clientMessageId in the ack and broadcast', async () => {
      mockChatMessageService.canAccessOrder.mockResolvedValue(true);
      mockChatMessageService.createFromChat.mockResolvedValue(fakeMessage);
      const client = makeClient();
      client.rooms.add(`order:${VALID_ORDER_ID}`);

      const result = await gateway.sendMessage(client as never, {
        orderId: VALID_ORDER_ID,
        content: 'Hello!',
        clientMessageId: 'client-msg-99',
      });

      expect(result.data?.clientMessageId).toBe('client-msg-99');
      expect(serverEmitToMock).toHaveBeenCalledWith(
        ChatEvent.MESSAGE_CREATED,
        expect.objectContaining({ clientMessageId: 'client-msg-99' }),
      );
    });

    it('returns ok:false with INVALID_ORDER_ID for a non-UUID orderId', async () => {
      const client = makeClient();

      const result = await gateway.sendMessage(client as never, {
        orderId: 'not-uuid',
        content: 'Hello!',
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.INVALID_ORDER_ID },
      });
    });

    it('returns ok:false with EMPTY_MESSAGE when content is blank', async () => {
      const client = makeClient();
      client.rooms.add(`order:${VALID_ORDER_ID}`);

      const result = await gateway.sendMessage(client as never, {
        orderId: VALID_ORDER_ID,
        content: '   ',
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.EMPTY_MESSAGE },
      });
    });

    it('returns ok:false with EMPTY_MESSAGE when content exceeds 4000 chars', async () => {
      const client = makeClient();
      client.rooms.add(`order:${VALID_ORDER_ID}`);

      const result = await gateway.sendMessage(client as never, {
        orderId: VALID_ORDER_ID,
        content: 'x'.repeat(4001),
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.EMPTY_MESSAGE },
      });
    });

    it('returns ok:false with NOT_IN_ORDER_ROOM when client has not joined', async () => {
      const client = makeClient();
      // client.rooms does NOT contain the order room

      const result = await gateway.sendMessage(client as never, {
        orderId: VALID_ORDER_ID,
        content: 'Hello!',
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.NOT_IN_ORDER_ROOM },
      });
    });

    it('returns ok:false with UNAUTHORIZED_ORDER_ACCESS when user is not a participant', async () => {
      mockChatMessageService.canAccessOrder.mockResolvedValue(false);
      const client = makeClient();
      client.rooms.add(`order:${VALID_ORDER_ID}`);

      const result = await gateway.sendMessage(client as never, {
        orderId: VALID_ORDER_ID,
        content: 'Hello!',
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.UNAUTHORIZED_ORDER_ACCESS },
      });
    });

    it('returns ok:false with MESSAGE_PERSISTENCE_FAILED when create() throws', async () => {
      mockChatMessageService.canAccessOrder.mockResolvedValue(true);
      mockChatMessageService.createFromChat.mockRejectedValue(
        new Error('DB connection lost'),
      );
      const client = makeClient();
      client.rooms.add(`order:${VALID_ORDER_ID}`);

      const result = await gateway.sendMessage(client as never, {
        orderId: VALID_ORDER_ID,
        content: 'Hello!',
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.MESSAGE_PERSISTENCE_FAILED },
      });
    });
  });

  // -------------------------------------------------------------------------
  // isValidOrderId (private helper)
  // -------------------------------------------------------------------------

  describe('isValidOrderId', () => {
    const check = (gw: ChatMessageGateway) =>
      asAny(gw).isValidOrderId as (v: unknown) => boolean;

    it('accepts a valid v4 UUID', () => {
      expect(check(gateway)(VALID_ORDER_ID)).toBe(true);
    });

    it('rejects an empty string', () => {
      expect(check(gateway)('')).toBe(false);
    });

    it('rejects a non-string value', () => {
      expect(check(gateway)(null)).toBe(false);
      expect(check(gateway)(42)).toBe(false);
    });

    it('rejects a partial UUID', () => {
      expect(check(gateway)('123e4567-e89b-12d3-a456')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // roomFor / orderIdFromRoom (private helpers)
  // -------------------------------------------------------------------------

  describe('roomFor / orderIdFromRoom', () => {
    it('roomFor produces order:<uuid>', () => {
      const room = (asAny(gateway).roomFor as (id: string) => string)(
        VALID_ORDER_ID,
      );
      expect(room).toBe(`order:${VALID_ORDER_ID}`);
    });

    it('orderIdFromRoom extracts the uuid back', () => {
      const id = (asAny(gateway).orderIdFromRoom as (r: string) => string)(
        `order:${VALID_ORDER_ID}`,
      );
      expect(id).toBe(VALID_ORDER_ID);
    });

    it('orderIdFromRoom returns the room as-is when prefix is missing', () => {
      const id = (asAny(gateway).orderIdFromRoom as (r: string) => string)(
        'no-prefix',
      );
      expect(id).toBe('no-prefix');
    });
  });
});
