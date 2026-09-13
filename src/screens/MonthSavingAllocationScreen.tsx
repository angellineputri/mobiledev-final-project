// set how much goes to each saving goal in one month, and show the total

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { Radii, ScreenPadding } from '@/constants/theme';
import { formatMoney } from '@/logic/moneyFormatter';
import {
  NumericKeypad,
  applyNumpadKey,
  formatAmountDisplay,
  rawToAmount,
  amountToRaw,
} from '@/components/NumericKeypad';
import { useTheme } from '@/hooks/use-theme';
import { getSavingGoals, getSettings, recordMonthlyAllocation, recordMonthlyRate } from '@/storage/storage';
import { getExchangeRate, monthRateDate } from '@/api/exchangeRate';

// types

type GoalRow = {
  id: string;
  name: string;
  currency: string;
  perMonth: number;
  targetAmount: number | null;
  savedAmount: number;
  startMonth: string | null;
  finishByMonth: string | null;
  monthlyAllocations: Record<string, number>;
  monthlyRates: Record<string, number>;
};

// helpers

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  return `${MONTH_SHORT[parseInt(m, 10) - 1]} ${y}`;
}

function normalizeGoal(g: any, home: string): GoalRow {
  return {
    id: g.id,
    name: g.name ?? '',
    currency: g.currency ?? home,
    perMonth: g.perMonth ?? 0,
    targetAmount: g.targetAmount ?? null,
    savedAmount: g.savedAmount ?? 0,
    startMonth: g.startMonth ?? null,
    finishByMonth: g.finishByMonth ?? null,
    monthlyAllocations: g.monthlyAllocations ?? {},
    monthlyRates: g.monthlyRates ?? {},
  };
}

/**
 * A goal is "active" for a given month if:
 *  - It started at or before that month (or has no start date)
 *  - It ends at or after that month (or has no end date)
 * We intentionally do NOT check completedAt — a goal completed in December
 * was still active in September.
 */
function isActiveForMonth(goal: GoalRow, month: string): boolean {
  if (goal.startMonth && goal.startMonth > month) return false;
  if (goal.finishByMonth && goal.finishByMonth < month) return false;
  return true;
}

/** Allocation for this goal in this month: override if set, else perMonth default */
function goalMonthAmount(goal: GoalRow, month: string): number {
  return goal.monthlyAllocations[month] ?? goal.perMonth;
}

// screen

