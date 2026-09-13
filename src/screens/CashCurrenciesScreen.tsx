/* eslint-disable */
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CurrencyPickerModal } from '../components/CurrencyPickerModal';
import { NumericKeypad, applyNumpadKey, formatAmountDisplay, rawToAmount, amountToRaw } from '../components/NumericKeypad';
import { Radii, ScreenPadding, Spacing } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { formatMoney } from '../logic/moneyFormatter';
import { getRatesFromHome } from '../api/exchangeRate';
import { getAccounts, getSettings, accountHomeTotal, updateSubBalance, updateSettings, deleteAccountWithExpenses, countAccountEntries } from '../storage/storage';

type CurrencyBalance = { code: string; balance: number };
type Account = {
  id: string; name: string; type: string;
  primaryCode: string; currencies: CurrencyBalance[];
};

export default function CashCurrenciesScreen({ route, navigation }: any) {
  const t = useTheme();
  const accountId: string = route.params?.accountId;

  const [account, setAccount] = useState<Account | null>(null);
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [ratesFromHome, setRatesFromHome] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [isDefault, setIsDefault] = useState(false);

  // ── Add currency modal state
  const [showAdd, setShowAdd] = useState(false);
  const [addCode, setAddCode] = useState('');
  const [addBalance, setAddBalance] = useState('');
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [showAddNumpad, setShowAddNumpad] = useState(false);

  // ── Edit currency balance modal state
  const [editCurrency, setEditCurrency] = useState<CurrencyBalance | null>(null);
  const [editBalance, setEditBalance] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [showEditNumpad, setShowEditNumpad] = useState(false);

  // ── Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [entryCount, setEntryCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadData(cancelled).then((c) => { if (!c) setLoading(false); });
      (countAccountEntries as (id: string) => Promise<number>)(accountId).then(setEntryCount);
      return () => { cancelled = true; };
    }, [accountId]),
  );

  async function loadData(cancelled = false): Promise<boolean> {
    const [accounts, settings] = await Promise.all([getAccounts(), getSettings()]);
    if (cancelled) return true;
    const acc = accounts.find((a: Account) => a.id === accountId) ?? null;
    const home = settings.homeCurrency ?? 'SGD';
    setAccount(acc);
    setHomeCurrency(home);
    setIsDefault(settings.defaultAccountId === accountId);
    if (acc) {
      const foreign = acc.currencies.map((c: CurrencyBalance) => c.code).filter((c: string) => c !== home);
      const rates = await getRatesFromHome(home, foreign);
      if (!cancelled) setRatesFromHome(rates);
    }
    return false;
  }

  async function refresh() {
    await loadData();
  }

  // ── Add currency
  async function handleAddCurrency() {
    const code = addCode.trim().toUpperCase();
    if (!code) { Alert.alert('Currency required', 'Please select a currency.'); return; }
    const balance = rawToAmount(addBalance, addCode);
    if (account?.currencies.some((c) => c.code === code)) {
      Alert.alert('Already added', `${code} is already in this wallet. Tap its row to edit the balance.`);
      return;
    }
    setAddSaving(true);
    try {
      await (updateSubBalance as (id: string, code: string, delta: number) => Promise<void>)(accountId, code, balance);
      setShowAdd(false);
      setShowAddNumpad(false);
      setAddCode('');
      setAddBalance('');
      await refresh();
    } catch {
      Alert.alert('Error', 'Could not add currency.');
    } finally { setAddSaving(false); }
  }

  // ── Edit existing currency balance
  function openEdit(c: CurrencyBalance) {
    setEditCurrency(c);
    setEditBalance(amountToRaw(c.balance, c.code));
  }

  async function handleEditSave() {
    if (!editCurrency || !account) return;
    const newBal = rawToAmount(editBalance, editCurrency.code);
    const delta = newBal - editCurrency.balance;
    setEditSaving(true);
    try {
      await (updateSubBalance as (id: string, code: string, delta: number) => Promise<void>)(accountId, editCurrency.code, delta);
      setEditCurrency(null);
      setShowEditNumpad(false);
      await refresh();
    } catch {
      Alert.alert('Error', 'Could not update balance.');
    } finally { setEditSaving(false); }
  }

  function confirmRemoveCurrency(c: CurrencyBalance) {
    Alert.alert(
      `Remove ${c.code}?`,
      `This will zero out the ${c.code} balance and remove it from this wallet.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            const delta = -c.balance;
            await (updateSubBalance as (id: string, code: string, delta: number) => Promise<void>)(accountId, c.code, delta);
            // remove it from the currencies list
            const accounts = await getAccounts();
            const target = accounts.find((a: Account) => a.id === accountId);
            if (target) {
              const { updateAccount } = await import('../storage/storage');
              await updateAccount(accountId, {
                currencies: target.currencies.filter((cur: CurrencyBalance) => cur.code !== c.code),
              });
            }
            setEditCurrency(null);
            await refresh();
          },
        },
      ],
    );
  }

  async function handleToggleDefault() {
    const next = !isDefault;
    setIsDefault(next);
    await (updateSettings as (ch: any) => Promise<any>)({
      defaultAccountId: next ? accountId : null,
    });
  }

  async function handleDelete() {
    await (deleteAccountWithExpenses as (id: string) => Promise<void>)(accountId);
    navigation.goBack();
  }

  if (loading || !account) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top']}>
        <ActivityIndicator color={t.accent} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  const total = accountHomeTotal(account, homeCurrency, ratesFromHome);
  const currencyCount = account.currencies.length;

  function subLine(c: CurrencyBalance): string {
    if (c.code === homeCurrency) return 'Home currency';
    const rate = ratesFromHome[c.code];
    if (!rate) return c.code;
    const homeAmt = c.balance / rate;
    return `≈ ${homeCurrency} ${formatMoney(homeAmt, homeCurrency)} · 1 ${homeCurrency} = ${rate.toFixed(1)} ${c.code}`;
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top']}>
      {/* ── Header ── */}
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Feather name="arrow-left" size={20} color={t.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.text }]}>{account.name}</Text>
        <Pressable hitSlop={12} onPress={() => setShowDeleteConfirm(true)}>
          <Feather name="trash-2" size={19} color={t.danger} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: ScreenPadding }]}>
        {/* ── Hero ── */}
        <View style={styles.hero}>
          <Text style={[styles.eyebrow, { color: t.muted }]}>TOTAL IN {homeCurrency}</Text>
          <Text style={[styles.heroAmount, { color: t.text }]}>
            {formatMoney(total, homeCurrency)}
          </Text>
          <Text style={[styles.heroSub, { color: t.muted }]}>
            {currencyCount} {currencyCount === 1 ? 'currency' : 'currencies'} · rates from today
          </Text>
        </View>

        {/* ── Currency list ── */}
        <Text style={[styles.sectionHeader, { color: t.muted }]}>CURRENCIES</Text>

        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          {account.currencies.map((c, i) => (
            <View key={c.code}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: t.border }]} />}
              <Pressable style={styles.currencyRow} onPress={() => openEdit(c)}>
                <View style={[styles.badge, { backgroundColor: t.accentSoft }]}>
                  <Text style={[styles.badgeText, { color: t.accentInk }]}>{c.code}</Text>
                </View>
                <View style={styles.currencyMeta}>
                  <Text style={[styles.currencyAmount, { color: t.text }]}>
                    {formatMoney(c.balance, c.code)}
                  </Text>
                  <Text style={[styles.currencySub, { color: t.muted }]} numberOfLines={1}>
                    {subLine(c)}
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color={t.muted} />
              </Pressable>
            </View>
          ))}
        </View>

        {/* ── Default account toggle ── */}
        <Pressable
          style={[styles.defaultRow, { borderColor: t.border, backgroundColor: t.surface }]}
          onPress={handleToggleDefault}
        >
          <View style={styles.defaultMeta}>
            <Text style={[styles.defaultLabel, { color: t.text }]}>Default account</Text>
            <Text style={[styles.defaultHint, { color: t.muted }]}>New entries will default to this account.</Text>
          </View>
          <View style={[styles.toggle, { backgroundColor: isDefault ? t.accent : t.track }]}>
            <View style={[styles.toggleThumb, { transform: [{ translateX: isDefault ? 18 : 2 }] }]} />
          </View>
        </Pressable>

        <View style={styles.footerGap} />
        <Pressable style={[styles.primaryBtn, { backgroundColor: t.accent }]} onPress={() => setShowAdd(true)}>
          <Feather name="plus" size={18} color={t.onAccent} />
          <Text style={[styles.primaryBtnText, { color: t.onAccent }]}>Add currency</Text>
        </Pressable>
      </ScrollView>

      {/* ── Add currency modal ── */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAdd(false)}>
        <View style={[styles.modalRoot, { backgroundColor: t.bg }]}>
          <SafeAreaView style={styles.flex} edges={['top']}>
            <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
              <Pressable onPress={() => { setShowAdd(false); setShowAddNumpad(false); setAddCode(''); setAddBalance(''); }} hitSlop={8} style={styles.headerSlot}>
                <Text style={[styles.cancel, { color: t.muted }]}>Cancel</Text>
              </Pressable>
              <Text style={[styles.modalTitle, { color: t.text }]}>Add Currency</Text>
              <View style={styles.headerSlot} />
            </View>
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: t.muted }]}>CURRENCY</Text>
                <Pressable
                  style={[styles.currencyTrigger, { backgroundColor: t.surface, borderColor: t.border }]}
                  onPress={() => { setShowAddNumpad(false); setShowCurrencyPicker(true); }}
                >
                  <Text style={[styles.currencyTriggerText, { color: addCode ? t.text : t.muted }]}>
                    {addCode || 'Select currency'}
                  </Text>
                  <Feather name="chevron-down" size={14} color={t.muted} />
                </Pressable>
                <CurrencyPickerModal
                  visible={showCurrencyPicker}
                  selected={addCode}
                  onSelect={(code) => { setAddCode(code); setAddBalance(''); }}
                  onClose={() => setShowCurrencyPicker(false)}
                />
              </View>
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: t.muted }]}>STARTING BALANCE</Text>
                <Pressable
                  style={[styles.input, { backgroundColor: t.surface, borderColor: t.border, justifyContent: 'center' }]}
                  onPress={() => setShowAddNumpad(true)}
                >
                  <Text style={[styles.inputText, { color: t.text }]}>
                    {formatAmountDisplay(addBalance, addCode || undefined)}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
            <View style={[styles.modalFooter, { borderTopColor: t.border, paddingHorizontal: ScreenPadding }]}>
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: t.accent }, addSaving && styles.dimmed]}
                onPress={handleAddCurrency}
                disabled={addSaving}
              >
                {addSaving
                  ? <ActivityIndicator color={t.onAccent} />
                  : <Text style={[styles.primaryBtnText, { color: t.onAccent }]}>Add</Text>}
              </Pressable>
            </View>
          </SafeAreaView>
          {showAddNumpad && (
            <>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAddNumpad(false)} />
              <NumericKeypad onKey={(k) => setAddBalance((s) => applyNumpadKey(s, k, addCode || undefined))} />
            </>
          )}
        </View>
      </Modal>

      {/* ── Edit balance modal ── */}
      <Modal visible={editCurrency !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditCurrency(null)}>
        <View style={[styles.modalRoot, { backgroundColor: t.bg }]}>
          <SafeAreaView style={styles.flex} edges={['top']}>
            <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
              <Pressable onPress={() => { setEditCurrency(null); setShowEditNumpad(false); }} hitSlop={8} style={styles.headerSlot}>
                <Text style={[styles.cancel, { color: t.muted }]}>Cancel</Text>
              </Pressable>
              <Text style={[styles.modalTitle, { color: t.text }]}>{editCurrency?.code} Balance</Text>
              <Pressable
                hitSlop={8}
                style={styles.headerSlot}
                onPress={() => editCurrency && confirmRemoveCurrency(editCurrency)}
              >
                <Text style={[styles.removeText, { color: t.danger, textAlign: 'right' }]}>Remove</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: t.muted }]}>BALANCE ({editCurrency?.code})</Text>
                <Pressable
                  style={[styles.input, { backgroundColor: t.surface, borderColor: t.border, justifyContent: 'center' }]}
                  onPress={() => setShowEditNumpad(true)}
                >
                  <Text style={[styles.inputText, { color: t.text }]}>
                    {formatAmountDisplay(editBalance, editCurrency?.code)}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
            <View style={[styles.modalFooter, { borderTopColor: t.border, paddingHorizontal: ScreenPadding }]}>
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: t.accent }, editSaving && styles.dimmed]}
                onPress={handleEditSave}
                disabled={editSaving}
              >
                {editSaving
                  ? <ActivityIndicator color={t.onAccent} />
                  : <Text style={[styles.primaryBtnText, { color: t.onAccent }]}>Save</Text>}
              </Pressable>
            </View>
          </SafeAreaView>
          {showEditNumpad && (
            <>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowEditNumpad(false)} />
              <NumericKeypad onKey={(k) => setEditBalance((s) => applyNumpadKey(s, k, editCurrency?.code))} />
            </>
          )}
        </View>
      </Modal>

      {/* ── Delete confirm ── */}
      <Modal visible={showDeleteConfirm} transparent animationType="fade" onRequestClose={() => setShowDeleteConfirm(false)}>
        <View style={styles.overlayScrim}>
          <View style={[styles.overlayCard, { backgroundColor: t.surface }]}>
            <View style={[styles.warningIcon, { backgroundColor: t.dangerSoft }]}>
              <Feather name="alert-triangle" size={20} color={t.danger} />
            </View>
            <View style={styles.overlayText}>
              <Text style={[styles.overlayTitle, { color: t.text }]}>Delete {account.name}?</Text>
              <Text style={[styles.overlayBody, { color: t.muted }]}>
                All {entryCount} {entryCount === 1 ? 'entry' : 'entries'} in this account will be deleted permanently. This can't be undone.
              </Text>
            </View>
            <View style={styles.overlayBtns}>
              <Pressable style={[styles.overlayBtn, { borderColor: t.border, borderWidth: 1 }]} onPress={() => setShowDeleteConfirm(false)}>
                <Text style={[styles.overlayBtnText, { color: t.text }]}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.overlayBtn, { backgroundColor: t.danger }]} onPress={handleDelete}>
                <Text style={[styles.overlayBtnText, { color: '#fff' }]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two + Spacing.half,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18, fontWeight: '600' },

  content: { paddingTop: Spacing.four, paddingBottom: Spacing.six },

  hero: { gap: 6, marginBottom: 28 },
  eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase' },
  heroAmount: { fontSize: 38, fontWeight: '600', letterSpacing: -1.3, fontVariant: ['tabular-nums'] },
  heroSub: { fontSize: 12 },

  sectionHeader: { fontSize: 11, fontWeight: '600', marginBottom: 10, letterSpacing: 1.2, textTransform: 'uppercase' },

  card: { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },

  currencyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 14,
  },

  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, alignItems: 'center' },
  badgeText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },

  currencyMeta: { flex: 1, gap: 3 },
  currencyAmount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  currencySub: { fontSize: 12 },

  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },

  defaultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginTop: 12, borderRadius: Radii.card, borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  defaultMeta: { flex: 1, gap: 3 },
  defaultLabel: { fontSize: 15, fontWeight: '500' },
  defaultHint: { fontSize: 12, lineHeight: 17 },
  toggle: { width: 42, height: 26, borderRadius: 13, justifyContent: 'center' },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },

  footerGap: { height: Spacing.four },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.two, height: 54, borderRadius: Radii.button,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '600' },
  dimmed: { opacity: 0.5 },

  // Modal
  modalRoot: { flex: 1 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two + Spacing.half,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSlot: { minWidth: 60 },
  cancel: { fontSize: 13 },
  removeText: { fontSize: 13 },
  modalTitle: { fontSize: 16, fontWeight: '700' },
  modalContent: { paddingHorizontal: ScreenPadding, paddingTop: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  field: { gap: Spacing.two },
  fieldLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  input: {
    borderRadius: Radii.button, paddingHorizontal: 14, paddingVertical: 14,
    borderWidth: 1, minHeight: 52,
  },
  inputText: { fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  currencyTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'flex-start', borderRadius: Radii.button, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  currencyTriggerText: { fontSize: 14, fontWeight: '500' },
  modalFooter: { paddingTop: Spacing.two, paddingBottom: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },

  // Delete overlay
  overlayScrim: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  overlayCard: { width: '100%', borderRadius: 20, padding: 24, gap: 16 },
  warningIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  overlayText: { gap: 6 },
  overlayTitle: { fontSize: 17, fontWeight: '700' },
  overlayBody: { fontSize: 13, lineHeight: 20 },
  overlayBtns: { flexDirection: 'row', gap: 10 },
  overlayBtn: { flex: 1, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  overlayBtnText: { fontSize: 15, fontWeight: '600' },
});
