import type { JSX } from 'react';

/** Stable palette index: the same name always keeps its face across screens. */
export function avatarVariant(name: string): number {
  let hash = 2166136261;
  for (const character of name.trim().toLocaleLowerCase('ru')) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  }
  return (hash >>> 0) % 10;
}

export function PersonAvatar({ name, size = 40 }: { name: string; size?: number }): JSX.Element {
  return (
    <svg
      className={`ugra-person ugra-person--${avatarVariant(name)}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <circle cx="32" cy="32" r="32" fill="var(--avatar-hair)" />
      <path
        d="M7 43C3 22 22 5 43 12c17 6 23 17 20 31-3 13-15 21-31 21S10 57 7 43Z"
        fill="var(--avatar-face)"
      />
      <g fill="var(--avatar-ink)">
        <ellipse cx="25" cy="31" rx="1.7" ry="2.2" />
        <ellipse cx="40" cy="31" rx="1.7" ry="2.2" />
      </g>
      <path
        d="M26 41q7 6 14-1"
        fill="none"
        stroke="var(--avatar-ink)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
