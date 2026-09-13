/* eslint-disable */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { CurrencyPickerModal } from '../components/CurrencyPickerModal';
import { NumericKeypad, applyNumpadKey, formatAmountDisplay } from '../components/NumericKeypad';
import { MaxContentWidth, Radii, ScreenPadding } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { formatMoney, formatMoneyWithCode } from '../logic/moneyFormatter';
import { computeItemShares, parseAmountInput } from '../logic/splitMath';
import { getExchangeRate } from '../api/exchangeRate';
import { calculateSplitBillBalanceEffect } from '../logic/businessLogic';
import {
  addExpense,
  addSplitBill,
  deleteExpense,
  getAccounts,
  getCategories,
  getExpenses,
  getSettings,
  getSplitBills,
  updateSubBalance,
  updateExpense,
  updateSplitBill,
} from '../storage/storage';

// types

type CurrencyBalance = { code: string; balance: number };
type Account = { id: string; name: string; primaryCode: string; currencies: CurrencyBalance[] };
type Category = { id: string; name: string; kind?: 'expense' | 'income' };
type SplitType = 'equal' | 'items';
type PaidBy = 'me' | 'other';

type PersonRow = { id: string; name: string; amount: string };
type SplitItemState = { id: string; name: string; price: string; sharerIds: string[] };
type FeeMode = 'pct' | 'flat';
type DeliverySplit = 'equal' | 'proportional';
type SharedFees = {
  gst: string;
  serviceCharge: string;
  feeMode: FeeMode;
  delivery: string; deliverySplit: DeliverySplit;
};
type NumpadTarget = null | string;

type StoredEntry = { person: string; share: number; settled: boolean; settledAt: string | null };
type StoredBill = {
  id: string; merchant: string; total: number; currency: string; date: string;
  paidBy: 'me' | 'other'; paidByName: string | null;
  splitType: 'equal' | 'custom' | 'items'; myShare: number;
  entries: StoredEntry[]; linkedExpenseId: string | null; myExpenseId?: string | null;
  categoryId: string | null; accountId: string; notes: string | null; createdAt: string;
  splitItems?: Array<{ name: string; price: number; sharerPersonNames: string[] }>;
  sharedFees?: { gst: number; serviceCharge: number; delivery: number };
  groupMembers?: Array<{ name: string; share: number }>;
};

// helpers

function makePid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDisplayDate(d: Date): string {
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function round2(v: number) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function centsStr(amount: number) {
  return String(Math.round((amount || 0) * 100));
}

// Merchant helpers

type Merchant = { name: string; categoryId?: string; count: number; lastAmount?: number; currency?: string; lastDate?: string };

function parseMerchants(expenses: any[]): Merchant[] {
  const map = new Map<string, Merchant>();
  for (const e of expenses) {
    if (!e.merchant || (e as any).source === 'split_unsettled') continue;
    const existing = map.get(e.merchant);
    if (existing) {
      existing.count += 1;
      if (!existing.lastDate || (e.date ?? '') > existing.lastDate) {
        existing.lastDate = e.date;
        existing.lastAmount = e.amountInHomeCurrency ?? e.amount;
        existing.currency = e.currency;
        existing.categoryId = e.categoryId;
      }
    } else {
      map.set(e.merchant, { name: e.merchant, categoryId: e.categoryId, count: 1, lastAmount: e.amountInHomeCurrency ?? e.amount, currency: e.currency, lastDate: e.date });
    }
  }
  return [...map.values()].sort((a, b) => {
    const diff = b.count - a.count;
    return diff !== 0 ? diff : (b.lastDate ?? '') > (a.lastDate ?? '') ? 1 : -1;
  });
}

// Sheet helpers

function Sheet({ visible, onClose, t, children }: { visible: boolean; onClose: () => void; t: any; children: React.ReactNode }) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={sheetStyles.scrim} onPress={onClose} />
      <View style={[sheetStyles.container, { backgroundColor: t.surface }]}>
        <View style={[sheetStyles.handle, { backgroundColor: t.track }]} />
        {children}
      </View>
    </Modal>
  );
}

const CAT_ICONS: Record<string, string> = {
  Food: 'coffee', Transport: 'navigation', Shopping: 'shopping-bag',
  Entertainment: 'film', Necessities: 'home', Gifts: 'gift',
  Emergency: 'shield', 'SIM card': 'wifi', 'Memberships & subscriptions': 'repeat',
};

