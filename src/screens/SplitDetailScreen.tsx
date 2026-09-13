import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
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
import { amountInAccountCurrency } from '@/logic/splitMath';
import {
  addExpense,
  deleteExpense,
  deleteSplitBill,
  getAccounts,
  getSettings,
  getSplitBills,
  settleSplitEntry,
  unsettleSplitEntry,
  updateExpense,
  updateSubBalance,
  updateSplitBill,
} from '@/storage/storage';
import { calculateSettlementBalanceEffect } from '@/logic/businessLogic';

// types

type SplitEntry = { person: string; share: number; settled: boolean; settledAt: string | null; settleType?: 'received' | 'expense' };
type SplitBill = {
  id: string; merchant: string; total: number; currency: string; date: string;
  paidBy: 'me' | 'other'; paidByName: string | null;
  splitType: 'equal' | 'custom' | 'items'; myShare: number;
  entries: SplitEntry[]; linkedExpenseId: string | null; myExpenseId?: string | null;
  categoryId: string | null; accountId: string; notes: string | null; createdAt: string;
  splitItems?: Array<{ name: string; price: number; sharerPersonNames: string[] }>;
  sharedFees?: { gst: number; serviceCharge: number; delivery: number };
  groupMembers?: Array<{ name: string; share: number }>;
  liveRate?: number;
  entryToAccountRate?: number;
};
type Account = { id: string; name: string; primaryCode: string; type?: string };

// helpers

function fmtDate(iso: string, opts?: Intl.DateTimeFormatOptions) {
  const d = iso.includes('T') ? new Date(iso) : new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-SG', opts ?? { day: 'numeric', month: 'short', year: 'numeric' });
}

function splitTypeLabel(t: 'equal' | 'custom' | 'items') {
  return t === 'equal' ? 'equally' : t === 'custom' ? 'custom' : 'by items';
}

// SplitDetailScreen

