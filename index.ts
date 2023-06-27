// @ts-ignore
Date.prototype.addHours = function (h: number) {
	this.setHours(this.getHours() + h);
	return this;
};

// @ts-ignore
Date.prototype.addMinutes = function (m: number) {
	this.setMinutes(this.getMinutes() + m);
	return this;
};

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

function calculateEMA(closingPrices: [number], period: number) {
	const k = 2 / (period + 1);
	let ema = closingPrices[0];
	for (let i = 1; i < closingPrices.length; i++) {
		ema = closingPrices[i] * k + ema * (1 - k);
	}
	return ema;
} // https://dev.to/onurcelik/calculate-the-exponential-moving-average-ema-with-javascript-29kp

export default {
	fetch: async (request: any, env: any, ctx: any) => {
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
		const balances = await getBalances();
		const btc = balances.filter((x: any) => x.currency === "BTC")[0].value;
		const ltc = balances.filter((x: any) => x.currency === "LTC")[0].value;
		// const ltc = balances.filter((x) => x.currency === "LTC")[0].value;
		// const matic = balances.filter((x) => x.currency === "matic")[0].value;
		return new Response(JSON.stringify({ balances: { btc, ltc } }, null, 2), {
			headers: { "Content-Type": "application/json" },
		});
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
		const balances = await getBalances();
		const ticker = "LTC";
		const base = "BTC";
		const base_balance = balances.filter((x: any) => x.currency === base)[0]
			.value;
		const ticker_balance = balances.filter((x: any) => x.currency === ticker)[0]
			.value;
		const price = await getPrice(`${ticker}-${base}`);
		const candles = await getCandles(`${ticker}-${base}`);
		const close = candles.map((candle: any) => candle[4]);
		const ema20 = calculateEMA(close, 20);
		const ema100 = calculateEMA(close, 100);
		const up = ema100 > ema20;
		let orders: any = [];
		if (ticker_balance > 0.00001) {
			orders.push(
				newOrder(
					`${ticker}-${base}`,
					"SELL",
					(parseFloat(ticker_balance) * 0.7).toFixed(5),
					(price * (1 + 0.0032702)).toFixed(6),
					60 * 2
				)
			);
		}
		if (!up) {
			orders.push(
				newOrder(
					`${ticker}-${base}`,
					"BUY",
					(await convertBaseTo(base_balance * 0.7, ticker, base)).toFixed(5),
					(price * (1 - 0.0032702)).toFixed(6),
					60 * 2
				)
			);
		}
		const result = Promise.all(orders);
		console.log(await result);
		return result;
	},
};

const hmacSha256 = (message: string, secret: string) =>
	crypto.subtle
		.importKey(
			"raw",
			new TextEncoder().encode(secret),
			{
				name: "HMAC",
				hash: { name: "SHA-256" },
			},
			false,
			["sign", "verify"]
		)
		.then((key) =>
			crypto.subtle
				.sign("HMAC", key, new TextEncoder().encode(message))
				.then((array_buffer) =>
					Array.from(new Uint8Array(array_buffer))
						.map((b) => b.toString(16).padStart(2, "0"))
						.join("")
				)
		);

const getTimestamp = () => `${Math.trunc(new Date().getTime() / 1000)}`;
const getSignature = async (
	timestamp: string,
	path: string,
	method = "",
	body = ""
) =>
	`${await hmacSha256(timestamp + method + path + body, coinbase.api.secret)}`;

const getPrice = async (ticker: string) => {
	const path = `products/${ticker}/ticker`;
	const headers = { "User-Agent": "Cloudflare" };
	const price = await fetch(coinbase.exchange.url + path, { headers })
		.then((r) => r.json())
		.then((j) => parseFloat(j.price));
	return price;
};

const getCandles = async (ticker: string) => {
	const path = `products/${ticker}/candles`;
	const headers = { "User-Agent": "Cloudflare" };
	const candles = await fetch(coinbase.exchange.url + path, { headers }).then(
		(r) => r.json()
	);
	return candles;
};

const getBalances = async () => {
	const method = "GET";
	const endpoint = "accounts";
	const path = coinbase.api.path + endpoint;
	const timestamp = getTimestamp();
	const headers = {
		"Content-Type": "application/json",
		"CB-ACCESS-KEY": coinbase.api.key,
		"CB-ACCESS-SIGN": await getSignature(timestamp, path, method),
		"CB-ACCESS-TIMESTAMP": timestamp,
	};
	return fetch(coinbase.api.url + path, { method, headers })
		.then((r) => r.json())
		.then((j) => j.accounts.map((account: any) => account.available_balance));
};

const cancelAllOrders = async () => {
	const method = "DELETE";
	const endpoint = "orders";
	const path = coinbase.api.path + endpoint;
	const timestamp = getTimestamp();
	const headers = {
		"Content-Type": "application/json",
		"CB-ACCESS-KEY": coinbase.api.key,
		"CB-ACCESS-SIGN": await getSignature(timestamp, path, method),
		"CB-ACCESS-TIMESTAMP": timestamp,
	};
	return fetch(coinbase.api.url + path, { method, headers }).then((r) =>
		r.json()
	);
};

const convertBaseTo = async (x: number, ticker: string, base: string) => {
	const price: number = await getPrice(`${ticker}-${base}`);
	return x / price;
};

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
	const body = JSON.stringify(body_params);
	const headers = {
		"Content-Type": "application/json",
		"CB-ACCESS-KEY": coinbase.api.key,
		"CB-ACCESS-SIGN": await getSignature(timestamp, path, method, body),
		"CB-ACCESS-TIMESTAMP": timestamp,
	};
	return fetch(coinbase.api.url + path, { method, headers, body }).then((r) =>
		r.json()
	);
};
