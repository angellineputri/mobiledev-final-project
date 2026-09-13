import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CategoryLimit } from '../budget/types';
import { NumericKeypad, applyNumpadKey, formatAmountDisplay, rawToAmount, amountToRaw } from '../components/NumericKeypad';
import { Radii, ScreenPadding, Spacing } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { getCategories, getOrInheritBudget, getSettings, setBudget as saveBudget } from '../storage/storage';

type Category = { id: string; name: string };

export default function CategoryLimitsScreen({ route, navigation }: any) {
  const { month } = route.params as { month: string };
  const t = useTheme();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [limitsMap, setLimitsMap] = useState<Record<string, string>>({});
  const [savedBudget, setSavedBudget] = useState<any>(null);
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [activeCatId, setActiveCatId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      (getCategories as () => Promise<Category[]>)(),
      (getOrInheritBudget as (m: string) => Promise<any>)(month),
      (getSettings as () => Promise<any>)(),
    ]).then(([cats, budget, settings]) => {
      const home = (settings as any)?.homeCurrency ?? 'SGD';
      setHomeCurrency(home);
      setCategories(cats);
      setSavedBudget(budget);
      const map: Record<string, string> = {};
      (budget?.categoryLimits ?? []).forEach((cl: CategoryLimit) => {
        map[cl.categoryId] = amountToRaw(cl.limit, home);
      });
      setLimitsMap(map);
      setLoading(false);
    });
  }, [month]);

  async function handleSave() {
    if (!savedBudget) {
      Alert.alert('No budget set', 'Set up a budget first before adding category limits.');
      return;
    }
    setSaving(true);
    try {
      const categoryLimits: CategoryLimit[] = Object.entries(limitsMap)
        .filter(([, v]) => rawToAmount(v, homeCurrency) > 0)
        .map(([categoryId, v]) => ({ categoryId, limit: rawToAmount(v, homeCurrency) }));
      await (saveBudget as (m: string, d: any) => Promise<any>)(month, {
        ...savedBudget,
        categoryLimits,
      });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save limits.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.headerSide}>
            <Feather name="x" size={22} color={t.muted} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: t.text }]}>Category Limits</Text>
          <View style={styles.headerSide} />
        </View>

        <View style={styles.flex}>
          <ScrollView
            contentContainerStyle={[styles.content, { paddingHorizontal: ScreenPadding }]}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.hint, { color: t.muted }]}>
              Set a monthly spending cap per category. Leave blank for no limit.
            </Text>

            <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }]}>
              {categories.map((cat, i) => (
                <Pressable
                  key={cat.id}
                  style={[
                    styles.row,
                    { borderTopColor: t.border },
                    i === 0 && styles.rowFirst,
                  ]}
                  onPress={() => setActiveCatId(activeCatId === cat.id ? null : cat.id)}
                >
                  <Text style={[styles.rowLabel, { color: t.text }]} numberOfLines={1}>{cat.name}</Text>
                  <Text style={[styles.rowInput, { color: limitsMap[cat.id] ? t.text : t.muted }]}>
                    {limitsMap[cat.id] ? `${homeCurrency} ${formatAmountDisplay(limitsMap[cat.id], homeCurrency)}` : 'No limit'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={{ height: Spacing.two }} />
          </ScrollView>

          <SafeAreaView style={[styles.footer, { paddingHorizontal: ScreenPadding }]} edges={['bottom']}>
            <Pressable
              style={[styles.saveBtn, { backgroundColor: t.accent }, saving && styles.dimmed]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size="small" color={t.onAccent} />
                : <Text style={[styles.saveBtnText, { color: t.onAccent }]}>Save limits</Text>}
            </Pressable>
          </SafeAreaView>
        </View>
      </SafeAreaView>

      {activeCatId !== null && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setActiveCatId(null)} />
          <NumericKeypad
            onKey={(k) => setLimitsMap((prev) => ({
              ...prev,
              [activeCatId]: applyNumpadKey(prev[activeCatId] ?? '', k, homeCurrency),
            }))}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { minWidth: 44 },
  headerTitle: { fontSize: 15, fontWeight: '600' },

  content: { paddingTop: 16, gap: 14, paddingBottom: 16 },

  hint: { fontSize: 13, lineHeight: 19 },

  card: { borderRadius: Radii.card, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  rowFirst: { borderTopWidth: 0 },
  rowLabel: { flex: 1, fontSize: 14 },
  rowInput: {
    fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] as any,
    textAlign: 'right', minWidth: 80,
  },

  footer: { paddingTop: 12, paddingBottom: 10 },
  saveBtn: { height: 54, borderRadius: Radii.button, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: 14, fontWeight: '600' },
  dimmed: { opacity: 0.5 },
});
