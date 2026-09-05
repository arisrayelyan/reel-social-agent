/**
 * Prints a fal endpoint's real input/output schema before you point
 * FAL_VIDEO_MODEL at it.
 *
 * Never trust a remembered schema: field names differ per family (`duration`
 * int vs enum, `resolution` vs `image_size`, `negative_prompt` present or
 * absent), and a guessed field is a 422.
 *
 *   cd api && pnpm exec tsx scripts/fal-schema.ts minimax/h3-max/image-to-video
 *
 * Hits only the public, unauthenticated openapi document. No FAL_KEY, no
 * generation, no charge. Never call this from a test.
 */
const endpointId = process.argv[2];
if (!endpointId) {
  console.error('usage: tsx scripts/fal-schema.ts <endpoint-id>');
  process.exit(1);
}

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  description?: string;
  title?: string;
  $ref?: string;
  items?: JsonSchema;
  'x-fal-order-properties'?: string[];
}

interface OpenApiDoc {
  paths?: Record<string, Record<string, {
    requestBody?: { content?: Record<string, { schema?: JsonSchema }> };
    responses?: Record<string, { content?: Record<string, { schema?: JsonSchema }> }>;
    get?: {
      responses?: Record<string, { content?: Record<string, { schema?: JsonSchema }> }>;
    };
  } | undefined>>;
  components?: { schemas?: Record<string, JsonSchema> };
  'x-fal-metadata'?: { playgroundUrl?: string; documentationUrl?: string };
}

/** Follows $ref rather than guessing a schema name: the h3-max output schema
 *  is titled TurboImageToVideoHailuo03Output, which no naming rule predicts. */
function deref(doc: OpenApiDoc, schema: JsonSchema | undefined): JsonSchema | undefined {
  if (!schema) return undefined;
  if (!schema.$ref) return schema;
  const name = schema.$ref.split('/').pop()!;
  return doc.components?.schemas?.[name];
}

function typeOf(schema: JsonSchema): string {
  const raw = Array.isArray(schema.type) ? schema.type.join('|') : (schema.type ?? '?');
  if (schema.enum) return `${raw} ${JSON.stringify(schema.enum)}`;
  const bounds = [
    schema.minimum === undefined ? null : `min ${schema.minimum}`,
    schema.maximum === undefined ? null : `max ${schema.maximum}`,
  ].filter(Boolean);
  return bounds.length > 0 ? `${raw} (${bounds.join(', ')})` : raw;
}

/**
 * Duration is an integer with minimum/maximum on some families and a STRING
 * enum on others (Kling: "3".."15", Seedance: "auto","4".."15"), so the bound
 * has to be read from whichever shape the endpoint declares.
 */
function durationBound(schema: JsonSchema | undefined, which: 'min' | 'max'): number | null {
  if (!schema) return null;
  if (schema.enum) {
    const numbers = schema.enum.map(Number).filter((n) => Number.isFinite(n));
    if (numbers.length === 0) return null;
    return which === 'min' ? Math.min(...numbers) : Math.max(...numbers);
  }
  return (which === 'min' ? schema.minimum : schema.maximum) ?? null;
}

