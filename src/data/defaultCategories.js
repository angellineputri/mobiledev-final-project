// default categories added on first launch. "Others" is locked so it can't be
// deleted or renamed (balance edits get filed under it)
export const DEFAULT_CATEGORIES = [
  // expense categories
  { name: 'Food',                          icon: 'coffee',          kind: 'expense', isDefault: true },
  { name: 'Transport',                     icon: 'navigation',      kind: 'expense', isDefault: true },
  { name: 'Shopping',                      icon: 'shopping-bag',    kind: 'expense', isDefault: true },
  { name: 'Entertainment',                 icon: 'film',            kind: 'expense', isDefault: true },
  { name: 'Necessities',                   icon: 'home',            kind: 'expense', isDefault: true },
  { name: 'Rent',                          icon: 'key',             kind: 'expense', isDefault: true },
  { name: 'Gifts',                         icon: 'gift',            kind: 'expense', isDefault: true },
  { name: 'Emergency',                     icon: 'shield',          kind: 'expense', isDefault: true },
  { name: 'SIM card',                      icon: 'wifi',            kind: 'expense', isDefault: true },
  { name: 'Memberships & subscriptions',   icon: 'repeat',          kind: 'expense', isDefault: true },
  { name: 'Others',                        icon: 'more-horizontal', kind: 'expense', isDefault: true },
  // income categories
  { name: 'Salary',                        icon: 'briefcase',       kind: 'income',  isDefault: true },
  { name: 'Freelance',                     icon: 'code',            kind: 'income',  isDefault: true },
  { name: 'Dividends',                     icon: 'trending-up',     kind: 'income',  isDefault: true },
  { name: 'Part-time',                     icon: 'clock',           kind: 'income',  isDefault: true },
  { name: 'Transfer',                      icon: 'arrow-right-circle', kind: 'income', isDefault: true },
  { name: 'Others',                        icon: 'more-horizontal', kind: 'income',  isDefault: true },
];

// "Others" is locked, can't be deleted or renamed. both income and expense need it
export function isProtectedCategory(category) {
  return category?.name === 'Others';
}

export const CATEGORY_KEYWORDS = {
  Food: ['starbucks', 'coffee', 'restaurant', 'cafe', 'mcdonald', 'kfc', 'food', 'ntuc', 'cold storage', 'grocer', 'hawker', 'kopitiam', 'ramen', 'sushi', 'wingstop'],
  Transport: ['grab', 'uber', 'taxi', 'mrt', 'bus', 'petrol', 'gas station', 'transport', 'gojek', 'transit'],
  Shopping: ['shopee', 'lazada', 'amazon', 'uniqlo', 'zara', 'mall', 'zalora', 'don quijote'],
  Entertainment: ['netflix', 'cinema', 'movie', 'game', 'ticketmaster', 'concert', 'museum', 'escape room'],
  Necessities: ['utilities', 'sp group', 'power', 'water', 'insurance'],
  Rent: ['rent', 'rental', 'landlord'],
  Gifts: ['gift', 'present'],
  Emergency: ['emergency', 'hospital', 'clinic', 'medical'],
  'SIM card': ['singtel', 'starhub', 'm1', 'sim', 'telco'],
  'Memberships & subscriptions': ['spotify', 'apple', 'google', 'membership', 'subscription', 'gym'],
};
