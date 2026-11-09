// Exit-strategy math. Pure functions so the Analyzer can recalculate live in the browser.
// Money in dollars, rates as decimals (0.07 = 7%).

export interface Assumptions {
  /** Wholesale: share of ARV an end buyer will pay all-in. */
  maoPct: number;
  assignmentFee: number;
  /** Repair cost per heated sq ft by condition. */
  repairLight: number;
  repairMedium: number;
  repairHeavy: number;
  holdingMonths: number;
  buyClosingPct: number;
  sellClosingPct: number;
  commissionPct: number;
  /** Hard money: share of (purchase + repairs) financed, annual rate, points. */
  hardMoneyLtc: number;
  hardMoneyRate: number;
  hardMoneyPoints: number;
  /** Long-term loan for hold / BRRRR refinance. */
  loanRate: number;
  loanYears: number;
  downPct: number;
  refiLtv: number;
  /** Rental operating assumptions, as share of rent. */
  vacancyPct: number;
  maintenancePct: number;
  managementPct: number;
  /** Post-sale property tax as a share of purchase price, per year. */
  taxRate: number;
  /** Monthly utilities and upkeep while holding a flip. */
  holdingUtilitiesMonthly: number;
}

/**
 * Starting assumptions. maoPct and the repair tiers are the defaults named in the build brief.
 * Everything else is a placeholder to be replaced with the owner's real numbers in Settings;
 * the UI labels them as assumptions.
 */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  maoPct: 0.7,
  assignmentFee: 10_000,
  repairLight: 25,
  repairMedium: 45,
  repairHeavy: 70,
  holdingMonths: 6,
  buyClosingPct: 0.02,
  sellClosingPct: 0.02,
  commissionPct: 0.05,
  hardMoneyLtc: 0.85,
  hardMoneyRate: 0.12,
  hardMoneyPoints: 0.02,
  loanRate: 0.07,
  loanYears: 30,
  downPct: 0.25,
  refiLtv: 0.75,
  vacancyPct: 0.05,
  maintenancePct: 0.08,
  managementPct: 0.08,
  taxRate: 0.02,
  holdingUtilitiesMonthly: 300,
};

export function monthlyPayment(principal: number, annualRate: number, years: number): number {
  if (!(principal > 0)) return 0;
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - (1 + r) ** -n);
}

export function loanBalance(principal: number, annualRate: number, years: number, monthsPaid: number): number {
  const r = annualRate / 12;
  const pmt = monthlyPayment(principal, annualRate, years);
  if (r === 0) return Math.max(0, principal - pmt * monthsPaid);
  return Math.max(0, principal * (1 + r) ** monthsPaid - (pmt * ((1 + r) ** monthsPaid - 1)) / r);
}

// ---------- Wholesale ----------

export interface WholesaleResult {
  /** Most the end buyer should pay: ARV × % − repairs. */
  buyerMax: number;
  /** My maximum allowable offer to the seller: buyerMax − assignment fee. */
  mao: number;
  opening: number;
  target: number;
  walkAway: number;
}

export function wholesale(arv: number, repairs: number, a: Assumptions): WholesaleResult {
  const buyerMax = arv * a.maoPct - repairs;
  const mao = buyerMax - a.assignmentFee;
  return {
    buyerMax,
    mao,
    // Opening 10% under target, target 5% under MAO: a negotiating ladder, editable later.
    opening: mao * 0.85,
    target: mao * 0.95,
    walkAway: mao,
  };
}

// ---------- Fix & flip ----------

export interface FlipResult {
  buyClosing: number;
  loanAmount: number;
  points: number;
  interest: number;
  holdingTaxes: number;
  holdingInsurance: number;
  holdingUtilities: number;
  sellClosing: number;
  commission: number;
  docStamps: number;
  totalCosts: number;
  cashInvested: number;
  profit: number;
  roi: number | null;
  annualizedRoi: number | null;
}

