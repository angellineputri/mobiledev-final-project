import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../hooks/use-theme';
import { Radii, SHADOW_COLOR, ScreenPadding, Spacing } from '../constants/theme';
import { accountAmountDisplay, formatMoneyWithCode } from '../logic/moneyFormatter';
import {
  getAccounts,
  getSplitBills,
  getSettings,
  settleSplitEntry,
  updateSubBalance,
} from '../storage/storage';
import { calculateSettlementBalanceEffect } from '../logic/businessLogic';
import MonthPickerSheet from '../components/MonthPickerSheet';

// types

type SplitEntry = {
  person: string;
  share: number;
  settled: boolean;
  settledAt: string | null;
};
type SplitBill = {
  id: string;
  merchant: string;
  total: number;
  currency: string;
  date: string;
  paidBy: 'me' | 'other';
  paidByName: string | null;
  splitType: 'equal' | 'custom' | 'items';
  myShare: number;
  entries: SplitEntry[];
  linkedExpenseId: string | null;
  categoryId: string | null;
  accountId: string;
  notes: string | null;
  createdAt: string;
  groupMembers?: Array<{ name: string; share: number }>;
  liveRate?: number;
  entryToAccountRate?: number;
};
type CurrencyBalance = { code: string; balance: number };
type Account = { id: string; name: string; primaryCode: string; currencies: CurrencyBalance[] };

// helpers

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
}

