// add entry screen: add an expense, income or transfer
// amount on top, then type, title and rows that open their own sheets

import { useEffect, useRef, useState } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/hooks/use-theme';
import { ScreenPadding, SHADOW_COLOR, WHITE } from '@/constants/theme';
import { NumericKeypad, formatAmountDisplay, rawToAmount, amountToRaw, applyNumpadKeyAtCursor, displayCursorToRawCursor, rawCursorToDisplayCursor } from '@/components/NumericKeypad';
import { formatMoney, formatMoneyWithCode } from '@/logic/moneyFormatter';
import { CurrencyPickerModal } from '@/components/CurrencyPickerModal';
import {
  addExpense,
  addIncome,
  deleteExpense,
  addTransfer,
  deleteIncome,
  deleteTransfer,
  getAccounts,
  getCategories,
  getExpenses,
  getSettings,
  updateExpense,
  updateIncome,
  updateSubBalance,
  updateTransfer,
} from '@/storage/storage';
import { getExchangeRate } from '@/api/exchangeRate';

// types

type EntryMode = 'expense' | 'income' | 'transfer';
type CountsAs = 'daily' | 'mustBuy';

type CurrencyBalance = { code: string; balance: number };
type Account = { id: string; name: string; primaryCode: string; currencies: CurrencyBalance[]; type?: string };
type Category = { id: string; name: string; kind?: 'expense' | 'income' };
type StoredExpense = {
  id: string; accountId: string; categoryId: string; merchant: string;
  amount: number; currency: string; amountInHomeCurrency?: number;
  accountAmount?: number; accountCurrencyAtEntry?: string;
  date: string; notes?: string; description?: string | null; kind?: 'daily' | 'mustBuy';
};
type StoredIncome = {
  id: string; accountId: string; amount: number; currency: string;
  accountCurrencyAtEntry?: string; accountAmount?: number;
  amountInHomeCurrency?: number; categoryId?: string | null; source: string; date: string; notes?: string | null;
  destination?: 'allowance' | 'savings'; savingGoalId?: string | null;
};
type StoredTransfer = {
  id: string; date: string;
  fromAccountId: string; toAccountId: string;
  fromCurrency: string; toCurrency: string;
  fromAmount: number; toAmount: number;
  notes?: string | null;
};
type Merchant = { name: string; categoryId?: string; count: number; lastAmount?: number; currency?: string; lastDate?: string };

// helpers

/** Date-only ISO string using local components — no time, no UTC shift. */
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDateLabel(d: Date): string {
  const now = new Date();
  const todayStr = isoDate(now);
  const yestStr = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const dStr = isoDate(d);
  const dayNum = d.getDate();
  const mon = d.toLocaleDateString('en-SG', { month: 'short' });
  if (dStr === todayStr) return `Today, ${dayNum} ${mon}`;
  if (dStr === yestStr) return `Yesterday, ${dayNum} ${mon}`;
  return `${dayNum} ${mon} ${d.getFullYear()}`;
}

function parseMerchants(expenses: any[]): Merchant[] {
  const map = new Map<string, Merchant>();
  for (const e of expenses) {
    if (!e.merchant) continue;
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
      map.set(e.merchant, {
        name: e.merchant,
        categoryId: e.categoryId,
        count: 1,
        lastAmount: e.amountInHomeCurrency ?? e.amount,
        currency: e.currency,
        lastDate: e.date,
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    const diff = b.count - a.count;
    if (diff !== 0) return diff;
    return (b.lastDate ?? '') > (a.lastDate ?? '') ? 1 : -1;
  });
}

function accountBalance(acct: Account): number {
  return acct.currencies.find((c) => c.code === acct.primaryCode)?.balance ?? 0;
}

// highlight the search text wherever it appears in the name

function HighlightedName({ name, query, t }: { name: string; query: string; t: any }) {
  if (!query) {
    return <Text style={[styles.merchantName, { color: t.text }]}>{name}</Text>;
  }
  const q = query.toLowerCase();
  const lower = name.toLowerCase();
  const segments: Array<{ text: string; match: boolean }> = [];
  let pos = 0;
  while (pos < name.length) {
    const idx = lower.indexOf(q, pos);
    if (idx < 0) {
      segments.push({ text: name.slice(pos), match: false });
      break;
    }
    if (idx > pos) segments.push({ text: name.slice(pos, idx), match: false });
    segments.push({ text: name.slice(idx, idx + q.length), match: true });
    pos = idx + q.length;
  }
  return (
    <Text style={styles.merchantName}>
      {segments.map((seg, i) =>
        seg.match ? (
          <Text key={i} style={{ backgroundColor: t.accentSoft, color: t.accentInk, borderRadius: 4 }}>
            {seg.text}
          </Text>
        ) : (
          <Text key={i} style={{ color: t.text }}>{seg.text}</Text>
        )
      )}
    </Text>
  );
}

// FieldRow

function FieldRow({
  icon, label, value, placeholder, onPress, t, last = false,
}: {
  icon: string; label: string; value?: string; placeholder?: string;
  onPress: () => void; t: any; last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.fieldRow, { borderBottomColor: t.border }, last ? styles.fieldRowLast : null]}
    >
      <View style={styles.fieldRowLeft}>
        <Feather name={icon as any} size={16} color={t.muted} />
        <Text style={[styles.fieldLabel, { color: t.muted }]}>{label}</Text>
      </View>
      <View style={styles.fieldRowRight}>
        <Text
          style={[styles.fieldValue, { color: value ? t.text : t.muted }, !value && styles.fieldValuePlaceholder]}
          numberOfLines={1}
        >
          {value ?? placeholder ?? 'Select'}
        </Text>
        <Feather name="chevron-right" size={15} color={t.muted} />
      </View>
    </Pressable>
  );
}

// Sheet wrapper

function Sheet({ visible, onClose, children, t }: {
  visible: boolean; onClose: () => void; children: React.ReactNode; t: any;
}) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetScrim} onPress={onClose} />
      <View style={[styles.sheetContainer, { backgroundColor: t.surface }]}>
        <View style={[styles.sheetHandle, { backgroundColor: t.track }]} />
        {children}
      </View>
    </Modal>
  );
}