export function flip(args: {
  arv: number;
  purchase: number;
  repairs: number;
  insuranceAnnual: number | null;
  docStampsOnSale: number;
  a: Assumptions;
}): FlipResult {
  const { arv, purchase, repairs, a } = args;
  const months = a.holdingMonths;
  const buyClosing = purchase * a.buyClosingPct;
  const loanAmount = (purchase + repairs) * a.hardMoneyLtc;
  const points = loanAmount * a.hardMoneyPoints;
  const interest = loanAmount * (a.hardMoneyRate / 12) * months;
  const holdingTaxes = ((purchase * a.taxRate) / 12) * months;
  const holdingInsurance = ((args.insuranceAnnual ?? 0) / 12) * months;
  const holdingUtilities = a.holdingUtilitiesMonthly * months;
  const sellClosing = arv * a.sellClosingPct;
  const commission = arv * a.commissionPct;
  const docStamps = args.docStampsOnSale;
  const totalCosts =
    purchase +
    repairs +
    buyClosing +
    points +
    interest +
    holdingTaxes +
    holdingInsurance +
    holdingUtilities +
    sellClosing +
    commission +
    docStamps;
  const profit = arv - totalCosts;
  const cashInvested =
    purchase + repairs - loanAmount + buyClosing + points + interest + holdingTaxes + holdingInsurance + holdingUtilities;
  const roi = cashInvested > 0 ? profit / cashInvested : null;
  return {
    buyClosing,
    loanAmount,
    points,
    interest,
    holdingTaxes,
    holdingInsurance,
    holdingUtilities,
    sellClosing,
    commission,
    docStamps,
    totalCosts,
    cashInvested,
    profit,
    roi,
    annualizedRoi: roi !== null && months > 0 ? roi * (12 / months) : null,
  };
}

// ---------- Rental (buy & hold) ----------

export interface RentalResult {
  grossRentAnnual: number;
  vacancy: number;
  taxes: number;
  insurance: number;
  maintenance: number;
  management: number;
  hoa: number;
  operatingExpenses: number;
  noi: number;
  loanAmount: number;
  debtServiceAnnual: number;
  cashFlowAnnual: number;
  cashFlowMonthly: number;
  cashInvested: number;
  capRate: number | null;
  cashOnCash: number | null;
  dscr: number | null;
  onePercentRule: number | null;
  grm: number | null;
  pricePerDoor: number | null;
}

export function rental(args: {
  purchase: number;
  repairs: number;
  monthlyRent: number;
  insuranceAnnual: number | null;
  hoaMonthly: number | null;
  units: number | null;
  a: Assumptions;
}): RentalResult {
  const { purchase, repairs, monthlyRent, a } = args;
  const grossRentAnnual = monthlyRent * 12;
  const vacancy = grossRentAnnual * a.vacancyPct;
  const taxes = purchase * a.taxRate;
  const insurance = args.insuranceAnnual ?? 0;
  const maintenance = grossRentAnnual * a.maintenancePct;
  const management = grossRentAnnual * a.managementPct;
  const hoa = (args.hoaMonthly ?? 0) * 12;
  const operatingExpenses = taxes + insurance + maintenance + management + hoa;
  const noi = grossRentAnnual - vacancy - operatingExpenses;
  const loanAmount = purchase * (1 - a.downPct);
  const debtServiceAnnual = monthlyPayment(loanAmount, a.loanRate, a.loanYears) * 12;
  const cashFlowAnnual = noi - debtServiceAnnual;
  const cashInvested = purchase * a.downPct + repairs + purchase * a.buyClosingPct;
  const allIn = purchase + repairs;
  return {
    grossRentAnnual,
    vacancy,
    taxes,
    insurance,
    maintenance,
    management,
    hoa,
    operatingExpenses,
    noi,
    loanAmount,
    debtServiceAnnual,
    cashFlowAnnual,
    cashFlowMonthly: cashFlowAnnual / 12,
    cashInvested,
    capRate: allIn > 0 ? noi / allIn : null,
    cashOnCash: cashInvested > 0 ? cashFlowAnnual / cashInvested : null,
    dscr: debtServiceAnnual > 0 ? noi / debtServiceAnnual : null,
    onePercentRule: allIn > 0 ? monthlyRent / allIn : null,
    grm: grossRentAnnual > 0 ? purchase / grossRentAnnual : null,
    pricePerDoor: args.units && args.units > 0 ? purchase / args.units : null,
  };
}

// ---------- BRRRR ----------

