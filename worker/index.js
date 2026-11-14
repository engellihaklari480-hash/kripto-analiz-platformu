

import { McpServer } from "@modelcontextprotocol/server";

import { createMcpHandler } from "agents/mcp/server";

import { z } from "zod";

const WATCHLIST = [

  "BTCUSDT",

  "ETHUSDT",

  "SOLUSDT",

  "ADAUSDT",

  "XRPUSDT",

  "DOGEUSDT",

  "PEPEUSDT",

  "AVAXUSDT"

];

const MARKET_URLS = {

  spot: "https://api.binance.com",

  usdtm: "https://fapi.binance.com",

  coinm: "https://dapi.binance.com"

};

const PATHS = {

  spot: "/api/v3",

  usdtm: "/fapi/v1",

  coinm: "/dapi/v1"

};

async function binance(market, path, params = {}) {

  const base = MARKET_URLS[market];

  if (!base) throw new Error("Geçersiz piyasa türü.");

  const url = new URL(PATHS[market] + path, base);

  for (const [key, value] of Object.entries(params)) {

    if (value !== undefined && value !== null) {

      url.searchParams.set(key, String(value));

    }

  }

  const response = await fetch(url, {

    headers: { "Accept": "application/json" }

  });

  if (!response.ok) {

    throw new Error("Binance API hatası: " + response.status);

  }

  return response.json();

}

function result(data) {

  return {

    content: [{

      type: "text",

      text: JSON.stringify(data, null, 2)

    }]

  };

}

function ema(values, period) {

  const k = 2 / (period + 1);

  let current = values[0];

  for (let i = 1; i < values.length; i++) {

    current = values[i] * k + current * (1 - k);

  }

  return current;

}

function analyze(candles) {

  const closes = candles.map(c => Number(c[4]));

  const highs = candles.map(c => Number(c[2]));

  const lows = candles.map(c => Number(c[3]));

  const price = closes[closes.length - 1];

  const ema20 = ema(closes.slice(-20), 20);

  const ema50 = ema(closes.slice(-50), 50);

  let gains = 0;

  let losses = 0;

  for (let i = closes.length - 14; i < closes.length; i++) {

    const change = closes[i] - closes[i - 1];

    if (change > 0) gains += change;

    else losses -= change;

  }

  const avgGain = gains / 14;

  const avgLoss = losses / 14;

  const rsi = avgLoss === 0

    ? 100

    : 100 - (100 / (1 + avgGain / avgLoss));

  const macdValues = [];

  for (let i = 25; i < closes.length; i++) {

    const subset = closes.slice(0, i + 1);

    macdValues.push(

      ema(subset.slice(-12), 12) -

      ema(subset.slice(-26), 26)

    );

  }

  const macd = macdValues[macdValues.length - 1];

  const signal = ema(macdValues.slice(-9), 9);

  const recent = closes.slice(-20);

  const mean = recent.reduce((a, b) => a + b, 0) / 20;

  const variance = recent.reduce(

    (sum, value) => sum + Math.pow(value - mean, 2),

    0

  ) / 20;

  const deviation = Math.sqrt(variance);

  let trueRange = 0;

  for (let i = candles.length - 14; i < candles.length; i++) {

    const previousClose = closes[i - 1];

    trueRange += Math.max(

      highs[i] - lows[i],

      Math.abs(highs[i] - previousClose),

      Math.abs(lows[i] - previousClose)

    );

  }

  const atr = trueRange / 14;

  let score = 0;
   if (price > ema20) score++;

  else score--;

  if (ema20 > ema50) score++;

  else score--;

  if (rsi > 55) score++;

  else if (rsi < 45) score--;

  if (macd > signal) score++;

  else score--;

  let recommendation = "TUT";

  if (score >= 3) recommendation = "AL";

  if (score <= -3) recommendation = "SAT";

  return {

    price,

    rsi,

    ema20,

    ema50,

    macd,

    macdSignal: signal,

    bollingerUpper: mean + 2 * deviation,

    bollingerMiddle: mean,

    bollingerLower: mean - 2 * deviation,

    atr,

    recommendation,

    score,

    warning: "Bu teknik göstergeler yatırım tavsiyesi değildir."

  };

}

function createServer() {

  const server = new McpServer({

    name: "kripto-analiz",

    version: "1.0.0"

  });

  server.registerTool(

    "get_market_ticker",

    {

      description: "Spot, USDT-M veya COIN-M piyasasında anlık kripto fiyatı ve 24 saatlik değişimi getirir.",

      inputSchema: z.object({

        market: z.enum(["spot", "usdtm", "coinm"]),

        symbol: z.string()

      })

    },

    async ({ market, symbol }) => {

      try {

        const path = "/ticker/24hr";

        const data = await binance(market, path, {

          symbol: symbol.toUpperCase()

        });

        return result({

          piyasa: market,

          sembol: data.symbol,

          sonFiyat: data.lastPrice,

          "24SaatDegisimYuzdesi": data.priceChangePercent,

          "24SaatHacim": data.volume,

          enYuksek: data.highPrice,

          enDusuk: data.lowPrice

        });

      } catch (error) {

        return result({ hata: error.message });

      }

    }

  );

  server.registerTool(

    "get_technical_analysis",

    {

      description: "Kripto varlık için RSI, MACD, EMA, Bollinger Bantları, ATR ve AL SAT TUT değerlendirmesi yapar.",

      inputSchema: z.object({

        market: z.enum(["spot", "usdtm", "coinm"]),

        symbol: z.string(),

        interval: z.enum(["15m", "1h", "4h", "1d"]).default("1h")

      })

    },

    async ({ market, symbol, interval }) => {

      try {

        const path = "/klines";

        const candles = await binance(market, path, {

          symbol: symbol.toUpperCase(),

          interval,

          limit: 100

        });

        if (!Array.isArray(candles) || candles.length < 60) {

          throw new Error("Yeterli mum verisi alınamadı.");

        }

        return result({

          sembol: symbol.toUpperCase(),

          piyasa: market,

          zamanAraligi: interval,

          analiz: analyze(candles)

        });

      } catch (error) {

        return result({ hata: error.message });

      }

    }

  );

  server.registerTool(

    "scan_watchlist",

    {

      description: "BTC, ETH, SOL, ADA, XRP, DOGE, PEPE ve AVAX varlıklarını toplu tarar.",

      inputSchema: z.object({

        market: z.enum(["spot", "usdtm"]).default("spot")

      })

    },

    async ({ market }) => {

      const results = await Promise.all(

        WATCHLIST.map(async symbol => {

          try {

            const data = await binance(

              market,

              "/ticker/24hr",

              { symbol }

            );

            return {

              symbol,

              price: data.lastPrice,

              change24h: data.priceChangePercent,

              volume: data.volume

            };

          } catch (error) {

            return { symbol, error: error.message };

          }

        })

      );

      return result(results);

    }

  );

  server.registerTool(

    "get_usdt_try_rate",

    {

      description: "Binance üzerinden USDT/TRY fiyatını getirir.",

      inputSchema: z.object({})

    },

    async () => {

      try {

        const data = await binance(

          "spot",

          "/ticker/price",

          { symbol: "USDTTRY" }

        );

        return result({

          sembol: "USDTTRY",

          fiyat: data.price,

          aciklama: "Binance piyasa fiyatıdır."

        });

      } catch (error) {

        return result({

          hata: error.message,

          aciklama: "USDTTRY paritesi kullanılamıyor olabilir."

        });

      }

    }

  );

  return server;

}

const handler = createMcpHandler(createServer);

export default {

  fetch(request, env, ctx) {

    return handler(request, env, ctx);

  }

};
