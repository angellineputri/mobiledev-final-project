import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { STORAGE_KEYS } from './keys';
import { DEFAULT_CATEGORIES, isProtectedCategory } from '../data/defaultCategories';

// helpers

async function readList(key) {
  const raw = await AsyncStorage.getItem(key);
  return raw ? JSON.parse(raw) : [];
}

async function writeList(key, list) {
  await AsyncStorage.setItem(key, JSON.stringify(list));
  return list;
}

function makeId() {
  // simple id maker, no need for a whole library
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso() {
  return new Date().toISOString();
}

// accounts
// account shape: id, name, type, primaryCode, currencies
// turn old saved accounts into the new shape

function normalizeAccount(a) {
  if (a.currencies) return a; // already new shape
  const code = a.currency ?? 'SGD';
  return { ...a, primaryCode: code, currencies: [{ code, balance: a.balance ?? 0 }] };
}

export async function getAccounts() {
  const raw = await readList(STORAGE_KEYS.ACCOUNTS);
  return raw.map(normalizeAccount);
}

// add an account (works with new or old shape)
export async function addAccount({ name, type, primaryCode, currencies, currency = undefined, balance = 0 }) {
  const accounts = await getAccounts();
  const code = primaryCode ?? currency ?? 'SGD';
  const currs = currencies ?? [{ code, balance }];
  const account = { id: makeId(), name, type, primaryCode: code, currencies: currs, createdAt: nowIso() };
  await writeList(STORAGE_KEYS.ACCOUNTS, [...accounts, account]);
  return account;
}

// add or subtract from one currency balance
export async function updateSubBalance(accountId, currencyCode, delta) {
  const accounts = await getAccounts();
  const updated = accounts.map((a) => {
    if (a.id !== accountId) return a;
    const has = a.currencies.some((c) => c.code === currencyCode);
    return {
      ...a,
      currencies: has
        ? a.currencies.map((c) =>
            c.code === currencyCode
              ? { ...c, balance: Math.round((c.balance + delta + Number.EPSILON) * 100) / 100 }
              : c,
          )
        : [...a.currencies, { code: currencyCode, balance: Math.round((delta + Number.EPSILON) * 100) / 100 }],
    };
  });
  await writeList(STORAGE_KEYS.ACCOUNTS, updated);
  return updated.find((a) => a.id === accountId);
}

// set the main balance to an exact value
export async function updateAccountBalance(accountId, newBalance) {
  const accounts = await getAccounts();
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return;
  const code = account.primaryCode;
  const updated = accounts.map((a) =>
    a.id !== accountId
      ? a
      : { ...a, currencies: a.currencies.map((c) => (c.code === code ? { ...c, balance: newBalance } : c)) },
  );
  await writeList(STORAGE_KEYS.ACCOUNTS, updated);
  return updated.find((a) => a.id === accountId);
}

export async function updateAccount(accountId, changes) {
  const accounts = await getAccounts();
  const updated = accounts.map((a) =>
    a.id === accountId ? { ...a, ...changes } : a,
  );
  await writeList(STORAGE_KEYS.ACCOUNTS, updated);
  return updated.find((a) => a.id === accountId);
}

export async function deleteAccount(accountId) {
  const accounts = await getAccounts();
  await writeList(STORAGE_KEYS.ACCOUNTS, accounts.filter((a) => a.id !== accountId));
}

export async function updateAccountOrder(orderedIds) {
  const accounts = await getAccounts();
  const map = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const reordered = orderedIds.map((id) => map[id]).filter(Boolean);
  const rest = accounts.filter((a) => !orderedIds.includes(a.id));
  await writeList(STORAGE_KEYS.ACCOUNTS, [...reordered, ...rest]);
}

export async function deleteAccountWithExpenses(accountId) {
  const [accounts, expenses, incomes] = await Promise.all([getAccounts(), getExpenses(), getIncomes()]);
  await Promise.all([
    writeList(STORAGE_KEYS.ACCOUNTS, accounts.filter((a) => a.id !== accountId)),
    writeList(STORAGE_KEYS.EXPENSES, expenses.filter((e) => e.accountId !== accountId)),
    writeList(STORAGE_KEYS.INCOMES, incomes.filter((i) => i.accountId !== accountId)),
  ]);
}

export async function countAccountEntries(accountId) {
  const [expenses, incomes] = await Promise.all([getExpenses(), getIncomes()]);
  return expenses.filter((e) => e.accountId === accountId).length
       + incomes.filter((i) => i.accountId === accountId).length;
}

// currency convert for display lives in businessLogic, re-exported here
export { accountHomeTotal, convertToHome, accountDisplay } from '../logic/businessLogic';

// categories

export async function getCategories() {
  let categories = await readList(STORAGE_KEYS.CATEGORIES);
  if (categories.length === 0) {
    const seeded = DEFAULT_CATEGORIES.map((c) => ({ id: makeId(), ...c }));
    await writeList(STORAGE_KEYS.CATEGORIES, seeded);
    return seeded;
  }
  // add any new default categories that are missing
  const existingNames = new Set(categories.map((c) => c.name));
  const missing = DEFAULT_CATEGORIES.filter((d) => !existingNames.has(d.name));
  if (missing.length > 0) {
    const added = missing.map((c) => ({ id: makeId(), ...c }));
    categories = [...categories, ...added];
    await writeList(STORAGE_KEYS.CATEGORIES, categories);
  }
  return categories;
}

export async function addCategory(name, kind = 'expense') {
  const categories = await getCategories();
  const category = { id: makeId(), name, kind, isDefault: false };
  await writeList(STORAGE_KEYS.CATEGORIES, [...categories, category]);
  return category;
}

export async function updateCategory(categoryId, changes) {
  const categories = await getCategories();
  const target = categories.find((c) => c.id === categoryId);
  // don't rename "Others", the balance fix looks it up by name
  if (target && isProtectedCategory(target) && 'name' in changes && changes.name !== target.name) {
    throw new Error("The “Others” category can’t be renamed.");
  }
  await writeList(
    STORAGE_KEYS.CATEGORIES,
    categories.map((c) => c.id === categoryId ? { ...c, ...changes } : c),
  );
}

export async function deleteCategory(categoryId) {
  const categories = await getCategories();
  const target = categories.find((c) => c.id === categoryId);
  if (target && isProtectedCategory(target)) {
    throw new Error("The “Others” category can’t be deleted.");
  }
  // move linked expenses to "Others" so they keep a category
  const others = categories.find((c) => c.name === 'Others' && c.kind === 'expense' && c.id !== categoryId);
  if (others || target?.kind === 'income') {
    const expenses = await getExpenses();
    const linked = expenses.some((e) => e.categoryId === categoryId);
    if (linked && others) {
      await writeList(
        STORAGE_KEYS.EXPENSES,
        expenses.map((e) => e.categoryId === categoryId ? { ...e, categoryId: others.id } : e),
      );
    }
  }
  await writeList(STORAGE_KEYS.CATEGORIES, categories.filter((c) => c.id !== categoryId));
}

// expenses

export async function getExpenses() {
  return readList(STORAGE_KEYS.EXPENSES);
}

export async function addExpense(expenseData) {
  const expenses = await getExpenses();
  // kind is 'daily' unless set to 'mustBuy'
  const expense = { id: makeId(), createdAt: nowIso(), kind: 'daily', ...expenseData };
  await writeList(STORAGE_KEYS.EXPENSES, [...expenses, expense]);
  return expense;
}

export async function updateExpense(expenseId, changes) {
  const expenses = await getExpenses();
  const updated = expenses.map((e) => (e.id === expenseId ? { ...e, ...changes } : e));
  await writeList(STORAGE_KEYS.EXPENSES, updated);
  return updated.find((e) => e.id === expenseId);
}

export async function deleteExpense(expenseId) {
  const expenses = await getExpenses();
  await writeList(STORAGE_KEYS.EXPENSES, expenses.filter((e) => e.id !== expenseId));
}

// budgets. one per month. a new month copies from the last one

export async function getBudgets() {
  return readList(STORAGE_KEYS.BUDGETS);
}

export async function getBudget(month) {
  const budgets = await getBudgets();
  return budgets.find((b) => b.month === month) ?? null;
}

export async function setBudget(month, data) {
  const budgets = await getBudgets();
  const existing = budgets.find((b) => b.month === month);
  const budget = { ...data, id: existing?.id ?? makeId(), month };
  const updated = existing
    ? budgets.map((b) => (b.month === month ? budget : b))
    : [...budgets, budget];
  await writeList(STORAGE_KEYS.BUDGETS, updated);
  return budget;
}

export async function getOrInheritBudget(month) {
  const existing = await getBudget(month);
  if (existing) return existing;

  // copy from the most recent month
  const budgets = await getBudgets();
  const prior = [...budgets]
    .filter((b) => b.month < month)
    .sort((a, b) => b.month.localeCompare(a.month))[0];

  if (!prior) return null;

  return {
    id: makeId(),
    month,
    income: prior.income,
    savingGoalId: prior.savingGoalId,
    savingsPerMonth: prior.savingsPerMonth,
    divisor: prior.divisor,
    carryOver: prior.carryOver,
    allowanceMode: prior.allowanceMode ?? 'formula',
    manualDailyAllowance: prior.manualDailyAllowance ?? 0,
    overallLimit: null,
    categoryLimits: [],
  };
}

// saving goals

export async function getSavingGoals() {
  return readList(STORAGE_KEYS.SAVING_GOALS);
}

export async function upsertSavingGoal(goal) {
  const goals = await getSavingGoals();
  const existing = goal.id ? goals.find((g) => g.id === goal.id) : null;
  const updated = existing
    ? goals.map((g) => (g.id === goal.id ? { ...g, ...goal } : g))
    : [...goals, { ...goal, id: goal.id ?? makeId() }];
  await writeList(STORAGE_KEYS.SAVING_GOALS, updated);
  return updated.find((g) => g.id === goal.id) ?? updated[updated.length - 1];
}

export async function deleteSavingGoal(goalId) {
  const goals = await getSavingGoals();
  const goal = goals.find((g) => g.id === goalId);
  // clean up any photo files this goal owns
  for (const uri of goal?.photos ?? []) {
    await deleteGoalPhoto(uri);
  }
  await writeList(STORAGE_KEYS.SAVING_GOALS, goals.filter((g) => g.id !== goalId));
}

// saving-goal photos ("visual goal").
// picked images live in a temp/cache dir, so copy them into the app's document
// folder so they survive restarts. only files we copied in here get cleaned up.
const GOAL_PHOTO_DIR = FileSystem.documentDirectory + 'goal-photos/';

export async function persistGoalPhoto(tempUri) {
  await FileSystem.makeDirectoryAsync(GOAL_PHOTO_DIR, { intermediates: true }).catch(() => {});
  const ext = (tempUri.split('?')[0].split('.').pop() || 'jpg').slice(0, 5);
  const dest = `${GOAL_PHOTO_DIR}${makeId()}.${ext}`;
  await FileSystem.copyAsync({ from: tempUri, to: dest });
  return dest;
}

export async function deleteGoalPhoto(uri) {
  // only touch files that live in our own goal-photos folder
  if (!uri || !uri.startsWith(GOAL_PHOTO_DIR)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

export async function recordMonthlyAllocation(goalId, month, amount) {
  const goals = await getSavingGoals();
  const updated = goals.map((g) => {
    if (g.id !== goalId) return g;
    const allocations = { ...(g.monthlyAllocations ?? {}), [month]: amount };
    const savedAmount = Object.values(allocations).reduce((s, a) => s + a, 0);
    return { ...g, monthlyAllocations: allocations, savedAmount };
  });
  await writeList(STORAGE_KEYS.SAVING_GOALS, updated);
}

// save or clear a manual rate for one goal in one month
export async function recordMonthlyRate(goalId, month, rate) {
  const goals = await getSavingGoals();
  const updated = goals.map((g) => {
    if (g.id !== goalId) return g;
    const monthlyRates = { ...(g.monthlyRates ?? {}) };
    if (rate == null) delete monthlyRates[month];
    else monthlyRates[month] = rate;
    return { ...g, monthlyRates };
  });
  await writeList(STORAGE_KEYS.SAVING_GOALS, updated);
}

export async function completeSavingGoal(goalId) {
  const goals = await getSavingGoals();
  const updated = goals.map((g) =>
    g.id === goalId ? { ...g, completedAt: nowIso() } : g,
  );
  await writeList(STORAGE_KEYS.SAVING_GOALS, updated);
}

export async function reopenSavingGoal(goalId) {
  const goals = await getSavingGoals();
  const updated = goals.map((g) =>
    g.id === goalId ? { ...g, completedAt: null } : g,
  );
  await writeList(STORAGE_KEYS.SAVING_GOALS, updated);
}

// incomes. cannot be edited. addIncome also updates the balance

export async function getIncomes() {
  return readList(STORAGE_KEYS.INCOMES);
}

// add an income and put the money in the account
/** @param {{ accountId: string, amount: number, currency: string, accountCurrencyAtEntry?: string, accountAmount?: number, amountInHomeCurrency?: number, categoryId?: string|null, source: string, destination?: 'allowance'|'savings', savingGoalId?: string|null, date: string, notes?: string|null }} data */
export async function addIncome({ accountId, amount, currency, accountCurrencyAtEntry, accountAmount, amountInHomeCurrency = null, categoryId = null, source, destination = 'allowance', savingGoalId = null, date, notes = null } = {}) {
  const incomes = await getIncomes();
  const income = { id: makeId(), createdAt: nowIso(), accountId, amount, currency, accountCurrencyAtEntry, accountAmount, amountInHomeCurrency, categoryId, source, destination, savingGoalId, date, notes };
  await writeList(STORAGE_KEYS.INCOMES, [...incomes, income]);
  // add the money in the account's own currency
  const accounts = await getAccounts();
  const account = accounts.find((a) => a.id === accountId);
  if (account) {
    const code = accountCurrencyAtEntry ?? currency ?? account.primaryCode;
    const creditAmount = accountAmount ?? amount;
    await updateSubBalance(accountId, code, creditAmount);
  }
  return income;
}

export async function updateIncome(incomeId, changes) {
  const incomes = await getIncomes();
  const updated = incomes.map((i) => (i.id === incomeId ? { ...i, ...changes } : i));
  await writeList(STORAGE_KEYS.INCOMES, updated);
  return updated.find((i) => i.id === incomeId);
}

export async function deleteIncome(incomeId) {
  const incomes = await getIncomes();
  await writeList(STORAGE_KEYS.INCOMES, incomes.filter((i) => i.id !== incomeId));
}

// transfers. shape: from/to account, amounts, date. caller updates the balances

export async function getTransfers() {
  return readList(STORAGE_KEYS.TRANSFERS);
}

export async function addTransfer({ fromAccountId, toAccountId, fromCurrency, toCurrency, fromAmount, toAmount, notes = null, date }) {
  const transfers = await getTransfers();
  const transfer = { id: makeId(), createdAt: nowIso(), date, fromAccountId, toAccountId, fromCurrency, toCurrency, fromAmount, toAmount, notes };
  await writeList(STORAGE_KEYS.TRANSFERS, [...transfers, transfer]);
  return transfer;
}

export async function updateTransfer(transferId, changes) {
  const transfers = await getTransfers();
  const updated = transfers.map((t) => (t.id === transferId ? { ...t, ...changes } : t));
  await writeList(STORAGE_KEYS.TRANSFERS, updated);
  return updated.find((t) => t.id === transferId);
}

export async function deleteTransfer(transferId) {
  const transfers = await getTransfers();
  await writeList(STORAGE_KEYS.TRANSFERS, transfers.filter((t) => t.id !== transferId));
}

// split bills
// paidBy 'me' = i paid, others owe me. 'other' = someone else paid, i owe them

export async function getSplitBills() {
  return readList(STORAGE_KEYS.SPLIT_BILLS);
}

export async function addSplitBill(data) {
  const bills = await getSplitBills();
  const bill = { id: makeId(), createdAt: nowIso(), ...data };
  await writeList(STORAGE_KEYS.SPLIT_BILLS, [...bills, bill]);
  return bill;
}

export async function updateSplitBill(billId, changes) {
  const bills = await getSplitBills();
  const updated = bills.map((b) => (b.id === billId ? { ...b, ...changes } : b));
  await writeList(STORAGE_KEYS.SPLIT_BILLS, updated);
  return updated.find((b) => b.id === billId);
}

export async function unsettleSplitEntry(splitBillId, personName) {
  const bills = await getSplitBills();
  const updated = bills.map((b) => {
    if (b.id !== splitBillId) return b;
    return {
      ...b,
      entries: b.entries.map((e) =>
        e.person === personName ? { ...e, settled: false, settledAt: null } : e,
      ),
    };
  });
  await writeList(STORAGE_KEYS.SPLIT_BILLS, updated);
  return updated.find((b) => b.id === splitBillId);
}

export async function deleteSplitBill(billId) {
  const bills = await getSplitBills();
  await writeList(STORAGE_KEYS.SPLIT_BILLS, bills.filter((b) => b.id !== billId));
}

export async function settleSplitEntry(splitBillId, personName, settleType = 'received') {
  const bills = await getSplitBills();
  const updated = bills.map((b) => {
    if (b.id !== splitBillId) return b;
    return {
      ...b,
      entries: b.entries.map((e) =>
        e.person === personName
          ? { ...e, settled: true, settledAt: new Date().toISOString().slice(0, 10), settleType }
          : e,
      ),
    };
  });
  await writeList(STORAGE_KEYS.SPLIT_BILLS, updated);
  return updated.find((b) => b.id === splitBillId);
}

// settings

export async function getSettings() {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
  return raw ? JSON.parse(raw) : { homeCurrency: 'SGD' };
}

export async function updateSettings(changes) {
  const current = await getSettings();
  const updated = { ...current, ...changes };
  await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
  return updated;
}

// export / import data

const EXPORT_VERSION = 1;

export async function exportAllData() {
  const [accounts, categories, expenses, incomes, budgets, savingGoals, splitBills, settings] =
    await Promise.all([
      getAccounts(),
      getCategories(),
      readList(STORAGE_KEYS.EXPENSES),
      readList(STORAGE_KEYS.INCOMES),
      readList(STORAGE_KEYS.BUDGETS),
      readList(STORAGE_KEYS.SAVING_GOALS),
      readList(STORAGE_KEYS.SPLIT_BILLS),
      getSettings(),
    ]);

  // embed saving-goal photo files as base64 so the backup is self-contained.
  // the stored uris are absolute paths that don't survive a reinstall/new device,
  // so we carry the actual bytes and rewrite the uris on import.
  const goalPhotoAssets = {};
  for (const g of savingGoals) {
    for (const uri of g.photos ?? []) {
      if (goalPhotoAssets[uri]) continue;
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists) continue;
        const data = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        const ext = (uri.split('?')[0].split('.').pop() || 'jpg').slice(0, 5);
        goalPhotoAssets[uri] = { data, ext };
      } catch { /* skip a photo we can't read */ }
    }
  }

  const payload = {
    exportVersion: EXPORT_VERSION,
    exportedAt: nowIso(),
    accounts,
    categories,
    expenses,
    incomes,
    budgets,
    savingGoals,
    splitBills,
    settings,
    goalPhotoAssets,
  };

  const filename = `tally-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const fileUri = FileSystem.documentDirectory + filename;
  await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(payload, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: 'Save Tally backup' });
}

export async function importAllData(fileUri) {
  const raw = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.UTF8 });
  const payload = JSON.parse(raw);

  if (!payload || typeof payload !== 'object') throw new Error('Invalid backup file.');
  if ((payload.exportVersion ?? 0) > EXPORT_VERSION) {
    throw new Error('This backup was made by a newer version of Tally. Please update the app first.');
  }

  // restore embedded saving-goal photos to disk and repoint the uris
  let savingGoals = Array.isArray(payload.savingGoals) ? payload.savingGoals : null;
  const assets = payload.goalPhotoAssets;
  if (savingGoals && assets && Object.keys(assets).length > 0) {
    await FileSystem.makeDirectoryAsync(GOAL_PHOTO_DIR, { intermediates: true }).catch(() => {});
    savingGoals = await Promise.all(savingGoals.map(async (g) => {
      if (!Array.isArray(g.photos) || g.photos.length === 0) return g;
      const newPhotos = [];
      for (const uri of g.photos) {
        const asset = assets[uri];
        if (asset?.data) {
          try {
            const dest = `${GOAL_PHOTO_DIR}${makeId()}.${asset.ext || 'jpg'}`;
            await FileSystem.writeAsStringAsync(dest, asset.data, { encoding: FileSystem.EncodingType.Base64 });
            newPhotos.push(dest);
            continue;
          } catch { /* fall back to the original uri below */ }
        }
        newPhotos.push(uri);
      }
      return { ...g, photos: newPhotos };
    }));
  }

  const writes = [];
  if (Array.isArray(payload.accounts))    writes.push(writeList(STORAGE_KEYS.ACCOUNTS, payload.accounts));
  if (Array.isArray(payload.categories))  writes.push(writeList(STORAGE_KEYS.CATEGORIES, payload.categories));
  if (Array.isArray(payload.expenses))    writes.push(writeList(STORAGE_KEYS.EXPENSES, payload.expenses));
  if (Array.isArray(payload.incomes))     writes.push(writeList(STORAGE_KEYS.INCOMES, payload.incomes));
  if (Array.isArray(payload.budgets))     writes.push(writeList(STORAGE_KEYS.BUDGETS, payload.budgets));
  if (savingGoals)                        writes.push(writeList(STORAGE_KEYS.SAVING_GOALS, savingGoals));
  if (Array.isArray(payload.splitBills))  writes.push(writeList(STORAGE_KEYS.SPLIT_BILLS, payload.splitBills));
  if (payload.settings && typeof payload.settings === 'object') {
    writes.push(AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(payload.settings)));
  }

  await Promise.all(writes);
}

export async function pickAndImport() {
  const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) return null;
  await importAllData(asset.uri);
  return true;
}

export async function clearAllData() {
  const allKeys = [
    ...Object.values(STORAGE_KEYS),
    // dashboard ui settings
    'tally_balance_hidden',
    'tally_pager_index',
    'tally_dashboard_cache',
  ];
  await AsyncStorage.multiRemove(allKeys);
}
