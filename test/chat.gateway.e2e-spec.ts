import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module, Injectable } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import type { Server } from 'http';
import { ChatMessageGateway } from '../src/modules/chat-message/chat-message.gateway';
import { ChatMessageService } from '../src/modules/chat-message/chat-message.service';
import {
  ChatErrorCode,
  ChatEvent,
} from '../src/modules/chat-message/chat-message.events';
import type { ChatMessage } from '@prisma/client';
import type { Socket } from 'socket.io-client';

// ---------------------------------------------------------------------------
// Attempt to load socket.io-client (optional devDependency)
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-require-imports -- socket.io-client is an optional devDependency, loaded conditionally at runtime */
let ioClient: typeof import('socket.io-client').io | undefined;
try {
  ioClient = (
    require('socket.io-client') as { io: typeof import('socket.io-client').io }
  ).io;
} catch {
  ioClient = undefined;
}
/* eslint-enable @typescript-eslint/no-require-imports */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = 'test-e2e-secret-do-not-use-in-production';
const VALID_ORDER_ID = '123e4567-e89b-12d3-a456-426614174000';
const BUYER_USER_ID = 'buyer-user-id';
const SELLER_USER_ID = 'seller-user-id';
const OUTSIDER_USER_ID = 'outsider-user-id';

// ---------------------------------------------------------------------------
// Fake ChatMessageService
// ---------------------------------------------------------------------------

@Injectable()
class FakeChatMessageService {
  private readonly messages: ChatMessage[] = [];
  private nextId = 1;

  canAccessOrder(orderId: string, userId: string): Promise<boolean | null> {
    if (orderId !== VALID_ORDER_ID) return Promise.resolve(null);
    return Promise.resolve(
      userId === BUYER_USER_ID || userId === SELLER_USER_ID,
    );
  }

  create(dto: {
    orderId: string;
    senderId: string;
    content: string;
  }): Promise<ChatMessage> {
    const message: ChatMessage = {
      messageId: `msg-${this.nextId++}`,
      orderId: dto.orderId,
      senderId: dto.senderId,
      content: dto.content,
      timestamp: new Date(),
    };
    this.messages.push(message);
    return Promise.resolve(message);
  }

  createFromChat(dto: {
    orderId: string;
    senderId: string;
    content: string;
  }): Promise<ChatMessage> {
    return this.create(dto);
  }

  getSignedAttachmentsForOrder(): Promise<[]> {
    return Promise.resolve([]);
  }

  reset(): void {
    this.messages.length = 0;
    this.nextId = 1;
  }
}

// ---------------------------------------------------------------------------
// Test module
// ---------------------------------------------------------------------------

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({
      secret: TEST_JWT_SECRET,
      signOptions: { expiresIn: '1h' },
    }),
  ],
  providers: [
    ChatMessageGateway,
    { provide: ChatMessageService, useClass: FakeChatMessageService },
  ],
})
class ChatGatewayTestModule {}

// ---------------------------------------------------------------------------
// socket.io-client type alias
// ---------------------------------------------------------------------------
type AnySocket = Socket;

/**
 * Minimal structural interface used only inside waitForEvent/emitWithAck so
 * we never touch socket.io-client's loosely-typed (`...args: any[]`) emit
 * overloads directly — that typing is what was leaking `any` into callers.
 */
interface EmitAckSocket {
  once(event: string, callback: (...args: unknown[]) => void): void;
  emit(event: string, payload: unknown, ack: (response: unknown) => void): void;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function waitForEvent<T = unknown>(
  socket: AnySocket,
  event: string,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for event "${event}" after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
    (socket as unknown as EmitAckSocket).once(event, (data: unknown) => {
      clearTimeout(timer);
      resolve(data as T);
    });
  });
}

