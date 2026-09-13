// month picker used by the Expenses and Split screens. 12 months in a grid

import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useState, useEffect } from 'react';
import { useTheme } from '@/hooks/use-theme';
import { ScreenPadding } from '@/constants/theme';
import { formatMoney, formatMoneyWithCode } from '@/logic/moneyFormatter';

const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

type MonthPickerSheetProps = {
  visible: boolean;
  onClose: () => void;
  year: number;
  month: number; // 1-indexed
  onSelect: (year: number, month: number) => void;
  /** Per-month spend totals keyed as "YYYY-MM" → number */
  spendByMonth?: Record<string, number>;
  /** Per-month item counts keyed as "YYYY-MM" → number */
  countByMonth?: Record<string, number>;
  /** Singular unit label (pluralised by adding "s"), default "expense" */
  countUnit?: string;
  currency?: string;
};

export default function MonthPickerSheet({
  visible,
  onClose,
  year: initialYear,
  month: initialMonth,
  onSelect,
  spendByMonth = {},
  countByMonth = {},
  countUnit = 'expense',
  currency = 'SGD',
}: MonthPickerSheetProps) {
  const t = useTheme();
  const now = new Date();
  const todayYear  = now.getFullYear();
  const todayMonth = now.getMonth() + 1;

  const [viewYear, setViewYear] = useState(initialYear);
  const [sel, setSel] = useState({ year: initialYear, month: initialMonth });

  useEffect(() => {
    if (visible) {
      setViewYear(initialYear);
      setSel({ year: initialYear, month: initialMonth });
    }
  }, [visible, initialYear, initialMonth]);

  function goThisMonth() {
    setViewYear(todayYear);
    setSel({ year: todayYear, month: todayMonth });
  }

  const selKey = `${sel.year}-${String(sel.month).padStart(2, '0')}`;
  const selSpend = spendByMonth[selKey] ?? 0;
  const selCount = countByMonth[selKey] ?? 0;

  const isAlreadyThisMonth = sel.year === todayYear && sel.month === todayMonth;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: t.surface }]}>
        <View style={[styles.handle, { backgroundColor: t.track }]} />

        {/* ── Title row ── */}
        <View style={styles.titleRow}>
          <Text style={[styles.titleText, { color: t.text }]}>Jump to month</Text>
          <Pressable hitSlop={10} onPress={goThisMonth} disabled={isAlreadyThisMonth}>
            <Text style={[styles.thisMonthLink, { color: isAlreadyThisMonth ? t.muted : t.accent }]}>
              This month
            </Text>
          </Pressable>
        </View>

        {/* ── Year nav ── */}
        <View style={styles.yearRow}>
          <Pressable hitSlop={14} onPress={() => setViewYear((y) => y - 1)}>
            <Feather name="chevron-left" size={19} color={t.text} />
          </Pressable>
          <Text style={[styles.yearLabel, { color: t.text }]}>{viewYear}</Text>
          <Pressable hitSlop={14} onPress={() => setViewYear((y) => y + 1)}>
            <Feather name="chevron-right" size={19} color={t.text} />
          </Pressable>
        </View>

        {/* ── 4×3 grid ── */}
        <View style={styles.grid}>
          {MONTH_ABBREVS.map((abbrev, idx) => {
            const m = idx + 1;
            const isFuture = viewYear > todayYear ||
              (viewYear === todayYear && m > todayMonth);
            const isSel = sel.year === viewYear && sel.month === m;
            const key = `${viewYear}-${String(m).padStart(2, '0')}`;
            const hasData = spendByMonth[key] !== undefined || countByMonth[key] !== undefined;

            return (
              <Pressable
                key={m}
                style={[
                  styles.chip,
                  isSel ? { backgroundColor: t.accent } : { backgroundColor: t.bg },
                  isFuture && styles.chipFuture,
                ]}
                onPress={() => !isFuture && setSel({ year: viewYear, month: m })}
                disabled={isFuture}
              >
                <Text style={[
                  styles.chipAbbrev,
                  { color: isSel ? t.onAccent : isFuture ? t.muted : t.text },
                  hasData && !isSel && !isFuture && { fontWeight: '600' },
                ]}>
                  {abbrev}
                </Text>
                {!isFuture && spendByMonth[key] !== undefined && (
                  <Text style={[styles.chipSpend, { color: isSel ? t.onAccent : t.muted }]}>
                    {formatMoney(spendByMonth[key], currency)}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* ── Footer ── */}
        <View style={styles.footerRow}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[styles.footerMonth, { color: t.text }]}>
              {MONTH_FULL[sel.month - 1]} {sel.year}
            </Text>
            {(selCount > 0 || selSpend > 0) && (
              <Text style={[styles.footerDetail, { color: t.muted }]}>
                {selCount > 0
                  ? `${selCount} ${countUnit}${selCount !== 1 ? 's' : ''}`
                  : ''}
                {selCount > 0 && selSpend > 0 ? ' · ' : ''}
                {selSpend > 0 ? formatMoneyWithCode(selSpend, currency) : ''}
              </Text>
            )}
          </View>
          <Pressable
            style={[styles.showBtn, { backgroundColor: t.accent }]}
            onPress={() => { onSelect(sel.year, sel.month); onClose(); }}
          >
            <Text style={[styles.showBtnText, { color: t.onAccent }]}>
              Show {MONTH_ABBREVS[sel.month - 1]}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(10,26,25,0.45)' },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 28,
    paddingTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -12 },
    shadowOpacity: 0.18,
    shadowRadius: 40,
  },
  handle: {
    width: 38, height: 4, borderRadius: 3,
    alignSelf: 'center', marginBottom: 14,
  },

  titleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 14,
  },
  titleText: { fontSize: 16, fontWeight: '700' },
  thisMonthLink: { fontSize: 14, fontWeight: '600' },

  yearRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 18,
  },
  yearLabel: { fontSize: 16, fontWeight: '700' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chip: {
    width: '23%',
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  chipFuture: { opacity: 0.4 },
  chipAbbrev: { fontSize: 13, fontWeight: '500' },
  chipSpend: { fontSize: 10, fontVariant: ['tabular-nums'] as any },

  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  footerMonth: { fontSize: 16, fontWeight: '700' },
  footerDetail: { fontSize: 12 },
  showBtn: {
    height: 48, paddingHorizontal: 24, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  showBtnText: { fontSize: 15, fontWeight: '700' },
});
