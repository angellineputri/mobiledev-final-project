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
import { Image } from 'expo-image';
import { useTheme } from '@/hooks/use-theme';
import { Radii, ScreenPadding } from '@/constants/theme';
import { formatMoney } from '@/logic/moneyFormatter';
import { getSavingGoals, getSettings } from '@/storage/storage';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

export default function AllSavingGoalsScreen({ route, navigation }: any) {
  const t = useTheme();
  const [goals, setGoals]             = useState<any[]>([]);
  const [currency, setCurrency]       = useState('SGD');
  const initialTab = (route.params?.initialTab as 'ongoing' | 'history') ?? 'ongoing';
  const [activeTab, setActiveTab]     = useState<'ongoing' | 'history'>(initialTab);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [rawGoals, settings] = await Promise.all([
          getSavingGoals() as Promise<any[]>,
          getSettings()   as Promise<any>,
        ]);
        setGoals(rawGoals);
        setCurrency(settings.homeCurrency ?? 'SGD');
      })();
    }, []),
  );

  const ongoing  = goals.filter((g) => !g.completedAt);
  const history  = goals.filter((g) => !!g.completedAt);
  const listData = activeTab === 'ongoing' ? ongoing : history;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
          <Feather name="chevron-left" size={20} color={t.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.text }]}>All Goals</Text>
        <Pressable
          hitSlop={12}
          onPress={() => navigation.navigate('SavingGoalDetail', {})}
        >
          <Feather name="plus" size={20} color={t.accent} />
        </Pressable>
      </View>

      {/* Segment tabs */}
      <View style={[styles.tabTrack, { backgroundColor: t.surface, borderColor: t.border }]}>
        {(['ongoing', 'history'] as const).map((tab) => (
          <Pressable
            key={tab}
            style={[
              styles.tabBtn,
              activeTab === tab && { backgroundColor: t.accent },
            ]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[
              styles.tabText,
              { color: activeTab === tab ? t.onAccent : t.muted },
            ]}>
              {tab === 'ongoing' ? `Ongoing (${ongoing.length})` : `History (${history.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {listData.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="inbox" size={32} color={t.muted} />
            <Text style={[styles.emptyText, { color: t.muted }]}>
              {activeTab === 'ongoing' ? 'No ongoing goals.' : 'No completed goals yet.'}
            </Text>
          </View>
        ) : (
          <View style={[styles.list, { backgroundColor: t.surface, borderColor: t.border }]}>
            {listData.map((goal, i) => {
              const pct = goal.targetAmount > 0
                ? Math.min(1, (goal.savedAmount ?? 0) / goal.targetAmount)
                : null;
              return (
                <View key={goal.id}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: t.border }]} />}
                  <Pressable
                    style={styles.row}
                    onPress={() => navigation.navigate('SavingGoalDetail', { goalId: goal.id })}
                  >
                    {goal.photos?.length > 0 && (
                      <Image source={{ uri: goal.photos[0] }} style={styles.thumb} contentFit="cover" />
                    )}
                    <View style={styles.rowLeft}>
                      <Text style={[styles.goalName, { color: t.text }]} numberOfLines={1}>
                        {goal.name}
                      </Text>
                      {goal.startMonth && (
                        <Text style={[styles.goalSub, { color: t.muted }]}>
                          {monthLabel(goal.startMonth)}
                          {goal.finishByMonth ? ` → ${monthLabel(goal.finishByMonth)}` : ''}
                        </Text>
                      )}
                      {pct !== null && (
                        <View style={[styles.progressTrack, { backgroundColor: t.track }]}>
                          <View style={[
                            styles.progressFill,
                            { backgroundColor: t.accent, width: `${Math.round(pct * 100)}%` as any },
                          ]} />
                        </View>
                      )}
                    </View>
                    <View style={styles.rowRight}>
                      {goal.perMonth > 0 && (
                        <Text style={[styles.perMonth, { color: t.accent }]}>
                          {goal.currency ?? currency} {formatMoney(goal.perMonth, goal.currency ?? currency)}
                          <Text style={{ color: t.muted }}>/mo</Text>
                        </Text>
                      )}
                      {goal.targetAmount > 0 && (
                        <Text style={[styles.saved, { color: t.muted }]}>
                          {goal.currency ?? currency} {formatMoney(goal.savedAmount ?? 0, goal.currency ?? currency)} saved
                        </Text>
                      )}
                      <Feather name="chevron-right" size={16} color={t.muted} />
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
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

  tabTrack: {
    flexDirection: 'row', marginHorizontal: ScreenPadding, marginBottom: 16,
    borderRadius: Radii.segTrack, borderWidth: 1, padding: 3, gap: 3,
  },
  tabBtn: {
    flex: 1, height: 36, borderRadius: Radii.segThumb,
    alignItems: 'center', justifyContent: 'center',
  },
  tabText: { fontSize: 13, fontWeight: '600' },

  scroll: { paddingHorizontal: ScreenPadding },

  list:   { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },
  divider:{ height: StyleSheet.hairlineWidth, marginHorizontal: 18 },

  row:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14, gap: 12,
  },
  rowLeft: { flex: 1, gap: 4 },
  rowRight:{ alignItems: 'flex-end', gap: 3 },
  thumb:   { width: 44, height: 44, borderRadius: 10 },

  goalName:     { fontSize: 15, fontWeight: '600' },
  goalSub:      { fontSize: 12 },
  perMonth:     { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  saved:        { fontSize: 12, fontVariant: ['tabular-nums'] as any },

  progressTrack:{ height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  progressFill: { height: 4, borderRadius: 2 },

  empty:     { alignItems: 'center', gap: 12, paddingTop: 80 },
  emptyText: { fontSize: 15 },
});
