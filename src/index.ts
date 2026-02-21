import "dotenv/config";
import { buy, claimRewards } from "./api.lib.js";

async function main(): Promise<void> {
  try {
    await claimRewards();
    const symbol = process.env.BUY_SYMBOL ?? "";
    const amount = Number(process.env.BUY_AMOUNT ?? "0");

    await buy(symbol, amount);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
