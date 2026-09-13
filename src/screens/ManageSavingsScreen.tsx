import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../hooks/use-theme';
import { Radii, ScreenPadding } from '../constants/theme';
import { formatMoney } from '../logic/moneyFormatter';
import { computeGoalConversion, type GoalConversion } from '../logic/savingGoalConversion';
import { getSavingGoals, getSettings } from '../storage/storage';

const PAGE_SIZE = 5;



export default function ManageSavingsScreen({ navigation }: any) {
  const t = useTheme();
  const [goals, setGoals]               = useState<any[]>([]);
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [conv, setConv]                 = useState<Record<string, GoalConversion>>({});

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [rawGoals, settings] = await Promise.all([
          getSavingGoals() as Promise<any[]>,
          getSettings()   as Promise<any>,
        ]);
        if (cancelled) return;
        const home = settings.homeCurrency ?? 'SGD';
        setHomeCurrency(home);
        setGoals(rawGoals);
        // change each goal into home currency
        const entries = await Promise.all(rawGoals.map(async (g) => {
          const c = await computeGoalConversion({
            currency: g.currency ?? home, homeCurrency: home,
            allocations: g.monthlyAllocations ?? {},
            target: g.targetAmount ?? 0, perMonth: g.perMonth ?? 0,
            savedFallback: g.savedAmount ?? 0, completedAt: g.completedAt ?? null,
            monthlyRates: g.monthlyRates ?? {},
          });
          return [g.id, c] as const;
        }));
        if (!cancelled) setConv(Object.fromEntries(entries));
      })();
      return () => { cancelled = true; };
    }, []),
  );

  const ongoingGoals  = goals.filter((g) => !g.completedAt);
  const totalPerMonth = ongoingGoals.reduce((s, g) => s + (conv[g.id]?.perMonthHome ?? 0), 0);
  const totalSaved    = ongoingGoals.reduce((s, g) => s + (conv[g.id]?.savedHome ?? 0), 0);
  const goalCount     = ongoingGoals.length;
  const showLoadMore  = ongoingGoals.length > PAGE_SIZE;
  const visibleGoals  = ongoingGoals.slice(0, PAGE_SIZE);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
          <Feather name="chevron-left" size={20} color={t.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.text }]}>Savings</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Hero ── */}
        <View style={[styles.heroCard, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={[styles.heroEyebrow, { color: t.muted }]}>YOUR SAVING GOAL</Text>
          <Text style={[styles.heroAmount, { color: t.accent }]}>
            {homeCurrency}{' '}
            <Text style={{ fontVariant: ['tabular-nums'] as any }}>
              {formatMoney(totalPerMonth, homeCurrency)}
            </Text>
            <Text style={[styles.heroUnit, { color: t.muted }]}> /month</Text>
          </Text>
          {goalCount > 0 && (
            <Text style={[styles.heroSub, { color: t.muted }]}>
              {`${homeCurrency} ${formatMoney(totalSaved, homeCurrency)} saved across ${goalCount} active goal${goalCount !== 1 ? 's' : ''}`}
            </Text>
          )}
        </View>

        {/* ── Goal list ── */}
        <View style={[styles.goalList, { backgroundColor: t.surface, borderColor: t.border }]}>
          {/* Add row always at top */}
          <Pressable
            style={styles.addRow}
            onPress={() => navigation.navigate('SavingGoalDetail', {})}
          >
            <Feather name="plus" size={15} color={t.accent} />
            <Text style={[styles.addRowText, { color: t.accent }]}>Add a saving goal</Text>
          </Pressable>

          {visibleGoals.map((goal) => {
            const gc = goal.currency ?? homeCurrency;
            const savedAmount = goal.savedAmount ?? 0;
            const pct = goal.targetAmount > 0 ? Math.min(1, savedAmount / goal.targetAmount) : null;
            const c = conv[goal.id];
            const isForeign = gc !== homeCurrency;
            return (
              <View key={goal.id}>
                <View style={[styles.divider, { backgroundColor: t.border }]} />
                <Pressable
                  style={styles.goalCard}
                  onPress={() => navigation.navigate('SavingGoalDetail', { goalId: goal.id })}
                >
                  <Text style={[styles.goalName, { color: t.text }]} numberOfLines={1}>
                    {goal.name}
                  </Text>
                  {pct !== null && (
                    <View style={[styles.progressTrack, { backgroundColor: t.track }]}>
                      <View style={[
                        styles.progressFill,
                        { backgroundColor: t.accent, width: `${Math.round(pct * 100)}%` as any },
                      ]} />
                    </View>
                  )}
                  <View style={styles.progressRow}>
                    <Text style={[styles.progressSaved, { color: t.text }]}>
                      {gc} {formatMoney(savedAmount, gc)}
                    </Text>
                    {goal.targetAmount > 0 && (
                      <Text style={[styles.progressTarget, { color: t.muted }]}>
                        / {gc} {formatMoney(goal.targetAmount, gc)}
                      </Text>
                    )}
                    {pct !== null && (
                      <Text style={[styles.progressPct, { color: t.accent }]}>
                        ({Math.round(pct * 100)}%)
                      </Text>
                    )}
                  </View>
                  {isForeign && c && (
                    <Text style={[styles.goalConvNote, { color: t.muted }]}>
                      {`≈ ${homeCurrency} ${formatMoney(c.savedHome, homeCurrency)} / ${homeCurrency} ${formatMoney(c.targetHome, homeCurrency)}`}
                    </Text>
                  )}
                </Pressable>
              </View>
            );
          })}

          {ongoingGoals.length === 0 && (
            <>
              <View style={[styles.divider, { backgroundColor: t.border }]} />
              <Text style={[styles.emptyHint, { color: t.muted }]}>
                No saving goals yet. Add one above.
              </Text>
            </>
          )}

          {showLoadMore && (
            <>
              <View style={[styles.divider, { backgroundColor: t.border }]} />
              <Pressable
                style={styles.loadMoreRow}
                onPress={() => navigation.navigate('AllSavingGoals')}
              >
                <Text style={[styles.loadMoreText, { color: t.accent }]}>
                  See all {ongoingGoals.length} goals
                </Text>
                <Feather name="chevron-right" size={15} color={t.accent} />
              </Pressable>
            </>
          )}
        </View>

        {/* ── Completed goals history ── */}
        <Pressable
          style={[styles.historyBtn, { backgroundColor: t.surface, borderColor: t.border }]}
          onPress={() => navigation.navigate('AllSavingGoals', { initialTab: 'history' })}
        >
          <Feather name="clock" size={15} color={t.muted} />
          <Text style={[styles.historyBtnText, { color: t.muted }]}>Show history</Text>
          <Feather name="chevron-right" size={15} color={t.muted} />
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1 },
  header:      {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding, paddingVertical: 12,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  scroll:      { paddingHorizontal: ScreenPadding, gap: 16, paddingBottom: 40 },

  heroCard: {
    borderRadius: Radii.card, borderWidth: 1,
    paddingVertical: 28, paddingHorizontal: 22,
    alignItems: 'center', gap: 6,
  },
  heroEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.6 },
  heroAmount:  { fontSize: 34, fontWeight: '700', letterSpacing: -1 },
  heroUnit:    { fontSize: 17, fontWeight: '500' },
  heroSub:     { fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] as any },

  goalList:  { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },
  addRow:    {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16,
  },
  addRowText: { fontSize: 14, fontWeight: '600' },
  divider:    { height: StyleSheet.hairlineWidth, marginHorizontal: 18 },

  goalCard:      { paddingHorizontal: 18, paddingVertical: 12, gap: 6 },
  goalName:      { fontSize: 15, fontWeight: '600' },

  progressTrack: { height: 7, borderRadius: 4, overflow: 'hidden' },
  progressFill:  { height: 7, borderRadius: 4 },
  progressRow:   { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  progressSaved: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] as any },
  progressPct:   { fontSize: 13, fontWeight: '700' },
  progressTarget:{ fontSize: 13 },
  goalConvNote:  { fontSize: 11, fontVariant: ['tabular-nums'] as any },

  emptyHint:   { fontSize: 13, textAlign: 'center', paddingVertical: 20 },

  historyBtn: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, paddingVertical: 14, paddingHorizontal: 18,
    borderRadius: Radii.card, borderWidth: 1,
  },
  historyBtnText: { flex: 1, fontSize: 14, fontWeight: '500' },

  loadMoreRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 14,
  },
  loadMoreText: { fontSize: 14, fontWeight: '600' },
});
