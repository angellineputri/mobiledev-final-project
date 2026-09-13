import type {
  Budget,
  BudgetProgressResult,
  DailyAllowanceResult,
  DailyLedgerResult,
  DayLedger,
  ExpenseForEngine,
  IncomeForEngine,
} from './types';

// daily allowance = (income - must buy - savings) / days

export function calculateDailyAllowance(
  budget: Budget,
  { daysInMonth, daysLeft, mustBuyTotal = 0 }: { daysInMonth: number; daysLeft: number; mustBuyTotal?: number },
): DailyAllowanceResult {
  if (budget.allowanceMode === 'manual') {
    const baseDaily = Number.isFinite(budget.manualDailyAllowance)
      ? Math.max(0, budget.manualDailyAllowance as number)
      : 0;
    return { discretionaryPool: baseDaily, baseDaily };
  }

  const discretionaryPool = Math.max(
    0,
    budget.income - mustBuyTotal - budget.savingsPerMonth,
  );

  const denominator =
    budget.divisor === 'daysInMonth' ? daysInMonth : Math.max(1, daysLeft);
  const baseDaily = denominator > 0 ? discretionaryPool / denominator : 0;

  return { discretionaryPool, baseDaily };
}

// helpers

function countsAgainstDailyLedger(e: ExpenseForEngine): boolean {
  if (e.tripBudgetMode === 'freeOfBudget') return false;
  return (e.kind ?? 'daily') === 'daily';
}

// budget progress. must-buy is not in daily spend but still counts for category limits

export function calculateBudgetProgress(
  expenses: ExpenseForEngine[],
  budget: Budget,
): BudgetProgressResult {
  const ledgerExpenses = expenses.filter(countsAgainstDailyLedger);

  const overallSpent = ledgerExpenses.reduce(
    (s, e) => s + (e.amountInHomeCurrency ?? e.amount),
    0,
  );

  // category limits count all spend
  const categorySpend: Record<string, number> = {};
  for (const e of expenses) {
    const val = e.amountInHomeCurrency ?? e.amount;
    categorySpend[e.categoryId] = (categorySpend[e.categoryId] ?? 0) + val;
  }

  const catIds = new Set([
    ...budget.categoryLimits.map((cl) => cl.categoryId),
    ...Object.keys(categorySpend),
  ]);

  const byCategory = Array.from(catIds).map((catId) => {
    const spent = categorySpend[catId] ?? 0;
    const limitItem = budget.categoryLimits.find((cl) => cl.categoryId === catId);
    const limit = limitItem?.limit ?? null;
    const percent = limit != null && limit > 0 ? Math.min(spent / limit, 1) : null;
    return { categoryId: catId, spent, limit, percent };
  });

  const overallLimit = budget.overallLimit;
  const overallPercent =
    overallLimit != null && overallLimit > 0
      ? Math.min(overallSpent / overallLimit, 1)
      : null;

  return { overallSpent, overallLimit, overallPercent, byCategory };
}

// daily ledger. walk each day up to today, track spend and the leftover bank

export function calculateDailyLedger(
  expenses: ExpenseForEngine[],
  budget: Budget,
  { daysInMonth, today, incomes }: { daysInMonth: number; today: string; incomes?: IncomeForEngine[] },
): DailyLedgerResult {
  const todayDay = parseInt(today.slice(-2), 10);
  const daysLeft = daysInMonth - todayDay + 1;

  // add up must-buy for the month
  const mustBuyTotal = expenses
    .filter((e) => e.kind === 'mustBuy' && e.tripBudgetMode !== 'freeOfBudget')
    .reduce((s, e) => s + (e.amountInHomeCurrency ?? e.amount), 0);

  const baseDaily = calculateDailyAllowance(budget, { daysInMonth, daysLeft, mustBuyTotal }).baseDaily;

  const monthPrefix = today.slice(0, 7); // "YYYY-MM"

  // group spends by day (must-buy never counts here)
  const expByDate: Record<string, ExpenseForEngine[]> = {};
  for (const e of expenses) {
    if (!countsAgainstDailyLedger(e)) continue;
    if (!expByDate[e.date]) expByDate[e.date] = [];
    expByDate[e.date].push(e);
  }

  // group allowance income by day
  const allowanceIncomeByDate: Record<string, number> = {};
  for (const inc of incomes ?? []) {
    if (inc.destination !== 'allowance') continue;
    const val = inc.amountInHomeCurrency ?? inc.amount;
    allowanceIncomeByDate[inc.date] = (allowanceIncomeByDate[inc.date] ?? 0) + val;
  }

  let bank = 0;
  let spreadAdjustment = 0;
  const days: DayLedger[] = [];

  for (let d = 1; d <= todayDay; d++) {
    const dateStr = `${monthPrefix}-${String(d).padStart(2, '0')}`;
    const dayExps = expByDate[dateStr] ?? [];

    const spent = dayExps.reduce(
      (s, e) => s + (e.amountInHomeCurrency ?? e.amount),
      0,
    );
    const income = allowanceIncomeByDate[dateStr] ?? 0;

    const allowance = baseDaily + spreadAdjustment;
    const delta = allowance + income - spent;
    const isOverBudget = spent > allowance + income;

    if (delta >= 0) {
      bank += delta;
    } else {
      const need = -delta;
      const fromBank = Math.min(bank, need);
      bank -= fromBank;
      const uncovered = need - fromBank;

      if (uncovered > 0 && budget.carryOver) {
        const daysAfterThis = daysInMonth - d;
        if (daysAfterThis > 0) {
          spreadAdjustment -= uncovered / daysAfterThis;
        }
      }
    }

    days.push({ date: dateStr, spent, income, allowance, delta, isOverBudget });
  }

  const todayEntry = days[days.length - 1];

  return {
    days,
    todayAllowance: todayEntry?.allowance ?? baseDaily,
    bank,
    spreadPerRemainingDay: spreadAdjustment,
  };
}

// today's allowance shown on the dashboard and day detail

export function allowanceForDate(
  expenses: ExpenseForEngine[],
  budget: Budget,
  { daysInMonth, date, incomes }: { daysInMonth: number; date: string; incomes?: IncomeForEngine[] },
): number {
  return calculateDailyLedger(expenses, budget, { daysInMonth, today: date, incomes }).todayAllowance;
}
