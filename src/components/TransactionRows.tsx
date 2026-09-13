// shared expense/income rows, used by the Expenses tab and the Day Detail screen
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '@/hooks/use-theme';
import { accountAmountDisplay, formatMoney } from '@/logic/moneyFormatter';
import { getExchangeRate } from '@/api/exchangeRate';

// types

export type RowExpense = {
  id: string; accountId: string; categoryId: string; merchant: string;
  description?: string | null; amount: number; currency: string; amountInHomeCurrency?: number;
  accountAmount?: number; accountCurrencyAtEntry?: string;
  date: string; notes?: string; isShared?: boolean;
  kind?: 'daily' | 'mustBuy';
};
export type RowIncome = {
  id: string; accountId: string; amount: number; currency: string;
  accountCurrencyAtEntry?: string; accountAmount?: number;
  amountInHomeCurrency?: number; categoryId?: string | null; source: string;
  destination?: 'allowance' | 'savings'; date: string; notes?: string | null;
};
export type RowTransfer = {
  id: string; date: string;
  fromAccountId: string; toAccountId: string;
  fromCurrency: string; toCurrency: string;
  fromAmount: number; toAmount: number;
  notes?: string | null;
};

// ExpenseRow

export function ExpenseRow({ expense, categoryName, accountName, accountPrimaryCode, homeCurrency, onPress, onDelete }: {
  expense: RowExpense; categoryName: string; accountName: string;
  accountPrimaryCode: string; homeCurrency: string; onPress: () => void; onDelete: () => void;
}) {
  const t = useTheme();

  // big number is in the account currency; these are set when it differs from what was typed
  const hasAccountData = expense.accountCurrencyAtEntry != null && expense.accountAmount != null;
  const bigCurrency = hasAccountData ? expense.accountCurrencyAtEntry! : expense.currency;
  const bigAmount   = hasAccountData ? expense.accountAmount!           : expense.amount;
  const txCurrency  = expense.currency;

  // only show the home footer when neither currency is already home
  const showHomeFooter = bigCurrency !== homeCurrency && txCurrency !== homeCurrency;

  const [fetchedHomeAmt, setFetchedHomeAmt] = useState<number | null>(null);
  useEffect(() => {
    if (!showHomeFooter || expense.amountInHomeCurrency != null) return;
    getExchangeRate(expense.currency, homeCurrency, expense.date).then((rate) => {
      if (rate) setFetchedHomeAmt(Math.round(expense.amount * rate * 100) / 100);
    });
  }, [showHomeFooter, expense.currency, homeCurrency, expense.date, expense.amount, expense.amountInHomeCurrency]);

  const homeEquiv = expense.amountInHomeCurrency ?? fetchedHomeAmt;
  const { big: displayAmount, footers: footerLines } = accountAmountDisplay({
    accountCurrency: bigCurrency, accountAmount: bigAmount,
    txCurrency, txAmount: expense.amount,
    homeCurrency, homeAmount: homeEquiv,
  });
  const caption = `${categoryName} · ${accountName}`;
  const displayName = expense.description
    ? `${expense.description} (${expense.merchant})`
    : expense.merchant || 'Expense';

  const isSystem = (expense as any).source === 'split_unsettled';
  const rowContent = (pressed: boolean) => (
    <View style={[styles.entryRow, { opacity: pressed ? 0.6 : 1, backgroundColor: t.surface }]}>
      <View style={styles.entryLeft}>
        <Text style={[styles.entryName, { color: t.text }]} numberOfLines={1}>{displayName}</Text>
        {caption ? <Text style={[styles.entryCap, { color: t.muted }]} numberOfLines={1}>{caption}</Text> : null}
      </View>
      <View style={styles.entryAmtCol}>
        <Text style={[styles.entryAmt, { color: t.danger }]}>{displayAmount}</Text>
        {footerLines.length > 0 && (
          <Text style={[styles.entryAmtFooter, { color: t.muted }]}>{footerLines.join(' · ')}</Text>
        )}
      </View>
    </View>
  );

  if (isSystem) {
    return <View>{rowContent(false)}</View>;
  }

  return (
    <Swipeable
      friction={2}
      rightThreshold={60}
      renderRightActions={(_prog, drag) => {
        const trans = drag.interpolate({ inputRange: [-80, 0], outputRange: [0, 20], extrapolate: 'clamp' });
        return (
          <Animated.View style={[deleteStyles.action, { transform: [{ translateX: trans }] }]}>
            <TouchableOpacity style={deleteStyles.btn} onPress={onDelete}>
              <Feather name="trash-2" size={20} color={t.danger} />
            </TouchableOpacity>
          </Animated.View>
        );
      }}
    >
      <Pressable onPress={onPress}>
        {({ pressed }) => rowContent(pressed)}
      </Pressable>
    </Swipeable>
  );
}

// IncomeRow

