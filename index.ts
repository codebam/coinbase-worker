import hmacSHA256 from "crypto-js/hmac-sha256";

// @ts-ignore
Date.prototype.addHours = function (h) {
  this.setHours(this.getHours() + h);
  return this;
};

// @ts-ignore
Date.prototype.addMinutes = function (m) {
  this.setMinutes(this.getMinutes() + m);
  return this;
};

let btc_balance: number;
let eth_balance: number;
let matic_balance: number;

let coinbase = {
  exchange: {
    // to get tickers
    url: "https://api.exchange.coinbase.com/",
  },
  api: {
    // for using the api
    url: "https://api.coinbase.com",
    path: "/api/v3/brokerage/",
    key: "",
    secret: "",
  },
};

function calculateEMA(closingPrices, period) {
  const k = 2 / (period + 1);
  let ema = closingPrices[0];
  for (let i = 1; i < closingPrices.length; i++) {
    ema = closingPrices[i] * k + ema * (1 - k);
  }
  return ema;
} // https://dev.to/onurcelik/calculate-the-exponential-moving-average-ema-with-javascript-29kp#:~:text=To%20calculate%20the%20Exponential%20Moving,)%20*%20(1%20%E2%80%93%20k))

export default {
  fetch: async () => {
    return new Response("we runnin");
  },
  scheduled: async (event: any, env: any, ctx: any) => {
    coinbase = {
      exchange: {
        // to get tickers
        url: "https://api.exchange.coinbase.com/",
      },
      api: {
        // for using the api
        url: "https://api.coinbase.com",
        path: "/api/v3/brokerage/",
        key: env.COINBASE_API,
        secret: env.COINBASE_SECRET,
      },
    };

    console.log("running scheduled event... " + new Date().toISOString());
    getBalances();
    const eth_price = await getPrice("ETH-BTC");
    const matic_price = await getPrice("MATIC-BTC");
    let ethbtc_prices = JSON.parse(await env.COINBASE.get("ethbtc_prices"));
    let maticbtc_prices = JSON.parse(await env.COINBASE.get("maticbtc_prices"));
    ethbtc_prices = [...ethbtc_prices.slice(0, 99), eth_price];
    maticbtc_prices = [...maticbtc_prices.slice(0, 99), matic_price];
    const eth_ema = calculateEMA(ethbtc_prices, ethbtc_prices.length);
    const matic_ema = calculateEMA(maticbtc_prices, maticbtc_prices.length);
    env.COINBASE.put("ethbtc_prices", JSON.stringify(ethbtc_prices));
    env.COINBASE.put("maticbtc_prices", JSON.stringify(maticbtc_prices));

    const buy_eth = await newOrder(
      "ETH-BTC",
      "BUY",
      "0.1",
      `${(eth_price - eth_ema * 0.0004).toFixed(5)}`,
      15
    ).then(console.log);
    const sell_eth = await newOrder(
      "ETH-BTC",
      "SELL",
      "0.05",
      `${(eth_price + eth_ema * 0.0004).toFixed(5)}`,
      15
    ).then(console.log);
    const buy_matic = await newOrder(
      "MATIC-BTC",
      "BUY",
      `135`,
      `${(matic_price - matic_ema * 0.0004).toFixed(8)}`,
      15
    ).then(console.log);
    const sell_matic = await newOrder(
      "MATIC-BTC",
      "SELL",
      `135`,
      `${(matic_price + matic_ema * 0.0004).toFixed(8)}`,
      15
    ).then(console.log);
    return [buy_eth, sell_eth, buy_matic, sell_matic];
  },
};

const getTimestamp = () => `${Math.trunc(new Date().getTime() / 1000)}`;
const getSignature = (
  timestamp: string,
  path: string,
  method = "",
  body = ""
) => `${hmacSHA256(timestamp + method + path + body, coinbase.api.secret)}`;

const getPrice = async (ticker: string) => {
  const path = `products/${ticker}/ticker`;
  const headers = { "User-Agent": "Cloudflare" };
  console.log(coinbase.exchange.url + path);
  const price = await fetch(coinbase.exchange.url + path, { headers })
    .then((r) => r.json())
    .then((j) => parseFloat(j.price));
  return price;
};

const _getBalances = async () => {
  const method = "GET";
  const endpoint = "accounts";
  const path = coinbase.api.path + endpoint;
  const timestamp = getTimestamp();
  const headers = {
    "Content-Type": "application/json",
    "CB-ACCESS-KEY": coinbase.api.key,
    "CB-ACCESS-SIGN": getSignature(timestamp, path, method),
    "CB-ACCESS-TIMESTAMP": timestamp,
  };
  return fetch(coinbase.api.url + path, { method, headers }).then((t) =>
    t.json()
  );
};

const getBalances = () =>
  _getBalances().then((b) => {
    const balances = b.accounts.map((x) => x.available_balance);
    btc_balance = balances.filter((b) => b.currency === "BTC")[0].value;
    eth_balance = balances.filter((b) => b.currency === "ETH")[0].value;
    matic_balance = balances.filter((b) => b.currency === "MATIC")[0].value;
  });

const newOrder = async (
  product_id: string,
  side: "BUY" | "SELL",
  size: string,
  price: string,
  end_time = 3
) => {
  const method = "POST";
  const path = coinbase.api.path + "orders";
  const timestamp = getTimestamp();
  const body_params = {
    // @ts-ignore
    client_order_id: crypto.randomUUID(),
    product_id,
    side,
    order_configuration: {
      limit_limit_gtd: {
        base_size: size,
        limit_price: price,
        // @ts-ignore
        end_time: new Date().addMinutes(end_time),
        post_only: true,
      },
    },
  };

  console.log(body_params);
  const body = JSON.stringify(body_params);
  const headers = {
    "Content-Type": "application/json",
    "CB-ACCESS-KEY": coinbase.api.key,
    "CB-ACCESS-SIGN": getSignature(timestamp, path, method, body),
    "CB-ACCESS-TIMESTAMP": timestamp,
  };
  return fetch(coinbase.api.url + path, { method, headers, body }).then((r) =>
    r.json()
  );
};
