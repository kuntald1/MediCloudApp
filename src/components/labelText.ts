/** "M" / "F" from whatever the record holds ("Male", "female", "M", …).
 *  Anything that is neither keeps its own first letter, so a record that says
 *  "Other" prints "O" rather than being dropped. */
export function sexLetter(gender?: string | null): string {
  const s = (gender ?? '').trim();
  if (!s) return '';
  const c = s[0].toUpperCase();
  return c === 'M' ? 'M' : c === 'F' ? 'F' : c;
}

/** "55 Y / M" — the age and sex half of a sample label's patient line.
 *
 *  The name is deliberately NOT part of this string. On the label the two are
 *  printed as separate pieces so that a name too long to share the line pushes
 *  the age and sex onto the next one whole, instead of the line breaking in the
 *  middle of "55 Y / M". Same arrangement as the web label, so both print alike.
 *
 *  Either half is left out when it is missing: a patient with no age on record
 *  prints "M" rather than an empty slot. */
export function ageSexText(age?: number | string | null,
                           gender?: string | null): string {
  const a = age !== null && age !== undefined && String(age).trim() !== '' ? `${age} Y` : '';
  return [a, sexLetter(gender)].filter(Boolean).join(' / ');
}
