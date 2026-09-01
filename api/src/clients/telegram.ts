import axios from 'axios';
import type { AppConfig } from '../config.js';

/**
 * Telegram notifier. Prerequisites (see README):
 *  1. @BotFather → /newbot → copy the HTTP API token
 *  2. @userinfobot → copy your numerical chat Id
 *  3. Open the bot chat and press Start — otherwise it cannot message you
 */
export class TelegramClient {
  constructor(private readonly config: AppConfig) {}

  get configured(): boolean {
    return Boolean(this.config.telegramBotToken && this.config.telegramChatId);
  }

  async send(text: string): Promise<void> {
    if (!this.configured) return; // notifications are best-effort, never block the pipeline
    const url = `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`;
    await axios.post(url, {
      chat_id: this.config.telegramChatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  async notifyDraftReady(params: { topic: string; costUsd: number }): Promise<void> {
    await this.send(
      `🎬 <b>Draft ready on TikTok</b>\n\n` +
        `<b>${escapeHtml(params.topic)}</b>\n` +
        `Cost: $${params.costUsd.toFixed(2)}\n\n` +
        `Open TikTok → Drafts → review, set the AI-generated label, and post.`,
    );
  }

  async notifyApprovalNeeded(params: { videoId: number; topic: string }): Promise<void> {
    await this.send(
      `👀 <b>Render ready for review</b>\n\n<b>${escapeHtml(params.topic)}</b> (video #${params.videoId}) finished rendering — review it in the dashboard.`,
    );
  }

  async notifyFailure(params: { videoId: number; topic: string; step: string; error: string }): Promise<void> {
    await this.send(
      `❌ <b>Pipeline failed</b>\n\n<b>${escapeHtml(params.topic)}</b> (video #${params.videoId}) failed at <b>${params.step}</b>:\n<code>${escapeHtml(params.error.slice(0, 500))}</code>`,
    );
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