function emitWithAck<TPayload, TAck = unknown>(
  socket: AnySocket,
  event: string,
  payload: TPayload,
  timeoutMs = 3000,
): Promise<TAck> {
  return new Promise<TAck>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for ack of "${event}" after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
    (socket as unknown as EmitAckSocket).emit(
      event,
      payload,
      (response: unknown) => {
        clearTimeout(timer);
        resolve(response as TAck);
      },
    );
  });
}

function connectClient(port: number, token?: string): AnySocket {
  if (!ioClient) throw new Error('socket.io-client is not installed');
  return ioClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    auth: token ? { token } : undefined,
    reconnection: false,
    forceNew: true,
  });
}

function waitForConnect(socket: AnySocket, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Connection timed out')),
      timeoutMs,
    );
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForConnectError(
  socket: AnySocket,
  timeoutMs = 3000,
): Promise<Error> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error('Expected connect_error but socket connected successfully'),
        ),
      timeoutMs,
    );
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timer);
      resolve(err);
    });
    socket.once('connect', () => {
      clearTimeout(timer);
      reject(
        new Error('Expected connect_error but socket connected successfully'),
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Conditional describe — skips entire suite when socket.io-client is absent
// ---------------------------------------------------------------------------

const describeE2E = ioClient ? describe : describe.skip;

describeE2E('ChatMessageGateway (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let fakeChatService: FakeChatMessageService;
  let port: number;

  let buyerToken: string;
  let sellerToken: string;
  let outsiderToken: string;

  const openSockets: AnySocket[] = [];

  // -------------------------------------------------------------------------
  // Setup / Teardown
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ChatGatewayTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0); // random free port

    const httpServer = app.getHttpServer() as Server;
    const address = httpServer.address() as { port: number };
    port = address.port;

    jwtService = moduleFixture.get<JwtService>(JwtService);
    fakeChatService =
      moduleFixture.get<FakeChatMessageService>(ChatMessageService);

    buyerToken = await jwtService.signAsync({ sub: BUYER_USER_ID });
    sellerToken = await jwtService.signAsync({ sub: SELLER_USER_ID });
    outsiderToken = await jwtService.signAsync({ sub: OUTSIDER_USER_ID });
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    for (const s of openSockets) {
      if (s.connected) s.disconnect();
    }
    openSockets.length = 0;
    fakeChatService.reset();
  });

  function connect(token?: string): AnySocket {
    const s = connectClient(port, token);
    openSockets.push(s);
    return s;
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  describe('Authentication', () => {
    it('connects with a valid JWT in handshake.auth.token', async () => {
      const buyer = connect(buyerToken);
      await expect(waitForConnect(buyer)).resolves.toBeUndefined();
    });

    it('connects with a valid JWT in Authorization: Bearer header', async () => {
      if (!ioClient) return;
      const socket = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        extraHeaders: { authorization: `Bearer ${buyerToken}` },
        reconnection: false,
        forceNew: true,
      });
      openSockets.push(socket);
      await expect(waitForConnect(socket)).resolves.toBeUndefined();
    });

    it('rejects connection without a token (emits INVALID_JWT)', async () => {
      const socket = connect(undefined);
      const err = await waitForConnectError(socket);
      expect(
        (err as Error & { data?: { code: string } }).data?.code ?? err.message,
      ).toMatch(/INVALID_JWT/);
    });

    it('rejects connection with a malformed JWT (emits INVALID_JWT)', async () => {
      const socket = connect('this.is.not.a.valid.jwt');
      const err = await waitForConnectError(socket);
      expect(
        (err as Error & { data?: { code: string } }).data?.code ?? err.message,
      ).toMatch(/INVALID_JWT/);
    });
  });

  // -------------------------------------------------------------------------
  // join-order
  // -------------------------------------------------------------------------

  describe('join-order', () => {
    it('buyer joins an order room and receives ok:true ack', async () => {
      const buyer = connect(buyerToken);
      await waitForConnect(buyer);

      const ack = await emitWithAck(buyer, ChatEvent.JOIN_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      expect(ack).toMatchObject({ ok: true });
    });

    it('seller in room receives USER_JOINED when buyer joins', async () => {
      const seller = connect(sellerToken);
      await waitForConnect(seller);
      await emitWithAck(seller, ChatEvent.JOIN_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      const buyer = connect(buyerToken);
      await waitForConnect(buyer);

      const joinedPromise = waitForEvent(seller, ChatEvent.USER_JOINED);
      await emitWithAck(buyer, ChatEvent.JOIN_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      const joined = await joinedPromise;
      expect(joined).toMatchObject({
        orderId: VALID_ORDER_ID,
        userId: BUYER_USER_ID,
      });
    });

    it('returns INVALID_ORDER_ID for a malformed orderId', async () => {
      const buyer = connect(buyerToken);
      await waitForConnect(buyer);

      const ack = await emitWithAck(buyer, ChatEvent.JOIN_ORDER, {
        orderId: 'bad-id',
      });

      expect(ack).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.INVALID_ORDER_ID },
      });
    });

    it('returns UNAUTHORIZED_ORDER_ACCESS for an outsider', async () => {
      const outsider = connect(outsiderToken);
      await waitForConnect(outsider);

      const ack = await emitWithAck(outsider, ChatEvent.JOIN_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      expect(ack).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.UNAUTHORIZED_ORDER_ACCESS },
      });
    });

    it('returns INVALID_ORDER_ID for an unknown order', async () => {
      const buyer = connect(buyerToken);
      await waitForConnect(buyer);

      const unknownOrderId = '00000000-0000-4000-8000-000000000001';
      const ack = await emitWithAck(buyer, ChatEvent.JOIN_ORDER, {
        orderId: unknownOrderId,
      });

      expect(ack).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.INVALID_ORDER_ID },
      });
    });
  });

  // -------------------------------------------------------------------------
  // leave-order
  // -------------------------------------------------------------------------

  describe('leave-order', () => {
    it('buyer receives ok:true when leaving a room they joined', async () => {
      const buyer = connect(buyerToken);
      await waitForConnect(buyer);
      await emitWithAck(buyer, ChatEvent.JOIN_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      const ack = await emitWithAck(buyer, ChatEvent.LEAVE_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      expect(ack).toMatchObject({ ok: true });
    });

    it('remaining participants receive USER_LEFT when buyer leaves', async () => {
      const seller = connect(sellerToken);
      await waitForConnect(seller);
      await emitWithAck(seller, ChatEvent.JOIN_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      const buyer = connect(buyerToken);
      await waitForConnect(buyer);
      await emitWithAck(buyer, ChatEvent.JOIN_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      const leftPromise = waitForEvent(seller, ChatEvent.USER_LEFT);
      await emitWithAck(buyer, ChatEvent.LEAVE_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      const leftEvent = await leftPromise;
      expect(leftEvent).toMatchObject({
        orderId: VALID_ORDER_ID,
        userId: BUYER_USER_ID,
      });
    });

    it('returns ok:true even when not in the room', async () => {
      const buyer = connect(buyerToken);
      await waitForConnect(buyer);

      const ack = await emitWithAck(buyer, ChatEvent.LEAVE_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      expect(ack).toMatchObject({ ok: true });
    });
  });

  // -------------------------------------------------------------------------
  // send-message
  // -------------------------------------------------------------------------

  describe('send-message', () => {
    it('persists, broadcasts message-created to room, acks {ok:true}', async () => {
      const buyer = connect(buyerToken);
      await waitForConnect(buyer);
      await emitWithAck(buyer, ChatEvent.JOIN_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      const seller = connect(sellerToken);
      await waitForConnect(seller);
      await emitWithAck(seller, ChatEvent.JOIN_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      const messageCreatedPromise = waitForEvent(
        seller,
        ChatEvent.MESSAGE_CREATED,
      );

      const ack = await emitWithAck(buyer, ChatEvent.SEND_MESSAGE, {
        orderId: VALID_ORDER_ID,
        content: 'Hello from buyer!',
        clientMessageId: 'cid-001',
      });

      expect(ack).toMatchObject({
        ok: true,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          content: 'Hello from buyer!',
          senderId: BUYER_USER_ID,
          clientMessageId: 'cid-001',
        }),
      });

      const broadcast = await messageCreatedPromise;
      expect(broadcast).toMatchObject({
        content: 'Hello from buyer!',
        senderId: BUYER_USER_ID,
        orderId: VALID_ORDER_ID,
      });
    });

    it('sender also receives the message-created broadcast', async () => {
      const buyer = connect(buyerToken);
      await waitForConnect(buyer);
      await emitWithAck(buyer, ChatEvent.JOIN_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      const messageCreatedPromise = waitForEvent(
        buyer,
        ChatEvent.MESSAGE_CREATED,
      );
      await emitWithAck(buyer, ChatEvent.SEND_MESSAGE, {
        orderId: VALID_ORDER_ID,
        content: 'Solo message',
      });

      const broadcast = await messageCreatedPromise;
      expect(broadcast).toMatchObject({ content: 'Solo message' });
    });

    it('returns NOT_IN_ORDER_ROOM when sender has not joined', async () => {
      const buyer = connect(buyerToken);
      await waitForConnect(buyer);

      const ack = await emitWithAck(buyer, ChatEvent.SEND_MESSAGE, {
        orderId: VALID_ORDER_ID,
        content: 'Ghost message',
      });

      expect(ack).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.NOT_IN_ORDER_ROOM },
      });
    });

    it('returns EMPTY_MESSAGE for blank content', async () => {
      const buyer = connect(buyerToken);
      await waitForConnect(buyer);
      await emitWithAck(buyer, ChatEvent.JOIN_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      const ack = await emitWithAck(buyer, ChatEvent.SEND_MESSAGE, {
        orderId: VALID_ORDER_ID,
        content: '   ',
      });

      expect(ack).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.EMPTY_MESSAGE },
      });
    });

    it('returns EMPTY_MESSAGE for content exceeding 4000 chars', async () => {
      const buyer = connect(buyerToken);
      await waitForConnect(buyer);
      await emitWithAck(buyer, ChatEvent.JOIN_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      const ack = await emitWithAck(buyer, ChatEvent.SEND_MESSAGE, {
        orderId: VALID_ORDER_ID,
        content: 'x'.repeat(4001),
      });

      expect(ack).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.EMPTY_MESSAGE },
      });
    });

    it('returns INVALID_ORDER_ID for a malformed orderId', async () => {
      const buyer = connect(buyerToken);
      await waitForConnect(buyer);

      const ack = await emitWithAck(buyer, ChatEvent.SEND_MESSAGE, {
        orderId: 'not-a-uuid',
        content: 'Hello!',
      });

      expect(ack).toMatchObject({
        ok: false,
        error: { code: ChatErrorCode.INVALID_ORDER_ID },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Disconnection: USER_LEFT broadcast
  // -------------------------------------------------------------------------

  describe('Disconnection', () => {
    it('broadcasts USER_LEFT to room when a participant disconnects', async () => {
      const seller = connect(sellerToken);
      await waitForConnect(seller);
      await emitWithAck(seller, ChatEvent.JOIN_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      const buyer = connect(buyerToken);
      await waitForConnect(buyer);
      await emitWithAck(buyer, ChatEvent.JOIN_ORDER, {
        orderId: VALID_ORDER_ID,
      });

      const leftPromise = waitForEvent(seller, ChatEvent.USER_LEFT);
      buyer.disconnect();

      const leftEvent = await leftPromise;
      expect(leftEvent).toMatchObject({
        orderId: VALID_ORDER_ID,
        userId: BUYER_USER_ID,
      });
    });
  });
});
