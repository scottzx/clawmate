import axios from 'axios';
import {
  DWClient,
  TOPIC_ROBOT,
  RobotMessage,
  EventAck,
} from 'dingtalk-stream';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export interface DingTalkChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

// Map conversationId to sessionWebhook for sending replies
type SessionWebhookMap = Map<string, string>;

/**
 * DingTalk Channel using Stream Mode SDK
 * @see https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs
 */
export class DingTalkChannel implements Channel {
  name = 'dingtalk';

  private client: DWClient | null = null;
  private opts: DingTalkChannelOpts;
  private clientId: string;
  private clientSecret: string;
  private sessionWebhooks: SessionWebhookMap = new Map();

  constructor(clientId: string, clientSecret: string, opts: DingTalkChannelOpts) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.client = new DWClient({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      debug: process.env.DINGTALK_DEBUG === 'true',
    });

    // Register robot message listener
    this.client.registerCallbackListener(TOPIC_ROBOT, async (res) => {
      try {
        const message = JSON.parse(res.data) as RobotMessage;
        await this.handleRobotMessage(message);
      } catch (err) {
        logger.error({ err }, 'Failed to parse DingTalk message');
      }
    });

    // Register all-event listener for ack
    this.client.registerAllEventListener((message) => {
      return { status: EventAck.SUCCESS };
    });

    // Start connection
    await new Promise<void>((resolve, reject) => {
      this.client!.on('CONNECTED', () => {
        logger.info('DingTalk Stream connected');
        resolve();
      });

      this.client!.on('error', (err: Error) => {
        logger.error({ err }, 'DingTalk Stream error');
        reject(err);
      });

      this.client!.connect().catch(reject);
    });

    logger.info('DingTalk bot connected');
  }

  private async handleRobotMessage(message: RobotMessage): Promise<void> {
    const {
      conversationId,
      senderStaffId,
      senderNick,
      conversationType,
      sessionWebhook,
      msgtype,
      text,
      msgId,
      createAt,
    } = message;

    // Store sessionWebhook for sending replies
    this.sessionWebhooks.set(conversationId, sessionWebhook);

    const chatJid = `dingtalk:${conversationId}`;
    const timestamp = new Date(createAt).toISOString();
    const senderName = senderNick || senderStaffId;
    const isGroup = conversationType === 'group' || conversationType === '2';

    // Store chat metadata
    this.opts.onChatMetadata(chatJid, timestamp, undefined, 'dingtalk', isGroup);

    // Check if registered
    const group = this.opts.registeredGroups()[chatJid];
    if (!group) {
      logger.debug({ chatJid, conversationId }, 'Message from unregistered DingTalk conversation');
      return;
    }

    // Handle commands
    if (msgtype === 'text' && text?.content) {
      const content = text.content.trim();

      // /chatid command
      if (content === '/chatid' || content === '！chatid') {
        await this.sendMessage(chatJid, `Chat ID: \`${chatJid}\`\nConversation ID: ${conversationId}\nType: ${isGroup ? 'Group' : 'Private'}`);
        return;
      }

      // /ping command
      if (content === '/ping' || content === '！ping') {
        await this.sendMessage(chatJid, `${ASSISTANT_NAME} is online.`);
        return;
      }
    }

    // Determine message content based on type
    let messageContent = '';
    switch (msgtype) {
      case 'text':
        messageContent = text?.content || '';
        break;
      case 'image':
        messageContent = '[Image]';
        break;
      case 'file':
        messageContent = '[File]';
        break;
      case 'audio':
        messageContent = '[Audio]';
        break;
      case 'video':
        messageContent = '[Video]';
        break;
      case 'link':
        messageContent = '[Link]';
        break;
      default:
        messageContent = `[${msgtype}]`;
    }

    if (!messageContent) {
      return;
    }

    // Deliver message
    this.opts.onMessage(chatJid, {
      id: msgId,
      chat_jid: chatJid,
      sender: senderStaffId,
      sender_name: senderName,
      content: messageContent,
      timestamp,
      is_from_me: false,
    });

    logger.info({ chatJid, sender: senderName }, 'DingTalk message received');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const conversationId = jid.replace(/^dingtalk:/, '');
    const sessionWebhook = this.sessionWebhooks.get(conversationId);

    if (!sessionWebhook) {
      logger.warn({ jid }, 'No sessionWebhook stored for conversation');
      return;
    }

    if (!this.client) {
      logger.warn('DingTalk client not initialized');
      return;
    }

    try {
      const accessToken = await this.client.getAccessToken();

      // DingTalk has message length limits - split if needed
      const MAX_LENGTH = 2000;
      const chunks: string[] = [];

      if (text.length <= MAX_LENGTH) {
        chunks.push(text);
      } else {
        // Split into chunks, trying to break at newlines
        let remaining = text;
        while (remaining.length > 0) {
          const chunkEnd = Math.min(MAX_LENGTH, remaining.length);
          let splitPoint = chunkEnd;

          // Try to find a newline break point
          if (remaining.length > MAX_LENGTH) {
            const lastNewline = remaining.lastIndexOf('\n', MAX_LENGTH);
            if (lastNewline > MAX_LENGTH * 0.5) {
              splitPoint = lastNewline + 1;
            }
          }

          chunks.push(remaining.slice(0, splitPoint).trimEnd());
          remaining = remaining.slice(splitPoint);
        }
      }

      for (const chunk of chunks) {
        const body = {
          msgtype: 'text',
          text: {
            content: chunk,
          },
        };

        await axios({
          url: sessionWebhook,
          method: 'POST',
          responseType: 'json',
          data: body,
          headers: {
            'x-acs-dingtalk-access-token': accessToken,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        });
      }

      logger.info({ jid, length: text.length }, 'DingTalk message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send DingTalk message');
    }
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('dingtalk:');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
      this.sessionWebhooks.clear();
      logger.info('DingTalk bot disconnected');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    // DingTalk doesn't support typing indicators via Stream API
    // This is a no-op for compatibility
  }
}

// Self-registration
registerChannel('dingtalk', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['DINGTALK_CLIENT_ID', 'DINGTALK_CLIENT_SECRET']);
  const clientId = process.env.DINGTALK_CLIENT_ID || envVars.DINGTALK_CLIENT_ID || '';
  const clientSecret = process.env.DINGTALK_CLIENT_SECRET || envVars.DINGTALK_CLIENT_SECRET || '';

  if (!clientId || !clientSecret) {
    logger.debug('DingTalk: DINGTALK_CLIENT_ID or DINGTALK_CLIENT_SECRET not set');
    return null;
  }

  return new DingTalkChannel(clientId, clientSecret, opts);
});
