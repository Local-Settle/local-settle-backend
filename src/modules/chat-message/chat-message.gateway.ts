import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ChatMessage } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { ChatMessageService } from './chat-message.service';
import {
  ChatAck,
  ChatError,
  ChatErrorCode,
  ChatEvent,
} from './chat-message.events';
import { OrderRoomDto, SendMessageDto } from './dto/send-message.dto';

interface ChatJwtPayload {
  sub?: string;
  publicKey?: string;
}

interface AuthenticatedSocketData {
  userId: string;
  publicKey?: string;
}

interface ChatServerEvents {
  [ChatEvent.MESSAGE_CREATED]: (message: CreatedChatMessage) => void;
  [ChatEvent.CHAT_ERROR]: (error: ChatError) => void;
  [ChatEvent.USER_JOINED]: (event: { orderId: string; userId: string }) => void;
  [ChatEvent.USER_LEFT]: (event: { orderId: string; userId: string }) => void;
}

type CreatedChatMessage = ChatMessage & { clientMessageId?: string };

type ChatSocket = Socket<
  Record<string, never>,
  ChatServerEvents,
  Record<string, never>,
  AuthenticatedSocketData
>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'https://ikash-frontend-dev-977686155876.us-central1.run.app',
  'https://ikash.it.com',
  process.env.FRONTEND_URL,
].filter((origin): origin is string => Boolean(origin));

