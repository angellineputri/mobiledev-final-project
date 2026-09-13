// demo data, Jan 2026 to 9 Sep 2026. salary 3800 on the 25th, rent 1500 on the 1st

import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../storage/keys';
import { addIncome } from '../storage/storage';

// fixed ids

const CAT = {
  food:          'cat-food',
  transport:     'cat-transport',
  shopping:      'cat-shopping',
  entertainment: 'cat-entertainment',
  necessities:   'cat-necessities',
  rent:          'cat-rent',
  gifts:         'cat-gifts',
  emergency:     'cat-emergency',
  simcard:       'cat-simcard',
  subscriptions: 'cat-subscriptions',
  others:        'cat-others',
  salary:        'cat-inc-salary',
  freelance:     'cat-inc-freelance',
  dividends:     'cat-inc-dividends',
  parttime:      'cat-inc-parttime',
  transfer:      'cat-inc-transfer',
  otherincome:   'cat-inc-other',
};

const ACC = { cash: 'acc-cash', dbs: 'acc-dbs', amex: 'acc-amex' };

// helpers

let _idx = 0;
function exp(merchant, amount, currency, homeAmount, rate, accountId, categoryId, date, opts = {}) {
  _idx++;
  return {
    id: `exp-${date}-${String(_idx).padStart(3, '0')}`,
    createdAt: `${date}T08:00:00.000Z`,
    merchant, amount, currency,
    amountInHomeCurrency: homeAmount,
    exchangeRateAtEntry: rate,
    accountId, categoryId, date,
    kind: opts.kind ?? 'daily',
    isShared: false, splitType: null, splitDetails: null,
    notes: opts.notes ?? null, receiptImageUri: null,
  };
}

function incRec(id, date, amount, source, opts = {}) {
  return {
    id, createdAt: `${date}T09:00:00.000Z`,
    accountId: opts.accountId ?? ACC.dbs, amount, currency: 'SGD',
    source, destination: opts.destination ?? 'allowance',
    savingGoalId: opts.savingGoalId ?? null, date, notes: opts.notes ?? null,
  };
}

// main seed

