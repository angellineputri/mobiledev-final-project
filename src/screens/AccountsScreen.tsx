import { useCallback, useState } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '../components/themed-text';
import { Radii, ScreenPadding, Spacing, TabBarHeight } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { formatMoney, formatMoneyWithCode, formatApprox } from '../logic/moneyFormatter';
import { getRatesFromHome } from '../api/exchangeRate';
import { computeGoalConversion, type GoalConversion } from '../logic/savingGoalConversion';
import { getAccounts, getSettings, accountDisplay, getSavingGoals } from '../storage/storage';

// types

type AccountType = 'cash' | 'bank' | 'credit_card' | 'other';
type CurrencyBalance = { code: string; balance: number };
type Account = {
  id: string; name: string; type: AccountType;
  primaryCode: string; currencies: CurrencyBalance[]; createdAt: string;
};

// helpers

function typeLabel(type: AccountType): string {
  return { cash: 'Cash', bank: 'Bank', credit_card: 'Credit card', other: 'Other' }[type] ?? type;
}

function typeIcon(type: AccountType): string {
  return { cash: 'dollar-sign', bank: 'home', credit_card: 'credit-card', other: 'more-horizontal' }[type] ?? 'credit-card';
}

const CARD_H = 74;
const CARD_GAP = 12;

// SavingsSection

function SavingsSection({
  goals, conv, homeCurrency, navigation,
}: {
  goals: any[];
  conv: Record<string, GoalConversion>;
  homeCurrency: string;
  navigation: any;
}) {
  const t = useTheme();
  const ongoingGoals = goals.filter((g) => !g.completedAt);
  const totalSaved    = ongoingGoals.reduce((s, g) => s + (conv[g.id]?.savedHome ?? 0), 0);
  const totalPerMonth = ongoingGoals.reduce((s, g) => s + (conv[g.id]?.perMonthHome ?? 0), 0);
  const goalCount = ongoingGoals.length;

  return (
    <View style={savStyles.section}>
      <Text style={[savStyles.eyebrow, { color: t.muted }]}>SAVINGS</Text>
      <Pressable
        style={[savStyles.card, { backgroundColor: t.surface, borderColor: t.border }]}
        onPress={() => navigation.navigate('ManageSavings')}
      >
        {/* Summary row */}
        <View style={savStyles.summaryRow}>
          <View style={savStyles.summaryLeft}>
            <Text style={[savStyles.summaryLabel, { color: t.muted }]}>
              {goalCount === 0
                ? 'No active goals'
                : `${goalCount} active goal${goalCount !== 1 ? 's' : ''}`}
            </Text>
            <Text style={[savStyles.summaryAmount, { color: t.text }]}>
              {formatMoney(totalSaved, homeCurrency)}{' '}
              <Text style={[savStyles.summaryCurrency, { color: t.muted }]}>{homeCurrency} saved</Text>
            </Text>
            {totalPerMonth > 0 && (
              <Text style={[savStyles.summaryPerMonth, { color: t.muted }]}>
                {homeCurrency} {formatMoney(totalPerMonth, homeCurrency)}/mo committed
              </Text>
            )}
          </View>
          <Feather name="chevron-right" size={18} color={t.muted} />
        </View>
      </Pressable>
    </View>
  );
}

// helpers

function showRateError() {
  Alert.alert(
    'Rate unavailable',
    "Couldn't fetch the exchange rate — frankfurter.dev appears to be down. Try again in a while.",
    [{ text: 'OK' }],
  );
}

// AccountCard

function AccountCard({
  account, homeCurrency, ratesFromHome, onPress,
}: {
  account: Account; homeCurrency: string; ratesFromHome: Record<string, number>; onPress: () => void;
}) {
  const t = useTheme();
  const subLine = account.type === 'cash'
    ? `Cash · ${account.currencies.map((c) => c.code).join(' · ')}`
    : `${typeLabel(account.type)} · ${account.primaryCode}`;
  const disp = accountDisplay(account, homeCurrency, ratesFromHome);

  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.75 : 1 }]}>
          <View style={[styles.iconTile, { backgroundColor: t.accentSoft }]}>
            <Feather name={typeIcon(account.type) as any} size={18} color={t.accentInk} />
          </View>
          <View style={styles.cardMeta}>
            <Text style={[styles.cardName, { color: t.text }]}>{account.name}</Text>
            <Text style={[styles.cardSub, { color: t.muted }]}>{subLine}</Text>
          </View>
          <View style={styles.cardBalanceCol}>
            <Text style={[styles.cardBalance, { color: t.text }]}>
              {disp.foreign ? formatMoneyWithCode(disp.amount, disp.code) : formatMoneyWithCode(disp.amount, homeCurrency)}
            </Text>
            {disp.foreign && (
              disp.homeEquivalent !== null ? (
                <Text style={[styles.cardBalanceApprox, { color: t.muted }]}>
                  {formatApprox(disp.homeEquivalent, homeCurrency)}
                </Text>
              ) : (
                <Pressable onPress={showRateError}>
                  <Text style={[styles.cardBalanceApprox, { color: t.muted }]}>
                    ≈ {homeCurrency} unknown{' '}
                    <Text style={styles.learnMore}>(learn more)</Text>
                  </Text>
                </Pressable>
              )
            )}
          </View>
        </View>
      )}
    </Pressable>
  );
}

// AccountsScreen

