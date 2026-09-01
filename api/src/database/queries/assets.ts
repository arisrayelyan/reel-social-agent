import type { FastifyInstance } from 'fastify';
import type { Asset, AssetKind, RightsRecord } from '@reel-agent/shared';

export interface NewAsset {
  videoId: number;
  beatIndex: number | null;
  kind: AssetKind;
  take: number;
  contentHash: string;
  filePath: string;
  durationSeconds?: number | null;
  prompt?: string | null;
  seed?: number | null;
  rightsRecord?: RightsRecord | null;
  costUsd?: number;
}

export async function insertAsset(app: FastifyInstance, asset: NewAsset): Promise<Asset> {
  // the newest take becomes the selected one; older takes stay for manual re-pick
  await app.pg.query(
    `UPDATE assets SET selected = false
      WHERE video_id = $1 AND kind = $2 AND beat_index IS NOT DISTINCT FROM $3`,
    [asset.videoId, asset.kind, asset.beatIndex],
  );
  const { rows } = await app.pg.query<Asset>(
    `INSERT INTO assets
       (video_id, beat_index, kind, take, content_hash, file_path, duration_seconds,
        prompt, seed, rights_record, cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      asset.videoId,
      asset.beatIndex,
      asset.kind,
      asset.take,
      asset.contentHash,
      asset.filePath,
      asset.durationSeconds ?? null,
      asset.prompt ?? null,
      asset.seed ?? null,
      asset.rightsRecord ? JSON.stringify(asset.rightsRecord) : null,
      asset.costUsd ?? 0,
    ],
  );
  return rows[0]!;
}

/**
 * Idempotency lookup: an asset with the same content hash means this step
 * already ran with identical inputs — never regenerate paid output.
 */
export async function findAssetByHash(
  app: FastifyInstance,
  videoId: number,
  kind: AssetKind,
  beatIndex: number | null,
  contentHash: string,
): Promise<Asset | null> {
  const { rows } = await app.pg.query<Asset>(
    `SELECT * FROM assets
      WHERE video_id = $1 AND kind = $2 AND beat_index IS NOT DISTINCT FROM $3
        AND content_hash = $4
      ORDER BY take DESC LIMIT 1`,
    [videoId, kind, beatIndex, contentHash],
  );
  return rows[0] ?? null;
}

export async function findAssetsByVideo(
  app: FastifyInstance,
  videoId: number,
): Promise<Asset[]> {
  const { rows } = await app.pg.query<Asset>(
    `SELECT * FROM assets WHERE video_id = $1 ORDER BY kind, beat_index, take`,
    [videoId],
  );
  return rows;
}

/** Currently selected asset of a kind for each beat (used by merge). */
export async function findSelectedAssets(
  app: FastifyInstance,
  videoId: number,
  kind: AssetKind,
): Promise<Asset[]> {
  const { rows } = await app.pg.query<Asset>(
    `SELECT * FROM assets
      WHERE video_id = $1 AND kind = $2 AND selected = true
      ORDER BY beat_index ASC NULLS LAST, take DESC`,
    [videoId, kind],
  );
  return rows;
}

/** Next take number for a (video, kind, beat) — takes are never overwritten. */
export async function nextTakeNumber(
  app: FastifyInstance,
  videoId: number,
  kind: AssetKind,
  beatIndex: number | null,
): Promise<number> {
  const { rows } = await app.pg.query<{ max: number | null }>(
    `SELECT MAX(take) AS max FROM assets
      WHERE video_id = $1 AND kind = $2 AND beat_index IS NOT DISTINCT FROM $3`,
    [videoId, kind, beatIndex],
  );
  return (rows[0]?.max ?? 0) + 1;
}

/** Marks one take selected and deselects siblings of the same (kind, beat). */
export async function selectAssetTake(
  app: FastifyInstance,
  assetId: number,
): Promise<Asset | null> {
  const { rows } = await app.pg.query<Asset>(`SELECT * FROM assets WHERE id = $1`, [assetId]);
  const asset = rows[0];
  if (!asset) return null;
  await app.pg.query(
    `UPDATE assets SET selected = (id = $1)
      WHERE video_id = $2 AND kind = $3 AND beat_index IS NOT DISTINCT FROM $4`,
    [assetId, asset.video_id, asset.kind, asset.beat_index],
  );
  return { ...asset, selected: true };
}
