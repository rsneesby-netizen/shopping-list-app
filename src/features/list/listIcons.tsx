/** Figma Navigation misc stuff, node 245:18041 — close / remove glyph. */

type IconProps = { className?: string }

function CloseGlyphIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M13.5303 3.53027L9.06055 8L13.5303 12.4697L12.4697 13.5303L8 9.06055L3.53027 13.5303L2.46973 12.4697L6.93945 8L2.46973 3.53027L3.53027 2.46973L8 6.93945L12.4697 2.46973L13.5303 3.53027Z"
        fill="#505258"
      />
    </svg>
  )
}

/** Per-row delete control */
export function ItemDeleteIcon(props: IconProps) {
  return <CloseGlyphIcon {...props} />
}

/** Group expand — chevron down, Figma node 245:18106 (parent frame 245:18105) */
export function GroupExpandChevronIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M16.8977 10.5229L12.3977 15.0229C12.1918 15.2289 11.8657 15.242 11.6448 15.0618L11.6023 15.0229L7.10229 10.5229L7.89771 9.72754L12 13.8298L16.1023 9.72754L16.8977 10.5229Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** Group collapse — chevron up, Figma node 245:18107 */
export function GroupCollapseChevronIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M16.8977 13.4771L12.3977 8.97705C12.1918 8.7711 11.8657 8.758 11.6448 8.93823L11.6023 8.97705L7.10229 13.4771L7.89771 14.2725L12 10.1702L16.1023 14.2725L16.8977 13.4771Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** Back to all lists — Figma Navigation misc stuff, node 245:18069 */
export function BackToListsIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M9.96973 1.46973L3.96973 7.46973C3.69512 7.74433 3.67766 8.17905 3.91797 8.47363L3.96973 8.53027L9.96973 14.5303L11.0303 13.4697L5.56055 8L11.0303 2.53027L9.96973 1.46973Z"
        fill="#505258"
      />
    </svg>
  )
}

/** Thumbs down — not interested in this recommendation (teaches the model). */
export function RecommendationThumbDownIcon({ className }: IconProps) {
  return (
    <svg className={className} width={24} height={24} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.72v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z" />
    </svg>
  )
}
