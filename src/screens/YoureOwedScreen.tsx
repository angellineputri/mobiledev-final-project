import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/use-theme';
import { Radii, ScreenPadding, Spacing } from '@/constants/theme';
import { accountAmountDisplay, formatMoney, formatMoneyWithCode } from '@/logic/moneyFormatter';
import { amountInAccountCurrency, round2 } from '@/logic/splitMath';
import { getAccounts, getSettings, getSplitBills, settleSplitEntry, updateSubBalance } from '@/storage/storage';
import { calculateSettlementBalanceEffect } from '@/logic/businessLogic';

// types

type SplitEntry = { person: string; share: number; settled: boolean; settledAt: string | null };
type SplitBill = {
  id: string; merchant: string; total: number; currency: string; date: string;
  paidBy: 'me' | 'other'; paidByName: string | null;
  splitType: 'equal' | 'custom' | 'items'; myShare: number;
  entries: SplitEntry[]; linkedExpenseId: string | null;
  categoryId: string | null; accountId: string; notes: string | null; createdAt: string;
  liveRate?: number; entryToAccountRate?: number;
};
type Account = { id: string; name: string; primaryCode: string };

// helpers

function fmtDate(iso: string) {
  const d = new Date(iso + 'T12:00:00');
  return { day: d.getDate(), month: d.toLocaleDateString('en-SG', { month: 'short' }) };
}

function billTotal(bill: SplitBill, settled: boolean) {
  return bill.entries
    .filter((e) => e.settled === settled)
    .reduce((s, e) => s + e.share, 0);
}

// helpers (extended)

function isCarriedBill(bill: SplitBill, currentMonthPrefix: string): boolean {
  return bill.date < currentMonthPrefix;
}

function prevMonthName(currentPrefix: string): string {
  const [y, m] = currentPrefix.split('-').map(Number);
  const prevDate = m === 1 ? new Date(y - 1, 11, 1) : new Date(y, m - 2, 1);
  return prevDate.toLocaleDateString('en-SG', { month: 'long' });
}

// YoureOwedScreen

