// keypad number logic. no react native here so it is easy to test

const ZERO_DECIMAL = new Set([
  'JPY', 'THB', 'KRW', 'VND', 'TWD', 'HUF', 'IDR', 'ISK', 'CLP',
  'UGX', 'BIF', 'DJF', 'GNF', 'KMF', 'MGA', 'PYG', 'RWF', 'XAF', 'XOF', 'XPF',
]);

// how many decimals. JPY/IDR have none, most have 2
export function decimalsFor(code?: string): number {
  return code && ZERO_DECIMAL.has(code.toUpperCase()) ? 0 : 2;
}

// remove extra zeros at the front, like "007" -> "7"
function collapseLeadingZeros(raw: string): string {
  const stripped = raw.replace(/^0+/, '');
  if (stripped !== '') return stripped;
  return raw === '' ? '' : '0';
}

// add one key press to the number string
export function applyNumpadKey(raw: string, key: string, currency?: string): string {
  if (key === 'backspace') return raw.slice(0, -1);
  if (!key || key === '.') return raw;
  const maxLen = decimalsFor(currency) === 0 ? 12 : 9;
  if (raw.length >= maxLen) return raw;
  return collapseLeadingZeros(raw + key);
}

// make the number look nice on screen (12.34 or 15,000)
export function formatAmountDisplay(raw: string, currency?: string): string {
  const decimals = decimalsFor(currency);
  if (decimals === 0) {
    const n = parseInt(raw || '0', 10) || 0;
    return n.toLocaleString('en-US');
  }
  const cents = parseInt(raw || '0', 10) || 0;
  const dollars = Math.floor(cents / 100);
  const rem = cents % 100;
  return `${dollars.toLocaleString('en-US')}.${String(rem).padStart(2, '0')}`;
}

// turn the digits into a real number to save
export function rawToAmount(raw: string, currency?: string): number {
  const n = parseInt(raw || '0', 10) || 0;
  return decimalsFor(currency) === 0 ? n : n / 100;
}

// turn a saved number back into digits for the numpad
export function amountToRaw(amount: number, currency?: string): string {
  if (!amount) return '';
  return decimalsFor(currency) === 0
    ? String(Math.round(amount))
    : String(Math.round(amount * 100));
}

// screen cursor -> digits cursor
export function displayCursorToRawCursor(display: string, dCursor: number): number {
  let raw = 0;
  for (let i = 0; i < Math.min(dCursor, display.length); i++) {
    if (display[i] >= '0' && display[i] <= '9') raw++;
  }
  return raw;
}

// digits cursor -> screen cursor
export function rawCursorToDisplayCursor(display: string, rCursor: number): number {
  let counted = 0;
  for (let i = 0; i <= display.length; i++) {
    if (counted === rCursor) return i;
    if (i < display.length && display[i] >= '0' && display[i] <= '9') counted++;
  }
  return display.length;
}

// add a key where the cursor is
export function applyNumpadKeyAtCursor(
  raw: string, key: string, cursor: number, currency?: string,
): { newRaw: string; newCursor: number } {
  if (key === 'backspace') {
    if (cursor === 0) return { newRaw: raw, newCursor: 0 };
    const newRaw = raw.slice(0, cursor - 1) + raw.slice(cursor);
    return { newRaw, newCursor: cursor - 1 };
  }
  if (!key || key === '.') return { newRaw: raw, newCursor: cursor };
  const maxLen = decimalsFor(currency) === 0 ? 12 : 9;
  if (raw.length >= maxLen) return { newRaw: raw, newCursor: cursor };
  const inserted = raw.slice(0, cursor) + key + raw.slice(cursor);
  // fix leading zeros and move the cursor
  const newRaw = collapseLeadingZeros(inserted);
  const newCursor = Math.max(0, cursor + 1 - (inserted.length - newRaw.length));
  return { newRaw, newCursor };
}
