import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Swipeable } from 'react-native-gesture-handler';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { calculateBudgetProgress, calculateDailyAllowance } from '@/budget/engine';
import type { Budget, SavingGoal } from '@/budget/types';
import { ThemedText } from '@/components/themed-text';
import MonthPickerSheet from '@/components/MonthPickerSheet';
import { Radii, SHADOW_COLOR, Spacing, WHITE } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { accountAmountDisplay, formatMoney, formatMoneyWithCode } from '@/logic/moneyFormatter';
import { getExchangeRate, monthRateDate } from '@/api/exchangeRate';
import {
  deleteExpense, deleteIncome, deleteTransfer, getAccounts, getCategories, getExpenses, getIncomes,
  getOrInheritBudget, getSavingGoals, getSettings, getTransfers, recordMonthlyAllocation, recordMonthlyRate, updateSubBalance,
} from '@/storage/storage';
import { NumericKeypad, formatAmountDisplay, rawToAmount, amountToRaw, applyNumpadKeyAtCursor, displayCursorToRawCursor, rawCursorToDisplayCursor } from '@/components/NumericKeypad';
import { ExpenseRow, IncomeRow, TransferRow } from '@/components/TransactionRows';

// types

type CurrencyBalance = { code: string; balance: number };
type Account = { id: string; name: string; primaryCode: string; currencies: CurrencyBalance[] };
type Expense = {
  id: string; accountId: string; categoryId: string; merchant: string;
  description?: string | null; amount: number; currency: string; amountInHomeCurrency?: number;
  accountAmount?: number; accountCurrencyAtEntry?: string;
  date: string; notes?: string; isShared?: boolean;
  kind?: 'daily' | 'mustBuy';
};
type Income = {
  id: string; accountId: string; amount: number; currency: string;
  accountCurrencyAtEntry?: string; accountAmount?: number;
  amountInHomeCurrency?: number; categoryId?: string | null; source: string;
  destination: 'allowance' | 'savings'; date: string; notes?: string | null;
};
type Transfer = {
  id: string; date: string;
  fromAccountId: string; toAccountId: string;
  fromCurrency: string; toCurrency: string;
  fromAmount: number; toAmount: number;
  notes?: string | null;
};

type SubTab = 'daily' | 'calendar' | 'monthly' | 'summary' | 'saving';
type Category = { id: string; name: string; kind?: 'expense' | 'income' };
type FilterState = { accountIds: string[] };

// constants

const H_PAD = 20;

const CATEGORY_ICON_MAP: Record<string, string> = {
  Food: 'coffee',
  Transport: 'navigation',
  Shopping: 'shopping-bag',
  Entertainment: 'film',
  Necessities: 'home',
  Gifts: 'gift',
  Emergency: 'shield',
  'SIM card': 'wifi',
  'Memberships & subscriptions': 'repeat',
};

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'daily',    label: 'Daily' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'monthly',  label: 'Monthly' },
  { key: 'summary',  label: 'Summary' },
  { key: 'saving',   label: 'Saving' },
];

const EMPTY_FILTER: FilterState = { accountIds: [] };

const SCREEN_WIDTH = Dimensions.get('window').width;
const CAL_H_PAD = 20;
const CELL_GAP = 3;
const cellWidth = (SCREEN_WIDTH - 2 * CAL_H_PAD - 6 * CELL_GAP) / 7;

// helpers

function fmtMonthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
}
function fmtDayNum(iso: string) {
  return String(new Date(iso + 'T00:00:00').getDate()).padStart(2, '0');
}
function fmtWeekday(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-SG', { weekday: 'short' }).toUpperCase();
}
function catIcon(name: string): any {
  return CATEGORY_ICON_MAP[name] ?? 'tag';
}

// FilterModal

