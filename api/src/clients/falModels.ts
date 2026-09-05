/**
 * Per-endpoint capabilities and pricing for fal video models.
 *
 * Model ids move fast (CLAUDE.md), and a field the endpoint does not declare
 * is a 422 — so nothing here is guessed. Every entry is verified against
 * `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>` with
 * `pnpm fal:schema <id>` and dated. Pricing is NOT in that document and comes
 * from the model's playground page, also dated.
 *
 * An unlisted endpoint still works: it runs on the conservative defaults below
 * and prices from the scalar FAL_COST_PER_SECOND_USD fallback.
 */
export interface FalVideoModelCaps {
  /** null → fall back to config.falCostPerSecondUsd rather than reporting $0. */
  costPerSecondUsd: number | null;
  /** Per-resolution price where the family charges differently. Wins over the scalar. */
  costPerSecondByResolution?: Record<string, number>;
  supportsSeed: boolean;
  supportsEndImage: boolean;
  resolutions: readonly string[];
  /** Sent at all? Kling v3 has no resolution field; sending one is a 422. */
  supportsResolution: boolean;
  /** The shortest request the endpoint accepts — the real floor on shot length. */
  minDurationSeconds: number;
  maxDurationSeconds: number;
  /** What this endpoint calls the first frame. Kling v3 says start_image_url. */
  imageField: string;
  /** What it calls the last frame, when it has one. */
  endImageField: string;
  /** Kling and Seedance take duration as an enum STRING, not an integer. */
  durationType: 'integer' | 'string';
  /**
   * The endpoint rewrites the prompt before generating, so `expanded_prompt`
   * is what it actually generated from and our motion rules are only advisory.
   */
  rewritesPrompt: boolean;
  /** A real negative_prompt field, so MOTION_NEGATIVES can leave the prompt text. */
  hasNegativePrompt: boolean;
  /**
   * The audio-generation toggle, where one exists. It defaults to TRUE on
   * Kling and Seedance and merge strips clip audio anyway — on Kling that
   * default is a 50% surcharge for something we throw away.
   */
  audioField: string | null;
  /** Guidance strength toward the prompt, 0-1, where the family exposes it. */
  supportsCfgScale: boolean;
}

/** Conservative shape for an endpoint nobody has run `pnpm fal:schema` on. */
const DEFAULTS = {
  supportsSeed: false,
  supportsEndImage: false,
  supportsResolution: true,
  resolutions: ['768P'],
  minDurationSeconds: 5,
  maxDurationSeconds: 15,
  imageField: 'image_url',
  endImageField: 'end_image_url',
  durationType: 'integer',
  rewritesPrompt: false,
  hasNegativePrompt: false,
  audioField: null,
  supportsCfgScale: false,
} satisfies Omit<FalVideoModelCaps, 'costPerSecondUsd'>;

