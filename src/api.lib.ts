type HttpVerb = "GET" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE";

const BASE_URL = (process.env.BASE_URL ?? "https://rugplay.com").replace(/\/+$/, "");

export function buildHeaders(): HeadersInit {
  const cfClearance = process.env.CF_CLEARANCE ?? "";
  const sessionToken = process.env.SESSION_TOKEN ?? "";
  const userAgent = process.env.USER_AGENT ?? "Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0";

  const cookieParts: string[] = [];
  if (cfClearance) cookieParts.push(`cf_clearance=${cfClearance}`);
  if (sessionToken) cookieParts.push(`__Secure-better-auth.session_token=${sessionToken}`);
  const cookie = cookieParts.join("; ");

  return {
    "User-Agent": userAgent,
    "Accept": "/",
    "Referer": "https://rugplay.com/",
    "Content-Type": "application/json",
    "Origin": "https://rugplay.com/",
    "Connection": "keep-alive",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "DNT": "1",
    "Priority": "u=0",
    ...(cookie ? { "Cookie": cookie } : {}),
  };
}

export type ApiOptions =
  | { endpoint: string; method: "GET" | "OPTIONS" }
  | { endpoint: string; method: Exclude<HttpVerb, "GET" | "OPTIONS">; payload: unknown };

async function api(options: ApiOptions): Promise<string> {
  const { endpoint, method } = options;
  const payload = "payload" in options ? options.payload : undefined;

  const body =
    (method !== "GET" && method !== "OPTIONS" && payload !== undefined)
      ? JSON.stringify(payload)
      : undefined;

  const fullUrl = `${BASE_URL}${endpoint}`;
  console.log(`Calling... ${method} ${fullUrl}`);

  const response = await fetch(fullUrl, {
    method,
    headers: buildHeaders(),
    ...(body !== undefined ? { body } : {}),
  });

  const result = await response.json();

  console.log('Result:', result);

  if (!response.ok) {
    throw new Error(`API responded with ${response.status}: ${result}`);
  }

  return result;
}

export async function summary(): Promise<any> {
  const url = `/portfolio/summary`;
  return api({
    endpoint: url,
    method: "GET"
  });
}

/** Buy a coin: POST coin/{symbol}/trade with type BUY and amount. Returns ok and response text. */
export async function buy(symbol: string, buyAmount: number): Promise<any> {
  const url = `/coin/${symbol}/trade`;
  return api({
    endpoint: url,
    method: "POST",
    payload: { type: "BUY", amount: buyAmount },
  });
}

export async function claimRewards(): Promise<any> {
  const url = `/rewards/claim`;
  return api({
    endpoint: url,
    method: "POST",
    payload: { type: "CLAIM" },
  });
}
