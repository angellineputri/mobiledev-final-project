// storage types

export type CategoryLimit = { categoryId: string; limit: number };

export type Budget = {
  id: string;
  month: string; // "YYYY-MM"
  income: number;
  savingGoalId: string | null;
  savingsPerMonth: number;
  divisor: 'daysInMonth' | 'daysLeft';
  carryOver: boolean;
  overallLimit: number | null;
  categoryLimits: CategoryLimit[];
  // how the daily allowance is worked out. missing = 'formula'
  allowanceMode?: 'formula' | 'manual';
  // fixed daily allowance when mode is 'manual'
  manualDailyAllowance?: number;
};

export type SavingGoal = {
  id: string;
  name: string;
  target: number;
  targetMonth: string; // "YYYY-MM"
  saved: number;
  perMonth: number;
  paused: boolean;
};

// engine input types

export type ExpenseForEngine = {
  id: string;
  categoryId: string;
  date: string; // "YYYY-MM-DD"
  amount: number;
  amountInHomeCurrency?: number;
  // missing kind = 'daily'
  kind?: 'daily' | 'mustBuy';
  // freeOfBudget: left out of totals and the ledger
  tripBudgetMode?: 'freeOfBudget' | 'inMonthly';
};

export type IncomeForEngine = {
  id: string;
  date: string; // "YYYY-MM-DD"
  amount: number;
  amountInHomeCurrency?: number;
  // 'allowance' adds to the bank, 'savings' is left out
  destination: 'allowance' | 'savings';
};

// engine output types

export type DayLedger = {
  date: string;
  spent: number;
  income: number;
  allowance: number;
  delta: number;
  isOverBudget: boolean;
};

export type DailyLedgerResult = {
  days: DayLedger[];
  todayAllowance: number;
  bank: number;
  spreadPerRemainingDay: number; // negative when future days are cut, else 0
};

export type CategoryProgress = {
  categoryId: string;
  spent: number;
  limit: number | null;
  percent: number | null; // null when no limit
};

export type BudgetProgressResult = {
  overallSpent: number;
  overallLimit: number | null;
  overallPercent: number | null;
  byCategory: CategoryProgress[];
};

export type DailyAllowanceResult = {
  discretionaryPool: number;
  baseDaily: number;
};
