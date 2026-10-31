import type { SVGProps } from 'react';

export default function SanSuoDinoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label="三所小恐龙" {...props}>
      <rect width="64" height="64" rx="16" fill="#0f3d32" />
      <path
        fill="#72e0b5"
        d="M16 39.5c0-12.4 8.8-22 21.1-22h4.1c5.9 0 10.8 4.8 10.8 10.8v3.9c0 6-4.8 10.8-10.8 10.8h-8.4v7.2H24V43h-1.8A6.2 6.2 0 0 1 16 36.8v2.7Z"
      />
      <path fill="#baf7d5" d="M24 43h10.8v3.1c0 2.3-1.8 4.1-4.1 4.1H24V43Z" />
      <path
        fill="#48c79a"
        d="M28.6 18.7 32 11l3.4 7.5c-2.4.1-4.6.1-6.8.2Zm8.5-1.1 4.1-6.6 2.4 7.7a16 16 0 0 0-6.5-1.1ZM21 25.4l-6.1-2.9 6.7-3.4c-.4 2-.6 4.1-.6 6.3Z"
      />
      <circle cx="42.8" cy="27.6" r="3.4" fill="#0f2420" />
      <circle cx="44" cy="26.3" r="1" fill="#ffffff" />
      <path
        fill="none"
        stroke="#0f2420"
        strokeLinecap="round"
        strokeWidth="2.6"
        d="M38.5 35.8c2.2 1.5 5.3 1.5 7.7-.1"
      />
      <circle cx="49" cy="34.5" r="2.2" fill="#ff9f9f" opacity=".75" />
      <path fill="#0f3d32" d="M22.7 42.8h4v7.4h-4zm12.6 0h4v7.4h-4z" opacity=".32" />
    </svg>
  );
}
