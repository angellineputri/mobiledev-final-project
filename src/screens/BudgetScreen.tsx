import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { calculateDailyAllowance } from '@/budget/engine';
import type { Budget } from '@/budget/types';
import { Radii, ScreenPadding, Spacing } from '@/constants/theme';
import { formatMoney, formatMoneyWithCode } from '@/logic/moneyFormatter';
import { NumericKeypad, formatAmountDisplay, rawToAmount, amountToRaw, applyNumpadKeyAtCursor, displayCursorToRawCursor, rawCursorToDisplayCursor } from '@/components/NumericKeypad';
import { useTheme } from '@/hooks/use-theme';
import {
  getExpenses, getIncomes, getOrInheritBudget, getSavingGoals, getSettings,
  setBudget as saveBudget,
} from '@/storage/storage';
import { getExchangeRate, monthRateDate } from '@/api/exchangeRate';

// types

type SavingGoalRow = { id: string; name: string; currency: string; perMonth: number; monthlyAllocations: Record<string, number>; monthlyRates: Record<string, number>; startMonth: string | null; finishByMonth: string | null };
type Income = { id: string; amount: number; amountInHomeCurrency?: number; destination: string; date: string };

// helpers

function monthName(monthStr: string) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
}

function daysInMonthOf(monthStr: string) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function normalizeGoalRow(g: any, home: string): SavingGoalRow {
  return { id: g.id, name: g.name ?? '', currency: g.currency ?? home, perMonth: g.perMonth ?? 0, monthlyAllocations: g.monthlyAllocations ?? {}, monthlyRates: g.monthlyRates ?? {}, startMonth: g.startMonth ?? null, finishByMonth: g.finishByMonth ?? null };
}

function goalMonthAmount(goal: SavingGoalRow, month: string): number {
  return goal.monthlyAllocations[month] ?? goal.perMonth;
}

// a goal only counts for a month while it is active in it
function isActiveForMonth(goal: SavingGoalRow, month: string): boolean {
  if (goal.startMonth && goal.startMonth > month) return false;
  if (goal.finishByMonth && goal.finishByMonth < month) return false;
  return true;
}

// BudgetScreen

