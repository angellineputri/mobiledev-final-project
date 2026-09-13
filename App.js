import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { ThemeProvider, useThemeContext } from './src/contexts/ThemeContext';
import { TabBarHeight } from './src/constants/theme';

import DashboardScreen from './src/screens/DashboardScreen';
import AccountsScreen from './src/screens/AccountsScreen';
import AddAccountScreen from './src/screens/AddAccountScreen';
import EditAccountScreen from './src/screens/EditAccountScreen';
import CashCurrenciesScreen from './src/screens/CashCurrenciesScreen';
import AllExpensesScreen from './src/screens/AllExpensesScreen';
import AddExpenseScreen from './src/screens/AddExpenseScreen';
import AddEntryScreen from './src/screens/AddEntryScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ManageCategoriesScreen from './src/screens/ManageCategoriesScreen';
import ManageAccountsScreen from './src/screens/ManageAccountsScreen';
import ManageSavingsScreen from './src/screens/ManageSavingsScreen';
import SavingGoalDetailScreen from './src/screens/SavingGoalDetailScreen';
import AllSavingGoalsScreen from './src/screens/AllSavingGoalsScreen';
import DayDetailScreen from './src/screens/DayDetailScreen';
import BudgetScreen from './src/screens/BudgetScreen';
import MonthSavingAllocationScreen from './src/screens/MonthSavingAllocationScreen';
import CategoryLimitsScreen from './src/screens/CategoryLimitsScreen';
import SplitScreen from './src/screens/SplitScreen';
import AddSplitScreen from './src/screens/AddSplitScreen';
import SplitDetailScreen from './src/screens/SplitDetailScreen';
import YoureOwedScreen from './src/screens/YoureOwedScreen';
import YouOweScreen from './src/screens/YouOweScreen';
import SplitHistoryScreen from './src/screens/SplitHistoryScreen';

const RootStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const DashboardStack = createNativeStackNavigator();
const AccountsStack = createNativeStackNavigator();
const AllExpensesStack = createNativeStackNavigator();
const SettingsStack = createNativeStackNavigator();
const SplitStack = createNativeStackNavigator();

// Stack navigators

function DashboardStackScreen() {
  return (
    <DashboardStack.Navigator screenOptions={{ headerShown: false }}>
      <DashboardStack.Screen name="DashboardMain" component={DashboardScreen} />
      <DashboardStack.Screen name="DayDetail" component={DayDetailScreen} />
      <DashboardStack.Screen name="AddEntry" component={AddEntryScreen} />
      <DashboardStack.Screen name="Budget" component={BudgetScreen} />
      <DashboardStack.Screen name="CategoryLimits" component={CategoryLimitsScreen} />
      <DashboardStack.Screen name="MonthSavingAllocation" component={MonthSavingAllocationScreen} />
      <DashboardStack.Screen name="ManageSavings" component={ManageSavingsScreen} />
      <DashboardStack.Screen name="SavingGoalDetail" component={SavingGoalDetailScreen} />
      <DashboardStack.Screen name="AllSavingGoals" component={AllSavingGoalsScreen} />
    </DashboardStack.Navigator>
  );
}

function AccountsStackScreen() {
  return (
    <AccountsStack.Navigator screenOptions={{ headerShown: false }}>
      <AccountsStack.Screen name="AccountsList" component={AccountsScreen} />
      <AccountsStack.Screen name="AddAccount" component={AddAccountScreen} />
      <AccountsStack.Screen name="EditAccount" component={EditAccountScreen} />
      <AccountsStack.Screen name="CashCurrencies" component={CashCurrenciesScreen} />
      <AccountsStack.Screen name="ManageSavings" component={ManageSavingsScreen} />
      <AccountsStack.Screen name="SavingGoalDetail" component={SavingGoalDetailScreen} />
      <AccountsStack.Screen name="AllSavingGoals" component={AllSavingGoalsScreen} />
    </AccountsStack.Navigator>
  );
}

function AllExpensesStackScreen() {
  return (
    <AllExpensesStack.Navigator screenOptions={{ headerShown: false }}>
      <AllExpensesStack.Screen name="AllExpenses" component={AllExpensesScreen} />
      <AllExpensesStack.Screen name="AddExpense" component={AddExpenseScreen} />
      <AllExpensesStack.Screen name="AddEntry" component={AddEntryScreen} />
      <AllExpensesStack.Screen name="DayDetail" component={DayDetailScreen} />
      <AllExpensesStack.Screen name="Budget" component={BudgetScreen} />
      <AllExpensesStack.Screen name="CategoryLimits" component={CategoryLimitsScreen} />
      <AllExpensesStack.Screen name="MonthSavingAllocation" component={MonthSavingAllocationScreen} />
      <AllExpensesStack.Screen name="ManageSavings" component={ManageSavingsScreen} />
      <AllExpensesStack.Screen name="SavingGoalDetail" component={SavingGoalDetailScreen} />
      <AllExpensesStack.Screen name="AllSavingGoals" component={AllSavingGoalsScreen} />
    </AllExpensesStack.Navigator>
  );
}

function SettingsStackScreen() {
  return (
    <SettingsStack.Navigator screenOptions={{ headerShown: false }}>
      <SettingsStack.Screen name="SettingsMain" component={SettingsScreen} />
      <SettingsStack.Screen name="ManageCategories" component={ManageCategoriesScreen} />
      <SettingsStack.Screen name="ManageAccounts" component={ManageAccountsScreen} />
      <SettingsStack.Screen name="ManageSavings" component={ManageSavingsScreen} />
      <SettingsStack.Screen name="SavingGoalDetail" component={SavingGoalDetailScreen} />
      <SettingsStack.Screen name="AllSavingGoals" component={AllSavingGoalsScreen} />
    </SettingsStack.Navigator>
  );
}

function SplitStackScreen() {
  return (
    <SplitStack.Navigator screenOptions={{ headerShown: false }}>
      <SplitStack.Screen name="Split" component={SplitScreen} />
      <SplitStack.Screen name="AddSplit" component={AddSplitScreen} />
      <SplitStack.Screen name="SplitDetail" component={SplitDetailScreen} />
      <SplitStack.Screen name="YoureOwed" component={YoureOwedScreen} />
      <SplitStack.Screen name="YouOwe" component={YouOweScreen} />
      <SplitStack.Screen name="SplitHistory" component={SplitHistoryScreen} />
      <SplitStack.Screen name="AddEntry" component={AddEntryScreen} />
    </SplitStack.Navigator>
  );
}

// Tab navigator (theme-aware)

function TabNavigator() {
  const { theme } = useThemeContext();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: TabBarHeight,
          paddingTop: 12,
        },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.muted,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.2,
          marginTop: 4,
        },
        tabBarIcon: ({ color, size }) => {
          const icons = {
            Dashboard: 'home',
            Accounts: 'credit-card',
            'All Expenses': 'list',
            'Split Bills': 'users',
            Settings: 'settings',
          };
          return <Feather name={icons[route.name]} size={21} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardStackScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="Accounts" component={AccountsStackScreen} />
      <Tab.Screen name="All Expenses" component={AllExpensesStackScreen} options={{ title: 'Expenses' }} />
      <Tab.Screen name="Split Bills" component={SplitStackScreen} options={{ title: 'Split' }} />
      <Tab.Screen name="Settings" component={SettingsStackScreen} />
    </Tab.Navigator>
  );
}

// Root

function RootNavigator() {
  const { theme } = useThemeContext();
  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        <RootStack.Screen name="Main" component={TabNavigator} />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <RootNavigator />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

registerRootComponent(App);
