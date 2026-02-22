import "dotenv/config";
import { summary, buy, claimRewards, comment, getCoinInfo } from "./api.lib.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;
const ONE_MONTH_MS = (365.25 / 12) * ONE_DAY_MS;
const ONE_YEAR_MS = 365.25 * ONE_DAY_MS;

const REFERENCE_INVESTMENT_BASE = 1000;
/** Token decimals for raw→human conversion when newBalance is in smallest units and circulatingSupply is in human coins. */
const TOKEN_DECIMALS = 18;

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
  const amount = Math.min(1875, hoursLeft > 0 ? Math.floor(baseCurrencyBalance / hoursLeft) : 0);

  try {
    console.log(`Buying ${amount} of ${symbol}... (Dividing by ${hoursLeft} hours)`);
    const result = await buy(symbol, amount);
    const coinInfo = await getCoinInfo(symbol);
    const { coinsBought, totalCost, newPrice, priceImpact } = result ?? {};
    const { poolInfo } = coinInfo ?? {};
    const currentPrice = poolInfo?.currentPrice ?? newPrice;

    const c = Number(coinsBought ?? 0);
    const rawThreshold = Math.pow(10, TOKEN_DECIMALS);
    let p = Number(currentPrice ?? newPrice ?? 0);

    // Normalize price if in raw/smallest units (e.g. 10^18 per $1)
    if (p > 1e9) p = p / rawThreshold;
    // Prefer newPrice from buy (execution price) when it's sensible
    const pBuy = Number(newPrice ?? 0);
    if (pBuy > 0.0001 && pBuy < 1e6) p = pBuy;
    // Coins for display: use totalCost/price when API coins look wrong (scientific notation range)
    const totalCostNum = Number(totalCost ?? 0);
    const coinsDisplay = totalCostNum > 0 && p > 0 && (c < 0.0001 || c > 1e15)
      ? totalCostNum / p
      : c;

    const formatNum = (n: number) => (Number.isFinite(n) ? (n >= 0.0001 && n < 1e12 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : n.toFixed(4)) : "—");
    const priceImpactNum = Number(priceImpact ?? 0);
    const growthPerPeriod = Number.isFinite(priceImpactNum) ? priceImpactNum : null;

    // Scale growth: price impact is per buy; buys happen hourly, so growth is hourly
    const periodMs = ONE_HOUR_MS;
    const daily = growthPerPeriod != null ? growthPerPeriod * (ONE_DAY_MS / periodMs) : null;
    const weekly = growthPerPeriod != null ? growthPerPeriod * (ONE_WEEK_MS / periodMs) : null;
    const monthly = growthPerPeriod != null ? growthPerPeriod * (ONE_MONTH_MS / periodMs) : null;
    const annual = growthPerPeriod != null ? growthPerPeriod * (ONE_YEAR_MS / periodMs) : null;
    const fmt = (n: number | null) => (n != null && Number.isFinite(n) ? `${n.toFixed(2)}%` : "—");

    const commentText = [
      `🪙 Investment update — ${symbol}`,
      ``,
      `• Coins: ${formatNum(coinsDisplay)} @ $${formatNum(p)} ($${totalCost ?? "—"})`,
      `• 1 coin = $${formatNum(p)} | Price impact: ${fmt(growthPerPeriod)}`,
      ``,
      `Yield:`,
      `• Daily: ${fmt(daily)}`,
      `• Weekly: ${fmt(weekly)}`,
      `• Monthly: ${fmt(monthly)}`,
      `• Yearly: ${fmt(annual)}`,

    ].join("\n");

    if (symbol) {
      try {
        const reply = await comment(symbol, commentText.length <= 500 ? commentText : commentText.slice(0, 497) + "...");
        console.log("reply:", reply);
        console.log(`Posted comment to ${symbol}.`);
        console.log("comment:", commentText);
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
