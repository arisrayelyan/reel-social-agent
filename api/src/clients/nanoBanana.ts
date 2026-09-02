import { GoogleGenAI } from '@google/genai';
import { readFile, writeFile } from 'node:fs/promises';
import type { AppConfig } from '../config.js';

export interface GeneratedImage {
  filePath: string;
  model: string;
  costUsd: number;
}

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

  async generateImage(prompt: string, outputPath: string): Promise<GeneratedImage> {
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
      throw new Error(`Nano Banana returned no image${text ? `: ${text.slice(0, 300)}` : ''}`);
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
