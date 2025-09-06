import { ethers } from "ethers";

// ===== Configurable via environment variables =====
const RPC_URL = process.env.RPC_URL || "https://soneium-rpc.publicnode.com";
const PRIV_KEY = process.env.PRIV_KEY; // Required
const MIN_ETH = parseFloat(process.env.MIN_ETH || "0.000001"); // Minimum random amount (in ETH)
const MAX_ETH = parseFloat(process.env.MAX_ETH || "0.00002");  // Maximum random amount (in ETH)
const MIN_TXS_PER_DAY = parseInt(process.env.MIN_TXS_PER_DAY || "2", 10);
const MAX_TXS_PER_DAY = parseInt(process.env.MAX_TXS_PER_DAY || "3", 10);
const WAIT_CONFIRMATIONS = parseInt(process.env.WAIT_CONF || "1", 10);

// For logging purposes only
function now() {
  return new Date().toISOString();
}

// Random utility functions
function randInt(min, max) { // [min, max] integers
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}
function randomAmountEth() {
  const v = randFloat(MIN_ETH, MAX_ETH);
  // Keep 8 decimal places to avoid parseEther failures with very long decimals
  return Number(v).toFixed(8);
}

// Generate random trigger times for "today" (local timezone)
function scheduleForToday() {
  const n = randInt(MIN_TXS_PER_DAY, MAX_TXS_PER_DAY);
  const start = new Date();
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const startMs = start.getTime();
  const endMs = end.getTime();

  const times = [];
  for (let i = 0; i < n; i++) {
    const t = randInt(startMs + 60_000, endMs); // Delay at least 60s to avoid overlap with startup transaction
    times.push(new Date(t));
  }
  times.sort((a, b) => a - b);
  return times;
}

// Calculate milliseconds until the next scheduled time
function msUntil(date) {
  return Math.max(0, date.getTime() - Date.now());
}

async function main() {
  if (!PRIV_KEY) {
    console.error(`[${now()}] ERROR: PRIV_KEY is required (put it in .env).`);
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIV_KEY, provider);
  console.log(`[${now()}] Wallet address: ${wallet.address}`);

  // Get chainId for logging purposes only
  try {
    const net = await provider.getNetwork();
    console.log(`[${now()}] Connected to chainId=${net.chainId} via ${RPC_URL}`);
  } catch (e) {
    console.warn(`[${now()}] WARN: getNetwork failed, will still try to send tx.`, e.message);
  }

  // Send an initial transaction to confirm setup
  await safeSendSelfTx(wallet);

  // Generate today's random schedule
  let todayPlan = scheduleForToday();
  console.log(`[${now()}] Today's schedule (${todayPlan.length} tx):`, todayPlan.map(d => d.toLocaleString()));

  // Scheduling loop
  while (true) {
    // If schedule is empty or day has changed, generate a new schedule
    const nowDate = new Date();
    if (!todayPlan.length || (todayPlan[0].getDate() !== nowDate.getDate())) {
      todayPlan = scheduleForToday();
      console.log(`[${now()}] New day's schedule (${todayPlan.length} tx):`, todayPlan.map(d => d.toLocaleString()));
    }

    const next = todayPlan.shift();
    const waitMs = msUntil(next);
    console.log(`[${now()}] Next tx at ${next.toLocaleString()} (in ${(waitMs / 1000).toFixed(0)}s)`);
    // Sleep until scheduled time (wrap setTimeout in a Promise)
    await new Promise(res => setTimeout(res, waitMs));

    await safeSendSelfTx(wallet);
    // Add random jitter delay to avoid exact timing patterns
    await new Promise(res => setTimeout(res, randInt(5_000, 25_000)));
  }
}

async function safeSendSelfTx(wallet) {
  const provider = wallet.provider;
  const amountEth = randomAmountEth();

  try {
    const addr = await wallet.getAddress();
    const feeData = await provider.getFeeData();

    // Prepare basic transaction
    const txReq = {
      to: addr,
      value: ethers.parseEther(amountEth)
    };

    // Estimate gas limit
    let gasLimit;
    try {
      gasLimit = await provider.estimateGas({ ...txReq, from: addr });
    } catch (e) {
      console.warn(`[${now()}] estimateGas failed, fallback to 21000.`, e.message);
      gasLimit = 21000n;
    }

    // Handle EIP-1559 / Legacy fee compatibility
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      txReq.maxFeePerGas = feeData.maxFeePerGas;
      txReq.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    } else if (feeData.gasPrice) {
      txReq.gasPrice = feeData.gasPrice;
    }

    txReq.gasLimit = gasLimit;

    // Send transaction
    const tx = await wallet.sendTransaction(txReq);
    console.log(`[${now()}] Sent self-transfer: amount=${amountEth} ETH, hash=${tx.hash}`);
    const rec = await tx.wait(WAIT_CONFIRMATIONS);
    if (rec && rec.status === 1n) {
      console.log(`[${now()}] Confirmed in block ${rec.blockNumber}.`);
    } else {
      console.warn(`[${now()}] Tx mined but status != 1 (possibly failed).`);
    }
  } catch (err) {
    console.error(`[${now()}] ERROR sending self-transfer:`, err?.message || err);
    // Simple backoff and retry (to avoid getting stuck): random 10-40s
    const backoff = randInt(10_000, 40_000);
    await new Promise(res => setTimeout(res, backoff));
  }
}

main().catch((e) => {
  console.error(`[${now()}] FATAL:`, e);
  process.exit(1);
});
