import { useEffect, useRef, useState } from 'react';
import type { TranscribeResponse } from '@ugra/contracts';
import type { ApiClient } from '@ugra/ui';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать запись'));
    reader.readAsDataURL(blob);
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface VoiceInput {
  /** Браузер умеет записывать звук. */
  supported: boolean;
  recording: boolean;
  transcribing: boolean;
  toggle: () => void;
}

/**
 * Голосовой ввод для чата: запись → `POST /api/transcribe` → текст в поле.
 * Без MediaRecorder или без доступа к микрофону кнопка неактивна — запись не имитируется.
 */
export function useVoiceInput(
  api: ApiClient,
  onText: (text: string) => void,
  onError: (message: string) => void,
): VoiceInput {
  const supported =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function';

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const textRef = useRef(onText);
  const errorRef = useRef(onError);

  textRef.current = onText;
  errorRef.current = onError;

  useEffect(() => {
    return () => {
      if (recorderRef.current) {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const start = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size === 0) return;
        setTranscribing(true);
        void blobToBase64(blob)
          .then((audio) => api.post<TranscribeResponse>('/api/transcribe', { audio, mimeType: blob.type }))
          .then((response) => {
            if (response.text.trim() !== '') textRef.current(response.text.trim());
            else errorRef.current('Речь не распознана — попробуйте ещё раз');
          })
          .catch((error: unknown) => errorRef.current(`Не удалось распознать речь: ${errorText(error)}`))
          .finally(() => setTranscribing(false));
      };
      recorderRef.current = recorder;
      streamRef.current = stream;
      recorder.start();
      setRecording(true);
    } catch (error) {
      onError(`Микрофон недоступен: ${errorText(error)}`);
    }
  };

  const toggle = (): void => {
    if (!supported || transcribing) return;
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    void start();
  };

  return { supported, recording, transcribing, toggle };
}
