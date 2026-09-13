/* eslint-disable */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
const DateTimePicker = ({ value, onChange }: any) => {
  const d = value instanceof Date ? value : new Date(value);
  const str = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return (
    <TextInput
      style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 8, textAlign: 'center', color: '#000' }}
      defaultValue={str}
      placeholder="YYYY-MM-DD"
      onEndEditing={(e) => {
        const parsed = new Date(e.nativeEvent.text);
        if (!isNaN(parsed.getTime())) onChange({ type: 'set' }, parsed);
      }}
    />
  );
};
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '../components/themed-text';
import { CurrencyPickerModal } from '../components/CurrencyPickerModal';
import { NumericKeypad, applyNumpadKey, formatAmountDisplay, rawToAmount, amountToRaw } from '../components/NumericKeypad';
import { MaxContentWidth, Radii, ScreenPadding, Spacing } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import {
  applyExpenseToBalance,
  editExpenseBalance,
  reverseExpenseFromBalance,
  suggestCategory,
} from '../logic/businessLogic';
import {
  addExpense,
  addIncome,
  deleteExpense,
  getAccounts,
  getCategories,
  getSettings,
  updateSubBalance,
  updateExpense,
} from '../storage/storage';
import { getExchangeRate } from '../api/exchangeRate';

// types

type CurrencyBalance = { code: string; balance: number };
type Account = { id: string; name: string; primaryCode: string; currencies: CurrencyBalance[] };
type Category = { id: string; name: string; kind?: 'expense' | 'income' };
type SplitDetail = { person: string; orderAmount: number | null; shareAmount: number };
type EntryMode = 'expense' | 'income';

type StoredExpense = {
  id: string;
  accountId: string;
  categoryId: string;
  merchant: string;
  amount: number;
  currency: string;
  amountInHomeCurrency: number;
  exchangeRateAtEntry: number;
  date: string;
  receiptImageUri: string | null;
  isShared: boolean;
  splitType: 'equal' | 'percentage' | 'custom' | null;
  splitDetails: SplitDetail[] | null;
  notes: string | null;
  createdAt: string;
};

type FormState = {
  accountId: string;
  merchant: string;
  amount: string;
  currency: string;
  categoryId: string;
  date: Date;
  notes: string;
};

// helpers

function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function buildInitialForm(accounts: Account[], categories: Category[], defaultAccountId?: string): FormState {
  const defaultAcct = accounts.find((a) => a.id === defaultAccountId) ?? accounts[0];
  const other = categories.find((c) => c.name === 'Other') ?? categories[0];
  return {
    accountId: defaultAcct?.id ?? '',
    merchant: '',
    amount: '',
    currency: defaultAcct?.primaryCode ?? '',
    categoryId: other?.id ?? '',
    date: new Date(),
    notes: '',
  };
}

// AddExpenseScreen