function FilterModal({ visible, onClose, filter, onChange, accounts }: {
  visible: boolean; onClose: () => void;
  filter: FilterState; onChange: (f: FilterState) => void;
  accounts: Account[];
}) {
  const t = useTheme();
  const [local, setLocal] = useState<FilterState>(filter);

  function toggleAccount(id: string) {
    setLocal((f) => ({
      ...f,
      accountIds: f.accountIds.includes(id) ? f.accountIds.filter((x) => x !== id) : [...f.accountIds, id],
    }));
  }

  function apply() { onChange(local); onClose(); }
  function clearAll() {
    setLocal(EMPTY_FILTER);
    onChange(EMPTY_FILTER);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onShow={() => setLocal(filter)}
    >
      <View style={[styles.modalRoot, { backgroundColor: t.bg }]}>
        <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <Pressable onPress={clearAll} hitSlop={8}>
              <Text style={[styles.modalAction, { color: t.muted }]}>Clear all</Text>
            </Pressable>
            <ThemedText type="stackTitle">Filters</ThemedText>
            <Pressable onPress={apply} hitSlop={8}>
              <Text style={[styles.modalAction, { color: t.accent }]}>Done</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <ThemedText type="eyebrow" themeColor="muted" style={styles.modalSection}>Accounts</ThemedText>
            <View style={styles.chipWrap}>
              {accounts.map((a) => {
                const sel = local.accountIds.includes(a.id);
                return (
                  <Pressable key={a.id}
                    style={[styles.fChip, sel
                      ? { backgroundColor: t.accent }
                      : { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border }]}
                    onPress={() => toggleAccount(a.id)}>
                    <Text style={[styles.fChipText, { color: sel ? t.onAccent : t.muted }]}>{a.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// blend helper (approximates CSS color-mix)

function blendColors(c1: string, c2: string, w: number): string {
  const h = (s: string, o: number) => parseInt(s.replace('#', '').slice(o, o + 2), 16);
  return `rgb(${Math.round(h(c1, 0) * (1 - w) + h(c2, 0) * w)},${Math.round(h(c1, 2) * (1 - w) + h(c2, 2) * w)},${Math.round(h(c1, 4) * (1 - w) + h(c2, 4) * w)})`;
}

// DayGroup

function DayGroup({ date, expenses, dayIncomes, dayTransfers, isFirst, homeCurrency, categoryMap, accountMap,
  onPressExpense, onDeleteExpense, onPressIncome, onDeleteIncome, onPressTransfer, onDeleteTransfer, onPressDate }: {
  date: string; expenses: Expense[]; dayIncomes: Income[]; dayTransfers: Transfer[]; isFirst: boolean; homeCurrency: string;
  categoryMap: Record<string, string>; accountMap: Record<string, Account>;
  onPressExpense: (e: Expense) => void;
  onDeleteExpense: (e: Expense) => void;
  onPressIncome: (i: Income) => void;
  onDeleteIncome: (i: Income) => void;
  onPressTransfer: (t: Transfer) => void;
  onDeleteTransfer: (t: Transfer) => void;
  onPressDate: (date: string) => void;
}) {
  const t = useTheme();
  const dayTotal = expenses.reduce((s, e) => s + (e.amountInHomeCurrency ?? e.amount), 0);
  const dayIncome = dayIncomes.reduce((s, i) => s + (i.amountInHomeCurrency ?? i.amount), 0);
  const headerBg = blendColors(t.surface, t.accentSoft, 0.45);

  const d = new Date(date + 'T00:00:00');
  const weekday = d.toLocaleDateString('en-SG', { weekday: 'short' });
  const dayNum = d.getDate();
  const mon = d.toLocaleDateString('en-SG', { month: 'short' });

  return (
    <View>
      {!isFirst && <View style={{ height: 14 }} />}

      {/* Day header */}
      <Pressable
        style={[styles.dayHeader, { backgroundColor: headerBg }]}
        onPress={() => onPressDate(date)}
      >
        <Text style={[styles.dayHeaderDate, { color: t.text }]}>
          {weekday} {dayNum}{' '}
          <Text style={[styles.dayHeaderMon, { color: t.muted }]}>· {mon}</Text>
        </Text>
        {dayIncome > 0 ? (
          <View style={styles.dayHeaderRight}>
            <Text style={[styles.dayHeaderIncome, { color: t.accent }]}>
              +{formatMoneyWithCode(dayIncome, homeCurrency)}
            </Text>
            <Text style={[styles.dayHeaderTotal, { color: t.text }]}>
              {formatMoneyWithCode(dayTotal, homeCurrency)}
            </Text>
          </View>
        ) : (
          <Text style={[styles.dayHeaderTotal, { color: t.text }]}>
            {formatMoneyWithCode(dayTotal, homeCurrency)}
          </Text>
        )}
      </Pressable>

      {/* Entry list */}
      <View style={[styles.dayEntries, { backgroundColor: t.surface }]}>
        {expenses.map((exp) => (
          <ExpenseRow
            key={exp.id}
            expense={exp}
            categoryName={categoryMap[exp.categoryId] ?? ''}
            accountName={accountMap[exp.accountId]?.name ?? ''}
            accountPrimaryCode={accountMap[exp.accountId]?.primaryCode ?? homeCurrency}
            homeCurrency={homeCurrency}
            onPress={() => onPressExpense(exp)}
            onDelete={() => onDeleteExpense(exp)}
          />
        ))}
        {dayIncomes.map((inc) => (
          <IncomeRow
            key={inc.id}
            income={inc}
            categoryName={inc.categoryId ? (categoryMap[inc.categoryId] ?? '') : ''}
            accountName={accountMap[inc.accountId]?.name ?? ''}
            homeCurrency={homeCurrency}
            onPress={() => onPressIncome(inc)}
            onDelete={() => onDeleteIncome(inc)}
          />
        ))}
        {dayTransfers.map((tr) => (
          <TransferRow
            key={tr.id}
            transfer={tr}
            fromAccountName={accountMap[tr.fromAccountId]?.name ?? 'Account'}
            toAccountName={accountMap[tr.toAccountId]?.name ?? 'Account'}
            onPress={() => onPressTransfer(tr)}
            onDelete={() => onDeleteTransfer(tr)}
          />
        ))}
      </View>
    </View>
  );
}

// PlaceholderTab

function PlaceholderTab({ icon, label }: { icon: string; label: string }) {
  const t = useTheme();
  return (
    <View style={styles.phCenter}>
      <View style={[styles.phTile, { backgroundColor: t.surface, borderColor: t.border }]}>
        <Feather name={icon as any} size={26} color={t.accent} />
      </View>
      <Text style={[styles.phLabel, { color: t.muted }]}>{label}</Text>
    </View>
  );
}

// CalendarTab

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function CalendarTab({ year, month, expenses, incomes, homeCurrency, navigation, budget }: {
  year: number; month: number;
  expenses: Expense[];
  incomes: Income[];
  homeCurrency: string;
  navigation: any;
  budget: Budget | null;
}) {
  const t = useTheme();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  useEffect(() => { setSelectedDay(null); }, [year, month]);

  const today = new Date();
  const isThisMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  const todayDay = today.getDate();

  const dayData = useMemo(() => {
    const map: Record<number, { total: number; dailyTotal: number; count: number }> = {};
    for (const e of expenses) {
      const d = parseInt(e.date.slice(-2), 10);
      if (!map[d]) map[d] = { total: 0, dailyTotal: 0, count: 0 };
      map[d].total += e.amountInHomeCurrency ?? e.amount;
      if ((e.kind ?? 'daily') !== 'mustBuy') {
        map[d].dailyTotal += e.amountInHomeCurrency ?? e.amount;
      }
      map[d].count++;
    }
    return map;
  }, [expenses]);

  const dayIncomeMap = useMemo(() => {
    const map: Record<number, number> = {};
    for (const i of incomes) {
      const d = parseInt(i.date.slice(-2), 10);
      map[d] = (map[d] ?? 0) + (i.amountInHomeCurrency ?? i.amount);
    }
    return map;
  }, [incomes]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const startDow = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Mon=0
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  // base daily allowance, used to tint over-budget days.
  // must-buy has to be deducted here too, or the budget line comes out higher
  // than the day-detail card and over-budget days never turn red.
  const baseDaily = useMemo(() => {
    if (!budget) return null;
    const mustBuyTotal = expenses
      .filter((e) => e.kind === 'mustBuy')
      .reduce((s, e) => s + (e.amountInHomeCurrency ?? e.amount), 0);
    return calculateDailyAllowance(budget, { daysInMonth, daysLeft: daysInMonth, mustBuyTotal }).baseDaily;
  }, [budget, daysInMonth, expenses]);

  const selData = selectedDay !== null ? dayData[selectedDay] : undefined;
  const selIsOver = baseDaily !== null && selData !== undefined && selData.dailyTotal > baseDaily;
  const isoDate = (d: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  function fmtBandDate(d: number) {
    return new Date(year, month - 1, d).toLocaleDateString('en-SG', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
  }

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: 16, paddingBottom: selectedDay !== null ? 88 : 80 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Weekday header */}
      <View style={calStyles.weekRow}>
        {WEEKDAYS.map((d, i) => (
          <View key={i} style={[calStyles.weekCell, { width: cellWidth }]}>
            <Text style={[calStyles.weekLabel, { color: t.muted }]}>{d}</Text>
          </View>
        ))}
      </View>

      {/* Grid */}
      <View style={{ paddingHorizontal: CAL_H_PAD }}>
        {rows.map((row, ri) => (
          <View key={ri} style={[calStyles.gridRow, ri > 0 && { marginTop: CELL_GAP }]}>
            {row.map((day, ci) => {
              if (day === null) {
                return <View key={`b${ri}-${ci}`} style={[calStyles.cell, { width: cellWidth, borderWidth: 0 }]} />;
              }
              const isSelected = selectedDay === day;
              const data = dayData[day];
              const incomeAmt = dayIncomeMap[day] ?? 0;
              const hasActivity = !!(data || incomeAmt > 0);
              const isOver = !isSelected && baseDaily !== null && data != null && data.dailyTotal > baseDaily;
              const cellBg = isSelected ? t.accent : isOver ? t.dangerSoft : t.surface;
              const showBorder = hasActivity || isSelected || isOver;
              return (
                <Pressable
                  key={day}
                  style={[calStyles.cell, { width: cellWidth, backgroundColor: cellBg, borderColor: t.border, borderWidth: showBorder ? StyleSheet.hairlineWidth : 0 }]}
                  onPress={() => {
                    // one tap: select the day and open its detail
                    setSelectedDay(day);
                    navigation.navigate('DayDetail', { date: isoDate(day) });
                  }}
                >
                  <Text style={[calStyles.cellDay, { color: isSelected ? t.onAccent : t.muted }]}>
                    {day}
                  </Text>
                  {hasActivity ? (
                    <>
                      {data ? (
                        <Text style={[calStyles.cellTotal, {
                          color: isSelected ? t.onAccent : isOver ? t.danger : t.text,
                        }]}>
                          {`${homeCurrency} ${Math.round(data.total).toLocaleString('en-SG')}`}
                        </Text>
                      ) : null}
                      {incomeAmt > 0 ? (
                        <Text style={[calStyles.cellIncome, {
                          color: isSelected ? t.onAccent : t.accent,
                        }]}>
                          {`+${homeCurrency} ${Math.round(incomeAmt).toLocaleString('en-SG')}`}
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={[calStyles.cellDash, {
                      color: isSelected ? t.onAccent : t.muted,
                      opacity: isSelected ? 1 : 0.35,
                    }]}>–</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {/* Legend */}
      <View style={[calStyles.legend, { paddingHorizontal: CAL_H_PAD }]}>
        <View style={[calStyles.legendSwatch, { backgroundColor: t.dangerSoft }]} />
        <Text style={[calStyles.legendText, { color: t.muted }]}>over daily budget</Text>
        <Text style={[calStyles.legendPlus, { color: t.accent }]}>+</Text>
        <Text style={[calStyles.legendText, { color: t.muted }]}>{`income · all in ${homeCurrency}`}</Text>
      </View>

      {/* Selected day band */}
      {selectedDay !== null && (
        <Pressable
          style={[calStyles.dayBand, {
            backgroundColor: t.surface, borderColor: t.border,
            marginHorizontal: CAL_H_PAD,
          }]}
          onPress={() => navigation.navigate('DayDetail', { date: isoDate(selectedDay) })}
        >
          <View style={{ flex: 1 }}>
            <Text style={[calStyles.bandDate, { color: t.text }]}>{fmtBandDate(selectedDay)}</Text>
            <Text style={[calStyles.bandMeta, { color: t.muted }]}>
              {`${selData?.count ?? 0} expense${(selData?.count ?? 0) !== 1 ? 's' : ''}${baseDaily !== null ? ` · daily budget ${homeCurrency} ${formatMoney(baseDaily, homeCurrency)}` : ''}`}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', marginRight: 6 }}>
            <Text style={[calStyles.bandAmount, { color: t.text }]}>
              {homeCurrency} {formatMoney(selData?.total ?? 0, homeCurrency)}
            </Text>
            {selIsOver && baseDaily !== null && selData !== undefined && (
              <Text style={[calStyles.bandOver, { color: t.danger }]}>
                {`over by ${formatMoneyWithCode(selData.dailyTotal - baseDaily, homeCurrency)}`}
              </Text>
            )}
          </View>
          <Feather name="chevron-right" size={16} color={t.muted} />
        </Pressable>
      )}
    </ScrollView>

    {/* Add expense on this day — shown when a day is selected */}
    {selectedDay !== null && (
      <View style={{ backgroundColor: t.bg }}>
        <Pressable
          style={[calStyles.addDayBtn, { backgroundColor: t.accent }]}
          onPress={() => navigation.navigate('AddEntry', { date: isoDate(selectedDay) })}
        >
          <Text style={[calStyles.addDayBtnText, { color: t.onAccent }]}>
            Add expense on this day
          </Text>
        </Pressable>
      </View>
    )}
    </View>
  );
}

// MonthlyTab (the year view)

const MONTH_ABBREVS_MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function MonthlyTab({ allExpenses, allIncomes, selectedYear, selectedMonth, homeCurrency, setYear, setMonth, setSubTab }: {
  allExpenses: Expense[];
  allIncomes: Income[];
  selectedYear: number; selectedMonth: number;
  homeCurrency: string;
  setYear: (y: number) => void;
  setMonth: (m: number) => void;
  setSubTab: (s: SubTab) => void;
}) {
  const t = useTheme();
  const now = new Date();
  const todayYear  = now.getFullYear();
  const todayMonth = now.getMonth() + 1;

  const [navYear, setNavYear] = useState(selectedYear);

  // Recompute whenever navYear changes
  const spendByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of allExpenses) {
      const key = e.date?.slice(0, 7);
      if (!key) continue;
      map[key] = (map[key] ?? 0) + (e.amountInHomeCurrency ?? e.amount);
    }
    return map;
  }, [allExpenses]);

  const incomeByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    for (const i of allIncomes) {
      const key = i.date?.slice(0, 7);
      if (!key) continue;
      map[key] = (map[key] ?? 0) + (i.amountInHomeCurrency ?? i.amount);
    }
    return map;
  }, [allIncomes]);

  // months so far this year (or all 12 for a past year)
  const ytdEnd = navYear < todayYear ? 12 : navYear === todayYear ? todayMonth : 0;
  let ytdIn = 0, ytdSpent = 0;
  for (let m = 1; m <= ytdEnd; m++) {
    const key = `${navYear}-${String(m).padStart(2, '0')}`;
    ytdIn    += incomeByMonth[key] ?? 0;
    ytdSpent += spendByMonth[key]  ?? 0;
  }
  const ytdSaved = ytdIn - ytdSpent;

  const COL_W = 62;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* ── Year nav ── */}
      <View style={[moStyles.yearNav, { borderBottomColor: t.border }]}>
        <Pressable hitSlop={12} onPress={() => setNavYear((y) => y - 1)}>
          <Feather name="chevron-left" size={20} color={t.muted} />
        </Pressable>
        <Text style={[moStyles.yearLabel, { color: t.text }]}>{navYear}</Text>
        <Pressable hitSlop={12} onPress={() => setNavYear((y) => y + 1)}>
          <Feather name="chevron-right" size={20} color={t.muted} />
        </Pressable>
      </View>

      {/* ── Column headers ── */}
      <View style={[moStyles.colHeader, { borderBottomColor: t.border }]}>
        <Text style={[moStyles.colHdr, { color: t.muted, flex: 1 }]}>{`MONTH · ${homeCurrency}`}</Text>
        <Text style={[moStyles.colHdr, { color: t.muted, width: COL_W, textAlign: 'right' }]}>IN</Text>
        <Text style={[moStyles.colHdr, { color: t.muted, width: COL_W, textAlign: 'right' }]}>SPENT</Text>
        <Text style={[moStyles.colHdr, { color: t.muted, width: COL_W, textAlign: 'right' }]}>SAVED</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
        {MONTH_ABBREVS_MO.map((abbrev, idx) => {
          const m = idx + 1;
          const isSel = navYear === selectedYear && m === selectedMonth;
          const key = `${navYear}-${String(m).padStart(2, '0')}`;
          const inAmt    = incomeByMonth[key] ?? 0;
          const spent    = spendByMonth[key]  ?? 0;
          const saved    = inAmt - spent;

          return (
            <Pressable
              key={m}
              style={moStyles.row}
              onPress={() => { setYear(navYear); setMonth(m); setSubTab('daily'); }}
            >
              <Text style={[moStyles.monthName, {
                color: isSel ? t.accent : t.text,
                fontWeight: isSel ? '700' : '500',
                flex: 1,
              }]}>
                {abbrev}
              </Text>
              <Text style={[moStyles.colVal, { color: t.muted, width: COL_W }]}>
                {formatMoneyWithCode(inAmt, homeCurrency)}
              </Text>
              <Text style={[moStyles.colVal, { color: t.text, width: COL_W }]}>
                {formatMoneyWithCode(spent, homeCurrency)}
              </Text>
              <Text style={[moStyles.colValBold, {
                color: saved >= 0 ? t.accent : t.danger,
                width: COL_W,
              }]}>
                {formatMoneyWithCode(Math.abs(saved), homeCurrency)}
              </Text>
            </Pressable>
          );
        })}

        {/* ── Year to date footer ── */}
        {ytdEnd > 0 && (
          <View style={[moStyles.ytdRow, { borderTopColor: t.border }]}>
            <Text style={[moStyles.ytdLabel, { color: t.text, flex: 1 }]}>Year to date</Text>
            <Text style={[moStyles.colVal, { color: t.muted, width: COL_W }]}>
              {formatMoneyWithCode(ytdIn, homeCurrency)}
            </Text>
            <Text style={[moStyles.colVal, { color: t.text, width: COL_W }]}>
              {formatMoneyWithCode(ytdSpent, homeCurrency)}
            </Text>
            <Text style={[moStyles.colValBold, {
              color: ytdSaved >= 0 ? t.accent : t.danger, width: COL_W,
            }]}>
              {formatMoneyWithCode(Math.abs(ytdSaved), homeCurrency)}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// DonutChart

const DONUT_OPACITIES = [1, 0.65, 0.4, 0.2];

function DonutChart({ slices, size, strokeWidth }: {
  slices: Array<{ value: number; opacity: number }>;
  size: number;
  strokeWidth: number;
}) {
  const t = useTheme();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((s, seg) => s + seg.value, 0);
  const cx = size / 2;
  const cy = size / 2;

  let cumulative = 0;
  const arcs = slices.map((seg) => {
    const frac = total > 0 ? seg.value / total : 0;
    const dashLen = frac * circumference;
    const dashOffset = -(cumulative * circumference);
    cumulative += frac;
    return { dashLen, dashOffset, opacity: seg.opacity };
  });

  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={radius} fill="none" stroke={t.track} strokeWidth={strokeWidth} />
      <G rotation={-90} origin={`${cx},${cy}`}>
        {arcs.map((arc, i) => (
          <Circle
            key={i}
            cx={cx} cy={cy} r={radius}
            fill="none"
            stroke={t.accent}
            strokeOpacity={arc.opacity}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arc.dashLen} ${circumference - arc.dashLen}`}
            strokeDashoffset={arc.dashOffset}
          />
        ))}
      </G>
    </Svg>
  );
}

// SummaryTab

function SummaryTab({ year, month, expenses, incomes: monthIncomes, homeCurrency, categories, navigation, setSubTab }: {
  year: number; month: number;
  expenses: Expense[];
  incomes: Income[];
  homeCurrency: string;
  categories: Category[];
  navigation: any;
  setSubTab: (t: SubTab) => void;
}) {
  const t = useTheme();
  const [budget, setBudgetData] = useState<Budget | null>(null);
  const [savingGoals, setSavingGoals] = useState<SavingGoal[]>([]);
  const [budgetLoading, setBudgetLoading] = useState(true);
  const [showAllCats, setShowAllCats] = useState(false);
  // rate to home for each goal, by goal id (manual override wins, else fetched)
  const [goalRates, setGoalRates] = useState<Record<string, number | null>>({});

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setBudgetLoading(true);
      Promise.all([
        (getOrInheritBudget as (m: string) => Promise<Budget | null>)(monthStr),
        (getSavingGoals as () => Promise<SavingGoal[]>)(),
      ]).then(async ([b, goals]) => {
        if (cancelled) return;
        setBudgetData(b);
        setSavingGoals(goals);
        setBudgetLoading(false);
        const seed: Record<string, number | null> = {};
        const toFetch: any[] = [];
        goals.forEach((g: any) => {
          const gc = g.currency ?? homeCurrency;
          if (gc === homeCurrency) { seed[g.id] = 1; return; }
          const override = (g.monthlyRates ?? {})[monthStr];
          if (override != null) { seed[g.id] = override; }
          else { seed[g.id] = null; toFetch.push(g); }
        });
        if (!cancelled) setGoalRates(seed);
        const fetched = await Promise.all(
          toFetch.map((g) =>
            getExchangeRate(g.currency ?? homeCurrency, homeCurrency, monthRateDate(monthStr))
              .then((r) => [g.id, r] as const),
          ),
        );
        if (!cancelled) setGoalRates((prev) => {
          const next = { ...prev };
          fetched.forEach(([id, r]) => { if (r != null) next[id] = r; });
          return next;
        });
      });
      return () => { cancelled = true; };
    }, [monthStr, homeCurrency]),
  );

  // change a goal amount into home currency
  function toHomeAmt(amount: number, goal: any): number {
    const gc = goal.currency ?? homeCurrency;
    if (gc === homeCurrency) return amount;
    const rate = goalRates[goal.id];
    return rate != null ? amount * rate : amount;
  }

  const autoIncome = useMemo(
    () => monthIncomes
      .filter((i) => i.destination === 'allowance')
      .reduce((s, i) => s + (i.amountInHomeCurrency ?? i.amount), 0),
    [monthIncomes],
  );

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  // all categories by spend, for the donut and list
  const allCategories = useMemo(() => {
    const spend: Record<string, number> = {};
    for (const e of expenses) {
      spend[e.categoryId] = (spend[e.categoryId] ?? 0) + (e.amountInHomeCurrency ?? e.amount);
    }
    return Object.entries(spend)
      .map(([id, val]) => ({ id, name: categoryMap[id] ?? 'Other', value: val }))
      .sort((a, b) => b.value - a.value);
  }, [expenses, categoryMap]);

  const donutSlices = allCategories.slice(0, 4).map((c, i) => ({
    value: c.value,
    opacity: DONUT_OPACITIES[i] ?? 0.2,
  }));

  // Engine computations
  const today = new Date().toISOString().slice(0, 10);
  const isCurrentMonth = today.startsWith(monthStr);
  const daysInMonth = new Date(year, month, 0).getDate();
  const effectiveToday = isCurrentMonth
    ? today
    : `${monthStr}-${String(daysInMonth).padStart(2, '0')}`;

  const mustBuyTotal = useMemo(
    () => expenses.filter((e) => e.kind === 'mustBuy').reduce((s, e) => s + (e.amountInHomeCurrency ?? e.amount), 0),
    [expenses],
  );

  const allowanceResult = useMemo(() => {
    if (!budget) return null;
    const todayDay = parseInt(effectiveToday.slice(-2), 10);
    const daysLeft = Math.max(1, daysInMonth - todayDay + 1);
    const effectiveBudget = autoIncome > 0 ? { ...budget, income: autoIncome } : budget;
    return calculateDailyAllowance(effectiveBudget, { daysInMonth, daysLeft, mustBuyTotal });
  }, [budget, autoIncome, daysInMonth, effectiveToday, mustBuyTotal]);

  const progress = useMemo(() => {
    if (!budget) return null;
    return calculateBudgetProgress(expenses, budget);
  }, [budget, expenses]);

  const savingGoal = budget?.savingGoalId
    ? savingGoals.find((g) => g.id === budget.savingGoalId) ?? null
    : null;


  if (budgetLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  const hasData = expenses.length > 0;
  const TOP_N = 5;
  const visibleCats = showAllCats ? allCategories : allCategories.slice(0, TOP_N);
  const hasMore = allCategories.length > TOP_N;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={sumStyles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Donut row: chart left, daily allowance right ── */}
      <View style={sumStyles.donutRow}>
        {/* Left: donut or empty placeholder */}
        {hasData ? (
          <View style={sumStyles.donutLeft}>
            <DonutChart slices={donutSlices} size={106} strokeWidth={7} />
          </View>
        ) : (
          <View style={[sumStyles.donutLeft, { justifyContent: 'center', gap: 6 }]}>
            <View style={[styles.emptyTile, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Feather name="pie-chart" size={26} color={t.accent} />
            </View>
            <Text style={[sumStyles.spentCaption, { color: t.muted }]}>No expenses yet</Text>
          </View>
        )}

        {/* Right: daily allowance mini-card — always shown */}
        <View style={[sumStyles.allowanceMini, { backgroundColor: t.accentSoft }]}>
          <View style={sumStyles.cardHeader}>
            <Text style={[sumStyles.cardEyebrow, { color: t.accentInk }]}>DAILY ALLOWANCE</Text>
            <Pressable hitSlop={8} onPress={() => navigation.navigate('Budget', { month: monthStr })}>
              <Text style={[sumStyles.cardLink, { color: t.accentInk }]}>Formula ›</Text>
            </Pressable>
          </View>
          {budget && allowanceResult ? (
            <>
              <View style={sumStyles.allowanceRow}>
                <Text style={[sumStyles.allowanceAmount, { color: t.accentInk }]}>
                  {formatMoneyWithCode(allowanceResult.baseDaily, homeCurrency)}
                </Text>
                <Text style={[sumStyles.allowanceDay, { color: t.accentInk, opacity: 0.6 }]}>/ day</Text>
              </View>
              {progress?.overallLimit != null && (
                <>
                  <View style={[sumStyles.hr, { backgroundColor: t.accentInk, opacity: 0.15 }]} />
                  <Text style={[sumStyles.monthSoFarLabel, { color: t.accentInk, opacity: 0.7 }]}>Month so far</Text>
                  <Text style={[sumStyles.monthSoFarValue, { color: t.accentInk }]}>
                    {formatMoneyWithCode(progress.overallSpent, homeCurrency)} / {formatMoneyWithCode(progress.overallLimit, homeCurrency)} · {Math.round((progress.overallPercent ?? 0) * 100)}%
                  </Text>
                  <View style={[sumStyles.progressTrack, { overflow: 'hidden' }]}>
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.accentInk, opacity: 0.18 }]} />
                    <View style={[sumStyles.progressFill, {
                      backgroundColor: t.accentInk,
                      width: `${Math.min((progress.overallPercent ?? 0) * 100, 100)}%` as any,
                    }]} />
                  </View>
                </>
              )}
            </>
          ) : (
            <Text style={[sumStyles.noBudget, { color: t.accentInk, opacity: 0.7 }]}>
              No budget set.
            </Text>
          )}
        </View>
      </View>


      {/* ── Category breakdown (Top 5 with Show more toggle) ── */}
      {allCategories.length > 0 && (
        <View style={[sumStyles.card, { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }]}>
          <View style={sumStyles.cardHeader}>
            <Text style={[sumStyles.sectionEyebrow, { color: t.muted }]}>TOP CATEGORIES</Text>
            <Pressable hitSlop={8} onPress={() => navigation.navigate('CategoryLimits', { month: monthStr })}>
              <Text style={[sumStyles.cardLink, { color: t.accent }]}>Edit limits</Text>
            </Pressable>
          </View>
          {visibleCats.map((cat, i) => {
            const limitItem = budget?.categoryLimits.find((cl) => cl.categoryId === cat.id);
            const limit = limitItem?.limit ?? null;
            const isOver = limit !== null && cat.value > limit;
            const pct = limit !== null && limit > 0
              ? Math.min(cat.value / limit, 1)
              : cat.value / (allCategories[0]?.value || 1);
            return (
              <View key={cat.id}>
                {i > 0 && <View style={[sumStyles.hr, { backgroundColor: t.border }]} />}
                <View style={sumStyles.limitRow}>
                  <View style={[sumStyles.catSwatch, { backgroundColor: t.accent, opacity: DONUT_OPACITIES[i] ?? 0.15 }]} />
                  <Text style={[sumStyles.limitName, { color: t.text }]} numberOfLines={1}>{cat.name}</Text>
                  <View style={sumStyles.limitRight}>
                    <Text style={[sumStyles.limitValues, { color: isOver ? t.danger : t.muted }]}>
                      {limit !== null
                        ? `${formatMoneyWithCode(cat.value, homeCurrency)} / ${formatMoneyWithCode(limit, homeCurrency)}`
                        : formatMoneyWithCode(cat.value, homeCurrency)}
                    </Text>
                    <View style={[sumStyles.limitTrack, { backgroundColor: t.track }]}>
                      <View style={[sumStyles.limitFill, {
                        backgroundColor: isOver ? t.danger : t.accent,
                        width: `${Math.min(pct * 100, 100)}%` as any,
                      }]} />
                    </View>
                  </View>
                </View>
              </View>
            );
          })}
          {hasMore && (
            <>
              <View style={[sumStyles.hr, { backgroundColor: t.border }]} />
              <Pressable onPress={() => setShowAllCats(!showAllCats)} style={sumStyles.toggleCatsBtn}>
                <Text style={[sumStyles.toggleCatsText, { color: t.accent }]}>
                  {showAllCats ? 'Hide ⌃' : `Show more ⌄`}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {/* ── Saving this month ── */}
      {(() => {
        const activeForMonth = savingGoals.filter((g: any) => {
          if (g.startMonth && g.startMonth > monthStr) return false;
          if (g.finishByMonth && g.finishByMonth < monthStr) return false;
          return true;
        });
        if (activeForMonth.length === 0) return null;
        // change each goal to home currency before adding them up
        const totalSavingThisMonth = activeForMonth.reduce((s: number, g: any) => {
          const alloc = ((g.monthlyAllocations ?? {})[monthStr]) ?? (g.perMonth ?? 0);
          return s + toHomeAmt(alloc, g);
        }, 0);
        return (
          <View style={[sumStyles.card, { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }]}>
            <View style={sumStyles.cardHeader}>
              <Text style={[sumStyles.sectionEyebrow, { color: t.muted }]}>SAVING THIS MONTH</Text>
              <Text style={[sumStyles.goalContrib, { color: t.text }]}>
                {`${homeCurrency} ${formatMoney(totalSavingThisMonth, homeCurrency)}`}
              </Text>
            </View>
            {activeForMonth.map((g: any, i: number) => {
              const gc = g.currency ?? homeCurrency;
              const alloc = ((g.monthlyAllocations ?? {})[monthStr]) ?? (g.perMonth ?? 0);
              const isForeign = gc !== homeCurrency;
              return (
                <View key={g.id}>
                  {i > 0 && <View style={[sumStyles.hr, { backgroundColor: t.border }]} />}
                  <View style={[sumStyles.limitRow, { paddingVertical: 6 }]}>
                    <Text style={[sumStyles.limitName, { color: t.muted }]} numberOfLines={1}>{g.name}</Text>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[sumStyles.goalContrib, { color: t.text }]}>{`${gc} ${formatMoney(alloc, gc)}`}</Text>
                      {isForeign && (
                        <Text style={[sumStyles.goalContrib, { color: t.muted, fontSize: 11, fontWeight: '400' }]}>
                          {`≈ ${homeCurrency} ${formatMoney(toHomeAmt(alloc, g), homeCurrency)}`}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
            <View style={[sumStyles.hr, { backgroundColor: t.border }]} />
            <Pressable style={sumStyles.tabLink} onPress={() => setSubTab('saving')}>
              <Text style={[sumStyles.tabLinkText, { color: t.accent }]}>Manage allocations ›</Text>
            </Pressable>
          </View>
        );
      })()}


      <View style={{ height: Spacing.six }} />
    </ScrollView>
  );
}

// SavingTab

type SavingGoalRow = {
  id: string; name: string; perMonth: number;
  monthlyAllocations: Record<string, number>;
  monthlyRates: Record<string, number>;
  startMonth: string | null; finishByMonth: string | null;
  saved?: number; target?: number; targetMonth?: string;
  currency: string;
};

function normalizeSavingGoalRow(g: any, fallbackCurrency: string): SavingGoalRow {
  return {
    id: g.id, name: g.name ?? '', perMonth: g.perMonth ?? 0,
    monthlyAllocations: g.monthlyAllocations ?? {},
    monthlyRates: g.monthlyRates ?? {},
    startMonth: g.startMonth ?? null,
    finishByMonth: g.finishByMonth ?? null,
    saved: g.savedAmount ?? g.saved ?? 0,
    target: g.targetAmount ?? g.target ?? 0,
    targetMonth: g.targetMonth ?? g.finishByMonth,
    currency: g.currency ?? fallbackCurrency,
  };
}

function goalMonthAmountSav(goal: SavingGoalRow, monthStr: string): number {
  return goal.monthlyAllocations[monthStr] ?? goal.perMonth;
}

/** Active for the viewed month: started by then and hasn't ended before then. */
function isActiveForMonthSav(goal: SavingGoalRow, monthStr: string): boolean {
  if (goal.startMonth && goal.startMonth > monthStr) return false;
  if (goal.finishByMonth && goal.finishByMonth < monthStr) return false;
  return true;
}

function SavingTab({ year, month, homeCurrency, navigation }: {
  year: number; month: number; homeCurrency: string; navigation: any;
}) {
  const t = useTheme();
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const [goals, setGoals] = useState<SavingGoalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rawAmounts, setRawAmounts] = useState<Record<string, string>>({});
  const [activeNumpad, setActiveNumpad] = useState<string | null>(null);
  // rate to home for each goal, by goal id
  const [rates, setRates] = useState<Record<string, number | null>>({});
  // goals with a manual rate set for this month (don't auto-overwrite them)
  const [manualRates, setManualRates] = useState<Record<string, boolean>>({});
  const [rateSheetOpen, setRateSheetOpen] = useState(false);
  const numpadInputRef = useRef<TextInput | null>(null);
  const numpadRawCursorRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (getSavingGoals as () => Promise<any[]>)().then((gs) => {
      if (cancelled) return;
      const normalized = gs.map((g) => normalizeSavingGoalRow(g, homeCurrency));
      setGoals(normalized);
      const init: Record<string, string> = {};
      const initRates: Record<string, number | null> = {};
      const initManual: Record<string, boolean> = {};
      normalized.forEach((g) => {
        if (isActiveForMonthSav(g, monthStr)) {
          const a = goalMonthAmountSav(g, monthStr);
          init[g.id] = amountToRaw(a, g.currency);
          if (g.currency === homeCurrency) {
            initRates[g.id] = 1;
          } else if (g.monthlyRates[monthStr] != null) {
            initRates[g.id] = g.monthlyRates[monthStr]; // saved manual rate
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
  }, [monthStr]);

  const activeGoals = goals.filter((g) => isActiveForMonthSav(g, monthStr));

  // fetch this month's rate for foreign goals that don't have one yet
  useEffect(() => {
    let cancelled = false;
    activeGoals.forEach((g) => {
      if (g.currency === homeCurrency) return;
      if (manualRates[g.id]) return;
      if (rates[g.id] != null) return;
      getExchangeRate(g.currency, homeCurrency, monthRateDate(monthStr)).then((r) => {
        if (!cancelled && r != null) setRates((prev) => ({ ...prev, [g.id]: r }));
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGoals.map((g) => g.id).join(','), homeCurrency, monthStr, manualRates]);

  // save a manual rate for this goal and month
  function applyManualRate(goalId: string, r: number) {
    setRates((prev) => ({ ...prev, [goalId]: r }));
    setManualRates((prev) => ({ ...prev, [goalId]: true }));
    recordMonthlyRate(goalId, monthStr, r);
  }

  // change a goal amount into home currency
  function toHomeAmt(amount: number, goal: SavingGoalRow): number {
    if (goal.currency === homeCurrency) return amount;
    const rate = rates[goal.id];
    return rate != null ? amount * rate : amount;
  }

  const totalAllocation = activeGoals.reduce((s, g) => {
    const raw = rawAmounts[g.id] ?? '';
    const nativeAmt = raw ? rawToAmount(raw, g.currency) : goalMonthAmountSav(g, monthStr);
    return s + toHomeAmt(nativeAmt, g);
  }, 0);

  const activeGoalCurrency = activeNumpad
    ? (activeGoals.find((g) => g.id === activeNumpad)?.currency ?? homeCurrency)
    : homeCurrency;

  async function confirmAndClose() {
    const goalId = activeNumpad;
    if (!goalId) return;
    setActiveNumpad(null);
    const raw = rawAmounts[goalId] ?? '';
    const goal = activeGoals.find((g) => g.id === goalId);
    const amount = rawToAmount(raw, goal?.currency ?? homeCurrency);
    try {
      await (recordMonthlyAllocation as (id: string, m: string, a: number) => Promise<void>)(goalId, monthStr, amount);
      setGoals((prev) => prev.map((g) =>
        g.id === goalId ? { ...g, monthlyAllocations: { ...g.monthlyAllocations, [monthStr]: amount } } : g,
      ));
    } catch { /* silent */ }
  }

  function openNumpad(goalId: string) {
    const raw = rawAmounts[goalId] ?? '';
    numpadRawCursorRef.current = raw.length;
    setActiveNumpad(goalId);
    const gc = activeGoals.find((g) => g.id === goalId)?.currency ?? homeCurrency;
    const display = formatAmountDisplay(raw, gc);
    requestAnimationFrame(() => {
      numpadInputRef.current?.setNativeProps({ selection: { start: display.length, end: display.length } });
    });
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={t.accent} /></View>;
  }

  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, m] = monthStr.split('-');
  const monthLabel = `${MONTH_SHORT[parseInt(m, 10) - 1]} ${y}`;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: t.bg }}
        contentContainerStyle={{ paddingHorizontal: H_PAD, paddingTop: 16, paddingBottom: 100, gap: 14 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Auto-total — read-only */}
        <View style={[savStyles.heroCard, { backgroundColor: t.accentSoft }]}>
          <Text style={[savStyles.heroEyebrow, { color: t.accentInk }]}>SAVING GOAL THIS MONTH</Text>
          <Text style={[savStyles.heroAmount, { color: t.accentInk }]}>
            {`${homeCurrency} ${formatMoney(totalAllocation, homeCurrency)}`}
          </Text>
          <Text style={[savStyles.heroSub, { color: t.accentInk, opacity: 0.7 }]}>
            Auto-total from goals below
          </Text>
        </View>

        {/* Goal rows */}
        {activeGoals.length > 0 && (
          <Text style={[savStyles.goalsHint, { color: t.muted }]}>
            Tap a goal to change the amount for this month.
          </Text>
        )}
        {activeGoals.length === 0 ? (
          <View style={[savStyles.emptyCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[savStyles.emptyText, { color: t.muted }]}>
              No saving goals active in {monthLabel}.
            </Text>
            <Pressable onPress={() => navigation.navigate('ManageSavings')}>
              <Text style={[savStyles.emptyLink, { color: t.accent }]}>Manage goals ›</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[savStyles.goalList, { backgroundColor: t.surface, borderColor: t.border }]}>
            {activeGoals.map((goal, idx) => {
              const raw = rawAmounts[goal.id] ?? '';
              const gc = goal.currency;
              const currentAmount = raw ? rawToAmount(raw, gc) : goalMonthAmountSav(goal, monthStr);
              const deficit = goal.perMonth > 0 ? goal.perMonth - currentAmount : 0;
              const isForeign = gc !== homeCurrency;
              const homeEquiv = isForeign ? toHomeAmt(currentAmount, goal) : null;
              const isOpen = activeNumpad === goal.id;
              return (
                <View key={goal.id}>
                  {idx > 0 && <View style={[savStyles.divider, { backgroundColor: t.border }]} />}
                  <Pressable
                    style={savStyles.goalRow}
                    onPress={() => { if (isOpen) confirmAndClose(); else openNumpad(goal.id); }}
                  >
                    <View style={savStyles.goalLeft}>
                      <Text style={[savStyles.goalName, { color: t.text }]} numberOfLines={1}>
                        {goal.name}
                        {isForeign && (
                          <Text style={[savStyles.goalCurrencyTag, { color: t.accent }]}>{` · ${gc}`}</Text>
                        )}
                      </Text>
                      {deficit > 0.005 && (
                        <Text style={[savStyles.behindNote, { color: t.danger }]}>
                          {`You're ${gc} ${formatMoney(deficit, gc)} behind your ${gc} ${formatMoney(goal.perMonth, gc)}/mo goal`}
                        </Text>
                      )}
                    </View>
                    <View style={savStyles.goalAmountCol}>
                      <Text style={[savStyles.goalAmount, { color: isOpen ? t.accent : t.text }]}>
                        {raw ? `${gc} ${formatAmountDisplay(raw, gc)}` : '—'}
                      </Text>
                      {isForeign && homeEquiv !== null && currentAmount > 0 && (
                        <Text style={[savStyles.goalConversion, { color: t.muted }]}>
                          {`≈ ${homeCurrency} ${formatMoney(homeEquiv, homeCurrency)}`}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        {/* Link to full saving goals management */}
        <Pressable style={savStyles.goalsLink} onPress={() => navigation.navigate('ManageSavings')}>
          <Text style={[savStyles.goalsLinkText, { color: t.muted }]}>Manage saving goals ›</Text>
        </Pressable>
      </ScrollView>

      {/* Inline numpad via modal so it overlays the tab bar */}
      {activeNumpad !== null && (
        <Modal transparent animationType="slide" onRequestClose={confirmAndClose}>
          <Pressable style={savStyles.sheetScrim} onPress={confirmAndClose} />
          <View style={[savStyles.numpadSheet, { backgroundColor: t.surface }]}>
            <View style={[savStyles.sheetHandle, { backgroundColor: t.track }]} />
            <View style={savStyles.numpadHeader}>
              <Text style={[savStyles.numpadGoalName, { color: t.muted }]}>
                {activeGoals.find((g) => g.id === activeNumpad)?.name ?? ''}
              </Text>
              <View style={savStyles.numpadAmountRow}>
                <Text style={[savStyles.numpadCurrency, { color: t.muted }]}>{activeGoalCurrency}</Text>
                <TextInput
                  ref={numpadInputRef}
                  style={[savStyles.numpadAmount, { color: t.text }]}
                  value={formatAmountDisplay(rawAmounts[activeNumpad] ?? '', activeGoalCurrency)}
                  showSoftInputOnFocus={false}
                  caretHidden
                  editable
                  onSelectionChange={({ nativeEvent: { selection } }) => {
                    const raw = rawAmounts[activeNumpad] ?? '';
                    const display = formatAmountDisplay(raw, activeGoalCurrency);
                    numpadRawCursorRef.current = displayCursorToRawCursor(display, selection.start);
                  }}
                />
              </View>
            </View>

            {/* Exchange-rate footer — shown for non-home goals, like the expense input */}
            {activeGoalCurrency !== homeCurrency && (() => {
              const gc = activeGoalCurrency;
              const goal = activeGoals.find((g) => g.id === activeNumpad);
              const rate = goal ? rates[goal.id] : null; // 1 gc = N home
              const unitToHome = rate != null ? rate : null;
              const curAmt = rawToAmount(rawAmounts[activeNumpad ?? ''] ?? '', gc);
              const homeEquiv = goal ? toHomeAmt(curAmt, goal) : curAmt;
              return (
                <Pressable
                  style={[savStyles.rateRow, { borderColor: t.border, backgroundColor: t.bg }]}
                  onPress={() => setRateSheetOpen(true)}
                >
                  <Feather name="refresh-cw" size={13} color={t.muted} />
                  <View style={savStyles.rateRowLines}>
                    <Text style={[savStyles.rateRowLabel, { color: t.muted }]}>
                      {'1 '}{gc}{' = '}
                      <Text style={[savStyles.rateRowValue, { color: t.text }]}>{unitToHome ?? '…'}</Text>
                      {' '}{homeCurrency}
                    </Text>
                    <Text style={[savStyles.rateRowLabel, { color: t.muted }]}>
                      {formatMoney(curAmt, gc)}{' '}{gc}{' = '}
                      <Text style={[savStyles.rateRowValue, { color: t.text }]}>
                        {rate ? formatMoney(homeEquiv, homeCurrency) : '…'}
                      </Text>
                      {' '}{homeCurrency}
                    </Text>
                  </View>
                  <Text style={[savStyles.rateRowAdjust, { color: t.accent }]}>adjust ›</Text>
                </Pressable>
              );
            })()}

            <NumericKeypad
              onKey={(key) => {
                if (!activeNumpad) return;
                setRawAmounts((prev) => {
                  const prevRaw = prev[activeNumpad] ?? '';
                  const { newRaw, newCursor } = applyNumpadKeyAtCursor(prevRaw, key, numpadRawCursorRef.current, activeGoalCurrency);
                  numpadRawCursorRef.current = newCursor;
                  const newDisplay = formatAmountDisplay(newRaw, activeGoalCurrency);
                  const dCursor = rawCursorToDisplayCursor(newDisplay, newCursor);
                  requestAnimationFrame(() => {
                    numpadInputRef.current?.setNativeProps({ selection: { start: dCursor, end: dCursor } });
                  });
                  return { ...prev, [activeNumpad]: newRaw };
                });
              }}
            />
            <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: H_PAD, paddingTop: 12, paddingBottom: 10 }}>
              <Pressable
                style={[savStyles.numpadSaveBtn, { backgroundColor: t.accent }]}
                onPress={confirmAndClose}
              >
                <Text style={[savStyles.numpadSaveBtnText, { color: t.onAccent }]}>Done</Text>
              </Pressable>
            </SafeAreaView>
          </View>

          {/* Rate adjust overlay — rendered inside the same Modal so it reliably
              appears on top of the numpad (stacking two RN Modals does not). */}
          {rateSheetOpen && activeGoalCurrency !== homeCurrency && (
            <SavingRateSheet
              fromCurrency={activeGoalCurrency}
              toCurrency={homeCurrency}
              rate={activeNumpad && rates[activeNumpad] != null ? (rates[activeNumpad] as number) : null}
              amount={rawToAmount(rawAmounts[activeNumpad ?? ''] ?? '', activeGoalCurrency)}
              t={t}
              onSave={(unitRate) => { if (activeNumpad) applyManualRate(activeNumpad, unitRate); }}
              onClose={() => setRateSheetOpen(false)}
            />
          )}
        </Modal>
      )}
    </View>
  );
}

// SavingRateSheet
// tap either row to set the rate or the total, both stay in sync

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

function SavingRateSheet({ onClose, fromCurrency, toCurrency, rate, amount, onSave, t }: {
  onClose: () => void;
  fromCurrency: string; toCurrency: string;
  rate: number | null; amount: number; onSave: (r: number) => void; t: any;
}) {
  const [draft, setDraft] = useState(rate !== null ? String(rate) : '');
  const [activeField, setActiveField] = useState<'unit' | 'total'>('unit');

  function switchTo(field: 'unit' | 'total') {
    if (field === activeField) return;
    const n = parseFloat(draft) || 0;
    if (field === 'total') {
      const total = amount > 0 ? Math.round(n * amount * 100) / 100 : 0;
      setDraft(total > 0 ? String(total) : '');
    } else {
      const unitRate = amount > 0 ? Math.round((n / amount) * 1e6) / 1e6 : 0;
      setDraft(unitRate > 0 ? String(unitRate) : '');
    }
    setActiveField(field);
  }

  function handleApply() {
    const n = parseFloat(draft);
    const resolvedRate = activeField === 'unit' ? n : (amount > 0 ? n / amount : 0);
    if (isNaN(resolvedRate) || resolvedRate <= 0) return;
    onSave(Math.round(resolvedRate * 1e6) / 1e6);
    onClose();
  }

  const draftNum = parseFloat(draft) || 0;
  const computedUnit = activeField === 'total' && amount > 0
    ? Math.round((draftNum / amount) * 1e6) / 1e6 : null;
  const computedTotal = activeField === 'unit' && amount > 0
    ? Math.round(draftNum * amount * 100) / 100 : null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={savStyles.sheetScrim} onPress={onClose} />
      <View style={[savStyles.numpadSheet, { backgroundColor: t.surface }]}>
        <View style={[savStyles.sheetHandle, { backgroundColor: t.track }]} />
        <View style={{ paddingHorizontal: 20, paddingBottom: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[savStyles.numpadGoalName, { color: t.text }]}>Adjust Rate</Text>
            <Pressable hitSlop={16} onPress={handleApply}>
              <Text style={{ color: t.accent, fontSize: 15, fontWeight: '600' }}>Done</Text>
            </Pressable>
          </View>

          {/* Unit rate row */}
          <Pressable
            style={[savStyles.rateEditRow, {
              borderColor: activeField === 'unit' ? t.accent : t.border, backgroundColor: t.bg,
            }]}
            onPress={() => switchTo('unit')}
          >
            <Text style={[savStyles.rateRowLabel, { color: t.muted }]}>1 {fromCurrency} =</Text>
            <Text style={[savStyles.rateEditValue, { color: activeField === 'unit' ? (draft ? t.text : t.muted) : t.muted }]}>
              {activeField === 'unit'
                ? (draft || '0.00')
                : (computedUnit != null && computedUnit > 0 ? String(computedUnit) : '—')}
            </Text>
            <Text style={[savStyles.rateRowLabel, { color: t.muted }]}>{toCurrency}</Text>
          </Pressable>

          {/* Converted total row */}
          {amount > 0 && (
            <Pressable
              style={[savStyles.rateEditRow, {
                borderColor: activeField === 'total' ? t.accent : t.border, backgroundColor: t.bg,
              }]}
              onPress={() => switchTo('total')}
            >
              <Text style={[savStyles.rateRowLabel, { color: t.muted }]}>
                {formatMoney(amount, fromCurrency)} {fromCurrency} =
              </Text>
              <Text style={[savStyles.rateEditValue, { color: activeField === 'total' ? (draft ? t.text : t.muted) : t.muted }]}>
                {activeField === 'total'
                  ? (draft || '0.00')
                  : (computedTotal != null && computedTotal > 0 ? formatMoney(computedTotal, toCurrency) : '—')}
              </Text>
              <Text style={[savStyles.rateRowLabel, { color: t.muted }]}>{toCurrency}</Text>
            </Pressable>
          )}
        </View>
        <NumericKeypad bottomLeftKey="." onKey={(key) => setDraft((d) => applyRateKey(d, key))} />
        <SafeAreaView edges={['bottom']} style={{ paddingHorizontal: H_PAD, paddingTop: 12, paddingBottom: 10 }}>
          <Pressable style={[savStyles.numpadSaveBtn, { backgroundColor: t.accent }]} onPress={handleApply}>
            <Text style={[savStyles.numpadSaveBtnText, { color: t.onAccent }]}>Apply Rate</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </View>
  );
}

const savStyles = StyleSheet.create({
  // Hero total card
  heroCard: { borderRadius: 18, padding: 20, gap: 4, alignItems: 'center' },
  heroEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  heroAmount: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5, fontVariant: ['tabular-nums'] as any },
  heroSub: { fontSize: 11 },
  // Empty state
  emptyCard: { borderRadius: 18, borderWidth: 1, padding: 20, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 13, textAlign: 'center' },
  emptyLink: { fontSize: 13, fontWeight: '600' },
  // Goal list
  goalsHint: { fontSize: 12, textAlign: 'center', marginTop: -4 },
  goalList: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  goalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  goalLeft: { flex: 1, gap: 3 },
  goalName: { fontSize: 14, fontWeight: '600' },
  goalCurrencyTag: { fontSize: 12, fontWeight: '500' },
  behindNote: { fontSize: 11, lineHeight: 15 },
  goalAmountCol: { alignItems: 'flex-end', gap: 2 },
  goalAmount: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] as any, textAlign: 'right' },
  goalConversion: { fontSize: 11, fontVariant: ['tabular-nums'] as any },
  // Numpad modal
  sheetScrim: { flex: 1, backgroundColor: 'transparent' },
  numpadSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 10 },
  sheetHandle: { width: 38, height: 4, borderRadius: 3, alignSelf: 'center', marginBottom: 10 },
  numpadHeader: { paddingHorizontal: 20, paddingBottom: 16, gap: 4 },
  numpadGoalName: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  numpadAmountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  numpadCurrency: { fontSize: 20, fontWeight: '700' },
  numpadAmount: { flexShrink: 1, fontSize: 36, fontWeight: '700', letterSpacing: -1, fontVariant: ['tabular-nums'] as any },
  numpadSaveBtn: { height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  numpadSaveBtnText: { fontSize: 14, fontWeight: '600' },
  rateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 20, marginBottom: 12,
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
  },
  rateRowLines: { flex: 1, gap: 2 },
  rateRowLabel: { fontSize: 12 },
  rateRowValue: { fontWeight: '700', fontVariant: ['tabular-nums'] as any },
  rateRowAdjust: { fontSize: 12, fontWeight: '600' },
  rateEditRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14,
  },
  rateEditValue: { flex: 1, fontSize: 18, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] as any },
  goalsLink: { alignItems: 'center', paddingVertical: 6 },
  goalsLinkText: { fontSize: 12, fontWeight: '500' },
});

// AllExpensesScreen

export default function AllExpensesScreen({ navigation }: any) {
  const t = useTheme();

  // month + sub-tab
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [subTab, setSubTab] = useState<SubTab>('daily');
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  // reset to Daily + this month only if already on this tab
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress', () => {
      if (!navigation.isFocused()) return;
      const today2 = new Date();
      setSubTab('daily');
      setYear(today2.getFullYear());
      setMonth(today2.getMonth() + 1);
      setSearchText('');
      setFilter(EMPTY_FILTER);
    });
    return unsubscribe;
  }, [navigation]);

  // search + filters
  const [searchText, setSearchText]   = useState('');
  const [filter, setFilter]           = useState<FilterState>(EMPTY_FILTER);
  const [showFilters, setShowFilters] = useState(false);

  // data
  const [expenses,     setExpenses]     = useState<Expense[]>([]);
  const [incomes,      setIncomes]      = useState<Income[]>([]);
  const [transfers,    setTransfers]    = useState<Transfer[]>([]);
  const [accounts,     setAccounts]     = useState<Account[]>([]);
  const [categories,   setCategories]   = useState<Category[]>([]);
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [loading,      setLoading]      = useState(true);
  const [budget,       setBudgetState]  = useState<Budget | null>(null);


  useFocusEffect(useCallback(() => {
    const mp = `${year}-${String(month).padStart(2, '0')}`;
    let cancelled = false;
    (getOrInheritBudget as (m: string) => Promise<Budget | null>)(mp).then((b) => {
      if (!cancelled) setBudgetState(b);
    });
    return () => { cancelled = true; };
  }, [year, month]));

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getExpenses()   as Promise<Expense[]>,
      getAccounts()   as Promise<Account[]>,
      getCategories() as Promise<Category[]>,
      getSettings()   as Promise<{ homeCurrency?: string }>,
      getIncomes()    as Promise<Income[]>,
      getTransfers()  as Promise<Transfer[]>,
    ]).then(([exps, accs, cats, settings, incs, trs]) => {
      if (!cancelled) {
        setExpenses([...exps].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')));
        setIncomes([...incs].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')));
        setTransfers([...trs].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')));
        setAccounts(accs);
        setCategories(cats);
        setHomeCurrency(settings.homeCurrency ?? 'SGD');
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []));

  // maps
  const accountMap  = useMemo(() => Object.fromEntries(accounts.map((a)  => [a.id, a])),        [accounts]);
  const categoryMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.name])),  [categories]);

  // Month-picker data: spend + count for all months
  const allSpendByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of expenses) {
      const key = e.date?.slice(0, 7);
      if (!key) continue;
      map[key] = (map[key] ?? 0) + (e.amountInHomeCurrency ?? e.amount);
    }
    return map;
  }, [expenses]);

  const expenseCountByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of expenses) {
      const key = e.date?.slice(0, 7);
      if (!key) continue;
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }, [expenses]);

  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  // all expenses in the selected month (for nav totals)
  const monthExpenses = useMemo(
    () => expenses.filter((e) => e.date?.startsWith(monthPrefix)),
    [expenses, monthPrefix],
  );

  // filtered: search + account/category
  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return monthExpenses.filter((e) => {
      if (q && !(e.merchant?.toLowerCase().includes(q) || e.notes?.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q))) return false;
      if (filter.accountIds.length > 0 && !filter.accountIds.includes(e.accountId)) return false;
      return true;
    });
  }, [monthExpenses, searchText, filter]);

  // incomes for selected month
  const monthIncomes = useMemo(
    () => incomes.filter((i) => i.date?.startsWith(monthPrefix)),
    [incomes, monthPrefix],
  );

  // transfers for selected month
  const monthTransfers = useMemo(
    () => transfers.filter((t) => t.date?.startsWith(monthPrefix)),
    [transfers, monthPrefix],
  );

  // Apply the same search + account filter to incomes and transfers as to
  // expenses, so the filter button narrows every row type (not just expenses).
  const filteredIncomes = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return monthIncomes.filter((i) => {
      if (q && !(i.source?.toLowerCase().includes(q) || i.notes?.toLowerCase().includes(q))) return false;
      if (filter.accountIds.length > 0 && !filter.accountIds.includes(i.accountId)) return false;
      return true;
    });
  }, [monthIncomes, searchText, filter]);

  const filteredTransfers = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return monthTransfers.filter((tr) => {
      if (q && !tr.notes?.toLowerCase().includes(q)) return false;
      if (filter.accountIds.length > 0
        && !filter.accountIds.includes(tr.fromAccountId)
        && !filter.accountIds.includes(tr.toAccountId)) return false;
      return true;
    });
  }, [monthTransfers, searchText, filter]);

  // totals strip values
  const monthIncome = useMemo(
    () => filteredIncomes.reduce((s, i) => s + (i.amountInHomeCurrency ?? i.amount), 0),
    [filteredIncomes],
  );
  const monthSpend = useMemo(
    () => filtered.reduce((s, e) => s + (e.amountInHomeCurrency ?? e.amount), 0),
    [filtered],
  );
  const monthNet = monthIncome - monthSpend;

  // day income map: date → total income for that day
  const dayIncomeMap = useMemo(() => {
    const map: Record<string, Income[]> = {};
    for (const i of filteredIncomes) {
      const d = i.date;
      if (!d) continue;
      if (!map[d]) map[d] = [];
      map[d].push(i);
    }
    return map;
  }, [filteredIncomes]);

  // day transfer map
  const dayTransferMap = useMemo(() => {
    const map: Record<string, Transfer[]> = {};
    for (const tr of filteredTransfers) {
      const d = tr.date;
      if (!d) continue;
      if (!map[d]) map[d] = [];
      map[d].push(tr);
    }
    return map;
  }, [filteredTransfers]);

  // group expenses by day for Daily sub-tab
  const grouped = useMemo(() => {
    const dayMap: Record<string, Expense[]> = {};
    for (const e of filtered) {
      const day = e.date ?? 'unknown';
      if (!dayMap[day]) dayMap[day] = [];
      dayMap[day].push(e);
    }
    for (const d of Object.keys(dayIncomeMap)) {
      if (!dayMap[d]) dayMap[d] = [];
    }
    for (const d of Object.keys(dayTransferMap)) {
      if (!dayMap[d]) dayMap[d] = [];
    }
    return Object.keys(dayMap).sort((a, b) => b.localeCompare(a)).map((date) => ({ date, expenses: dayMap[date] }));
  }, [filtered, dayIncomeMap, dayTransferMap]);

  const hasFilters = filter.accountIds.length > 0;
  const hasSearch  = searchText.length > 0;

  async function handleDeleteExpense(exp: Expense) {
    if (exp.accountId) {
      const reverseCode = exp.accountCurrencyAtEntry ?? exp.currency;
      const reverseAmount = exp.accountAmount ?? exp.amount;
      await (updateSubBalance as (id: string, code: string, delta: number) => Promise<void>)(
        exp.accountId, reverseCode, reverseAmount,
      );
    }
    await (deleteExpense as (id: string) => Promise<void>)(exp.id);
    const [exps, incs] = await Promise.all([
      getExpenses() as Promise<Expense[]>,
      getIncomes() as Promise<Income[]>,
    ]);
    setExpenses([...exps].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')));
    setIncomes([...incs].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')));
  }

  async function handleDeleteIncome(inc: Income) {
    if (inc.accountId) {
      // Income credited the account, so deleting it debits the same amount in
      // the account's own currency.
      const reverseCode = inc.accountCurrencyAtEntry ?? inc.currency;
      const reverseAmount = inc.accountAmount ?? inc.amount;
      await (updateSubBalance as (id: string, code: string, delta: number) => Promise<void>)(
        inc.accountId, reverseCode, -reverseAmount,
      );
    }
    await (deleteIncome as (id: string) => Promise<void>)(inc.id);
    const incs = await (getIncomes() as Promise<Income[]>);
    setIncomes([...incs].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')));
  }

  async function handleDeleteTransfer(tr: Transfer) {
    await (updateSubBalance as (id: string, code: string, delta: number) => Promise<void>)(
      tr.fromAccountId, tr.fromCurrency, tr.fromAmount,
    );
    await (updateSubBalance as (id: string, code: string, delta: number) => Promise<void>)(
      tr.toAccountId, tr.toCurrency, -tr.toAmount,
    );
    await (deleteTransfer as (id: string) => Promise<void>)(tr.id);
    const trs = await (getTransfers() as Promise<Transfer[]>);
    setTransfers([...trs].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')));
  }

  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else { setMonth((m) => m - 1); }
  }
  function nextMonth() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else { setMonth((m) => m + 1); }
  }

  if (loading) {
    return <View style={[styles.center, { backgroundColor: t.bg }]}><ActivityIndicator color={t.accent} /></View>;
  }

  // render
  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <SafeAreaView style={styles.flex} edges={['top']}>

        {/* ══ Header ══════════════════════════════════════════════ */}
        <View style={[styles.header, { backgroundColor: t.bg }]}>

          {/* Row 1: search + filter button */}
          <View style={styles.searchRow}>
            <View style={[styles.searchField, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Feather name="search" size={14} color={t.muted} />
              <TextInput
                style={[styles.searchInput, { color: t.text }]}
                placeholder="Search merchant or note"
                placeholderTextColor={t.muted}
                value={searchText}
                onChangeText={setSearchText}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>
            <Pressable
              style={[styles.filterBtn, { backgroundColor: hasFilters ? t.accent : t.accentSoft }]}
              onPress={() => setShowFilters(true)}
            >
              <Feather name="sliders" size={16} color={hasFilters ? t.onAccent : t.accentInk} />
            </Pressable>
          </View>

          {/* Row 2: month nav */}
          <View style={styles.monthNav}>
            <Pressable onPress={prevMonth} hitSlop={12} style={styles.monthArrow}>
              <Feather name="chevron-left" size={22} color={t.muted} />
            </Pressable>
            <Pressable onPress={() => setShowMonthPicker(true)} style={styles.monthLabelBtn}>
              <Text style={[styles.monthLabel, { color: t.text }]}>{fmtMonthLabel(year, month)}</Text>
              <Feather name="chevron-down" size={13} color={t.muted} />
            </Pressable>
            <Pressable onPress={nextMonth} hitSlop={12} style={styles.monthArrow}>
              <Feather name="chevron-right" size={22} color={t.text} />
            </Pressable>
          </View>

          {/* Row 3: sub-tab bar */}
          <View style={[styles.subTabBar, { borderBottomColor: t.border }]}>
            {SUB_TABS.map((tab) => {
              const active = subTab === tab.key;
              return (
                <Pressable key={tab.key} style={styles.subTabBtn} onPress={() => setSubTab(tab.key)}>
                  <Text style={[styles.subTabLabel, { color: active ? t.accent : t.muted }]}>
                    {tab.label}
                  </Text>
                  {active && <View style={[styles.subTabLine, { backgroundColor: t.accent }]} />}
                </Pressable>
              );
            })}
          </View>

          {/* Row 4: totals strip */}
          <View style={[styles.totalsStrip, { borderBottomColor: t.border }]}>
            <View style={styles.totalsCol}>
              <Text style={[styles.totalsLabel, { color: t.muted }]}>Income</Text>
              <Text style={[styles.totalsValue, { color: t.accent }]}>{formatMoneyWithCode(monthIncome, homeCurrency)}</Text>
            </View>
            <View style={[styles.totalsCol, styles.totalsMid, { borderLeftColor: t.border, borderRightColor: t.border }]}>
              <Text style={[styles.totalsLabel, { color: t.muted }]}>Expenses</Text>
              <Text style={[styles.totalsValue, { color: t.text }]}>{formatMoneyWithCode(monthSpend, homeCurrency)}</Text>
            </View>
            <View style={styles.totalsCol}>
              <Text style={[styles.totalsLabel, { color: t.muted }]}>Net</Text>
              <Text style={[styles.totalsValue, { color: monthNet < 0 ? t.danger : t.text }]}>
                {monthNet < 0 ? `−${formatMoneyWithCode(Math.abs(monthNet), homeCurrency)}` : formatMoneyWithCode(monthNet, homeCurrency)}
              </Text>
            </View>
          </View>
        </View>

        {/* ══ Content ══════════════════════════════════════════════ */}
        {subTab === 'daily' ? (
          grouped.length === 0 ? (
            <View style={styles.center}>
              <View style={[styles.emptyTile, { backgroundColor: t.surface, borderColor: t.border }]}>
                <Feather name="list" size={26} color={t.accent} />
              </View>
              <Text style={[styles.emptyTitle, { color: t.text }]}>
                {hasFilters || hasSearch ? 'No matches' : 'No transactions'}
              </Text>
              <Text style={[styles.emptyHint, { color: t.muted }]}>
                {hasFilters || hasSearch
                  ? 'Nothing matches these filters.'
                  : `No transactions recorded for ${fmtMonthLabel(year, month)}.`}
              </Text>
              {(hasFilters || hasSearch) && (
                <Pressable
                  style={[styles.clearBtn, { backgroundColor: t.accent }]}
                  onPress={() => { setFilter(EMPTY_FILTER); setSearchText(''); }}
                >
                  <Text style={[styles.clearBtnText, { color: t.onAccent }]}>Clear filters</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <ScrollView
              style={[styles.list, { backgroundColor: t.bg }]}
              contentContainerStyle={{ paddingBottom: 80 }}
              showsVerticalScrollIndicator={false}
            >
              {grouped.map((group, gi) => (
                <DayGroup
                  key={group.date}
                  date={group.date}
                  expenses={group.expenses}
                  dayIncomes={dayIncomeMap[group.date] ?? []}
                  dayTransfers={dayTransferMap[group.date] ?? []}
                  isFirst={gi === 0}
                  homeCurrency={homeCurrency}
                  categoryMap={categoryMap}
                  accountMap={accountMap}
                  onPressExpense={(exp) => navigation.navigate('AddEntry', { editExpense: exp })}
                  onDeleteExpense={handleDeleteExpense}
                  onPressIncome={(inc) => navigation.navigate('AddEntry', { editIncome: inc })}
                  onDeleteIncome={handleDeleteIncome}
                  onPressTransfer={(tr) => navigation.navigate('AddEntry', { editTransfer: tr })}
                  onDeleteTransfer={handleDeleteTransfer}
                  onPressDate={(date) => navigation.navigate('AddEntry', { prefillDate: date })}
                />
              ))}
            </ScrollView>
          )
        ) : subTab === 'calendar' ? (
          <CalendarTab
            year={year} month={month}
            expenses={filtered}
            incomes={filteredIncomes}
            homeCurrency={homeCurrency}
            navigation={navigation}
            budget={budget}
          />
        ) : subTab === 'monthly' ? (
          <MonthlyTab
            allExpenses={expenses}
            allIncomes={incomes}
            selectedYear={year} selectedMonth={month}
            homeCurrency={homeCurrency}
            setYear={setYear} setMonth={setMonth} setSubTab={setSubTab}
          />
        ) : subTab === 'summary' ? (
          <SummaryTab
            year={year} month={month}
            expenses={monthExpenses}
            incomes={monthIncomes}
            homeCurrency={homeCurrency}
            categories={categories}
            navigation={navigation}
            setSubTab={setSubTab}
          />
        ) : (
          <SavingTab year={year} month={month} homeCurrency={homeCurrency} navigation={navigation} />
        )}
      </SafeAreaView>

      {/* ══ FAB ════════════════════════════════════════════════════ */}
      <SafeAreaView style={styles.fabSafe} edges={['bottom']} pointerEvents="box-none">
        <Pressable
          style={[styles.fab, { backgroundColor: t.accent }]}
          onPress={() => navigation.navigate('AddEntry')}
        >
          <Feather name="plus" size={24} color={t.onAccent} />
        </Pressable>
      </SafeAreaView>

      {/* ══ Filter modal ════════════════════════════════════════════ */}
      <FilterModal
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        filter={filter}
        onChange={setFilter}
        accounts={accounts}
      />

      <MonthPickerSheet
        visible={showMonthPicker}
        onClose={() => setShowMonthPicker(false)}
        year={year}
        month={month}
        onSelect={(y, m) => { setYear(y); setMonth(m); }}
        spendByMonth={allSpendByMonth}
        countByMonth={expenseCountByMonth}
        countUnit="expense"
        currency={homeCurrency}
      />
    </View>
  );
}

// styles

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },

  // Header
  header: { gap: 10, paddingTop: 14 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: H_PAD,
  },
  searchField: {
    flex: 1, height: 34, flexDirection: 'row', alignItems: 'center',
    gap: 8, borderRadius: 11, borderWidth: 1, paddingHorizontal: 10,
  },
  searchInput: { flex: 1, fontSize: 13, padding: 0 },
  filterBtn: {
    width: 34, height: 34, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },

  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: H_PAD,
  },
  monthArrow: { padding: 4 },
  monthLabelBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  monthLabel: { fontSize: 16, fontWeight: '600' },

  subTabBar: { flexDirection: 'row', borderBottomWidth: 1, marginTop: 2 },
  subTabBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, position: 'relative' },
  subTabLabel: { fontSize: 13, fontWeight: '600' },
  subTabLine: { position: 'absolute', bottom: 0, left: '10%', right: '10%', height: 2, borderRadius: 1 },

  totalsStrip: {
    flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  totalsCol: { flex: 1, alignItems: 'center', gap: 3 },
  totalsMid: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
  totalsLabel: { fontSize: 11 },
  totalsValue: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },

  // Daily list
  list: { flex: 1 },

  // Day header
  dayHeader: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 24,
  },
  dayHeaderDate: { fontSize: 15, fontWeight: '700' },
  dayHeaderMon: { fontSize: 12, fontWeight: '500' },
  dayHeaderRight: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  dayHeaderIncome: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  dayHeaderTotal: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] as any },

  // Entry list
  dayEntries: { paddingHorizontal: 24, paddingTop: 2, paddingBottom: 4 },

  // Placeholder
  phCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  phTile: { width: 64, height: 64, borderRadius: Radii.emptyTile, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  phLabel: { fontSize: 12 },

  // Empty state
  emptyTile: { width: 64, height: 64, borderRadius: Radii.emptyTile, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyHint: { fontSize: 12, textAlign: 'center', maxWidth: 240, lineHeight: 21 },
  clearBtn: { marginTop: 8, paddingVertical: 14, paddingHorizontal: 24, borderRadius: Radii.button },
  clearBtnText: { fontSize: 13, fontWeight: '600' },

  // FAB
  fabSafe: { position: 'absolute', right: 0, bottom: 0, left: 0, pointerEvents: 'box-none' },
  fab: {
    position: 'absolute', right: 20, bottom: 20,
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: SHADOW_COLOR, shadowOpacity: 0.18,
    shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },

  // Filter modal
  modalRoot: { flex: 1 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalAction: { fontSize: 13, fontWeight: '500' },
  modalContent: { paddingHorizontal: 24, paddingTop: Spacing.four, paddingBottom: Spacing.six },
  modalSection: { marginBottom: 10 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radii.chip },
  fChipText: { fontSize: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth },
  toggleLabel: { fontSize: 13 },
  toggleTrack: { width: 38, height: 22, borderRadius: Radii.chip, justifyContent: 'center' },
  toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: WHITE, shadowColor: SHADOW_COLOR, shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
});

// Swipe-delete styles

// SummaryTab styles

const sumStyles = StyleSheet.create({
  content: { gap: 14, paddingHorizontal: H_PAD, paddingTop: 16, paddingBottom: 80 },

  donutRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  donutLeft: { alignItems: 'center', gap: 6 },
  spentCaption: { fontSize: 11, fontWeight: '500', fontVariant: ['tabular-nums'] as any },
  allowanceMini: { flex: 1, borderRadius: 16, padding: 12, gap: 6 },

  card: { borderRadius: 18, padding: 16, gap: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  cardLink: { fontSize: 12, fontWeight: '600' },
  sectionEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },

  allowanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  allowanceAmount: { fontSize: 22, fontWeight: '600', letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  allowanceDay: { fontSize: 12, fontWeight: '500' },
  allowanceNote: { fontSize: 10, lineHeight: 15 },
  noBudget: { fontSize: 11 },

  hr: { height: StyleSheet.hairlineWidth, marginVertical: 4 },

  monthSoFarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  monthSoFarLabel: { fontSize: 10 },
  monthSoFarValue: { fontSize: 10, fontVariant: ['tabular-nums'] },

  progressTrack: { height: 6, borderRadius: 3 },
  progressFill: { height: 6, borderRadius: 3 },


  catSwatch: { width: 8, height: 8, borderRadius: 4 },
  toggleCatsBtn: { paddingVertical: 8, alignItems: 'center' },
  toggleCatsText: { fontSize: 13, fontWeight: '600' },

  goalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  goalName: { fontSize: 13, fontWeight: '600' },
  goalMeta: { fontSize: 11, marginTop: 1 },
  goalContrib: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  tabLink: { alignItems: 'center', paddingVertical: 10 },
  tabLinkText: { fontSize: 12, fontWeight: '600' },
  goalProgress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalProgressText: { fontSize: 12, fontVariant: ['tabular-nums'] },
  goalPct: { fontSize: 12 },

  limitRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 8 },
  limitName: { flex: 1, fontSize: 12 },
  limitRight: { flex: 1, gap: 4, alignItems: 'flex-end' },
  limitValues: { fontSize: 11, fontVariant: ['tabular-nums'] },
  limitTrack: { width: '100%', height: 5, borderRadius: 3 },
  limitFill: { height: 5, borderRadius: 3 },
  noLimit: { fontSize: 11 },
});

// CalendarTab styles

const calStyles = StyleSheet.create({
  weekRow: {
    flexDirection: 'row', paddingHorizontal: CAL_H_PAD, marginBottom: CELL_GAP,
  },
  weekCell: { alignItems: 'center' },
  weekLabel: { fontSize: 10, fontWeight: '600' },
  gridRow: { flexDirection: 'row', gap: CELL_GAP },
  cell: {
    height: 58, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  cellDay: { fontSize: 10, fontWeight: '600' },
  cellTotal: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  cellDash: { fontSize: 11 },
  cellIncome: { fontSize: 9, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  legendSwatch: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 11 },
  legendPlus: { fontSize: 13, fontWeight: '700', marginLeft: 10 },
  dayBand: {
    marginTop: 16, borderRadius: 16, borderWidth: 1,
    paddingVertical: 14, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center',
  },
  bandDate: { fontSize: 14, fontWeight: '600' },
  bandMeta: { fontSize: 12, marginTop: 2 },
  bandAmount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  bandOver: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'], marginTop: 1 },
  addDayBtn: {
    marginHorizontal: CAL_H_PAD, marginTop: 8, marginBottom: 10,
    height: 50, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  addDayBtnText: { fontSize: 15, fontWeight: '600' },
});

// MonthlyTab styles (year view)

const moStyles = StyleSheet.create({
  yearNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 24, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  yearLabel: { fontSize: 18, fontWeight: '700', minWidth: 50, textAlign: 'center' },

  colHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: H_PAD, paddingVertical: 8,
    borderBottomWidth: 1,
  },
  colHdr: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 5, paddingHorizontal: H_PAD,
  },
  monthName: { fontSize: 14 },
  colVal: { fontSize: 12, fontVariant: ['tabular-nums'] as any, textAlign: 'right' },
  colValBold: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] as any, textAlign: 'right' },

  ytdRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: H_PAD,
    borderTopWidth: 1, marginTop: 4,
  },
  ytdLabel: { fontSize: 13, fontWeight: '600' },
});