export const FAL_VIDEO_MODEL_CAPS: Record<string, FalVideoModelCaps> = {
  // schema verified 2 Sep 2026, re-verified 3 Sep 2026:
  //   seed IS accepted as input but is NOT echoed in the response
  //   end_image_url exists (first/last-frame is available)
  //   no negative_prompt — MOTION_NEGATIVES must stay in-prompt
  //   prompt_expansion_mode is a REQUIRED field: the endpoint rewrites our
  //   motion prompt into a ~400-word scene description and generates from that
  // pricing (playground, 3 Sep 2026): 480P $0.0125/s, 768P $0.02/s — but those
  // are PROMOTIONAL rates that expire 7 Sep 2026, after which they are $0.05
  // and $0.08. The post-promo numbers are recorded here on purpose: over-
  // reporting spend for four days is safe, under-reporting it by 4x is not.
  'minimax/h3-max/image-to-video': {
    ...DEFAULTS,
    costPerSecondUsd: 0.08,
    costPerSecondByResolution: { '480P': 0.05, '768P': 0.08 },
    supportsSeed: true,
    supportsEndImage: true,
    resolutions: ['480P', '768P'],
    minDurationSeconds: 5,
    rewritesPrompt: true,
  },

  // schema verified 3 Sep 2026. The reason to care about this family: it does
  // NOT rewrite the prompt, accepts 3s (our shortest useful shot), and has a
  // real negative_prompt plus cfg_scale — the two controls h3-max lacks.
  //   the first frame is `start_image_url`, NOT image_url
  //   duration is a STRING enum "3".."15"
  //   there is no resolution field at all
  //   generate_audio defaults TRUE and costs +50% on this family
  //   also exposes multi_prompt for multi-shot generation (untried)
  // pricing (playground, 3 Sep 2026): $0.112-0.196/s. The range is not
  // explained on the page, so the high end is recorded.
  'fal-ai/kling-video/v3/pro/image-to-video': {
    ...DEFAULTS,
    costPerSecondUsd: 0.196,
    supportsEndImage: true,
    supportsResolution: false,
    resolutions: [],
    minDurationSeconds: 3,
    imageField: 'start_image_url',
    durationType: 'string',
    hasNegativePrompt: true,
    audioField: 'generate_audio',
    supportsCfgScale: true,
  },

  // identical schema to v3/pro — a drop-in draft tier for the same code path.
  // pricing (playground, 3 Sep 2026): $0.084-0.154/s; high end recorded.
  'fal-ai/kling-video/v3/standard/image-to-video': {
    ...DEFAULTS,
    costPerSecondUsd: 0.154,
    supportsEndImage: true,
    supportsResolution: false,
    resolutions: [],
    minDurationSeconds: 3,
    imageField: 'start_image_url',
    durationType: 'string',
    hasNegativePrompt: true,
    audioField: 'generate_audio',
    supportsCfgScale: true,
  },

  // schema verified 3 Sep 2026. The economy tier, and the only endpoint that
  // accepts a 1s request — no seed, no end frame, no negative_prompt.
  // pricing (playground, 3 Sep 2026): 480p $0.05/s, 720p $0.07/s, plus
  // $0.002 per input image.
  'xai/grok-imagine-video/image-to-video': {
    ...DEFAULTS,
    costPerSecondUsd: 0.07,
    costPerSecondByResolution: { '480p': 0.05, '720p': 0.07 },
    resolutions: ['480p', '720p'],
    minDurationSeconds: 1,
  },

  // schema verified 3 Sep 2026. Does not rewrite the prompt and returns its
  // seed in the OUTPUT (so a take is reproducible after the fact, not before).
  //   duration is a STRING enum "auto","4".."15"
  //   generate_audio defaults TRUE but is priced the same either way
  // pricing (playground, 3 Sep 2026): $0.2419/s at 720p — 3x Kling standard,
  // so this is a deliberate premium choice, never a default.
  'bytedance/seedance-2.0/fast/image-to-video': {
    ...DEFAULTS,
    costPerSecondUsd: 0.2419,
    supportsEndImage: true,
    resolutions: ['480p', '720p'],
    minDurationSeconds: 4,
    durationType: 'string',
    audioField: 'generate_audio',
  },
};

export const UNKNOWN_MODEL_CAPS: FalVideoModelCaps = {
  ...DEFAULTS,
  costPerSecondUsd: null,
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

/**
 * env map → per-resolution verified price → scalar verified price → fallback.
 * Never silently reports $0, and never reports less than the verified rate.
 */
export function costPerSecondFor(
  model: string,
  costMap: Record<string, number>,
  fallback: number,
  resolution?: string,
): number {
  const mapped = costMap[model];
  if (mapped !== undefined) return mapped;
  const caps = capsFor(model);
  if (resolution && caps.costPerSecondByResolution?.[resolution] !== undefined) {
    return caps.costPerSecondByResolution[resolution]!;
  }
  return caps.costPerSecondUsd ?? fallback;
}
