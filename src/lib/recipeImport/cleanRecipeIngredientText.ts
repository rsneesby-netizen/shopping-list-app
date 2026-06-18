/**
 * Remove site / author scaffolding that is not part of the ingredient itself.
 * Conservative: prefer removing trailing/inline parentheticals and note callouts.
 */
export function cleanRecipeIngredientNarrative(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim()
  if (!s) return ''

  const passes: RegExp[] = [
    /\(\s*click\s+through\s+for\s+recipe\s*\)/gi,
    /\(\s*click\s+for\s+recipe\s*\)/gi,
    /\(\s*tap\s+(?:through|here)\s+for\s+recipe\s*\)/gi,
    /\(\s*see\s+(?:recipe|notes?|below|method|video)\s*\)/gi,
    /\bsee\s+(?:recipe|notes?|below|method)\b\.?/gi,
    /\bclick\s+through\b\.?/gi,
    /\bjump\s+to\s+recipe\b\.?/gi,
    /\(?\s*read\s+more\s*\)?/gi,
    /^\s*note\s*\d+\s*[:\-–.]?\s*/i,
    /\s*[,;]?\s*note\s*\d+\s*[:\-–.]?\s*$/i,
    /^\s*notes?\s*[:\-–]\s*/i,
    /\(\s*note\s*\d+\s*\)/gi,
    /\[\s*note\s*\d+\s*\]/gi,
    /\s*[—–-]\s*note\s*\d+\b/gi,
    /\bnote\s*\d+\s*[:\-–]\s*/gi,
    /\s*\(\s*optional\s*\)/gi,
    /\s*,\s*\(?\s*optional\s*\)?\s*$/i,
    /\s*\[optional\]\s*$/gi,
    /\s*\(?\s*or\s+to\s+taste\s*\)?\s*$/gi,
    /\s*\(?\s*more\s+as\s+needed\s*\)?\s*$/gi,
    /\(affiliate[^)]{0,120}\)/gi,
    /\(sponsored[^)]{0,120}\)/gi,
    /\s*https?:\/\/\S+/gi,
    /^\s*(?:for|to)\s+the\s+[^:]{1,48}:\s*/i,
  ]

  for (const re of passes) {
    s = s.replace(re, ' ').replace(/\s+/g, ' ').trim()
  }

  // Trailing comma / dash fragments left empty-handed
  s = s.replace(/[\s,;–-]+$/g, '').trim()
  return s
}
