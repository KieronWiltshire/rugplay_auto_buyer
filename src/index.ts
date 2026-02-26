import "dotenv/config";
import { summary, buy, claimRewards, comment, getCoinInfo, coinFlip, transfer } from "./api.lib.js";
import * as fs from "fs";
import * as path from "path";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;
const ONE_MONTH_MS = (365.25 / 12) * ONE_DAY_MS;
const ONE_YEAR_MS = 365.25 * ONE_DAY_MS;

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

async function main(gamble: boolean = false, buy: boolean = true): Promise<void> {
  let baseCurrencyBalance = 0;

  try {
    console.log(`Getting portfolio summary...`);
    const portfolio = await summary();

    baseCurrencyBalance = portfolio.baseCurrencyBalance;
  } catch (error) {
    console.error(error);
  }

  if (gamble) {
    await processGamble(baseCurrencyBalance);
  } else {
    if (buy) {
      await processBuy(baseCurrencyBalance);
    } else {
      await processRewards();
    }
  }
}

async function processGamble(baseCurrencyBalance: number) { 
  const maxMartingale = 9; 
  let currentBaseBalance = baseCurrencyBalance;
  
  let startAmount = Math.min(1800, Math.max((currentBaseBalance / (2 ** maxMartingale)) / 2, 10)); 
  let stopLoss = startAmount * (2 ** maxMartingale); 
  let betSize = startAmount; 
  let lossStreak = 0;
  let winStreak = 0;
  let borrowedAmount = 20_000;
  let hasBeenPaid = false;

  console.log("Starting Balance:", `$${currentBaseBalance.toFixed(2)}`); 
  console.log("Starting Stop Loss:", `$${stopLoss.toFixed(2)}`); 
  console.log("Starting Bet:", `$${startAmount}`); 
  
  const flip = async function () {
    let wasPaid = false;
    try {
      console.log("Bet Size:", `$${betSize.toFixed(2)}`);
      const result = await coinFlip("heads", betSize); 
      console.log("New Balance:", `$${result.newBalance.toFixed(2)}`); 

      if (result.won) {
        if (!hasBeenPaid && result.newBalance > borrowedAmount * 2.5) {
          await transfer("maze", borrowedAmount);
          hasBeenPaid = true;
          wasPaid = true;
          fs.writeFileSync(path.join(__dirname, "hasBeenPaid.txt"), "true");
        }
        if (result.payout * 2 > startAmount * (2 ** 3)) {
          betSize = startAmount;
        } else {
          if (winStreak > 2) {
            betSize = result.payout * 4;
          } else {
            betSize = startAmount;
          }
        }
        lossStreak = 0; 
        winStreak++;
      } else { 
        winStreak = 0;
        lossStreak++; 
        if (lossStreak > 1) { 
          betSize *= 2; 
        } 
      } 

      if (result.newBalance > currentBaseBalance + (Math.max(1875, Number(process.env.MAX_BUY_AMOUNT ?? 0)) * 2)) { 
        const buyResult = await processBuy(result.newBalance, false); 
        currentBaseBalance = wasPaid ? buyResult.newBalance - borrowedAmount : buyResult.newBalance;
        startAmount = Math.min(1800, Math.max((currentBaseBalance / (2 ** maxMartingale)) / 2, 10)); 
        stopLoss = startAmount * (2 ** maxMartingale); 
        betSize = startAmount; 
        lossStreak = 0;
      } 
      
      if (betSize <= stopLoss && betSize <= result.newBalance) {
        setTimeout(flip, 1500); 
      } else {
        startAmount = Math.min(1800, Math.max((currentBaseBalance / (2 ** maxMartingale)) / 2, 10)); 
        stopLoss = startAmount * (2 ** maxMartingale); 
        betSize = startAmount; 
        lossStreak = 0; 
        setTimeout(flip, 1500); 
      }
    } catch (error) {
      console.log('Server error, possibly a 502. Retrying in 5 seconds...');
      setTimeout(flip, 5000);
    }
  } 
    
  flip(); 
}

async function processRewards() {
  try {
    console.log(`Claiming rewards...`);
    const rewards = await claimRewards();
    if (rewards?.timeRemaining != null) {
      return Number(rewards.timeRemaining);
    }
  } catch (error) {
    console.error(error);
  }

  return 12 * ONE_HOUR_MS;
}

async function processBuy(baseCurrencyBalance: number, provideComment: boolean = true) {
  const symbol = process.env.BUY_SYMBOL ?? "";
  let timeRemainingMs = await processRewards();

  console.log(`Time remaining: ${timeRemainingMs}ms until rewards are claimed. Equivalent to ${timeRemainingMs / ONE_HOUR_MS} hours.`);

  const hoursLeft = Math.max(timeRemainingMs / ONE_HOUR_MS, 1);
  const amount = Math.min(Math.max(1875, Number(process.env.MAX_BUY_AMOUNT ?? 0)), hoursLeft > 0 ? Math.floor(baseCurrencyBalance / hoursLeft) : 0);

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

    if (symbol && provideComment) {
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

      try {
        const reply = await comment(symbol, commentText.length <= 500 ? commentText : commentText.slice(0, 497) + "...");
        console.log("reply:", reply);
        console.log(`Posted comment to ${symbol}.`);
        console.log("comment:", commentText);
      } catch (err) {
        console.error("Failed to post comment:", err);
      }
    }

    return result;
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

async function runEveryHour(): Promise<void> {
  await main(false);
  const delayMs = randomDelayUntilNextHour();
  const mins = Math.round(delayMs / 60_000);
  console.log(`Next run in ${mins} minutes (random time next hour).`);
  setTimeout(runEveryHour, delayMs);
}

const runScheduled = process.argv.includes("--every-hour") || process.argv.includes("--schedule");
const gamble = process.argv.includes("--gamble");
const buyEnabled = process.argv.includes("--enable-buy") || process.env.BUY_ENABLED === "true";


if (runScheduled && !gamble) {
  runEveryHour();
} else {
  main(gamble, buyEnabled).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