function CategorySheet({ visible, onClose, categories, selected, onSelect, t }: {
  visible: boolean; onClose: () => void;
  categories: Category[]; selected: string;
  onSelect: (id: string) => void; t: any;
}) {
  const expense = categories.filter((c) => !c.kind || c.kind === 'expense');
  const selName = categories.find((c) => c.id === selected)?.name ?? '';
  return (
    <Sheet visible={visible} onClose={onClose} t={t}>
      <View style={sheetStyles.header}>
        <Text style={[sheetStyles.title, { color: t.text }]}>Category</Text>
      </View>
      <View style={sheetStyles.catGrid}>
        {expense.map((cat) => {
          const icon = CAT_ICONS[cat.name] ?? 'tag';
          const isSel = cat.id === selected;
          return (
            <Pressable key={cat.id} style={sheetStyles.catItem} onPress={() => { onSelect(cat.id); onClose(); }}>
              <View style={[sheetStyles.catIconTile, { backgroundColor: isSel ? t.accent : t.bg }]}>
                <Feather name={icon as any} size={22} color={isSel ? t.onAccent : t.muted} />
              </View>
              <Text style={[sheetStyles.catName, { color: isSel ? t.text : t.muted, fontWeight: isSel ? '700' : '400' }]}>
                {cat.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable style={[sheetStyles.btn, { backgroundColor: t.accent }]} onPress={onClose}>
        <Text style={[sheetStyles.btnText, { color: t.onAccent }]}>
          {selName ? `Use ${selName}` : 'Select category'}
        </Text>
      </Pressable>
    </Sheet>
  );
}

const ACCOUNT_ICONS: Record<string, string> = { cash: 'dollar-sign', bank: 'home', credit_card: 'credit-card' };

function accountBalance(acct: Account): number {
  return acct.currencies.find((c) => c.code === acct.primaryCode)?.balance ?? 0;
}

function AccountSheet({ visible, onClose, accounts, selected, onSelect, t }: {
  visible: boolean; onClose: () => void;
  accounts: Account[]; selected: string;
  onSelect: (id: string) => void; t: any;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} t={t}>
      <View style={sheetStyles.header}>
        <Text style={[sheetStyles.title, { color: t.text }]}>Account</Text>
      </View>
      <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
        {accounts.map((acct) => {
          const isSel = acct.id === selected;
          const icon = ACCOUNT_ICONS[(acct as any).type ?? ''] ?? 'credit-card';
          return (
            <Pressable
              key={acct.id}
              style={[
                sheetStyles.acctRow,
                { borderRadius: 17, marginBottom: 9 },
                isSel
                  ? { borderColor: t.accent, borderWidth: 1.5 }
                  : { borderColor: t.border, borderWidth: 1 },
              ]}
              onPress={() => { onSelect(acct.id); onClose(); }}
            >
              <View style={[sheetStyles.acctIcon, { backgroundColor: isSel ? t.accentSoft : t.bg }]}>
                <Feather name={icon as any} size={17} color={isSel ? t.accentInk : t.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[sheetStyles.acctName, { color: t.text }]}>{acct.name}</Text>
                <Text style={[sheetStyles.acctSub, { color: t.muted }]}>{formatMoneyWithCode(accountBalance(acct), acct.primaryCode)}</Text>
              </View>
              {isSel && (
                <View style={[sheetStyles.acctCheck, { backgroundColor: t.accent }]}>
                  <Feather name="check" size={12} color={t.onAccent} />
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable style={[sheetStyles.btn, { backgroundColor: t.accent }]} onPress={onClose}>
        <Text style={[sheetStyles.btnText, { color: t.onAccent }]}>
          {accounts.find((a) => a.id === selected) ? `Use ${accounts.find((a) => a.id === selected)!.name}` : 'Select account'}
        </Text>
      </Pressable>
    </Sheet>
  );
}

function applyRateKey(raw: string, key: string): string {
  if (key === 'backspace') return raw.slice(0, -1);
  if (key === '.') {
    if (raw.includes('.')) return raw;
    return (raw || '0') + '.';
  }
  if (raw.length >= 10) return raw;
  const dotIdx = raw.indexOf('.');
  if (dotIdx !== -1 && raw.length - dotIdx > 6) return raw;
  if (raw === '0') return key;
  return raw + key;
}

function RateAdjustSheet({ visible, onClose, fromCurrency, toCurrency, rate, amount, onSave, t }: {
  visible: boolean; onClose: () => void;
  fromCurrency: string; toCurrency: string;
  rate: number | null; amount: number; onSave: (r: number) => void; t: any;
}) {
  const [draft, setDraft] = useState('');
  const [activeField, setActiveField] = useState<'unit' | 'total'>('unit');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) { setActiveField('unit'); setDraft(rate !== null ? String(rate) : ''); }
  }, [visible]);

  function switchTo(field: 'unit' | 'total') {
    if (field === activeField) return;
    const n = parseFloat(draft) || 0;
    if (field === 'total') {
      const total = amount > 0 ? Math.round(n * amount * 100) / 100 : 0;
      setDraft(total > 0 ? String(total) : '');
    } else {
      const unitRate = amount > 0 ? Math.round((n / amount) * 1000000) / 1000000 : 0;
      setDraft(unitRate > 0 ? String(unitRate) : '');
    }
    setActiveField(field);
  }

  function handleApply() {
    const n = parseFloat(draft);
    const resolvedRate = activeField === 'unit' ? n : (amount > 0 ? n / amount : 0);
    if (isNaN(resolvedRate) || resolvedRate <= 0) { Alert.alert('Invalid rate', 'Enter a rate greater than 0.'); return; }
    onSave(resolvedRate);
    onClose();
  }

  const draftNum = parseFloat(draft) || 0;
  const computedUnit = activeField === 'total' && amount > 0 ? Math.round((draftNum / amount) * 1000000) / 1000000 : null;
  const computedTotal = activeField === 'unit' && amount > 0 ? Math.round(draftNum * amount * 100) / 100 : null;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={sheetStyles.scrim} onPress={onClose} />
      <View style={[sheetStyles.rateContainer, { backgroundColor: t.surface }]}>
        <View style={sheetStyles.ratePadded}>
          <View style={[sheetStyles.handle, { backgroundColor: t.track }]} />
          <View style={sheetStyles.header}>
            <Text style={[sheetStyles.title, { color: t.text }]}>Adjust Rate</Text>
            <Pressable hitSlop={16} onPress={onClose}>
              <Text style={[sheetStyles.action, { color: t.muted }]}>Cancel</Text>
            </Pressable>
          </View>
          <Text style={[sheetStyles.rateHint, { color: t.muted }]}>
            Tap either row to edit. Set the unit rate or the actual transaction total.
          </Text>
          <Pressable
            style={[sheetStyles.rateDisplayRow, { borderColor: activeField === 'unit' ? t.accent : t.border, backgroundColor: t.bg }]}
            onPress={() => switchTo('unit')}
          >
            <Text style={[sheetStyles.rateInputLabel, { color: t.muted }]}>1 {fromCurrency} =</Text>
            <Text style={[sheetStyles.rateDisplayValue, { color: activeField === 'unit' ? (draft ? t.text : t.muted) : t.muted }]}>
              {activeField === 'unit' ? (draft || '0.00') : (computedUnit != null && computedUnit > 0 ? String(computedUnit) : '—')}
            </Text>
            <Text style={[sheetStyles.rateInputLabel, { color: t.muted }]}>{toCurrency}</Text>
          </Pressable>
          {amount > 0 && (
            <Pressable
              style={[sheetStyles.rateDisplayRow, { borderColor: activeField === 'total' ? t.accent : t.border, backgroundColor: t.bg, marginTop: 10 }]}
              onPress={() => switchTo('total')}
            >
              <Text style={[sheetStyles.rateInputLabel, { color: t.muted }]}>{formatMoney(amount, fromCurrency)} {fromCurrency} =</Text>
              <Text style={[sheetStyles.rateDisplayValue, { color: activeField === 'total' ? (draft ? t.text : t.muted) : t.muted }]}>
                {activeField === 'total' ? (draft || '0.00') : (computedTotal != null && computedTotal > 0 ? formatMoney(computedTotal, toCurrency) : '—')}
              </Text>
              <Text style={[sheetStyles.rateInputLabel, { color: t.muted }]}>{toCurrency}</Text>
            </Pressable>
          )}
          <Pressable style={[sheetStyles.btn, { backgroundColor: t.accent }]} onPress={handleApply}>
            <Text style={[sheetStyles.btnText, { color: t.onAccent }]}>Apply Rate</Text>
          </Pressable>
        </View>
        <NumericKeypad bottomLeftKey="." onKey={(key) => setDraft((d) => applyRateKey(d, key))} />
        <View style={{ height: insets.bottom }} />
      </View>
    </Modal>
  );
}

function MerchantSearchSheet({ visible, onClose, merchants, categories, onSelect, t }: {
  visible: boolean; onClose: () => void; merchants: Merchant[];
  categories: Category[]; onSelect: (name: string, categoryId?: string) => void; t: any;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) { setQuery(''); setTimeout(() => inputRef.current?.focus(), 300); }
  }, [visible]);

  const q = query.toLowerCase().trim();
  const matches = q ? merchants.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 4) : [];
  const recent = merchants.slice(0, 6);
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  function subLine(m: Merchant) {
    const cat = m.categoryId ? catMap[m.categoryId] ?? '' : '';
    const cnt = `${m.count} expense${m.count !== 1 ? 's' : ''}`;
    return [cat, cnt].filter(Boolean).join(' · ');
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[mStyles.root, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={mStyles.header}>
            <Pressable hitSlop={16} onPress={onClose} style={mStyles.backBtn}>
              <Feather name="chevron-left" size={22} color={t.text} />
              <Text style={[mStyles.backLabel, { color: t.text }]}>Back</Text>
            </Pressable>
            <Text style={[mStyles.title, { color: t.text }]}>Merchant</Text>
            <View style={{ width: 60 }} />
          </View>
          <View style={[mStyles.searchBar, { backgroundColor: t.surface, borderColor: t.accent }]}>
            <Feather name="search" size={16} color={t.muted} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Search or add merchant"
              placeholderTextColor={t.muted}
              style={[mStyles.searchInput, { color: t.text }]}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={() => { if (query.trim()) { onSelect(query.trim()); onClose(); } }}
            />
            {!!query && <Pressable onPress={() => setQuery('')}><Feather name="x" size={16} color={t.muted} /></Pressable>}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {matches.length > 0 && (
              <>
                <Text style={[mStyles.sectionLabel, { color: t.muted }]}>TOP MATCHES</Text>
                {matches.map((m, i) => (
                  <Pressable key={m.name} style={[mStyles.row, { borderBottomColor: t.border }]} onPress={() => { onSelect(m.name, m.categoryId); onClose(); }}>
                    <View style={[mStyles.avatar, i === 0 ? { backgroundColor: t.accentSoft } : { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }]}>
                      <Text style={[mStyles.avatarText, { color: i === 0 ? t.accentInk : t.muted }]}>{m.name.slice(0, 2)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[mStyles.rowName, { color: t.text }]}>{m.name}</Text>
                      <Text style={[mStyles.rowSub, { color: t.muted }]}>{subLine(m)}</Text>
                    </View>
                  </Pressable>
                ))}
              </>
            )}
            {query.trim().length > 0 && (
              <Pressable style={[mStyles.row, { borderBottomColor: t.border }]} onPress={() => { onSelect(query.trim()); onClose(); }}>
                <View style={[mStyles.avatar, { borderColor: t.border, borderWidth: 1, borderStyle: 'dashed' }]}>
                  <Feather name="plus" size={15} color={t.accent} />
                </View>
                <Text style={[mStyles.newText, { color: t.accent }]}>Use "{query}" as new merchant</Text>
              </Pressable>
            )}
            {recent.length > 0 && !query && (
              <>
                <Text style={[mStyles.sectionLabel, { color: t.muted, paddingHorizontal: ScreenPadding, paddingTop: 20 }]}>RECENTLY USED</Text>
                <View style={mStyles.chipRow}>
                  {recent.map((m) => (
                    <Pressable key={m.name} onPress={() => { onSelect(m.name, m.categoryId); onClose(); }} style={[mStyles.chip, { backgroundColor: t.surface, borderColor: t.border }]}>
                      <Text style={[mStyles.chipText, { color: t.text }]}>{m.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function NoteInputSheet({ visible, onClose, value, onChange, t }: {
  visible: boolean; onClose: () => void; value: string; onChange: (v: string) => void; t: any;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) { setDraft(value); setTimeout(() => inputRef.current?.focus(), 300); }
  }, [visible]);

  function handleSave() { onChange(draft); onClose(); }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[nStyles.root, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[nStyles.header, { borderBottomColor: t.border }]}>
            <Pressable hitSlop={16} onPress={onClose} style={nStyles.backBtn}>
              <Feather name="chevron-left" size={22} color={t.text} />
              <Text style={[nStyles.backLabel, { color: t.text }]}>Back</Text>
            </Pressable>
            <Text style={[nStyles.title, { color: t.text }]}>Note</Text>
            <Pressable hitSlop={16} onPress={handleSave} style={nStyles.actionBtn}>
              <Text style={[nStyles.action, { color: t.accent }]}>Save</Text>
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={nStyles.body} keyboardShouldPersistTaps="handled">
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a note…"
              placeholderTextColor={t.muted}
              multiline
              style={[nStyles.input, { color: t.text, backgroundColor: t.surface, borderColor: t.border }]}
              blurOnSubmit={false}
            />
          </ScrollView>
          <View style={[nStyles.footer, { borderTopColor: t.border }]}>
            <Pressable style={[sheetStyles.btn, { backgroundColor: t.accent }]} onPress={handleSave}>
              <Text style={[sheetStyles.btnText, { color: t.onAccent }]}>Save note</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES_LONG  = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function DatePickerSheet({ visible, onClose, value, onChange, t }: {
  visible: boolean; onClose: () => void; value: Date; onChange: (d: Date) => void; t: any;
}) {
  const [viewing, setViewing] = useState<Date>(value);
  const [selected, setSelected] = useState<Date>(value);
  const [pickerMode, setPickerMode] = useState<'day' | 'month' | 'year'>('day');
  const todayLocal = new Date();

  useEffect(() => {
    if (visible) { setViewing(value); setSelected(value); setPickerMode('day'); }
  }, [visible]);

  const year = viewing.getFullYear();
  const month = viewing.getMonth();

  function goToday() {
    const t2 = new Date();
    setSelected(t2);
    setViewing(new Date(t2.getFullYear(), t2.getMonth(), 1));
    setPickerMode('day');
  }

  const firstDay = new Date(year, month, 1).getDay();
  const mondayOffset = (firstDay + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(mondayOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const yearRange = Array.from({ length: 9 }, (_, i) => year - 4 + i);

  return (
    <Sheet visible={visible} onClose={onClose} t={t}>
      <View style={sheetStyles.header}>
        <Text style={[sheetStyles.title, { color: t.text }]}>Date</Text>
        <Pressable onPress={goToday}>
          <Text style={[sheetStyles.action, { color: t.accent }]}>Today</Text>
        </Pressable>
      </View>

      <View style={sheetStyles.calNavRow}>
        {pickerMode === 'day' ? (
          <Pressable hitSlop={12} onPress={() => setViewing(new Date(year, month - 1, 1))}>
            <Feather name="chevron-left" size={18} color={t.text} />
          </Pressable>
        ) : <View style={{ width: 18 }} />}

        <View style={sheetStyles.calMonthYear}>
          <Pressable hitSlop={8} onPress={() => setPickerMode(pickerMode === 'year' ? 'day' : 'year')}>
            <Text style={[sheetStyles.calYearLabel, { color: pickerMode === 'year' ? t.accent : t.muted }]}>{year}</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setPickerMode(pickerMode === 'month' ? 'day' : 'month')}>
            <Text style={[sheetStyles.calMonthLabel, { color: pickerMode === 'month' ? t.accent : t.text }]}>
              {MONTH_NAMES_LONG[month]}
            </Text>
          </Pressable>
        </View>

        {pickerMode === 'day' ? (
          <Pressable hitSlop={12} onPress={() => setViewing(new Date(year, month + 1, 1))}>
            <Feather name="chevron-right" size={18} color={t.text} />
          </Pressable>
        ) : <View style={{ width: 18 }} />}
      </View>

      {pickerMode === 'year' && (
        <View style={sheetStyles.calSubGrid}>
          {yearRange.map((y) => {
            const isSel = y === year;
            const isNow = y === todayLocal.getFullYear();
            return (
              <Pressable key={y} style={[sheetStyles.calSubCell, isSel && { backgroundColor: t.accent }]}
                onPress={() => { setViewing(new Date(y, month, 1)); setPickerMode('day'); }}>
                <Text style={[sheetStyles.calSubCellText, { color: isSel ? t.onAccent : isNow ? t.accent : t.text, fontWeight: isSel || isNow ? '700' : '400' }]}>{y}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {pickerMode === 'month' && (
        <View style={sheetStyles.calSubGrid}>
          {MONTH_NAMES_SHORT.map((m, i) => {
            const isSel = i === month;
            const isNow = i === todayLocal.getMonth() && year === todayLocal.getFullYear();
            return (
              <Pressable key={i} style={[sheetStyles.calSubCell, isSel && { backgroundColor: t.accent }]}
                onPress={() => { setViewing(new Date(year, i, 1)); setPickerMode('day'); }}>
                <Text style={[sheetStyles.calSubCellText, { color: isSel ? t.onAccent : isNow ? t.accent : t.text, fontWeight: isSel || isNow ? '700' : '400' }]}>{m}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {pickerMode === 'day' && (
        <>
          <View style={sheetStyles.calWeekRow}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
              <Text key={i} style={[sheetStyles.calWeekday, { color: t.muted }]}>{w}</Text>
            ))}
          </View>
          <View style={sheetStyles.calGrid}>
            {cells.map((day, i) => {
              if (!day) return <View key={i} style={sheetStyles.calCell} />;
              const cellDate = new Date(year, month, day);
              const isSel = isoDate(cellDate) === isoDate(selected);
              return (
                <Pressable key={i} style={[sheetStyles.calCell, sheetStyles.calCellInner]} onPress={() => setSelected(new Date(year, month, day))}>
                  {isSel ? (
                    <View style={[sheetStyles.calDaySelected, { backgroundColor: t.accent }]}>
                      <Text style={[sheetStyles.calDayNum, { color: t.onAccent, fontWeight: '700' }]}>{day}</Text>
                    </View>
                  ) : (
                    <Text style={[sheetStyles.calDayNum, { color: t.text }]}>{day}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Pressable style={[sheetStyles.btn, { backgroundColor: t.accent }]} onPress={() => { onChange(selected); onClose(); }}>
        <Text style={[sheetStyles.btnText, { color: t.onAccent }]}>
          Set {selected.getDate()} {selected.toLocaleDateString('en-SG', { month: 'long' })}
        </Text>
      </Pressable>
    </Sheet>
  );
}

const sheetStyles = StyleSheet.create({
  // Sheet base
  scrim: { flex: 1 },
  container: {
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 22, paddingBottom: 26, paddingTop: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.18, shadowRadius: 40,
  },
  handle: { width: 38, height: 4, borderRadius: 3, alignSelf: 'center', marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  action: { fontSize: 13, fontWeight: '600' },
  btn: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  btnText: { fontSize: 16, fontWeight: '600' },

  // Category grid
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, rowGap: 10 },
  catItem: { width: '22%', alignItems: 'center', gap: 7 },
  catIconTile: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  catName: { fontSize: 11, textAlign: 'center' },

  // Account rows
  acctRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15 },
  acctIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  acctName: { fontSize: 15, fontWeight: '600' },
  acctSub: { fontSize: 12, marginTop: 1 },
  acctCheck: { width: 20, height: 20, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },

  // Calendar
  calNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14 },
  calMonthYear: { alignItems: 'center', gap: 1 },
  calYearLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  calMonthLabel: { fontSize: 17, fontWeight: '700' },
  calWeekRow: { flexDirection: 'row', marginBottom: 4 },
  calWeekday: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '700' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: '14.28%', height: 42, alignItems: 'center', justifyContent: 'center' },
  calCellInner: {},
  calDayNum: { fontSize: 14 },
  calDaySelected: { width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  calSubGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  calSubCell: { width: '33.33%', paddingVertical: 11, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  calSubCellText: { fontSize: 14 },

  // Rate adjust sheet
  rateContainer: {
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    shadowColor: '#000', shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.18, shadowRadius: 40,
  },
  ratePadded: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 14 },
  rateHint: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  rateDisplayRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14,
  },
  rateInputLabel: { fontSize: 14, fontWeight: '500' },
  rateDisplayValue: { flex: 1, fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] as any, textAlign: 'right' },
});

const mStyles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: ScreenPadding, paddingVertical: 12 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 60 },
  backLabel: { fontSize: 15 },
  title: { fontSize: 17, fontWeight: '700' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: ScreenPadding, marginBottom: 8, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 15 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: ScreenPadding, paddingTop: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: ScreenPadding, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '700' },
  rowName: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12, marginTop: 1 },
  newText: { fontSize: 15, fontWeight: '600', flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: ScreenPadding, paddingVertical: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 14, fontWeight: '500' },
});

const nStyles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: ScreenPadding, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 60 },
  backLabel: { fontSize: 15 },
  title: { fontSize: 17, fontWeight: '700' },
  actionBtn: { width: 60, alignItems: 'flex-end' },
  action: { fontSize: 15, fontWeight: '600' },
  body: { padding: ScreenPadding },
  input: { minHeight: 120, borderWidth: 1, borderRadius: 14, padding: 14, fontSize: 15, textAlignVertical: 'top' },
  footer: { paddingHorizontal: ScreenPadding, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
});

// component

export default function AddSplitScreen({ route, navigation }: any) {
  const editBill: StoredBill | undefined = route?.params?.editBill;
  const t = useTheme();

  // fixed id for "Me", used to set the first person and payer
  const initMeId = useRef(makePid());

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // form fields
  const [totalStr, setTotalStr] = useState('');
  const [currency, setCurrency] = useState('SGD');
  const [merchant, setMerchant] = useState('');
  const [notes, setNotes] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [splitType, setSplitType] = useState<SplitType>('equal');
  const [people, setPeople] = useState<PersonRow[]>([
    { id: initMeId.current, name: 'Me', amount: '' },
  ]);
  const [splitItems, setSplitItems] = useState<SplitItemState[]>([]);
  const [fees, setFees] = useState<SharedFees>({
    gst: '', serviceCharge: '', feeMode: 'pct',
    delivery: '', deliverySplit: 'equal',
  });
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [liveRate, setLiveRate] = useState<number | null>(null);
  const [entryToAccountRate, setEntryToAccountRate] = useState<number | null>(null);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showCategorySheet, setShowCategorySheet] = useState(false);
  const [showAccountSheet, setShowAccountSheet] = useState(false);
  const [merchantFocused, setMerchantFocused] = useState(false);
  const merchantBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showNoteSheet, setShowNoteSheet] = useState(false);
  const [showEntryRateAdjust, setShowEntryRateAdjust] = useState(false);
  const [showLiveRateAdjust, setShowLiveRateAdjust] = useState(false);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [numpadTarget, setNumpadTarget] = useState<NumpadTarget>(null);

  // UI section state
  const [payerPersonId, setPayerPersonId] = useState<string>(initMeId.current);
  const [payerMode, setPayerMode] = useState(false);
  const [peopleExpanded, setPeopleExpanded] = useState(true);
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [personHistory, setPersonHistory] = useState<string[]>([]);
  const [personInputFocused, setPersonInputFocused] = useState<string | null>(null);
  // person who takes the leftover cent (payer by default)
  const [balancerPersonId, setBalancerPersonId] = useState<string>(initMeId.current);
  const [showBalancerPicker, setShowBalancerPicker] = useState(false);

  // name suggestions for the person being typed
  const personSuggestions = useMemo(() => {
    if (!personInputFocused) return [];
    const target = people.find((p) => p.id === personInputFocused);
    if (!target) return [];
    const q = target.name.toLowerCase().trim();
    const currentNames = new Set(
      people.filter((p) => p.id !== personInputFocused).map((p) => p.name.toLowerCase()),
    );
    return personHistory.filter((n) => {
      const nl = n.toLowerCase();
      return (q === '' || nl.includes(q)) && !currentNames.has(nl);
    });
  }, [personInputFocused, people, personHistory]);

  useEffect(() => {
    Promise.all([
      getAccounts() as Promise<Account[]>,
      getCategories() as Promise<Category[]>,
      getSettings() as Promise<{ homeCurrency: string }>,
      getSplitBills() as Promise<StoredBill[]>,
      getExpenses() as Promise<any[]>,
    ]).then(([accs, cats, settings, bills, exps]) => {
      setAccounts(accs);
      setCategories(cats);
      setHomeCurrency(settings.homeCurrency);
      setMerchants(parseMerchants(exps));

      // get past names from old split bills
      const names = new Set<string>();
      for (const b of bills) {
        for (const e of b.entries) {
          if (e.person && e.person.toLowerCase() !== 'me') names.add(e.person);
        }
        if (b.paidByName) names.add(b.paidByName);
      }
      setPersonHistory([...names]);

      if (editBill) {
        setCurrency(editBill.currency);
        setTotalStr(String(Math.round(editBill.total * 100)));
        setMerchant(editBill.merchant);
        setCategoryId(editBill.categoryId ?? cats[0]?.id ?? '');
        setAccountId(editBill.accountId);
        setDate(new Date(editBill.date + 'T00:00:00'));
        setSplitType(editBill.splitType === 'items' ? 'items' : 'equal');
        setNotes(editBill.notes ?? '');

        let personRows: PersonRow[] = [];
        let initialPayerId: string = initMeId.current;

        if (editBill.splitType === 'items' && editBill.splitItems) {
          const nameToId: Record<string, string> = {};
          const allNames = Array.from(
            new Set(editBill.splitItems.flatMap((i) => i.sharerPersonNames)),
          );
          personRows = allNames.map((n) => {
            const id = makePid();
            nameToId[n] = id;
            return { id, name: n, amount: '' };
          });
          const meIdx = personRows.findIndex((p) => p.name === 'Me');
          if (meIdx > 0) {
            const [me] = personRows.splice(meIdx, 1);
            personRows.unshift(me);
          }
          if (personRows.length === 0) {
            personRows = [{ id: initMeId.current, name: 'Me', amount: '' }];
          }
          setSplitItems(
            editBill.splitItems.map((i) => ({
              id: makePid(),
              name: i.name,
              price: centsStr(i.price),
              sharerIds: i.sharerPersonNames.map((n) => nameToId[n] ?? '').filter(Boolean),
            })),
          );
          if (editBill.sharedFees) {
            const sf = editBill.sharedFees as any;
            const fMode: FeeMode = sf.feeMode ?? sf.gstMode ?? 'pct';
            const feeStr = (v: number) => (fMode === 'pct' ? String(v) : centsStr(v));
            setFees({
              gst: sf.gst > 0 ? feeStr(sf.gst) : '',
              serviceCharge: sf.serviceCharge > 0 ? feeStr(sf.serviceCharge) : '',
              feeMode: fMode,
              delivery: sf.delivery > 0 ? centsStr(sf.delivery) : '',
              deliverySplit: sf.deliverySplit ?? 'equal',
            });
          }
        } else {
          const meId = makePid();
          const meRow: PersonRow = { id: meId, name: 'Me', amount: '' };
          const otherRows: PersonRow[] = editBill.entries.map((e) => ({
            id: makePid(), name: e.person, amount: '',
          }));
          const groupRows: PersonRow[] = (editBill.groupMembers ?? []).map((gm) => ({
            id: makePid(), name: gm.name, amount: '',
          }));
          personRows = [meRow, ...otherRows, ...groupRows];
        }

        // find which person is the payer
        if (editBill.paidBy === 'other' && editBill.paidByName) {
          const payerRow = personRows.find((p) => p.name === editBill.paidByName);
          if (payerRow) {
            initialPayerId = payerRow.id;
          } else {
            const newRow: PersonRow = { id: makePid(), name: editBill.paidByName, amount: '' };
            personRows.push(newRow);
            initialPayerId = newRow.id;
          }
        } else {
          initialPayerId = personRows[0].id;
        }

        setPeople(personRows);
        setPayerPersonId(initialPayerId);
        setBalancerPersonId(initialPayerId);
        setPeopleExpanded(false);
        setDetailsExpanded(false);
      } else {
        const firstAcc = accs[0];
        setCurrency(firstAcc?.primaryCode ?? settings.homeCurrency);
        setAccountId(firstAcc?.id ?? '');
        setCategoryId((cats.find((c) => c.name === 'Food') ?? cats[0])?.id ?? '');
      }

      setLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── live exchange rates
  useEffect(() => {
    const c = currency.trim().toUpperCase();
    if (!c || c === homeCurrency) { setLiveRate(1); return; }
    setLiveRate(null);
    getExchangeRate(c, homeCurrency, isoDate(date)).then(setLiveRate);
  }, [currency, homeCurrency, date]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = currency.trim().toUpperCase();
    const acct = accounts.find((a) => a.id === accountId);
    const aCur = acct?.primaryCode ?? homeCurrency;
    if (!c || c === aCur) { setEntryToAccountRate(1); return; }
    setEntryToAccountRate(null);
    getExchangeRate(c, aCur, isoDate(date)).then(setEntryToAccountRate);
  }, [currency, accountId, accounts, homeCurrency, date]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── people handlers

  function addPerson() {
    const newId = makePid();
    setPeople((ps) => [...ps, { id: newId, name: '', amount: '' }]);
    setPayerMode(false);
    setTimeout(() => setPersonInputFocused(newId), 50);
  }

  function removePerson(id: string) {
    if (payerPersonId === id) setPayerPersonId(people[0].id);
    setPeople((ps) => ps.filter((p, i) => i === 0 || p.id !== id));
    setSplitItems((items) =>
      items.map((item) => ({ ...item, sharerIds: item.sharerIds.filter((sid) => sid !== id) })),
    );
    if (numpadTarget === `person:${id}`) setNumpadTarget(null);
  }

  function updatePersonField(id: string, field: 'name' | 'amount', value: string) {
    setPeople((ps) => ps.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }

  // ── flat items handlers

  function addItem() {
    const allIds = people.map((p) => p.id);
    setSplitItems((items) => [...items, { id: makePid(), name: '', price: '', sharerIds: allIds }]);
  }

  function removeItem(itemId: string) {
    setSplitItems((items) => items.filter((i) => i.id !== itemId));
  }

  function updateItemField(itemId: string, field: 'name' | 'price', value: string) {
    setSplitItems((items) => items.map((i) => (i.id === itemId ? { ...i, [field]: value } : i)));
  }

  function toggleSharer(itemId: string, personId: string) {
    setSplitItems((items) =>
      items.map((item) => {
        if (item.id !== itemId) return item;
        const hasId = item.sharerIds.includes(personId);
        return {
          ...item,
          sharerIds: hasId
            ? item.sharerIds.filter((sid) => sid !== personId)
            : [...item.sharerIds, personId],
        };
      }),
    );
  }

  // ── numpad helpers

  function openNumpad(target: string) {
    Keyboard.dismiss();
    setNumpadTarget(target);
    setPersonInputFocused(null);
  }

  function closeNumpad() { setNumpadTarget(null); }

  function handleNumKey(key: string) {
    if (!numpadTarget) return;
    if (numpadTarget === 'total') {
      setTotalStr((s) => applyNumpadKey(s, key));
    } else if (numpadTarget.startsWith('item:')) {
      const iid = numpadTarget.slice(5);
      setSplitItems((items) =>
        items.map((item) => item.id === iid ? { ...item, price: applyNumpadKey(item.price, key) } : item),
      );
    } else if (numpadTarget === 'gst') {
      setFees((f) => ({ ...f, gst: applyNumpadKey(f.gst, key) }));
    } else if (numpadTarget === 'svc') {
      setFees((f) => ({ ...f, serviceCharge: applyNumpadKey(f.serviceCharge, key) }));
    } else if (numpadTarget === 'delivery') {
      setFees((f) => ({ ...f, delivery: applyNumpadKey(f.delivery, key) }));
    }
  }

  function numpadLabel(): string {
    if (!numpadTarget) return '';
    if (numpadTarget === 'total') return 'Total';
    if (numpadTarget.startsWith('item:')) {
      const iid = numpadTarget.slice(5);
      return splitItems.find((i) => i.id === iid)?.name || 'Item price';
    }
    if (numpadTarget === 'gst') return 'GST';
    if (numpadTarget === 'svc') return 'Service charge';
    if (numpadTarget === 'delivery') return 'Delivery';
    return '';
  }

  function numpadRaw(): string {
    if (!numpadTarget) return '';
    if (numpadTarget === 'total') return totalStr;
    if (numpadTarget.startsWith('item:')) {
      const iid = numpadTarget.slice(5);
      return splitItems.find((i) => i.id === iid)?.price ?? '';
    }
    if (numpadTarget === 'gst') return fees.gst;
    if (numpadTarget === 'svc') return fees.serviceCharge;
    if (numpadTarget === 'delivery') return fees.delivery;
    return '';
  }

  // ── computed values

  const count = Math.max(1, people.length);
  const effectiveTotalManual = parseAmountInput(totalStr);

  const gstVal = fees.feeMode === 'pct' ? (parseFloat(fees.gst) || 0) : parseAmountInput(fees.gst);
  const svcVal = fees.feeMode === 'pct' ? (parseFloat(fees.serviceCharge) || 0) : parseAmountInput(fees.serviceCharge);
  const deliveryFlat = parseAmountInput(fees.delivery);

  const itemsResult = computeItemShares(
    splitItems.map((i) => ({
      id: i.id, name: i.name, price: parseAmountInput(i.price), sharerIds: i.sharerIds,
    })),
    {
      gstPct:  fees.feeMode === 'pct'  ? gstVal : 0,
      gstFlat: fees.feeMode === 'flat' ? gstVal : 0,
      gstMode: fees.feeMode,
      svcPct:  fees.feeMode === 'pct'  ? svcVal : 0,
      svcFlat: fees.feeMode === 'flat' ? svcVal : 0,
      svcMode: fees.feeMode,
      deliveryFlat,
      deliverySplit: fees.deliverySplit,
    },
  );
  const { grandSubtotal, billTotal: itemsModeTotal, shares: itemShares } = itemsResult;

  // items mode uses a typed total, and the items + fees must add up to it
  const effectiveTotal = effectiveTotalManual;
  const itemsBreakdownTotal = itemsModeTotal;
  const itemsDiff = round2(itemsBreakdownTotal - effectiveTotalManual);
  const itemsBalanced = Math.abs(itemsDiff) < 0.005;
  const accountCurrency = accounts.find((a) => a.id === accountId)?.primaryCode ?? homeCurrency;

  // split equally, give the leftover cents to one person
  const baseShare = (effectiveTotal > 0 && count > 0)
    ? Math.floor((effectiveTotal / count) * 100) / 100
    : 0;
  const roundingRemainder = effectiveTotal > 0
    ? round2(effectiveTotal - round2(baseShare * count))
    : 0;
  const hasRemainder = roundingRemainder > 0.001;

  function getPersonShare(p: PersonRow): number {
    if (splitType === 'items') return itemShares[p.id]?.total ?? 0;
    if (hasRemainder && p.id === balancerPersonId) return round2(baseShare + roundingRemainder);
    return baseShare;
  }

  const myShare = getPersonShare(people[0]);

  // work out paidBy / paidByName from the chosen payer
  const payerPerson = people.find((p) => p.id === payerPersonId) ?? people[0];
  const derivedPaidBy: PaidBy = payerPerson.id === people[0].id ? 'me' : 'other';
  const derivedPaidByName: string | null = derivedPaidBy === 'other' ? payerPerson.name.trim() || null : null;
  const payerDisplayName = derivedPaidBy === 'me' ? 'Me' : (payerPerson.name.trim() || 'Someone');

  // ── save

  async function handleSave() {
    if (!merchant.trim()) { Alert.alert('Merchant required'); return; }
    if (effectiveTotal <= 0 || isNaN(effectiveTotal)) {
      Alert.alert('Invalid total', 'Please enter the total bill amount.'); return;
    }
    if (gstVal < 0 || svcVal < 0 || deliveryFlat < 0) {
      Alert.alert('Invalid fees', 'GST, service charge, and delivery cannot be negative.'); return;
    }
    if (fees.feeMode === 'pct' && (gstVal > 100 || svcVal > 100)) {
      Alert.alert('Invalid fees', 'GST and service charge must be between 0 and 100%.'); return;
    }
    if (splitType === 'items' && grandSubtotal <= 0) {
      Alert.alert('No items', 'Add at least one item so the total can be computed.'); return;
    }
    if (splitType === 'items' && splitItems.some((i) => i.sharerIds.length === 0)) {
      Alert.alert('Unassigned item', 'Every item needs at least one person.'); return;
    }
    if (splitType === 'items' && !itemsBalanced) {
      Alert.alert(
        "Bill doesn't balance",
        `Items + charges come to ${currency} ${formatMoney(itemsBreakdownTotal, currency)}, but the total is ${currency} ${formatMoney(effectiveTotalManual, currency)}. Adjust them to match before saving.`,
      );
      return;
    }
    if (!accountId) { Alert.alert('Account required'); return; }
    if (!categoryId) { Alert.alert('Category required'); return; }
    if (derivedPaidBy === 'other' && !derivedPaidByName) {
      Alert.alert('Payer name required', "Enter the payer's name in the people list."); return;
    }
    if (people.some((p) => !p.name.trim())) {
      Alert.alert('Names required', 'Every person needs a name.'); return;
    }

    const account = accounts.find((a) => a.id === accountId);
    if (!account) { Alert.alert('Error', 'Selected account not found.'); return; }

    setSaving(true);
    try {
      const dateStr = isoDate(date);
      const normalCurrency = currency.trim().toUpperCase();
      const finalTotal = effectiveTotal;
      const computedShares = people.map((p) => getPersonShare(p));
      const finalMyShare = computedShares[0];

      const entries: StoredEntry[] = derivedPaidBy === 'me'
        ? people.slice(1).map((p, i) => ({
            person: p.name.trim(),
            share: computedShares[i + 1],
            settled: editBill
              ? (editBill.entries.find((e) => e.person === p.name.trim())?.settled ?? false)
              : false,
            settledAt: editBill
              ? (editBill.entries.find((e) => e.person === p.name.trim())?.settledAt ?? null)
              : null,
          }))
        : [{ person: derivedPaidByName || 'Payer', share: finalMyShare, settled: false, settledAt: null }];

      const nameById = Object.fromEntries(people.map((p) => [p.id, p.name.trim()]));
      const splitItemsData =
        splitType === 'items'
          ? splitItems.map((i) => ({
              name: i.name,
              price: parseAmountInput(i.price),
              sharerPersonNames: i.sharerIds.map((sid) => nameById[sid] ?? '').filter(Boolean),
            }))
          : undefined;

      const sharedFeesData =
        splitType === 'items'
          ? {
              gst: gstVal, serviceCharge: svcVal, feeMode: fees.feeMode,
              delivery: deliveryFlat, deliverySplit: fees.deliverySplit,
            }
          : undefined;

      const groupMembers =
        derivedPaidBy === 'other'
          ? people
              .filter((p) => p.id !== people[0].id && p.id !== payerPersonId)
              .map((p) => ({ name: p.name.trim(), share: computedShares[people.indexOf(p)] }))
          : undefined;

      const billData = {
        merchant: merchant.trim(),
        total: finalTotal,
        currency: normalCurrency,
        date: dateStr,
        paidBy: derivedPaidBy,
        paidByName: derivedPaidByName,
        splitType,
        myShare: finalMyShare,
        entries,
        categoryId,
        accountId,
        notes: notes.trim() || null,
        ...(splitItemsData ? { splitItems: splitItemsData } : {}),
        ...(sharedFeesData ? { sharedFees: sharedFeesData } : {}),
        ...(groupMembers ? { groupMembers } : {}),
      };

      const savedLiveRate = liveRate ?? (await getExchangeRate(normalCurrency, homeCurrency, dateStr)) ?? 1;
      const savedEntryToAccountRate = entryToAccountRate ?? (await getExchangeRate(normalCurrency, account.primaryCode ?? homeCurrency, dateStr)) ?? 1;

      const billDataWithRate = {
        ...billData,
        liveRate: savedLiveRate,
        entryToAccountRate: savedEntryToAccountRate,
      };

      // if the account currency differs from the bill, save the account amount too
      const accountCurrency = account.primaryCode ?? homeCurrency;
      const isCrossAccount  = accountCurrency !== normalCurrency;
      const acctFields = (amt: number) => (isCrossAccount
        ? {
            accountCurrencyAtEntry: accountCurrency,
            accountAmount: Math.round(amt * savedEntryToAccountRate * 100) / 100,
          }
        : {});

      if (editBill) {
        let updatedLinkedId = editBill.linkedExpenseId;
        let updatedMyExpenseId = editBill.myExpenseId ?? null;
        if (derivedPaidBy === 'me') {
          const unsettledTotal = entries.filter((e) => !e.settled).reduce((s, e) => s + e.share, 0);
          if (updatedLinkedId) {
            if (unsettledTotal > 0) {
              await updateExpense(updatedLinkedId, {
                merchant: `Unsettled bill · ${merchant.trim()}`,
                amount: unsettledTotal, amountInHomeCurrency: Math.round(unsettledTotal * savedLiveRate * 100) / 100,
                exchangeRateAtEntry: savedLiveRate,
                accountCurrencyAtEntry: isCrossAccount ? accountCurrency : null,
                accountAmount: isCrossAccount ? Math.round(unsettledTotal * savedEntryToAccountRate * 100) / 100 : null,
                categoryId, date: dateStr, notes: notes.trim() || null,
              });
            } else {
              await deleteExpense(updatedLinkedId);
              updatedLinkedId = null;
            }
          }
          if (updatedMyExpenseId) {
            await updateExpense(updatedMyExpenseId, {
              merchant: merchant.trim(), amount: finalMyShare,
              amountInHomeCurrency: Math.round(finalMyShare * savedLiveRate * 100) / 100,
              exchangeRateAtEntry: savedLiveRate,
              accountCurrencyAtEntry: isCrossAccount ? accountCurrency : null,
              accountAmount: isCrossAccount ? Math.round(finalMyShare * savedEntryToAccountRate * 100) / 100 : null,
              categoryId, date: dateStr, notes: notes.trim() || null,
            });
          }
        }
        await updateSplitBill(editBill.id, {
          ...billDataWithRate, linkedExpenseId: updatedLinkedId, myExpenseId: updatedMyExpenseId,
        });
        const oldEffect = editBill.paidBy === 'me' ? -editBill.total : 0;
        const newEffect = derivedPaidBy === 'me' ? -finalTotal : 0;
        const balanceDelta = -oldEffect + newEffect;
        if (Math.abs(balanceDelta) > 0.001) {
          await updateSubBalance(accountId, account.primaryCode, balanceDelta);
        }
      } else if (derivedPaidBy === 'other') {
        await addSplitBill({ ...billDataWithRate, linkedExpenseId: null, myExpenseId: null });
      } else {
        // i paid: make my own expense plus one to track what others owe
        const myExpense = (await addExpense({
          accountId, categoryId,
          merchant: merchant.trim(),
          amount: finalMyShare, currency: normalCurrency,
          amountInHomeCurrency: Math.round(finalMyShare * savedLiveRate * 100) / 100,
          exchangeRateAtEntry: savedLiveRate,
          ...acctFields(finalMyShare),
          date: dateStr, receiptImageUri: null,
          isShared: false, splitType: null, splitDetails: null,
          notes: notes.trim() || null,
        })) as { id: string };

        const unsettledTotal = entries.reduce((s, e) => s + e.share, 0);
        const linkedExpense = (await addExpense({
          accountId, categoryId,
          merchant: `Unsettled bill · ${merchant.trim()}`,
          amount: unsettledTotal, currency: normalCurrency,
          amountInHomeCurrency: Math.round(unsettledTotal * savedLiveRate * 100) / 100,
          exchangeRateAtEntry: savedLiveRate,
          ...acctFields(unsettledTotal),
          date: dateStr, receiptImageUri: null,
          isShared: false, splitType: null, splitDetails: null,
          notes: notes.trim() || null,
          source: 'split_unsettled',
          kind: 'mustBuy',
        })) as { id: string };

        const bill = await addSplitBill({
          ...billDataWithRate, linkedExpenseId: linkedExpense.id, myExpenseId: myExpense.id,
        });
        const delta = calculateSplitBillBalanceEffect(bill);
        if (delta !== 0) {
          await updateSubBalance(accountId, account.primaryCode, delta);
        }
      }

      navigation.goBack();
    } catch (err) {
      Alert.alert('Error', 'Could not save the split bill. Please try again.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  // ── JSX

  const hr = <View style={[styles.divider, { backgroundColor: t.border }]} />;

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <SafeAreaView style={styles.flex} edges={['top']}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
            <Feather name="x" size={20} color={t.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: t.text }]}>Split bill</Text>
          <Pressable hitSlop={12} onPress={handleSave} disabled={saving}>
            {saving
              ? <ActivityIndicator size="small" color={t.accent} />
              : <Text style={[styles.saveBtn, { color: t.accent }]}>Save</Text>}
          </Pressable>
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
              contentContainerStyle={[
                styles.scrollContent,
                { alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >

              {/* ── Amount hero ── */}
              <View style={styles.amountHero}>
                <Pressable
                  style={[styles.currencyPill, { backgroundColor: t.surface, borderColor: t.border }]}
                  onPress={() => setShowCurrencyPicker(true)}
                >
                  <Text style={[styles.currencyPillText, { color: t.muted }]}>{currency}</Text>
                  <Feather name="chevron-down" size={12} color={t.muted} />
                </Pressable>
                <CurrencyPickerModal
                  visible={showCurrencyPicker}
                  selected={currency}
                  onSelect={(code) => setCurrency(code)}
                  onClose={() => setShowCurrencyPicker(false)}
                />

                <Pressable onPress={() => openNumpad('total')}>
                  <Text style={[styles.amountInput, { color: totalStr ? t.text : t.muted }]}>
                    {formatAmountDisplay(totalStr)}
                  </Text>
                </Pressable>
                <Text style={[styles.amountSubLine, { color: t.muted }]}>
                  {derivedPaidBy === 'me' ? 'You paid' : `${payerDisplayName} paid`}
                  {people.length > 1 ? ` · ${people.length} people` : ''}
                </Text>

                {/* ── Rate rows — inside amountHero, matching AddEntryScreen layout ── */}
                {effectiveTotal > 0 && currency !== accountCurrency && (
                  <Pressable
                    style={[styles.entryRateRow, { borderColor: t.border, backgroundColor: t.surface }]}
                    onPress={() => setShowEntryRateAdjust(true)}
                  >
                    <View style={styles.rateRowLeft}>
                      <Feather name="refresh-cw" size={13} color={t.muted} />
                      <View style={styles.rateRowLines}>
                        <Text style={[styles.rateRowLabel, { color: t.muted }]}>
                          {'1 '}{currency}{' = '}
                          <Text style={[styles.rateRowValue, { color: t.text }]}>
                            {entryToAccountRate ?? '…'}
                          </Text>
                          {' '}{accountCurrency}
                        </Text>
                        <Text style={[styles.rateRowLabel, { color: t.muted }]}>
                          {formatMoney(effectiveTotal, currency)}{' '}{currency}{' = '}
                          <Text style={[styles.rateRowValue, { color: t.text }]}>
                            {entryToAccountRate !== null ? formatMoney(Math.round(effectiveTotal * entryToAccountRate * 100) / 100, accountCurrency) : '…'}
                          </Text>
                          {' '}{accountCurrency}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.rateRowAdjust, { color: t.accent }]}>adjust ›</Text>
                  </Pressable>
                )}
                {effectiveTotal > 0 && currency !== homeCurrency && accountCurrency !== homeCurrency && (
                  <Pressable
                    style={[styles.entryRateRow, { borderColor: t.border, backgroundColor: t.surface }]}
                    onPress={() => setShowLiveRateAdjust(true)}
                  >
                    <View style={styles.rateRowLeft}>
                      <Feather name="refresh-cw" size={13} color={t.muted} />
                      <View style={styles.rateRowLines}>
                        <Text style={[styles.rateRowLabel, { color: t.muted }]}>
                          {'1 '}{currency}{' = '}
                          <Text style={[styles.rateRowValue, { color: t.text }]}>
                            {liveRate ?? '…'}
                          </Text>
                          {' '}{homeCurrency}
                        </Text>
                        <Text style={[styles.rateRowLabel, { color: t.muted }]}>
                          {formatMoney(effectiveTotal, currency)}{' '}{currency}{' = '}
                          <Text style={[styles.rateRowValue, { color: t.text }]}>
                            {liveRate !== null ? formatMoney(Math.round(effectiveTotal * liveRate * 100) / 100, homeCurrency) : '…'}
                          </Text>
                          {' '}{homeCurrency}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.rateRowAdjust, { color: t.accent }]}>adjust ›</Text>
                  </Pressable>
                )}
              </View>

              {/* ── PEOPLE ── */}
              <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                {peopleExpanded ? (
                  <View style={styles.cardSection}>

                    {/* Header: PEOPLE label + Set who paid button */}
                    <View style={styles.peopleHeaderRow}>
                      <Text style={[styles.eyebrow, { color: t.muted }]}>PEOPLE</Text>
                      <Pressable
                        hitSlop={8}
                        style={[
                          styles.setPayerBtn,
                          { borderColor: t.border, backgroundColor: payerMode ? t.accentSoft : 'transparent' },
                        ]}
                        onPress={() => setPayerMode((m) => !m)}
                      >
                        <Text style={[styles.setPayerText, { color: payerMode ? t.accentInk : t.muted }]}>
                          {payerMode ? 'Cancel' : 'Set who paid'}
                        </Text>
                      </Pressable>
                    </View>

                    {/* Person rows */}
                    {people.map((p, i) => {
                      const isPayer = p.id === payerPersonId;
                      const initial = (p.name.trim() || (i === 0 ? 'M' : '?'))[0].toUpperCase();
                      const hasSuggestions = personInputFocused === p.id && personSuggestions.length > 0;

                      return (
                        <View key={p.id}>
                          <View style={[styles.personCard, { backgroundColor: t.bg, borderColor: t.border }]}>
                            <View style={[
                              styles.personAvatar,
                              { backgroundColor: isPayer ? t.accent : t.accentSoft },
                            ]}>
                              <Text style={[
                                styles.personAvatarText,
                                { color: isPayer ? t.onAccent : t.accentInk },
                              ]}>{initial}</Text>
                            </View>

                            <TextInput
                              style={[styles.personNameInput, { color: t.text }]}
                              placeholder={i === 0 ? 'Me' : 'Name'}
                              placeholderTextColor={t.muted}
                              value={p.name}
                              onChangeText={(v) => updatePersonField(p.id, 'name', v)}
                              onFocus={() => { closeNumpad(); setPersonInputFocused(p.id); }}
                              onBlur={() => setTimeout(() => setPersonInputFocused(null), 160)}
                              autoCapitalize="words"
                            />

                            {/* Payer mode: show Set as payer chip on each row */}
                            {payerMode && (
                              <Pressable
                                style={[
                                  styles.setAsPayerChip,
                                  { backgroundColor: isPayer ? t.accent : t.accentSoft },
                                ]}
                                onPress={() => { setPayerPersonId(p.id); setPayerMode(false); }}
                              >
                                <Text style={[
                                  styles.setAsPayerText,
                                  { color: isPayer ? t.onAccent : t.accentInk },
                                ]}>
                                  {isPayer ? 'Payer ✓' : 'Set as payer'}
                                </Text>
                              </Pressable>
                            )}

                            {/* Normal mode: show PAID badge on non-Me payer */}
                            {!payerMode && isPayer && i > 0 && (
                              <View style={[styles.paidBadge, { backgroundColor: t.accentSoft }]}>
                                <Text style={[styles.paidBadgeText, { color: t.accentInk }]}>PAID</Text>
                              </View>
                            )}

                            {/* Remove button — not on first row, hidden in payer mode */}
                            {i > 0 && !payerMode && (
                              <Pressable
                                hitSlop={12}
                                style={[styles.removePersonBtn, { backgroundColor: t.dangerSoft }]}
                                onPress={() => removePerson(p.id)}
                              >
                                <Feather name="x" size={15} color={t.danger} />
                              </Pressable>
                            )}
                          </View>

                          {/* Inline autocomplete suggestions */}
                          {hasSuggestions && (
                            <View style={[styles.suggestBox, { backgroundColor: t.surface, borderColor: t.border }]}>
                              {personSuggestions.map((name) => (
                                <Pressable
                                  key={name}
                                  style={[styles.suggestRow, { borderBottomColor: t.border }]}
                                  onPress={() => {
                                    updatePersonField(p.id, 'name', name);
                                    setPersonInputFocused(null);
                                  }}
                                >
                                  <View style={[styles.suggestAvatar, { backgroundColor: t.accentSoft }]}>
                                    <Text style={[styles.suggestAvatarText, { color: t.accentInk }]}>
                                      {name[0].toUpperCase()}
                                    </Text>
                                  </View>
                                  <Text style={[styles.suggestName, { color: t.text }]}>{name}</Text>
                                </Pressable>
                              ))}
                            </View>
                          )}
                        </View>
                      );
                    })}

                    {/* Add person + Done row */}
                    <View style={styles.peopleBtmRow}>
                      <Pressable
                        style={[styles.addPersonBtn, { borderColor: t.border }]}
                        onPress={addPerson}
                      >
                        <Feather name="plus" size={14} color={t.muted} />
                        <Text style={[styles.addPersonText, { color: t.muted }]}>Add person</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.donePeopleBtn, { backgroundColor: t.accent }]}
                        onPress={() => { setPeopleExpanded(false); setPayerMode(false); }}
                      >
                        <Text style={[styles.donePeopleBtnText, { color: t.onAccent }]}>Done</Text>
                      </Pressable>
                    </View>

                  </View>
                ) : (
                  /* Collapsed people summary */
                  <Pressable
                    style={styles.collapsedPeople}
                    onPress={() => setPeopleExpanded(true)}
                  >
                    <View style={styles.collapsedPeopleLeft}>
                      <Feather name="users" size={15} color={t.muted} />
                      <View>
                        <Text style={[styles.collapsedWhoLabel, { color: t.muted }]}>
                          Who paid:{' '}
                          <Text style={{ color: t.text, fontWeight: '700' }}>{payerDisplayName}</Text>
                        </Text>
                        <Text style={[styles.collapsedAmongLabel, { color: t.muted }]}>
                          shared among {people.length} {people.length === 1 ? 'person' : 'people'}
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.editPeopleBtn, { borderColor: t.border }]}>
                      <Text style={[styles.editPeopleBtnText, { color: t.muted }]}>Edit</Text>
                    </View>
                  </Pressable>
                )}
              </View>

              {/* ── SPLIT TYPE — 2 options ── */}
              <View style={styles.splitTypeSection}>
                <View style={[styles.segTrack, { backgroundColor: t.bg, borderColor: t.border }]}>
                  {(['equal', 'items'] as SplitType[]).map((opt) => (
                    <Pressable
                      key={opt}
                      style={[
                        styles.segThumb,
                        splitType === opt && [styles.segThumbActive, { backgroundColor: t.surface }],
                      ]}
                      onPress={() => setSplitType(opt)}
                    >
                      <Text style={[
                        styles.segText,
                        { color: splitType === opt ? t.text : t.muted, fontWeight: splitType === opt ? '700' : '500' },
                      ]}>
                        {opt === 'equal' ? 'Split equally' : 'By items'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* ── DETAILS (merchant / category / account / date / note) ── */}
              <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                {detailsExpanded ? (
                  <>
                    {(() => {
                      const q = merchant.toLowerCase();
                      const merchantSuggestions = merchantFocused && merchant.length > 0
                        ? merchants.filter((m) => m.name.toLowerCase().includes(q) && m.name.toLowerCase() !== q).slice(0, 3)
                        : [];
                      return (
                        <>
                          <View style={[styles.detailFieldRow, { borderBottomColor: merchantSuggestions.length > 0 ? 'transparent' : t.border }]}>
                            <View style={styles.fieldRowLeft}>
                              <Feather name="shopping-bag" size={16} color={t.muted} />
                              <Text style={[styles.fieldLabel, { color: t.muted }]}>Merchant</Text>
                            </View>
                            <TextInput
                              value={merchant}
                              onChangeText={setMerchant}
                              placeholder="Add merchant"
                              placeholderTextColor={t.muted}
                              style={[styles.fieldInlineInput, { color: t.text }]}
                              returnKeyType="done"
                              autoCapitalize="words"
                              onFocus={() => {
                                if (merchantBlurTimer.current) clearTimeout(merchantBlurTimer.current);
                                closeNumpad();
                                setMerchantFocused(true);
                              }}
                              onBlur={() => {
                                merchantBlurTimer.current = setTimeout(() => setMerchantFocused(false), 150);
                              }}
                            />
                          </View>
                          {merchantSuggestions.length > 0 && (
                            <View style={[styles.suggestStrip, { borderBottomColor: t.border, borderTopColor: t.border }]}>
                              {merchantSuggestions.map((m, i) => (
                                <Pressable
                                  key={m.name}
                                  style={[
                                    styles.suggestItem,
                                    { backgroundColor: t.surface },
                                    i < merchantSuggestions.length - 1 && { borderRightColor: t.border, borderRightWidth: StyleSheet.hairlineWidth },
                                  ]}
                                  onPress={() => {
                                    if (merchantBlurTimer.current) clearTimeout(merchantBlurTimer.current);
                                    setMerchant(m.name);
                                    if (m.categoryId && categories.find((c) => c.id === m.categoryId)) setCategoryId(m.categoryId);
                                    setMerchantFocused(false);
                                  }}
                                >
                                  <Text style={[styles.suggestName, { color: t.text }]} numberOfLines={1}>{m.name}</Text>
                                </Pressable>
                              ))}
                            </View>
                          )}
                        </>
                      );
                    })()}

                    <Pressable
                      style={[styles.detailFieldRow, { borderBottomColor: t.border }]}
                      onPress={() => setShowCategorySheet(true)}
                    >
                      <View style={styles.fieldRowLeft}>
                        <Feather name="tag" size={16} color={t.muted} />
                        <Text style={[styles.fieldLabel, { color: t.muted }]}>Category</Text>
                      </View>
                      <View style={styles.fieldRowRight}>
                        <Text style={[styles.fieldValue, { color: t.text }]} numberOfLines={1}>
                          {categories.find((c) => c.id === categoryId)?.name ?? '—'}
                        </Text>
                        <Feather name="chevron-right" size={15} color={t.muted} />
                      </View>
                    </Pressable>

                    <Pressable
                      style={[styles.detailFieldRow, { borderBottomColor: t.border }]}
                      onPress={() => setShowAccountSheet(true)}
                    >
                      <View style={styles.fieldRowLeft}>
                        <Feather name="credit-card" size={16} color={t.muted} />
                        <Text style={[styles.fieldLabel, { color: t.muted }]}>Account</Text>
                      </View>
                      <View style={styles.fieldRowRight}>
                        <Text style={[styles.fieldValue, { color: t.text }]} numberOfLines={1}>
                          {(() => { const a = accounts.find((x) => x.id === accountId); return a ? `${a.name} · ${a.primaryCode}` : '—'; })()}
                        </Text>
                        <Feather name="chevron-right" size={15} color={t.muted} />
                      </View>
                    </Pressable>

                    <Pressable
                      style={[styles.detailFieldRow, { borderBottomColor: t.border }]}
                      onPress={() => setShowDatePicker(true)}
                    >
                      <View style={styles.fieldRowLeft}>
                        <Feather name="calendar" size={16} color={t.muted} />
                        <Text style={[styles.fieldLabel, { color: t.muted }]}>Date</Text>
                      </View>
                      <View style={styles.fieldRowRight}>
                        <Text style={[styles.fieldValue, { color: t.text }]}>{fmtDisplayDate(date)}</Text>
                        <Feather name="chevron-right" size={15} color={t.muted} />
                      </View>
                    </Pressable>

                    <Pressable
                      style={[styles.detailFieldRow, { borderBottomColor: t.border }]}
                      onPress={() => setShowNoteSheet(true)}
                    >
                      <View style={styles.fieldRowLeft}>
                        <Feather name="edit-2" size={16} color={t.muted} />
                        <Text style={[styles.fieldLabel, { color: t.muted }]}>Note</Text>
                      </View>
                      <View style={styles.fieldRowRight}>
                        <Text style={[styles.fieldValue, { color: notes ? t.text : t.muted }]} numberOfLines={1}>
                          {notes || 'optional'}
                        </Text>
                        <Feather name="chevron-right" size={15} color={t.muted} />
                      </View>
                    </Pressable>

                    <Pressable
                      style={styles.detailsToggleRow}
                      onPress={() => setDetailsExpanded(false)}
                    >
                      <Feather name="chevron-up" size={14} color={t.muted} />
                      <Text style={[styles.detailsToggleText, { color: t.muted }]}>Hide details</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable style={styles.collapsedDetails} onPress={() => setDetailsExpanded(true)}>
                    <View style={styles.collapsedDetailsLeft}>
                      <Feather name="shopping-bag" size={15} color={t.muted} />
                      <Text
                        style={[styles.collapsedMerchant, { color: merchant ? t.text : t.muted }]}
                        numberOfLines={1}
                      >
                        {merchant || 'No merchant'}
                      </Text>
                      <Text style={[styles.collapsedDetailsSep, { color: t.muted }]}>·</Text>
                      <Text style={[styles.collapsedDetailsDate, { color: t.muted }]}>
                        {fmtDisplayDate(date)}
                      </Text>
                    </View>
                    <View style={styles.fieldRowRight}>
                      <Text style={[styles.detailsToggleText, { color: t.muted }]}>Show</Text>
                      <Feather name="chevron-down" size={14} color={t.muted} />
                    </View>
                  </Pressable>
                )}
              </View>

              {/* ── Items (by-items mode) ── */}
              {splitType === 'items' && (
                <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                  <View style={styles.cardSection}>
                    <Text style={[styles.eyebrow, { color: t.muted }]}>ITEMS</Text>
                    {splitItems.map((item) => (
                      <View key={item.id} style={[styles.itemRow, { borderBottomColor: t.border }]}>
                        <TextInput
                          style={[styles.itemNameInput, { color: t.text }]}
                          placeholder="Item name"
                          placeholderTextColor={t.muted}
                          value={item.name}
                          onChangeText={(v) => updateItemField(item.id, 'name', v)}
                        />
                        <View style={styles.sharerAvatars}>
                          {people.map((p) => {
                            const active = item.sharerIds.includes(p.id);
                            const initial = (p.name.trim() || '?')[0].toUpperCase();
                            return (
                              <Pressable
                                key={p.id}
                                style={[
                                  styles.sharerAvatar,
                                  active
                                    ? { backgroundColor: t.accent }
                                    : { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 },
                                ]}
                                onPress={() => toggleSharer(item.id, p.id)}
                              >
                                <Text style={[styles.sharerInitial, { color: active ? t.onAccent : t.muted }]}>
                                  {initial}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <Pressable onPress={() => openNumpad(`item:${item.id}`)} style={styles.itemPriceCol}>
                          <Text style={[
                            styles.itemPriceInput,
                            { color: numpadTarget === `item:${item.id}` ? t.accent : item.price ? t.text : t.muted },
                          ]}>
                            {currency} {item.price ? formatAmountDisplay(item.price, currency) : formatAmountDisplay('0', currency)}
                          </Text>
                          {currency !== homeCurrency && liveRate !== null && parseAmountInput(item.price) > 0 && (
                            <Text style={[styles.itemPriceHome, { color: t.muted }]}>
                              ≈ {homeCurrency} {formatMoney(Math.round(parseAmountInput(item.price) * liveRate * 100) / 100, homeCurrency)}
                            </Text>
                          )}
                        </Pressable>
                        <Pressable onPress={() => removeItem(item.id)} hitSlop={8}>
                          <Text style={[styles.removeBtn, { color: t.muted }]}>×</Text>
                        </Pressable>
                      </View>
                    ))}
                    <Pressable style={[styles.addItemBtn, { borderColor: t.border }]} onPress={addItem}>
                      <Feather name="plus" size={13} color={t.muted} />
                      <Text style={[styles.addItemText, { color: t.muted }]}>Add item</Text>
                      {grandSubtotal > 0 && (
                        <Text style={[styles.itemsSubtotal, { color: t.muted }]}>
                          · subtotal {currency} {formatMoney(grandSubtotal, currency)}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              )}

              {/* ── Charges & fees (items mode) ── */}
              {splitType === 'items' && (
                <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                  <View style={styles.cardSection}>

                    <View style={styles.feeHeaderRow}>
                      <Text style={[styles.eyebrow, { color: t.muted }]}>CHARGES & FEES</Text>
                      <View style={[styles.modeSeg, { backgroundColor: t.bg, borderColor: t.border }]}>
                        {(['pct', 'flat'] as FeeMode[]).map((m) => (
                          <Pressable
                            key={m}
                            style={[styles.modeThumb, fees.feeMode === m && [styles.modeThumbActive, { backgroundColor: t.surface }]]}
                            onPress={() => setFees((f) => ({ ...f, feeMode: m, gst: '', serviceCharge: '' }))}
                          >
                            <Text style={[styles.modeText, { color: fees.feeMode === m ? t.text : t.muted }]}>
                              {m === 'pct' ? '%' : currency}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>

                    <Pressable style={styles.feeRow} onPress={() => openNumpad('gst')}>
                      <Text style={[styles.feeLabel, { color: t.muted }]}>GST</Text>
                      <View style={styles.feeInputWrap}>
                        <Text style={[
                          styles.feeValue,
                          { color: numpadTarget === 'gst' ? t.accent : fees.gst ? t.text : t.muted },
                        ]}>
                          {fees.gst
                            ? fees.feeMode === 'pct' ? `${fees.gst}%` : `${currency} ${formatAmountDisplay(fees.gst)}`
                            : fees.feeMode === 'pct' ? '0%' : '—'}
                        </Text>
                        {fees.feeMode === 'pct' && gstVal > 0 && grandSubtotal > 0 && (
                          <Text style={[styles.feeComputed, { color: t.accent }]}>
                            = {formatMoney(grandSubtotal * gstVal / 100, currency)}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                    {hr}

                    <Pressable style={styles.feeRow} onPress={() => openNumpad('svc')}>
                      <Text style={[styles.feeLabel, { color: t.muted }]}>Service charge</Text>
                      <View style={styles.feeInputWrap}>
                        <Text style={[
                          styles.feeValue,
                          { color: numpadTarget === 'svc' ? t.accent : fees.serviceCharge ? t.text : t.muted },
                        ]}>
                          {fees.serviceCharge
                            ? fees.feeMode === 'pct' ? `${fees.serviceCharge}%` : `${currency} ${formatAmountDisplay(fees.serviceCharge)}`
                            : fees.feeMode === 'pct' ? '0%' : '—'}
                        </Text>
                        {fees.feeMode === 'pct' && svcVal > 0 && grandSubtotal > 0 && (
                          <Text style={[styles.feeComputed, { color: t.accent }]}>
                            = {formatMoney(grandSubtotal * svcVal / 100, currency)}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                    {hr}

                    <View style={styles.feeBlock}>
                      <Pressable style={styles.feeRow} onPress={() => openNumpad('delivery')}>
                        <Text style={[styles.feeLabel, { color: t.muted }]}>Delivery</Text>
                        <Text style={[
                          styles.feeValue,
                          { color: numpadTarget === 'delivery' ? t.accent : fees.delivery ? t.text : t.muted },
                        ]}>
                          {fees.delivery ? `${currency} ${formatAmountDisplay(fees.delivery)}` : '—'}
                        </Text>
                      </Pressable>
                      {deliveryFlat > 0 && (
                        <View style={styles.deliverySplitRow}>
                          <Text style={[styles.deliverySplitLabel, { color: t.muted }]}>Split delivery</Text>
                          <View style={[styles.modeSeg, { backgroundColor: t.bg, borderColor: t.border }]}>
                            {(['equal', 'proportional'] as DeliverySplit[]).map((m) => (
                              <Pressable
                                key={m}
                                style={[styles.modeThumb, fees.deliverySplit === m && [styles.modeThumbActive, { backgroundColor: t.surface }]]}
                                onPress={() => setFees((f) => ({ ...f, deliverySplit: m }))}
                              >
                                <Text style={[styles.modeText, { color: fees.deliverySplit === m ? t.text : t.muted }]}>
                                  {m === 'equal' ? 'Equally' : 'By order'}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      )}
                    </View>

                  </View>
                </View>
              )}

              {/* ── Balance check — items mode ── */}
              {splitType === 'items' && effectiveTotalManual > 0 && grandSubtotal > 0 && !itemsBalanced && (
                <View style={[styles.card, { backgroundColor: t.dangerSoft, borderColor: t.danger }]}>
                  <View style={styles.cardSection}>
                    <View style={styles.balanceErrorRow}>
                      <Feather name="alert-triangle" size={15} color={t.danger} />
                      <Text style={[styles.balanceErrorText, { color: t.danger }]}>
                        {itemsDiff > 0
                          ? `Items + charges are ${currency} ${formatMoney(itemsDiff, currency)} over the total.`
                          : `Items + charges are ${currency} ${formatMoney(-itemsDiff, currency)} under the total.`}
                      </Text>
                    </View>
                    <View style={styles.balanceErrorBreakdown}>
                      <Text style={[styles.balanceErrorSub, { color: t.muted }]}>
                        Items + charges: {currency} {formatMoney(itemsBreakdownTotal, currency)}
                      </Text>
                      <Text style={[styles.balanceErrorSub, { color: t.muted }]}>
                        Total entered: {currency} {formatMoney(effectiveTotalManual, currency)}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {/* ── Summary — items mode ── */}
              {splitType === 'items' && effectiveTotalManual > 0 && itemsBalanced && Object.keys(itemShares).length > 0 && (
                <View style={[styles.card, { backgroundColor: t.accentSoft, borderColor: t.border }]}>
                  <View style={styles.cardSection}>
                    <Text style={[styles.eyebrow, { color: t.accentInk }]}>EACH PERSON PAYS</Text>
                    {people.map((p) => {
                      const share = itemShares[p.id];
                      if (!share) return null;
                      const initial = (p.name.trim() || '?')[0].toUpperCase();
                      return (
                        <View key={p.id} style={styles.eachPayRow}>
                          <View style={[styles.eachPayAvatar, { backgroundColor: t.surface }]}>
                            <Text style={[styles.eachPayInitial, { color: t.text }]}>{initial}</Text>
                          </View>
                          <View style={styles.eachPayMid}>
                            <Text style={[styles.eachPayName, { color: t.accentInk }]}>
                              {p.name.trim() || (people.indexOf(p) === 0 ? 'Me' : '?')}
                            </Text>
                            <Text style={[styles.eachPaySub, { color: t.accentInk }]}>
                              {currency} {formatMoney(share.itemsTotal, currency)} items
                              {share.chargesTotal > 0 ? ` + ${currency} ${formatMoney(share.chargesTotal, currency)} charges` : ''}
                            </Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={[styles.eachPayTotal, { color: t.accentInk }]}>
                              {currency} {formatMoney(share.total, currency)}
                            </Text>
                            {currency !== homeCurrency && liveRate !== null && (
                              <Text style={[styles.eachPayHomeSub, { color: t.accentInk, opacity: 0.6 }]}>
                                ≈ {homeCurrency} {formatMoney(Math.round(share.total * liveRate * 100) / 100, homeCurrency)}
                              </Text>
                            )}
                          </View>
                        </View>
                      );
                    })}
                    <View style={[styles.eachPayDivider, { backgroundColor: t.accentInk, opacity: 0.15 }]} />
                    <View style={styles.eachPayBillTotal}>
                      <Text style={[styles.eachPayBillLabel, { color: t.accentInk }]}>Bill total {currency}</Text>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.eachPayBillAmt, { color: t.accentInk }]}>
                          {formatMoney(itemsModeTotal, currency)}
                        </Text>
                        {currency !== homeCurrency && liveRate !== null && (
                          <Text style={[styles.eachPayHomeSub, { color: t.accentInk, opacity: 0.6 }]}>
                            ≈ {homeCurrency} {formatMoney(Math.round(itemsModeTotal * liveRate * 100) / 100, homeCurrency)}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                </View>
              )}

              {/* ── Summary — equal mode ── */}
              {splitType === 'equal' && effectiveTotal > 0 && (
                <View style={[styles.card, { backgroundColor: t.accentSoft, borderColor: t.border }]}>
                  <View style={styles.cardSection}>
                    <Text style={[styles.eyebrow, { color: t.accentInk }]}>EACH PERSON PAYS</Text>
                    {people.map((p) => {
                      const share = getPersonShare(p);
                      const initial = (p.name.trim() || '?')[0].toUpperCase();
                      const isPayer = p.id === payerPersonId;
                      const isBalancer = hasRemainder && p.id === balancerPersonId;
                      return (
                        <View key={p.id} style={styles.eachPayRow}>
                          <View style={[styles.eachPayAvatar, { backgroundColor: t.surface }]}>
                            <Text style={[styles.eachPayInitial, { color: t.text }]}>{initial}</Text>
                          </View>
                          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={[styles.eachPayName, { color: t.accentInk }]}>
                              {p.name.trim() || (people.indexOf(p) === 0 ? 'Me' : '?')}
                              {isPayer
                                ? <Text style={[styles.eachPaySub, { color: t.accentInk }]}> (paid)</Text>
                                : null}
                            </Text>
                            {isBalancer && (
                              <View style={[styles.balancerBadge, { backgroundColor: t.surface }]}>
                                <Text style={[styles.balancerBadgeText, { color: t.accentInk }]}>+{currency} {formatMoney(roundingRemainder, currency)}</Text>
                              </View>
                            )}
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={[styles.eachPayTotal, { color: t.accentInk }]}>
                              {currency} {formatMoney(share, currency)}
                            </Text>
                            {currency !== homeCurrency && liveRate !== null && (
                              <Text style={[styles.eachPayHomeSub, { color: t.accentInk, opacity: 0.6 }]}>
                                ≈ {homeCurrency} {formatMoney(Math.round(share * liveRate * 100) / 100, homeCurrency)}
                              </Text>
                            )}
                          </View>
                        </View>
                      );
                    })}
                    <View style={[styles.eachPayDivider, { backgroundColor: t.accentInk, opacity: 0.15 }]} />
                    <View style={styles.eachPayBillTotal}>
                      <Text style={[styles.eachPayBillLabel, { color: t.accentInk }]}>My share</Text>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.eachPayBillAmt, { color: t.accentInk }]}>
                          {currency} {formatMoney(myShare, currency)}
                        </Text>
                        {currency !== homeCurrency && liveRate !== null && (
                          <Text style={[styles.eachPayHomeSub, { color: t.accentInk, opacity: 0.6 }]}>
                            ≈ {homeCurrency} {formatMoney(Math.round(myShare * liveRate * 100) / 100, homeCurrency)}
                          </Text>
                        )}
                      </View>
                    </View>

                    {/* Rounding note */}
                    {hasRemainder && (
                      <View style={[styles.balancerNote, { backgroundColor: t.surface }]}>
                        <Text style={[styles.balancerNoteText, { color: t.muted }]}>
                          {currency} {formatMoney(roundingRemainder, currency)} rounding handled by{' '}
                          <Text style={{ color: t.text, fontWeight: '700' }}>
                            {(people.find((p) => p.id === balancerPersonId)?.name.trim() || 'Me')}
                          </Text>
                        </Text>
                        {!showBalancerPicker ? (
                          <Pressable hitSlop={8} onPress={() => setShowBalancerPicker(true)}>
                            <Text style={[styles.balancerChangeText, { color: t.accent }]}>Change</Text>
                          </Pressable>
                        ) : (
                          <View style={styles.balancerPickerRow}>
                            {people.map((p) => {
                              const isSel = p.id === balancerPersonId;
                              return (
                                <Pressable
                                  key={p.id}
                                  style={[
                                    styles.balancerPickerChip,
                                    { backgroundColor: isSel ? t.accent : t.accentSoft },
                                  ]}
                                  onPress={() => { setBalancerPersonId(p.id); setShowBalancerPicker(false); }}
                                >
                                  <Text style={[styles.balancerPickerChipText, { color: isSel ? t.onAccent : t.accentInk }]}>
                                    {p.name.trim() || (people.indexOf(p) === 0 ? 'Me' : '?')}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              )}

              <View style={{ height: 48 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        )}

        {numpadTarget && (
          <>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeNumpad} />
            <View style={[styles.numpadDrawer, { backgroundColor: t.surface, borderTopColor: t.border }]}>
              <View style={styles.numpadHeader}>
                <Text style={[styles.numpadLabel, { color: t.muted }]}>{numpadLabel()}</Text>
                <Text style={[styles.numpadValue, { color: t.text }]}>
                  {numpadTarget === 'gst' || numpadTarget === 'svc'
                    ? fees.feeMode === 'pct'
                      ? `${numpadRaw() || '0'}%`
                      : `${currency} ${formatAmountDisplay(numpadRaw())}`
                    : `${currency} ${formatAmountDisplay(numpadRaw())}`}
                </Text>
                <Pressable hitSlop={12} style={[styles.doneBtn, { backgroundColor: t.accent }]} onPress={closeNumpad}>
                  <Text style={[styles.doneBtnText, { color: t.onAccent }]}>Done</Text>
                </Pressable>
              </View>
              <NumericKeypad onKey={handleNumKey} />
            </View>
          </>
        )}
      </SafeAreaView>

      <CategorySheet
        visible={showCategorySheet}
        onClose={() => setShowCategorySheet(false)}
        categories={categories}
        selected={categoryId}
        onSelect={(id) => setCategoryId(id)}
        t={t}
      />
      <AccountSheet
        visible={showAccountSheet}
        onClose={() => setShowAccountSheet(false)}
        accounts={accounts}
        selected={accountId}
        onSelect={(id) => {
          setAccountId(id);
          const acct = accounts.find((a) => a.id === id);
          if (acct?.primaryCode) setCurrency(acct.primaryCode);
        }}
        t={t}
      />
      <DatePickerSheet
        visible={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        value={date}
        onChange={setDate}
        t={t}
      />
      <NoteInputSheet
        visible={showNoteSheet}
        onClose={() => setShowNoteSheet(false)}
        value={notes}
        onChange={setNotes}
        t={t}
      />
      <RateAdjustSheet
        visible={showEntryRateAdjust}
        onClose={() => setShowEntryRateAdjust(false)}
        fromCurrency={currency}
        toCurrency={accountCurrency}
        rate={entryToAccountRate}
        amount={effectiveTotal}
        onSave={(r) => setEntryToAccountRate(r)}
        t={t}
      />
      <RateAdjustSheet
        visible={showLiveRateAdjust}
        onClose={() => setShowLiveRateAdjust(false)}
        fromCurrency={currency}
        toCurrency={homeCurrency}
        rate={liveRate}
        amount={effectiveTotal}
        onSave={(r) => setLiveRate(r)}
        t={t}
      />
    </View>
  );
}

// styles

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: 12,
  },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  saveBtn: { fontSize: 15, fontWeight: '700' },

  scrollContent: { paddingBottom: 40 },

  // Cards
  card: {
    borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden',
    marginTop: 14, marginHorizontal: ScreenPadding,
  },
  cardSection: { padding: 16, gap: 10 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  divider: { height: StyleSheet.hairlineWidth },

  // People section
  peopleHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  setPayerBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
  },
  setPayerText: { fontSize: 12, fontWeight: '600' },
  personCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1, padding: 12,
  },
  personAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  personAvatarText: { fontSize: 14, fontWeight: '700' },
  personNameInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  setAsPayerChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  setAsPayerText: { fontSize: 11, fontWeight: '600' },
  paidBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  paidBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  removePersonBtn: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  peopleBtmRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4,
  },
  addPersonBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1,
  },
  addPersonText: { fontSize: 12, fontWeight: '500' },
  donePeopleBtn: { paddingHorizontal: 22, paddingVertical: 9, borderRadius: 10 },
  donePeopleBtnText: { fontSize: 13, fontWeight: '700' },

  // People collapsed
  collapsedPeople: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  collapsedPeopleLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  collapsedWhoLabel: { fontSize: 13 },
  collapsedAmongLabel: { fontSize: 12, marginTop: 2 },
  editPeopleBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  editPeopleBtnText: { fontSize: 12, fontWeight: '600' },

  // Autocomplete suggestions
  suggestBox: {
    borderRadius: 10, borderWidth: 1, overflow: 'hidden',
    marginTop: -2, marginBottom: 4,
  },
  suggestRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  suggestAvatarText: { fontSize: 12, fontWeight: '700' },
  suggestName: { fontSize: 14, fontWeight: '500' },
  fieldInlineInput: { flex: 1, fontSize: 15, fontWeight: '500', textAlign: 'right' },
  suggestStrip: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestItem: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 12,
    alignItems: 'center', justifyContent: 'center',
  },

  // Amount hero
  amountHero: {
    alignItems: 'center', gap: 7, paddingTop: 28,
    paddingHorizontal: ScreenPadding, paddingBottom: 0,
  },
  currencyPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, borderWidth: 1,
  },
  currencyPillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  amountInput: {
    fontSize: 52, fontWeight: '600', letterSpacing: -2.4,
    fontVariant: ['tabular-nums'] as any,
  },
  amountDisplay: {
    fontSize: 52, fontWeight: '600', letterSpacing: -2.4,
    fontVariant: ['tabular-nums'] as any,
  },
  amountSubLine: { fontSize: 13 },

  // Split type
  splitTypeSection: { paddingHorizontal: ScreenPadding, paddingTop: 18 },
  segTrack: { flexDirection: 'row', padding: 3, borderRadius: 13, borderWidth: 1 },
  segThumb: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  segThumbActive: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07, shadowRadius: 3, elevation: 2,
  },
  segText: { fontSize: 13 },

  // Details card (merchant / category / account / date / note)
  detailFieldRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 15, paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fieldRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  fieldRowRight: { flexDirection: 'row', alignItems: 'center', gap: 9, maxWidth: '60%' },
  fieldLabel: { fontSize: 14 },
  fieldValue: { fontSize: 15, fontWeight: '600' },
  fieldValueInput: {
    flex: 1, fontSize: 15, fontWeight: '600',
    paddingVertical: 0, maxWidth: '60%',
  },
  detailsToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 13,
  },
  detailsToggleText: { fontSize: 12, fontWeight: '500' },
  collapsedDetails: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  collapsedDetailsLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  collapsedMerchant: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  collapsedDetailsSep: { fontSize: 13 },
  collapsedDetailsDate: { fontSize: 12 },

  // Items
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 8, marginBottom: 4,
  },
  itemNameInput: { flex: 1, fontSize: 14, fontWeight: '600', paddingVertical: 0 },
  itemPriceCol: { minWidth: 52, alignItems: 'flex-end', gap: 1 },
  itemPriceInput: {
    fontSize: 14, fontWeight: '700',
    fontVariant: ['tabular-nums'] as any, textAlign: 'right', paddingVertical: 0,
  },
  itemPriceHome: { fontSize: 10, fontVariant: ['tabular-nums'] as any },
  sharerAvatars: { flexDirection: 'row', gap: -4 },
  sharerAvatar: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sharerInitial: { fontSize: 10, fontWeight: '700' },
  addItemBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth, marginTop: 4,
  },
  addItemText: { fontSize: 12, fontWeight: '500' },
  itemsSubtotal: { fontSize: 11, fontVariant: ['tabular-nums'] as any },
  removeBtn: { fontSize: 20, lineHeight: 24, paddingHorizontal: 4 },

  // Fees
  feeHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feeBlock: { gap: 6 },
  feeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  feeLabel: { fontSize: 13, flex: 1 },
  feeInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  feeValue: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  feeComputed: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] as any, minWidth: 40, textAlign: 'right', opacity: 0.7 },
  modeSeg: { flexDirection: 'row', padding: 2, borderRadius: 8, borderWidth: 1 },
  modeThumb: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  modeThumbActive: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07, shadowRadius: 2, elevation: 1,
  },
  modeText: { fontSize: 12, fontWeight: '600' },
  deliverySplitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 4 },
  deliverySplitLabel: { fontSize: 12 },

  // Summary (each person pays)
  eachPayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  eachPayAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  eachPayInitial: { fontSize: 12, fontWeight: '700' },
  eachPayMid: { flex: 1, gap: 2 },
  eachPayName: { fontSize: 14, fontWeight: '700' },
  eachPaySub: { fontSize: 11, opacity: 0.75 },
  eachPayTotal: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] as any },
  eachPayHomeSub: { fontSize: 11, fontVariant: ['tabular-nums'] as any },
  eachPayDivider: { height: StyleSheet.hairlineWidth, marginVertical: 6 },
  eachPayBillTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eachPayBillLabel: { fontSize: 13, fontWeight: '600' },
  eachPayBillAmt: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] as any },

  // Items balance error
  balanceErrorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  balanceErrorText: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  balanceErrorBreakdown: { marginTop: 8, gap: 2 },
  balanceErrorSub: { fontSize: 12, fontVariant: ['tabular-nums'] as any },

  // Rounding balancer
  balancerBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  balancerBadgeText: { fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] as any },
  balancerNote: {
    borderRadius: 10, padding: 11, gap: 7, marginTop: 4,
  },
  balancerNoteText: { fontSize: 12, lineHeight: 17 },
  balancerChangeText: { fontSize: 12, fontWeight: '700' },
  balancerPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 2 },
  balancerPickerChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  balancerPickerChipText: { fontSize: 13, fontWeight: '600' },

  // Rate rows (matching AddEntryScreen)
  entryRateRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginTop: 8, borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  rateRowLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, flex: 1 },
  rateRowLines: { flex: 1, gap: 3 },
  rateRowLabel: { fontSize: 13 },
  rateRowValue: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  rateRowAdjust: { fontSize: 12, fontWeight: '600' },

  // Numpad drawer
  numpadDrawer: { borderTopWidth: StyleSheet.hairlineWidth },
  numpadHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: ScreenPadding, paddingVertical: 12, gap: 12,
  },
  numpadLabel: { fontSize: 12, flex: 1 },
  numpadValue: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] as any },
  doneBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 12 },
  doneBtnText: { fontSize: 14, fontWeight: '700' },
});
