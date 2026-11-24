/** "56 Y / Male" — the patient line printed on a sample label (no test name there). */
export function ageSexText(age?: number | string | null, gender?: string | null): string {
  const a = age !== null && age !== undefined && String(age).trim() !== '' ? `${age} Y` : '';
  const g = (gender ?? '').trim();
  return [a, g].filter(Boolean).join(' / ');
}
