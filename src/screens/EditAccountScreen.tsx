import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { NumericKeypad, formatAmountDisplay, rawToAmount, amountToRaw, applyNumpadKeyAtCursor, rawCursorToDisplayCursor } from '../components/NumericKeypad';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { CurrencyPickerModal } from '../components/CurrencyPickerModal';
import { Radii, ScreenPadding } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { getRatesFromHome } from '../api/exchangeRate';
import {
  accountDisplay,
  addExpense,
  addIncome,
  convertToHome,
  countAccountEntries,
  deleteAccountWithExpenses,
  getCategories,
  getSettings,
  updateAccount,
  updateSettings,
} from '../storage/storage';

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

type AccountType = 'cash' | 'bank' | 'credit_card';
type CurrencyBalance = { code: string; balance: number };
type Account = {
  id: string; name: string; type: AccountType;
  primaryCode: string; currencies: CurrencyBalance[];
};

const TYPES: { value: AccountType; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
];

// Delete confirm overlay

function DeleteConfirmOverlay({
  visible,
  accountName,
  entryCount,
  onCancel,
  onConfirm,
  t,
}: {
  visible: boolean;
  accountName: string;
  entryCount: number;
  onCancel: () => void;
  onConfirm: () => void;
  t: any;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlayScrim}>
        <View style={[styles.overlayCard, { backgroundColor: t.surface }]}>
          <View style={[styles.warningIcon, { backgroundColor: t.dangerSoft }]}>
            <Feather name="alert-triangle" size={20} color={t.danger} />
          </View>
          <View style={styles.overlayText}>
            <Text style={[styles.overlayTitle, { color: t.text }]}>Delete {accountName}?</Text>
            <Text style={[styles.overlayBody, { color: t.muted }]}>
              All {entryCount} {entryCount === 1 ? 'entry' : 'entries'} in this account will be deleted permanently. This can't be undone.
            </Text>
          </View>
          <View style={styles.overlayBtns}>
            <Pressable
              style={[styles.overlayBtn, { borderColor: t.border, borderWidth: 1 }]}
              onPress={onCancel}
            >
              <Text style={[styles.overlayBtnText, { color: t.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.overlayBtn, { backgroundColor: t.danger }]}
              onPress={onConfirm}
            >
              <Text style={[styles.overlayBtnText, { color: '#fff' }]}>Delete</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// EditAccountScreen

export default function EditAccountScreen({ navigation, route }: any) {
  const t = useTheme();
  const account: Account = route.params?.account;

  // the balance we edit is the account total in its own currency
  const primaryPocket = account.currencies.find((c) => c.code === account.primaryCode)?.balance ?? 0;

  const [name, setName] = useState(account.name);
  const [type, setType] = useState<AccountType>(account.type as AccountType);
  const [currency, setCurrency] = useState(account.primaryCode);
  const [balance, setBalance] = useState(() => amountToRaw(primaryPocket, account.primaryCode));
  // the starting balance, so we can log the change when saving
  const originalBalanceRef = useRef<number>(primaryPocket);
  const [showNumpad, setShowNumpad] = useState(false);
  const balanceInputRef = useRef<TextInput | null>(null);
  const balanceRawCursorRef = useRef<number>(0);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [entryCount, setEntryCount] = useState(0);
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (countAccountEntries as (id: string) => Promise<number>)(account.id).then(setEntryCount);
    (getSettings as () => Promise<any>)().then((s) => setIsDefault(s.defaultAccountId === account.id));
  }, [account.id]);

  // get today's rates and set the field to the account total in its own currency
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // only need rates if the account holds other currencies
      const otherCodes = account.currencies
        .map((c) => c.code)
        .filter((c) => c !== account.primaryCode);
      if (otherCodes.length === 0) return;
      const settings = await (getSettings as () => Promise<any>)();
      const home = settings.homeCurrency ?? 'SGD';
      const rates = await getRatesFromHome(home, [...new Set([account.primaryCode, ...otherCodes])]);
      if (cancelled) return;
      const disp = (accountDisplay as any)(account, home, rates);
      const total = disp?.amount ?? primaryPocket;
      originalBalanceRef.current = total;
      setBalance(amountToRaw(total, account.primaryCode));
    })();
    return () => { cancelled = true; };
  }, [account.id]);

  async function handleToggleDefault() {
    const next = !isDefault;
    setIsDefault(next);
    await (updateSettings as (ch: any) => Promise<any>)({
      defaultAccountId: next ? account.id : null,
    });
  }

  // log a balance change as an "Others" income (up) or expense (down)
  async function recordBalanceAdjustment(diff: number) {
    const kind = diff > 0 ? 'income' : 'expense';
    const amount = round2(Math.abs(diff));
    const cats: any[] = await (getCategories as () => Promise<any[]>)();
    const others = cats.find((c) => c.name === 'Others' && (c.kind ?? 'expense') === kind);

    const settings = await (getSettings as () => Promise<any>)();
    const home = settings.homeCurrency ?? 'SGD';
    let amountInHome = amount;
    if (currency !== home) {
      const rates = await getRatesFromHome(home, [currency]);
      amountInHome = round2((convertToHome as any)(amount, currency, home, rates));
    }
    const today = new Date().toISOString().slice(0, 10);

    if (kind === 'income') {
      await (addIncome as (d: any) => Promise<any>)({
        accountId: account.id,
        amount,
        currency,
        amountInHomeCurrency: amountInHome,
        categoryId: others?.id ?? null,
        source: 'Balance adjustment',
        destination: 'allowance',
        savingGoalId: null,
        date: today,
        notes: 'Balance edited in account settings',
      });
    } else {
      await (addExpense as (d: any) => Promise<any>)({
        accountId: account.id,
        categoryId: others?.id ?? null,
        merchant: 'Balance adjustment',
        amount,
        currency,
        amountInHomeCurrency: amountInHome,
        exchangeRateAtEntry: amount > 0 ? round2(amountInHome / amount) : 1,
        date: today,
        notes: 'Balance edited in account settings',
        isShared: false,
        splitType: null,
        splitDetails: null,
        receiptImageUri: null,
      });
    }
  }

  async function handleSave() {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    const newBalance = rawToAmount(balance, currency);

    setSaving(true);
    try {
      // if only the balance changed (not the currency), log the difference
      const diff = round2(newBalance - originalBalanceRef.current);
      if (currency === account.primaryCode && diff !== 0) {
        await recordBalanceAdjustment(diff);
      }

      // save the balance. cash keeps its other currencies, bank/credit don't
      const changes: any = { name: name.trim(), type, primaryCode: currency };
      changes.currencies = type === 'cash'
        ? account.currencies.map((c) =>
            c.code === account.primaryCode ? { code: currency, balance: newBalance } : c,
          )
        : [{ code: currency, balance: newBalance }];

      await (updateAccount as (id: string, ch: any) => Promise<any>)(account.id, changes);
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    await (deleteAccountWithExpenses as (id: string) => Promise<void>)(account.id);
    navigation.goBack();
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
            <Feather name="chevron-left" size={22} color={t.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: t.text, flex: 1 }]}>Edit Account</Text>
          <Pressable hitSlop={12} onPress={() => setShowDeleteConfirm(true)}>
            <Feather name="trash-2" size={19} color={t.danger} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Account name */}
          <View style={[styles.fieldColumn, { borderBottomColor: t.border }]}>
            <Text style={[styles.eyebrow, { color: t.muted }]}>ACCOUNT NAME</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              style={[styles.nameInput, { color: t.text }]}
              autoCapitalize="words"
              returnKeyType="done"
            />
          </View>

          {/* Type */}
          <View style={[styles.fieldColumn, { borderBottomColor: t.border, paddingVertical: 16 }]}>
            <Text style={[styles.eyebrow, { color: t.muted }]}>TYPE</Text>
            <View style={styles.pillRow}>
              {TYPES.map((tp) => {
                const active = type === tp.value;
                return (
                  <Pressable
                    key={tp.value}
                    style={[styles.pill, active
                      ? { backgroundColor: t.accent }
                      : { borderColor: t.border, borderWidth: 1 }]}
                    onPress={() => setType(tp.value)}
                  >
                    <Text style={[styles.pillText, { color: active ? t.onAccent : t.muted, fontWeight: active ? '600' : '400' }]}>
                      {tp.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Currency */}
          <Pressable
            style={[styles.fieldRow, { borderBottomColor: t.border, paddingVertical: 16 }]}
            onPress={() => setShowCurrencyPicker(true)}
          >
            <Text style={[styles.fieldLabel, { color: t.muted }]}>Currency</Text>
            <View style={styles.fieldRight}>
              <Text style={[styles.fieldValue, { color: t.text }]}>{currency}</Text>
              <Feather name="chevron-right" size={16} color={t.muted} />
            </View>
          </Pressable>

          {/* Balance */}
          <View style={[styles.fieldColumn, { borderBottomColor: t.border, paddingVertical: 16, gap: 6 }]}>
            <Pressable style={styles.fieldRow} onPress={() => balanceInputRef.current?.focus()}>
              <Text style={[styles.fieldLabel, { color: t.muted }]}>Balance</Text>
              <TextInput
                ref={balanceInputRef}
                style={[styles.fieldValue, { color: t.text }]}
                value={formatAmountDisplay(balance, currency)}
                showSoftInputOnFocus={false}
                caretHidden
                editable
                onFocus={() => {
                  Keyboard.dismiss();
                  setShowNumpad(true);
                  // put the cursor at the end of the value
                  balanceRawCursorRef.current = balance.length;
                  const display = formatAmountDisplay(balance, currency);
                  requestAnimationFrame(() => {
                    balanceInputRef.current?.setNativeProps({
                      selection: { start: display.length, end: display.length },
                    });
                  });
                }}
              />
            </Pressable>
            <Text style={[styles.hint, { color: t.muted }]}>
              This is the account's total value in {currency}. Saving sets it as the balance and keeps the account in a single currency.
            </Text>
          </View>

          {/* Default account */}
          <Pressable
            style={[styles.fieldRow, { borderBottomColor: t.border, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth }]}
            onPress={handleToggleDefault}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.fieldLabel, { color: t.text }]}>Default account</Text>
              <Text style={[styles.hint, { color: t.muted }]}>New entries will default to this account.</Text>
            </View>
            <View style={[
              styles.toggle,
              { backgroundColor: isDefault ? t.accent : t.track },
            ]}>
              <View style={[styles.toggleThumb, { transform: [{ translateX: isDefault ? 18 : 2 }] }]} />
            </View>
          </Pressable>

          {/* Save button */}
          <Pressable
            style={[styles.saveBtn, { backgroundColor: saving ? t.track : t.accent, marginTop: 24, marginBottom: 8 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={[styles.saveBtnText, { color: t.onAccent }]}>Save changes</Text>
          </Pressable>
        </ScrollView>

      {showNumpad && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowNumpad(false)} />
          <NumericKeypad
            onKey={(key) => {
              setBalance((s) => {
                const { newRaw, newCursor } = applyNumpadKeyAtCursor(s, key, balanceRawCursorRef.current, currency);
                balanceRawCursorRef.current = newCursor;
                const newDisplay = formatAmountDisplay(newRaw, currency);
                const dCursor = rawCursorToDisplayCursor(newDisplay, newCursor);
                requestAnimationFrame(() => {
                  balanceInputRef.current?.setNativeProps({ selection: { start: dCursor, end: dCursor } });
                });
                return newRaw;
              });
            }}
          />
        </>
      )}

      <DeleteConfirmOverlay
        visible={showDeleteConfirm}
        accountName={account.name}
        entryCount={entryCount}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        t={t}
      />

      <CurrencyPickerModal
        visible={showCurrencyPicker}
        selected={currency}
        onSelect={(code) => setCurrency(code)}
        onClose={() => setShowCurrencyPicker(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: ScreenPadding,
    paddingTop: 6,
    paddingBottom: 16,
  },
  headerTitle: { fontSize: 18, fontWeight: '600' },

  scroll: { paddingHorizontal: ScreenPadding },

  eyebrow: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },

  fieldColumn: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
    paddingVertical: 18,
  },
  nameInput: { fontSize: 17, fontWeight: '500' },

  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radii.chip },
  pillText: { fontSize: 13 },

  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 0,
  },
  fieldLabel: { fontSize: 14 },
  fieldRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldValue: { fontSize: 15, fontWeight: '500', fontVariant: ['tabular-nums'] as any },
  hint: { fontSize: 12, lineHeight: 17 },

  toggle: {
    width: 42,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },

  saveBtn: {
    height: 54,
    borderRadius: Radii.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 16, fontWeight: '600' },

  // Delete overlay
  overlayScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  overlayCard: {
    width: '100%',
    borderRadius: 20,
    padding: 24,
    gap: 16,
  },
  warningIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayText: { gap: 6 },
  overlayTitle: { fontSize: 17, fontWeight: '700' },
  overlayBody: { fontSize: 13, lineHeight: 20 },
  overlayBtns: { flexDirection: 'row', gap: 10 },
  overlayBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayBtnText: { fontSize: 15, fontWeight: '600' },
});