function monthPrefix(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function billIsOpen(bill: SplitBill) {
  return bill.entries.some((e) => !e.settled);
}

function billIsSettled(bill: SplitBill) {
  return bill.entries.length > 0 && bill.entries.every((e) => e.settled);
}

// how much people owe me on a bill (i paid)
function owedFromBill(bill: SplitBill): number {
  if (bill.paidBy !== 'me') return 0;
  return bill.entries.filter((e) => !e.settled).reduce((s, e) => s + e.share, 0);
}

// how much i owe on a bill (someone else paid)
function iOweOnBill(bill: SplitBill): number {
  if (bill.paidBy !== 'other') return 0;
  if (billIsSettled(bill)) return 0;
  return bill.myShare;
}

// change a bill amount into home currency
function toHome(amount: number, bill: SplitBill): number {
  const rate = bill.liveRate ?? 1;
  return Math.round(amount * rate * 100) / 100;
}

// show the bill total in the paying account's own currency
function billInAccountCurrency(
  bill: SplitBill,
  accountCurrency: string,
  homeCurrency: string,
): { currency: string; amount: number } {
  if (bill.currency === accountCurrency) return { currency: accountCurrency, amount: bill.total };
  if (bill.entryToAccountRate != null) {
    return { currency: accountCurrency, amount: Math.round(bill.total * bill.entryToAccountRate * 100) / 100 };
  }
  // no saved rate: only works if the account is home currency
  if (accountCurrency === homeCurrency) return { currency: accountCurrency, amount: toHome(bill.total, bill) };
  return { currency: bill.currency, amount: bill.total };
}

// true when the bill is not in home currency
function isForeign(bill: SplitBill, homeCurrency: string): boolean {
  return bill.currency !== homeCurrency;
}

function splitTypeLabel(t: 'equal' | 'custom' | 'items') {
  if (t === 'equal') return 'equal';
  if (t === 'custom') return 'custom';
  return 'by items';
}

function dayWeekday(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDate();
  const weekday = d.toLocaleDateString('en-SG', { weekday: 'short' }).toUpperCase();
  return { day, weekday };
}

// SplitScreen

export default function SplitScreen({ navigation }: any) {
  const t = useTheme();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [bills, setBills] = useState<SplitBill[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [settling, setSettling] = useState<string | null>(null);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        getSplitBills() as Promise<SplitBill[]>,
        getAccounts() as Promise<Account[]>,
        getSettings() as Promise<{ homeCurrency?: string }>,
      ]).then(([b, a, s]) => {
        setBills(b);
        setAccounts(a);
        setHomeCurrency(s.homeCurrency ?? 'SGD');
      });
    }, []),
  );

  // totals and counts per month for the month picker
  const billSpendByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of bills) {
      const key = b.date?.slice(0, 7);
      if (!key) continue;
      map[key] = (map[key] ?? 0) + b.total;
    }
    return map;
  }, [bills]);

  const billCountByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of bills) {
      const key = b.date?.slice(0, 7);
      if (!key) continue;
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }, [bills]);

  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  }

  const prefix = monthPrefix(year, month);
  const prevPrefix = monthPrefix(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);

  // bills in this month, newest first
  const monthBills = bills
    .filter((b) => b.date.startsWith(prefix))
    .sort((a, b) => b.date.localeCompare(a.date));
  // only open bills go in the list
  const openMonthBills = monthBills.filter(billIsOpen);
  // open bills from older months
  const carriedBills = bills.filter(
    (b) => !b.date.startsWith(prefix) && b.date < prefix && billIsOpen(b),
  );

  // totals across all months, in home currency
  const allOwedTotal = bills.reduce((s, b) => s + toHome(owedFromBill(b), b), 0);
  const allOweTotal = bills.reduce((s, b) => s + toHome(iOweOnBill(b), b), 0);
  const allOwedPeople = new Set(
    bills
      .filter((b) => b.paidBy === 'me' && billIsOpen(b))
      .flatMap((b) => b.entries.filter((e) => !e.settled).map((e) => e.person)),
  );
  const allOwePeople = new Set(
    bills
      .filter((b) => b.paidBy === 'other' && billIsOpen(b))
      .map((b) => b.paidByName ?? 'Someone'),
  );

  // this month's totals for the overview bar, in home currency
  const monthOwedTotal = monthBills.reduce((s, b) => s + toHome(owedFromBill(b), b), 0);
  const monthOweTotal = monthBills.reduce((s, b) => s + toHome(iOweOnBill(b), b), 0);
  const openCount = monthBills.filter(billIsOpen).length;
  const net = monthOwedTotal - monthOweTotal;
  const allSettled = openCount === 0 && monthBills.length > 0;

  const monthTotal = monthBills.reduce((s, b) => s + toHome(b.total, b), 0);

  async function handleSettle(bill: SplitBill, personName: string) {
    const key = `${bill.id}-${personName}`;
    if (settling === key) return;
    setSettling(key);
    try {
      await settleSplitEntry(bill.id, personName);
      const delta = calculateSettlementBalanceEffect(bill, personName);
      const account = accounts.find((a) => a.id === bill.accountId);
      if (account && delta !== 0) {
        await updateSubBalance(bill.accountId, account.primaryCode, delta);
      }
      const [freshBills, freshAccts] = await Promise.all([
        getSplitBills() as Promise<SplitBill[]>,
        getAccounts() as Promise<Account[]>,
      ]);
      setBills(freshBills);
      setAccounts(freshAccts);
    } catch {
      Alert.alert('Error', 'Could not settle this entry. Please try again.');
    } finally {
      setSettling(null);
    }
  }

  // empty state

  if (bills.length === 0) {
    return (
      <View style={[styles.root, { backgroundColor: t.bg }]}>
        <SafeAreaView style={styles.flex} edges={['top']}>
          <View style={[styles.titleRow, { borderBottomColor: t.border }]}>
            <Text style={[styles.title, { color: t.text }]}>Split</Text>
          </View>
          <View style={styles.emptyCenter}>
            <View style={[styles.emptyTile, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Feather name="users" size={26} color={t.accent} />
            </View>
            <Text style={[styles.emptyTitle, { color: t.text }]}>No split bills yet</Text>
            <Text style={[styles.emptyHint, { color: t.muted }]}>
              Tap + to record a shared expense
            </Text>
          </View>
          <MonthPickerSheet
            visible={showMonthPicker}
            onClose={() => setShowMonthPicker(false)}
            year={year}
            month={month}
            onSelect={(y, m) => { setYear(y); setMonth(m); }}
            spendByMonth={billSpendByMonth}
            countByMonth={billCountByMonth}
            countUnit="bill"
            currency={homeCurrency}
          />
        </SafeAreaView>
        <View style={styles.fabSafe} pointerEvents="box-none">
          <Pressable style={[styles.fab, { backgroundColor: t.accent }]} onPress={() => navigation.navigate('AddSplit')}>
            <Feather name="plus" size={22} color={t.onAccent} />
          </Pressable>
        </View>
      </View>
    );
  }

  // render

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
    <SafeAreaView style={styles.flex} edges={['top']}>
      {/* ── Title row ── */}
      <View style={[styles.titleRow, { borderBottomColor: t.border }]}>
        <Text style={[styles.title, { color: t.text }]}>Split</Text>
      </View>

      {/* ── Running totals (above month nav — not scoped to month) ── */}
      <View style={styles.totalsRowOuter}>
        <Pressable
          style={[styles.totalCard, { backgroundColor: t.surface, borderColor: t.border }]}
          onPress={() => navigation.navigate('YoureOwed', {
            bills: bills.filter((b) => b.paidBy === 'me'),
            currentMonthPrefix: prefix,
          })}
        >
          <Text style={[styles.totalCardEyebrow, { color: t.muted }]}>YOU'RE OWED · TOTAL</Text>
          <Text style={[styles.totalCardAmount, { color: t.accent }]}>
            {formatMoneyWithCode(allOwedTotal, homeCurrency)}
          </Text>
          <Text style={[styles.totalCardSub, { color: t.muted }]}>
            {allOwedPeople.size} {allOwedPeople.size === 1 ? 'person' : 'people'} {'>'}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.totalCard, { backgroundColor: t.surface, borderColor: t.border }]}
          onPress={() => navigation.navigate('YouOwe', {
            bills: bills.filter((b) => b.paidBy === 'other'),
            currentMonthPrefix: prefix,
          })}
        >
          <Text style={[styles.totalCardEyebrow, { color: t.muted }]}>YOU OWE · TOTAL</Text>
          <Text style={[styles.totalCardAmount, { color: allOweTotal > 0 ? t.danger : t.muted }]}>
            {formatMoneyWithCode(allOweTotal, homeCurrency)}
          </Text>
          <Text style={[styles.totalCardSub, { color: t.muted }]}>
            {allOwePeople.size} {allOwePeople.size === 1 ? 'person' : 'people'} {'>'}
          </Text>
        </Pressable>
      </View>

      {/* ── Month nav ── */}
      <View style={[styles.monthNavRow, { borderBottomColor: t.border }]}>
        <Pressable hitSlop={12} onPress={prevMonth} style={styles.navArrow}>
          <Feather name="chevron-left" size={20} color={t.muted} />
        </Pressable>
        <Pressable onPress={() => setShowMonthPicker(true)} style={styles.monthTitleBtn}>
          <Text style={[styles.monthText, { color: t.text }]}>{monthLabel(year, month)}</Text>
          <Feather name="chevron-down" size={14} color={t.muted} />
        </Pressable>
        <Pressable hitSlop={12} onPress={nextMonth} style={styles.navArrow}>
          <Feather name="chevron-right" size={20} color={t.text} />
        </Pressable>
      </View>

      {/* ── Overview bar ── */}
      <View style={[styles.overviewBar, { borderBottomColor: t.border }]}>
        <View style={[styles.overviewDot, { backgroundColor: allSettled || monthBills.length === 0 ? t.muted : t.accent }]} />
        <Text style={[styles.overviewText, { color: t.muted }]}>
          {monthBills.length === 0
            ? 'No bills this month'
            : allSettled
            ? 'All bills settled'
            : `${openCount} of ${monthBills.length} bill${monthBills.length !== 1 ? 's' : ''} still open · net ${net >= 0 ? '+ ' : '− '}${formatMoneyWithCode(Math.abs(net), homeCurrency)} ${net >= 0 ? 'your way' : 'against you'}`}
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 80 }]}
      >
        {/* ── Carried in from previous month ── */}
        {carriedBills.length > 0 && (
          <View style={[styles.carriedCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.carriedLeft}>
              <Feather name="clock" size={14} color={t.muted} />
              <View>
                <Text style={[styles.carriedTitle, { color: t.text }]}>
                  Carried in from {monthLabel(
                    prevPrefix.slice(0, 4) as unknown as number,
                    parseInt(prevPrefix.slice(5, 7), 10),
                  )}
                </Text>
                <Text style={[styles.carriedSub, { color: t.muted }]}>
                  {carriedBills.length} open {carriedBills.length === 1 ? 'bill' : 'bills'}
                </Text>
              </View>
            </View>
            <Text style={[styles.carriedAmount, { color: t.accent }]}>
              {formatMoneyWithCode(
                carriedBills.reduce((s, b) => s + toHome(owedFromBill(b) + iOweOnBill(b), b), 0),
                homeCurrency,
              )}
            </Text>
          </View>
        )}

        {/* ── Bills this month ── */}
        {monthBills.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: t.muted }]}>BILLS THIS MONTH</Text>
              <Text style={[styles.sectionMeta, { color: t.muted }]}>
                {openMonthBills.length} open · {formatMoneyWithCode(monthTotal, homeCurrency)}
              </Text>
            </View>

            <View style={[styles.billsList, { backgroundColor: t.surface, borderColor: t.border }]}>
              {openMonthBills.map((bill, idx) => {
                const isSettled = billIsSettled(bill);
                const isOwed = bill.paidBy === 'me';
                const owed = owedFromBill(bill);
                const owe = iOweOnBill(bill);
                const { day, weekday } = dayWeekday(bill.date);
                const peopleCount = bill.paidBy === 'me'
                  ? bill.entries.length + 1
                  : 2 + (bill.groupMembers?.length ?? 0);
                const paidByLabel = isOwed ? 'by me' : `by ${bill.paidByName ?? 'other'}`;

                const accountCurrency = accounts.find((a) => a.id === bill.accountId)?.primaryCode ?? homeCurrency;
                const big = billInAccountCurrency(bill, accountCurrency, homeCurrency);
                const { big: bigDisplay, footers: bigFooters } = accountAmountDisplay({
                  accountCurrency: big.currency, accountAmount: big.amount,
                  txCurrency: bill.currency, txAmount: bill.total,
                  homeCurrency, homeAmount: toHome(bill.total, bill),
                });

                return (
                  <View key={bill.id}>
                    {idx > 0 && <View style={[styles.hr, { backgroundColor: t.border }]} />}
                    <Pressable
                      style={[styles.billRow, isSettled && styles.dimmed]}
                      onPress={() => navigation.navigate('SplitDetail', { bill })}
                    >
                      {/* Day stack */}
                      <View style={styles.dayStack}>
                        <Text style={[styles.dayNum, { color: t.text }]}>{day}</Text>
                        <Text style={[styles.dayWd, { color: t.muted }]}>{weekday.slice(0, 3)}</Text>
                      </View>

                      {/* Middle */}
                      <View style={styles.billMiddle}>
                        <Text style={[styles.billMerchant, { color: t.text }]} numberOfLines={1}>
                          {bill.merchant}
                        </Text>
                        <Text style={[styles.billSubline, { color: t.muted }]} numberOfLines={1}>
                          {splitTypeLabel(bill.splitType)} · {paidByLabel} · {peopleCount} people
                        </Text>
                      </View>

                      {/* Right */}
                      <View style={styles.billRight}>
                        <Text style={[styles.billAmount, { color: t.text }]}>
                          {bigDisplay}
                        </Text>
                        {bigFooters.length > 0 && (
                          <Text style={[styles.billAmountSub, { color: t.muted }]}>
                            {bigFooters.join(' · ')}
                          </Text>
                        )}
                        {isSettled ? (
                          <Text style={[styles.deltaBadge, { color: t.muted }]}>SETTLED</Text>
                        ) : isOwed ? (
                          <Text style={[styles.deltaBadge, { color: t.accent }]}>
                            +{isForeign(bill, homeCurrency)
                              ? `${formatMoneyWithCode(owed, bill.currency)} (≈${formatMoneyWithCode(toHome(owed, bill), homeCurrency)})`
                              : formatMoneyWithCode(owed, bill.currency)}
                          </Text>
                        ) : (
                          <Text style={[styles.deltaBadge, { color: t.danger }]}>
                            −{isForeign(bill, homeCurrency)
                              ? `${formatMoneyWithCode(owe, bill.currency)} (≈${formatMoneyWithCode(toHome(owe, bill), homeCurrency)})`
                              : formatMoneyWithCode(owe, bill.currency)}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* ── See all history ── */}
        <Pressable
          style={[styles.historyBtn, { backgroundColor: t.surface, borderColor: t.border }]}
          onPress={() => navigation.navigate('SplitHistory', { monthPrefix: prefix })}
        >
          <Feather name="clock" size={15} color={t.muted} />
          <Text style={[styles.historyBtnText, { color: t.muted }]}>See all history</Text>
          <Feather name="chevron-right" size={15} color={t.muted} />
        </Pressable>
      </ScrollView>

      <MonthPickerSheet
        visible={showMonthPicker}
        onClose={() => setShowMonthPicker(false)}
        year={year}
        month={month}
        onSelect={(y, m) => { setYear(y); setMonth(m); }}
        spendByMonth={billSpendByMonth}
        countByMonth={billCountByMonth}
        countUnit="bill"
        currency={homeCurrency}
      />
    </SafeAreaView>
    <View style={styles.fabSafe} pointerEvents="box-none">
      <Pressable
        style={[styles.fab, { backgroundColor: t.accent }]}
        onPress={() => navigation.navigate('AddSplit')}
      >
        <Feather name="plus" size={22} color={t.onAccent} />
      </Pressable>
    </View>
    </View>
  );
}

// styles

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  fabSafe: { position: 'absolute', right: 0, bottom: 0, left: 0, pointerEvents: 'box-none' },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  peopleBtn: { fontSize: 15, fontWeight: '500' },

  monthNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navArrow: { padding: 4 },
  monthTitleBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  monthText: { fontSize: 16, fontWeight: '600' },

  overviewBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: ScreenPadding,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  overviewDot: { width: 7, height: 7, borderRadius: 4 },
  overviewText: { fontSize: 12, fontWeight: '500', flexShrink: 1, textAlign: 'center' },

  scrollContent: { paddingHorizontal: ScreenPadding, paddingTop: Spacing.three, gap: Spacing.three },

  totalsRowOuter: {
    flexDirection: 'row', gap: 12,
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  totalCard: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    paddingVertical: 15,
    gap: 4,
  },
  totalCardEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  totalCardAmount: { fontSize: 25, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  totalCardSub: { fontSize: 13 },

  section: { gap: 10 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  sectionMeta: { fontSize: 12 },

  billsList: { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },
  hr: { height: StyleSheet.hairlineWidth },

  billRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  dimmed: { opacity: 0.55 },

  dayStack: { width: 30, alignItems: 'center', gap: 1 },
  dayNum: { fontSize: 13, fontWeight: '600' },
  dayWd: { fontSize: 9, fontWeight: '600' },

  billMiddle: { flex: 1, gap: 2 },
  billMerchant: { fontSize: 15, fontWeight: '600' },
  billSubline: { fontSize: 12 },

  billRight: { alignItems: 'flex-end', gap: 2 },
  billAmount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  billAmountSub: { fontSize: 11, fontVariant: ['tabular-nums'] as any },
  deltaBadge: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },

  historyBtn: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, paddingVertical: 14, paddingHorizontal: 18,
    borderRadius: Radii.card, borderWidth: 1,
  },
  historyBtnText: { flex: 1, fontSize: 14, fontWeight: '500' },

  carriedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radii.card,
    borderWidth: 1,
    padding: 16,
  },
  carriedLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  carriedTitle: { fontSize: 14, fontWeight: '600' },
  carriedSub: { fontSize: 12, marginTop: 2 },
  carriedAmount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] as any },

  emptyCenter: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14,
    paddingHorizontal: ScreenPadding,
  },
  emptyTile: {
    width: 64, height: 64, borderRadius: 20, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyHint: { fontSize: 12, textAlign: 'center', maxWidth: 230, lineHeight: 20 },

  fab: {
    position: 'absolute', bottom: 20, right: ScreenPadding,
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    elevation: 4,
    shadowColor: SHADOW_COLOR,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
});
