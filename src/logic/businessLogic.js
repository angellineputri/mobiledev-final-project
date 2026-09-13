import { CATEGORY_KEYWORDS } from '../data/defaultCategories';

// money math. no saving or network, just numbers so it is easy to test

// balance math

// new balance after adding an expense
export function applyExpenseToBalance(currentBalance, expenseAmount) {
  return round2(currentBalance - expenseAmount);
}

// new balance after removing an expense (delete or before editing)
export function reverseExpenseFromBalance(currentBalance, expenseAmount) {
  return round2(currentBalance + expenseAmount);
}

// new balance when an expense amount changes
export function editExpenseBalance(currentBalance, oldAmount, newAmount) {
  const reversed = reverseExpenseFromBalance(currentBalance, oldAmount);
  return applyExpenseToBalance(reversed, newAmount);
}

// currency conversion

// convert an amount with a rate
export function convertCurrency(amount, rate) {
  return round2(amount * rate);
}

// show one balance in home currency (display only, does not change saved data)
export function convertToHome(amount, code, homeCurrency, ratesFromHome = {}) {
  if (code === homeCurrency) return amount;
  const rate = ratesFromHome[code];
  if (!rate || rate === 0) return amount; // 1:1 fallback when rate is unknown
  return amount / rate;
}

// add up all an account's balances in home currency
export function accountHomeTotal(account, homeCurrency, ratesFromHome = {}) {
  return account.currencies.reduce(
    (sum, c) => sum + convertToHome(c.balance, c.code, homeCurrency, ratesFromHome),
    0,
  );
}

// work out how to show an account balance on the accounts list
export function accountDisplay(account, homeCurrency, ratesFromHome = {}) {
  const primary = account.primaryCode ?? account.currencies[0]?.code ?? homeCurrency;
  const homeTotal = accountHomeTotal(account, homeCurrency, ratesFromHome);

  // already home currency, no convert
  if (primary === homeCurrency) {
    return { foreign: false, code: homeCurrency, amount: homeTotal, homeEquivalent: homeTotal };
  }

  // one foreign currency, show the balance as is
  if (account.currencies.length === 1) {
    const { balance } = account.currencies[0];
    const rate = ratesFromHome[primary];
    return {
      foreign: true,
      code: primary,
      amount: balance,
      homeEquivalent: rate ? round2(balance / rate) : null,
    };
  }

  // wallet with many currencies, show it all in the main one
  const rate = ratesFromHome[primary];
  if (!rate) {
    return { foreign: false, code: homeCurrency, amount: homeTotal, homeEquivalent: homeTotal };
  }
  return { foreign: true, code: primary, amount: round2(homeTotal * rate), homeEquivalent: homeTotal };
}

// compare a value at two rates (then vs now)
export function compareExchangeRates(amount, rateThen, rateNow) {
  const valueThen = convertCurrency(amount, rateThen);
  const valueNow = convertCurrency(amount, rateNow);
  return {
    valueThen,
    valueNow,
    difference: round2(valueNow - valueThen),
  };
}

// category suggestion

// guess a category from the shop name
export function suggestCategory(merchant) {
  if (!merchant) return 'Other';
  const lower = merchant.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return category;
    }
  }
  return 'Other';
}

// delivery split

// split a delivery fee between people
export function calculateDeliverySplit(people, deliveryFee, splitType) {
  if (!people || people.length === 0) return [];

  if (splitType === 'equal') {
    const feeShare = round2(deliveryFee / people.length);
    return people.map((p) => ({
      ...p,
      shareAmount: round2(p.orderAmount + feeShare),
    }));
  }

  if (splitType === 'percentage') {
    const totalOrder = people.reduce((sum, p) => sum + p.orderAmount, 0);
    if (totalOrder === 0) {
      // avoid divide-by-zero — fall back to equal split
      return calculateDeliverySplit(people, deliveryFee, 'equal');
    }
    return people.map((p) => {
      const proportion = p.orderAmount / totalOrder;
      const feeShare = round2(deliveryFee * proportion);
      return { ...p, shareAmount: round2(p.orderAmount + feeShare) };
    });
  }

  throw new Error(`Unknown splitType: ${splitType}`);
}

// daily allowance

// work out the daily spending allowance
export function calculateDailyAllowance(budget, { daysInMonth, daysLeft, mustBuyTotal = 0 }) {
  const discretionaryPool = Math.max(
    0,
    budget.income - mustBuyTotal - budget.savingsPerMonth,
  );
  const denominator =
    budget.divisor === 'daysInMonth' ? daysInMonth : Math.max(1, daysLeft);
  const baseDaily = denominator > 0 ? discretionaryPool / denominator : 0;
  return { discretionaryPool, baseDaily };
}

// carry-over step

// apply one day's spend: save what is left, or spread overspend across the rest
export function applyCarryOver(bank, allowance, spent, daysAfterThis, carryOver) {
  const delta = round2(allowance - spent);
  if (delta >= 0) return { newBank: round2(bank + delta), spreadAdjustment: 0 };
  const need = round2(-delta);
  const fromBank = round2(Math.min(bank, need));
  const newBank = round2(bank - fromBank);
  const uncovered = round2(need - fromBank);
  const spreadAdjustment =
    uncovered > 0 && carryOver && daysAfterThis > 0
      ? round2(-(uncovered / daysAfterThis))
      : 0;
  return { newBank, spreadAdjustment };
}

// savings goal progress

// how far along a saving goal is, and if it is on track
export function calculateSavingsProgress(goal, { monthStr, monthlyContribution }) {
  const [ty, tm] = goal.targetMonth.split('-').map(Number);
  const [cy, cm] = monthStr.split('-').map(Number);
  const monthsLeft = Math.max(0, (ty - cy) * 12 + (tm - cm));
  const amountNeeded = Math.max(0, goal.target - goal.saved);
  const requiredPerMonth =
    monthsLeft > 0 ? round2(amountNeeded / monthsLeft) : amountNeeded;
  const percent = goal.target > 0 ? Math.min(goal.saved / goal.target, 1) : 0;
  const isOnTrack = monthlyContribution >= requiredPerMonth;
  return { saved: goal.saved, target: goal.target, percent, monthsLeft, requiredPerMonth, isOnTrack };
}

// income

// new balance after income
export function applyIncomeToBalance(currentBalance, incomeAmount) {
  return round2(currentBalance + incomeAmount);
}

// split bills

// balance change when a split bill is made (i paid = minus the total)
export function calculateSplitBillBalanceEffect(splitBill) {
  return splitBill.paidBy === 'me' ? round2(-splitBill.total) : 0;
}

// balance change when someone settles their share
export function calculateSettlementBalanceEffect(splitBill, personName) {
  const entry = splitBill.entries.find((e) => e.person === personName);
  if (!entry) return 0;
  return splitBill.paidBy === 'me' ? round2(entry.share) : round2(-entry.share);
}

// net worth = bank + money owed to me - money i owe (only unsettled)
export function calculateNetWorth(bankBalance, splitBills) {
  let receivables = 0;
  let payables = 0;
  for (const bill of splitBills) {
    for (const entry of bill.entries) {
      if (!entry.settled) {
        if (bill.paidBy === 'me') receivables = round2(receivables + entry.share);
        else payables = round2(payables + entry.share);
      }
    }
  }
  return {
    myMoney: round2(bankBalance + receivables - payables),
    unsettledReceivables: receivables,
    unsettledPayables: payables,
  };
}

// helpers

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
