import { isSupportedCurrency } from '../data/supportedCurrencies';

// frankfurter changed host, the old one redirects and breaks fetch. new base below
const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1';

// best date for a "YYYY-MM" month: its last day, or today for this/future month
export function monthRateDate(month) {
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  if (month >= currentMonth) return today;
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last day
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

// get the rate for one pair (1 from = N to). pass a date for an old rate. null on error
export async function getExchangeRate(from, to, dateStr) {
  if (from === to) return 1;
  if (!isSupportedCurrency(from) || !isSupportedCurrency(to)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const endpoint = dateStr && dateStr !== today ? dateStr : 'latest';
  try {
    const res = await fetch(
      `${FRANKFURTER_BASE}/${endpoint}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const rate = data?.rates?.[to];
    return typeof rate === 'number' ? rate : null;
  } catch {
    return null;
  }
}

// get rates from home to many currencies in one call. returns { JPY: 113.8 } = 1 home = N
export async function getRatesFromHome(homeCurrency, foreignCodes) {
  const unique = foreignCodes.filter(
    (c) => c !== homeCurrency && isSupportedCurrency(c),
  );
  if (unique.length === 0) return {};
  try {
    const res = await fetch(
      `${FRANKFURTER_BASE}/latest?from=${encodeURIComponent(homeCurrency)}&to=${unique.map(encodeURIComponent).join(',')}`,
    );
    if (!res.ok) return {};
    const data = await res.json();
    return data.rates ?? {};
  } catch {
    return {};
  }
}