export function IncomeRow({ income, categoryName, accountName, homeCurrency, onPress, onDelete }: {
  income: RowIncome; categoryName: string; accountName: string; homeCurrency: string; onPress: () => void; onDelete: () => void;
}) {
  const t = useTheme();

  // big number is in the account currency; these are set when it differs from what was typed
  const hasAccountData = income.accountCurrencyAtEntry != null && income.accountAmount != null;
  const bigCurrency = hasAccountData ? income.accountCurrencyAtEntry! : income.currency;
  const bigAmount   = hasAccountData ? income.accountAmount!           : income.amount;
  const txCurrency  = income.currency;

  // only show the home footer when neither currency is already home
  const showHomeFooter = bigCurrency !== homeCurrency && txCurrency !== homeCurrency;

  const [fetchedHomeAmt, setFetchedHomeAmt] = useState<number | null>(null);
  useEffect(() => {
    if (!showHomeFooter || income.amountInHomeCurrency != null) return;
    getExchangeRate(income.currency, homeCurrency, income.date).then((rate) => {
      if (rate) setFetchedHomeAmt(Math.round(income.amount * rate * 100) / 100);
    });
  }, [showHomeFooter, income.currency, homeCurrency, income.date, income.amount, income.amountInHomeCurrency]);

  const homeEquiv = income.amountInHomeCurrency ?? fetchedHomeAmt;
  const { big: displayAmount, footers: footerLines } = accountAmountDisplay({
    accountCurrency: bigCurrency, accountAmount: bigAmount,
    txCurrency, txAmount: income.amount,
    homeCurrency, homeAmount: homeEquiv,
  });
  return (
    <Swipeable
      friction={2}
      rightThreshold={60}
      renderRightActions={(_prog, drag) => {
        const trans = drag.interpolate({ inputRange: [-80, 0], outputRange: [0, 20], extrapolate: 'clamp' });
        return (
          <Animated.View style={[deleteStyles.action, { transform: [{ translateX: trans }] }]}>
            <TouchableOpacity style={deleteStyles.btn} onPress={onDelete}>
              <Feather name="trash-2" size={20} color={t.danger} />
            </TouchableOpacity>
          </Animated.View>
        );
      }}
    >
      <Pressable style={[styles.entryRow, { backgroundColor: t.surface }]} onPress={onPress}>
        <View style={styles.entryLeft}>
          <Text style={[styles.entryName, { color: t.accent }]} numberOfLines={1}>{income.source || 'Income'}</Text>
          <Text style={[styles.entryCap, { color: t.muted }]} numberOfLines={1}>{`${categoryName || 'Income'} · ${accountName}`}</Text>
        </View>
        <View style={styles.entryAmtCol}>
          <Text style={[styles.entryAmt, { color: t.accent }]}>+{displayAmount}</Text>
          {footerLines.length > 0 && (
            <Text style={[styles.entryAmtFooter, { color: t.muted }]}>{footerLines.join(' · ')}</Text>
          )}
        </View>
      </Pressable>
    </Swipeable>
  );
}

// TransferRow

export function TransferRow({ transfer, fromAccountName, toAccountName, onPress, onDelete }: {
  transfer: RowTransfer; fromAccountName: string; toAccountName: string; onPress?: () => void; onDelete: () => void;
}) {
  const t = useTheme();
  const isCross = transfer.fromCurrency !== transfer.toCurrency;
  const rowContent = (pressed: boolean) => (
    <View style={[styles.entryRow, { opacity: pressed ? 0.6 : 1, backgroundColor: t.surface }]}>
      <View style={styles.entryLeft}>
        <Text style={[styles.entryName, { color: t.muted }]} numberOfLines={1}>Transfer</Text>
        <Text style={[styles.entryCap, { color: t.muted }]} numberOfLines={1}>
          {fromAccountName} → {toAccountName}
        </Text>
      </View>
      <View style={styles.entryAmtCol}>
        <Text style={[styles.entryAmt, { color: t.muted }]}>
          {transfer.fromCurrency} {formatMoney(transfer.fromAmount, transfer.fromCurrency)}
        </Text>
        {isCross && (
          <Text style={[styles.entryAmtFooter, { color: t.muted }]}>
            → {transfer.toCurrency} {formatMoney(transfer.toAmount, transfer.toCurrency)}
          </Text>
        )}
      </View>
    </View>
  );
  return (
    <Swipeable
      friction={2}
      rightThreshold={60}
      renderRightActions={(_prog, drag) => {
        const trans = drag.interpolate({ inputRange: [-80, 0], outputRange: [0, 20], extrapolate: 'clamp' });
        return (
          <Animated.View style={[deleteStyles.action, { transform: [{ translateX: trans }] }]}>
            <TouchableOpacity style={deleteStyles.btn} onPress={onDelete}>
              <Feather name="trash-2" size={20} color={t.danger} />
            </TouchableOpacity>
          </Animated.View>
        );
      }}
    >
      {onPress ? (
        <Pressable onPress={onPress}>{({ pressed }) => rowContent(pressed)}</Pressable>
      ) : (
        rowContent(false)
      )}
    </Swipeable>
  );
}

// styles

const styles = StyleSheet.create({
  entryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11 },
  entryLeft: { flex: 1, gap: 2, marginRight: 12 },
  entryName: { fontSize: 15, fontWeight: '500' },
  entryCap: { fontSize: 12 },
  entryAmtCol: { alignItems: 'flex-end', gap: 2 },
  entryAmt: { fontSize: 15, fontWeight: '500', fontVariant: ['tabular-nums'] as any, textAlign: 'right' },
  entryAmtFooter: { fontSize: 11, fontVariant: ['tabular-nums'] as any, textAlign: 'right' },
});

const deleteStyles = StyleSheet.create({
  action: { justifyContent: 'center', paddingRight: 16 },
  btn: { justifyContent: 'center', alignItems: 'center', padding: 8 },
});
