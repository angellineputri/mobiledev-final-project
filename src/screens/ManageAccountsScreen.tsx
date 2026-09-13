import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '../components/themed-text';
import { CurrencyPickerModal } from '../components/CurrencyPickerModal';
import { Radii, ScreenPadding, Spacing } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { formatMoney } from '../logic/moneyFormatter';
import { deleteAccount, getAccounts, updateAccount } from '../storage/storage';

type AccountType = 'cash' | 'bank' | 'credit_card' | 'other';
type CurrencyBalance = { code: string; balance: number };
type Account = { id: string; name: string; type: AccountType; primaryCode: string; currencies: CurrencyBalance[] };
type EditForm = { name: string; type: AccountType; currency: string };

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'other', label: 'Other' },
];

function typeLabel(type: AccountType) {
  return ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? type;
}

// EditAccountModal

function EditAccountModal({ account, onClose, onSaved, onDeleted }: {
  account: Account | null; onClose: () => void; onSaved: () => void; onDeleted: () => void;
}) {
  const t = useTheme();
  const [form, setForm] = useState<EditForm>({ name: '', type: 'cash', currency: '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  useEffect(() => {
    if (account) setForm({ name: account.name, type: account.type, currency: account.primaryCode });
  }, [account]);

  async function handleSave() {
    if (!form.name.trim()) { Alert.alert('Name required'); return; }
    if (!form.currency.trim()) { Alert.alert('Currency required'); return; }
    setSaving(true);
    try {
      await updateAccount(account!.id, { name: form.name.trim(), type: form.type, primaryCode: form.currency.trim().toUpperCase() });
      onSaved();
    } finally { setSaving(false); }
  }

  function confirmDelete() {
    Alert.alert('Delete Account', `Delete "${account?.name}"? Existing expenses will remain but become unlinked.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try { await deleteAccount(account!.id); onDeleted(); }
          catch { setDeleting(false); }
        },
      },
    ]);
  }

  const inputStyle = [styles.input, { backgroundColor: t.bg, color: t.text, borderColor: t.border }];

  return (
    <Modal visible={account !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modalRoot, { backgroundColor: t.bg }]}>
        <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <Pressable onPress={onClose} hitSlop={8} style={styles.headerSlot}>
              <Text style={[styles.cancel, { color: t.muted }]}>Cancel</Text>
            </Pressable>
            <ThemedText type="stackTitle" numberOfLines={1}>{account?.name ?? 'Edit Account'}</ThemedText>
            <View style={styles.headerSlot} />
          </View>
          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={[styles.modalContent, { paddingHorizontal: ScreenPadding }]} keyboardShouldPersistTaps="handled">
              <View style={styles.field}>
                <ThemedText type="eyebrow" themeColor="muted">Name</ThemedText>
                <TextInput style={inputStyle} value={form.name}
                  onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                  autoCapitalize="words" returnKeyType="next" />
              </View>
              <View style={styles.field}>
                <ThemedText type="eyebrow" themeColor="muted">Type</ThemedText>
                <View style={styles.chipRow}>
                  {ACCOUNT_TYPES.map((tp) => {
                    const sel = form.type === tp.value;
                    return (
                      <Pressable key={tp.value}
                        style={[styles.chip, sel
                          ? { backgroundColor: t.accent }
                          : { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }]}
                        onPress={() => setForm((f) => ({ ...f, type: tp.value }))}>
                        <Text style={[styles.chipText, { color: sel ? t.onAccent : t.muted }]}>{tp.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View style={styles.field}>
                <ThemedText type="eyebrow" themeColor="muted">Currency</ThemedText>
                <Pressable
                  style={[styles.currencyTrigger, { backgroundColor: t.bg, borderColor: t.border }]}
                  onPress={() => setShowCurrencyPicker(true)}
                >
                  <Text style={[styles.currencyTriggerText, { color: form.currency ? t.text : t.muted }]}>
                    {form.currency || 'Select currency'}
                  </Text>
                  <Feather name="chevron-down" size={14} color={t.muted} />
                </Pressable>
                <CurrencyPickerModal
                  visible={showCurrencyPicker}
                  selected={form.currency}
                  onSelect={(code) => setForm((f) => ({ ...f, currency: code }))}
                  onClose={() => setShowCurrencyPicker(false)}
                />
              </View>
            </ScrollView>
            <View style={[styles.footerBtns, { paddingHorizontal: ScreenPadding, borderTopColor: t.border }]}>
              <Pressable style={[styles.saveBtn, { backgroundColor: t.accent }, (saving || deleting) && styles.dimmed]}
                onPress={handleSave} disabled={saving || deleting}>
                {saving ? <ActivityIndicator color={t.onAccent} /> :
                  <Text style={[styles.saveBtnText, { color: t.onAccent }]}>Save Changes</Text>}
              </Pressable>
              <Pressable style={[styles.deleteBtn, { borderColor: t.danger }, (saving || deleting) && styles.dimmed]}
                onPress={confirmDelete} disabled={saving || deleting}>
                {deleting ? <ActivityIndicator color={t.danger} /> :
                  <Text style={[styles.deleteBtnText, { color: t.danger }]}>Delete Account</Text>}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// ManageAccountsScreen

export default function ManageAccountsScreen({ navigation }: any) {
  const t = useTheme();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Account | null>(null);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    setLoading(true);
    (getAccounts() as Promise<Account[]>).then((r) => {
      if (!cancelled) { setAccounts(r); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []));

  function refresh() { (getAccounts() as Promise<Account[]>).then(setAccounts); }

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.headerSide}>
            <Feather name="chevron-left" size={22} color={t.muted} />
          </Pressable>
          <ThemedText type="stackTitle">Accounts</ThemedText>
          <View style={styles.headerSide} />
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={t.accent} /></View>
        ) : accounts.length === 0 ? (
          <View style={styles.center}>
            <Text style={[styles.emptyText, { color: t.muted }]}>No accounts yet.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: ScreenPadding }]} showsVerticalScrollIndicator={false}>
            {accounts.map((acc) => (
              <Pressable key={acc.id} onPress={() => setEditing(acc)}>
                {({ pressed }) => (
                  <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.75 : 1 }]}>
                    <View style={styles.cardMeta}>
                      <Text style={[styles.cardName, { color: t.text }]}>{acc.name}</Text>
                      <Text style={[styles.cardSub, { color: t.muted }]}>{typeLabel(acc.type)} · {acc.primaryCode}</Text>
                    </View>
                    <Text style={[styles.cardBalance, { color: t.text }]}>{acc.primaryCode} {formatMoney(acc.currencies.find((c) => c.code === acc.primaryCode)?.balance ?? 0, acc.primaryCode)}</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>

      <EditAccountModal
        account={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refresh(); }}
        onDeleted={() => { setEditing(null); refresh(); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  safeArea: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two + Spacing.half,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { minWidth: 44 },
  content: { paddingTop: Spacing.three, gap: 12, paddingBottom: Spacing.four },
  card: { flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: Radii.card, borderWidth: 1, gap: 14 },
  cardMeta: { flex: 1, gap: 3 },
  cardName: { fontSize: 14, fontWeight: '600' },
  cardSub: { fontSize: 11 },
  cardBalance: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  emptyText: { fontSize: 12 },

  // Modal
  modalRoot: { flex: 1 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two + Spacing.half,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSlot: { minWidth: 60 },
  cancel: { fontSize: 13 },
  modalContent: { paddingTop: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  field: { gap: Spacing.two },
  input: { borderRadius: Spacing.two + Spacing.half, paddingHorizontal: 14, paddingVertical: 14, fontSize: 14, borderWidth: 1 },
  shortInput: { alignSelf: 'flex-start', minWidth: 120 },
  currencyTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'flex-start', borderRadius: Radii.button, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  currencyTriggerText: { fontSize: 14, fontWeight: '500' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radii.chip },
  chipText: { fontSize: 12, fontWeight: '500' },
  footerBtns: {
    paddingTop: Spacing.two, paddingBottom: Spacing.one,
    gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveBtn: { height: 54, borderRadius: Radii.button, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: 14, fontWeight: '600' },
  deleteBtn: { height: 54, borderRadius: Radii.button, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  deleteBtnText: { fontSize: 14, fontWeight: '600' },
  dimmed: { opacity: 0.5 },
});