const url = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(endpointId)}`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`openapi fetch failed (${res.status}) for ${endpointId}`);
  process.exit(1);
}
const doc = (await res.json()) as OpenApiDoc;

// pick the path that actually has a POST: the document also carries
// /requests/{id}, /status and /cancel paths, and the submit path is not '/'
const post = Object.values(doc.paths ?? {}).find((ops) => 'post' in ops)?.post;
const input = deref(doc, post?.requestBody?.content?.['application/json']?.schema);
// the POST response is the QUEUE envelope (request_id, status_url...). The
// real payload is the result GET on /requests/{request_id} — the one path that
// is neither /status nor /cancel.
const resultPath = Object.entries(doc.paths ?? {}).find(
  ([route, ops]) => route.endsWith('/requests/{request_id}') && ops && 'get' in ops,
);
const output = deref(
  doc,
  Object.values(resultPath?.[1]?.get?.responses ?? {})[0]?.content?.['application/json']?.schema,
);

console.log(`\n${endpointId}\n${'='.repeat(endpointId.length)}`);

console.log('\nINPUT');
const required = new Set(input?.required ?? []);
const order = input?.['x-fal-order-properties'] ?? Object.keys(input?.properties ?? {});
for (const name of order) {
  const field = deref(doc, input?.properties?.[name]);
  if (!field) continue;
  const flags = [
    required.has(name) ? 'REQUIRED' : null,
    field.default === undefined ? null : `default ${JSON.stringify(field.default)}`,
  ].filter(Boolean);
  console.log(`  ${name.padEnd(24)} ${typeOf(field)}${flags.length ? `  [${flags.join(', ')}]` : ''}`);
  if (field.description) console.log(`  ${' '.repeat(24)} ${field.description}`);
}

console.log('\nOUTPUT');
console.log(`  title: ${output?.title ?? '(none)'}`);
console.log(`  fields: ${Object.keys(output?.properties ?? {}).join(', ') || '(none)'}`);

const props = input?.properties ?? {};
const caps = {
  supportsSeed: 'seed' in props,
  supportsEndImage: 'end_image_url' in props || 'tail_image_url' in props,
  hasNegativePrompt: 'negative_prompt' in props,
  // three different families rewrite the prompt under three different field
  // names, and hailuo-2.3 reported "no rewrite" while prompt_optimizer
  // defaulted to true. Any of them means `expanded_prompt` is what the model
  // actually generated from, and our motion rules are only advisory.
  rewritesPrompt:
    'prompt_expansion_mode' in props || 'prompt_optimizer' in props || 'auto_fix' in props,
  generatesAudio: 'generate_audio' in props,
  supportsCfgScale: 'cfg_scale' in props,
  // Kling calls the first frame start_image_url; sending image_url is a 422
  imageField: 'start_image_url' in props ? 'start_image_url' : 'image_url',
  resolutions: deref(doc, props.resolution)?.enum ?? [],
  // the real floor on shot length — h3-max is 5s, Kling 3s, Grok 1s
  minDurationSeconds: durationBound(deref(doc, props.duration), 'min'),
  maxDurationSeconds: durationBound(deref(doc, props.duration), 'max'),
};
console.log('\nCAPABILITIES');
for (const [key, value] of Object.entries(caps)) {
  console.log(`  ${key.padEnd(24)} ${JSON.stringify(value)}`);
}
if (caps.rewritesPrompt) {
  console.log('  NOTE: this endpoint rewrites the prompt before generating.');
  console.log('        Record `expanded_prompt` or your prompt rules are unmeasurable.');
}
if (!caps.hasNegativePrompt) {
  console.log('  NOTE: no negative_prompt field — negatives must stay in the prompt text.');
}

console.log('\nPASTE INTO src/clients/falModels.ts (fill in the price yourself):');
console.log(`  '${endpointId}': {
    costPerSecondUsd: null, // CONFIRM on the playground page — pricing is NOT in the openapi doc
    supportsSeed: ${caps.supportsSeed},
    supportsEndImage: ${caps.supportsEndImage},
    resolutions: ${JSON.stringify(caps.resolutions.length ? caps.resolutions : ['768P'])},
    supportsResolution: ${caps.resolutions.length > 0},
    minDurationSeconds: ${caps.minDurationSeconds ?? 5},
    maxDurationSeconds: ${caps.maxDurationSeconds ?? 15},
    imageField: '${caps.imageField}',
    hasNegativePrompt: ${caps.hasNegativePrompt},
    rewritesPrompt: ${caps.rewritesPrompt},
    audioField: ${caps.generatesAudio ? "'generate_audio'" : 'null'},
    supportsCfgScale: ${caps.supportsCfgScale},
  },`);
if (caps.generatesAudio) {
  console.log('  NOTE: generate_audio defaults TRUE here. merge strips clip audio,');
  console.log('        and on Kling that default is a 50% surcharge. Send false.');
}
console.log(`\nPRICING is not in the openapi document. Confirm $/s here before adopting:`);
console.log(`  ${doc['x-fal-metadata']?.playgroundUrl ?? `https://fal.ai/models/${endpointId}`}\n`);