export default function SplitDetailScreen({ route, navigation }: any) {
  const { bill: initialBill } = route.params as { bill: SplitBill };
  const t = useTheme();
  const [bill, setBill] = useState<SplitBill>(initialBill);
  const [settling, setSettling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [changingAccount, setChangingAccount] = useState(false);

  useEffect(() => {
    getAccounts().then((accs) => setAccounts(accs as Account[]));
    getSettings().then((s: any) => setHomeCurrency(s.homeCurrency ?? 'SGD'));
  }, []);

  // refresh when the screen is opened again (e.g. after an edit)
  useFocusEffect(
    useCallback(() => {
      getSplitBills().then((bills: SplitBill[]) => {
        const fresh = bills.find((b) => b.id === initialBill.id);
        if (fresh) setBill(fresh);
      });
    }, [initialBill.id]),
  );

  const isIPaid = bill.paidBy === 'me';
  const currency = bill.currency;
  const payerShare = isIPaid ? null : (() => {
    const othersTotal = bill.myShare + (bill.groupMembers?.reduce((s, gm) => s + gm.share, 0) ?? 0);
    return Math.round((bill.total - othersTotal) * 100) / 100;
  })();

  const hasItems = bill.splitType === 'items' && bill.splitItems && bill.splitItems.length > 0;
  const fees = bill.sharedFees;
  const itemsSubtotal = bill.splitItems?.reduce((s, i) => s + i.price, 0) ?? 0;
  const gstAmt = fees ? Math.round(itemsSubtotal * fees.gst / 100 * 100) / 100 : 0;
  const svcAmt = fees ? Math.round(itemsSubtotal * fees.serviceCharge / 100 * 100) / 100 : 0;
  const deliveryAmt = fees?.delivery ?? 0;

  const openEntries = bill.entries.filter((e) => !e.settled);
  const settledEntries = bill.entries.filter((e) => e.settled);

  // convert the bill currency to home using the saved rate
  const homeRate = bill.liveRate ?? 1;
  const isForeign = currency !== homeCurrency;
  const toHome = (amt: number) => Math.round(amt * homeRate * 100) / 100;
  // "≈ SGD x" text, or null if the bill is already home currency
  const homeConv = (amt: number): string | null =>
    isForeign ? `≈ ${formatMoneyWithCode(toHome(amt), homeCurrency)}` : null;

  // big number + footer, shown in the paying account's own currency
  const accountCurrency = accounts.find((a) => a.id === bill.accountId)?.primaryCode ?? homeCurrency;
  const heroAcct = amountInAccountCurrency(bill.total, bill, accountCurrency, homeCurrency);
  const { big: heroBig, footers: heroFooters } = accountAmountDisplay({
    accountCurrency: heroAcct.currency, accountAmount: heroAcct.amount,
    txCurrency: currency, txAmount: bill.total,
    homeCurrency, homeAmount: toHome(bill.total),
  });

  // work out the home and account amounts for the linked expense
  function linkedAmountFields(amt: number, account?: Account) {
    const amountInHomeCurrency = Math.round(amt * homeRate * 100) / 100;
    const acctCode = account?.primaryCode;
    if (acctCode && acctCode !== currency && bill.entryToAccountRate != null) {
      return {
        amountInHomeCurrency,
        accountCurrencyAtEntry: acctCode,
        accountAmount: Math.round(amt * bill.entryToAccountRate * 100) / 100,
      };
    }
    return { amountInHomeCurrency, accountCurrencyAtEntry: null, accountAmount: null };
  }

  async function handleSettle(personName: string) {
    if (settling) return;
    setSettling(personName);
    try {
      const account = accounts.find((a) => a.id === bill.accountId);
      await settleSplitEntry(bill.id, personName);
      const delta = calculateSettlementBalanceEffect(bill, personName);
      if (account && delta !== 0) {
        await updateSubBalance(bill.accountId, account.primaryCode ?? 'SGD', delta);
      }
      let newLinkedId = bill.linkedExpenseId;
      if (bill.paidBy === 'me') {
        // update or remove the auto-made expense for this bill
        const remainingUnsettled = bill.entries
          .filter((e) => e.person !== personName && !e.settled)
          .reduce((s, e) => s + e.share, 0);
        if (newLinkedId) {
          if (remainingUnsettled > 0) {
            await updateExpense(newLinkedId, {
              amount: remainingUnsettled,
              ...linkedAmountFields(remainingUnsettled, account),
            });
          } else {
            await deleteExpense(newLinkedId);
            await updateSplitBill(bill.id, { linkedExpenseId: null });
            newLinkedId = null;
          }
        }
      } else if (!bill.linkedExpenseId) {
        // someone else paid, so paying my share now makes it a real expense
        const expense = (await addExpense({
          accountId: bill.accountId, categoryId: bill.categoryId,
          merchant: bill.merchant, amount: bill.myShare, currency: bill.currency,
          exchangeRateAtEntry: bill.liveRate ?? 1,
          ...linkedAmountFields(bill.myShare, account),
          date: bill.date, receiptImageUri: null,
          isShared: false, splitType: null, splitDetails: null, notes: bill.notes,
        })) as { id: string };
        newLinkedId = expense.id;
        await updateSplitBill(bill.id, { linkedExpenseId: newLinkedId });
      }
      setBill((prev) => ({
        ...prev,
        linkedExpenseId: newLinkedId,
        entries: prev.entries.map((e) =>
          e.person === personName
            ? { ...e, settled: true, settledAt: new Date().toISOString().slice(0, 10) }
            : e,
        ),
      }));
    } catch {
      Alert.alert('Error', 'Could not mark as settled.');
    } finally {
      setSettling(null);
    }
  }

  async function handleUnsettle(personName: string) {
    if (settling) return;
    setSettling(personName);
    try {
      const account = accounts.find((a) => a.id === bill.accountId);
      const delta = calculateSettlementBalanceEffect(bill, personName);
      if (account && delta !== 0) {
        await updateSubBalance(bill.accountId, account.primaryCode ?? 'SGD', -delta);
      }
      let newLinkedId = bill.linkedExpenseId;
      if (bill.paidBy === 'me') {
        // put back the expense that tracks what others owe
        const newUnsettledTotal = bill.entries
          .filter((e) => e.person === personName || !e.settled)
          .reduce((s, e) => s + e.share, 0);
        if (newLinkedId) {
          await updateExpense(newLinkedId, {
            amount: newUnsettledTotal,
            ...linkedAmountFields(newUnsettledTotal, account),
          });
        } else {
          // it was deleted once all settled, so make it again
          const expense = (await addExpense({
            accountId: bill.accountId, categoryId: bill.categoryId,
            merchant: `Unsettled bill · ${bill.merchant}`,
            amount: newUnsettledTotal, currency: bill.currency,
            exchangeRateAtEntry: bill.liveRate ?? 1,
            ...linkedAmountFields(newUnsettledTotal, account),
            date: bill.date, receiptImageUri: null,
            isShared: false, splitType: null, splitDetails: null, notes: bill.notes,
            source: 'split_unsettled',
            kind: 'mustBuy',
          })) as { id: string };
          newLinkedId = expense.id;
          await updateSplitBill(bill.id, { linkedExpenseId: newLinkedId });
        }
      } else if (bill.linkedExpenseId) {
        // paidBy=other: delete linked expense, clear link
        await deleteExpense(bill.linkedExpenseId);
        await updateSplitBill(bill.id, { linkedExpenseId: null });
        newLinkedId = null;
      }
      await unsettleSplitEntry(bill.id, personName);
      setBill((prev) => ({
        ...prev,
        linkedExpenseId: newLinkedId,
        entries: prev.entries.map((e) =>
          e.person === personName ? { ...e, settled: false, settledAt: null } : e,
        ),
      }));
    } catch {
      Alert.alert('Error', 'Could not undo.');
    } finally {
      setSettling(null);
    }
  }

  async function handleChangeAccount(newAccountId: string) {
    if (changingAccount || newAccountId === bill.accountId) {
      setShowAccountPicker(false);
      return;
    }
    setChangingAccount(true);
    setShowAccountPicker(false);
    try {
      const oldAccount = accounts.find((a) => a.id === bill.accountId);
      const newAccount = accounts.find((a) => a.id === newAccountId);
      if (bill.linkedExpenseId) {
        await updateExpense(bill.linkedExpenseId, { accountId: newAccountId });
      }
      await updateSplitBill(bill.id, { accountId: newAccountId });
      // take it off the old account, add it to the new one
      const share = bill.myShare;
      if (oldAccount && share !== 0) {
        await updateSubBalance(bill.accountId, oldAccount.primaryCode ?? 'SGD', share);
      }
      if (newAccount && share !== 0) {
        await updateSubBalance(newAccountId, newAccount.primaryCode ?? 'SGD', -share);
      }
      setBill((prev) => ({ ...prev, accountId: newAccountId }));
    } catch {
      Alert.alert('Error', 'Could not change account.');
    } finally {
      setChangingAccount(false);
    }
  }

  async function handleDelete() {
    Alert.alert(
      'Delete split bill',
      `Delete "${bill.merchant}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              if (bill.paidBy === 'me') {
                const account = accounts.find((a) => a.id === bill.accountId);
                if (account) {
                  await updateSubBalance(bill.accountId, account.primaryCode ?? 'SGD', bill.total);
                }
              }
              if (bill.linkedExpenseId) await deleteExpense(bill.linkedExpenseId);
              if (bill.myExpenseId) await deleteExpense(bill.myExpenseId);
              await deleteSplitBill(bill.id);
              navigation.goBack();
            } catch {
              Alert.alert('Error', 'Could not delete the split bill.');
              setDeleting(false);
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top']}>
      {/* ── Header ── */}
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()} style={styles.headerSide}>
          <Feather name="chevron-left" size={22} color={t.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.text }]}>Split detail</Text>
        <View style={[styles.headerSide, styles.headerActions]}>
          <Pressable
            hitSlop={12}
            onPress={handleDelete}
            disabled={deleting}
          >
            <Feather name="trash-2" size={18} color={t.danger} />
          </Pressable>
          <Pressable
            hitSlop={12}
            onPress={() => navigation.navigate('AddSplit', { editBill: bill })}
          >
            <Feather name="edit-2" size={18} color={t.accent} />
          </Pressable>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* ── Hero ── */}
        <View style={styles.heroBlock}>
          {bill.notes ? (
            <Text style={[styles.heroSub, { color: t.muted }]}>
              {bill.merchant} · {bill.notes}
            </Text>
          ) : (
            <Text style={[styles.heroSub, { color: t.muted }]}>{bill.merchant}</Text>
          )}
          <Text style={[styles.heroAmount, { color: t.text }]}>
            {heroBig}
          </Text>
          {heroFooters.length > 0 && (
            <Text style={[styles.heroConv, { color: t.muted }]}>{heroFooters.join(' · ')}</Text>
          )}
          <Text style={[styles.heroPill, { color: t.muted }]}>
            {fmtDate(bill.date, { day: 'numeric', month: 'short' })} · {splitTypeLabel(bill.splitType)}
          </Text>
        </View>

        {/* ── Items + breakdown card (items mode) ── */}
        {hasItems && (
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.cardEyebrow, { color: t.muted }]}>ITEMS</Text>

            {/* Each item: name, who shares it, price + home conversion */}
            {bill.splitItems!.map((it, i) => (
              <View key={`${it.name}-${i}`} style={[styles.itemRow, { borderTopColor: t.border }]}>
                <View style={styles.itemMid}>
                  <Text style={[styles.itemName, { color: t.text }]} numberOfLines={1}>
                    {it.name || `Item ${i + 1}`}
                  </Text>
                  <Text style={[styles.itemSharers, { color: t.muted }]} numberOfLines={2}>
                    shared by {it.sharerPersonNames.length > 0 ? it.sharerPersonNames.join(', ') : '—'}
                  </Text>
                </View>
                <View style={styles.itemAmtCol}>
                  <Text style={[styles.breakdownAmt, { color: t.text }]}>
                    {formatMoneyWithCode(it.price, currency)}
                  </Text>
                  {isForeign && <Text style={[styles.itemConv, { color: t.muted }]}>{homeConv(it.price)}</Text>}
                </View>
              </View>
            ))}

            {/* Charges + total */}
            <View style={[styles.breakdownRow, styles.breakdownTopBorder, { borderTopColor: t.border }]}>
              <Text style={[styles.breakdownLabel, { color: t.muted }]}>Items subtotal</Text>
              <Text style={[styles.breakdownAmt, { color: t.muted }]}>{formatMoneyWithCode(itemsSubtotal, currency)}</Text>
            </View>
            {gstAmt > 0 && (
              <View style={[styles.breakdownRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.breakdownLabel, { color: t.muted }]}>GST {fees!.gst}%</Text>
                <Text style={[styles.breakdownAmt, { color: t.muted }]}>{formatMoneyWithCode(gstAmt, currency)}</Text>
              </View>
            )}
            {svcAmt > 0 && (
              <View style={[styles.breakdownRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.breakdownLabel, { color: t.muted }]}>Service charge {fees!.serviceCharge}%</Text>
                <Text style={[styles.breakdownAmt, { color: t.muted }]}>{formatMoneyWithCode(svcAmt, currency)}</Text>
              </View>
            )}
            {deliveryAmt > 0 && (
              <View style={[styles.breakdownRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.breakdownLabel, { color: t.muted }]}>Delivery</Text>
                <Text style={[styles.breakdownAmt, { color: t.muted }]}>{formatMoneyWithCode(deliveryAmt, currency)}</Text>
              </View>
            )}
            <View style={[styles.breakdownRow, styles.breakdownTopBorder, { borderTopColor: t.border }]}>
              <Text style={[styles.breakdownLabel, { color: t.text, fontWeight: '700' }]}>Total</Text>
              <View style={styles.itemAmtCol}>
                <Text style={[styles.breakdownAmt, { color: t.text, fontWeight: '700' }]}>
                  {formatMoneyWithCode(bill.total, currency)}
                </Text>
                {isForeign && <Text style={[styles.itemConv, { color: t.muted }]}>{homeConv(bill.total)}</Text>}
              </View>
            </View>
          </View>
        )}

        {/* ── Payer / people card ── */}
        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={[styles.cardEyebrow, { color: t.muted }]}>
            {isIPaid ? 'YOU PAID THE BILL' : `${bill.paidByName?.toUpperCase() ?? 'THEY'} PAID THE BILL`}
          </Text>

          {/* Me row — always "You" */}
          <View style={[styles.payerRow, { borderTopColor: t.border }]}>
            <View style={[styles.payerAvatar, { backgroundColor: t.accentSoft }]}>
              <Text style={[styles.payerInitial, { color: t.accentInk }]}>M</Text>
            </View>
            <View style={styles.payerMid}>
              <Text style={[styles.payerName, { color: t.text }]}>You</Text>
              <Text style={[styles.payerSub, { color: t.muted }]}>
                your share {formatMoneyWithCode(bill.myShare, currency)}{isForeign ? ` · ${homeConv(bill.myShare)}` : ''}
              </Text>
            </View>
          </View>

          {/* Payer row — their own share (when someone else paid) */}
          {!isIPaid && (
            <View style={[styles.payerRow, { borderTopColor: t.border }]}>
              <View style={[styles.payerAvatar, { backgroundColor: t.accentSoft }]}>
                <Text style={[styles.payerInitial, { color: t.accentInk }]}>
                  {(bill.paidByName?.[0] ?? '?').toUpperCase()}
                </Text>
              </View>
              <View style={styles.payerMid}>
                <Text style={[styles.payerName, { color: t.text }]}>{bill.paidByName ?? 'Payer'}</Text>
                {payerShare != null && payerShare > 0 && (
                  <Text style={[styles.payerSub, { color: t.muted }]}>
                    their share {formatMoneyWithCode(payerShare, currency)}{isForeign ? ` · ${homeConv(payerShare)}` : ''}
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Group members — info only, no action (when someone else paid) */}
          {!isIPaid && bill.groupMembers && bill.groupMembers.map((gm) => (
            <View key={gm.name} style={[styles.payerRow, { borderTopColor: t.border }]}>
              <View style={[styles.payerAvatar, { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }]}>
                <Text style={[styles.payerInitial, { color: t.muted }]}>
                  {(gm.name[0] ?? '?').toUpperCase()}
                </Text>
              </View>
              <View style={styles.payerMid}>
                <Text style={[styles.payerName, { color: t.text }]}>{gm.name}</Text>
                <Text style={[styles.payerSub, { color: t.muted }]}>
                  {formatMoneyWithCode(gm.share, currency)}{isForeign ? ` · ${homeConv(gm.share)}` : ''}
                </Text>
              </View>
            </View>
          ))}

          {/* Entry rows with settle buttons — only when I paid */}
          {isIPaid && bill.entries.map((entry) => {
            const isSettlingThis = settling === entry.person;
            return (
              <View key={entry.person} style={[styles.payerRow, { borderTopColor: t.border }]}>
                <View style={[
                  styles.payerAvatar,
                  {
                    backgroundColor: entry.settled ? t.surface : t.accentSoft,
                    borderColor: t.border,
                    borderWidth: entry.settled ? 1 : 0,
                  },
                ]}>
                  <Text style={[styles.payerInitial, { color: entry.settled ? t.muted : t.accentInk }]}>
                    {entry.person[0].toUpperCase()}
                  </Text>
                </View>
                <View style={styles.payerMid}>
                  <Text style={[styles.payerName, { color: t.text }]}>
                    {isIPaid ? `${entry.person} owes you` : `You owe ${entry.person}`}
                  </Text>
                  <Text style={[styles.payerSub, { color: t.muted }]}>
                    {formatMoneyWithCode(entry.share, currency)}
                    {isForeign ? ` · ${homeConv(entry.share)}` : ''}
                    {entry.settled && entry.settledAt
                      ? ` · settled ${fmtDate(entry.settledAt, { day: 'numeric', month: 'short' })}`
                      : ' · open'}
                  </Text>
                </View>

                {entry.settled ? (
                  <Pressable
                    style={[
                      styles.settleRowBtn,
                      { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
                      isSettlingThis && { opacity: 0.6 },
                    ]}
                    onPress={() => handleUnsettle(entry.person)}
                    disabled={!!settling}
                  >
                    <Text style={[styles.settleRowBtnText, { color: t.muted }]}>Undo</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[
                      styles.settleRowBtn,
                      { backgroundColor: t.accent },
                      isSettlingThis && { opacity: 0.6 },
                    ]}
                    onPress={() => handleSettle(entry.person)}
                    disabled={!!settling}
                  >
                    <Text style={[styles.settleRowBtnText, { color: t.onAccent }]}>
                      {isIPaid ? 'Received' : 'Pay'}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>

        {/* ── Repayments ── */}
        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={[styles.cardEyebrow, { color: t.muted }]}>REPAYMENTS</Text>

          {isIPaid ? (
            <>
              {settledEntries.map((entry, idx) => (
                <View key={entry.person} style={[styles.timelineRow, { borderTopColor: t.border }]}>
                  <View style={styles.timelineLine}>
                    <View style={[styles.timelineDotFilled, { backgroundColor: t.accent }]} />
                    {(idx < settledEntries.length - 1 || openEntries.length > 0) && (
                      <View style={[styles.timelineConnector, { backgroundColor: t.border }]} />
                    )}
                  </View>
                  <View style={styles.timelineMid}>
                    <Text style={[styles.timelineMain, { color: t.text }]}>
                      {entry.person} paid back{' '}
                      <Text style={{ fontVariant: ['tabular-nums'] }}>
                        {formatMoneyWithCode(entry.share, currency)}
                      </Text>
                      {entry.settledAt ? ` · ${fmtDate(entry.settledAt, { day: 'numeric', month: 'short' })}` : ''}
                    </Text>
                    <Text style={[styles.timelineSub, { color: t.muted }]}>
                      {isForeign ? `${homeConv(entry.share)} · added to account balance` : 'added to account balance'}
                    </Text>
                  </View>
                  <Text style={[styles.timelineAmt, { color: t.accent }]}>
                    +{formatMoney(entry.share, currency)}
                  </Text>
                </View>
              ))}
              {settledEntries.length === 0 && (
                <View style={[styles.timelineRow, { borderTopColor: t.border }]}>
                  <Text style={[styles.timelineSub, { color: t.muted }]}>No repayments yet.</Text>
                </View>
              )}
            </>
          ) : (
            <>
              {bill.entries.map((entry) => (
                <View key={entry.person} style={[styles.repayRow, { borderTopColor: t.border }]}>
                  <View style={styles.payerMid}>
                    {entry.settled ? (
                      <>
                        <Text style={[styles.payerName, { color: t.text }]}>You have settled the bill</Text>
                        <Pressable onPress={() => setShowAccountPicker(true)} disabled={changingAccount}>
                          <Text style={[styles.payerSub, { color: t.accent }]}>
                            {accounts.find((a) => a.id === bill.accountId)?.name ?? 'account'} · tap to change
                          </Text>
                        </Pressable>
                        {entry.settledAt && (
                          <Text style={[styles.payerSub, { color: t.muted }]}>
                            {fmtDate(entry.settledAt, { day: 'numeric', month: 'short' })}
                          </Text>
                        )}
                      </>
                    ) : (
                      <>
                        <Text style={[styles.payerName, { color: t.text }]}>
                          Still owed {formatMoneyWithCode(entry.share, currency)} to {entry.person}
                        </Text>
                        {isForeign && (
                          <Text style={[styles.payerSub, { color: t.muted }]}>{homeConv(entry.share)}</Text>
                        )}
                      </>
                    )}
                  </View>
                  {entry.settled ? (
                    <Pressable
                      style={[
                        styles.settleRowBtn,
                        { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
                        settling === entry.person && { opacity: 0.6 },
                      ]}
                      onPress={() => handleUnsettle(entry.person)}
                      disabled={!!settling}
                    >
                      <Text style={[styles.settleRowBtnText, { color: t.muted }]}>Undo</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={[
                        styles.settleRowBtn,
                        { backgroundColor: t.accent },
                        settling === entry.person && { opacity: 0.6 },
                      ]}
                      onPress={() => handleSettle(entry.person)}
                      disabled={!!settling}
                    >
                      <Text style={[styles.settleRowBtnText, { color: t.onAccent }]}>Mark as paid</Text>
                    </Pressable>
                  )}
                </View>
              ))}
              {bill.entries.length === 0 && (
                <View style={[styles.timelineRow, { borderTopColor: t.border }]}>
                  <Text style={[styles.timelineSub, { color: t.muted }]}>No entries.</Text>
                </View>
              )}
            </>
          )}
        </View>

        <View style={{ height: Spacing.four }} />
      </ScrollView>

      {/* ── Account picker modal ── */}
      <Modal visible={showAccountPicker} transparent animationType="fade" onRequestClose={() => setShowAccountPicker(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowAccountPicker(false)}>
          <View style={[styles.modalSheet, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={[styles.modalTitle, { color: t.text }]}>Change account</Text>
            {accounts.map((acct) => (
              <Pressable
                key={acct.id}
                style={[
                  styles.modalRow,
                  { borderTopColor: t.border },
                  acct.id === bill.accountId && { backgroundColor: t.accentSoft },
                ]}
                onPress={() => handleChangeAccount(acct.id)}
              >
                <Text style={[styles.modalRowText, { color: t.text }]}>{acct.name}</Text>
                {acct.id === bill.accountId && (
                  <Feather name="check" size={16} color={t.accent} />
                )}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
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
  headerSide: { width: 72, alignItems: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16, justifyContent: 'flex-end' },
  headerTitle: { fontSize: 17, fontWeight: '600' },

  scrollContent: { paddingHorizontal: ScreenPadding, paddingTop: Spacing.three, gap: 12 },

  heroBlock: { alignItems: 'center', gap: 6, paddingBottom: 4 },
  heroSub: { fontSize: 15 },
  heroAmount: { fontSize: 36, fontWeight: '600', letterSpacing: -1.2, fontVariant: ['tabular-nums'] as any },
  heroConv: { fontSize: 13, fontVariant: ['tabular-nums'] as any, marginTop: -2 },
  heroPill: { fontSize: 13 },

  itemRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
    paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  itemMid: { flex: 1, gap: 2 },
  itemName: { fontSize: 14, fontWeight: '600' },
  itemSharers: { fontSize: 12 },
  itemAmtCol: { alignItems: 'flex-end', gap: 2 },
  itemConv: { fontSize: 11, fontVariant: ['tabular-nums'] as any },
  breakdownTopBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0 },

  card: { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden', padding: 16 },
  cardEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 },

  breakdownRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  breakdownLabel: { fontSize: 14 },
  breakdownAmt: { fontSize: 14, fontVariant: ['tabular-nums'] as any },

  payerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 12, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth,
  },
  payerAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  payerInitial: { fontSize: 14, fontWeight: '700' },
  payerMid: { flex: 1, gap: 2 },
  payerName: { fontSize: 15, fontWeight: '600' },
  payerSub: { fontSize: 12 },
  settledBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  settledBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  repayRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth,
  },
  settleRowBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  settleRowBtnText: { fontSize: 13, fontWeight: '700' },

  timelineRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth,
  },
  timelineLine: { alignItems: 'center', width: 16, paddingTop: 2 },
  timelineDotFilled: { width: 10, height: 10, borderRadius: 5 },
  timelineDotHollow: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  timelineConnector: { width: 2, flex: 1, minHeight: 16, marginTop: 4 },
  timelineMid: { flex: 1, gap: 2 },
  timelineMain: { fontSize: 14, fontWeight: '500' },
  timelineSub: { fontSize: 12 },
  timelineAmt: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] as any },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderWidth: 1, paddingBottom: 32,
  },
  modalTitle: {
    fontSize: 13, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  modalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  modalRowText: { fontSize: 16 },
});
