/** Figma Navigation misc stuff, node 245:18041 — close / remove glyph. */

type IconProps = { className?: string }

function CloseGlyphIcon({ className }: IconProps) {
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
        d="M16.5227 8.27295L12.7954 12.0002L16.5227 15.7275L15.7273 16.5229L12 12.7957L8.27271 16.5229L7.47729 15.7275L11.2046 12.0002L7.47729 8.27295L8.27271 7.47754L12 11.2048L15.7273 7.47754L16.5227 8.27295Z"
        fill="currentColor"
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
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.91475 11.6025L10.6648 7.85254L11.4602 8.64803L8.6705 11.4378L17.25 11.4378V12.5628H8.6705L11.4602 15.3525L10.6648 16.148L6.91475 12.398C6.69508 12.1784 6.69508 11.8222 6.91475 11.6025Z"
        fill="currentColor"
      />
    </svg>
  )
}
