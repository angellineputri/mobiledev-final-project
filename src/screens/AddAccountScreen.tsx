import { useState } from 'react';
import {
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { CurrencyPickerModal } from '@/components/CurrencyPickerModal';
import { NumericKeypad, applyNumpadKey, formatAmountDisplay, rawToAmount } from '@/components/NumericKeypad';
import { Radii, ScreenPadding, TabBarHeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addAccount } from '@/storage/storage';

type AccountType = 'cash' | 'bank' | 'credit_card';

const TYPES: { value: AccountType; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
];

export default function AddAccountScreen({ navigation }: any) {
  const t = useTheme();

  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('cash');
  const [currency, setCurrency] = useState('SGD');
  const [balance, setBalance] = useState('');
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showNumpad, setShowNumpad] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) { Alert.alert('Name required', 'Please enter an account name.'); return; }
    const bal = rawToAmount(balance, currency);
    if (bal < 0) { Alert.alert('Invalid balance', 'Balance cannot be negative.'); return; }

    setSaving(true);
    try {
      const code = currency.trim().toUpperCase();
      await (addAccount as (data: any) => Promise<any>)({
        name: name.trim(),
        type,
        primaryCode: code,
        currencies: [{ code, balance: bal }],
      });
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
          <Feather name="chevron-left" size={22} color={t.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.text }]}>Add Account</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Account name */}
        <View style={[styles.fieldRow, styles.fieldColumn, { borderBottomColor: t.border }]}>
          <Text style={[styles.eyebrow, { color: t.muted }]}>ACCOUNT NAME</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. OCBC 360"
            placeholderTextColor={t.muted}
            style={[styles.nameInput, { color: name ? t.text : t.muted }]}
            autoCapitalize="words"
            returnKeyType="done"
            autoFocus
            onFocus={() => setShowNumpad(false)}
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
          style={[styles.fieldRow, { borderBottomColor: t.border }]}
          onPress={() => setShowCurrencyPicker(true)}
        >
          <Text style={[styles.fieldLabel, { color: t.muted }]}>Currency</Text>
          <View style={styles.fieldRight}>
            <Text style={[styles.fieldValue, { color: t.text }]}>{currency}</Text>
            <Feather name="chevron-right" size={16} color={t.muted} />
          </View>
        </Pressable>

        {/* Starting balance */}
        <Pressable
          style={[styles.fieldRow, { borderBottomColor: t.border }]}
          onPress={() => { Keyboard.dismiss(); setShowNumpad(true); }}
        >
          <Text style={[styles.fieldLabel, { color: t.muted }]}>Starting balance</Text>
          <Text style={[styles.fieldValue, { color: balance ? t.text : t.muted }]}>
            {formatAmountDisplay(balance, currency)}
          </Text>
        </Pressable>
      </ScrollView>

      {/* Save button */}
      <View style={[styles.footer, { paddingBottom: TabBarHeight - 20 }]}>
        <Pressable
          style={[styles.saveBtn, { backgroundColor: saving ? t.track : t.accent }]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={[styles.saveBtnText, { color: t.onAccent }]}>Save account</Text>
        </Pressable>
      </View>

      {showNumpad && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowNumpad(false)} />
          <NumericKeypad
            onKey={(k) => setBalance((s) => applyNumpadKey(s, k, currency))}
          />
        </>
      )}

      <CurrencyPickerModal
        visible={showCurrencyPicker}
        selected={currency}
        onSelect={(code) => { setCurrency(code); setBalance(''); }}
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
    justifyContent: 'space-between',
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
  nameInput: {
    fontSize: 17,
    fontWeight: '500',
  },

  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radii.chip,
  },
  pillText: { fontSize: 13 },
  hint: { fontSize: 12, lineHeight: 17 },

  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  fieldLabel: { fontSize: 14 },
  fieldRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldValue: { fontSize: 15, fontWeight: '500', fontVariant: ['tabular-nums'] as any },

  footer: { paddingHorizontal: ScreenPadding, paddingTop: 14 },
  saveBtn: {
    height: 54,
    borderRadius: Radii.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 16, fontWeight: '600' },
});
