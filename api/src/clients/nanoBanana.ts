import { GoogleGenAI } from '@google/genai';
import { readFile, writeFile } from 'node:fs/promises';
import { GRAPHIC_CONTENT_TERMS, matchPhrases } from '@reel-agent/shared';
import type { AppConfig } from '../config.js';

/**
 * Second-attempt prompt after an empty (safety-blocked) response. People are
 * in frame now, so blocks are likelier; the retry strips anything on the
 * graphic-content line and says so explicitly. Exported for tests.
 */
export function softenPrompt(prompt: string): string {
  let softened = prompt;
  for (const term of matchPhrases(prompt, GRAPHIC_CONTENT_TERMS)) {
    softened = softened.replace(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '');
  }
  return `${softened.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim()} No injuries shown, no one harmed in frame.`;
}

export interface GeneratedImage {
  filePath: string;
  model: string;
  costUsd: number;
  /** True when the first attempt came back empty and the softened retry produced the image. */
  softened?: boolean;
}

export class NoImageError extends Error {}

/**
 * Google Nano Banana (Gemini image generation). Generates one 9:16 keyframe
 * still per storyboard beat. Prompt must already carry the byte-identical
 * style prefix and anti-grid suffix (utils/storyPost.buildImagePrompt).
 */
export class NanoBananaClient {
  private readonly ai: GoogleGenAI;

  constructor(private readonly config: AppConfig) {
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not set (api/.env)');
    }
    this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }

  /**
   * One keyframe. An empty response (the model's safety block returns no
   * image part, not an error) is retried once with a softened prompt — one
   * extra ~$0.04 call beats a failed render. Throws only after the retry.
   */
  async generateImage(prompt: string, outputPath: string): Promise<GeneratedImage> {
    try {
      return await this.generateOnce(prompt, outputPath);
    } catch (err) {
      if (!(err instanceof NoImageError)) throw err;
      const softened = softenPrompt(prompt);
      if (softened === prompt) throw err;
      const result = await this.generateOnce(softened, outputPath);
      return { ...result, softened: true, costUsd: result.costUsd * 2 };
    }
  }

  private async generateOnce(prompt: string, outputPath: string): Promise<GeneratedImage> {
    const response = await this.ai.models.generateContent({
      model: this.config.geminiImageModel,
      contents: prompt,
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '9:16' },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      const text = parts.map((p) => p.text).filter(Boolean).join(' ');
      throw new NoImageError(`Nano Banana returned no image${text ? `: ${text.slice(0, 300)}` : ''}`);
    }

    await writeFile(outputPath, Buffer.from(imagePart.inlineData.data, 'base64'));
    return {
      filePath: outputPath,
      model: this.config.geminiImageModel,
      costUsd: this.config.geminiImageCostUsd,
    };
  }

  /**
   * Edits an existing still instead of generating a new one.
   *
   * Used for the kicker's end frame: the fal endpoint takes end_image_url, and
   * an EDIT of the start frame keeps the location, light and wear identical,
   * where an independent generation would produce a different place. That is
   * what makes the reel's final frame deterministic, and therefore loopable.
   */
  async editImage(prompt: string, inputPath: string, outputPath: string): Promise<GeneratedImage> {
    const source = await readFile(inputPath);
    const response = await this.ai.models.generateContent({
      model: this.config.geminiImageModel,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/png', data: source.toString('base64') } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '9:16' },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      const text = parts.map((p) => p.text).filter(Boolean).join(' ');
      throw new Error(`Nano Banana returned no edited image${text ? `: ${text.slice(0, 300)}` : ''}`);
    }

    await writeFile(outputPath, Buffer.from(imagePart.inlineData.data, 'base64'));
    return {
      filePath: outputPath,
      model: this.config.geminiImageModel,
      costUsd: this.config.geminiImageCostUsd,
    };
  }
}
