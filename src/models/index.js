// no code here. just notes on the shape of the saved data so field names match

/**
 * @typedef {{ code: string, balance: number }} CurrencyBalance
 */

/**
 * @typedef {Object} Account
 * @property {string} id
 * @property {string} name                   e.g. "Cash Wallet", "DBS Multiplier"
 * @property {'cash'|'bank'|'credit_card'|'other'} type
 * @property {string} primaryCode            ISO code of the primary / home currency
 * @property {CurrencyBalance[]} currencies  one entry per sub-balance; cash accounts may have many
 * @property {string} createdAt             ISO datetime
 */

/**
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} name
 * @property {boolean} isDefault        true for the seeded starter set
 */

/**
 * @typedef {Object} SplitDetail
 * @property {string} person
 * @property {number|null} orderAmount  used for percentage-based splits
 * @property {number} shareAmount       this person's final share
 */

/**
 * @typedef {Object} Expense
 * @property {string} id
 * @property {string} accountId
 * @property {string} categoryId
 * @property {string} merchant
 * @property {number} amount                 in `currency`
 * @property {string} currency               ISO code — usually the account's, but overridable
 * @property {number} amountInHomeCurrency   converted amount, snapshotted at entry time
 * @property {number} exchangeRateAtEntry    rate used for the conversion above
 * @property {string} date                   ISO date
 * @property {'daily'|'mustBuy'} kind        daily = counts against daily allowance; mustBuy = excluded
 * @property {string|null} receiptImageUri
 * @property {boolean} isShared
 * @property {'equal'|'percentage'|'custom'|null} splitType
 * @property {SplitDetail[]|null} splitDetails
 * @property {string|null} notes
 * @property {string} createdAt              ISO datetime
 */

/**
 * @typedef {Object} UserSettings
 * @property {string} homeCurrency  ISO code
 */

/**
 * @typedef {Object} SplitEntry
 * @property {string} person
 * @property {number} share        this person's share of the total
 * @property {boolean} settled
 * @property {string|null} settledAt
 */

/**
 * @typedef {Object} SplitBill
 * @property {string} id
 * @property {string} merchant
 * @property {number} total              full bill amount
 * @property {string} currency
 * @property {string} date               ISO date
 * @property {'me'|'other'} paidBy       'me' = I fronted the bill; 'other' = someone else did
 * @property {string|null} paidByName    name of the payer when paidBy='other'
 * @property {'equal'|'custom'} splitType
 * @property {number} myShare            my portion of the total
 * @property {SplitEntry[]} entries           people who owe me, or who i owe
 * @property {string|null} linkedExpenseId    expense made for my share
 * @property {string|null} categoryId
 * @property {string} accountId
 * @property {string|null} notes
 * @property {string} createdAt
 * @property {Array<{personName:string, items:Array<{name:string,price:number}>}>} [personItems]  items per person (items mode)
 * @property {{gst:number, serviceCharge:number, delivery:number}} [sharedFees]  extra fees (items mode)
 */

/**
 * @typedef {Object} Income
 * @property {string} id
 * @property {string} accountId
 * @property {number} amount              amount in the typed (transaction) currency
 * @property {string} currency            the currency the user typed in
 * @property {string} [accountCurrencyAtEntry]  account's native currency, set when it differs from the typed currency
 * @property {number} [accountAmount]     amount in the account's currency, set when it differs from the typed currency
 * @property {number} [amountInHomeCurrency]    home-currency equivalent
 * @property {string|null} categoryId     income-kind category this belongs to
 * @property {string} source              label e.g. "Salary", "Freelance"
 * @property {'allowance'|'savings'} destination  allowance = adds to monthly pool; savings = goes to goal
 * @property {string|null} savingGoalId   set when destination='savings'
 * @property {string} date                ISO date
 * @property {string|null} notes
 * @property {string} createdAt
 */

/**
 * @typedef {Object} SavingGoal
 * @property {string} id
 * @property {string} name
 * @property {number} target          total amount to save
 * @property {string} targetMonth     "YYYY-MM" target completion month
 * @property {number} saved           amount saved so far
 * @property {number} perMonth        monthly contribution amount
 * @property {boolean} paused         true = this month's contribution is skipped
 * @property {Object<string, number>} [monthlyRates]  manual goal→home rate overrides keyed "YYYY-MM"
 */

export {}; // keeps this a module
