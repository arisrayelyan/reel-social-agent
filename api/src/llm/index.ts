import path from 'node:path';
import type { Provider } from '@reel-agent/shared';
import type { AppConfig } from '../config.js';
import type { GenerateJsonOptions, LlmProvider, LlmResult } from './provider.js';
import { LlmValidationError } from './provider.js';
import { OllamaProvider } from './ollama.js';
import { ClaudeCodeProvider } from './claudeCode.js';
import { CodexProvider } from './codex.js';
import { CursorAgentProvider } from './cursorAgent.js';

/**
 * A failure that a retry cannot fix: the CLI is missing, or the call already
 * ran the full timeout — retrying pays for a second identical wait. execa
 * reports these as `timedOut` / `code` properties, NOT in the message (its
 * message says "timed out", which the old /timeout/ regex never matched).
 */
export function isFatalLlmError(err: unknown): boolean {
  const e = err as { timedOut?: boolean; code?: string; message?: string };
  return (
    e.timedOut === true ||
    e.code === 'ENOENT' ||
    /timed? ?out|ENOENT/i.test(e.message ?? '')
  );
}

/**
 * `model` overrides the provider's configured default for this one call. Only
 * cursor-agent sends it today — it is the provider whose whole point is the
 * model menu — but the override is honoured by all of them so the choice stays
 * a property of the factory rather than a special case in one branch.
 */
export function getProvider(config: AppConfig, name: Provider, model?: string): LlmProvider {
  switch (name) {
    case 'ollama':
      return new OllamaProvider(config.ollamaUrl, model || config.ollamaModel);
    case 'claude-code':
      return new ClaudeCodeProvider(config.claudeCliPath, model || config.claudeModel);
    case 'codex':
      return new CodexProvider(
        config.codexCliPath,
        config.codexInputCostPerMTok,
        config.codexOutputCostPerMTok,
        model || config.codexModel,
      );
    case 'cursor-agent':
      return new CursorAgentProvider(
        config.cursorCliPath,
        model || config.cursorModel,
        config.cursorPricePerMTok,
        // empty scratch dir: keeps the repo out of the story prompt
        path.join(config.storageDir, '.cursor-agent'),
      );
  }
}

/**
 * generateJson with one retry: if the model's output fails JSON parsing or
 * schema validation, re-prompt once asking it to fix the JSON.
 */
export async function generateJsonWithRetry<T>(
  provider: LlmProvider,
  opts: GenerateJsonOptions<T>,
): Promise<LlmResult<T>> {
  try {
    return await provider.generateJson(opts);
  } catch (err) {
    if (isFatalLlmError(err)) throw err;
    return provider.generateJson({
      ...opts,
      prompt: `${opts.prompt}\n\n${buildRepairInstruction(err)}`,
    });
  }
}

/**
 * Repair feedback for a second call: the previous (broken) output plus the
 * exact validation issues, so the model fixes in place instead of
 * regenerating blind — a blind regeneration has no structural reason to be
 * more schema-valid than the first try.
 */
export function buildRepairInstruction(err: unknown): string {
  if (err instanceof LlmValidationError && err.raw) {
    const issueBlock = err.issues.length
      ? `It failed schema validation:\n${err.issues.join('\n')}`
      : `It was not parseable JSON: ${err.message.slice(0, 300)}`;
    return (
      `Your previous response is below. ${issueBlock}\n\n` +
      `PREVIOUS RESPONSE:\n${err.raw.slice(0, 12_000)}\n\n` +
      `Fix ONLY the listed problems, keep everything else exactly as it was, and respond with ONLY the corrected JSON object.`
    );
  }
  const reason = err instanceof Error ? err.message.slice(0, 2000) : String(err);
  return `Your previous response was not valid JSON matching the schema (${reason}). Respond again with ONLY the corrected JSON object.`;
}

export { extractJson, parseWithSchema, LlmValidationError } from './provider.js';
export type { LlmProvider, LlmResult, GenerateJsonOptions } from './provider.js';
