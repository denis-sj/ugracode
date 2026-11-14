import { useId } from 'react';
import type { JSX } from 'react';

/**
 * Аватар-«рожица» из имени (как `Kit.avatar` в макете владельца).
 * Детерминированный: одно и то же имя всегда даёт одно и то же лицо — в шапке,
 * в журнале и в списке исполнителей. Временное решение: картинки не грузим.
 */

/** FNV-подобный хэш с лавинным перемешиванием: одно имя → одно число. */
function hashName(name: string): number {
  let hash = 2166136261;
  for (const character of name.trim().toLocaleLowerCase('ru')) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x5bd1e995);
  hash ^= hash >>> 15;
  return hash >>> 0;
}

/** Номер палитры 0–9: одно имя всегда попадает в один цвет. */
export function avatarVariant(name: string): number {
  return hashName(name) % 10;
}

export interface PersonAvatarProps {
  name: string;
  size?: number;
}

export function PersonAvatar({ name, size = 40 }: PersonAvatarProps): JSX.Element {
  const seed = hashName(name);
  const variant = seed % 10;
  const rotation = (seed % 40) - 20;
  const shiftX = (seed % 7) - 3;
  const shiftY = ((seed >> 3) % 7) - 3;
  const mouthOpen = seed % 3 === 0;
  const eyeY = 15 + ((seed >> 5) % 3);
  const mouthX = 18 + ((seed >> 4) % 3) - 1;
  const faceX = 4 + shiftX;
  const faceY = 6 + shiftY;
  const corner = 6 + (seed % 12);
  // useId даёт «:r0:» — для url(#…) оставляем только буквы и цифры.
  const clipId = `av${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <svg
      className={`ugra-person ugra-person--${variant}`}
      width={size}
      height={size}
      viewBox="0 0 36 36"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="18" cy="18" r="18" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="36" height="36" fill="var(--avatar-hair)" />
        <rect
          x="0"
          y="0"
          width="36"
          height="36"
          rx={corner}
          fill="var(--avatar-face)"
          transform={`translate(${faceX} ${faceY}) rotate(${rotation} 18 18) scale(1.05)`}
        />
        <g transform={`translate(${shiftX} ${shiftY / 2})`}>
          {mouthOpen ? (
            <path d={`M${mouthX - 4} 23 a4 3 0 0 0 8 0`} fill="var(--avatar-ink)" />
          ) : (
            <path
              d={`M${mouthX - 4} 22.5 q4 2.6 8 0`}
              fill="none"
              stroke="var(--avatar-ink)"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          )}
          <rect
            x={mouthX - 5}
            y={eyeY}
            width="1.8"
            height="2.4"
            rx="0.9"
            fill="var(--avatar-ink)"
          />
          <rect
            x={mouthX + 3.2}
            y={eyeY}
            width="1.8"
            height="2.4"
            rx="0.9"
            fill="var(--avatar-ink)"
          />
        </g>
      </g>
    </svg>
  );
}
