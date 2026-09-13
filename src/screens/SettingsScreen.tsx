import { useCallback, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '../components/themed-text';
import { CurrencyPickerModal } from '../components/CurrencyPickerModal';
import { Radii, ScreenPadding, Spacing, themes } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { useThemeContext } from '../contexts/ThemeContext';
import { getCategories, getSettings, updateSettings, exportAllData, pickAndImport, clearAllData } from '../storage/storage';
import { seedDemoData } from '../data/seedDemoData';
import type { ThemeMode, ThemeAccent } from '../constants/theme';

// Theme picker modal

function ThemeModeModal({
  visible, current, onClose, onSelect,
}: { visible: boolean; current: ThemeMode; onClose: () => void; onSelect: (m: ThemeMode) => void }) {
  const t = useTheme();
  const options: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: 'System default' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={[styles.picker, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={[styles.pickerTitle, { color: t.text }]}>Theme</Text>
          {options.map((o, i) => (
            <View key={o.value}>
              {i > 0 && <View style={[styles.hr, { backgroundColor: t.border }]} />}
              <Pressable style={styles.pickerRow} onPress={() => { onSelect(o.value); onClose(); }}>
                <Text style={[styles.pickerLabel, { color: t.text }]}>{o.label}</Text>
                {current === o.value && <Feather name="check" size={16} color={t.accent} />}
              </Pressable>
            </View>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

// Accent picker modal

function AccentModal({
  visible, current, onClose, onSelect,
}: { visible: boolean; current: ThemeAccent; onClose: () => void; onSelect: (a: ThemeAccent) => void }) {
  const t = useTheme();
  const options: { value: ThemeAccent; label: string; color: string }[] = [
    { value: 'teal', label: 'Teal', color: themes.light.teal.accent },
    { value: 'pink', label: 'Baby Pink', color: themes.light.pink.accent },
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={[styles.picker, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={[styles.pickerTitle, { color: t.text }]}>Accent</Text>
          {options.map((o, i) => (
            <View key={o.value}>
              {i > 0 && <View style={[styles.hr, { backgroundColor: t.border }]} />}
              <Pressable style={styles.pickerRow} onPress={() => { onSelect(o.value); onClose(); }}>
                <View style={[styles.accentDot, { backgroundColor: o.color }]} />
                <Text style={[styles.pickerLabel, { color: t.text, flex: 1 }]}>{o.label}</Text>
                {current === o.value && <Feather name="check" size={16} color={t.accent} />}
              </Pressable>
            </View>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

// SettingsScreen

export default function SettingsScreen({ navigation }: any) {
  const t = useTheme();
  const { mode, accent, setMode, setAccent } = useThemeContext();

  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [categoryCount, setCategoryCount] = useState(0);
  const [showCurrency, setShowCurrency] = useState(false);
  const [showTheme, setShowTheme] = useState(false);
  const [showAccent, setShowAccent] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    Promise.all([
      getSettings() as Promise<any>,
      getCategories() as Promise<any[]>,
    ]).then(([settings, cats]) => {
      if (!cancelled) {
        setHomeCurrency(settings.homeCurrency ?? 'SGD');
        setCategoryCount(cats.length);
      }
    });
    return () => { cancelled = true; };
  }, []));

  async function handleSaveCurrency(code: string) {
    await updateSettings({ homeCurrency: code });
    setHomeCurrency(code);
  }

  async function handleExport() {
    setDataLoading(true);
    try {
      await exportAllData();
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? 'Could not export data.');
    } finally {
      setDataLoading(false);
    }
  }

  function handleImport() {
    Alert.alert(
      'Restore from backup',
      'This will replace all current data with the backup. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Choose file', style: 'default',
          onPress: async () => {
            setDataLoading(true);
            try {
              const ok = await pickAndImport();
              if (ok) {
                await refreshAfterDataChange();
                Alert.alert('Restored', 'Your data has been restored from the backup.');
              }
            } catch (e: any) {
              Alert.alert('Import failed', e?.message ?? 'Could not read backup file.');
            } finally {
              setDataLoading(false);
            }
          },
        },
      ],
    );
  }

  async function refreshAfterDataChange() {
    const [settings, cats] = await Promise.all([
      getSettings() as Promise<any>,
      getCategories() as Promise<any[]>,
    ]);
    setHomeCurrency(settings.homeCurrency ?? 'SGD');
    setCategoryCount(cats.length);
  }

  function handleSeedDemo() {
    Alert.alert(
      'Load Demo Data',
      'This will replace all your current data with sample entries. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Load Demo Data', style: 'destructive',
          onPress: async () => {
            setDataLoading(true);
            try {
              await seedDemoData();
              await refreshAfterDataChange();
              Alert.alert('Done', 'Demo data loaded.');
            } finally {
              setDataLoading(false);
            }
          },
        },
      ],
    );
  }

  function handleClearAll() {
    Alert.alert(
      'Clear All Data',
      'This permanently deletes all accounts, expenses, budgets, and settings. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Everything', style: 'destructive',
          onPress: async () => {
            setDataLoading(true);
            try {
              await clearAllData();
              await refreshAfterDataChange();
              Alert.alert('Cleared', 'All data has been erased.');
            } finally {
              setDataLoading(false);
            }
          },
        },
      ],
    );
  }

  function modeLabel(m: ThemeMode) {
    return { system: 'System', light: 'Light', dark: 'Dark' }[m];
  }

  const Card = ({ children }: { children: React.ReactNode }) => (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      {children}
    </View>
  );

  function NavRow({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) {
    return (
      <Pressable style={styles.settingsRow} onPress={onPress}>
        {({ pressed }) => (
          <View style={[styles.settingsRowInner, pressed && styles.pressed]}>
            <Text style={[styles.rowLabel, { color: t.text }]}>{label}</Text>
            <View style={styles.rowRight}>
              {value !== undefined && <Text style={[styles.rowValue, { color: t.muted }]}>{value}</Text>}
              <Feather name="chevron-right" size={16} color={t.muted} />
            </View>
          </View>
        )}
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: t.bg }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: ScreenPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <ThemedText type="title" style={styles.pageTitle}>Settings</ThemedText>

        {/* ── Main card ── */}
        <Card>
          <NavRow label="Home currency" value={homeCurrency} onPress={() => setShowCurrency(true)} />
          <View style={[styles.hr, { backgroundColor: t.border }]} />
          <NavRow label="Manage categories" value={String(categoryCount)} onPress={() => navigation.navigate('ManageCategories')} />
        </Card>

        {/* ── Appearance ── */}
        <ThemedText type="eyebrow" themeColor="muted" style={styles.sectionEyebrow}>Appearance</ThemedText>
        <Card>
          <NavRow label="Theme" value={modeLabel(mode)} onPress={() => setShowTheme(true)} />
          <View style={[styles.hr, { backgroundColor: t.border }]} />
          <Pressable style={styles.settingsRow} onPress={() => setShowAccent(true)}>
            {({ pressed }) => (
              <View style={[styles.settingsRowInner, pressed && styles.pressed]}>
                <Text style={[styles.rowLabel, { color: t.text }]}>Accent</Text>
                <View style={styles.rowRight}>
                  <View style={[styles.accentDot, { backgroundColor: t.accent }]} />
                  <Feather name="chevron-right" size={16} color={t.muted} />
                </View>
              </View>
            )}
          </Pressable>
        </Card>

        {/* ── Data ── */}
        <ThemedText type="eyebrow" themeColor="muted" style={styles.sectionEyebrow}>Data</ThemedText>
        <Card>
          <NavRow
            label={dataLoading ? 'Please wait…' : 'Export backup'}
            value="JSON"
            onPress={dataLoading ? () => {} : handleExport}
          />
          <View style={[styles.hr, { backgroundColor: t.border }]} />
          <NavRow
            label={dataLoading ? 'Please wait…' : 'Restore from backup'}
            onPress={dataLoading ? () => {} : handleImport}
          />
          <View style={[styles.hr, { backgroundColor: t.border }]} />
          <NavRow
            label={dataLoading ? 'Please wait…' : 'Load demo data'}
            onPress={dataLoading ? () => {} : handleSeedDemo}
          />
          <View style={[styles.hr, { backgroundColor: t.border }]} />
          <Pressable
            style={styles.settingsRow}
            onPress={dataLoading ? () => {} : handleClearAll}
            disabled={dataLoading}
          >
            {({ pressed }) => (
              <View style={[styles.settingsRowInner, pressed && styles.pressed]}>
                <Text style={[styles.rowLabel, { color: t.danger }]}>
                  {dataLoading ? 'Please wait…' : 'Clear all data'}
                </Text>
              </View>
            )}
          </Pressable>
        </Card>

        {/* ── Footer note ── */}
        <Text style={[styles.footer, { color: t.muted }]}>
          Tally 1.0 · rates from exchangerate.host
        </Text>
      </ScrollView>

      <ThemeModeModal visible={showTheme} current={mode}
        onClose={() => setShowTheme(false)} onSelect={setMode} />
      <AccentModal visible={showAccent} current={accent}
        onClose={() => setShowAccent(false)} onSelect={setAccent} />
      <CurrencyPickerModal
        visible={showCurrency}
        selected={homeCurrency}
        onSelect={handleSaveCurrency}
        onClose={() => setShowCurrency(false)}
      />
    </SafeAreaView>
  );
}

// styles

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: 14, paddingBottom: Spacing.six, gap: 10 },
  pageTitle: { marginBottom: 12 },
  sectionEyebrow: { marginTop: 12 },

  card: { borderRadius: Radii.card, borderWidth: 1, paddingHorizontal: 18, overflow: 'hidden' },
  settingsRow: {},
  settingsRowInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16,
  },
  pressed: { opacity: 0.6 },
  rowLabel: { fontSize: 15 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowValue: { fontSize: 15, fontWeight: '600' },
  hr: { height: StyleSheet.hairlineWidth },

  // Accent dot
  accentDot: { width: 20, height: 20, borderRadius: Radii.chip },

  // Footer
  footer: { fontSize: 11, marginTop: 8, textAlign: 'center' },

  // Modals
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: ScreenPadding },
  picker: { width: '100%', borderRadius: Radii.card, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 4, maxWidth: 340 },
  pickerTitle: { fontSize: 13, fontWeight: '600', paddingVertical: 16 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: Spacing.two },
  pickerLabel: { fontSize: 13, flex: 1 },
});
