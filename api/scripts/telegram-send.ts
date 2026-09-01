/**
 * Standalone Telegram notifier check (see README "Telegram notifier setup").
 * Usage:  cd api && pnpm exec tsx --env-file=.env scripts/telegram-send.ts [message]
 */
import axios from 'axios';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MESSAGE = process.argv[2] ?? 'Hello! This is a private message from reel-social-agent.';

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('❌ Error: Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in environment.');
  process.exit(1);
}

try {
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text: MESSAGE,
  });
  console.log('✅ Message sent successfully!');
} catch (error) {
  const err = error as { response?: { data?: unknown }; message?: string };
  console.error('❌ Error sending message:', err.response?.data ?? err.message);
  console.error(
    'Checklist: token from @BotFather · chat id from @userinfobot (your id, not the bot\'s) · you pressed Start in the bot chat.',
  );
  process.exit(1);
}