export async function seedDemoData() {
  await AsyncStorage.multiRemove([
    STORAGE_KEYS.ACCOUNTS, STORAGE_KEYS.CATEGORIES, STORAGE_KEYS.EXPENSES,
    STORAGE_KEYS.BUDGETS,  STORAGE_KEYS.SAVING_GOALS, STORAGE_KEYS.SPLIT_BILLS,
    STORAGE_KEYS.INCOMES,  STORAGE_KEYS.SETTINGS,
  ]);

  // settings
  await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ homeCurrency: 'SGD' }));

  // categories
  const categories = [
    { id: CAT.food,          name: 'Food',                        icon: 'coffee',          kind: 'expense', isDefault: true },
    { id: CAT.transport,     name: 'Transport',                   icon: 'navigation',      kind: 'expense', isDefault: true },
    { id: CAT.shopping,      name: 'Shopping',                    icon: 'shopping-bag',    kind: 'expense', isDefault: true },
    { id: CAT.entertainment, name: 'Entertainment',               icon: 'film',            kind: 'expense', isDefault: true },
    { id: CAT.necessities,   name: 'Necessities',                 icon: 'home',            kind: 'expense', isDefault: true },
    { id: CAT.rent,          name: 'Rent',                        icon: 'key',             kind: 'expense', isDefault: true },
    { id: CAT.gifts,         name: 'Gifts',                       icon: 'gift',            kind: 'expense', isDefault: true },
    { id: CAT.emergency,     name: 'Emergency',                   icon: 'shield',          kind: 'expense', isDefault: true },
    { id: CAT.simcard,       name: 'SIM card',                    icon: 'wifi',            kind: 'expense', isDefault: true },
    { id: CAT.subscriptions, name: 'Memberships & subscriptions', icon: 'repeat',          kind: 'expense', isDefault: true },
    { id: CAT.others,        name: 'Others',                      icon: 'more-horizontal', kind: 'expense', isDefault: true },
    { id: CAT.salary,        name: 'Salary',                      icon: 'briefcase',       kind: 'income',  isDefault: true },
    { id: CAT.freelance,     name: 'Freelance',                   icon: 'code',            kind: 'income',  isDefault: true },
    { id: CAT.dividends,     name: 'Dividends',                   icon: 'trending-up',     kind: 'income',  isDefault: true },
    { id: CAT.parttime,      name: 'Part-time',                   icon: 'clock',           kind: 'income',  isDefault: true },
    { id: CAT.transfer,      name: 'Transfer',                    icon: 'arrow-right-circle', kind: 'income', isDefault: true },
    { id: CAT.otherincome,   name: 'Others',                      icon: 'more-horizontal', kind: 'income',  isDefault: true },
  ];
  await AsyncStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(categories));

  // accounts
  // DBS starts at 3,580 so after the Sep salary it becomes 7,380
  const accounts = [
    {
      id: ACC.cash, name: 'Cash Wallet', type: 'cash', primaryCode: 'SGD',
      currencies: [
        { code: 'SGD', balance: 380.00 },
        { code: 'JPY', balance: 12390 },   // left over from the Japan trip
        { code: 'THB', balance: 2508  },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: ACC.dbs, name: 'DBS Multiplier', type: 'bank', primaryCode: 'SGD',
      currencies: [{ code: 'SGD', balance: 3580.00 }],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: ACC.amex, name: 'Amex Platinum', type: 'credit_card', primaryCode: 'SGD',
      currencies: [{ code: 'SGD', balance: 820.00 }],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  await AsyncStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(accounts));

  // saving goal
  // 300 per month for 9 months = 2,700 saved
  await AsyncStorage.setItem(STORAGE_KEYS.SAVING_GOALS, JSON.stringify([
    {
      id: 'goal-japan', name: 'Japan trip 2027',
      targetAmount: 4000.00, savedAmount: 2700.00,
      currency: 'SGD', perMonth: 300.00,
      startMonth: '2026-01', finishByMonth: '2027-06',
      completedAt: null,
      monthlyAllocations: {
        '2026-01': 300, '2026-02': 300, '2026-03': 300, '2026-04': 300,
        '2026-05': 300, '2026-06': 300, '2026-07': 300, '2026-08': 300,
        '2026-09': 300,
      },
    },
  ]));

  // budgets (Jan–Sep), one per month
  // daily allowance = (3800 - must buy - 300 savings) / days in month
  const BUDGET_MONTHS = [
    '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
    '2026-06', '2026-07', '2026-08', '2026-09',
  ];
  const budgets = BUDGET_MONTHS.map((month) => ({
    id: `budget-${month}`, month,
    income: 3800.00,
    savingGoalId: 'goal-japan', savingsPerMonth: 300.00,
    divisor: 'daysInMonth', carryOver: true,
    overallLimit: 1800.00,
    categoryLimits: [
      { categoryId: CAT.food,          limit: 500.00 },
      { categoryId: CAT.transport,     limit: 200.00 },
      { categoryId: CAT.shopping,      limit: 300.00 },
      { categoryId: CAT.entertainment, limit: null   },
    ],
  }));
  await AsyncStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(budgets));

  // expenses (Jan–Sep 9)
  _idx = 0;
  const expenses = [
    // January 2026
    exp('Rent',                  1500.00, 'SGD', 1500.00, 1,   ACC.dbs,  CAT.rent,          '2026-01-01', { kind: 'mustBuy' }),
    exp('SP Group',                88.40, 'SGD',   88.40, 1,   ACC.dbs,  CAT.necessities,   '2026-01-05', { kind: 'mustBuy' }),
    exp('Starhub',                 25.00, 'SGD',   25.00, 1,   ACC.dbs,  CAT.simcard,       '2026-01-07', { kind: 'mustBuy' }),
    exp('Netflix & Spotify',       30.98, 'SGD',   30.98, 1,   ACC.dbs,  CAT.subscriptions, '2026-01-08', { kind: 'mustBuy' }),
    exp('Hawker & kopitiam',      248.00, 'SGD',  248.00, 1,   ACC.cash, CAT.food,          '2026-01-15'),
    exp('NTUC FairPrice',         222.00, 'SGD',  222.00, 1,   ACC.dbs,  CAT.food,          '2026-01-22'),
    exp('Grab & MRT',             148.00, 'SGD',  148.00, 1,   ACC.dbs,  CAT.transport,     '2026-01-20'),
    exp('Uniqlo',                 119.00, 'SGD',  119.00, 1,   ACC.amex, CAT.shopping,      '2026-01-25'),
    exp('CNY gifts',               80.00, 'SGD',   80.00, 1,   ACC.cash, CAT.gifts,         '2026-01-28'),

    // February 2026
    exp('Rent',                  1500.00, 'SGD', 1500.00, 1,   ACC.dbs,  CAT.rent,          '2026-02-01', { kind: 'mustBuy' }),
    exp('SP Group',                82.60, 'SGD',   82.60, 1,   ACC.dbs,  CAT.necessities,   '2026-02-05', { kind: 'mustBuy' }),
    exp('Starhub',                 25.00, 'SGD',   25.00, 1,   ACC.dbs,  CAT.simcard,       '2026-02-07', { kind: 'mustBuy' }),
    exp('Netflix & Spotify',       30.98, 'SGD',   30.98, 1,   ACC.dbs,  CAT.subscriptions, '2026-02-08', { kind: 'mustBuy' }),
    exp('CNY dinner',             185.00, 'SGD',  185.00, 1,   ACC.amex, CAT.food,          '2026-02-10'),
    exp('Hawker & kopitiam',      255.00, 'SGD',  255.00, 1,   ACC.cash, CAT.food,          '2026-02-20'),
    exp('MRT & Bus',              128.00, 'SGD',  128.00, 1,   ACC.cash, CAT.transport,     '2026-02-22'),
    exp('Zalora (Feb sale)',       218.00, 'SGD',  218.00, 1,   ACC.amex, CAT.shopping,      '2026-02-25'),

    // March 2026
    exp('Rent',                  1500.00, 'SGD', 1500.00, 1,   ACC.dbs,  CAT.rent,          '2026-03-01', { kind: 'mustBuy' }),
    exp('SP Group',                91.20, 'SGD',   91.20, 1,   ACC.dbs,  CAT.necessities,   '2026-03-05', { kind: 'mustBuy' }),
    exp('Starhub',                 25.00, 'SGD',   25.00, 1,   ACC.dbs,  CAT.simcard,       '2026-03-07', { kind: 'mustBuy' }),
    exp('Netflix & Spotify',       30.98, 'SGD',   30.98, 1,   ACC.dbs,  CAT.subscriptions, '2026-03-08', { kind: 'mustBuy' }),
    exp('Hawker & kopitiam',      245.00, 'SGD',  245.00, 1,   ACC.cash, CAT.food,          '2026-03-14'),
    exp('GrabFood',               210.00, 'SGD',  210.00, 1,   ACC.dbs,  CAT.food,          '2026-03-25'),
    exp('Grab & taxi',            158.00, 'SGD',  158.00, 1,   ACC.dbs,  CAT.transport,     '2026-03-22'),
    exp('Shopee',                 195.00, 'SGD',  195.00, 1,   ACC.amex, CAT.shopping,      '2026-03-28'),

    // April 2026
    exp('Rent',                  1500.00, 'SGD', 1500.00, 1,   ACC.dbs,  CAT.rent,          '2026-04-01', { kind: 'mustBuy' }),
    exp('SP Group',                85.80, 'SGD',   85.80, 1,   ACC.dbs,  CAT.necessities,   '2026-04-05', { kind: 'mustBuy' }),
    exp('Starhub',                 25.00, 'SGD',   25.00, 1,   ACC.dbs,  CAT.simcard,       '2026-04-07', { kind: 'mustBuy' }),
    exp('Netflix & Spotify',       30.98, 'SGD',   30.98, 1,   ACC.dbs,  CAT.subscriptions, '2026-04-08', { kind: 'mustBuy' }),
    exp('Hawker & kopitiam',      238.00, 'SGD',  238.00, 1,   ACC.cash, CAT.food,          '2026-04-14'),
    exp('NTUC FairPrice',         212.00, 'SGD',  212.00, 1,   ACC.dbs,  CAT.food,          '2026-04-22'),
    exp('Grab & MRT',             162.00, 'SGD',  162.00, 1,   ACC.dbs,  CAT.transport,     '2026-04-20'),
    exp('Cinema & bowling',        98.00, 'SGD',   98.00, 1,   ACC.amex, CAT.entertainment, '2026-04-26'),

    // May 2026
    exp('Rent',                  1500.00, 'SGD', 1500.00, 1,   ACC.dbs,  CAT.rent,          '2026-05-01', { kind: 'mustBuy' }),
    exp('SP Group',                89.00, 'SGD',   89.00, 1,   ACC.dbs,  CAT.necessities,   '2026-05-05', { kind: 'mustBuy' }),
    exp('Starhub',                 25.00, 'SGD',   25.00, 1,   ACC.dbs,  CAT.simcard,       '2026-05-07', { kind: 'mustBuy' }),
    exp('Netflix & Spotify',       30.98, 'SGD',   30.98, 1,   ACC.dbs,  CAT.subscriptions, '2026-05-08', { kind: 'mustBuy' }),
    exp('Hawker & kopitiam',      252.00, 'SGD',  252.00, 1,   ACC.cash, CAT.food,          '2026-05-15'),
    exp('Restaurants',            198.00, 'SGD',  198.00, 1,   ACC.amex, CAT.food,          '2026-05-25'),
    exp('Grab & MRT',             145.00, 'SGD',  145.00, 1,   ACC.dbs,  CAT.transport,     '2026-05-22'),
    exp("Mother's Day gift",       75.00, 'SGD',   75.00, 1,   ACC.amex, CAT.gifts,         '2026-05-11'),
    exp('Shopee',                 135.00, 'SGD',  135.00, 1,   ACC.amex, CAT.shopping,      '2026-05-28'),

    // June 2026
    exp('Rent',                  1500.00, 'SGD', 1500.00, 1,   ACC.dbs,  CAT.rent,          '2026-06-01', { kind: 'mustBuy' }),
    exp('SP Group',                92.40, 'SGD',   92.40, 1,   ACC.dbs,  CAT.necessities,   '2026-06-05', { kind: 'mustBuy' }),
    exp('Starhub',                 25.00, 'SGD',   25.00, 1,   ACC.dbs,  CAT.simcard,       '2026-06-07', { kind: 'mustBuy' }),
    exp('Netflix & Spotify',       30.98, 'SGD',   30.98, 1,   ACC.dbs,  CAT.subscriptions, '2026-06-08', { kind: 'mustBuy' }),
    exp('Hawker & kopitiam',      262.00, 'SGD',  262.00, 1,   ACC.cash, CAT.food,          '2026-06-14'),
    exp('GrabFood',               204.00, 'SGD',  204.00, 1,   ACC.dbs,  CAT.food,          '2026-06-24'),
    exp('Grab & taxi',            156.00, 'SGD',  156.00, 1,   ACC.dbs,  CAT.transport,     '2026-06-20'),
    exp('Lazada mid-year sale',   322.00, 'SGD',  322.00, 1,   ACC.amex, CAT.shopping,      '2026-06-25'),

    // July 2026 — Japan trip
    // rate at booking: 112 JPY = 1 SGD
    exp('Rent',                  1500.00, 'SGD', 1500.00, 1,   ACC.dbs,  CAT.rent,          '2026-07-01', { kind: 'mustBuy' }),
    exp('SP Group',                87.60, 'SGD',   87.60, 1,   ACC.dbs,  CAT.necessities,   '2026-07-05', { kind: 'mustBuy' }),
    exp('Starhub',                 25.00, 'SGD',   25.00, 1,   ACC.dbs,  CAT.simcard,       '2026-07-07', { kind: 'mustBuy' }),
    exp('Netflix & Spotify',       30.98, 'SGD',   30.98, 1,   ACC.dbs,  CAT.subscriptions, '2026-07-08', { kind: 'mustBuy' }),
    exp('Scoot flights',          620.00, 'SGD',  620.00, 1,   ACC.dbs,  CAT.entertainment, '2026-07-10'),
    exp('Ramen & sushi',          8500,   'JPY',   75.89, 112, ACC.cash, CAT.food,          '2026-07-14'),
    exp('JR pass & subway',       6200,   'JPY',   55.36, 112, ACC.cash, CAT.transport,     '2026-07-15'),
    exp('Don Quijote',           12800,   'JPY',  114.29, 112, ACC.cash, CAT.shopping,      '2026-07-16'),
    exp('Universal Studios JP',   7500,   'JPY',   66.96, 112, ACC.cash, CAT.entertainment, '2026-07-17'),
    exp('Izakaya & kaiseki',      9200,   'JPY',   82.14, 112, ACC.cash, CAT.food,          '2026-07-18'),
    exp('Hawker & kopitiam',      178.00, 'SGD',  178.00, 1,   ACC.cash, CAT.food,          '2026-07-28'),
    exp('Grab',                   108.00, 'SGD',  108.00, 1,   ACC.dbs,  CAT.transport,     '2026-07-28'),

    // August 2026
    exp('Rent',                  1500.00, 'SGD', 1500.00, 1,   ACC.dbs,  CAT.rent,          '2026-08-01', { kind: 'mustBuy' }),
    exp('SP Group',                90.20, 'SGD',   90.20, 1,   ACC.dbs,  CAT.necessities,   '2026-08-05', { kind: 'mustBuy' }),
    exp('Starhub',                 25.00, 'SGD',   25.00, 1,   ACC.dbs,  CAT.simcard,       '2026-08-07', { kind: 'mustBuy' }),
    exp('Netflix & Spotify',       30.98, 'SGD',   30.98, 1,   ACC.dbs,  CAT.subscriptions, '2026-08-08', { kind: 'mustBuy' }),
    exp('Hawker & kopitiam',      245.00, 'SGD',  245.00, 1,   ACC.cash, CAT.food,          '2026-08-14'),
    exp('NTUC FairPrice',         224.00, 'SGD',  224.00, 1,   ACC.dbs,  CAT.food,          '2026-08-22'),
    exp('Grab & MRT',             152.00, 'SGD',  152.00, 1,   ACC.dbs,  CAT.transport,     '2026-08-20'),
    exp("Friend's birthday",       68.00, 'SGD',   68.00, 1,   ACC.amex, CAT.gifts,         '2026-08-15'),
    exp('Escape room',             85.00, 'SGD',   85.00, 1,   ACC.amex, CAT.entertainment, '2026-08-23'),

    // September 2026 (1–9)
    exp('Rent',                  1500.00, 'SGD', 1500.00, 1,   ACC.dbs,  CAT.rent,          '2026-09-01', { kind: 'mustBuy' }),
    exp('Starhub',                 25.00, 'SGD',   25.00, 1,   ACC.dbs,  CAT.simcard,       '2026-09-02', { kind: 'mustBuy' }),
    exp('Netflix & Spotify',       30.98, 'SGD',   30.98, 1,   ACC.dbs,  CAT.subscriptions, '2026-09-03', { kind: 'mustBuy' }),
    exp('Hawker Centre',           32.50, 'SGD',   32.50, 1,   ACC.cash, CAT.food,          '2026-09-03'),
    exp('Kopi Corner',             18.50, 'SGD',   18.50, 1,   ACC.cash, CAT.food,          '2026-09-04'),
    exp('MRT',                     22.00, 'SGD',   22.00, 1,   ACC.cash, CAT.transport,     '2026-09-05'),
    exp('NTUC FairPrice',          68.40, 'SGD',   68.40, 1,   ACC.dbs,  CAT.food,          '2026-09-06'),
    exp('Grab',                    16.00, 'SGD',   16.00, 1,   ACC.dbs,  CAT.transport,     '2026-09-07'),
    exp('Kopitiam',                25.00, 'SGD',   25.00, 1,   ACC.cash, CAT.food,          '2026-09-08'),
    exp('GrabFood',                32.60, 'SGD',   32.60, 1,   ACC.dbs,  CAT.food,          '2026-09-09'),
    exp('Grab',                    14.00, 'SGD',   14.00, 1,   ACC.dbs,  CAT.transport,     '2026-09-09'),
  ];
  await AsyncStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses));

  // incomes
  // Jan–Aug written directly, Sep uses addIncome so it updates DBS
  const historicIncomes = [
    incRec('inc-2026-01', '2026-01-25', 3800.00, 'Salary'),
    incRec('inc-2026-02', '2026-02-25', 3800.00, 'Salary'),
    incRec('inc-2026-03', '2026-03-25', 3800.00, 'Salary'),
    incRec('inc-2026-04', '2026-04-25', 3800.00, 'Salary'),
    incRec('inc-2026-05', '2026-05-25', 3800.00, 'Salary'),
    incRec('inc-2026-06', '2026-06-25', 3800.00, 'Salary'),
    incRec('inc-2026-07', '2026-07-25', 3800.00, 'Salary'),
    incRec('inc-2026-08', '2026-08-25', 3800.00, 'Salary'),
    // freelance side income
    incRec('inc-fl-03', '2026-03-18', 650.00, 'Freelance'),
    incRec('inc-fl-06', '2026-06-12', 900.00, 'Freelance'),
    // income that goes to the saving goal, not the allowance
    incRec('inc-sav-08', '2026-08-28', 300.00, 'Savings top-up',
      { destination: 'savings', savingGoalId: 'goal-japan' }),
  ];
  await AsyncStorage.setItem(STORAGE_KEYS.INCOMES, JSON.stringify(historicIncomes));

  // Sep salary via addIncome so DBS updates (3580 + 3800 = 7380)
  await addIncome({
    accountId: ACC.dbs, amount: 3800.00, currency: 'SGD',
    source: 'Salary', destination: 'allowance',
    savingGoalId: null, date: '2026-09-25', notes: null,
  });

  // split bills
  // current app only makes two kinds: 'equal' and 'items' (the old 'custom'
  // type is gone). every saved bill carries liveRate + entryToAccountRate and
  // a myExpenseId, so the demo bills match that shape.
  const splitBills = [
    {
      id: 'sb1', merchant: 'Sushi Ta-ke', total: 66.00, currency: 'SGD',
      date: '2026-09-02', paidBy: 'me', paidByName: null,
      splitType: 'equal', myShare: 33.00,
      entries: [{ person: 'Darren', share: 33.00, settled: false, settledAt: null }],
      linkedExpenseId: null, myExpenseId: null, categoryId: CAT.food, accountId: ACC.dbs,
      notes: null, createdAt: '2026-09-02T00:00:00.000Z',
      liveRate: 1, entryToAccountRate: 1,
    },
    {
      id: 'sb2', merchant: 'NTUC FairPrice', total: 60.50, currency: 'SGD',
      date: '2026-09-05', paidBy: 'other', paidByName: 'Mei',
      splitType: 'equal', myShare: 30.25,
      entries: [{ person: 'Mei', share: 30.25, settled: true, settledAt: '2026-09-06' }],
      linkedExpenseId: null, myExpenseId: null, categoryId: CAT.food, accountId: ACC.cash,
      notes: null, createdAt: '2026-09-05T00:00:00.000Z',
      liveRate: 1, entryToAccountRate: 1,
    },
    {
      id: 'sb3', merchant: 'Grab', total: 41.32, currency: 'SGD',
      date: '2026-09-08', paidBy: 'other', paidByName: 'Mei',
      splitType: 'equal', myShare: 20.66,
      entries: [{ person: 'Mei', share: 20.66, settled: false, settledAt: null }],
      linkedExpenseId: null, myExpenseId: null, categoryId: CAT.transport, accountId: ACC.cash,
      notes: null, createdAt: '2026-09-08T00:00:00.000Z',
      liveRate: 1, entryToAccountRate: 1,
    },
    {
      id: 'sb4', merchant: 'Office lunch', total: 24.72, currency: 'SGD',
      date: '2026-09-08', paidBy: 'me', paidByName: null,
      splitType: 'equal', myShare: 12.36,
      entries: [{ person: 'Josh', share: 12.36, settled: false, settledAt: null }],
      linkedExpenseId: null, myExpenseId: null, categoryId: CAT.food, accountId: ACC.dbs,
      notes: null, createdAt: '2026-09-08T00:00:00.000Z',
      liveRate: 1, entryToAccountRate: 1,
    },
    {
      id: 'sb-aug', merchant: 'Dim Sum Palace', total: 48.90, currency: 'SGD',
      date: '2026-08-22', paidBy: 'me', paidByName: null,
      splitType: 'equal', myShare: 24.45,
      entries: [{ person: 'Wei', share: 24.45, settled: false, settledAt: null }],
      linkedExpenseId: null, myExpenseId: null, categoryId: CAT.food, accountId: ACC.dbs,
      notes: null, createdAt: '2026-08-22T00:00:00.000Z',
      liveRate: 1, entryToAccountRate: 1,
    },
    // foreign bill: THB lunch while travelling
    {
      id: 'sb-thb', merchant: 'Som Tam Nua', total: 1240.00, currency: 'THB',
      date: '2026-09-04', paidBy: 'me', paidByName: null,
      splitType: 'equal', myShare: 620.00,
      entries: [{ person: 'Darren', share: 620.00, settled: false, settledAt: null }],
      linkedExpenseId: null, myExpenseId: null, categoryId: CAT.food, accountId: ACC.dbs,
      notes: 'Bangkok trip', createdAt: '2026-09-04T00:00:00.000Z',
      liveRate: 0.037, entryToAccountRate: 0.037,
    },
    // foreign bill: JPY dinner, someone else paid
    {
      id: 'sb-jpy', merchant: 'Ichiran Ramen', total: 3800, currency: 'JPY',
      date: '2026-09-07', paidBy: 'other', paidByName: 'Mei',
      splitType: 'equal', myShare: 1900,
      entries: [{ person: 'Mei', share: 1900, settled: false, settledAt: null }],
      linkedExpenseId: null, myExpenseId: null, categoryId: CAT.food, accountId: ACC.cash,
      notes: null, createdAt: '2026-09-07T00:00:00.000Z',
      liveRate: 0.0088, entryToAccountRate: 0.0088,
    },
    // items bill, with GST 9% and service 10% added on
    {
      id: 'sb-items', merchant: 'Hotpot night', total: 135.66, currency: 'SGD',
      date: '2026-09-06', paidBy: 'me', paidByName: null,
      splitType: 'items', myShare: 42.84,
      entries: [
        { person: 'Ben',   share: 53.55, settled: false, settledAt: null },
        { person: 'Chloe', share: 39.27, settled: true,  settledAt: '2026-09-07' },
      ],
      splitItems: [
        { name: 'Wagyu platter', price: 60.00, sharerPersonNames: ['Me', 'Ben', 'Chloe'] },
        { name: 'Tiger prawns',  price: 24.00, sharerPersonNames: ['Me', 'Ben'] },
        { name: 'Tofu hotpot',   price: 12.00, sharerPersonNames: ['Me', 'Ben', 'Chloe'] },
        { name: 'Beer tower',    price: 18.00, sharerPersonNames: ['Ben', 'Chloe'] },
      ],
      sharedFees: { gst: 9, serviceCharge: 10, feeMode: 'pct', delivery: 0, deliverySplit: 'equal' },
      linkedExpenseId: null, myExpenseId: null, categoryId: CAT.food, accountId: ACC.amex,
      notes: null, createdAt: '2026-09-06T00:00:00.000Z',
      liveRate: 1, entryToAccountRate: 1,
    },
  ];
  await AsyncStorage.setItem(STORAGE_KEYS.SPLIT_BILLS, JSON.stringify(splitBills));
}
