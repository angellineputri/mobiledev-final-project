import { useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Radii, ScreenPadding, Spacing } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { SUPPORTED_CURRENCIES } from '../data/supportedCurrencies';

type Props = {
  visible: boolean;
  selected: string;
  onSelect: (code: string) => void;
  onClose: () => void;
};

export function CurrencyPickerModal({ visible, selected, onSelect, onClose }: Props) {
  const t = useTheme();
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? SUPPORTED_CURRENCIES.filter(
        (c) =>
          c.code.startsWith(query.toUpperCase()) ||
          c.name.toLowerCase().includes(query.toLowerCase()),
      )
    : SUPPORTED_CURRENCIES;

  function handleSelect(code: string) {
    onSelect(code);
    onClose();
    setQuery('');
  }

  function handleClose() {
    onClose();
    setQuery('');
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.sheet, { backgroundColor: t.bg }]}>
        <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>

          {/* ── Header ── */}
          <View style={[styles.header, { borderBottomColor: t.border }]}>
            <View style={styles.headerSlot} />
            <Text style={[styles.headerTitle, { color: t.text }]}>Currency</Text>
            <Pressable hitSlop={8} style={styles.headerSlot} onPress={handleClose}>
              <Text style={[styles.doneText, { color: t.accent }]}>Done</Text>
            </Pressable>
          </View>

          {/* ── Search ── */}
          <View style={[styles.searchRow, { borderBottomColor: t.border }]}>
            <Feather name="search" size={16} color={t.muted} />
            <TextInput
              style={[styles.searchInput, { color: t.text }]}
              placeholder="Search…"
              placeholderTextColor={t.muted}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="characters"
              clearButtonMode="while-editing"
              autoFocus
            />
          </View>

          {/* ── List (shrinks when keyboard appears) ── */}
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.code}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const active = selected === item.code;
                return (
                  <Pressable
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                    onPress={() => handleSelect(item.code)}
                  >
                    <Text style={[styles.rowCode, { color: t.text }]}>{item.code}</Text>
                    <Text style={[styles.rowName, { color: t.muted }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {active && <Feather name="check" size={16} color={t.accent} />}
                  </Pressable>
                );
              }}
              ItemSeparatorComponent={() => (
                <View style={[styles.sep, { backgroundColor: t.border }]} />
              )}
            />
          </KeyboardAvoidingView>

        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two + Spacing.half,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSlot: { minWidth: 44 },
  headerTitle: { fontSize: 15, fontWeight: '600' },
  doneText: { fontSize: 13, fontWeight: '600', textAlign: 'right' },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: ScreenPadding, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 14 },

  listContent: { paddingBottom: Spacing.six },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: ScreenPadding, paddingVertical: 14, gap: 12,
  },
  rowPressed: { opacity: 0.6 },
  rowCode: { fontSize: 13, fontWeight: '700', width: 46 },
  rowName: { flex: 1, fontSize: 13 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: ScreenPadding },
});