@WebSocketGateway({
  cors: { origin: allowedOrigins, credentials: true },
  pingInterval: 25_000,
  pingTimeout: 20_000,
})
export class ChatMessageGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(ChatMessageGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly chatMessages: ChatMessageService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.authenticateSocket(socket as ChatSocket).then(
        () => next(),
        (error: unknown) =>
          next(
            error instanceof Error ? error : new Error('Authentication failed'),
          ),
      );
    });
  }

  handleConnection(client: ChatSocket): void {
    client.on('disconnecting', () => {
      for (const room of client.rooms) {
        if (room === client.id) continue;
        client.to(room).emit(ChatEvent.USER_LEFT, {
          orderId: this.orderIdFromRoom(room),
          userId: client.data.userId,
        });
      }
    });
  }

  @SubscribeMessage(ChatEvent.JOIN_ORDER)
  async joinOrder(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() body: OrderRoomDto,
  ): Promise<ChatAck> {
    const orderId = body?.orderId;
    if (!this.isValidOrderId(orderId)) {
      return this.fail(
        client,
        ChatErrorCode.INVALID_ORDER_ID,
        'Invalid order ID.',
        orderId,
      );
    }

    const accessError = await this.getAccessError(client, orderId);
    if (accessError) return this.failWith(client, accessError);

    const room = this.roomFor(orderId);
    if (!client.rooms.has(room)) {
      await client.join(room);
      client.to(room).emit(ChatEvent.USER_JOINED, {
        orderId,
        userId: client.data.userId,
      });
    }

    return { ok: true };
  }

  @SubscribeMessage(ChatEvent.LEAVE_ORDER)
  async leaveOrder(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() body: OrderRoomDto,
  ): Promise<ChatAck> {
    const orderId = body?.orderId;
    if (!this.isValidOrderId(orderId)) {
      return this.fail(
        client,
        ChatErrorCode.INVALID_ORDER_ID,
        'Invalid order ID.',
        orderId,
      );
    }

    const room = this.roomFor(orderId);
    if (client.rooms.has(room)) {
      await client.leave(room);
      client.to(room).emit(ChatEvent.USER_LEFT, {
        orderId,
        userId: client.data.userId,
      });
    }
    return { ok: true };
  }

  @SubscribeMessage(ChatEvent.SEND_MESSAGE)
  async sendMessage(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() body: SendMessageDto,
  ): Promise<ChatAck<CreatedChatMessage>> {
    const orderId = body?.orderId;
    if (!this.isValidOrderId(orderId)) {
      return this.fail(
        client,
        ChatErrorCode.INVALID_ORDER_ID,
        'Invalid order ID.',
        orderId,
      );
    }

    const content =
      typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content) {
      return this.fail(
        client,
        ChatErrorCode.EMPTY_MESSAGE,
        'Message cannot be empty.',
        orderId,
      );
    }
    if (content.length > 4000) {
      return this.fail(
        client,
        ChatErrorCode.EMPTY_MESSAGE,
        'Message is too long.',
        orderId,
      );
    }
    if (body?.clientMessageId && !this.isValidOrderId(body.clientMessageId)) {
      return this.fail(
        client,
        ChatErrorCode.INVALID_ORDER_ID,
        'clientMessageId must be a UUID.',
        orderId,
      );
    }

    const room = this.roomFor(orderId);
    if (!client.rooms.has(room)) {
      return this.fail(
        client,
        ChatErrorCode.NOT_IN_ORDER_ROOM,
        'Join the order room before sending a message.',
        orderId,
      );
    }

    const accessError = await this.getAccessError(client, orderId);
    if (accessError) return this.failWith(client, accessError);

    try {
      const message = await this.chatMessages.create({
        orderId,
        senderId: client.data.userId,
        content,
      });
      const createdMessage: CreatedChatMessage = {
        ...message,
        clientMessageId: body.clientMessageId,
      };
      this.server.to(room).emit(ChatEvent.MESSAGE_CREATED, createdMessage);
      return { ok: true, data: createdMessage };
    } catch (error) {
      this.logger.error(
        `Failed to persist chat message for order ${orderId}`,
        error instanceof Error ? error.stack : undefined,
      );
      return this.fail(
        client,
        ChatErrorCode.MESSAGE_PERSISTENCE_FAILED,
        'The message could not be saved. Please try again.',
        orderId,
      );
    }
  }

  private async getAccessError(
    client: ChatSocket,
    orderId: string,
  ): Promise<ChatError | null> {
    const isParticipant = await this.chatMessages.canAccessOrder(
      orderId,
      client.data.userId,
    );
    if (isParticipant === null) {
      return {
        code: ChatErrorCode.INVALID_ORDER_ID,
        message: 'Order not found.',
        orderId,
      };
    }
    if (!isParticipant && !this.isSupportUser(client.data)) {
      return {
        code: ChatErrorCode.UNAUTHORIZED_ORDER_ACCESS,
        message: 'You are not authorized to access this order chat.',
        orderId,
      };
    }
    return null;
  }

  private isSupportUser(identity: AuthenticatedSocketData): boolean {
    const userIds = this.configuredValues('CHAT_SUPPORT_USER_IDS');
    const publicKeys = new Set([
      ...this.configuredValues('CHAT_SUPPORT_PUBLIC_KEYS'),
      ...this.configuredValues('IKASH_SUPPORT_ADDRESS'),
    ]);
    return (
      userIds.has(identity.userId) ||
      Boolean(identity.publicKey && publicKeys.has(identity.publicKey))
    );
  }

  private configuredValues(key: string): Set<string> {
    return new Set(
      (this.config.get<string>(key) ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
  }

  private async authenticateSocket(client: ChatSocket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('Missing token');

      const payload = await this.jwtService.verifyAsync<ChatJwtPayload>(token);
      if (!payload.sub) throw new Error('Missing token subject');

      client.data.userId = payload.sub;
      client.data.publicKey = payload.publicKey;
    } catch {
      const details: ChatError = {
        code: ChatErrorCode.INVALID_JWT,
        message: 'A valid, unexpired access token is required.',
      };
      const error = new Error(details.message) as Error & { data: ChatError };
      error.data = details;
      throw error;
    }
  }

  private extractToken(client: ChatSocket): string | undefined {
    const authToken = (
      client.handshake.auth as Record<string, unknown> | undefined
    )?.token;
    if (typeof authToken === 'string' && authToken.trim())
      return authToken.trim();

    const authorization = client.handshake.headers.authorization;
    if (typeof authorization !== 'string') return undefined;
    const [scheme, token] = authorization.split(' ');
    return scheme?.toLowerCase() === 'bearer' ? token : undefined;
  }

  private isValidOrderId(orderId: unknown): orderId is string {
    return typeof orderId === 'string' && UUID_PATTERN.test(orderId);
  }

  private roomFor(orderId: string): string {
    return `order:${orderId}`;
  }

  private orderIdFromRoom(room: string): string {
    return room.startsWith('order:') ? room.slice(6) : room;
  }

  private fail<T = undefined>(
    client: ChatSocket,
    code: ChatErrorCode,
    message: string,
    orderId?: string,
  ): ChatAck<T> {
    return this.failWith(client, { code, message, orderId });
  }

  private failWith<T = undefined>(
    client: ChatSocket,
    error: ChatError,
  ): ChatAck<T> {
    this.emitError(client, error);
    return { ok: false, error };
  }

  private emitError(client: ChatSocket, error: ChatError): void {
    client.emit(ChatEvent.CHAT_ERROR, error);
  }
}
