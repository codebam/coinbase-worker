// @ts-ignore
Date.prototype.addMinutes = function (m: number) {
	this.setMinutes(this.getMinutes() + m);
	return this;
};

let coinbase = {
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
		return new Response(JSON.stringify({ balances: { btc, ltc } }, null, 2), {
			headers: { "Content-Type": "application/json" },
		});
	},
	scheduled: async (event: any, env: any, ctx: any) => {
		coinbase = {
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
		const close = candles.candles.map((candle: any) => candle.close);
		const ema20 = calculateEMA(close, 20);
		const ema100 = calculateEMA(close, 100);
		const up = ema100 > ema20;
		let orders: any = [];
		if (ticker_balance > 0.00001) {
			orders.push(
				newOrder(
					`${ticker}-${base}`,
					"SELL",
					(parseFloat(ticker_balance) * 0.3).toFixed(5),
					(price * (1 + 0.0007702)).toFixed(6),
					60 * 2
				)
			);
		}
		if (!up) {
			orders.push(
				newOrder(
					`${ticker}-${base}`,
					"BUY",
					(await convertBaseTo(base_balance * 0.3, ticker, base)).toFixed(5),
					(price * (1 - 0.0007702)).toFixed(6),
					60 * 2
				)
			);
		}
		const result = Promise.allSettled(orders).then(async (r) => {
			if (r.filter((p) => p.status === "rejected").length > 1)
				listOpenOrders()
					.then((orders) => orders.orders.map((order: any) => order.order_id))
					.then(cancelOrders)
					.then(console.log);
			return r;
		});
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
	const method = "GET";
	const path = coinbase.api.path + `products/${ticker}`;
	const timestamp = getTimestamp();
	const headers = {
		"Content-Type": "application/json",
		"CB-ACCESS-KEY": coinbase.api.key,
		"CB-ACCESS-SIGN": await getSignature(timestamp, path, method),
		"CB-ACCESS-TIMESTAMP": timestamp,
	};
	const price = await fetch(coinbase.api.url + path, { headers })
		.then((r) => r.json())
		.then((j) => parseFloat(j.price));
	return price;
};

const getCandles = async (ticker: string) => {
	const method = "GET";
	const start = Math.floor((Date.now() - 36000000) / 1000);
	const end = Math.floor(Date.now() / 1000);
	const path = coinbase.api.path + `products/${ticker}/candles`;
	const url = new URL(coinbase.api.url + path);
	url.searchParams.set("start", start.toString());
	url.searchParams.set("end", end.toString());
	url.searchParams.set("granularity", "FIVE_MINUTE");
	const timestamp = getTimestamp();
	const headers = {
		"Content-Type": "application/json",
		"CB-ACCESS-KEY": coinbase.api.key,
		"CB-ACCESS-SIGN": await getSignature(timestamp, path, method),
		"CB-ACCESS-TIMESTAMP": timestamp,
	};
	const candles = await fetch(url, { headers }).then((r) => r.json());
	return candles;
};

const listFills = async () => {
	const method = "GET";
	const path = coinbase.api.path + `orders/historical/fills`;
	const url = new URL(coinbase.api.url + path);
	const timestamp = getTimestamp();
	const headers = {
		"Content-Type": "application/json",
		"CB-ACCESS-KEY": coinbase.api.key,
		"CB-ACCESS-SIGN": await getSignature(timestamp, path, method),
		"CB-ACCESS-TIMESTAMP": timestamp,
	};
	const orders = await fetch(url, { headers }).then((r) => r.json());
	return orders;
};

const listOpenOrders = async () => {
	const method = "GET";
	const path = coinbase.api.path + `orders/historical/batch`;
	const url = new URL(coinbase.api.url + path);
	url.searchParams.set("order_status", ["OPEN"].toString());
	const timestamp = getTimestamp();
	const headers = {
		"Content-Type": "application/json",
		"CB-ACCESS-KEY": coinbase.api.key,
		"CB-ACCESS-SIGN": await getSignature(timestamp, path, method),
		"CB-ACCESS-TIMESTAMP": timestamp,
	};
	const orders = await fetch(url, { headers }).then((r) => r.json());
	return orders;
};

const cancelOrders = async (order_ids) => {
	const method = "POST";
	const path = coinbase.api.path + `orders/batch_cancel`;
	const url = new URL(coinbase.api.url + path);
	const body = JSON.stringify({ order_ids: order_ids });
	console.log(body);
	const timestamp = getTimestamp();
	const headers = {
		"Content-Type": "application/json",
		"CB-ACCESS-KEY": coinbase.api.key,
		"CB-ACCESS-SIGN": await getSignature(timestamp, path, method, body),
		"CB-ACCESS-TIMESTAMP": timestamp,
	};
	const result = await fetch(url, { method, headers, body }).then((r) =>
		r.json()
	);
	return result;
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
	const result = fetch(coinbase.api.url + path, { method, headers, body }).then(
		(r) => r.json()
	);
	return new Promise(async (resolve, reject) => {
		if (
			(await result).error_response.preview_failure_reason ===
			"PREVIEW_INVALID_BASE_SIZE_TOO_SMALL"
		)
			reject();
		resolve(result);
	});
};

listOpenOrders()
	.then((orders) => orders.orders.map((order) => order.order_id))
	.then(cancelOrders)
	.then(console.log);