// Date picker sheet

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

  // Day grid
  const firstDay = new Date(year, month, 1).getDay();
  const mondayOffset = (firstDay + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(mondayOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // 9 years around the one being viewed
  const yearRange = Array.from({ length: 9 }, (_, i) => year - 4 + i);

  return (
    <Sheet visible={visible} onClose={onClose} t={t}>
      <View style={styles.sheetHeader}>
        <Text style={[styles.sheetTitle, { color: t.text }]}>Date</Text>
        <Pressable onPress={goToday}>
          <Text style={[styles.sheetAction, { color: t.accent }]}>Today</Text>
        </Pressable>
      </View>

      {/* Year + month nav */}
      <View style={styles.calNavRow}>
        {pickerMode === 'day' ? (
          <Pressable hitSlop={12} onPress={() => setViewing(new Date(year, month - 1, 1))}>
            <Feather name="chevron-left" size={18} color={t.text} />
          </Pressable>
        ) : <View style={{ width: 18 }} />}

        <View style={styles.calMonthYear}>
          <Pressable hitSlop={8} onPress={() => setPickerMode(pickerMode === 'year' ? 'day' : 'year')}>
            <Text style={[styles.calYearLabel, { color: pickerMode === 'year' ? t.accent : t.muted }]}>{year}</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setPickerMode(pickerMode === 'month' ? 'day' : 'month')}>
            <Text style={[styles.calMonthLabel, { color: pickerMode === 'month' ? t.accent : t.text }]}>
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

      {/* Year picker */}
      {pickerMode === 'year' && (
        <View style={styles.calSubGrid}>
          {yearRange.map((y) => {
            const isSel = y === year;
            const isNow = y === todayLocal.getFullYear();
            return (
              <Pressable
                key={y}
                style={[styles.calSubCell, isSel && { backgroundColor: t.accent }]}
                onPress={() => { setViewing(new Date(y, month, 1)); setPickerMode('day'); }}
              >
                <Text style={[styles.calSubCellText, { color: isSel ? t.onAccent : isNow ? t.accent : t.text, fontWeight: isSel || isNow ? '700' : '400' }]}>{y}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Month picker */}
      {pickerMode === 'month' && (
        <View style={styles.calSubGrid}>
          {MONTH_NAMES_SHORT.map((m, i) => {
            const isSel = i === month;
            const isNow = i === todayLocal.getMonth() && year === todayLocal.getFullYear();
            return (
              <Pressable
                key={i}
                style={[styles.calSubCell, isSel && { backgroundColor: t.accent }]}
                onPress={() => { setViewing(new Date(year, i, 1)); setPickerMode('day'); }}
              >
                <Text style={[styles.calSubCellText, { color: isSel ? t.onAccent : isNow ? t.accent : t.text, fontWeight: isSel || isNow ? '700' : '400' }]}>{m}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Day grid */}
      {pickerMode === 'day' && (
        <>
          <View style={styles.calWeekRow}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
              <Text key={i} style={[styles.calWeekday, { color: t.muted }]}>{w}</Text>
            ))}
          </View>
          <View style={styles.calGrid}>
            {cells.map((day, i) => {
              if (!day) return <View key={i} style={styles.calCell} />;
              const cellDate = new Date(year, month, day);
              const isSel = isoDate(cellDate) === isoDate(selected);
              return (
                <Pressable key={i} style={[styles.calCell, styles.calCellInner]} onPress={() => setSelected(new Date(year, month, day))}>
                  {isSel ? (
                    <View style={[styles.calDaySelected, { backgroundColor: t.accent }]}>
                      <Text style={[styles.calDayNum, { color: t.onAccent, fontWeight: '700' }]}>{day}</Text>
                    </View>
                  ) : (
                    <Text style={[styles.calDayNum, { color: t.text }]}>{day}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Pressable
        style={[styles.sheetBtn, { backgroundColor: t.accent }]}
        onPress={() => { onChange(selected); onClose(); }}
      >
        <Text style={[styles.sheetBtnText, { color: t.onAccent }]}>
          Set {selected.getDate()} {selected.toLocaleDateString('en-SG', { month: 'long' })}
        </Text>
      </Pressable>
    </Sheet>
  );
}

// Category picker sheet

const CAT_ICONS: Record<string, string> = {
  Food: 'coffee', Transport: 'navigation', Shopping: 'shopping-bag',
  Entertainment: 'film', Necessities: 'home', Gifts: 'gift',
  Emergency: 'shield', 'SIM card': 'wifi', 'Memberships & subscriptions': 'repeat',
};

function CategoryPickerSheet({ visible, onClose, categories, selected, onSelect, t, kind }: {
  visible: boolean; onClose: () => void; categories: Category[]; selected: string;
  onSelect: (id: string) => void; t: any; kind?: 'expense' | 'income';
}) {
  const kindFiltered = kind
    ? categories.filter((c) => kind === 'income' ? c.kind === 'income' : (c.kind === 'expense' || !c.kind))
    : categories;
  const selName = categories.find((c) => c.id === selected)?.name ?? '';

  return (
    <Sheet visible={visible} onClose={onClose} t={t}>
      <View style={styles.sheetHeader}>
        <Text style={[styles.sheetTitle, { color: t.text }]}>Category</Text>
      </View>
      <View style={styles.catGrid}>
        {kindFiltered.map((cat) => {
          const icon = CAT_ICONS[cat.name] ?? 'tag';
          const isSel = cat.id === selected;
          return (
            <Pressable key={cat.id} style={styles.catItem} onPress={() => { onSelect(cat.id); onClose(); }}>
              <View style={[styles.catIconTile, { backgroundColor: isSel ? t.accent : t.bg }]}>
                <Feather name={icon as any} size={22} color={isSel ? t.onAccent : t.muted} />
              </View>
              <Text style={[styles.catName, { color: isSel ? t.text : t.muted, fontWeight: isSel ? '700' : '400' }]}>
                {cat.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable style={[styles.sheetBtn, { backgroundColor: t.accent }]} onPress={onClose}>
        <Text style={[styles.sheetBtnText, { color: t.onAccent }]}>
          {selName ? `Use ${selName}` : 'Select category'}
        </Text>
      </Pressable>
    </Sheet>
  );
}

// Account picker sheet

function AccountPickerSheet({ visible, onClose, title, accounts, selected, onSelect, t }: {
  visible: boolean; onClose: () => void; title?: string; accounts: Account[]; selected: string;
  onSelect: (id: string, currency: string) => void; t: any;
}) {
  const ACCOUNT_ICONS: Record<string, string> = { cash: 'dollar-sign', bank: 'home', credit_card: 'credit-card' };
  return (
    <Sheet visible={visible} onClose={onClose} t={t}>
      <View style={styles.sheetHeader}>
        <Text style={[styles.sheetTitle, { color: t.text }]}>{title ?? 'Account'}</Text>
      </View>
      <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
        {accounts.map((acct) => {
          const isSel = acct.id === selected;
          const icon = ACCOUNT_ICONS[acct.type ?? ''] ?? 'credit-card';
          const bal = formatMoneyWithCode(accountBalance(acct), acct.primaryCode);
          return (
            <Pressable
              key={acct.id}
              onPress={() => { onSelect(acct.id, acct.primaryCode); onClose(); }}
              style={[
                styles.acctRow,
                { borderRadius: 17, marginBottom: 9 },
                isSel
                  ? { borderColor: t.accent, borderWidth: 1.5 }
                  : { borderColor: t.border, borderWidth: 1 },
              ]}
            >
              <View style={[styles.acctIcon, { backgroundColor: isSel ? t.accentSoft : t.bg }]}>
                <Feather name={icon as any} size={17} color={isSel ? t.accentInk : t.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.acctName, { color: t.text }]}>{acct.name}</Text>
                <Text style={[styles.acctSub, { color: t.muted }]}>{bal}</Text>
              </View>
              {isSel && (
                <View style={[styles.acctCheck, { backgroundColor: t.accent }]}>
                  <Feather name="check" size={12} color={t.onAccent} />
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable style={[styles.sheetBtn, { backgroundColor: t.accent }]} onPress={onClose}>
        <Text style={[styles.sheetBtnText, { color: t.onAccent }]}>
          {accounts.find((a) => a.id === selected)
            ? `Use ${accounts.find((a) => a.id === selected)!.name}`
            : 'Select account'}
        </Text>
      </Pressable>
    </Sheet>
  );
}

// Merchant search sheet

function MerchantSearchSheet({ visible, onClose, merchants, categories, onSelect, t, label = 'Merchant' }: {
  visible: boolean; onClose: () => void; merchants: Merchant[];
  categories: Category[]; onSelect: (name: string, categoryId?: string) => void; t: any;
  label?: string;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) { setQuery(''); setTimeout(() => inputRef.current?.focus(), 300); }
  }, [visible]);

  const q = query.toLowerCase().trim();
  const matches = q
    ? merchants.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 4)
    : [];
  const recent = merchants.slice(0, 6);

  const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  function merchantSubLine(m: Merchant): string {
    const catName = m.categoryId ? catMap[m.categoryId] ?? '' : '';
    const countStr = `${m.count} expense${m.count !== 1 ? 's' : ''}`;
    const lastStr = m.lastAmount != null
      ? `last ${formatMoneyWithCode(m.lastAmount, m.currency ?? 'SGD')}`
      : null;
    return [catName, countStr, lastStr].filter(Boolean).join(' · ');
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.merchantRoot, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.merchantHeader}>
            <Pressable hitSlop={16} onPress={onClose} style={styles.merchantBackBtn}>
              <Feather name="chevron-left" size={22} color={t.text} />
              <Text style={[styles.merchantBackLabel, { color: t.text }]}>Back</Text>
            </Pressable>
            <Text style={[styles.merchantTitle, { color: t.text }]}>{label}</Text>
            <View style={{ width: 60 }} />
          </View>

          <View style={[styles.merchantSearchBar, { backgroundColor: t.surface, borderColor: t.accent }]}>
            <Feather name="search" size={16} color={t.muted} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder={`Search or add ${label.toLowerCase()}`}
              placeholderTextColor={t.muted}
              style={[styles.merchantInput, { color: t.text }]}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={() => {
                if (query.trim()) { onSelect(query.trim()); onClose(); }
              }}
            />
            {!!query && (
              <Pressable onPress={() => setQuery('')}>
                <Feather name="x" size={16} color={t.muted} />
              </Pressable>
            )}
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {matches.length > 0 && (
              <>
                <View style={styles.merchantSectionRow}>
                  <Text style={[styles.merchantSectionLabel, { color: t.muted }]}>TOP MATCHES</Text>
                  <Text style={[styles.merchantSectionSub, { color: t.muted }]}>from your history</Text>
                </View>
                {matches.map((m, i) => (
                  <Pressable
                    key={m.name}
                    style={[styles.merchantMatchRow, { borderBottomColor: t.border }]}
                    onPress={() => { onSelect(m.name, m.categoryId); onClose(); }}
                  >
                    <View style={[
                      styles.merchantAvatar,
                      i === 0
                        ? { backgroundColor: t.accentSoft }
                        : { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 },
                    ]}>
                      <Text style={[styles.merchantAvatarText, { color: i === 0 ? t.accentInk : t.muted }]}>
                        {m.name.slice(0, 2)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <HighlightedName name={m.name} query={q} t={t} />
                      <Text style={[styles.merchantSubText, { color: t.muted }]}>
                        {merchantSubLine(m)}
                      </Text>
                    </View>
                    {i === 0 && <Text style={[styles.topTag, { color: t.accent }]}>TOP</Text>}
                  </Pressable>
                ))}
              </>
            )}

            {query.trim().length > 0 && (
              <Pressable
                style={[styles.merchantMatchRow, { borderBottomColor: t.border }]}
                onPress={() => { onSelect(query.trim()); onClose(); }}
              >
                <View style={[styles.merchantAvatar, { borderColor: t.border, borderWidth: 1, borderStyle: 'dashed' }]}>
                  <Feather name="plus" size={15} color={t.accent} />
                </View>
                <Text style={[styles.merchantNewText, { color: t.accent }]}>
                  Use "{query}" as a new {label.toLowerCase()}
                </Text>
              </Pressable>
            )}

            {recent.length > 0 && !query && (
              <>
                <Text style={[styles.merchantSectionLabel, { color: t.muted, paddingHorizontal: ScreenPadding, paddingTop: 20 }]}>
                  RECENTLY USED
                </Text>
                <View style={styles.recentChipRow}>
                  {recent.map((m) => (
                    <Pressable
                      key={m.name}
                      onPress={() => { onSelect(m.name, m.categoryId); onClose(); }}
                      style={[styles.recentChip, { backgroundColor: t.surface, borderColor: t.border }]}
                    >
                      <Text style={[styles.recentChipText, { color: t.text }]}>{m.name}</Text>
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

// Note input sheet

function NoteInputSheet({ visible, onClose, value, onChange, t }: {
  visible: boolean; onClose: () => void; value: string; onChange: (v: string) => void; t: any;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setDraft(value);
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [visible]);

  function handleSave() { onChange(draft); onClose(); }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.noteRoot, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.noteHeader, { borderBottomColor: t.border }]}>
            <Pressable hitSlop={16} onPress={onClose} style={styles.noteBackBtn}>
              <Feather name="chevron-left" size={22} color={t.text} />
              <Text style={[styles.noteBackLabel, { color: t.text }]}>Back</Text>
            </Pressable>
            <Text style={[styles.noteTitle, { color: t.text }]}>Note</Text>
            <Pressable hitSlop={16} onPress={handleSave} style={styles.noteActionBtn}>
              <Text style={[styles.noteAction, { color: t.accent }]}>Save</Text>
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.noteBody}
            keyboardShouldPersistTaps="handled"
          >
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a note…"
              placeholderTextColor={t.muted}
              multiline
              autoFocus={false}
              style={[styles.noteInput, { color: t.text, backgroundColor: t.surface, borderColor: t.border }]}
              blurOnSubmit={false}
            />
          </ScrollView>

          <View style={[styles.noteFooter, { borderTopColor: t.border }]}>
            <Pressable style={[styles.sheetBtn, { backgroundColor: t.accent }]} onPress={handleSave}>
              <Text style={[styles.sheetBtnText, { color: t.onAccent }]}>Save note</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// Rate adjust sheet

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
    if (visible) {
      setActiveField('unit');
      setDraft(rate !== null ? String(rate) : '');
    }
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
    if (isNaN(resolvedRate) || resolvedRate <= 0) {
      Alert.alert('Invalid rate', 'Enter a rate greater than 0.');
      return;
    }
    onSave(resolvedRate);
    onClose();
  }

  const draftNum = parseFloat(draft) || 0;
  const computedUnit = activeField === 'total' && amount > 0
    ? Math.round((draftNum / amount) * 1000000) / 1000000
    : null;
  const computedTotal = activeField === 'unit' && amount > 0
    ? Math.round(draftNum * amount * 100) / 100
    : null;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetScrim} onPress={onClose} />
      <View style={[styles.rateSheetContainer, { backgroundColor: t.surface }]}>
        <View style={styles.rateSheetPadded}>
          <View style={[styles.sheetHandle, { backgroundColor: t.track }]} />
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: t.text }]}>Adjust Rate</Text>
            <Pressable hitSlop={16} onPress={onClose}>
              <Text style={[styles.sheetAction, { color: t.muted }]}>Cancel</Text>
            </Pressable>
          </View>
          <Text style={[styles.rateSheetHint, { color: t.muted }]}>
            Tap either row to edit. Set the unit rate or the actual transaction total.
          </Text>

          {/* Unit rate row */}
          <Pressable
            style={[styles.rateDisplayRow, {
              borderColor: activeField === 'unit' ? t.accent : t.border,
              backgroundColor: t.bg,
              marginBottom: amount > 0 ? 10 : 0,
            }]}
            onPress={() => switchTo('unit')}
          >
            <Text style={[styles.rateInputLabel, { color: t.muted }]}>1 {fromCurrency} =</Text>
            <Text style={[styles.rateDisplayValue, { color: activeField === 'unit' ? (draft ? t.text : t.muted) : t.muted }]}>
              {activeField === 'unit'
                ? (draft || '0.00')
                : (computedUnit != null && computedUnit > 0 ? String(computedUnit) : '—')}
            </Text>
            <Text style={[styles.rateInputLabel, { color: t.muted }]}>{toCurrency}</Text>
          </Pressable>

          {/* Transaction total row */}
          {amount > 0 && (
            <Pressable
              style={[styles.rateDisplayRow, {
                borderColor: activeField === 'total' ? t.accent : t.border,
                backgroundColor: t.bg,
              }]}
              onPress={() => switchTo('total')}
            >
              <Text style={[styles.rateInputLabel, { color: t.muted }]}>
                {formatMoney(amount, fromCurrency)} {fromCurrency} =
              </Text>
              <Text style={[styles.rateDisplayValue, { color: activeField === 'total' ? (draft ? t.text : t.muted) : t.muted }]}>
                {activeField === 'total'
                  ? (draft || '0.00')
                  : (computedTotal != null && computedTotal > 0 ? formatMoney(computedTotal, toCurrency) : '—')}
              </Text>
              <Text style={[styles.rateInputLabel, { color: t.muted }]}>{toCurrency}</Text>
            </Pressable>
          )}

          <Pressable style={[styles.sheetBtn, { backgroundColor: t.accent }]} onPress={handleApply}>
            <Text style={[styles.sheetBtnText, { color: t.onAccent }]}>Apply Rate</Text>
          </Pressable>
        </View>
        <NumericKeypad
          bottomLeftKey="."
          onKey={(key) => setDraft((d) => applyRateKey(d, key))}
        />
        <View style={{ height: insets.bottom }} />
      </View>
    </Modal>
  );
}

// Transfer card

function TransferCard({ rail, account, t, onPress }: {
  rail: string; account: Account | undefined; t: any; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.transferCard, { backgroundColor: t.surface, borderColor: t.border }]}
    >
      <Text style={[styles.transferRail, { color: t.muted }]}>{rail}</Text>
      {account ? (
        <>
          <Text style={[styles.transferAcctName, { color: t.text }]}>{account.name}</Text>
          <Text style={[styles.transferAcctBal, { color: t.muted }]}>
            {formatMoneyWithCode(accountBalance(account), account.primaryCode)}
          </Text>
        </>
      ) : (
        <Text style={[styles.transferAcctName, { color: t.muted }]}>Select account</Text>
      )}
    </Pressable>
  );
}

// Main component

export default function AddEntryScreen({ navigation, route }: any) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  // these are set when editing an existing entry
  const editExpense: StoredExpense | undefined = route?.params?.editExpense;
  const editIncome: StoredIncome | undefined = route?.params?.editIncome;
  const editTransfer: StoredTransfer | undefined = route?.params?.editTransfer;
  const isEditing = !!(editExpense || editIncome || editTransfer);

  // prefillDate comes in as "YYYY-MM-DD", make it a local date
  const prefillDate: Date | undefined = route?.params?.prefillDate
    ? new Date(route.params.prefillDate + 'T00:00:00')
    : undefined;

  const [mode, setMode] = useState<EntryMode>(editIncome ? 'income' : editTransfer ? 'transfer' : 'expense');
  const [countsAs, setCountsAs] = useState<CountsAs>(editExpense?.kind ?? 'daily');
  const [amountStr, setAmountStr] = useState(
    editExpense ? amountToRaw(editExpense.amount, editExpense.currency)
    : editIncome ? amountToRaw(editIncome.amount, editIncome.currency)
    : editTransfer ? amountToRaw(editTransfer.fromAmount, editTransfer.fromCurrency)
    : ''
  );
  const [title, setTitle] = useState(editExpense?.description ?? '');
  const [merchant, setMerchant] = useState(editExpense?.merchant ?? editIncome?.source ?? '');
  const [categoryId, setCategoryId] = useState(editExpense?.categoryId ?? editIncome?.categoryId ?? '');
  const [accountId, setAccountId] = useState(editExpense?.accountId ?? editIncome?.accountId ?? '');
  // accountCurrency = the account's currency, entryCurrency = what the user typed in
  const [accountCurrency, setAccountCurrency] = useState(
    editExpense?.accountCurrencyAtEntry ?? editExpense?.currency
      ?? editIncome?.accountCurrencyAtEntry ?? editIncome?.currency ?? 'SGD',
  );
  const [entryCurrency, setEntryCurrency] = useState(
    editExpense?.currency ?? editIncome?.currency ?? 'SGD',
  );
  const [date, setDate] = useState<Date>(
    editExpense?.date ? new Date(editExpense.date + 'T00:00:00')
    : editIncome?.date ? new Date(editIncome.date + 'T00:00:00')
    : editTransfer?.date ? new Date(editTransfer.date + 'T00:00:00')
    : (prefillDate ?? new Date())
  );
  const [note, setNote] = useState(editExpense?.notes ?? editIncome?.notes ?? editTransfer?.notes ?? '');

  // transfer only
  const [fromAccountId, setFromAccountId] = useState(editTransfer?.fromAccountId ?? '');
  const [fromCurrency, setFromCurrency] = useState(editTransfer?.fromCurrency ?? 'SGD');
  const [toAccountId, setToAccountId] = useState(editTransfer?.toAccountId ?? '');
  const [toCurrency, setToCurrency] = useState(editTransfer?.toCurrency ?? 'SGD');
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  // when editing a cross-currency transfer, use the saved rate at first
  const [transferRate, setTransferRate] = useState<number | null>(
    editTransfer && editTransfer.fromCurrency !== editTransfer.toCurrency && editTransfer.fromAmount
      ? Math.round((editTransfer.toAmount / editTransfer.fromAmount) * 1e6) / 1e6
      : null,
  );
  const skipTransferRateFetchRef = useRef(
    !!editTransfer && editTransfer.fromCurrency !== editTransfer.toCurrency,
  );
  const [showRateAdjust, setShowRateAdjust] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [homeCurrency, setHomeCurrency] = useState('SGD');

  const [showDate, setShowDate] = useState(false);
  const [showCategory, setShowCategory] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showNote, setShowNote] = useState(false);

  const [showNumpad, setShowNumpad] = useState(false);
  const [liveRate, setLiveRate] = useState<number | null>(null);
  const [entryToAccountRate, setEntryToAccountRate] = useState<number | null>(null);
  const [showEntryRateAdjust, setShowEntryRateAdjust] = useState(false);
  const [showLiveRateAdjust, setShowLiveRateAdjust] = useState(false);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantFocused, setMerchantFocused] = useState(false);
  const merchantBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const amountInputRef = useRef<TextInput | null>(null);
  const amountRawCursorRef = useRef<number>(0);

  useEffect(() => {
    Promise.all([getAccounts(), getCategories(), getSettings(), getExpenses()]).then(
      ([accts, cats, settings, exps]: [Account[], Category[], any, any[]]) => {
        setAccounts(accts);
        setCategories(cats);
        setHomeCurrency(settings.homeCurrency ?? 'SGD');
        setMerchants(parseMerchants(exps));
        if (!accountId && accts.length > 0) {
          const defaultAcct = accts.find((a) => a.id === settings.defaultAccountId) ?? accts[0];
          setAccountId(defaultAcct.id);
          setAccountCurrency(defaultAcct.primaryCode);
          setEntryCurrency(defaultAcct.primaryCode);
        } else if (accountId) {
          // editing: match accountCurrency to the real account
          const editAcct = accts.find((a) => a.id === accountId);
          if (editAcct) setAccountCurrency(editAcct.primaryCode);
        }
        if (!categoryId && cats.length > 0) {
          const defaultCat = mode === 'income'
            ? (cats.find((c: Category) => c.kind === 'income') ?? cats[0])
            : (cats.find((c: Category) => !c.kind || c.kind === 'expense') ?? cats[0]);
          setCategoryId(defaultCat.id);
        }
        // don't change the from/to accounts when editing a transfer
        if (!editTransfer) {
          if (accts.length >= 1) {
            setFromAccountId(accts[0].id);
            setFromCurrency(accts[0].primaryCode);
          }
          if (accts.length >= 2) {
            setToAccountId(accts[1].id);
            setToCurrency(accts[1].primaryCode);
          } else if (accts.length >= 1) {
            setToAccountId(accts[0].id);
            setToCurrency(accts[0].primaryCode);
          }
        }
      }
    );
  }, []);

  const activeCurrency = mode === 'transfer' ? fromCurrency : entryCurrency;
  const amount = rawToAmount(amountStr, activeCurrency);
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const selectedCategory = categories.find((c) => c.id === categoryId);
  const fromAccount = accounts.find((a) => a.id === fromAccountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const accountEquivalent = entryCurrency === accountCurrency || !entryToAccountRate
    ? amount
    : Math.round(amount * entryToAccountRate * 100) / 100;
  const dateStr = isoDate(date);

  useEffect(() => {
    if (entryCurrency === homeCurrency || mode === 'transfer') {
      setLiveRate(1);
      return;
    }
    setLiveRate(null);
    getExchangeRate(entryCurrency, homeCurrency, dateStr).then(setLiveRate);
  }, [entryCurrency, homeCurrency, mode, dateStr]);

  useEffect(() => {
    if (mode === 'transfer' || entryCurrency === accountCurrency) {
      setEntryToAccountRate(1);
      return;
    }
    setEntryToAccountRate(null);
    getExchangeRate(entryCurrency, accountCurrency, dateStr).then(setEntryToAccountRate);
  }, [entryCurrency, accountCurrency, mode, dateStr]);

  useEffect(() => {
    if (mode !== 'transfer' || fromCurrency === toCurrency) {
      setTransferRate(1);
      return;
    }
    // keep the saved rate on the first render when editing a transfer
    if (skipTransferRateFetchRef.current) {
      skipTransferRateFetchRef.current = false;
      return;
    }
    setTransferRate(null);
    getExchangeRate(fromCurrency, toCurrency, dateStr).then(setTransferRate);
  }, [fromCurrency, toCurrency, mode, dateStr]);

  async function handleSave() {
    if (amount <= 0) {
      Alert.alert('Amount required', 'Please enter an amount.');
      return;
    }
    if (mode !== 'transfer' && entryCurrency !== accountCurrency && entryToAccountRate === null) {
      Alert.alert('Rate loading', 'The exchange rate is still loading. Please wait a moment, or tap the rate row to enter it manually.');
      return;
    }
    if (mode !== 'transfer' && entryCurrency !== homeCurrency && liveRate === null) {
      Alert.alert('Rate loading', 'The home-currency rate is still loading. Please wait a moment.');
      return;
    }
    setSaving(true);
    try {
      if (mode === 'expense') {
        if (!accountId) throw new Error('Select an account.');
        // if the account is home currency, prefer the rate the user may have set
        const rateAtEntry = entryCurrency === homeCurrency
          ? 1
          : accountCurrency === homeCurrency
            ? (entryToAccountRate ?? liveRate ?? 1)
            : (liveRate ?? 1);
        const amountInHome = entryCurrency === homeCurrency
          ? amount
          : Math.round(amount * rateAtEntry * 100) / 100;
        const isCrossCurrency = entryCurrency !== accountCurrency;
        if (isEditing && editExpense) {
          // take the old amount back out first
          const reverseCode = editExpense.accountCurrencyAtEntry ?? editExpense.currency;
          const reverseAmount = editExpense.accountAmount ?? editExpense.amount;
          await updateSubBalance(editExpense.accountId, reverseCode, reverseAmount);
          await updateExpense(editExpense.id, {
            accountId,
            categoryId,
            merchant: merchant || title || 'Expense',
            description: merchant && title ? title : null,
            amount,
            currency: entryCurrency,
            amountInHomeCurrency: amountInHome,
            exchangeRateAtEntry: rateAtEntry,
            accountAmount: isCrossCurrency ? accountEquivalent : undefined,
            accountCurrencyAtEntry: isCrossCurrency ? accountCurrency : undefined,
            date: isoDate(date),
            notes: note || null,
            kind: countsAs,
          });
          await updateSubBalance(accountId, accountCurrency, -accountEquivalent);
        } else {
          await addExpense({
            accountId,
            categoryId,
            merchant: merchant || title || 'Expense',
            description: merchant && title ? title : null,
            amount,
            currency: entryCurrency,
            amountInHomeCurrency: amountInHome,
            exchangeRateAtEntry: rateAtEntry,
            accountAmount: isCrossCurrency ? accountEquivalent : undefined,
            accountCurrencyAtEntry: isCrossCurrency ? accountCurrency : undefined,
            date: isoDate(date),
            notes: note || null,
            kind: countsAs,
            isShared: false,
            splitType: null,
            splitDetails: null,
            receiptImageUri: null,
          });
          await updateSubBalance(accountId, accountCurrency, -accountEquivalent);
        }
      } else if (mode === 'income') {
        if (!accountId) throw new Error('Select an account.');
        const incomeRateAtEntry = entryCurrency === homeCurrency
          ? 1
          : accountCurrency === homeCurrency
            ? (entryToAccountRate ?? liveRate ?? 1)
            : (liveRate ?? 1);
        const incomeInHome = entryCurrency === homeCurrency
          ? amount
          : Math.round(amount * incomeRateAtEntry * 100) / 100;
        const incomeCrossCurrency = entryCurrency !== accountCurrency;
        if (isEditing && editIncome) {
          // take the old amount back out first
          const reverseCode = editIncome.accountCurrencyAtEntry ?? editIncome.currency;
          const reverseAmount = editIncome.accountAmount ?? editIncome.amount;
          await updateSubBalance(editIncome.accountId, reverseCode, -reverseAmount);
          await updateIncome(editIncome.id, {
            accountId,
            amount,
            currency: entryCurrency,
            accountAmount: incomeCrossCurrency ? accountEquivalent : undefined,
            accountCurrencyAtEntry: incomeCrossCurrency ? accountCurrency : undefined,
            amountInHomeCurrency: incomeInHome,
            categoryId: categoryId || null,
            source: merchant || title || 'Income',
            destination: 'allowance',
            date: isoDate(date),
            notes: note || null,
          });
          await updateSubBalance(accountId, accountCurrency, accountEquivalent);
        } else {
          // addIncome already adds the money to the account
          await addIncome({
            accountId,
            amount,
            currency: entryCurrency,
            accountAmount: incomeCrossCurrency ? accountEquivalent : undefined,
            accountCurrencyAtEntry: incomeCrossCurrency ? accountCurrency : undefined,
            amountInHomeCurrency: incomeInHome,
            categoryId: categoryId || null,
            source: merchant || title || 'Income',
            destination: 'allowance',
            savingGoalId: null,
            date: isoDate(date),
            notes: note || null,
          });
        }
      } else {
        // transfer
        if (!fromAccountId || !toAccountId) throw new Error('Select both accounts.');
        if (fromAccountId === toAccountId) throw new Error('Choose two different accounts.');
        const toAmount = fromCurrency !== toCurrency && transferRate !== null
          ? Math.round(amount * transferRate * 100) / 100
          : amount;
        if (isEditing && editTransfer) {
          // undo the old transfer on both accounts, then apply the edit
          await updateSubBalance(editTransfer.fromAccountId, editTransfer.fromCurrency, editTransfer.fromAmount);
          await updateSubBalance(editTransfer.toAccountId, editTransfer.toCurrency, -editTransfer.toAmount);
          await updateSubBalance(fromAccountId, fromCurrency, -amount);
          await updateSubBalance(toAccountId, toCurrency, toAmount);
          await (updateTransfer as (id: string, d: any) => Promise<any>)(editTransfer.id, {
            fromAccountId, toAccountId,
            fromCurrency, toCurrency,
            fromAmount: amount, toAmount,
            notes: note || null,
            date: isoDate(date),
          });
        } else {
          await updateSubBalance(fromAccountId, fromCurrency, -amount);
          await updateSubBalance(toAccountId, toCurrency, toAmount);
          await (addTransfer as (d: any) => Promise<any>)({
            fromAccountId, toAccountId,
            fromCurrency, toCurrency,
            fromAmount: amount, toAmount,
            notes: note || null,
            date: isoDate(date),
          });
        }
      }
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editExpense && !editIncome && !editTransfer) return;
    const label = editIncome ? 'income' : editTransfer ? 'transfer' : 'expense';
    Alert.alert(
      `Delete ${label}?`,
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            if (editIncome) {
              await deleteIncome(editIncome.id);
              const reverseCode = editIncome.accountCurrencyAtEntry ?? editIncome.currency;
              const reverseAmount = editIncome.accountAmount ?? editIncome.amount;
              await updateSubBalance(editIncome.accountId, reverseCode, -reverseAmount);
            } else if (editExpense) {
              await deleteExpense(editExpense.id);
              // put the money back in the account's own currency
              const reverseCode = editExpense.accountCurrencyAtEntry ?? editExpense.currency;
              const reverseAmount = editExpense.accountAmount ?? editExpense.amount;
              await updateSubBalance(editExpense.accountId, reverseCode, reverseAmount);
            } else if (editTransfer) {
              // undo the transfer on both accounts, then delete it
              await updateSubBalance(editTransfer.fromAccountId, editTransfer.fromCurrency, editTransfer.fromAmount);
              await updateSubBalance(editTransfer.toAccountId, editTransfer.toCurrency, -editTransfer.toAmount);
              await (deleteTransfer as (id: string) => Promise<void>)(editTransfer.id);
            }
            navigation.goBack();
          },
        },
      ],
    );
  }

  async function handleCopy() {
    if (!editExpense) return;
    const today = isoDate(new Date());
    const originalDate = editExpense.date;
    Alert.alert(
      'Copy expense',
      'Which date for the copy?',
      [
        {
          text: "Today's date",
          onPress: async () => {
            await addExpense({ ...editExpense, id: undefined as any, date: today, createdAt: undefined as any });
            await updateSubBalance(editExpense.accountId, editExpense.currency, -editExpense.amount);
            navigation.goBack();
          },
        },
        {
          text: 'Original date',
          onPress: async () => {
            await addExpense({ ...editExpense, id: undefined as any, createdAt: undefined as any });
            await updateSubBalance(editExpense.accountId, editExpense.currency, -editExpense.amount);
            navigation.goBack();
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
          <Feather name="x" size={20} color={t.text} />
        </Pressable>
        {isEditing ? (
          <Pressable hitSlop={12} onPress={handleDelete}>
            <Feather name="trash-2" size={18} color={t.danger} />
          </Pressable>
        ) : (
          <View style={{ width: 20 }} />
        )}
      </View>

      {/* ── Mode tabs (hidden when editing) ── */}
      {!isEditing && (
        <View style={styles.modeTabs}>
          {(['expense', 'income', 'transfer'] as EntryMode[]).map((m) => (
            <Pressable key={m} style={styles.modeTab} onPress={() => {
              setMode(m);
              if (m === 'income') {
                const cat = categories.find((c) => c.kind === 'income');
                if (cat) setCategoryId(cat.id);
              } else if (m === 'expense') {
                const cat = categories.find((c) => !c.kind || c.kind === 'expense');
                if (cat) setCategoryId(cat.id);
              }
            }}>
              <Text style={[
                styles.modeTabText,
                { color: mode === m ? t.text : t.muted, fontWeight: mode === m ? '700' : '500' },
              ]}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </Text>
              <View style={[styles.modeTabUnderline, { backgroundColor: mode === m ? t.accent : 'transparent' }]} />
            </Pressable>
          ))}
        </View>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* ── Amount hero ── */}
          <View style={styles.amountHero}>
            <Pressable
              style={[styles.currencyPill, { backgroundColor: t.surface, borderColor: t.border }]}
              onPress={() => mode === 'transfer' ? null : setShowCurrencyPicker(true)}
            >
              <Text style={[styles.currencyPillText, { color: t.muted }]}>
                {mode === 'transfer' ? fromCurrency : entryCurrency}
              </Text>
              {mode !== 'transfer' && <Feather name="chevron-down" size={12} color={t.muted} />}
            </Pressable>

            <Pressable style={styles.amountRow} onPress={() => amountInputRef.current?.focus()}>
              {mode === 'income' && (
                <Text style={[styles.incomeSign, { color: t.accent }]}>+</Text>
              )}
              <TextInput
                ref={amountInputRef}
                style={[
                  styles.amountInput,
                  { color: amountStr ? (mode === 'income' ? t.accent : t.text) : t.muted },
                ]}
                value={formatAmountDisplay(amountStr, activeCurrency) || '0'}
                showSoftInputOnFocus={false}
                caretHidden
                editable
                onFocus={() => {
                  Keyboard.dismiss();
                  setShowNumpad(true);
                  amountRawCursorRef.current = amountStr.length;
                }}
                onSelectionChange={({ nativeEvent: { selection } }) => {
                  const display = formatAmountDisplay(amountStr, activeCurrency) || '0';
                  amountRawCursorRef.current = displayCursorToRawCursor(display, selection.start);
                }}
              />
            </Pressable>

            {/* Account-currency deduction row — shown when entry currency ≠ account currency */}
            {mode !== 'transfer' && amount > 0 && entryCurrency !== accountCurrency && (
              <Pressable
                style={[styles.entryRateRow, { borderColor: t.border, backgroundColor: t.surface }]}
                onPress={() => setShowEntryRateAdjust(true)}
              >
                <View style={styles.rateRowLeft}>
                  <Feather name="refresh-cw" size={13} color={t.muted} />
                  <View style={styles.rateRowLines}>
                    <Text style={[styles.rateRowLabel, { color: t.muted }]}>
                      {'1 '}{entryCurrency}{' = '}
                      <Text style={[styles.rateRowValue, { color: t.text }]}>
                        {entryToAccountRate ?? '…'}
                      </Text>
                      {' '}{accountCurrency}
                    </Text>
                    <Text style={[styles.rateRowLabel, { color: t.muted }]}>
                      {formatMoney(amount, entryCurrency)}{' '}{entryCurrency}{' = '}
                      <Text style={[styles.rateRowValue, { color: t.text }]}>
                        {entryToAccountRate !== null ? formatMoney(accountEquivalent, accountCurrency) : '…'}
                      </Text>
                      {' '}{accountCurrency}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.rateRowAdjust, { color: t.accent }]}>adjust ›</Text>
              </Pressable>
            )}

            {/* Home-currency rate row — only when account ≠ home (otherwise entryRateRow covers it) */}
            {mode !== 'transfer' && amount > 0 && entryCurrency !== homeCurrency && accountCurrency !== homeCurrency && (
              <Pressable
                style={[styles.entryRateRow, { borderColor: t.border, backgroundColor: t.surface }]}
                onPress={() => setShowLiveRateAdjust(true)}
              >
                <View style={styles.rateRowLeft}>
                  <Feather name="refresh-cw" size={13} color={t.muted} />
                  <View style={styles.rateRowLines}>
                    <Text style={[styles.rateRowLabel, { color: t.muted }]}>
                      {'1 '}{entryCurrency}{' = '}
                      <Text style={[styles.rateRowValue, { color: t.text }]}>
                        {liveRate ?? '…'}
                      </Text>
                      {' '}{homeCurrency}
                    </Text>
                    <Text style={[styles.rateRowLabel, { color: t.muted }]}>
                      {formatMoney(amount, entryCurrency)}{' '}{entryCurrency}{' = '}
                      <Text style={[styles.rateRowValue, { color: t.text }]}>
                        {liveRate !== null ? formatMoney(Math.round(amount * liveRate * 100) / 100, homeCurrency) : '…'}
                      </Text>
                      {' '}{homeCurrency}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.rateRowAdjust, { color: t.accent }]}>adjust ›</Text>
              </Pressable>
            )}
          </View>

          {/* ── Classification segmented ── */}
          {mode === 'expense' && (
            <View style={styles.segSection}>
              <Text style={[styles.segEyebrow, { color: t.muted }]}>COUNTS AS</Text>
              <View style={[styles.segTrack, { backgroundColor: t.bg, borderColor: t.border }]}>
                {(['daily', 'mustBuy'] as CountsAs[]).map((opt) => (
                  <Pressable
                    key={opt}
                    style={[styles.segThumb, countsAs === opt && [styles.segThumbActive, { backgroundColor: t.surface }]]}
                    onPress={() => setCountsAs(opt)}
                  >
                    <Text style={[
                      styles.segText,
                      { color: countsAs === opt ? t.text : t.muted, fontWeight: countsAs === opt ? '700' : '500' },
                    ]}>
                      {opt === 'daily' ? 'Daily spending' : 'Must buy'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.segHint, { color: t.muted }]}>
                {countsAs === 'daily'
                  ? 'Daily spending is measured against today\'s allowance.'
                  : 'Must buy — restocking, a fare, a bill — sits outside the allowance and never marks the day over budget.'}
              </Text>
            </View>
          )}


          {/* ── Transfer FROM/TO cards ── */}
          {mode === 'transfer' && (
            <View style={[styles.transferSection, { paddingHorizontal: ScreenPadding }]}>
              <View style={styles.transferPair}>
                <TransferCard rail="FROM" account={fromAccount} t={t} onPress={() => setShowFromPicker(true)} />
                <TransferCard rail="TO" account={toAccount} t={t} onPress={() => setShowToPicker(true)} />
                {/* Swap button — overlaps right edge of both cards */}
                <Pressable
                  style={[styles.swapBtn, { backgroundColor: t.accent }]}
                  onPress={() => {
                    const fid = fromAccountId; const fc = fromCurrency;
                    setFromAccountId(toAccountId); setFromCurrency(toCurrency);
                    setToAccountId(fid); setToCurrency(fc);
                  }}
                >
                  <Feather name="repeat" size={16} color={t.onAccent} />
                </Pressable>
              </View>

              {fromCurrency !== toCurrency && (
                <Pressable
                  style={[styles.rateRow, { borderColor: t.border, backgroundColor: t.surface }]}
                  onPress={() => setShowRateAdjust(true)}
                >
                  <View style={styles.rateRowLeft}>
                    <Feather name="refresh-cw" size={13} color={t.muted} />
                    <View style={styles.rateRowLines}>
                      <Text style={[styles.rateRowLabel, { color: t.muted }]}>
                        {'1 '}{fromCurrency}{' = '}
                        <Text style={[styles.rateRowValue, { color: t.text }]}>
                          {transferRate !== null ? String(transferRate) : '…'}
                        </Text>
                        {' '}{toCurrency}
                      </Text>
                      {amount > 0 && (
                        <Text style={[styles.rateRowLabel, { color: t.muted }]}>
                          {formatMoney(amount, fromCurrency)}{' '}{fromCurrency}{' = '}
                          <Text style={[styles.rateRowValue, { color: t.text }]}>
                            {transferRate !== null ? formatMoney(Math.round(amount * transferRate * 100) / 100, toCurrency) : '…'}
                          </Text>
                          {' '}{toCurrency}
                        </Text>
                      )}
                    </View>
                  </View>
                  <Text style={[styles.rateRowAdjust, { color: t.accent }]}>Tap to adjust ›</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* ── Title line ── */}
          <View style={[styles.titleLine, { borderBottomColor: t.border }]}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={
                mode === 'income' ? 'Title (optional)'
                : mode === 'transfer' ? 'Description (optional)'
                : 'Title / description (optional)'
              }
              placeholderTextColor={t.muted}
              style={[styles.titleInput, { color: t.text }]}
              returnKeyType="done"
              onFocus={() => setShowNumpad(false)}
              onBlur={() => setShowNumpad(true)}
            />
          </View>

          {/* ── Field rows ── */}
          <View style={styles.fieldSection}>
            {mode === 'expense' && (() => {
              const q = merchant.toLowerCase();
              const suggestions = merchantFocused && merchant.length > 0
                ? merchants.filter((m) => m.name.toLowerCase().includes(q) && m.name.toLowerCase() !== q).slice(0, 3)
                : [];
              return (
                <>
                  <View style={[styles.fieldRow, { borderBottomColor: suggestions.length > 0 ? 'transparent' : t.border }]}>
                    <View style={styles.fieldRowLeft}>
                      <Feather name="map-pin" size={16} color={t.muted} />
                      <Text style={[styles.fieldLabel, { color: t.muted }]}>Merchant</Text>
                    </View>
                    <TextInput
                      value={merchant}
                      onChangeText={setMerchant}
                      placeholder="Add merchant"
                      placeholderTextColor={t.muted}
                      style={[styles.fieldInlineInput, { color: t.text }]}
                      returnKeyType="done"
                      onFocus={() => {
                        if (merchantBlurTimer.current) clearTimeout(merchantBlurTimer.current);
                        setShowNumpad(false);
                        setMerchantFocused(true);
                      }}
                      onBlur={() => {
                        merchantBlurTimer.current = setTimeout(() => setMerchantFocused(false), 150);
                      }}
                    />
                  </View>
                  {suggestions.length > 0 && (
                    <View style={[styles.suggestStrip, { borderBottomColor: t.border, borderTopColor: t.border }]}>
                      {suggestions.map((m, i) => (
                        <Pressable
                          key={m.name}
                          style={[styles.suggestItem, { backgroundColor: t.surface }, i < suggestions.length - 1 && { borderRightColor: t.border, borderRightWidth: StyleSheet.hairlineWidth }]}
                          onPress={() => {
                            if (merchantBlurTimer.current) clearTimeout(merchantBlurTimer.current);
                            setMerchant(m.name);
                            if (m.categoryId && categories.find((c) => c.id === m.categoryId)) setCategoryId(m.categoryId);
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
            {mode !== 'transfer' && (
              <FieldRow
                icon="tag" label="Category" value={selectedCategory?.name}
                placeholder="Select category" onPress={() => setShowCategory(true)} t={t}
              />
            )}
            {mode !== 'transfer' && (
              <FieldRow
                icon="credit-card" label="Account"
                value={selectedAccount ? `${selectedAccount.name} · ${accountCurrency}` : undefined}
                placeholder="Select account" onPress={() => setShowAccount(true)} t={t}
              />
            )}
            <FieldRow
              icon="calendar" label="Date" value={fmtDateLabel(date)}
              onPress={() => setShowDate(true)} t={t}
            />
            <FieldRow
              icon="align-left" label="Note" value={note || undefined}
              placeholder="Add a note" onPress={() => setShowNote(true)} t={t} last
            />
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {showNumpad && !showNote && (
        <>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setShowNumpad(false)}
          />
          <NumericKeypad
            onKey={(key) => {
              setAmountStr((s) => {
                const { newRaw, newCursor } = applyNumpadKeyAtCursor(s, key, amountRawCursorRef.current, activeCurrency);
                amountRawCursorRef.current = newCursor;
                const newDisplay = formatAmountDisplay(newRaw, activeCurrency) || '0';
                const dCursor = rawCursorToDisplayCursor(newDisplay, newCursor);
                requestAnimationFrame(() => {
                  amountInputRef.current?.setNativeProps({ selection: { start: dCursor, end: dCursor } });
                });
                return newRaw;
              });
            }}
          />
        </>
      )}

      {/* ── Fixed bottom action area ── */}
      <View style={[styles.footer, { backgroundColor: t.bg, borderTopColor: t.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          style={[styles.footerBtn, { backgroundColor: t.accent, opacity: saving ? 0.6 : 1 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color={t.onAccent} />
            : <Text style={[styles.footerBtnText, { color: t.onAccent }]}>{isEditing ? 'Update' : 'Save'}</Text>}
        </Pressable>
      </View>

      {/* ── Sheets ── */}
      <DatePickerSheet
        visible={showDate} onClose={() => setShowDate(false)}
        value={date} onChange={setDate} t={t}
      />
      <CategoryPickerSheet
        visible={showCategory} onClose={() => setShowCategory(false)}
        categories={categories} selected={categoryId}
        onSelect={(id) => setCategoryId(id)} t={t}
        kind={mode === 'income' ? 'income' : 'expense'}
      />
      <AccountPickerSheet
        visible={showAccount} onClose={() => setShowAccount(false)}
        accounts={accounts} selected={accountId}
        onSelect={(id, currency) => { setAccountId(id); setAccountCurrency(currency); setEntryCurrency(currency); }} t={t}
      />
      <CurrencyPickerModal
        visible={showCurrencyPicker}
        selected={entryCurrency}
        onSelect={(code) => setEntryCurrency(code)}
        onClose={() => setShowCurrencyPicker(false)}
      />
      <AccountPickerSheet
        visible={showFromPicker} onClose={() => setShowFromPicker(false)}
        title="Transfer from" accounts={accounts} selected={fromAccountId}
        onSelect={(id, currency) => { setFromAccountId(id); setFromCurrency(currency); }} t={t}
      />
      <AccountPickerSheet
        visible={showToPicker} onClose={() => setShowToPicker(false)}
        title="Transfer to" accounts={accounts} selected={toAccountId}
        onSelect={(id, currency) => { setToAccountId(id); setToCurrency(currency); }} t={t}
      />
      <NoteInputSheet
        visible={showNote} onClose={() => setShowNote(false)}
        value={note} onChange={setNote} t={t}
      />
      <RateAdjustSheet
        visible={showEntryRateAdjust} onClose={() => setShowEntryRateAdjust(false)}
        fromCurrency={entryCurrency} toCurrency={accountCurrency}
        rate={entryToAccountRate} amount={amount}
        onSave={(r) => setEntryToAccountRate(r)}
        t={t}
      />
      <RateAdjustSheet
        visible={showRateAdjust} onClose={() => setShowRateAdjust(false)}
        fromCurrency={fromCurrency} toCurrency={toCurrency}
        rate={transferRate} amount={amount}
        onSave={(r) => setTransferRate(r)}
        t={t}
      />
      <RateAdjustSheet
        visible={showLiveRateAdjust} onClose={() => setShowLiveRateAdjust(false)}
        fromCurrency={entryCurrency} toCurrency={homeCurrency}
        rate={liveRate} amount={amount}
        onSave={(r) => setLiveRate(r)}
        t={t}
      />

    </SafeAreaView>
  );
}

// styles

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: 12,
  },

  // Fixed bottom action area
  footer: {
    paddingHorizontal: ScreenPadding, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerBtn: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  footerBtnText: { fontSize: 16, fontWeight: '600' },

  modeTabs: { flexDirection: 'row', justifyContent: 'center', gap: 26, paddingBottom: 8 },
  modeTab: { alignItems: 'center', gap: 7 },
  modeTabText: { fontSize: 16 },
  modeTabUnderline: { width: 22, height: 3, borderRadius: 3 },

  scrollContent: { paddingBottom: 40 },

  amountHero: {
    alignItems: 'center', gap: 7, paddingTop: 34,
    paddingHorizontal: ScreenPadding, paddingBottom: 0,
  },
  currencyPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, borderWidth: 1,
  },
  currencyPillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  incomeSign: { fontSize: 38, fontWeight: '600', letterSpacing: -1 },
  amountInput: {
    fontSize: 52, fontWeight: '600', letterSpacing: -1.5,
    fontVariant: ['tabular-nums'], minWidth: 60, maxWidth: 280,
    paddingVertical: 0,
  },
  conversionLine: { fontSize: 13 },
  entryRateRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    marginTop: 8, borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10,
  },

  segSection: { paddingHorizontal: ScreenPadding, paddingTop: 22, gap: 9 },
  segEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  segTrack: { flexDirection: 'row', padding: 3, borderRadius: 13, borderWidth: 1 },
  segThumb: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  segThumbActive: {
    shadowColor: SHADOW_COLOR, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07, shadowRadius: 3, elevation: 2,
  },
  segText: { fontSize: 13 },
  segHint: { fontSize: 12, lineHeight: 17 },

  // Transfer
  transferSection: { paddingTop: 22 },
  transferPair: { position: 'relative' },
  transferCard: {
    borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 15,
    marginBottom: 3,
  },
  transferRail: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 4 },
  transferAcctName: { fontSize: 15, fontWeight: '600' },
  transferAcctBal: { fontSize: 12, marginTop: 2 },
  swapBtn: {
    position: 'absolute', right: -17, top: '50%',
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: SHADOW_COLOR, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6, elevation: 4,
    marginTop: -17,
  },
  rateRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    marginTop: 10, borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  rateRowLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, flex: 1 },
  rateRowLines: { flex: 1, gap: 3 },
  rateRowLabel: { fontSize: 13 },
  rateRowValue: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  rateRowAdjust: { fontSize: 12, fontWeight: '600' },

  // Rate adjust sheet
  rateSheetContainer: {
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    shadowColor: '#000', shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.18, shadowRadius: 40,
  },
  rateSheetPadded: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 14 },
  rateSheetHint: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  rateDisplayRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14,
  },
  rateInputLabel: { fontSize: 14, fontWeight: '500' },
  rateDisplayValue: { flex: 1, fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] as any, textAlign: 'right' },

  titleLine: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: ScreenPadding, marginTop: 26, paddingBottom: 11, borderBottomWidth: 1,
  },
  titleInput: { flex: 1, fontSize: 17, fontWeight: '500', paddingVertical: 0 },
  titleEyebrow: { fontSize: 11, letterSpacing: 0.6 },

  fieldSection: { marginTop: 4, paddingHorizontal: ScreenPadding },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 15, borderBottomWidth: 1,
  },
  fieldRowLast: { borderBottomWidth: 0 },
  fieldRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  fieldLabel: { fontSize: 14 },
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
  suggestName: { fontSize: 14, fontWeight: '500' },
  fieldRowRight: { flexDirection: 'row', alignItems: 'center', gap: 9, maxWidth: '60%' },
  fieldValue: { fontSize: 15, fontWeight: '600' },
  fieldValuePlaceholder: { fontWeight: '400', opacity: 0.6 },


  // Sheet
  sheetScrim: { flex: 1 },
  sheetContainer: {
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 22, paddingBottom: 26, paddingTop: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.18, shadowRadius: 40,
  },
  sheetHandle: { width: 38, height: 4, borderRadius: 3, alignSelf: 'center', marginBottom: 14 },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  sheetAction: { fontSize: 13, fontWeight: '600' },
  sheetBtn: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  sheetBtnText: { fontSize: 16, fontWeight: '600' },

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

  // Category
  catSearch: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    height: 40, paddingHorizontal: 13, borderRadius: 13, marginBottom: 14,
  },
  catSearchInput: { flex: 1, fontSize: 14 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, rowGap: 10 },
  catItem: { width: '22%', alignItems: 'center', gap: 7 },
  catIconTile: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  catName: { fontSize: 11, textAlign: 'center' },

  // Account
  acctRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15 },
  acctIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  acctName: { fontSize: 15, fontWeight: '600' },
  acctSub: { fontSize: 12, marginTop: 1 },
  acctCheck: { width: 20, height: 20, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },

  // Merchant
  merchantRoot: { flex: 1 },
  merchantHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: 14,
  },
  merchantBackBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 60 },
  merchantBackLabel: { fontSize: 15, fontWeight: '500' },
  merchantTitle: { fontSize: 17, fontWeight: '700' },
  merchantSearchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    height: 46, paddingHorizontal: 15, borderRadius: 15,
    marginHorizontal: 22, borderWidth: 1.5, marginBottom: 8,
  },
  merchantInput: { flex: 1, fontSize: 16, fontWeight: '500' },
  merchantSectionRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: 8,
  },
  merchantSectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  merchantSectionSub: { fontSize: 11 },
  merchantMatchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    paddingVertical: 13, paddingHorizontal: ScreenPadding, borderBottomWidth: 1,
  },
  merchantAvatar: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  merchantAvatarText: { fontSize: 13, fontWeight: '700' },
  merchantName: { fontSize: 15, fontWeight: '600' },
  merchantSubText: { fontSize: 12, marginTop: 2 },
  topTag: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  merchantNewText: { flex: 1, fontSize: 15, fontWeight: '600' },
  recentChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: ScreenPadding, paddingTop: 8 },
  recentChip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  recentChipText: { fontSize: 13 },

  // Note sheet (full page)
  noteRoot: { flex: 1 },
  noteHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noteBackBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 70 },
  noteBackLabel: { fontSize: 15, fontWeight: '500' },
  noteTitle: { fontSize: 17, fontWeight: '700' },
  noteActionBtn: { minWidth: 70, alignItems: 'flex-end' },
  noteAction: { fontSize: 13, fontWeight: '600' },
  noteBody: { padding: ScreenPadding, flexGrow: 1 },
  noteFooter: {
    paddingHorizontal: ScreenPadding, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  noteInput: {
    borderRadius: 13, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, minHeight: 160, textAlignVertical: 'top',
  },
});
