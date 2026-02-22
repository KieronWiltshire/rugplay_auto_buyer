import "dotenv/config";
import { summary, buy, claimRewards } from "./api.lib.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

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

  const hoursLeft = timeRemainingMs / ONE_HOUR_MS;
  const amount = hoursLeft > 0 ? Math.floor(baseCurrencyBalance / hoursLeft) : 0;

  try {
    console.log(`Buying ${amount} of ${symbol}... (Dividing by ${hoursLeft} hours)`);
    await buy(symbol, amount);
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
