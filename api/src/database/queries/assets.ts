import type { FastifyInstance } from 'fastify';
import type { Asset, AssetKind, RightsRecord } from '@reel-agent/shared';

export interface NewAsset {
  videoId: number;
  beatIndex: number | null;
  kind: AssetKind;
  /** Which shot slot inside the beat. 0 for everything that has one frame. */
  variant?: number;
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
  // the newest take becomes the selected one; older takes stay for manual
  // re-pick. Scoped BY VARIANT: a beat's second still must not deselect its
  // first — those are different shots, not competing takes of one shot.
  await app.pg.query(
    `UPDATE assets SET selected = false
      WHERE video_id = $1 AND kind = $2 AND beat_index IS NOT DISTINCT FROM $3
        AND variant = $4`,
    [asset.videoId, asset.kind, asset.beatIndex, asset.variant ?? 0],
  );
  const { rows } = await app.pg.query<Asset>(
    `INSERT INTO assets
       (video_id, beat_index, kind, variant, take, content_hash, file_path,
        duration_seconds, prompt, seed, rights_record, cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      asset.videoId,
      asset.beatIndex,
      asset.kind,
      asset.variant ?? 0,
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
  variant = 0,
): Promise<Asset | null> {
  const { rows } = await app.pg.query<Asset>(
    `SELECT * FROM assets
      WHERE video_id = $1 AND kind = $2 AND beat_index IS NOT DISTINCT FROM $3
        AND content_hash = $4 AND variant = $5
      ORDER BY take DESC LIMIT 1`,
    [videoId, kind, beatIndex, contentHash, variant],
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
      ORDER BY beat_index ASC NULLS LAST, variant ASC, take DESC`,
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
  variant = 0,
): Promise<number> {
  const { rows } = await app.pg.query<{ max: number | null }>(
    `SELECT MAX(take) AS max FROM assets
      WHERE video_id = $1 AND kind = $2 AND beat_index IS NOT DISTINCT FROM $3
        AND variant = $4`,
    [videoId, kind, beatIndex, variant],
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
