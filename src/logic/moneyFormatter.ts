// currencies with no cents (JPY etc), shown as whole numbers
const ZERO_DECIMAL = new Set([
  'JPY', 'THB', 'KRW', 'VND', 'TWD', 'HUF', 'IDR', 'ISK', 'CLP',
  'UGX', 'BIF', 'DJF', 'GNF', 'KMF', 'MGA', 'PYG', 'RWF', 'XAF', 'XOF', 'XPF',
]);

function decimalsFor(code?: string): number {
  return code && ZERO_DECIMAL.has(code.toUpperCase()) ? 0 : 2;
}

// show money with commas and 2 dp (or 0 for JPY), like 1,234.50
export function formatMoney(amount: number, currencyCode?: string): string {
  const decimals = decimalsFor(currencyCode);
  const [whole, frac] = Math.abs(amount).toFixed(decimals).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const formatted = frac !== undefined ? `${grouped}.${frac}` : grouped;
  return amount < 0 ? `-${formatted}` : formatted;
}

// same but with the code in front: "SGD 1,234.50"
export function formatMoneyWithCode(amount: number, code: string): string {
  return `${code} ${formatMoney(amount, code)}`;
}

// with a + or - sign, for income and net rows
export function formatSigned(amount: number, code?: string): string {
  const abs = Math.abs(amount);
  const body = code ? formatMoneyWithCode(abs, code) : formatMoney(abs);
  return amount >= 0 ? `+ ${body}` : `− ${body}`;
}

// "≈ SGD 41.80" for a rough converted amount
export function formatApprox(amount: number, code: string): string {
  return `≈ ${formatMoneyWithCode(amount, code)}`;
}

// hidden balance dots
export function formatHidden(): string {
  return '●●●●●●';
}

// show an amount in the account currency, with small footers for the
// original amount and the home amount when they are different
export function accountAmountDisplay(opts: {
  accountCurrency: string;
  accountAmount: number;
  txCurrency: string;
  txAmount: number;
  homeCurrency: string;
  homeAmount: number | null;
}): { big: string; footers: string[] } {
  const { accountCurrency, accountAmount, txCurrency, txAmount, homeCurrency, homeAmount } = opts;
  const footers: string[] = [];
  if (txCurrency !== accountCurrency) {
    footers.push(formatMoneyWithCode(txAmount, txCurrency));
  }
  if (accountCurrency !== homeCurrency && txCurrency !== homeCurrency && homeAmount != null) {
    footers.push(`≈ ${formatMoneyWithCode(homeAmount, homeCurrency)}`);
  }
  return { big: formatMoneyWithCode(accountAmount, accountCurrency), footers };
}