export interface BrrrrResult {
  allIn: number;
  refiLoan: number;
  cashLeftIn: number;
  /** All-in cost as a share of ARV; at or under the refi LTV means most cash comes back. */
  allInToArv: number | null;
  debtServiceAnnual: number;
  noi: number;
  cashFlowMonthly: number;
  dscr: number | null;
}

export function brrrr(args: {
  arv: number;
  purchase: number;
  repairs: number;
  monthlyRent: number;
  insuranceAnnual: number | null;
  hoaMonthly: number | null;
  a: Assumptions;
}): BrrrrResult {
  const { arv, purchase, repairs, a } = args;
  const months = a.holdingMonths;
  const carry =
    purchase * a.buyClosingPct +
    (purchase + repairs) * a.hardMoneyLtc * (a.hardMoneyPoints + (a.hardMoneyRate / 12) * months) +
    ((purchase * a.taxRate) / 12) * months +
    ((args.insuranceAnnual ?? 0) / 12) * months;
  const allIn = purchase + repairs + carry;
  const refiLoan = arv * a.refiLtv;
  const refiCosts = refiLoan * 0.02;
  const cashLeftIn = allIn + refiCosts - refiLoan;

  const gross = args.monthlyRent * 12;
  // After the refi the county has re-assessed at roughly what it is worth, so taxes key off ARV.
  const opex =
    arv * a.taxRate +
    (args.insuranceAnnual ?? 0) +
    gross * (a.maintenancePct + a.managementPct) +
    (args.hoaMonthly ?? 0) * 12;
  const noi = gross * (1 - a.vacancyPct) - opex;
  const debtServiceAnnual = monthlyPayment(refiLoan, a.loanRate, a.loanYears) * 12;
  return {
    allIn,
    refiLoan,
    cashLeftIn,
    allInToArv: arv > 0 ? allIn / arv : null,
    debtServiceAnnual,
    noi,
    cashFlowMonthly: (noi - debtServiceAnnual) / 12,
    dscr: debtServiceAnnual > 0 ? noi / debtServiceAnnual : null,
  };
}

// ---------- Creative finance ----------

export function sellerFinancePayment(args: {
  price: number;
  downPayment: number;
  rate: number;
  amortYears: number;
}): { financed: number; monthly: number } {
  const financed = Math.max(0, args.price - args.downPayment);
  return { financed, monthly: monthlyPayment(financed, args.rate, args.amortYears) };
}

export function subjectTo(args: {
  loanBalance: number;
  loanPaymentMonthly: number;
  cashToSeller: number;
  arrears: number;
  monthlyRent: number | null;
  otherMonthlyCosts: number;
}): { entryCost: number; monthlySpread: number | null } {
  return {
    entryCost: args.cashToSeller + args.arrears,
    monthlySpread:
      args.monthlyRent === null ? null : args.monthlyRent - args.loanPaymentMonthly - args.otherMonthlyCosts,
  };
}

// ---------- Agent listing ----------

export function listingCommission(listPrice: number, commissionPct: number, mySplit: number): number {
  return listPrice * commissionPct * mySplit;
}

// ---------- Repairs ----------

export type RepairLevel = "light" | "medium" | "heavy";

export function quickRepair(sqft: number, level: RepairLevel, a: Assumptions): number {
  const rate = level === "light" ? a.repairLight : level === "medium" ? a.repairMedium : a.repairHeavy;
  return sqft * rate;
}

// ---------- Grade ----------

export type Grade = "A" | "B" | "C" | "D" | "F";

/**
 * Deal grade from how deep the discount is: (price + repairs) ÷ ARV.
 * A ≤ 70%, B ≤ 75%, C ≤ 80%, D ≤ 88%, F above. Dropped one letter when the
 * value estimate is low-confidence, because the ARV itself is shaky.
 */
export function dealGrade(purchase: number, repairs: number, arv: number, lowConfidence: boolean): {
  grade: Grade;
  ratio: number;
} | null {
  if (!(arv > 0) || !(purchase > 0)) return null;
  const ratio = (purchase + repairs) / arv;
  const scale: Grade[] = ["A", "B", "C", "D", "F"];
  let idx = ratio <= 0.7 ? 0 : ratio <= 0.75 ? 1 : ratio <= 0.8 ? 2 : ratio <= 0.88 ? 3 : 4;
  if (lowConfidence) idx = Math.min(4, idx + 1);
  return { grade: scale[idx], ratio };
}
