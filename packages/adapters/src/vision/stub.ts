import type { ImageInput, VisionPort, VisionResult } from '@ugra/core';

export const STUB_VISION_TEXT = 'Скриншот: ошибка печати, красный индикатор';

/** Фиксированное описание изображения для демо и тестов. */
export class StubVision implements VisionPort {
  constructor(private readonly text: string = STUB_VISION_TEXT) {}

  async describe(_image: ImageInput, _promptId: string): Promise<VisionResult> {
    return { text: this.text, confidence: 0.8 };
  }
}
