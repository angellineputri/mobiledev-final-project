import { getExchangeRate } from '@/api/exchangeRate';
import { round2 } from '@/logic/splitMath';

// remember rates for this session so each one is only fetched once
const rateCache = new Map<string, number>();

async function cachedRate(from: string, to: string, dateStr?: string): Promise<number> {
  if (from === to) return 1;
  const key = `${from}>${to}@${dateStr ?? 'latest'}`;
  const hit = rateCache.get(key);
  if (hit !== undefined) return hit;
  const r = await getExchangeRate(from, to, dateStr);
  const val = r ?? 1; // fall back to 1:1 if it fails (offline)
  rateCache.set(key, val);
  return val;
}

export type GoalConversion = {
  savedHome: number;
  targetHome: number;
  perMonthHome: number;
  goalRate: number; // goal currency -> home
};

function nowMonthPrefix(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// change a saving goal's numbers into home currency using one rate
export async function computeGoalConversion(opts: {
  currency: string;
  homeCurrency: string;
  allocations: Record<string, number>;
  target: number;
  perMonth: number;
  savedFallback?: number;
  completedAt?: string | null;
  monthlyRates?: Record<string, number>;
}): Promise<GoalConversion> {
  const { currency, homeCurrency, allocations, target, perMonth, savedFallback = 0, completedAt, monthlyRates } = opts;

  const allocSum = Object.values(allocations).reduce((s, a) => s + (a || 0), 0);
  const saved = allocSum || savedFallback;

  if (currency === homeCurrency) {
    return {
      savedHome: round2(saved),
      targetHome: round2(target),
      perMonthHome: round2(perMonth),
      goalRate: 1,
    };
  }

  // pick the rate: a saved override first, else today's rate (frozen once done)
  const goalDate = completedAt ? completedAt.slice(0, 10) : undefined;
  const activeMonth = completedAt ? completedAt.slice(0, 7) : nowMonthPrefix();
  const override = monthlyRates?.[activeMonth];
  const goalRate = override != null ? override : await cachedRate(currency, homeCurrency, goalDate);

  return {
    savedHome: round2(saved * goalRate),
    targetHome: round2(target * goalRate),
    perMonthHome: round2(perMonth * goalRate),
    goalRate,
  };
}
