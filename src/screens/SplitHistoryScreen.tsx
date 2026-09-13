import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/use-theme';
import { Radii, ScreenPadding } from '@/constants/theme';
import { accountAmountDisplay, formatMoneyWithCode } from '@/logic/moneyFormatter';
import { getAccounts, getSplitBills, getSettings } from '@/storage/storage';

// types

type SplitEntry = { person: string; share: number; settled: boolean; settledAt: string | null };
type SplitBill = {
  id: string; merchant: string; total: number; currency: string; date: string;
  paidBy: 'me' | 'other'; paidByName: string | null;
  splitType: 'equal' | 'custom' | 'items'; myShare: number;
  entries: SplitEntry[]; linkedExpenseId: string | null; categoryId: string | null;
  accountId: string; notes: string | null; createdAt: string;
  groupMembers?: Array<{ name: string; share: number }>; liveRate?: number;
  entryToAccountRate?: number;
};
type CurrencyBalance = { code: string; balance: number };
type Account = { id: string; name: string; primaryCode: string; currencies: CurrencyBalance[] };

// helpers

function billIsOpen(bill: SplitBill) { return bill.entries.some((e) => !e.settled); }
function billIsSettled(bill: SplitBill) { return bill.entries.length > 0 && bill.entries.every((e) => e.settled); }

function owedFromBill(bill: SplitBill): number {
  if (bill.paidBy !== 'me') return 0;
  return bill.entries.filter((e) => !e.settled).reduce((s, e) => s + e.share, 0);
}
function iOweOnBill(bill: SplitBill): number {
  if (bill.paidBy !== 'other') return 0;
  if (billIsSettled(bill)) return 0;
  return bill.myShare;
}
function toHome(amount: number, bill: SplitBill): number {
  return Math.round(amount * (bill.liveRate ?? 1) * 100) / 100;
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
  if (accountCurrency === homeCurrency) return { currency: accountCurrency, amount: toHome(bill.total, bill) };
  return { currency: bill.currency, amount: bill.total };
}
function splitTypeLabel(s: 'equal' | 'custom' | 'items') {
  return s === 'items' ? 'by items' : s;
}
function dayWeekday(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  return { day: d.getDate(), weekday: d.toLocaleDateString('en-SG', { weekday: 'short' }).toUpperCase() };
}
function monthLabelFromPrefix(prefix: string) {
  const y = parseInt(prefix.slice(0, 4), 10);
  const m = parseInt(prefix.slice(5, 7), 10);
  return new Date(y, m - 1, 1).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' });
}

// SplitHistoryScreen

export default function SplitHistoryScreen({ navigation, route }: any) {
  const t = useTheme();
  const monthPrefix: string | undefined = route?.params?.monthPrefix;
  const [bills, setBills] = useState<SplitBill[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [activeTab, setActiveTab] = useState<'ongoing' | 'settled'>('ongoing');

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

  const sorted = useMemo(
    () =>
      bills
        .filter((b) => (monthPrefix ? b.date.startsWith(monthPrefix) : true))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [bills, monthPrefix],
  );
  const ongoing = useMemo(() => sorted.filter(billIsOpen), [sorted]);
  const settled = useMemo(() => sorted.filter(billIsSettled), [sorted]);
  const listData = activeTab === 'ongoing' ? ongoing : settled;

  function renderBillRow(bill: SplitBill, idx: number) {
    const isSettled = billIsSettled(bill);
    const isOwed = bill.paidBy === 'me';
    const owed = owedFromBill(bill);
    const owe = iOweOnBill(bill);
    const { day, weekday } = dayWeekday(bill.date);
    const foreign = bill.currency !== homeCurrency;
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
          <View style={styles.dayStack}>
            <Text style={[styles.dayNum, { color: t.text }]}>{day}</Text>
            <Text style={[styles.dayWd, { color: t.muted }]}>{weekday.slice(0, 3)}</Text>
          </View>
          <View style={styles.billMiddle}>
            <Text style={[styles.billMerchant, { color: t.text }]} numberOfLines={1}>
              {bill.merchant}
            </Text>
            <Text style={[styles.billSubline, { color: t.muted }]} numberOfLines={1}>
              {splitTypeLabel(bill.splitType)} · {paidByLabel} · {peopleCount} people
            </Text>
          </View>
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
                +{foreign
                  ? `${formatMoneyWithCode(owed, bill.currency)} (≈${formatMoneyWithCode(toHome(owed, bill), homeCurrency)})`
                  : formatMoneyWithCode(owed, bill.currency)}
              </Text>
            ) : (
              <Text style={[styles.deltaBadge, { color: t.danger }]}>
                −{foreign
                  ? `${formatMoneyWithCode(owe, bill.currency)} (≈${formatMoneyWithCode(toHome(owe, bill), homeCurrency)})`
                  : formatMoneyWithCode(owe, bill.currency)}
              </Text>
            )}
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
          <Feather name="chevron-left" size={22} color={t.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.text }]}>
          {monthPrefix ? monthLabelFromPrefix(monthPrefix) : 'All Split Bills'}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      {/* Segment tabs */}
      <View style={[styles.tabTrack, { backgroundColor: t.surface, borderColor: t.border }]}>
        {(['ongoing', 'settled'] as const).map((tab) => (
          <Pressable
            key={tab}
            style={[styles.tabBtn, activeTab === tab && { backgroundColor: t.accent }]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, { color: activeTab === tab ? t.onAccent : t.muted }]}>
              {tab === 'ongoing' ? `Ongoing (${ongoing.length})` : `Settled (${settled.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {listData.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="users" size={32} color={t.muted} />
            <Text style={[styles.emptyText, { color: t.muted }]}>
              {activeTab === 'ongoing' ? 'No open bills.' : 'No settled bills yet.'}
            </Text>
          </View>
        ) : (
          <View style={[styles.billsList, { backgroundColor: t.surface, borderColor: t.border }]}>
            {listData.map((bill, idx) => renderBillRow(bill, idx))}
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// styles

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },

  tabTrack: {
    flexDirection: 'row', marginHorizontal: ScreenPadding, marginTop: 14, marginBottom: 4,
    borderRadius: Radii.segTrack, borderWidth: 1, padding: 3, gap: 3,
  },
  tabBtn: { flex: 1, height: 36, borderRadius: Radii.segThumb, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 13, fontWeight: '600' },

  scroll: { paddingHorizontal: ScreenPadding, paddingTop: 14 },

  billsList: { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },
  hr: { height: StyleSheet.hairlineWidth },
  billRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
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

  empty: { alignItems: 'center', gap: 12, paddingTop: 80 },
  emptyText: { fontSize: 15 },
});
