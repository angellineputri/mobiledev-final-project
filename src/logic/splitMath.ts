// split bill math. just numbers so it is easy to test. all rounded to 2 dp

export function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

// keypad has no dot, so digits are cents. "1350" -> 13.50
export function parseAmountInput(raw: string): number {
  const cents = parseInt(raw || '0', 10);
  if (!Number.isFinite(cents)) return 0;
  return round2(cents / 100);
}

export type BillRateInfo = {
  currency: string;
  liveRate?: number;           // bill -> home
  entryToAccountRate?: number; // bill -> paying account
};

// show a bill amount in the paying account's currency
export function amountInAccountCurrency(
  amount: number,
  bill: BillRateInfo,
  accountCurrency: string,
  homeCurrency: string,
): { currency: string; amount: number } {
  if (bill.currency === accountCurrency) return { currency: accountCurrency, amount };
  if (bill.entryToAccountRate != null) {
    return { currency: accountCurrency, amount: round2(amount * bill.entryToAccountRate) };
  }
  if (accountCurrency === homeCurrency) {
    return { currency: accountCurrency, amount: round2(amount * (bill.liveRate ?? 1)) };
  }
  return { currency: bill.currency, amount };
}

export type SplitItemInput = {
  id: string;
  name: string;
  price: number;
  sharerIds: string[]; // people sharing this item
};

export type ChargesInput = {
  gstPct: number;          // e.g. 9 for 9% (used when gstMode === 'pct')
  gstFlat: number;         // flat dollar amount  (used when gstMode === 'flat')
  gstMode: 'pct' | 'flat';
  svcPct: number;
  svcFlat: number;
  svcMode: 'pct' | 'flat';
  deliveryFlat: number;    // fixed dollar amount
  deliverySplit: 'equal' | 'proportional';
};

export type PersonShareResult = {
  itemsTotal: number;
  chargesTotal: number;
  total: number;
};

export type ItemSharesResult = {
  shares: Record<string, PersonShareResult>;
  grandSubtotal: number;
  totalCharges: number;
  billTotal: number;
};

// work out how much each person pays for an items bill
export function computeItemShares(
  items: SplitItemInput[],
  charges: ChargesInput,
): ItemSharesResult {
  const personItemsTotal: Record<string, number> = {};

  for (const item of items) {
    if (item.sharerIds.length === 0 || item.price <= 0) continue;
    // give each sharer their cents, last one takes the leftover so it adds up
    const n = item.sharerIds.length;
    const per = Math.floor((item.price / n) * 100) / 100;
    let allocated = 0;
    item.sharerIds.forEach((sid, idx) => {
      const isLast = idx === n - 1;
      const portion = isLast ? round2(item.price - allocated) : per;
      if (!isLast) allocated = round2(allocated + per);
      personItemsTotal[sid] = round2((personItemsTotal[sid] ?? 0) + portion);
    });
  }

  const personIds = Object.keys(personItemsTotal);
  const grandSubtotal = round2(personIds.reduce((s, id) => s + personItemsTotal[id], 0));

  const gstAmt = charges.gstMode === 'pct'
    ? round2(grandSubtotal * charges.gstPct / 100)
    : round2(charges.gstFlat);
  const svcAmt = charges.svcMode === 'pct'
    ? round2(grandSubtotal * charges.svcPct / 100)
    : round2(charges.svcFlat);

  const deliveryProportional = charges.deliverySplit === 'proportional' ? charges.deliveryFlat : 0;
  const deliveryEqual        = charges.deliverySplit === 'equal'        ? charges.deliveryFlat : 0;

  const proportionalPool = round2(gstAmt + svcAmt + deliveryProportional);
  const totalCharges     = round2(proportionalPool + deliveryEqual);
  const billTotal        = round2(grandSubtotal + totalCharges);

  if (personIds.length === 0) {
    return { shares: {}, grandSubtotal: 0, totalCharges, billTotal };
  }

  const shares: Record<string, PersonShareResult> = {};
  let proportionalAllocated = 0;
  let equalAllocated = 0;

  for (let i = 0; i < personIds.length; i++) {
    const sid    = personIds[i];
    const itemsTotal = personItemsTotal[sid];
    const isLast = i === personIds.length - 1;

    let proportionalShare: number;
    if (isLast) {
      proportionalShare = round2(proportionalPool - proportionalAllocated);
    } else {
      proportionalShare = grandSubtotal > 0
        ? round2(proportionalPool * itemsTotal / grandSubtotal)
        : 0;
      proportionalAllocated = round2(proportionalAllocated + proportionalShare);
    }

    let equalShare: number;
    if (isLast) {
      equalShare = round2(deliveryEqual - equalAllocated);
    } else {
      equalShare = round2(deliveryEqual / personIds.length);
      equalAllocated = round2(equalAllocated + equalShare);
    }

    const chargesTotal = round2(proportionalShare + equalShare);
    shares[sid] = { itemsTotal, chargesTotal, total: round2(itemsTotal + chargesTotal) };
  }

  return { shares, grandSubtotal, totalCharges, billTotal };
}