export default function YoureOwedScreen({ route, navigation }: any) {
  const { bills: initialBills, currentMonthPrefix = '' } = route.params as {
    bills: SplitBill[];
    currentMonthPrefix?: string;
  };
  const t = useTheme();
  const [bills, setBills] = useState<SplitBill[]>(initialBills);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);
  const [settling, setSettling] = useState<string | null>(null);
  // which person is picking bills, and which bills are ticked
  const [selectPerson, setSelectPerson] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  // reload when the screen is opened again
  useFocusEffect(
    useCallback(() => {
      Promise.all([
        getSplitBills() as Promise<SplitBill[]>,
        getAccounts() as Promise<Account[]>,
        getSettings() as Promise<{ homeCurrency?: string }>,
      ]).then(([all, accs, settings]) => {
        setBills(all.filter((b) => b.paidBy === 'me'));
        setAccounts(accs);
        setHomeCurrency(settings.homeCurrency ?? 'SGD');
      });
    }, []),
  );

  // group open entries by person
  const personMap: Record<string, { bills: SplitBill[]; totalOwed: number }> = {};
  for (const bill of bills) {
    for (const entry of bill.entries) {
      if (entry.settled) continue;
      if (!personMap[entry.person]) personMap[entry.person] = { bills: [], totalOwed: 0 };
      if (!personMap[entry.person].bills.find((b) => b.id === bill.id)) {
        personMap[entry.person].bills.push(bill);
      }
      personMap[entry.person].totalOwed += round2(entry.share * (bill.liveRate ?? 1));
    }
  }
  const people = Object.keys(personMap).sort();

  // add up in home currency so different currencies work
  const heroTotal = people.reduce((s, p) => s + personMap[p].totalOwed, 0);

  // carried amount = older months' bills, in home currency
  const carriedTotal = currentMonthPrefix
    ? bills.reduce((s, bill) => {
        if (!isCarriedBill(bill, currentMonthPrefix)) return s;
        return s + bill.entries
          .filter((e) => !e.settled)
          .reduce((es, e) => es + round2(e.share * (bill.liveRate ?? 1)), 0);
      }, 0)
    : 0;

  async function handleSettle(bill: SplitBill, personName: string) {
    const key = `${bill.id}-${personName}`;
    if (settling === key) return;
    setSettling(key);
    try {
      const accounts = await getAccounts() as any[];
      await settleSplitEntry(bill.id, personName);
      const delta = calculateSettlementBalanceEffect(bill, personName);
      const account = accounts.find((a: any) => a.id === bill.accountId);
      if (account && delta !== 0) {
        await updateSubBalance(bill.accountId, account.primaryCode ?? account.currency ?? 'SGD', delta);
      }
      // Update local state
      setBills((prev) =>
        prev.map((b) => {
          if (b.id !== bill.id) return b;
          return {
            ...b,
            entries: b.entries.map((e) =>
              e.person === personName ? { ...e, settled: true, settledAt: new Date().toISOString().slice(0, 10) } : e,
            ),
          };
        }),
      );
    } catch {
      Alert.alert('Error', 'Could not settle this entry.');
    } finally {
      setSettling(null);
    }
  }

  function enterSelectMode(personName: string, personBills: SplitBill[]) {
    const init: Record<string, boolean> = {};
    personBills.forEach((b) => { init[b.id] = true; });
    setSelectedIds(init);
    setSelectPerson(personName);
  }

  function cancelSelectMode() {
    setSelectPerson(null);
    setSelectedIds({});
  }

  function toggleSelect(billId: string) {
    setSelectedIds((prev) => ({ ...prev, [billId]: !prev[billId] }));
  }

  async function settleSelected(personName: string, personBills: SplitBill[]) {
    const chosen = personBills.filter((b) => selectedIds[b.id]);
    if (chosen.length === 0) return;
    for (const bill of chosen) {
      await handleSettle(bill, personName);
    }
    cancelSelectMode();
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top']}>
      {/* ── Header ── */}
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Feather name="chevron-left" size={22} color={t.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.text }]}>You're owed</Text>
        <View style={styles.backBtn} />
      </View>

      {/* ── Hero ── */}
      <View style={styles.heroBlock}>
        <Text style={[styles.heroAmount, { color: t.accent }]}>
          {homeCurrency} {formatMoney(heroTotal, homeCurrency)}
        </Text>
        <Text style={[styles.heroSub, { color: t.muted }]}>
          from {people.length} {people.length === 1 ? 'person' : 'people'}
          {carriedTotal > 0 && currentMonthPrefix
            ? ` · ${formatMoneyWithCode(carriedTotal, homeCurrency)} carried from ${prevMonthName(currentMonthPrefix)}`
            : ''}
        </Text>
      </View>

      {people.length === 0 ? (
        <View style={styles.emptyCenter}>
          <Text style={[styles.emptyText, { color: t.muted }]}>All received — nothing open.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {people.map((personName) => {
            const { bills: personBills, totalOwed } = personMap[personName];
            const isExpanded = expandedPerson === personName;
            const inSelectMode = selectPerson === personName;
            const selectedCount = personBills.filter((b) => selectedIds[b.id]).length;
            const oldestDate = personBills.reduce(
              (min, b) => (b.date < min ? b.date : min),
              personBills[0]?.date ?? '',
            );
            const oldest = oldestDate ? new Date(oldestDate + 'T12:00:00') : null;

            return (
              <View key={personName} style={[styles.accordion, { backgroundColor: t.surface, borderColor: t.border }]}>
                {/* Accordion header */}
                <Pressable
                  style={styles.accordionHeader}
                  onPress={() => setExpandedPerson(isExpanded ? null : personName)}
                >
                  {/* Avatar */}
                  <View style={[styles.avatar, { backgroundColor: t.accentSoft }]}>
                    <Text style={[styles.avatarInitial, { color: t.accentInk }]}>
                      {personName[0].toUpperCase()}
                    </Text>
                  </View>

                  <View style={styles.accordionMid}>
                    <Text style={[styles.accordionName, { color: t.text }]}>
                      {personName} owes you
                    </Text>
                    <Text style={[styles.accordionSub, { color: t.muted }]}>
                      {personBills.length} {personBills.length === 1 ? 'bill' : 'bills'}
                      {oldest ? ` · oldest ${oldest.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}` : ''}
                    </Text>
                  </View>

                  <View style={styles.accordionRight}>
                    <Text style={[styles.accordionTotal, { color: t.accent }]}>
                      {homeCurrency} {formatMoney(totalOwed, homeCurrency)}
                    </Text>
                    <Feather
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={t.muted}
                    />
                  </View>
                </Pressable>

                {/* Expanded bills */}
                {isExpanded && (
                  <View style={[styles.accordionBody, { borderTopColor: t.border }]}>
                    {personBills.map((bill, idx) => {
                      const entry = bill.entries.find((e) => e.person === personName);
                      if (!entry) return null;
                      const { day, month: mon } = fmtDate(bill.date);

                      const isCarried = currentMonthPrefix
                        ? isCarriedBill(bill, currentMonthPrefix)
                        : false;
                      const paymentMethod = (entry as any).paymentMethod as 'cash' | 'paynow' | undefined;
                      const isSelected = !!selectedIds[bill.id];

                      const accountCurrency = accounts.find((a) => a.id === bill.accountId)?.primaryCode ?? homeCurrency;
                      const acct = amountInAccountCurrency(entry.share, bill, accountCurrency, homeCurrency);
                      const { big: shareBig, footers: shareFooters } = accountAmountDisplay({
                        accountCurrency: acct.currency, accountAmount: acct.amount,
                        txCurrency: bill.currency, txAmount: entry.share,
                        homeCurrency, homeAmount: round2(entry.share * (bill.liveRate ?? 1)),
                      });

                      return (
                        <View key={bill.id}>
                          {idx > 0 && <View style={[styles.hr, { backgroundColor: t.border }]} />}
                          {/* In select mode the row toggles its tick; otherwise it
                              opens the split's detail / edit. */}
                          <Pressable
                            style={styles.billEntryRow}
                            onPress={() =>
                              inSelectMode
                                ? toggleSelect(bill.id)
                                : navigation.navigate('SplitDetail', { bill })
                            }
                          >
                            {/* Selection circle */}
                            {inSelectMode && (
                              <View
                                style={[
                                  styles.selectCircle,
                                  isSelected
                                    ? { backgroundColor: t.accent, borderColor: t.accent }
                                    : { borderColor: t.border },
                                ]}
                              >
                                {isSelected && <Feather name="check" size={13} color={t.onAccent} />}
                              </View>
                            )}

                            {/* Date stack */}
                            <View style={styles.dateStack}>
                              <Text style={[styles.dateDay, { color: t.text }]}>{day}</Text>
                              <Text style={[styles.dateMon, { color: t.muted }]}>{mon}</Text>
                            </View>

                            {/* Bill info */}
                            <View style={styles.billEntryMid}>
                              <View style={styles.billEntryNameRow}>
                                <Text style={[styles.billEntryMerchant, { color: t.text }]} numberOfLines={1}>
                                  {bill.merchant}
                                </Text>
                                {isCarried && (
                                  <View style={[styles.carriedTag, { backgroundColor: t.dangerSoft }]}>
                                    <Text style={[styles.carriedTagText, { color: t.danger }]}>CARRIED</Text>
                                  </View>
                                )}
                              </View>
                              {bill.notes ? (
                                <Text style={[styles.billEntryNote, { color: t.muted }]} numberOfLines={1}>
                                  {bill.notes}
                                </Text>
                              ) : null}
                            </View>

                            {/* Right: amount + payment method */}
                            <View style={styles.billEntryRight}>
                              <Text style={[styles.billEntryAmount, { color: t.text }]}>
                                {shareBig}
                              </Text>
                              {shareFooters.length > 0 && (
                                <Text style={[styles.billEntryFooter, { color: t.muted }]}>
                                  {shareFooters.join(' · ')}
                                </Text>
                              )}
                              {paymentMethod && (
                                <View style={[styles.pmTag, { backgroundColor: t.accentSoft }]}>
                                  <Text style={[styles.pmTagText, { color: t.accentInk }]}>
                                    {paymentMethod === 'cash' ? 'PAYS CASH' : 'PAYS PAYNOW'}
                                  </Text>
                                </View>
                              )}
                            </View>
                          </Pressable>
                        </View>
                      );
                    })}

                    {/* Per-person footer */}
                    <View style={[styles.accordionFooter, { borderTopColor: t.border }]}>
                      {inSelectMode ? (
                        <>
                          <Pressable
                            style={[styles.footerSecBtn, { borderColor: t.border }]}
                            onPress={cancelSelectMode}
                            disabled={!!settling}
                          >
                            <Text style={[styles.footerSecBtnText, { color: t.text }]}>Cancel</Text>
                          </Pressable>
                          <Pressable
                            style={[
                              styles.footerPrimaryBtn,
                              { backgroundColor: selectedCount > 0 ? t.accent : t.border },
                            ]}
                            onPress={() => settleSelected(personName, personBills)}
                            disabled={selectedCount === 0 || !!settling}
                          >
                            <Text style={[styles.footerPrimaryBtnText, { color: t.onAccent }]}>
                              Mark received{selectedCount > 0 ? ` (${selectedCount})` : ''}
                            </Text>
                          </Pressable>
                        </>
                      ) : (
                        <Pressable
                          style={[styles.footerPrimaryBtn, { backgroundColor: t.accent }]}
                          onPress={() => enterSelectMode(personName, personBills)}
                          disabled={!!settling}
                        >
                          <Text style={[styles.footerPrimaryBtnText, { color: t.onAccent }]}>
                            Mark as received
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
              </View>
            );
          })}

          {/* Page footer */}
          {people.length > 1 && (
            <Pressable
              style={[styles.settleAllBtn, { borderColor: t.border }]}
              onPress={() => Alert.alert('Settle everyone up', 'This will mark all open bills as received. Continue?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Settle all', style: 'destructive', onPress: () => {
                  // settle all open entries
                  const toSettle: { bill: SplitBill; person: string }[] = [];
                  for (const bill of bills) {
                    for (const entry of bill.entries) {
                      if (!entry.settled) toSettle.push({ bill, person: entry.person });
                    }
                  }
                  toSettle.reduce((p, { bill, person }) => p.then(() => handleSettle(bill, person)), Promise.resolve());
                }},
              ])}
            >
              <Text style={[styles.settleAllBtnText, { color: t.text }]}>Settle everyone up</Text>
            </Pressable>
          )}

          <View style={{ height: Spacing.four }} />
        </ScrollView>
      )}
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
  backBtn: { width: 32 },
  headerTitle: { fontSize: 18, fontWeight: '600' },

  heroBlock: { alignItems: 'center', paddingVertical: 28, gap: 6 },
  heroAmount: { fontSize: 38, fontWeight: '600', letterSpacing: -1.4, fontVariant: ['tabular-nums'] as any },
  heroSub: { fontSize: 13 },

  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14 },

  scrollContent: { paddingHorizontal: ScreenPadding, gap: 12, paddingBottom: 40 },

  accordion: { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },

  accordionHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: 16, gap: 12,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 14, fontWeight: '700' },
  accordionMid: { flex: 1, gap: 2 },
  accordionName: { fontSize: 16, fontWeight: '600' },
  accordionSub: { fontSize: 12 },
  accordionRight: { alignItems: 'flex-end', gap: 4 },
  accordionTotal: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] as any },

  accordionBody: { borderTopWidth: StyleSheet.hairlineWidth },
  hr: { height: StyleSheet.hairlineWidth },

  billEntryRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
  },
  dateStack: { width: 34, alignItems: 'center', gap: 2 },
  dateDay: { fontSize: 14, fontWeight: '600' },
  dateMon: { fontSize: 10, fontWeight: '600' },
  billEntryMid: { flex: 1, gap: 2 },
  billEntryNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  billEntryMerchant: { fontSize: 14, fontWeight: '600' },
  billEntryNote: { fontSize: 12 },
  billEntryRight: { alignItems: 'flex-end', gap: 4 },
  billEntryAmount: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] as any },
  billEntryFooter: { fontSize: 11, fontVariant: ['tabular-nums'] as any, textAlign: 'right' },
  carriedTag: {
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 6,
  },
  carriedTagText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  pmTag: {
    paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: 6,
  },
  pmTagText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
  selectCircle: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },

  accordionFooter: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerSecBtn: {
    flex: 1, height: 40, borderRadius: Radii.button, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  footerSecBtnText: { fontSize: 14, fontWeight: '600' },
  footerPrimaryBtn: {
    flex: 1, height: 40, borderRadius: Radii.button,
    alignItems: 'center', justifyContent: 'center',
  },
  footerPrimaryBtnText: { fontSize: 14, fontWeight: '600' },

  settleAllBtn: {
    height: 54, borderRadius: Radii.button, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  settleAllBtnText: { fontSize: 15, fontWeight: '600' },
});
