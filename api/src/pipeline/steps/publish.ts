import type { FastifyInstance } from 'fastify';
import type { Story } from '@reel-agent/shared';
import { TikTokClient } from '../../clients/tiktok.js';
import { TelegramClient } from '../../clients/telegram.js';
import { toAbsolute } from '../../utils/files.js';
import { findSelectedAssets } from '../../database/queries/assets.js';
import { createPublication, updatePublication } from '../../database/queries/publications.js';
import { findVideoById } from '../../database/queries/videos.js';
import { publishEvent } from '../events.js';

/**
 * Uploads the final MP4 into the user's TikTok inbox (drafts) and notifies
 * Telegram. The human posts from the app (AIGC label + caption) — that is
 * the deliberate QA gate, not a missing feature (docs/pipeline-decisions §3).
 */
export async function runPublishStep(app: FastifyInstance, videoId: number, story: Story): Promise<void> {
  const finalAsset = (await findSelectedAssets(app, videoId, 'final'))[0];
  if (!finalAsset) throw new Error('No final video to publish');

  const tiktok = new TikTokClient(app.config);
  const telegram = new TelegramClient(app.config);
  const publication = await createPublication(app, videoId, story.tiktok_caption);

  await publishEvent(app, {
    video_id: videoId,
    step: 'publish',
    status: 'progress',
    message: 'Uploading to TikTok inbox',
  });

  const publishId = await tiktok.uploadToInbox(
    app,
    toAbsolute(app.config.storageDir, finalAsset.file_path),
  );
  await updatePublication(app, publication.id, { publishId, status: 'uploaded' });

  // poll until TikTok has moved the upload into the user's inbox
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const { status, failReason } = await tiktok.fetchPublishStatus(app, publishId);
    if (status === 'SEND_TO_USER_INBOX' || status === 'PUBLISH_COMPLETE') {
      await updatePublication(app, publication.id, { status: 'in_drafts', response: { status } });
      break;
    }
    if (status === 'FAILED') {
      await updatePublication(app, publication.id, { status: 'failed', response: { status, failReason } });
      throw new Error(`TikTok upload failed: ${failReason ?? 'unknown reason'}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`TikTok publish status polling timed out (last status: ${status})`);
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }

  const video = await findVideoById(app, videoId);
  await telegram
    .notifyDraftReady({ topic: story.topic, costUsd: Number(video?.total_cost_usd ?? 0) })
    .catch((err) => app.log.warn({ err }, 'telegram notify failed'));
}