export default function BudgetScreen({ route, navigation }: any) {
  const { month } = route.params as { month: string };
  const t = useTheme();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [autoIncome, setAutoIncome] = useState<number | null>(null);
  const [income, setIncome] = useState('');
  const [savingGoals, setSavingGoals] = useState<SavingGoalRow[]>([]);
  // rate for each foreign goal currency (1 goal = N home)
  const [goalRates, setGoalRates] = useState<Record<string, number>>({});
  const [divisor, setDivisor] = useState<'daysInMonth' | 'daysLeft'>('daysInMonth');
  const [carryOver, setCarryOver] = useState(true);
  const [overallLimit, setOverallLimit] = useState('');
  const [savedCategoryLimits, setSavedCategoryLimits] = useState<any[]>([]);
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [mustBuyTotal, setMustBuyTotal] = useState(0);
  const [dailySpentSoFar, setDailySpentSoFar] = useState(0);

  const [allowanceMode, setAllowanceMode] = useState<'formula' | 'manual'>('formula');
  const [manual, setManual] = useState(''); // cents string, like the income field

  const [incomeNumpadOpen, setIncomeNumpadOpen] = useState(false);
  const incomeInputRef = useRef<TextInput | null>(null);
  const incomeRawCursorRef = useRef<number>(0);

  const [manualNumpadOpen, setManualNumpadOpen] = useState(false);
  const manualInputRef = useRef<TextInput | null>(null);
  const manualRawCursorRef = useRef<number>(0);

  // reload each time the screen is opened again
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      Promise.all([
        (getSavingGoals as () => Promise<any[]>)(),
        (getOrInheritBudget as (m: string) => Promise<Budget | null>)(month),
        (getSettings as () => Promise<{ homeCurrency?: string }>)(),
        (getIncomes as () => Promise<Income[]>)(),
        (getExpenses as () => Promise<any[]>)(),
      ]).then(([goals, budget, settings, allIncomes, allExpenses]) => {
        if (cancelled) return;
        const home = settings.homeCurrency ?? 'SGD';
        setHomeCurrency(home);
        const normGoals = goals.map((g: any) => normalizeGoalRow(g, home));
        setSavingGoals(normGoals);

        // get a rate for each foreign goal currency so we can add them up in home
        const foreignCodes = Array.from(
          new Set(normGoals.map((g) => g.currency).filter((c) => c !== home)),
        );
        Promise.all(
          foreignCodes.map((c) => getExchangeRate(c, home, monthRateDate(month)).then((r) => [c, r] as const)),
        ).then((pairs) => {
          if (cancelled) return;
          const map: Record<string, number> = {};
          pairs.forEach(([c, r]) => { if (r != null) map[c] = r; });
          setGoalRates(map);
        });

        const monthAllowanceIncome = allIncomes
          .filter((i: Income) => i.date?.startsWith(month) && i.destination === 'allowance')
          .reduce((s: number, i: Income) => s + (i.amountInHomeCurrency ?? i.amount), 0);
        setAutoIncome(monthAllowanceIncome > 0 ? monthAllowanceIncome : null);

        const monthMustBuy = allExpenses
          .filter((e: any) => e.date?.startsWith(month) && e.kind === 'mustBuy')
          .reduce((s: number, e: any) => s + (e.amountInHomeCurrency ?? e.amount), 0);
        setMustBuyTotal(monthMustBuy);

        // daily spend so far this month (for the "spending so far" card)
        const nowD = new Date();
        const curMonth = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;
        const isCurMonth = month === curMonth;
        const todayIso = nowD.toISOString().slice(0, 10);
        const dailySoFar = allExpenses
          .filter((e: any) => e.date?.startsWith(month) && e.kind !== 'mustBuy' && (!isCurMonth || e.date <= todayIso))
          .reduce((s: number, e: any) => s + (e.amountInHomeCurrency ?? e.amount), 0);
        setDailySpentSoFar(dailySoFar);

        if (budget) {
          setIncome(amountToRaw(budget.income, home));
          setDivisor(budget.divisor);
          setCarryOver(budget.carryOver);
          setOverallLimit(budget.overallLimit != null ? amountToRaw(budget.overallLimit, home) : '');
          setSavedCategoryLimits(budget.categoryLimits ?? []);
          setAllowanceMode(budget.allowanceMode ?? 'formula');
          setManual(budget.manualDailyAllowance ? amountToRaw(budget.manualDailyAllowance, home) : '');
        }
        setLoading(false);
      });
      return () => { cancelled = true; };
    }, [month]),
  );

  const daysInMonth = daysInMonthOf(month);
  const todayDay = new Date().getDate();
  const daysLeft = Math.max(1, daysInMonth - todayDay + 1);

  const incomeAmount = rawToAmount(income, homeCurrency);
  // use the logged income if there is any, else the typed salary
  const effectiveIncomeNum = autoIncome !== null ? autoIncome : incomeAmount;

  // add up this month's saving goals, converting each to home currency
  const totalSavings = savingGoals.filter((g) => isActiveForMonth(g, month)).reduce((s, g) => {
    const amt = goalMonthAmount(g, month);
    // use the saved manual rate for this month if there is one, else the live rate
    const rate = g.currency === homeCurrency
      ? 1
      : (g.monthlyRates[month] ?? goalRates[g.currency]);
    // if the rate hasn't loaded yet, just use the raw amount
    return s + (rate != null ? amt * rate : amt);
  }, 0);

  const allowanceResult = useMemo(() => {
    const draft: Budget = {
      id: '', month, income: effectiveIncomeNum,
      savingGoalId: null, savingsPerMonth: totalSavings,
      divisor, carryOver, overallLimit: overallLimit ? rawToAmount(overallLimit, homeCurrency) : null,
      categoryLimits: savedCategoryLimits,
    };
    return calculateDailyAllowance(draft, { daysInMonth, daysLeft, mustBuyTotal });
  }, [effectiveIncomeNum, totalSavings, divisor, daysInMonth, daysLeft, month, carryOver, overallLimit, mustBuyTotal]);

  const manualAmount = Math.max(0, rawToAmount(manual, homeCurrency));
  // what the allowance card shows: the manual amount or the formula one
  const shownAllowance = allowanceMode === 'manual' ? manualAmount : allowanceResult.baseDaily;

  // savings guess for manual mode
  const manualProjectedSavings = effectiveIncomeNum - mustBuyTotal - (manualAmount * daysInMonth);
  const manualGoalDiff = manualProjectedSavings - totalSavings;

  // spending so far vs budget = daily spend - allowance x days gone
  const nowDate = new Date();
  const curMonthStr = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;
  const daysSoFar = month === curMonthStr ? todayDay : (month < curMonthStr ? daysInMonth : 0);
  const budgetSoFar = shownAllowance * daysSoFar;
  const overBudget = dailySpentSoFar - budgetSoFar;

  async function handleSave() {
    setSaving(true);
    const effectiveIncome = autoIncome !== null ? autoIncome : incomeAmount;
    try {
      await (saveBudget as (m: string, d: any) => Promise<any>)(month, {
        income: effectiveIncome,
        savingGoalId: null,
        savingsPerMonth: totalSavings,
        divisor,
        carryOver,
        overallLimit: overallLimit ? rawToAmount(overallLimit, homeCurrency) : null,
        categoryLimits: savedCategoryLimits,
        allowanceMode,
        // keep the typed manual amount even in formula mode
        manualDailyAllowance: manualAmount,
      });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save budget.');
    } finally {
      setSaving(false);
    }
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
            <Feather name="x" size={22} color={t.muted} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: t.text }]}>Budget · {monthName(month)}</Text>
          <View style={styles.headerSide} />
        </View>

        <View style={styles.flex}>
          <ScrollView
            contentContainerStyle={[styles.content, { paddingHorizontal: ScreenPadding }]}
            keyboardShouldPersistTaps="handled"
          >

            {/* 1 — Daily allowance result */}
            <View style={[styles.card, { backgroundColor: t.accentSoft }]}>
              <Text style={[styles.eyebrow, { color: t.accentInk }]}>DAILY ALLOWANCE</Text>
              <Text style={[styles.allowanceAmount, { color: t.accentInk }]}>
                {homeCurrency} {formatMoney(shownAllowance, homeCurrency)} / day
              </Text>
              <Text style={[styles.allowanceFormula, { color: t.accentInk, opacity: 0.75 }]}>
                {allowanceMode === 'manual'
                  ? 'Set manually'
                  : `(${formatMoneyWithCode(effectiveIncomeNum, homeCurrency)} − ${formatMoneyWithCode(mustBuyTotal, homeCurrency)} must buy − ${formatMoneyWithCode(totalSavings, homeCurrency)} savings) ÷ ${divisor === 'daysInMonth' ? `${daysInMonth} days` : `${daysLeft} days left`}`}
              </Text>
            </View>

            {/* 2 — Allowance mode toggle */}
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }]}>
              <Text style={[styles.eyebrow, { color: t.muted }]}>DAILY ALLOWANCE MODE</Text>
              <View style={[styles.modeSeg, { backgroundColor: t.bg, borderColor: t.border }]}>
                {([
                  { key: 'formula', label: 'Automatic (formula)' },
                  { key: 'manual', label: 'Manual (set daily amount)' },
                ] as const).map((opt) => {
                  const active = allowanceMode === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      style={[styles.modeThumb, active && [styles.modeThumbActive, { backgroundColor: t.surface }]]}
                      onPress={() => setAllowanceMode(opt.key)}
                    >
                      <Text style={[styles.modeText, { color: active ? t.text : t.muted, fontWeight: active ? '700' : '500' }]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.sectionHint, { color: t.muted }]}>
                {allowanceMode === 'manual'
                  ? 'Your daily allowance is a fixed amount you set. Income, must-buy and days no longer affect it.'
                  : 'Your daily allowance is computed from income, must-buy and savings.'}
              </Text>
            </View>

            {/* Manual daily allowance input (manual mode only) */}
            {allowanceMode === 'manual' && (
              <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }]}>
                <Text style={[styles.eyebrow, { color: t.muted }]}>DAILY ALLOWANCE (MANUAL)</Text>
                <Pressable
                  style={[styles.amountRow, { borderTopColor: t.border }]}
                  onPress={() => manualInputRef.current?.focus()}
                >
                  <Text style={[styles.amountLabel, { color: t.text }]}>Amount per day</Text>
                  <TextInput
                    ref={manualInputRef}
                    style={[styles.amountInput, { color: manual ? t.text : t.muted }]}
                    value={formatAmountDisplay(manual, homeCurrency)}
                    showSoftInputOnFocus={false}
                    caretHidden
                    editable
                    onFocus={() => {
                      setIncomeNumpadOpen(false);
                      setManualNumpadOpen(true);
                      manualRawCursorRef.current = manual.length;
                    }}
                    onSelectionChange={({ nativeEvent: { selection } }) => {
                      const display = formatAmountDisplay(manual, homeCurrency);
                      manualRawCursorRef.current = displayCursorToRawCursor(display, selection.start);
                    }}
                  />
                </Pressable>
                {manualAmount > 0 && effectiveIncomeNum > 0 && (
                  <Text style={[styles.sectionHint, { color: manualGoalDiff < -0.005 ? t.danger : t.muted }]}>
                    {manualProjectedSavings < 0
                      ? `With an income of ${homeCurrency} ${formatMoney(effectiveIncomeNum, homeCurrency)} and a daily budget of ${homeCurrency} ${formatMoney(manualAmount, homeCurrency)}/day, you'll be on a deficit of ${homeCurrency} ${formatMoney(Math.abs(manualProjectedSavings), homeCurrency)} by end of the month.`
                      : `With an income of ${homeCurrency} ${formatMoney(effectiveIncomeNum, homeCurrency)} and a daily budget of ${homeCurrency} ${formatMoney(manualAmount, homeCurrency)}/day, you'll be able to save ${homeCurrency} ${formatMoney(manualProjectedSavings, homeCurrency)} by end of the month. That's `}
                    {manualProjectedSavings >= 0 && (
                      <>
                        {Math.abs(manualGoalDiff) < 0.005
                          ? 'on track with'
                          : manualGoalDiff > 0
                            ? `${homeCurrency} ${formatMoney(manualGoalDiff, homeCurrency)} more than`
                            : `${homeCurrency} ${formatMoney(Math.abs(manualGoalDiff), homeCurrency)} less than`}
                        {totalSavings > 0
                          ? ` your ${homeCurrency} ${formatMoney(totalSavings, homeCurrency)} allocated goals combined.`
                          : ' your allocated goals combined.'}
                      </>
                    )}
                  </Text>
                )}
              </View>
            )}

            {/* Formula inputs — hidden in manual mode since they don't apply */}
            {allowanceMode === 'formula' && (<>
            {/* Money In */}
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.eyebrow, { color: t.muted }]}>MONEY IN</Text>
              </View>
              {autoIncome !== null ? (
                <>
                  <View style={[styles.amountRow, { borderTopColor: t.border }]}>
                    <Text style={[styles.amountLabel, { color: t.text }]}>From logged income</Text>
                    <Text style={[styles.amountComputed, { color: t.text }]}>{formatMoneyWithCode(autoIncome, homeCurrency)}</Text>
                  </View>
                  <Text style={[styles.sectionHint, { color: t.muted }]}>
                    Sum of income entries marked "daily allowance" this month.
                  </Text>
                </>
              ) : (
                <Pressable
                  style={[styles.amountRow, { borderTopColor: t.border }]}
                  onPress={() => incomeInputRef.current?.focus()}
                >
                  <Text style={[styles.amountLabel, { color: t.text }]}>Salary / allowance</Text>
                  <TextInput
                    ref={incomeInputRef}
                    style={[styles.amountInput, { color: income ? t.text : t.muted }]}
                    value={formatAmountDisplay(income, homeCurrency)}
                    showSoftInputOnFocus={false}
                    caretHidden
                    editable
                    onFocus={() => {
                      setIncomeNumpadOpen(true);
                      incomeRawCursorRef.current = income.length;
                    }}
                    onSelectionChange={({ nativeEvent: { selection } }) => {
                      const display = formatAmountDisplay(income, homeCurrency);
                      incomeRawCursorRef.current = displayCursorToRawCursor(display, selection.start);
                    }}
                  />
                </Pressable>
              )}
            </View>

            {/* 3 — Must buy */}
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.eyebrow, { color: t.muted }]}>MUST BUY (FIXED)</Text>
                {mustBuyTotal > 0 && (
                  <Text style={[styles.amountComputed, { color: t.text }]}>{formatMoneyWithCode(mustBuyTotal, homeCurrency)}</Text>
                )}
              </View>
              <Text style={[styles.sectionHint, { color: t.muted }]}>
                Expenses tagged "must buy" are automatically deducted before dividing your daily allowance.
              </Text>
            </View>

            {/* 4 — Saving this month (read-only) */}
            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.eyebrow, { color: t.muted }]}>SAVING THIS MONTH</Text>
                <Text style={[styles.amountComputed, { color: t.text }]}>
                  {totalSavings > 0 ? formatMoneyWithCode(totalSavings, homeCurrency) : '—'}
                </Text>
              </View>
              {savingGoals.length === 0 && (
                <Text style={[styles.sectionHint, { color: t.muted }]}>
                  No saving goals yet. Manage them in the Saving tab.
                </Text>
              )}
            </View>
            </>)}

            {/* Spending so far vs budget — shown in both modes */}
            {daysSoFar > 0 && (
              <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }]}>
                <Text style={[styles.eyebrow, { color: t.muted }]}>SPENDING SO FAR</Text>
                <Text style={[styles.soFarText, { color: overBudget > 0.005 ? t.danger : t.accent }]}>
                  {overBudget > 0.005
                    ? `So far, you're ${homeCurrency} ${formatMoney(overBudget, homeCurrency)} over budget.`
                    : `So far, you're ${homeCurrency} ${formatMoney(Math.abs(overBudget), homeCurrency)} under budget.`}
                </Text>
                <Text style={[styles.sectionHint, { color: t.muted }]}>
                  {`${formatMoneyWithCode(dailySpentSoFar, homeCurrency)} spent − ${formatMoneyWithCode(shownAllowance, homeCurrency)}/day × ${daysSoFar} day${daysSoFar !== 1 ? 's' : ''}`}
                </Text>
              </View>
            )}

            <View style={{ height: Spacing.two }} />
          </ScrollView>

          {/* Footer */}
          <SafeAreaView style={[styles.footer, { paddingHorizontal: ScreenPadding }]} edges={['bottom']}>
            <Pressable
              style={[styles.saveBtn, { backgroundColor: t.accent }, saving && styles.dimmed]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size="small" color={t.onAccent} />
                : <Text style={[styles.saveBtnText, { color: t.onAccent }]}>Save budget</Text>}
            </Pressable>
          </SafeAreaView>
        </View>
      </SafeAreaView>

      {incomeNumpadOpen && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => { setIncomeNumpadOpen(false); incomeInputRef.current?.blur(); }} />
          <NumericKeypad
            onKey={(key) => {
              setIncome((s) => {
                const { newRaw, newCursor } = applyNumpadKeyAtCursor(s, key, incomeRawCursorRef.current, homeCurrency);
                incomeRawCursorRef.current = newCursor;
                const newDisplay = formatAmountDisplay(newRaw, homeCurrency);
                const dCursor = rawCursorToDisplayCursor(newDisplay, newCursor);
                requestAnimationFrame(() => {
                  incomeInputRef.current?.setNativeProps({ selection: { start: dCursor, end: dCursor } });
                });
                return newRaw;
              });
            }}
          />
        </>
      )}

      {manualNumpadOpen && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => { setManualNumpadOpen(false); manualInputRef.current?.blur(); }} />
          <NumericKeypad
            onKey={(key) => {
              setManual((s) => {
                const { newRaw, newCursor } = applyNumpadKeyAtCursor(s, key, manualRawCursorRef.current, homeCurrency);
                manualRawCursorRef.current = newCursor;
                const newDisplay = formatAmountDisplay(newRaw, homeCurrency);
                const dCursor = rawCursorToDisplayCursor(newDisplay, newCursor);
                requestAnimationFrame(() => {
                  manualInputRef.current?.setNativeProps({ selection: { start: dCursor, end: dCursor } });
                });
                return newRaw;
              });
            }}
          />
        </>
      )}

    </View>
  );
}

// styles

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { minWidth: 44 },
  headerTitle: { fontSize: 15, fontWeight: '600' },

  content: { paddingTop: 16, gap: 14, paddingBottom: 16 },

  card: { borderRadius: Radii.card, padding: 16, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  amountComputed: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sectionHint: { fontSize: 11, lineHeight: 16 },

  allowanceAmount: { fontSize: 30, fontWeight: '600', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  allowanceFormula: { fontSize: 11, lineHeight: 17 },
  soFarText: { fontSize: 14, fontWeight: '600', lineHeight: 20 },

  amountRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth,
  },
  amountLabel: { flex: 1, fontSize: 13, marginRight: 12 },
  amountInput: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'], textAlign: 'right', minWidth: 80 },

  // Allowance mode segmented control
  modeSeg: { flexDirection: 'row', padding: 3, borderRadius: 10, borderWidth: 1, gap: 3 },
  modeThumb: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  modeThumbActive: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07, shadowRadius: 2, elevation: 1,
  },
  modeText: { fontSize: 12 },

  footer: { paddingTop: 12, paddingBottom: 10 },
  saveBtn: { height: 54, borderRadius: Radii.button, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: 14, fontWeight: '600' },
  dimmed: { opacity: 0.5 },
});
