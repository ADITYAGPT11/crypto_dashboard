/**
 * Telegram Bot API Service (Module 7)
 *
 * Sends formatted alert notifications to configured Telegram chats.
 * Uses the Telegram Bot API HTTPS endpoint with rate limit handling.
 *
 * Environment variables needed:
 * - TELEGRAM_BOT_TOKEN: The bot token from @BotFather
 * - TELEGRAM_CHAT_ID: Target chat ID (or comma-separated list)
 */

import type { AlertTrigger, AlertRule } from "../types/alertRules";

export interface TelegramConfig {
  botToken: string;
  chatIds: string[];
}

export interface TelegramMessage {
  chatId: string;
  text: string;
  parseMode?: "HTML" | "Markdown";
}

interface TelegramApiResponse {
  ok: boolean;
  error_code?: number;
  description?: string;
}

class TelegramService {
  private config: TelegramConfig | null = null;
  private rateLimitWindow = 1000; // ms between messages to same chat
  private lastSentAt: Map<string, number> = new Map();
  private pendingRetries: Map<string, { message: TelegramMessage; attempt: number }> = new Map();

  configure(config: TelegramConfig): void {
    this.config = config;
    this.lastSentAt.clear();
    this.pendingRetries.clear();
  }

  isConfigured(): boolean {
    return (
      this.config !== null && this.config.botToken.length > 0 && this.config.chatIds.length > 0
    );
  }

  /**
   * Send an alert notification to all configured chats.
   * Handles rate limiting and retries on failure.
   */
  async sendAlert(trigger: AlertTrigger, rule?: AlertRule): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn("[Telegram] Not configured - cannot send alert");
      return false;
    }

    const text = formatAlertMessage(trigger, rule);

    const results = await Promise.allSettled(
      this.config!.chatIds.map((chatId) => this.sendMessage({ chatId, text })),
    );

    const allSucceeded = results.every((r) => r.status === "fulfilled" && r.value === true);

    if (allSucceeded) {
      console.log("[Telegram] Alert sent successfully");
    } else {
      console.error("[Telegram] Some messages failed to send");
    }

    return allSucceeded;
  }

  /**
   * Send a generic message to all configured chats.
   */
  async sendMessage(message: TelegramMessage): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    const rateLimitKey = message.chatId;
    const now = Date.now();
    const lastSent = this.lastSentAt.get(rateLimitKey) ?? 0;

    // Rate limiting: wait if needed
    if (now - lastSent < this.rateLimitWindow) {
      await this.sleep(this.rateLimitWindow - (now - lastSent));
    }

    try {
      const response = await this.makeRequest("sendMessage", {
        chat_id: message.chatId,
        text: message.text,
        parse_mode: message.parseMode ?? "HTML",
      });

      if (response.ok) {
        this.lastSentAt.set(rateLimitKey, Date.now());
        return true;
      } else {
        console.error(`[Telegram] API error: ${response.description}`);
        this.handleError(message, response.error_code ?? 0);
        return false;
      }
    } catch (error) {
      console.error("[Telegram] Request failed:", error);
      this.handleError(message, 0);
      return false;
    }
  }

  private handleError(message: TelegramMessage, errorCode: number): void {
    // Retry logic for rate limits (429) and transient errors
    if (errorCode === 429 || errorCode === 500 || errorCode === 502 || errorCode === 503) {
      const existing = this.pendingRetries.get(message.chatId);
      if (!existing || existing.attempt < 3) {
        this.pendingRetries.set(message.chatId, {
          message,
          attempt: (existing?.attempt ?? 0) + 1,
        });
        // Retry after delay
        setTimeout(() => {
          this.pendingRetries.delete(message.chatId);
          void this.sendMessage(message);
        }, 5000);
      }
    }
  }

  private async makeRequest<T>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<TelegramApiResponse & T> {
    const url = `https://api.telegram.org/bot${this.config!.botToken}/${method}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStatus(): { configured: boolean; chatCount: number; pendingRetries: number } {
    return {
      configured: this.isConfigured(),
      chatCount: this.config?.chatIds.length ?? 0,
      pendingRetries: this.pendingRetries.size,
    };
  }
}

/**
 * Format an alert trigger into a readable Telegram message.
 */
function formatAlertMessage(trigger: AlertTrigger, rule?: AlertRule): string {
  const date = new Date(trigger.firedAt).toLocaleString();

  let message = `<b>🚨 ALERT FIRED</b>\n\n`;
  message += `<b>Rule:</b> ${trigger.ruleName}\n`;
  message += `<b>Time:</b> ${date}\n\n`;
  message += `<b>Reason:</b> ${trigger.reason}\n\n`;

  if (Object.keys(trigger.values).length > 0) {
    message += `<b>Values:</b>\n`;
    for (const [key, value] of Object.entries(trigger.values)) {
      message += `  • ${key}: ${value}\n`;
    }
  }

  if (rule) {
    message += `\n<b>Rule ID:</b> ${rule.id}\n`;
    message += `<b>Cooldown:</b> ${rule.cooldownMs / 1000}s\n`;
  }

  return message;
}

// Singleton instance
export const telegramService = new TelegramService();