export default function MonthSavingAllocationScreen({ route, navigation }: any) {
  const { month } = route.params as { month: string };
  const t = useTheme();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [allGoals, setAllGoals] = useState<GoalRow[]>([]);
  const [rawAmounts, setRawAmounts] = useState<Record<string, string>>({});
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [activeNumpad, setActiveNumpad] = useState<string | null>(null);
  // rate to home for each goal (null while a foreign one loads)
  const [rates, setRates] = useState<Record<string, number | null>>({});
  // goals with a manual rate set (don't auto-overwrite them)
  const [manualRates, setManualRates] = useState<Record<string, boolean>>({});
  // which goal the rate sheet is editing (null = closed)
  const [rateSheetGoal, setRateSheetGoal] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      Promise.all([
        (getSavingGoals as () => Promise<any[]>)(),
        (getSettings as () => Promise<{ homeCurrency?: string }>)(),
      ]).then(([goals, settings]) => {
        if (cancelled) return;
        const home = settings.homeCurrency ?? 'SGD';
        setHomeCurrency(home);

        const normalized = goals.map((g) => normalizeGoal(g, home));
        setAllGoals(normalized);

        // fill in the amounts from saved allocations, in each goal's currency
        const init: Record<string, string> = {};
        const initRates: Record<string, number | null> = {};
        const initManual: Record<string, boolean> = {};
        normalized.forEach((g) => {
          if (isActiveForMonth(g, month)) {
            const a = goalMonthAmount(g, month);
            init[g.id] = amountToRaw(a, g.currency);
            if (g.currency === home) {
              initRates[g.id] = 1;
            } else if (g.monthlyRates[month] != null) {
              initRates[g.id] = g.monthlyRates[month]; // saved manual rate
              initManual[g.id] = true;
            } else {
              initRates[g.id] = null; // fetched below
            }
          }
        });
        setRawAmounts(init);
        setRates(initRates);
        setManualRates(initManual);
        setLoading(false);
      });
      return () => { cancelled = true; };
    }, [month]),
  );

  const activeGoals = allGoals.filter((g) => isActiveForMonth(g, month));

  // fetch this month's rate for foreign goals that don't have one yet
  useEffect(() => {
    let cancelled = false;
    activeGoals.forEach((g) => {
      if (g.currency === homeCurrency) return;
      if (manualRates[g.id]) return;
      if (rates[g.id] != null) return;
      getExchangeRate(g.currency, homeCurrency, monthRateDate(month)).then((r) => {
        if (!cancelled && r != null) setRates((prev) => ({ ...prev, [g.id]: r }));
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGoals.map((g) => g.id).join(','), homeCurrency, month, manualRates]);

  // save a manual rate for this goal
  function applyManualRate(goalId: string, r: number) {
    setRates((prev) => ({ ...prev, [goalId]: r }));
    setManualRates((prev) => ({ ...prev, [goalId]: true }));
    recordMonthlyRate(goalId, month, r);
  }

  // Revert to the auto-fetched rate for this month and drop the saved override.
  // Clearing the manual flag + rate lets the fetch effect refetch this month's rate.
  function resetRateToAuto(goalId: string) {
    setManualRates((prev) => { const n = { ...prev }; delete n[goalId]; return n; });
    setRates((prev) => ({ ...prev, [goalId]: null }));
    recordMonthlyRate(goalId, month, null);
  }

  // Amount for one goal, in its own currency.
  function goalAmount(g: GoalRow): number {
    const raw = rawAmounts[g.id] ?? '';
    return raw ? rawToAmount(raw, g.currency) : goalMonthAmount(g, month);
  }

  // one goal's amount in home currency
  function goalAmountHome(g: GoalRow): number | null {
    const rate = g.currency === homeCurrency ? 1 : rates[g.id];
    if (rate == null) return null;
    return Math.round(goalAmount(g) * rate * 100) / 100;
  }

  // Auto-computed total (in home currency) from all active goals.
  const totalAllocation = activeGoals.reduce((s, g) => s + (goalAmountHome(g) ?? 0), 0);

  async function handleSave() {
    setSaving(true);
    try {
      await Promise.all(
        activeGoals.map((g) => {
          const raw = rawAmounts[g.id] ?? '';
          // Empty raw = user cleared the field → save 0, not the perMonth default.
          // Stored in the goal's OWN currency (consistent with the goal editor).
          const amount = raw ? rawToAmount(raw, g.currency) : 0;
          return (recordMonthlyAllocation as (id: string, m: string, a: number) => Promise<void>)(
            g.id, month, amount,
          );
        }),
      );
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save allocations.');
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
            <Feather name="chevron-left" size={22} color={t.muted} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: t.text }]}>
            Saving · {monthLabel(month)}
          </Text>
          <View style={styles.headerSide} />
        </View>

        <View style={styles.flex}>
          <ScrollView
            contentContainerStyle={[styles.content, { paddingHorizontal: ScreenPadding }]}
            keyboardShouldPersistTaps="handled"
          >

            {/* Total — auto-computed, read-only */}
            <View style={[styles.totalCard, { backgroundColor: t.accentSoft }]}>
              <Text style={[styles.totalEyebrow, { color: t.accentInk }]}>SAVING GOAL THIS MONTH</Text>
              <Text style={[styles.totalAmount, { color: t.accentInk }]}>
                {homeCurrency} {formatMoney(totalAllocation, homeCurrency)}
              </Text>
              <Text style={[styles.totalHint, { color: t.accentInk, opacity: 0.7 }]}>
                Auto-total from goals below · in {homeCurrency}
              </Text>
            </View>

            {/* Goal list */}
            {activeGoals.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: t.surface, borderColor: t.border }]}>
                <Text style={[styles.emptyText, { color: t.muted }]}>
                  No saving goals active in {monthLabel(month)}.
                </Text>
                <Pressable
                  style={styles.emptyLink}
                  onPress={() => navigation.navigate('ManageSavings')}
                >
                  <Text style={[styles.emptyLinkText, { color: t.accent }]}>Manage goals ›</Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.goalList, { backgroundColor: t.surface, borderColor: t.border }]}>
                {activeGoals.map((goal, idx) => {
                  const raw = rawAmounts[goal.id] ?? '';
                  const currentAmount = goalAmount(goal);
                  const deficit = goal.perMonth > 0 ? goal.perMonth - currentAmount : 0;
                  const isOpen = activeNumpad === goal.id;
                  const isForeign = goal.currency !== homeCurrency;
                  const amtHome = goalAmountHome(goal);

                  return (
                    <View key={goal.id}>
                      {idx > 0 && <View style={[styles.divider, { backgroundColor: t.border }]} />}
                      <Pressable
                        style={styles.goalRow}
                        onPress={() => setActiveNumpad(isOpen ? null : goal.id)}
                      >
                        <View style={styles.goalLeft}>
                          <Text style={[styles.goalName, { color: t.text }]} numberOfLines={1}>
                            {goal.name}
                          </Text>
                          {deficit > 0.005 && (
                            <Text style={[styles.behindNote, { color: t.danger }]}>
                              {`You're ${goal.currency} ${formatMoney(deficit, goal.currency)} behind your ${goal.currency} ${formatMoney(goal.perMonth, goal.currency)}/mo goal`}
                            </Text>
                          )}
                        </View>
                        <View style={styles.goalRight}>
                          <Text style={[styles.goalAmount, { color: isOpen ? t.accent : t.text }]}>
                            {raw ? `${goal.currency} ${formatAmountDisplay(raw, goal.currency)}` : '—'}
                          </Text>
                          {isForeign && raw !== '' && (
                            <Text style={[styles.goalHomeHint, { color: t.muted }]}>
                              {amtHome != null ? `≈ ${homeCurrency} ${formatMoney(amtHome, homeCurrency)}` : `≈ ${homeCurrency} …`}
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

          </ScrollView>

          {/* Footer */}
          <SafeAreaView style={[styles.footer, { paddingHorizontal: ScreenPadding }]} edges={['bottom']}>
            <Pressable
              style={[styles.saveBtn, { backgroundColor: t.accent }, saving && styles.dimmed]}
              onPress={handleSave}
              disabled={saving || activeGoals.length === 0}
            >
              {saving
                ? <ActivityIndicator size="small" color={t.onAccent} />
                : <Text style={[styles.saveBtnText, { color: t.onAccent }]}>Save</Text>}
            </Pressable>
          </SafeAreaView>
        </View>
      </SafeAreaView>

      {/* Inline numpad for the active goal */}
      {activeNumpad !== null && (() => {
        const goal = activeGoals.find((g) => g.id === activeNumpad);
        if (!goal) return null;
        const raw = rawAmounts[goal.id] ?? '';
        const isForeign = goal.currency !== homeCurrency;
        const rate = isForeign ? rates[goal.id] : 1;
        const amt = goalAmount(goal);
        const amtHome = goalAmountHome(goal);

        return (
          <>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setActiveNumpad(null)} />

            {/* Conversion panel — goal currency on top, home-currency rate footer */}
            <View style={[styles.numpadPanel, { backgroundColor: t.surface, borderTopColor: t.border }]}>
              <View style={styles.panelAmountRow}>
                <Text style={[styles.panelGoalName, { color: t.muted }]} numberOfLines={1}>
                  {goal.name}
                </Text>
                <Text style={[styles.panelAmount, { color: t.text }]}>
                  {goal.currency} {raw ? formatAmountDisplay(raw, goal.currency) : formatMoney(0, goal.currency)}
                </Text>
              </View>

              {isForeign && (
                <Pressable
                  style={[styles.rateRow, { borderColor: t.border, backgroundColor: t.bg }]}
                  onPress={() => setRateSheetGoal(goal.id)}
                >
                  <View style={styles.rateRowLines}>
                    <Text style={[styles.rateRowLabel, { color: t.muted }]}>
                      {'1 '}{goal.currency}{' = '}
                      <Text style={[styles.rateRowValue, { color: t.text }]}>{rate ?? '…'}</Text>
                      {' '}{homeCurrency}
                    </Text>
                    <Text style={[styles.rateRowLabel, { color: t.muted }]}>
                      {formatMoney(amt, goal.currency)}{' '}{goal.currency}{' = '}
                      <Text style={[styles.rateRowValue, { color: t.text }]}>
                        {amtHome != null ? formatMoney(amtHome, homeCurrency) : '…'}
                      </Text>
                      {' '}{homeCurrency}
                    </Text>
                  </View>
                  {manualRates[goal.id] ? (
                    <Pressable
                      hitSlop={8}
                      style={[styles.autoBtn, { borderColor: t.accent }]}
                      onPress={() => resetRateToAuto(goal.id)}
                    >
                      <Feather name="refresh-cw" size={11} color={t.accent} />
                      <Text style={[styles.autoBtnText, { color: t.accent }]}>auto</Text>
                    </Pressable>
                  ) : (
                    <Text style={[styles.rateRowAdjust, { color: t.accent }]}>adjust ›</Text>
                  )}
                </Pressable>
              )}
            </View>

            <NumericKeypad
              onKey={(k) =>
                setRawAmounts((prev) => ({
                  ...prev,
                  [goal.id]: applyNumpadKey(prev[goal.id] ?? '', k, goal.currency),
                }))
              }
            />
          </>
        );
      })()}

      {/* Rate adjust sheet */}
      {rateSheetGoal !== null && (() => {
        const goal = activeGoals.find((g) => g.id === rateSheetGoal);
        if (!goal) return null;
        return (
          <RateSheet
            visible
            fromCurrency={goal.currency}
            toCurrency={homeCurrency}
            rate={rates[goal.id] ?? null}
            amount={goalAmount(goal)}
            t={t}
            onSave={(r) => applyManualRate(goal.id, r)}
            onClose={() => setRateSheetGoal(null)}
          />
        );
      })()}

    </View>
  );
}

// rate adjust sheet
// Mirrors the expense entry's rate editor: tap either row to set the unit
// rate (1 from = N to) or the converted total; both stay in sync.

function applyRateKey(raw: string, key: string): string {
  if (key === 'backspace') return raw.slice(0, -1);
  if (key === '.') {
    if (raw.includes('.')) return raw;
    return (raw || '0') + '.';
  }
  if (raw.length >= 10) return raw;
  const dotIdx = raw.indexOf('.');
  if (dotIdx !== -1 && raw.length - dotIdx > 6) return raw;
  if (raw === '0') return key;
  return raw + key;
}

function RateSheet({ visible, onClose, fromCurrency, toCurrency, rate, amount, onSave, t }: {
  visible: boolean; onClose: () => void;
  fromCurrency: string; toCurrency: string;
  rate: number | null; amount: number; onSave: (r: number) => void; t: any;
}) {
  const [draft, setDraft] = useState('');
  const [activeField, setActiveField] = useState<'unit' | 'total'>('unit');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      setActiveField('unit');
      setDraft(rate !== null ? String(rate) : '');
    }
  }, [visible]);

  function switchTo(field: 'unit' | 'total') {
    if (field === activeField) return;
    const n = parseFloat(draft) || 0;
    if (field === 'total') {
      const total = amount > 0 ? Math.round(n * amount * 100) / 100 : 0;
      setDraft(total > 0 ? String(total) : '');
    } else {
      const unitRate = amount > 0 ? Math.round((n / amount) * 1000000) / 1000000 : 0;
      setDraft(unitRate > 0 ? String(unitRate) : '');
    }
    setActiveField(field);
  }

  function handleApply() {
    const n = parseFloat(draft);
    const resolvedRate = activeField === 'unit' ? n : (amount > 0 ? n / amount : 0);
    if (isNaN(resolvedRate) || resolvedRate <= 0) {
      Alert.alert('Invalid rate', 'Enter a rate greater than 0.');
      return;
    }
    onSave(Math.round(resolvedRate * 1000000) / 1000000);
    onClose();
  }

  const draftNum = parseFloat(draft) || 0;
  const computedUnit = activeField === 'total' && amount > 0
    ? Math.round((draftNum / amount) * 1000000) / 1000000
    : null;
  const computedTotal = activeField === 'unit' && amount > 0
    ? Math.round(draftNum * amount * 100) / 100
    : null;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetScrim} onPress={onClose} />
      <View style={[styles.rateSheetContainer, { backgroundColor: t.surface }]}>
        <View style={styles.rateSheetPadded}>
          <View style={[styles.sheetHandle, { backgroundColor: t.track ?? t.border }]} />
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: t.text }]}>Adjust Rate</Text>
            <Pressable hitSlop={16} onPress={onClose}>
              <Text style={[styles.sheetAction, { color: t.muted }]}>Cancel</Text>
            </Pressable>
          </View>
          <Text style={[styles.rateSheetHint, { color: t.muted }]}>
            Tap either row to edit. Set the unit rate or the converted total.
          </Text>

          {/* Unit rate row */}
          <Pressable
            style={[styles.rateDisplayRow, {
              borderColor: activeField === 'unit' ? t.accent : t.border,
              backgroundColor: t.bg,
              marginBottom: amount > 0 ? 10 : 0,
            }]}
            onPress={() => switchTo('unit')}
          >
            <Text style={[styles.rateInputLabel, { color: t.muted }]}>1 {fromCurrency} =</Text>
            <Text style={[styles.rateDisplayValue, { color: activeField === 'unit' ? (draft ? t.text : t.muted) : t.muted }]}>
              {activeField === 'unit'
                ? (draft || '0.00')
                : (computedUnit != null && computedUnit > 0 ? String(computedUnit) : '—')}
            </Text>
            <Text style={[styles.rateInputLabel, { color: t.muted }]}>{toCurrency}</Text>
          </Pressable>

          {/* Converted total row */}
          {amount > 0 && (
            <Pressable
              style={[styles.rateDisplayRow, {
                borderColor: activeField === 'total' ? t.accent : t.border,
                backgroundColor: t.bg,
              }]}
              onPress={() => switchTo('total')}
            >
              <Text style={[styles.rateInputLabel, { color: t.muted }]}>
                {formatMoney(amount, fromCurrency)} {fromCurrency} =
              </Text>
              <Text style={[styles.rateDisplayValue, { color: activeField === 'total' ? (draft ? t.text : t.muted) : t.muted }]}>
                {activeField === 'total'
                  ? (draft || '0.00')
                  : (computedTotal != null && computedTotal > 0 ? formatMoney(computedTotal, toCurrency) : '—')}
              </Text>
              <Text style={[styles.rateInputLabel, { color: t.muted }]}>{toCurrency}</Text>
            </Pressable>
          )}

          <Pressable style={[styles.sheetBtn, { backgroundColor: t.accent }]} onPress={handleApply}>
            <Text style={[styles.sheetBtnText, { color: t.onAccent }]}>Apply Rate</Text>
          </Pressable>
        </View>
        <NumericKeypad
          bottomLeftKey="."
          onKey={(key) => setDraft((d) => applyRateKey(d, key))}
        />
        <View style={{ height: insets.bottom }} />
      </View>
    </Modal>
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

  content: { paddingTop: 16, gap: 14, paddingBottom: 24 },

  totalCard: {
    borderRadius: Radii.card, padding: 20,
    alignItems: 'center', gap: 4,
  },
  totalEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  totalAmount: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  totalHint: { fontSize: 11 },

  emptyCard: {
    borderRadius: Radii.card, borderWidth: 1,
    padding: 20, alignItems: 'center', gap: 8,
  },
  emptyText: { fontSize: 13, textAlign: 'center' },
  emptyLink: { paddingTop: 2 },
  emptyLinkText: { fontSize: 13, fontWeight: '600' },

  goalList: { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },

  goalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  goalLeft: { flex: 1, gap: 3 },
  goalName: { fontSize: 14, fontWeight: '600' },
  behindNote: { fontSize: 11, lineHeight: 15 },
  goalRight: { alignItems: 'flex-end', gap: 2 },
  goalAmount: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: 'right' },
  goalHomeHint: { fontSize: 11, fontVariant: ['tabular-nums'] },

  // Conversion panel above the inline keypad
  numpadPanel: {
    paddingHorizontal: ScreenPadding, paddingTop: 12, paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth, gap: 10,
  },
  panelAmountRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  panelGoalName: { fontSize: 13, flexShrink: 1 },
  panelAmount: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rateRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: Radii.button, paddingHorizontal: 14, paddingVertical: 10, gap: 10,
  },
  rateRowLines: { flex: 1, gap: 2 },
  rateRowLabel: { fontSize: 12 },
  rateRowValue: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  rateRowAdjust: { fontSize: 12, fontWeight: '600' },
  autoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
  },
  autoBtnText: { fontSize: 12, fontWeight: '700' },

  // Rate adjust sheet
  sheetScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  rateSheetContainer: { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  rateSheetPadded: { paddingHorizontal: ScreenPadding, paddingTop: 8 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  sheetAction: { fontSize: 15 },
  rateSheetHint: { fontSize: 12, marginBottom: 14 },
  rateDisplayRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: Radii.button, paddingHorizontal: 14, paddingVertical: 14, gap: 8,
  },
  rateInputLabel: { fontSize: 13 },
  rateDisplayValue: { flex: 1, fontSize: 18, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  sheetBtn: { height: 52, borderRadius: Radii.button, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  sheetBtnText: { fontSize: 15, fontWeight: '700' },

  footer: { paddingTop: 12, paddingBottom: 10 },
  saveBtn: {
    height: 54, borderRadius: Radii.button,
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtnText: { fontSize: 14, fontWeight: '600' },
  dimmed: { opacity: 0.5 },
});
