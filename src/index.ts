import "dotenv/config";
import { summary, buy, claimRewards, comment } from "./api.lib.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;
const ONE_MONTH_MS = (365.25 / 12) * ONE_DAY_MS;
const ONE_YEAR_MS = 365.25 * ONE_DAY_MS;

const REFERENCE_INVESTMENT_BASE = 1000;

/**
 * Yield % in base currency value for a given period.
 * Value added per reward period = coinsBought * newPrice; position value = newBalance * newPrice.
 * Yield = (value added / position value) × (periods in window), as percentage.
 * So for a $1000 investment, this is the expected % return in base currency over that period.
 */
function yieldPercentForPeriod(
  coinsBought: number,
  newBalance: number,
  newPrice: number,
  timeRemainingMs: number,
  periodMs: number
): number | null {
  if (timeRemainingMs <= 0) return null;
  const positionValueBase = newBalance * newPrice;
  if (positionValueBase <= 0) return null;
  const valueAddedPerPeriod = coinsBought * newPrice;
  const periodsInWindow = periodMs / timeRemainingMs;
  const yieldFraction = (valueAddedPerPeriod / positionValueBase) * periodsInWindow;
  return yieldFraction * 100;
}

/** Returns ms until a random minute in the next clock hour (e.g. if now is 2:43, next run at 3:XX). */
function randomDelayUntilNextHour(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(next.getHours() + 1);
  next.setMinutes(Math.floor(Math.random() * 60), 0, 0);
  const delayMs = next.getTime() - now.getTime();
  return Math.max(60_000, delayMs); // at least 1 minute
}

async function main(): Promise<void> {
  const symbol = process.env.BUY_SYMBOL ?? "";
  let baseCurrencyBalance = 0;

  try {
    console.log(`Getting portfolio summary...`);
    const portfolio = await summary();

    baseCurrencyBalance = portfolio.baseCurrencyBalance;
  } catch (error) {
    console.error(error);
  }

  let timeRemainingMs = 12 * ONE_HOUR_MS; // fallback: 12 hours
  try {
    console.log(`Claiming rewards...`);
    const rewards = await claimRewards();
    if (rewards?.timeRemaining != null) {
      timeRemainingMs = Number(rewards.timeRemaining);
    }
  } catch (error) {
    console.error(error);
  }

  console.log(`Time remaining: ${timeRemainingMs}ms until rewards are claimed. Equivalent to ${timeRemainingMs / ONE_HOUR_MS} hours.`);

  const hoursLeft = Math.max(timeRemainingMs / ONE_HOUR_MS, 1);
  const amount = hoursLeft > 0 ? Math.floor(baseCurrencyBalance / hoursLeft) : 0;

  try {
    console.log(`Buying ${amount} of ${symbol}... (Dividing by ${hoursLeft} hours)`);
    const result = await buy(symbol, amount);
    const { coinsBought, totalCost, newPrice, priceImpact, newBalance } = result ?? {};
    
    const c = Number(coinsBought ?? 0);
    const b = Number(newBalance ?? 0);
    const p = Number(newPrice ?? 0);

    const daily = yieldPercentForPeriod(c, b, p, timeRemainingMs, ONE_DAY_MS);
    const weekly = yieldPercentForPeriod(c, b, p, timeRemainingMs, ONE_WEEK_MS);
    const monthly = yieldPercentForPeriod(c, b, p, timeRemainingMs, ONE_MONTH_MS);
    const annual = yieldPercentForPeriod(c, b, p, timeRemainingMs, ONE_YEAR_MS);

    const fmt = (n: number | null) => (n != null && Number.isFinite(n) ? `${n.toFixed(2)}%` : "—");
    const returnOn1k = (n: number | null) => (n != null && Number.isFinite(n) ? (REFERENCE_INVESTMENT_BASE * (n / 100)).toFixed(2) : "—");

    const updateLines: string[] = [
      `🪙 Investment update — ${symbol}`,
      `• Coins bought: ${coinsBought ?? "—"}`,
      `• Total cost: $${totalCost ?? "—"}`,
      `• New price: $${newPrice ?? "—"}`,
      `• Price impact: ${priceImpact ?? "—"}%`,
      ``,
      `Projected yields ($${REFERENCE_INVESTMENT_BASE} investment):`,
      `• Daily: ${fmt(daily)} → $${returnOn1k(daily)}/day`,
      `• Weekly: ${fmt(weekly)} → $${returnOn1k(weekly)}/week`,
      `• Monthly: ${fmt(monthly)} → $${returnOn1k(monthly)}/month`,
      `• APY: ${fmt(annual)} → $${returnOn1k(annual)}/year`,
    ];

    if (symbol) {
      try {
        await comment(symbol, updateLines.join("\n"));
        console.log(`Posted comment to ${symbol}.`);
      } catch (err) {
        console.error("Failed to post comment:", err);
      }
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

async function runEveryHour(): Promise<void> {
  await main();
  const delayMs = randomDelayUntilNextHour();
  const mins = Math.round(delayMs / 60_000);
  console.log(`Next run in ${mins} minutes (random time next hour).`);
  setTimeout(runEveryHour, delayMs);
}

runEveryHour();
