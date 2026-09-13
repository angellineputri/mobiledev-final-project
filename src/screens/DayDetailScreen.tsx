import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { calculateDailyAllowance, calculateDailyLedger } from '@/budget/engine';
import type { Budget } from '@/budget/types';
import { Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/logic/moneyFormatter';
import { ExpenseRow, IncomeRow, TransferRow } from '@/components/TransactionRows';
import {
  deleteExpense, deleteIncome, deleteTransfer, getAccounts, getCategories, getExpenses, getIncomes,
  getOrInheritBudget, getSettings, getTransfers, updateSubBalance,
} from '@/storage/storage';

// types

type CurrencyBalance = { code: string; balance: number };
type Account = { id: string; name: string; primaryCode: string; currencies: CurrencyBalance[] };
type Category = { id: string; name: string };
type Expense = {
  id: string; accountId: string; categoryId: string; merchant: string;
  description?: string | null; amount: number; currency: string; amountInHomeCurrency?: number;
  accountAmount?: number; accountCurrencyAtEntry?: string;
  date: string; notes?: string; isShared?: boolean; kind?: 'daily' | 'mustBuy';
};
type Income = {
  id: string; accountId: string; amount: number; currency: string;
  accountCurrencyAtEntry?: string; accountAmount?: number;
  amountInHomeCurrency?: number; categoryId?: string | null; source: string;
  destination: 'allowance' | 'savings'; date: string;
};
type Transfer = {
  id: string; date: string;
  fromAccountId: string; toAccountId: string;
  fromCurrency: string; toCurrency: string;
  fromAmount: number; toAmount: number;
  notes?: string | null;
};

// helpers

const CATEGORY_ICON_MAP: Record<string, string> = {
  Food: 'coffee', Transport: 'navigation', Shopping: 'shopping-bag',
  Entertainment: 'film', Necessities: 'home', Gifts: 'gift',
  Emergency: 'shield', 'SIM card': 'wifi', 'Memberships & subscriptions': 'repeat',
};

function catIcon(name: string): any { return CATEGORY_ICON_MAP[name] ?? 'tag'; }

// DayDetailScreen

export default function DayDetailScreen({ route, navigation }: any) {
  const { date } = route.params as { date: string };
  const t = useTheme();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [monthExpenses, setMonthExpenses] = useState<Expense[]>([]);
  const [dayIncomes, setDayIncomes] = useState<Income[]>([]);
  const [dayTransfers, setDayTransfers] = useState<Transfer[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [budget, setBudget] = useState<Budget | null>(null);
  const [loading, setLoading] = useState(true);

  const monthStr = date.slice(0, 7);

  function reloadExpenses() {
    (getExpenses() as Promise<Expense[]>).then((all) => {
      setExpenses(all.filter((e) => e.date === date));
      setMonthExpenses(all.filter((e) => e.date?.startsWith(monthStr)));
    });
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getExpenses() as Promise<Expense[]>,
      getIncomes() as Promise<Income[]>,
      getAccounts() as Promise<Account[]>,
      getCategories() as Promise<Category[]>,
      getSettings() as Promise<{ homeCurrency?: string }>,
      (getOrInheritBudget as (m: string) => Promise<Budget | null>)(monthStr),
      getTransfers() as Promise<Transfer[]>,
    ]).then(([exps, incs, accs, cats, settings, bgt, trs]) => {
      if (!cancelled) {
        setExpenses(exps.filter((e) => e.date === date));
        setMonthExpenses(exps.filter((e) => e.date?.startsWith(monthStr)));
        setDayIncomes(incs.filter((i) => i.date === date));
        setDayTransfers(trs.filter((tr) => tr.date === date));
        setAccounts(accs);
        setCategories(cats);
        setHomeCurrency(settings.homeCurrency ?? 'SGD');
        setBudget(bgt);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [date, monthStr]);

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.name])),
    [categories],
  );
  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  // total for the day, added up in home currency
  const daySpentHome = useMemo(
    () => expenses.reduce(
      (s, e) => s + (e.amountInHomeCurrency ?? (e.currency === homeCurrency ? e.amount : 0)),
      0,
    ),
    [expenses, homeCurrency],
  );

  // spend that counts against the daily budget (no "must buy")
  const dailyLedgerSpent = useMemo(
    () => expenses
      .filter((e) => (e.kind ?? 'daily') === 'daily')
      .reduce((s, e) => s + (e.amountInHomeCurrency ?? (e.currency === homeCurrency ? e.amount : 0)), 0),
    [expenses, homeCurrency],
  );

  const dayIncome = useMemo(
    () => dayIncomes.reduce((s, i) => s + (i.amountInHomeCurrency ?? i.amount), 0),
    [dayIncomes],
  );

  // budget card
  const [yearN, monthN, dayN] = date.split('-').map(Number);
  const daysInMonth = new Date(yearN, monthN, 0).getDate();

  // same base daily allowance the dashboard shows
  const baseDaily = useMemo(() => {
    if (!budget) return null;
    const monthDaysLeft = daysInMonth - dayN + 1;
    const mustBuyTotal = monthExpenses
      .filter((e) => e.kind === 'mustBuy')
      .reduce((s, e) => s + (e.amountInHomeCurrency ?? e.amount), 0);
    return calculateDailyAllowance(budget, { daysInMonth, daysLeft: monthDaysLeft, mustBuyTotal }).baseDaily;
  }, [budget, monthExpenses, daysInMonth, dayN]);

  const overBy = baseDaily !== null ? dailyLedgerSpent - baseDaily : null;
  const isOver = overBy !== null && overBy > 0.001;

  // previous days this month that went over budget (before this day)
  const prevOverDays = useMemo(() => {
    if (!budget) return [];
    const ledger = calculateDailyLedger(monthExpenses, budget, { daysInMonth, today: date });
    return ledger.days.filter((d) => d.date < date && d.isOverBudget);
  }, [budget, monthExpenses, daysInMonth, date]);
  const prevOverCount = prevOverDays.length;
  const prevOverTotal = prevOverDays.reduce((s, d) => s + -d.delta, 0);

  const barWidth = baseDaily && baseDaily > 0
    ? (isOver ? '100%' : `${Math.min((dailyLedgerSpent / baseDaily) * 100, 100)}%`)
    : '0%';

  const dateTitle = useMemo(
    () => new Date(date + 'T00:00:00').toLocaleDateString('en-SG', {
      weekday: 'short', day: 'numeric', month: 'short',
    }),
    [date],
  );

  async function handleDeleteExpense(exp: Expense) {
    const reverseCode = exp.accountCurrencyAtEntry ?? exp.currency;
    const reverseAmount = exp.accountAmount ?? exp.amount;
    await (updateSubBalance as (id: string, code: string, delta: number) => Promise<void>)(
      exp.accountId, reverseCode, reverseAmount,
    );
    await (deleteExpense as (id: string) => Promise<void>)(exp.id);
    reloadExpenses();
  }

  async function handleDeleteIncome(inc: Income) {
    if (inc.accountId) {
      // income added money, so deleting it takes the same amount back out
      const reverseCode = inc.accountCurrencyAtEntry ?? inc.currency;
      const reverseAmount = inc.accountAmount ?? inc.amount;
      await (updateSubBalance as (id: string, code: string, delta: number) => Promise<void>)(
        inc.accountId, reverseCode, -reverseAmount,
      );
    }
    await (deleteIncome as (id: string) => Promise<void>)(inc.id);
    (getIncomes() as Promise<Income[]>).then((all) => {
      setDayIncomes(all.filter((i) => i.date === date));
    });
  }

  async function handleDeleteTransfer(tr: Transfer) {
    await (updateSubBalance as (id: string, code: string, delta: number) => Promise<void>)(
      tr.fromAccountId, tr.fromCurrency, tr.fromAmount,
    );
    await (updateSubBalance as (id: string, code: string, delta: number) => Promise<void>)(
      tr.toAccountId, tr.toCurrency, -tr.toAmount,
    );
    await (deleteTransfer as (id: string) => Promise<void>)(tr.id);
    (getTransfers() as Promise<Transfer[]>).then((all) => {
      setDayTransfers(all.filter((t) => t.date === date));
    });
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <SafeAreaView style={styles.flex} edges={['top']}>

        {/* Header */}
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.headerSide}>
            <Feather name="chevron-left" size={22} color={t.muted} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: t.text }]}>{dateTitle}</Text>
          <View style={styles.headerSide} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View style={[styles.hero, { backgroundColor: t.bg }]}>
            <Text style={[styles.heroAmount, { color: t.text }]}>
              {homeCurrency} {formatMoney(daySpentHome, homeCurrency)}
            </Text>
            <View style={styles.heroSubRow}>
              <Text style={[styles.heroSub, { color: t.muted }]}>
                {expenses.length} expense{expenses.length !== 1 ? 's' : ''} out
              </Text>
              {dayIncome > 0 && (
                <Text style={[styles.heroSubIncome, { color: t.accent }]}>
                  {`  + ${homeCurrency} ${formatMoney(dayIncome, homeCurrency)} in`}
                </Text>
              )}
            </View>
          </View>

          {/* Budget card */}
          {budget !== null && baseDaily !== null && (
            <View style={[
              styles.budgetCard,
              { backgroundColor: isOver ? t.dangerSoft : t.accentSoft, marginHorizontal: H_PAD, marginBottom: 12 },
            ]}>
              <Text style={[styles.budgetEyebrow, { color: isOver ? t.danger : t.accentInk }]}>
                DAILY BUDGET
              </Text>
              <Text style={[styles.budgetFraction, { color: isOver ? t.danger : t.accentInk }]}>
                {formatMoney(dailyLedgerSpent, homeCurrency)} / {formatMoney(baseDaily, homeCurrency)}
              </Text>
              <View style={[styles.budgetTrack, { backgroundColor: t.bg }]}>
                <View style={[styles.budgetFill, {
                  backgroundColor: isOver ? t.danger : t.accent,
                  width: barWidth as any,
                }]} />
              </View>
              {isOver ? (
                <Text style={[styles.budgetNote, { color: t.danger }]}>
                  {`Over by ${homeCurrency} ${formatMoney(overBy!, homeCurrency)}`}
                </Text>
              ) : (
                <Text style={[styles.budgetNote, { color: t.muted }]}>
                  {prevOverCount > 0
                    ? `${homeCurrency} ${formatMoney(baseDaily - dailyLedgerSpent, homeCurrency)} left today — but save up more to make up for ${homeCurrency} ${formatMoney(prevOverTotal, homeCurrency)} over budget from the last ${prevOverCount} day${prevOverCount !== 1 ? 's' : ''}.`
                    : `${homeCurrency} ${formatMoney(baseDaily - dailyLedgerSpent, homeCurrency)} left today`}
                </Text>
              )}
            </View>
          )}

          {/* Transaction list — same rows as the Expenses "Daily" tab */}
          <View style={[styles.dayEntries, { backgroundColor: t.surface }]}>
            {expenses.length === 0 && dayIncomes.length === 0 && dayTransfers.length === 0 ? (
              <View style={styles.emptyArea}>
                <Text style={[styles.emptyHint, { color: t.muted }]}>No activity on this day.</Text>
              </View>
            ) : (
              <>
                {expenses.map((exp) => (
                  <ExpenseRow
                    key={exp.id}
                    expense={exp}
                    categoryName={categoryMap[exp.categoryId] ?? ''}
                    accountName={accountMap[exp.accountId]?.name ?? ''}
                    accountPrimaryCode={accountMap[exp.accountId]?.primaryCode ?? homeCurrency}
                    homeCurrency={homeCurrency}
                    onPress={() => navigation.navigate('AddEntry', { editExpense: exp })}
                    onDelete={() => handleDeleteExpense(exp)}
                  />
                ))}
                {dayIncomes.map((inc) => (
                  <IncomeRow
                    key={inc.id}
                    income={inc}
                    categoryName={inc.categoryId ? (categoryMap[inc.categoryId] ?? '') : ''}
                    accountName={accountMap[inc.accountId]?.name ?? ''}
                    homeCurrency={homeCurrency}
                    onPress={() => navigation.navigate('AddEntry', { editIncome: inc })}
                    onDelete={() => handleDeleteIncome(inc)}
                  />
                ))}
                {dayTransfers.map((tr) => (
                  <TransferRow
                    key={tr.id}
                    transfer={tr}
                    fromAccountName={accountMap[tr.fromAccountId]?.name ?? 'Account'}
                    toAccountName={accountMap[tr.toAccountId]?.name ?? 'Account'}
                    onPress={() => navigation.navigate('AddEntry', { editTransfer: tr })}
                    onDelete={() => handleDeleteTransfer(tr)}
                  />
                ))}
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Footer */}
      <SafeAreaView style={styles.footerSafe} edges={['bottom']}>
        <View style={[styles.footer, { borderTopColor: t.border, backgroundColor: t.bg }]}>
          <Pressable
            style={[styles.footerBtn, { backgroundColor: t.accent }]}
            onPress={() => navigation.navigate('AddEntry', { prefillDate: date })}
          >
            <Feather name="plus" size={16} color={t.onAccent} />
            <Text style={[styles.footerBtnText, { color: t.onAccent }]}>Add expense on this day</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

// styles

const H_PAD = 20;

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: H_PAD, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { minWidth: 44 },
  headerTitle: { fontSize: 15, fontWeight: '600' },

  hero: {
    paddingHorizontal: H_PAD, paddingVertical: 20,
    gap: 4,
  },
  heroAmount: { fontSize: 38, fontWeight: '600', letterSpacing: -1.4, fontVariant: ['tabular-nums'] },
  heroSubRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  heroSub: { fontSize: 12 },
  heroSubIncome: { fontSize: 12, fontWeight: '600' },

  budgetCard: { borderRadius: 16, padding: 14, gap: 6 },
  budgetEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  budgetFraction: { fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  budgetTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  budgetFill: { height: 8, borderRadius: 4 },
  budgetNote: { fontSize: 11, lineHeight: 16 },

  txRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 11, paddingHorizontal: H_PAD,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  txCatCol: { width: 62, marginRight: 10, paddingTop: 2 },
  txCatName: { fontSize: 12 },
  txMid: { flex: 1, gap: 2, marginRight: 8 },
  txMerchant: { fontSize: 15, fontWeight: '600' },
  txMeta: { fontSize: 12 },
  txAmountCol: { alignItems: 'flex-end', gap: 2, paddingTop: 1 },
  txAmount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'], textAlign: 'right' },
  txAmountSub: { fontSize: 11, fontVariant: ['tabular-nums'], textAlign: 'right' },

  deleteAction: { justifyContent: 'center', paddingRight: 16 },
  deleteBtn: { justifyContent: 'center', alignItems: 'center', padding: 8 },

  dayEntries: { paddingHorizontal: 24, paddingTop: 2, paddingBottom: 4 },
  emptyArea: { padding: 40, alignItems: 'center' },
  emptyHint: { fontSize: 12, textAlign: 'center' },

  footerSafe: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  footer: {
    paddingHorizontal: H_PAD, paddingTop: 12, paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 50, borderRadius: Radii.button,
  },
  footerBtnText: { fontSize: 14, fontWeight: '600' },
});
