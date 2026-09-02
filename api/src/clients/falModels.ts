/**
 * Per-endpoint capabilities and pricing for fal video models.
 *
 * Model ids move fast (CLAUDE.md), and a field the endpoint does not declare
 * is a 422 — so nothing here is guessed. Every entry is verified against
 * `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>` with
 * `pnpm exec tsx scripts/fal-schema.ts <id>` and dated.
 *
 * An unlisted endpoint still works: it just runs without seed or end-frame and
 * prices from the scalar FAL_COST_PER_SECOND_USD fallback.
 */
export interface FalVideoModelCaps {
  /** null → fall back to config.falCostPerSecondUsd rather than reporting $0. */
  costPerSecondUsd: number | null;
  supportsSeed: boolean;
  supportsEndImage: boolean;
  resolutions: readonly string[];
  maxDurationSeconds: number;
}

export const FAL_VIDEO_MODEL_CAPS: Record<string, FalVideoModelCaps> = {
  // verified 2 Sep 2026 against the live openapi document:
  //   seed IS accepted as input but is NOT echoed in the response
  //   end_image_url exists (first/last-frame is available on this model)
  //   there is no negative_prompt — MOTION_NEGATIVES must stay in-prompt
  //   resolution enum is exactly ["480P", "768P"]
  //   prompt_expansion_mode defaults to "balanced": the endpoint REWRITES our
  //   motion prompt and returns the rewrite as expanded_prompt
  'minimax/h3-max/image-to-video': {
    costPerSecondUsd: 0.04,
    supportsSeed: true,
    supportsEndImage: true,
    resolutions: ['480P', '768P'],
    maxDurationSeconds: 15,
  },
};

/** The safe subset for an endpoint nobody has checked yet. */
export const UNKNOWN_MODEL_CAPS: FalVideoModelCaps = {
  costPerSecondUsd: null,
  supportsSeed: false,
  supportsEndImage: false,
  resolutions: ['768P'],
  maxDurationSeconds: 15,
};

export function capsFor(model: string): FalVideoModelCaps {
  return FAL_VIDEO_MODEL_CAPS[model] ?? UNKNOWN_MODEL_CAPS;
}

/**
 * Parses FAL_COST_PER_SECOND_USD_MAP: "model:price,model:price".
 *
 * Flat rather than JSON on purpose: a dotenv value containing {"..."} invites
 * quoting mistakes and a '#' anywhere truncates the line. Model ids contain
 * '/' and '-' but no commas, and lastIndexOf keeps this correct even if a
 * future id contains a colon. Malformed entries are ignored, never fatal.
 */
export function parseCostMap(raw: string | undefined): Record<string, number> {
  const map: Record<string, number> = {};
  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const split = trimmed.lastIndexOf(':');
    if (split <= 0) continue;
    const model = trimmed.slice(0, split).trim();
    const price = Number(trimmed.slice(split + 1).trim());
    if (model && Number.isFinite(price) && price >= 0) map[model] = price;
  }
  return map;
}

/** env map → verified caps → scalar fallback. Never silently reports $0. */
export function costPerSecondFor(
  model: string,
  costMap: Record<string, number>,
  fallback: number,
): number {
  return costMap[model] ?? capsFor(model).costPerSecondUsd ?? fallback;
}
