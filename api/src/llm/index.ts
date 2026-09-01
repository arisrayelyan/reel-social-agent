import type { Provider } from '@reel-agent/shared';
import type { AppConfig } from '../config.js';
import type { GenerateJsonOptions, LlmProvider, LlmResult } from './provider.js';
import { OllamaProvider } from './ollama.js';
import { ClaudeCodeProvider } from './claudeCode.js';
import { CodexProvider } from './codex.js';

export function getProvider(config: AppConfig, name: Provider): LlmProvider {
  switch (name) {
    case 'ollama':
      return new OllamaProvider(config.ollamaUrl, config.ollamaModel);
    case 'claude-code':
      return new ClaudeCodeProvider(config.claudeCliPath, config.claudeModel);
    case 'codex':
      return new CodexProvider(
        config.codexCliPath,
        config.codexInputCostPerMTok,
        config.codexOutputCostPerMTok,
        config.codexModel,
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
    if (err instanceof Error && /timeout|ENOENT/i.test(err.message)) throw err;
    const reason = err instanceof Error ? err.message.slice(0, 500) : String(err);
    return provider.generateJson({
      ...opts,
      prompt: `${opts.prompt}\n\nYour previous response was not valid JSON matching the schema (${reason}). Respond again with ONLY the corrected JSON object.`,
    });
  }
}

export { extractJson, parseWithSchema } from './provider.js';
export type { LlmProvider, LlmResult, GenerateJsonOptions } from './provider.js';