export default function AddExpenseScreen({ route, navigation }: any) {
  const editExpense: StoredExpense | undefined = route.params?.editExpense;
  const prefillDate: string | undefined = route.params?.prefillDate;
  const t = useTheme();

  // ── mode (expense vs income; always expense in edit mode)
  const [mode, setMode] = useState<EntryMode>('expense');

  // ── reference data
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  // ── core form
  const [form, setForm] = useState<FormState>({
    accountId: '',
    merchant: '',
    amount: '',
    currency: '',
    categoryId: '',
    date: prefillDate ? new Date(prefillDate + 'T12:00:00') : new Date(),
    notes: '',
  });
  const [showDatePicker, setShowDatePicker] = useState(false);

  // ── meta
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [rateWarning, setRateWarning] = useState<string | null>(null);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showNumpad, setShowNumpad] = useState(false);
  const categoryManuallySet = useRef(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getAccounts() as Promise<Account[]>,
      getCategories() as Promise<Category[]>,
      getSettings() as Promise<{ homeCurrency: string; defaultAccountId?: string }>,
    ]).then(([accs, cats, settings]) => {
      setAccounts(accs);
      setCategories(cats);
      setHomeCurrency(settings.homeCurrency);
      categoryManuallySet.current = false;

      if (editExpense) {
        setForm({
          accountId: editExpense.accountId,
          merchant: editExpense.merchant,
          amount: amountToRaw(editExpense.amount, editExpense.currency),
          currency: editExpense.currency,
          categoryId: editExpense.categoryId,
          date: new Date(editExpense.date + 'T12:00:00'),
          notes: editExpense.notes ?? '',
        });
        categoryManuallySet.current = true;
      } else {
        setForm(buildInitialForm(accs, cats, settings.defaultAccountId));
        setMode('expense');
      }

      setRateWarning(null);
      setShowDatePicker(false);
      setLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── form handlers

  function handleMerchantChange(text: string) {
    setForm((f) => {
      if (!categoryManuallySet.current && categories.length > 0) {
        const name = suggestCategory(text);
        const match = categories.find((c) => c.name === name);
        return { ...f, merchant: text, categoryId: match?.id ?? f.categoryId };
      }
      return { ...f, merchant: text };
    });
  }

  function handleAccountSelect(accountId: string) {
    const account = accounts.find((a) => a.id === accountId);
    setForm((f) => ({ ...f, accountId, currency: account?.primaryCode ?? f.currency }));
  }

  function handleCategorySelect(categoryId: string) {
    categoryManuallySet.current = true;
    setForm((f) => ({ ...f, categoryId }));
  }

  function handleDateChange(_: unknown, date?: Date) {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (date) setForm((f) => ({ ...f, date }));
  }

  // ── income save logic — returns true on success

  async function doIncomeSave(): Promise<boolean> {
    const { accountId, amount: amountStr, currency, date, notes } = form;
    if (!accountId) { Alert.alert('Account required', 'Please select an account.'); return false; }
    const amount = rawToAmount(amountStr, currency || homeCurrency);
    if (!amountStr || amount <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid amount greater than 0.');
      return false;
    }
    setSaving(true);
    try {
      await addIncome({
        accountId,
        amount,
        currency: (currency || homeCurrency).trim().toUpperCase(),
        source: 'Income',
        date: date.toISOString().slice(0, 10),
        notes: (notes.trim() || null) as string | null,
      });
      return true;
    } catch (err) {
      Alert.alert('Error', 'Could not save income. Please try again.');
      console.error(err);
      return false;
    } finally {
      setSaving(false);
    }
  }

  // ── expense save logic — returns true on success

  async function doSave(): Promise<boolean> {
    const { accountId, merchant, amount: amountStr, currency, categoryId, date, notes } = form;

    if (!accountId) { Alert.alert('Account required', 'Please select an account.'); return false; }
    if (!merchant.trim()) { Alert.alert('Description required', 'Please enter a description.'); return false; }
    const amount = rawToAmount(amountStr, currency);
    if (!amountStr || amount <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid amount greater than 0.');
      return false;
    }
    if (!currency.trim()) { Alert.alert('Currency required', 'Please enter a currency code, e.g. SGD.'); return false; }
    if (!categoryId) { Alert.alert('Category required', 'Please select a category.'); return false; }

    const account = accounts.find((a) => a.id === accountId);
    if (!account) { Alert.alert('Error', 'Selected account not found.'); return false; }

    setSaving(true);
    try {
      const normalCurrency = currency.trim().toUpperCase();
      let exchangeRateAtEntry = 1;
      let amountInHomeCurrency = amount;
      if (normalCurrency !== homeCurrency) {
        const rate = await getExchangeRate(normalCurrency, homeCurrency);
        if (rate !== null) {
          exchangeRateAtEntry = rate;
          amountInHomeCurrency = Math.round(amount * rate * 100) / 100;
        } else {
          setRateWarning(`Live rate for ${normalCurrency} unavailable — amount saved unconverted.`);
          await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        }
      }

      const expenseFields = {
        accountId,
        categoryId,
        merchant: merchant.trim(),
        amount,
        currency: normalCurrency,
        amountInHomeCurrency,
        exchangeRateAtEntry,
        date: date.toISOString().slice(0, 10),
        receiptImageUri: editExpense?.receiptImageUri ?? null,
        isShared: false,
        splitType: null,
        splitDetails: null,
        notes: notes.trim() || null,
      };

      if (editExpense && (editExpense as any).source === 'split_unsettled') {
        Alert.alert('Cannot edit', 'This expense is managed automatically by a split bill.');
        return false;
      }
      if (editExpense) {
        const oldAccountId = editExpense.accountId;
        const oldAmount = editExpense.amount;
        if (oldAccountId === accountId) {
          // Net delta: reverse old, apply new
          await updateSubBalance(accountId, normalCurrency, oldAmount - amount);
        } else {
          const oldAccount = accounts.find((a) => a.id === oldAccountId);
          if (oldAccount) {
            await updateSubBalance(oldAccountId, oldAccount.primaryCode, oldAmount);
          }
          await updateSubBalance(accountId, normalCurrency, -amount);
        }
        await updateExpense(editExpense.id, expenseFields);
      } else {
        await addExpense(expenseFields);
        await updateSubBalance(accountId, normalCurrency, -amount);
      }

      return true;
    } catch (err) {
      Alert.alert('Error', 'Could not save the expense. Please try again.');
      console.error(err);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editExpense) return;
    if ((editExpense as any).source === 'split_unsettled') {
      Alert.alert('Cannot delete', 'This expense is managed automatically by a split bill.');
      return;
    }
    Alert.alert(
      'Delete expense?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              // put the money back before deleting
              await updateSubBalance(editExpense.accountId, editExpense.currency, editExpense.amount);
              await (deleteExpense as (id: string) => Promise<void>)(editExpense.id);
              navigation.goBack();
            } finally { setSaving(false); }
          },
        },
      ],
    );
  }

  async function handleCopy() {
    if (!editExpense) return;
    setSaving(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const copy = {
        accountId: editExpense.accountId,
        categoryId: editExpense.categoryId,
        merchant: editExpense.merchant,
        amount: editExpense.amount,
        currency: editExpense.currency,
        amountInHomeCurrency: editExpense.amountInHomeCurrency,
        exchangeRateAtEntry: editExpense.exchangeRateAtEntry,
        date: today,
        receiptImageUri: null,
        isShared: false,
        splitType: null,
        splitDetails: null,
        notes: editExpense.notes,
      };
      await addExpense(copy);
      await updateSubBalance(copy.accountId, copy.currency, -copy.amount);
      navigation.goBack();
    } finally { setSaving(false); }
  }

  async function handleSave() {
    const ok = mode === 'income' ? await doIncomeSave() : await doSave();
    if (ok) navigation.goBack();
  }

  async function handleContinue() {
    const ok = await doSave();
    if (ok) {
      setForm(buildInitialForm(accounts, categories));
      setRateWarning(null);
      setShowDatePicker(false);
      categoryManuallySet.current = false;
    }
  }

  const hr = <View style={[styles.hr, { backgroundColor: t.border }]} />;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <SafeAreaView style={styles.flex} edges={['top']}>

        {/* ── Header ── */}
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.headerSide}>
            <Feather name="chevron-left" size={22} color={t.muted} />
          </Pressable>
          <ThemedText type="stackTitle">
            {editExpense ? 'Edit Expense' : mode === 'income' ? 'Add Income' : 'Add Expense'}
          </ThemedText>
          <View style={styles.headerSide} />
        </View>

        {loading ? (
          <View style={styles.loadingCenter}>
            <ActivityIndicator color={t.accent} />
          </View>
        ) : (
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              contentContainerStyle={[styles.formContent, { alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth }]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >

              {/* ══ Mode toggle (new mode only) ══ */}
              {!editExpense && (
                <View style={[styles.modeToggle, { backgroundColor: t.surface, borderColor: t.border }]}>
                  {(['expense', 'income'] as EntryMode[]).map((m) => (
                    <Pressable
                      key={m}
                      style={[styles.modeChip, mode === m && { backgroundColor: t.accent }]}
                      onPress={() => setMode(m)}
                    >
                      <Text style={[styles.modeChipText, { color: mode === m ? t.onAccent : t.muted }]}>
                        {m === 'expense' ? 'Expense' : 'Income'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {/* ══ Amount block ══ */}
              <Pressable
                style={[styles.amountBlock, { backgroundColor: t.surface, borderColor: t.border }]}
                onPress={() => setShowNumpad(true)}
              >
                <Text style={[styles.amountEyebrow, { color: t.muted }]}>AMOUNT</Text>
                <View style={styles.amountRow}>
                  <Pressable
                    style={styles.currencyTrigger}
                    onPress={() => setShowCurrencyPicker(true)}
                  >
                    <Text style={[styles.currencyCode, { color: t.muted }]}>
                      {form.currency || homeCurrency}
                    </Text>
                    <Feather name="chevron-down" size={13} color={t.muted} />
                  </Pressable>
                  <CurrencyPickerModal
                    visible={showCurrencyPicker}
                    selected={form.currency}
                    onSelect={(code) => setForm((f) => ({ ...f, currency: code }))}
                    onClose={() => setShowCurrencyPicker(false)}
                  />
                  <Text
                    style={[styles.amountInput, { color: form.amount ? t.text : t.muted, flex: 1 }]}
                  >
                    {formatAmountDisplay(form.amount, form.currency || homeCurrency) || '0.00'}
                  </Text>
                  <View style={[styles.amountCaret, { backgroundColor: showNumpad ? t.accent : 'transparent' }]} />
                </View>
              </Pressable>

              {/* ══ Fields card ══ */}
              {mode === 'income' ? (
                <View style={[styles.fieldsCard, { backgroundColor: t.surface, borderColor: t.border }]}>
                  {/* Date */}
                  <Pressable style={styles.fieldRow} onPress={() => setShowDatePicker((v) => !v)}>
                    <Text style={[styles.fieldLabel, { color: t.muted }]}>Date</Text>
                    <View style={styles.fieldRight}>
                      <Text style={[styles.fieldValue, { color: t.text }]}>{formatDisplayDate(form.date)}</Text>
                      <Feather name="chevron-right" size={16} color={t.muted} />
                    </View>
                  </Pressable>
                  {showDatePicker && (
                    <View style={{ paddingHorizontal: ScreenPadding, paddingBottom: 8 }}>
                      <DateTimePicker value={form.date} mode="date"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        onChange={handleDateChange} />
                    </View>
                  )}
                  {hr}

                  {/* Account */}
                  <View style={styles.fieldSection}>
                    <Text style={[styles.fieldLabel, { color: t.muted }]}>Account</Text>
                    <View style={styles.chipRow}>
                      {accounts.map((a) => {
                        const sel = form.accountId === a.id;
                        return (
                          <Pressable key={a.id}
                            style={[styles.chip, sel
                              ? { backgroundColor: t.accentSoft }
                              : { backgroundColor: t.bg, borderColor: t.border, borderWidth: 1 }]}
                            onPress={() => handleAccountSelect(a.id)}
                          >
                            <Text style={[styles.chipText, { color: sel ? t.accentInk : t.muted }]}>{a.name}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  {hr}

                  {/* Note */}
                  <View style={styles.fieldRow}>
                    <Text style={[styles.fieldLabel, { color: t.muted }]}>Note</Text>
                    <TextInput
                      style={[styles.fieldValueInput, { color: t.text }]}
                      placeholder="optional"
                      placeholderTextColor={t.muted}
                      value={form.notes}
                      onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))}
                      returnKeyType="done"
                      textAlign="right"
                      onFocus={() => setShowNumpad(false)}
                    />
                  </View>
                </View>
              ) : (
                <View style={[styles.fieldsCard, { backgroundColor: t.surface, borderColor: t.border }]}>
                  {/* Date */}
                  <Pressable style={styles.fieldRow} onPress={() => setShowDatePicker((v) => !v)}>
                    <Text style={[styles.fieldLabel, { color: t.muted }]}>Date</Text>
                    <View style={styles.fieldRight}>
                      <Text style={[styles.fieldValue, { color: t.text }]}>{formatDisplayDate(form.date)}</Text>
                      <Feather name="chevron-right" size={16} color={t.muted} />
                    </View>
                  </Pressable>
                  {showDatePicker && (
                    <View style={{ paddingHorizontal: ScreenPadding, paddingBottom: 8 }}>
                      <DateTimePicker value={form.date} mode="date"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        onChange={handleDateChange} />
                    </View>
                  )}
                  {hr}

                  {/* Merchant */}
                  <View style={styles.fieldRow}>
                    <Text style={[styles.fieldLabel, { color: t.muted }]}>Merchant</Text>
                    <TextInput
                      style={[styles.fieldValueInput, { color: t.text }]}
                      placeholder="e.g. Starbucks"
                      placeholderTextColor={t.muted}
                      value={form.merchant}
                      onChangeText={handleMerchantChange}
                      returnKeyType="next"
                      autoCapitalize="words"
                      textAlign="right"
                      onFocus={() => setShowNumpad(false)}
                    />
                  </View>
                  {hr}

                  {/* Category */}
                  <View style={styles.fieldSection}>
                    <Text style={[styles.fieldLabel, { color: t.muted }]}>Expenses category</Text>
                    <View style={styles.chipRow}>
                      {categories
                        .filter((c) => !c.kind || c.kind === 'expense')
                        .map((c) => {
                          const sel = form.categoryId === c.id;
                          return (
                            <Pressable key={c.id}
                              style={[styles.chip, sel
                                ? { backgroundColor: t.accentSoft }
                                : { backgroundColor: t.bg, borderColor: t.border, borderWidth: 1 }]}
                              onPress={() => handleCategorySelect(c.id)}
                            >
                              <Text style={[styles.chipText, { color: sel ? t.accentInk : t.muted }]}>{c.name}</Text>
                            </Pressable>
                          );
                        })}
                    </View>
                  </View>
                  {hr}

                  {/* Account */}
                  <View style={styles.fieldSection}>
                    <Text style={[styles.fieldLabel, { color: t.muted }]}>Account</Text>
                    <View style={styles.chipRow}>
                      {accounts.map((a) => {
                        const sel = form.accountId === a.id;
                        return (
                          <Pressable key={a.id}
                            style={[styles.chip, sel
                              ? { backgroundColor: t.accentSoft }
                              : { backgroundColor: t.bg, borderColor: t.border, borderWidth: 1 }]}
                            onPress={() => handleAccountSelect(a.id)}
                          >
                            <Text style={[styles.chipText, { color: sel ? t.accentInk : t.muted }]}>{a.name}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  {hr}

                  {/* Note */}
                  <View style={styles.fieldRow}>
                    <Text style={[styles.fieldLabel, { color: t.muted }]}>Note</Text>
                    <TextInput
                      style={[styles.fieldValueInput, { color: t.text }]}
                      placeholder="optional"
                      placeholderTextColor={t.muted}
                      value={form.notes}
                      onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))}
                      returnKeyType="done"
                      textAlign="right"
                      onFocus={() => setShowNumpad(false)}
                    />
                  </View>
                </View>
              )}

            </ScrollView>

            {/* ── Rate warning ── */}
            {rateWarning && (
              <View style={[styles.rateWarning, { backgroundColor: t.accentSoft }]}>
                <Text style={[styles.rateWarningText, { color: t.accentInk }]}>{rateWarning}</Text>
              </View>
            )}

            {/* ── Footer buttons ── */}
            <View style={[styles.footer, { borderTopColor: t.border, paddingBottom: showNumpad ? 8 : 34 }]}>
              {editExpense ? (
                <>
                  <View style={styles.btnRow}>
                    {!(editExpense as any).source?.startsWith('split') && (
                      <Pressable
                        style={[styles.dangerBtn, saving && styles.dimmed]}
                        onPress={handleDelete}
                        disabled={saving}
                      >
                        <Feather name="trash-2" size={14} color={t.danger} />
                        <Text style={[styles.dangerBtnText, { color: t.danger }]}>Delete</Text>
                      </Pressable>
                    )}
                    <Pressable
                      style={[styles.secondaryBtn, styles.btnFlex, { borderColor: t.border }, saving && styles.dimmed]}
                      onPress={handleCopy}
                      disabled={saving}
                    >
                      <Text style={[styles.secondaryBtnText, { color: t.text }]}>Copy</Text>
                    </Pressable>
                  </View>
                  <Pressable
                    style={[styles.primaryBtn, { backgroundColor: t.accent }, saving && styles.dimmed]}
                    onPress={handleSave}
                    disabled={saving}
                  >
                    {saving
                      ? <ActivityIndicator color={t.onAccent} />
                      : <Text style={[styles.primaryBtnText, { color: t.onAccent }]}>Save Changes</Text>}
                  </Pressable>
                </>
              ) : mode === 'income' ? (
                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: t.accent }, saving && styles.dimmed]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator color={t.onAccent} />
                    : <Text style={[styles.primaryBtnText, { color: t.onAccent }]}>Save Income</Text>}
                </Pressable>
              ) : (
                <View style={styles.btnRow}>
                  <Pressable
                    style={[styles.secondaryBtn, { borderColor: t.border }, saving && styles.dimmed]}
                    onPress={handleContinue}
                    disabled={saving}
                  >
                    {saving
                      ? <ActivityIndicator color={t.accent} />
                      : <Text style={[styles.secondaryBtnText, { color: t.text }]}>Continue</Text>}
                  </Pressable>
                  <Pressable
                    style={[styles.primaryBtn, styles.btnFlex, { backgroundColor: t.accent }, saving && styles.dimmed]}
                    onPress={handleSave}
                    disabled={saving}
                  >
                    {saving
                      ? <ActivityIndicator color={t.onAccent} />
                      : <Text style={[styles.primaryBtnText, { color: t.onAccent }]}>Save</Text>}
                  </Pressable>
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        )}
        {showNumpad && (
          <>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setShowNumpad(false)}
            />
            <NumericKeypad
              onKey={(k) => setForm((f) => ({ ...f, amount: applyNumpadKey(f.amount, k, f.currency || homeCurrency) }))}
            />
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

// styles

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two + Spacing.half,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { minWidth: 44 },

  // Form layout
  formContent: {
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    gap: 12,
  },

  // Amount block
  amountBlock: {
    borderRadius: Radii.card, borderWidth: 1,
    paddingHorizontal: ScreenPadding, paddingVertical: 20, gap: 10,
  },
  amountEyebrow: {
    fontSize: 10, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase',
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  currencyTrigger: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  currencyCode: { fontSize: 16, fontWeight: '600', minWidth: 48 },
  amountInput: {
    fontSize: 36, fontWeight: '600', letterSpacing: -1.4,
    fontVariant: ['tabular-nums'] as any,
    paddingVertical: 0,
  },
  amountCaret: { width: 2, height: 34, borderRadius: 1 },

  // Fields card
  fieldsCard: { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: 16,
  },
  fieldSection: { paddingHorizontal: ScreenPadding, paddingVertical: 14, gap: 10 },
  fieldLabel: { fontSize: 12 },
  fieldRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fieldValue: { fontSize: 13, fontWeight: '500' },
  fieldValueInput: { flex: 1, fontSize: 13, fontWeight: '500', paddingVertical: 0, textAlign: 'right' },
  hr: { height: StyleSheet.hairlineWidth },

  // Chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radii.chip },
  chipText: { fontSize: 12, fontWeight: '500' },


  // Mode toggle
  modeToggle: {
    flexDirection: 'row', borderRadius: Radii.card, borderWidth: 1, padding: 4, gap: 4,
  },
  modeChip: {
    flex: 1, height: 36, borderRadius: Radii.card - 2,
    alignItems: 'center', justifyContent: 'center',
  },
  modeChipText: { fontSize: 13, fontWeight: '600' },

  // Advanced
  advancedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: 16,
    borderRadius: Radii.card, borderWidth: 1,
  },
  advancedLeft: { gap: 2 },
  advancedTitle: { fontSize: 13, fontWeight: '600' },
  advancedSub: { fontSize: 11 },
  advancedContent: { gap: 12 },
  advCard: { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },
  advSection: { paddingHorizontal: ScreenPadding, paddingVertical: 14, gap: 10 },
  advEyebrow: { fontSize: 10, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: 14,
  },
  toggleLeft: { flex: 1, gap: 2, marginRight: 12 },
  toggleHint: { fontSize: 12 },

  // Split / People
  splitHint: { fontSize: 12 },
  personCard: { borderRadius: 10, borderWidth: 1, padding: 10, gap: 4 },
  personInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  personNameInput: { flex: 1, fontSize: 12, paddingVertical: 4 },
  personAmountInput: { width: 80, fontSize: 12, textAlign: 'right', paddingVertical: 4 },
  removeIcon: { fontSize: 18, lineHeight: 22, paddingHorizontal: 4 },
  shareLabel: { fontSize: 11 },
  addPersonBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, alignSelf: 'flex-start',
  },
  addPersonText: { fontSize: 12, fontWeight: '500' },

  // Rate warning
  rateWarning: {
    marginHorizontal: ScreenPadding, marginBottom: 8,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  },
  rateWarningText: { fontSize: 12 },

  // Footer
  footer: {
    paddingHorizontal: ScreenPadding, paddingTop: 16, paddingBottom: 34,
    borderTopWidth: StyleSheet.hairlineWidth, gap: 10,
  },
  btnRow: { flexDirection: 'row', gap: 12 },
  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 54, borderRadius: Radii.button,
    paddingHorizontal: 18, justifyContent: 'center',
  },
  dangerBtnText: { fontSize: 14, fontWeight: '600' },
  primaryBtn: {
    height: 54, borderRadius: Radii.button,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 14, fontWeight: '600' },
  secondaryBtn: {
    height: 54, borderRadius: Radii.button, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600' },
  btnFlex: { flex: 1 },
  dimmed: { opacity: 0.5 },
});
