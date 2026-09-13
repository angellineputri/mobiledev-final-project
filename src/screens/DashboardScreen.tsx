/* eslint-disable */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { calculateDailyLedger, calculateBudgetProgress, calculateDailyAllowance } from '../budget/engine';
import type { Budget } from '../budget/types';
import { ThemedText } from '../components/themed-text';
import { Radii, SHADOW_COLOR, ScreenPadding, Spacing } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { accountDisplay } from '../logic/businessLogic';
import { formatMoney, formatMoneyWithCode, formatApprox } from '../logic/moneyFormatter';
import {
  getAccounts, getCategories, getExpenses, getIncomes,
  getOrInheritBudget, getSavingGoals, getSettings, getSplitBills,
  accountHomeTotal,
} from '../storage/storage';
import { getRatesFromHome } from '../api/exchangeRate';

// types

type CurrencyBalance = { code: string; balance: number };
type Account = { id: string; name: string; type: string; primaryCode: string; currencies: CurrencyBalance[] };
type Category = { id: string; name: string };
type Expense = {
  id: string; accountId: string; categoryId: string;
  merchant: string; description?: string | null; amount: number; currency: string; amountInHomeCurrency?: number;
  date: string; kind?: 'daily' | 'mustBuy';
};
type Income = {
  id: string; accountId: string; amount: number; currency: string;
  amountInHomeCurrency?: number; source: string; destination: 'allowance' | 'savings'; date: string;
};
type SplitEntry = { person: string; share: number; settled: boolean };
type SplitBill = { id: string; paidBy: 'me' | 'other'; total: number; myShare: number; entries: SplitEntry[] };
type SavingGoal = { id: string; name: string; target: number; targetMonth: string; saved: number; perMonth: number; paused: boolean };

type CategoryTotal = { categoryId: string; name: string; spent: number; limit: number | null; pct: number };
type RecentRow = Expense & { categoryName: string; accountName: string };

const BALANCE_HIDDEN_KEY = 'tally_balance_hidden';
const PAGER_INDEX_KEY = 'tally_pager_index';
const DASHBOARD_CACHE_KEY = 'tally_dashboard_cache';

// helpers

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-SG', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function typeLabel(type: string): string {
  if (type === 'cash') return 'Cash';
  if (type === 'bank') return 'Bank';
  if (type === 'credit_card') return 'Credit Card';
  return 'Other';
}

function isCurrentMonth(isoDate: string): boolean {
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return isoDate?.startsWith(prefix) ?? false;
}

// BalanceCircles

function BalanceCircles() {
  const t = useTheme();
  return (
    <View style={circleStyles.row}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={[circleStyles.dot, { backgroundColor: t.text }]} />
      ))}
    </View>
  );
}

const circleStyles = StyleSheet.create({
  // same height as the amount so hide/show doesn't move things
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, height: 44 },
  dot: { width: 15, height: 15, borderRadius: 7.5 },
});

// HairlineDivider

function HairlineDivider() {
  const t = useTheme();
  return <View style={[styles.hairline, { backgroundColor: t.border }]} />;
}

// DashboardScreen

