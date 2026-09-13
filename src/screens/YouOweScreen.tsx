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
import { accountAmountDisplay, formatMoney } from '@/logic/moneyFormatter';
import { amountInAccountCurrency, round2 } from '@/logic/splitMath';
import { addExpense, getAccounts, getSettings, getSplitBills, settleSplitEntry, updateSplitBill, updateSubBalance } from '@/storage/storage';
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

function billIsSettled(bill: SplitBill) {
  return bill.entries.length > 0 && bill.entries.every((e) => e.settled);
}

function fmtDate(iso: string) {
  const d = new Date(iso + 'T12:00:00');
  return { day: d.getDate(), month: d.toLocaleDateString('en-SG', { month: 'short' }) };
}

function isCarriedBill(bill: SplitBill, currentMonthPrefix: string): boolean {
  return !!currentMonthPrefix && bill.date < currentMonthPrefix;
}

// YouOweScreen

export default function YouOweScreen({ route, navigation }: any) {
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
        setBills(all.filter((b) => b.paidBy === 'other'));
        setAccounts(accs);
        setHomeCurrency(settings.homeCurrency ?? 'SGD');
      });
    }, []),
  );

  // group the bills i owe by who paid
  const personMap: Record<string, { bills: SplitBill[]; totalOwe: number }> = {};
  for (const bill of bills) {
    if (bill.paidBy !== 'other') continue;
    if (billIsSettled(bill)) continue;
    const name = bill.paidByName ?? 'Someone';
    if (!personMap[name]) personMap[name] = { bills: [], totalOwe: 0 };
    personMap[name].bills.push(bill);
    personMap[name].totalOwe += round2(bill.myShare * (bill.liveRate ?? 1));
  }
  const people = Object.keys(personMap).sort();

  // add up in home currency so different currencies work
  const heroTotal = people.reduce((s, p) => s + personMap[p].totalOwe, 0);

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
      // someone else paid, so paying my share now makes it a real expense
      let newLinkedId = bill.linkedExpenseId;
      if (bill.paidBy === 'other' && !bill.linkedExpenseId) {
        const homeRate = bill.liveRate ?? 1;
        const acctCode: string | undefined = account?.primaryCode;
        const acctFields = acctCode && acctCode !== bill.currency && bill.entryToAccountRate != null
          ? { accountCurrencyAtEntry: acctCode, accountAmount: round2(bill.myShare * bill.entryToAccountRate) }
          : { accountCurrencyAtEntry: null, accountAmount: null };
        const expense = (await addExpense({
          accountId: bill.accountId, categoryId: bill.categoryId,
          merchant: bill.merchant, amount: bill.myShare, currency: bill.currency,
          amountInHomeCurrency: round2(bill.myShare * homeRate),
          exchangeRateAtEntry: homeRate,
          ...acctFields,
          date: bill.date, receiptImageUri: null,
          isShared: false, splitType: null, splitDetails: null, notes: bill.notes,
        })) as { id: string };
        newLinkedId = expense.id;
        await updateSplitBill(bill.id, { linkedExpenseId: newLinkedId });
      }
      setBills((prev) =>
        prev.map((b) => {
          if (b.id !== bill.id) return b;
          return {
            ...b,
            linkedExpenseId: newLinkedId,
            entries: b.entries.map((e) => ({ ...e, settled: true, settledAt: new Date().toISOString().slice(0, 10) })),
          };
        }),
      );
    } catch {
      Alert.alert('Error', 'Could not mark as paid.');
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
      await handleSettle(bill, bill.entries[0]?.person ?? personName);
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
        <Text style={[styles.headerTitle, { color: t.text }]}>You owe</Text>
        <View style={styles.backBtn} />
      </View>

      {/* ── Hero ── */}
      <View style={styles.heroBlock}>
        <Text style={[styles.heroAmount, { color: t.danger }]}>
          {homeCurrency} {formatMoney(heroTotal, homeCurrency)}
        </Text>
        <Text style={[styles.heroSub, { color: t.muted }]}>
          to {people.length} {people.length === 1 ? 'person' : 'people'}
        </Text>
      </View>

      {people.length === 0 ? (
        <View style={styles.emptyCenter}>
          <Text style={[styles.emptyText, { color: t.muted }]}>All paid up — nothing owed.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {people.map((personName) => {
            const { bills: personBills, totalOwe } = personMap[personName];
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
                  <View style={[styles.avatar, { backgroundColor: t.dangerSoft }]}>
                    <Text style={[styles.avatarInitial, { color: t.danger }]}>
                      {personName[0].toUpperCase()}
                    </Text>
                  </View>

                  <View style={styles.accordionMid}>
                    <Text style={[styles.accordionName, { color: t.text }]}>
                      You owe {personName}
                    </Text>
                    <Text style={[styles.accordionSub, { color: t.muted }]}>
                      {personBills.length} {personBills.length === 1 ? 'bill' : 'bills'}
                      {oldest ? ` · oldest ${oldest.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}` : ''}
                    </Text>
                  </View>

                  <View style={styles.accordionRight}>
                    <Text style={[styles.accordionTotal, { color: t.danger }]}>
                      {homeCurrency} {formatMoney(totalOwe, homeCurrency)}
                    </Text>
                    <Feather name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={t.muted} />
                  </View>
                </Pressable>

                {/* Expanded bills */}
                {isExpanded && (
                  <View style={[styles.accordionBody, { borderTopColor: t.border }]}>
                    {personBills.map((bill, idx) => {
                      const { day, month: mon } = fmtDate(bill.date);
                      const isCarried = isCarriedBill(bill, currentMonthPrefix);
                      const isSelected = !!selectedIds[bill.id];

                      const accountCurrency = accounts.find((a) => a.id === bill.accountId)?.primaryCode ?? homeCurrency;
                      const acct = amountInAccountCurrency(bill.myShare, bill, accountCurrency, homeCurrency);
                      const { big: shareBig, footers: shareFooters } = accountAmountDisplay({
                        accountCurrency: acct.currency, accountAmount: acct.amount,
                        txCurrency: bill.currency, txAmount: bill.myShare,
                        homeCurrency, homeAmount: round2(bill.myShare * (bill.liveRate ?? 1)),
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
                            <View style={styles.dateStack}>
                              <Text style={[styles.dateDay, { color: t.text }]}>{day}</Text>
                              <Text style={[styles.dateMon, { color: t.muted }]}>{mon}</Text>
                            </View>
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
                            <View style={styles.billEntryRight}>
                              <Text style={[styles.billEntryAmount, { color: t.text }]}>
                                {shareBig}
                              </Text>
                              {shareFooters.length > 0 && (
                                <Text style={[styles.billEntryFooter, { color: t.muted }]}>
                                  {shareFooters.join(' · ')}
                                </Text>
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
                              Mark paid{selectedCount > 0 ? ` (${selectedCount})` : ''}
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
                            Mark as paid
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
              </View>
            );
          })}

          {people.length > 1 && (
            <Pressable
              style={[styles.settleAllBtn, { borderColor: t.border }]}
              onPress={() =>
                Alert.alert('Settle up', 'Mark all bills as paid?', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Mark paid',
                    onPress: () => {
                      bills.forEach((b) => {
                        b.entries.forEach((e) => {
                          if (!e.settled) handleSettle(b, e.person);
                        });
                      });
                    },
                  },
                ])
              }
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

  scrollContent: { paddingHorizontal: ScreenPadding, gap: 12 },

  accordion: { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },
  accordionHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
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
  carriedTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  carriedTagText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  billEntryRight: { alignItems: 'flex-end', gap: 4 },
  billEntryAmount: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] as any },
  billEntryFooter: { fontSize: 11, fontVariant: ['tabular-nums'] as any, textAlign: 'right' },
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
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  settleAllBtnText: { fontSize: 15, fontWeight: '600' },
});