export default function AccountsScreen({ navigation }: any) {
  const t = useTheme();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [goals, setGoals] = useState<any[]>([]);
  const [conv, setConv] = useState<Record<string, GoalConversion>>({});
  const [homeCurrency, setHomeCurrency] = useState('SGD');
  const [ratesFromHome, setRatesFromHome] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [accs, settings, rawGoals] = await Promise.all([
        getAccounts() as Promise<Account[]>,
        getSettings() as Promise<{ homeCurrency: string }>,
        getSavingGoals() as Promise<any[]>,
      ]);
      if (cancelled) return;
      const home = settings.homeCurrency ?? 'SGD';
      setAccounts(accs);
      setGoals(rawGoals);
      setHomeCurrency(home);
      // change each goal into home currency
      Promise.all(rawGoals.map(async (g) => {
        const c = await computeGoalConversion({
          currency: g.currency ?? home, homeCurrency: home,
          allocations: g.monthlyAllocations ?? {},
          target: g.targetAmount ?? 0, perMonth: g.perMonth ?? 0,
          savedFallback: g.savedAmount ?? 0, completedAt: g.completedAt ?? null,
          monthlyRates: g.monthlyRates ?? {},
        });
        return [g.id, c] as const;
      })).then((entries) => {
        if (!cancelled) setConv(Object.fromEntries(entries));
      });
      const foreign = [...new Set(
        accs.flatMap((a) => a.currencies.map((c) => c.code)).filter((c) => c !== home),
      )];
      const rates = await getRatesFromHome(home, foreign);
      if (!cancelled) { setRatesFromHome(rates); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []));

  function handleCardPress(a: Account) {
    if (a.type === 'cash') {
      navigation.navigate('CashCurrencies', { accountId: a.id });
    } else {
      navigation.navigate('EditAccount', { account: a });
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
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.pageHeader, { paddingHorizontal: ScreenPadding }]}>
        <ThemedText type="title">Accounts</ThemedText>
      </View>

      <ScrollView
        contentContainerStyle={[styles.listContent, { paddingHorizontal: ScreenPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <SavingsSection goals={goals} conv={conv} homeCurrency={homeCurrency} navigation={navigation} />

        {accounts.length === 0 ? (
          <View style={styles.emptyAccounts}>
            <View style={[styles.emptyTile, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Feather name="credit-card" size={26} color={t.accent} />
            </View>
            <Text style={[styles.emptyTitle, { color: t.text }]}>No accounts yet</Text>
            <Text style={[styles.emptyHint, { color: t.muted }]}>
              Add an account to start tracking your balances.
            </Text>
          </View>
        ) : (
          <>
            <Text style={[styles.sectionEyebrow, { color: t.muted }]}>ACCOUNTS</Text>
            <View style={styles.accountList}>
              {accounts.map((a) => (
                <AccountCard
                  key={a.id}
                  account={a}
                  homeCurrency={homeCurrency}
                  ratesFromHome={ratesFromHome}
                  onPress={() => handleCardPress(a)}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* Add button pinned above tab bar */}
      <View style={[styles.footer, { paddingHorizontal: ScreenPadding }]}>
        <Pressable
          style={[styles.primaryBtn, { backgroundColor: t.accent }]}
          onPress={() => navigation.navigate('AddAccount')}
        >
          <Feather name="plus" size={18} color={t.onAccent} />
          <Text style={[styles.primaryBtnText, { color: t.onAccent }]}>Add Account</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// savings styles

const savStyles = StyleSheet.create({
  section:         { marginBottom: 24 },
  eyebrow:         { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  card:            { borderRadius: Radii.card, borderWidth: 1, overflow: 'hidden' },
  summaryRow:      {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 18, gap: 12,
  },
  summaryLeft:     { flex: 1, gap: 3 },
  summaryLabel:    { fontSize: 12 },
  summaryAmount:   { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] as any },
  summaryCurrency: { fontSize: 14, fontWeight: '400' },
  summaryPerMonth: { fontSize: 12, fontVariant: ['tabular-nums'] as any },
});

// styles

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: ScreenPadding },

  pageHeader: {
    paddingTop: 14,
    paddingBottom: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  sectionEyebrow: {
    fontSize: 11, fontWeight: '600', letterSpacing: 0.8,
    textTransform: 'uppercase', marginBottom: 10,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: Radii.card,
    borderWidth: 1,
    height: CARD_H,
  },
  iconTile: { width: 38, height: 38, borderRadius: Radii.iconTile, alignItems: 'center', justifyContent: 'center' },
  cardMeta: { flex: 1, gap: 3 },
  cardName: { fontSize: 16, fontWeight: '600' },
  cardSub: { fontSize: 12 },
  cardBalance: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  cardBalanceCol: { alignItems: 'flex-end', gap: 2 },
  cardBalanceApprox: { fontSize: 11, fontVariant: ['tabular-nums'] as any },
  learnMore: { textDecorationLine: 'underline' },

  listContent: { paddingTop: 0, paddingBottom: Spacing.four },
  accountList: { gap: CARD_GAP },

  footer: {
    paddingTop: Spacing.two,
    paddingBottom: 8,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    height: 54,
    borderRadius: Radii.button,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '600' },

  emptyAccounts: { alignItems: 'center', gap: 14, paddingVertical: 40 },
  emptyTile: { width: 64, height: 64, borderRadius: Radii.emptyTile, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyHint: { fontSize: 12, textAlign: 'center', maxWidth: 230, lineHeight: 21 },
});