export default function DashboardScreen({ navigation }: any) {
  const t = useTheme();

  // Data state
  const [accounts, setAccounts]         = useState<Account[]>([]);
  const [monthExpenses, setMonthExp]     = useState<Expense[]>([]);
  const [monthIncomes, setMonthInc]      = useState<Income[]>([]);
  const [categories, setCategories]     = useState<Category[]>([]);
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [splitBills, setSplitBills]     = useState<SplitBill[]>([]);
  const [budget, setBudget]             = useState<Budget | null>(null);
  const [savingGoals, setSavingGoals]   = useState<SavingGoal[]>([]);
  const [loading, setLoading]           = useState(true);

  const [ratesFromHome, setRatesFromHome] = useState<Record<string, number>>({});

  // UI state
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [pagerIndex, setPagerIndex]       = useState(0);

  const pagerRef         = useRef<ScrollView>(null);
  const pagerInitialized = useRef(false);

  // Load persisted UI state + all data
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      Promise.all([
        AsyncStorage.getItem(BALANCE_HIDDEN_KEY),
        AsyncStorage.getItem(PAGER_INDEX_KEY),
        AsyncStorage.getItem(DASHBOARD_CACHE_KEY),
      ]).then(([hidden, idx, cache]) => {
        if (cancelled) return;
        setBalanceHidden(hidden === 'true');
        setPagerIndex(idx ? parseInt(idx, 10) : 0);
        // show cached data first so the screen isn't blank while loading
        if (cache) {
          try {
            const d = JSON.parse(cache);
            if (d.accounts) setAccounts(d.accounts);
            if (d.monthExpenses) setMonthExp(d.monthExpenses);
            if (d.monthIncomes) setMonthInc(d.monthIncomes);
            if (d.categories) setCategories(d.categories);
            if (d.homeCurrency) setHomeCurrency(d.homeCurrency);
            if (d.splitBills) setSplitBills(d.splitBills);
            if (d.budget !== undefined) setBudget(d.budget);
            if (d.savingGoals) setSavingGoals(d.savingGoals);
            if (d.ratesFromHome) setRatesFromHome(d.ratesFromHome);
            setLoading(false);
          } catch { /* ignore corrupt cache */ }
        }
      });

      const today = todayStr();
      const monthStr = today.slice(0, 7);

      Promise.all([
        getAccounts()   as Promise<Account[]>,
        getExpenses()   as Promise<Expense[]>,
        getIncomes()    as Promise<Income[]>,
        getCategories() as Promise<Category[]>,
        getSettings()   as Promise<{ homeCurrency: string }>,
        getSplitBills() as Promise<SplitBill[]>,
        (getOrInheritBudget as (m: string) => Promise<Budget | null>)(monthStr),
        getSavingGoals() as Promise<SavingGoal[]>,
      ]).then(async ([accs, exps, incs, cats, settings, bills, bud, goals]) => {
        if (cancelled) return;
        const home = settings.homeCurrency ?? 'SGD';
        const monthExp = exps.filter((e) => isCurrentMonth(e.date));
        const monthInc = incs.filter((i) => isCurrentMonth(i.date));
        setAccounts(accs);
        setMonthExp(monthExp);
        setMonthInc(monthInc);
        setCategories(cats);
        setHomeCurrency(home);
        setSplitBills(bills);
        setBudget(bud);
        setSavingGoals(goals);
        setLoading(false);
        // get rates for accounts with more than one currency
        const foreign = [...new Set(
          accs.flatMap((a: Account) => a.currencies.map((c: CurrencyBalance) => c.code)).filter((c: string) => c !== home),
        )];
        let rates: Record<string, number> = {};
        if (foreign.length > 0) {
          rates = await getRatesFromHome(home, foreign);
          if (!cancelled) setRatesFromHome(rates);
        }
        // save a snapshot for next time
        if (!cancelled) {
          AsyncStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
            accounts: accs, monthExpenses: monthExp, monthIncomes: monthInc,
            categories: cats, homeCurrency: home, splitBills: bills,
            budget: bud, savingGoals: goals, ratesFromHome: rates,
          })).catch(() => { /* non-critical */ });
        }
      });

      return () => { cancelled = true; };
    }, []),
  );

  async function toggleBalanceHidden() {
    const next = !balanceHidden;
    setBalanceHidden(next);
    await AsyncStorage.setItem(BALANCE_HIDDEN_KEY, String(next));
  }

  function goToPage(idx: number) {
    const clamped = Math.max(0, Math.min(idx, pagerPages.length - 1));
    pagerRef.current?.scrollTo({ x: clamped * Dimensions.get('window').width, animated: true });
    // onMomentumScrollEnd saves the new index
  }

  // Computed values
  const totalBalance = useMemo(
    () => accounts.reduce((s, a) => s + accountHomeTotal(a, homeCurrency, ratesFromHome), 0),
    [accounts, homeCurrency, ratesFromHome],
  );

  const catMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.name])),
    [categories],
  );
  const accMap = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );

  // Budget engine: daily ledger for today's allowance card
  const today = todayStr();
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const ledger = useMemo(() => {
    if (!budget) return null;
    return calculateDailyLedger(monthExpenses, budget, { daysInMonth, today });
  }, [budget, monthExpenses, daysInMonth, today]);

  // today's allowance: the manual amount or the formula one (no carry-over)
  const todayAllowance = useMemo(() => {
    if (!budget) return 0;
    const todayDay = parseInt(today.slice(-2), 10);
    const monthDaysLeft = daysInMonth - todayDay + 1;
    const mustBuyTotal = monthExpenses
      .filter((e) => e.kind === 'mustBuy')
      .reduce((s, e) => s + (e.amountInHomeCurrency ?? e.amount), 0);
    return calculateDailyAllowance(budget, { daysInMonth, daysLeft: monthDaysLeft, mustBuyTotal }).baseDaily;
  }, [budget, monthExpenses, daysInMonth, today]);

  const todayEntry = ledger?.days.find((d) => d.date === today);
  const todaySpent = todayEntry?.spent ?? 0;
  const todayRemaining = Math.max(0, todayAllowance - todaySpent);
  const allowanceBarFill = todayAllowance > 0 ? Math.min(todaySpent / todayAllowance, 1) : 0;
  const todayIsOver = todaySpent - todayAllowance > 0.001;
  const todayOverBy = todaySpent - todayAllowance;

  // cumulative budget health: daily_budget × days_elapsed − non-mustBuy spending
  const dayOfMonth = parseInt(today.slice(-2), 10);
  const nonMustBuySpent = monthExpenses
    .filter((e) => (e.kind ?? 'daily') !== 'mustBuy')
    .reduce((s, e) => s + (e.amountInHomeCurrency ?? e.amount), 0);
  const cumulativeNet = todayAllowance * dayOfMonth - nonMustBuySpent;

  // Today's expense counts
  const todayExpenses = useMemo(
    () => monthExpenses.filter((e) => e.date === today),
    [monthExpenses, today],
  );
  const todayDailyCount = todayExpenses.filter((e) => (e.kind ?? 'daily') === 'daily').length;
  const todayMustBuyCount = todayExpenses.filter((e) => e.kind === 'mustBuy').length;

  // Category bars (budget-aware)
  const budgetProgress = useMemo(() => {
    if (!budget) return null;
    return calculateBudgetProgress(monthExpenses, budget);
  }, [budget, monthExpenses]);

  const categoryBars = useMemo((): CategoryTotal[] => {
    const spend: Record<string, number> = {};
    for (const e of monthExpenses) {
      spend[e.categoryId] = (spend[e.categoryId] ?? 0) + (e.amountInHomeCurrency ?? e.amount);
    }
    const entries = Object.entries(spend).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxSpend = entries[0]?.[1] ?? 1;

    return entries.map(([catId, spent]) => {
      const limit = budgetProgress?.byCategory.find((b) => b.categoryId === catId)?.limit ?? null;
      const pct = limit != null && limit > 0
        ? Math.min(spent / limit, 1)
        : spent / maxSpend;
      return { categoryId: catId, name: catMap[catId] ?? 'Other', spent, limit, pct };
    });
  }, [monthExpenses, catMap, budgetProgress]);

  // Recent 3 rows
  const recentExpenses = useMemo((): RecentRow[] => {
    return [...monthExpenses]
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, 3)
      .map((e) => ({ ...e, categoryName: catMap[e.categoryId] ?? '', accountName: accMap[e.accountId] ?? '' }));
  }, [monthExpenses, catMap, accMap]);

  // pager: page 0 = total, then one page per account
  const pagerPages = useMemo(() => {
    const pages: Array<{
      eyebrow: string;
      balance: number;
      foreign: boolean;
      nativeCode?: string;
      nativeAmount?: number;
      sub: string;
      rateUnavailable?: boolean;
    }> = [
      {
        eyebrow: 'TOTAL BALANCE · ALL ACCOUNTS',
        balance: totalBalance,
        foreign: false,
        sub: `across ${accounts.length} account${accounts.length !== 1 ? 's' : ''}`,
      },
      ...accounts.map((a) => {
        const disp = accountDisplay(a, homeCurrency, ratesFromHome);
        const currLabel = a.type === 'cash' && a.currencies.length > 1
          ? `${a.currencies.length} CURRENCIES`
          : a.primaryCode;
        return {
          eyebrow: `${a.name.toUpperCase()} · ${currLabel}`,
          balance: disp.foreign ? disp.amount : disp.homeEquivalent,
          foreign: disp.foreign,
          nativeCode: disp.foreign ? disp.code : undefined,
          nativeAmount: disp.foreign ? disp.amount : undefined,
          sub: disp.foreign
            ? disp.homeEquivalent !== null
              ? `${typeLabel(a.type)} · ${formatApprox(disp.homeEquivalent, homeCurrency)}`
              : `${typeLabel(a.type)} · ≈ ${homeCurrency} unknown`
            : `${typeLabel(a.type)} · ${a.primaryCode}`,
          rateUnavailable: disp.foreign && disp.homeEquivalent === null,
        };
      }),
    ];
    return pages;
  }, [accounts, totalBalance, homeCurrency, ratesFromHome]);

  const maxPagerIndex = pagerPages.length - 1;
  const currentPage = pagerPages[pagerIndex] ?? pagerPages[0];

  // scroll back to the saved pager page after the screen loads
  useEffect(() => {
    if (!pagerInitialized.current && pagerIndex > 0) {
      pagerInitialized.current = true;
      // wait a bit so the scroll view is ready
      const t = setTimeout(() => {
        pagerRef.current?.scrollTo({ x: pagerIndex * Dimensions.get('window').width, animated: false });
      }, 50);
      return () => clearTimeout(t);
    }
  }, [pagerIndex]);

  // Loading state

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  // Empty state

  if (accounts.length === 0) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: t.bg }]} edges={['top']}>
        <View style={styles.emptyHeader}>
          <ThemedText type="title">Tally</ThemedText>
        </View>
        <View style={styles.emptyBody}>
          <View style={[styles.emptyTile, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Feather name="credit-card" size={26} color={t.accent} />
          </View>
          <Text style={[styles.emptyTitle, { color: t.text }]}>No accounts yet</Text>
          <Text style={[styles.emptyHint, { color: t.muted }]}>
            Add your first account and Tally starts keeping the balance.
          </Text>
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: t.accent }]}
            onPress={() => navigation.navigate('Accounts')}
          >
            <Text style={[styles.primaryBtnText, { color: t.onAccent }]}>Add an account</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Main render

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: t.bg }]} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingHorizontal: ScreenPadding }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Title row ── */}
        <View style={styles.titleRow}>
          <ThemedText type="title">Tally</ThemedText>
          <View style={styles.titleRight}>
            <Text style={[styles.dateText, { color: t.muted }]}>{todayLabel()}</Text>
            <Pressable hitSlop={8} onPress={toggleBalanceHidden}>
              <Feather
                name={balanceHidden ? 'eye-off' : 'eye'}
                size={18}
                color={balanceHidden ? t.accent : t.muted}
              />
            </Pressable>
          </View>
        </View>

        {/* ── Account pager ── */}
        <View style={styles.pagerContainer}>
          {/* Eyebrow + chevrons */}
          <View style={styles.pagerEyebrowRow}>
            <Text style={[styles.pagerEyebrow, { color: t.muted }]} numberOfLines={1}>
              {currentPage?.eyebrow ?? ''}
            </Text>
            <View style={styles.pagerChevrons}>
              <Pressable
                hitSlop={8}
                onPress={() => goToPage(pagerIndex - 1)}
                style={{ opacity: pagerIndex <= 0 ? 0.3 : 1 }}
              >
                <Feather name="chevron-left" size={17} color={t.muted} />
              </Pressable>
              <Pressable
                hitSlop={8}
                onPress={() => goToPage(pagerIndex + 1)}
                style={{ opacity: pagerIndex >= maxPagerIndex ? 0.3 : 1 }}
              >
                <Feather name="chevron-right" size={17} color={t.muted} />
              </Pressable>
            </View>
          </View>

          {/* Swipeable pages */}
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            scrollEventThrottle={16}
            style={{ marginHorizontal: -ScreenPadding }}
            contentContainerStyle={{ paddingHorizontal: 0 }}
            onMomentumScrollEnd={(e) => {
              const i = Math.round(e.nativeEvent.contentOffset.x / (Dimensions.get('window').width));
              const clamped = Math.max(0, Math.min(i, pagerPages.length - 1));
              setPagerIndex(clamped);
              AsyncStorage.setItem(PAGER_INDEX_KEY, String(clamped));
            }}
          >
            {pagerPages.map((page, i) => {
              const displayCode = page.foreign ? page.nativeCode! : homeCurrency;
              const displayAmount = page.balance;
              const parts = formatMoney(displayAmount, displayCode).split('.');
              return (
                <View key={i} style={{ width: Dimensions.get('window').width, paddingHorizontal: ScreenPadding }}>
                  {balanceHidden ? (
                    <BalanceCircles />
                  ) : (
                    <Text
                      style={[styles.heroAmount, { color: t.text }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                    >
                      {displayCode}{' '}
                      <Text>{parts[0]}</Text>
                      {parts[1] !== undefined && (
                        <Text style={[styles.heroCents, { color: t.muted }]}>.{parts[1]}</Text>
                      )}
                    </Text>
                  )}
                  {page.rateUnavailable && !balanceHidden ? (
                    <Pressable onPress={() => Alert.alert(
                      'Rate unavailable',
                      "Couldn't fetch the exchange rate — frankfurter.dev appears to be down. Try again in a while.",
                      [{ text: 'OK' }],
                    )}>
                      <Text style={[styles.heroSub, { color: t.muted }]}>
                        {page.sub}{' '}
                        <Text style={styles.learnMore}>(learn more)</Text>
                      </Text>
                    </Pressable>
                  ) : (balanceHidden || page.sub) ? (
                    <Text style={[styles.heroSub, { color: t.muted }]}>
                      {balanceHidden ? 'Balance hidden' : page.sub}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Today's allowance card ── */}
        {budget && (
          <View style={[styles.allowanceCard, { backgroundColor: todayIsOver ? t.dangerSoft : t.accentSoft }]}>
            <View style={styles.allowanceHeader}>
              <Text style={[styles.allowanceEyebrow, { color: todayIsOver ? t.danger : t.accentInk }]}>TODAY SO FAR</Text>
              <Pressable hitSlop={8} onPress={() => navigation.navigate('DayDetail', { date: today })}>
                <Text style={[styles.allowanceLink, { color: todayIsOver ? t.danger : t.accentInk }]}>Today ›</Text>
              </Pressable>
            </View>

            <Text style={[styles.allowanceFraction, { color: todayIsOver ? t.danger : t.accentInk }]}>
              {formatMoney(todaySpent, homeCurrency)} / {formatMoney(todayAllowance, homeCurrency)}
            </Text>

            <View style={[styles.allowanceTrack, { backgroundColor: t.bg, overflow: 'hidden' }]}>
              <View style={[styles.allowanceFill, {
                backgroundColor: todayIsOver ? t.danger : t.accent,
                width: `${allowanceBarFill * 100}%` as any,
              }]} />
            </View>

            {todayIsOver ? (
              <Text style={[styles.allowanceNote, { color: t.danger }]}>
                {`Over by ${homeCurrency} ${formatMoney(todayOverBy, homeCurrency)}`}
              </Text>
            ) : (
              <Text style={[styles.allowanceNote, { color: t.accentInk, opacity: 0.85 }]}>
                {cumulativeNet >= 0
                  ? `you're on budget`
                  : `save up more to make up for ${homeCurrency} ${formatMoney(-cumulativeNet, homeCurrency)} over budget from the last ${dayOfMonth} day${dayOfMonth !== 1 ? 's' : ''}`}
              </Text>
            )}
          </View>
        )}

        {/* ── Top categories ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <ThemedText type="section">Top categories</ThemedText>
            <Text style={[styles.sectionSub, { color: t.muted }]}>
              {`${new Date().toLocaleDateString('en-SG', { month: 'long' })} · vs budget`}
            </Text>
          </View>
          {categoryBars.length === 0 ? (
            <Text style={[styles.emptySection, { color: t.muted }]}>No expenses yet.</Text>
          ) : (
            <View style={styles.barList}>
              {categoryBars.map((item) => {
                const isOver = item.limit !== null && item.spent > item.limit;
                return (
                  <View key={item.categoryId} style={styles.barItem}>
                    <View style={styles.barLabelRow}>
                      <Text style={[styles.barLabel, { color: t.text }]} numberOfLines={1}>{item.name}</Text>
                      <View style={styles.barAmountRow}>
                        <Text style={[styles.barSpent, { color: isOver ? t.danger : t.text }]}>
                          {formatMoney(item.spent, homeCurrency)}
                        </Text>
                        {item.limit !== null && (
                          <Text style={[styles.barLimit, { color: t.muted }]}>
                            {` / ${formatMoney(item.limit, homeCurrency)}`}
                          </Text>
                        )}
                      </View>
                    </View>
                    <View style={[styles.barTrack, { backgroundColor: t.track }]}>
                      <View style={[styles.barFill, {
                        backgroundColor: isOver ? t.danger : t.accent,
                        width: `${Math.min(item.pct * 100, 100)}%` as any,
                      }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ── Recent (3 rows) ── */}
        <View style={styles.section}>
          <ThemedText type="section">Recent</ThemedText>
          {recentExpenses.length === 0 ? (
            <Text style={[styles.emptySection, { color: t.muted }]}>No expenses yet.</Text>
          ) : (
            recentExpenses.map((e, i) => (
              <View key={e.id}>
                {i > 0 && <HairlineDivider />}
                <View style={styles.recentRow}>
                  <View style={styles.recentMeta}>
                    <Text style={[styles.recentMerchant, { color: t.text }]} numberOfLines={1}>
                      {e.description ? `${e.description} (${e.merchant})` : e.merchant || 'Expense'}
                    </Text>
                    <Text style={[styles.recentSub, { color: t.muted }]}>
                      {e.categoryName}
                      {' · '}
                      {e.accountName}
                      {' · '}
                      {e.kind === 'mustBuy' ? 'must buy' : 'daily'}
                    </Text>
                  </View>
                  <Text style={[styles.recentAmount, { color: t.text }]}>
                    {formatMoneyWithCode(e.amountInHomeCurrency ?? e.amount, e.currency)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={{ height: Spacing.four }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// styles

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  content: { paddingTop: 14, gap: 22 },

  // Title row
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateText: { fontSize: 12 },

  // Pager
  pagerContainer: { gap: 8 },
  pagerEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pagerEyebrow: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase',
    flex: 1,
  },
  pagerChevrons: { flexDirection: 'row', gap: 8 },

  heroAmount: {
    fontSize: 34, fontWeight: '600', letterSpacing: -1.3,
    fontVariant: ['tabular-nums'], lineHeight: 44,
  },
  heroCents: { fontSize: 34, fontWeight: '600' },
  heroSub: { fontSize: 12, marginTop: 3 },
  learnMore: { textDecorationLine: 'underline' },

  // Allowance card
  allowanceCard: {
    borderRadius: Radii.card,
    paddingHorizontal: 16, paddingVertical: 15,
    gap: 9,
  },
  allowanceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  allowanceEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  allowanceLink: { fontSize: 11, fontWeight: '600' },
  allowanceFraction: { fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
  allowanceTrack: { height: 8, borderRadius: 4 },
  allowanceFill: { height: 8, borderRadius: 4 },
  allowanceNote: { fontSize: 11, lineHeight: 16 },

  // Segmented

  // Section
  section: { gap: 10 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionSub: { fontSize: 11 },
  emptySection: { fontSize: 12, paddingVertical: Spacing.two },

  // Bar chart
  barList: { gap: 12 },
  barItem: { gap: 6 },
  barLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  barAmountRow: { flexDirection: 'row', alignItems: 'baseline' },
  barLabel: { fontSize: 14, flex: 1 },
  barSpent: { fontSize: 12, fontVariant: ['tabular-nums'] },
  barLimit: { fontSize: 12, fontVariant: ['tabular-nums'] },
  barTrack: { height: 4, borderRadius: 3 },
  barFill: { height: 4, borderRadius: 3 },

  // Recent
  recentRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8,
  },
  recentMeta: { flex: 1, gap: 3, marginRight: Spacing.two },
  recentMerchant: { fontSize: 14, fontWeight: '600' },
  recentSub: { fontSize: 12 },
  recentAmount: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  hairline: { height: StyleSheet.hairlineWidth },

  // Empty state
  emptyHeader: { padding: ScreenPadding, paddingTop: 14 },
  emptyBody: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 14, paddingHorizontal: ScreenPadding, marginBottom: 60,
  },
  emptyTile: {
    width: 64, height: 64, borderRadius: Radii.emptyTile,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyHint: { fontSize: 12, textAlign: 'center', maxWidth: 230, lineHeight: 21 },
  primaryBtn: { marginTop: 8, paddingVertical: 14, paddingHorizontal: 24, borderRadius: Radii.button },
  primaryBtnText: { fontSize: 13, fontWeight: '600' },
});
