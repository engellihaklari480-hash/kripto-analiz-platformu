

import { McpServer } from "@modelcontextprotocol/server";

import { createMcpHandler } from "agents/mcp/server";

import { z } from "zod";

const BYBIT_URL = "https://api.bybit.com";

const OKX_URL = "https://www.okx.com";

const MARKETS = {

  spot: "spot",

  usdtm: "linear",

  coinm: "inverse"

};

const INTERVALS = {

  "15m": { value: "15", ms: 900000 },

  "1h": { value: "60", ms: 3600000 },

  "4h": { value: "240", ms: 14400000 },

  "1d": { value: "D", ms: 86400000 },

  "1w": { value: "W", ms: 604800000 }

};

async function requestJson(url, source) {

  const response = await fetch(url, {

    headers: {

      Accept: "application/json"

    }

  });

  if (!response.ok) {

    throw new Error(source + " HTTP hatası: " + response.status);

  }

  const data = await response.json();

  if (source === "Bybit" && data.retCode !== 0) {

    throw new Error("Bybit: " + data.retMsg);

  }

  if (source === "OKX" && data.code !== "0") {

    throw new Error("OKX: " + data.msg);
   }

  return data;

}

function makeUrl(base, path, params) {

  const url = new URL(path, base);

  for (const [key, value] of Object.entries(params || {})) {

    if (value !== undefined && value !== null && value !== "") {

      url.searchParams.set(key, String(value));

    }

  }

  return url.toString();

}

async function bybit(path, params) {

  return requestJson(

    makeUrl(BYBIT_URL, path, params),

    "Bybit"

  );

}

async function okx(path, params) {

  return requestJson(

    makeUrl(OKX_URL, path, params),

    "OKX"

  );

}

function toolResult(data) {

  return {

    content: [

      {

        type: "text",

        text: JSON.stringify(data, null, 2)

      }

    ]

  };

}

function getFreshness(timestamp) {

  const time = Number(timestamp || 0);

  const age = time > 0 ? Date.now() - time : null;

  return {

    zamanDamgasi: time || null,

    veriYasiSaniye: age === null ? null : Math.max(0, Math.round(age / 1000)),

    bayat: age === null || age > 120000

  };

}

function getOkxInstrument(market, symbol) {

  const value = symbol.toUpperCase();

  if (market === "spot" && value.endsWith("USDT")) {

    return value.slice(0, -4) + "-USDT";

  }

  if (market === "usdtm" && value.endsWith("USDT")) {

    return value.slice(0, -4) + "-USDT-SWAP";

  }

  if (market === "coinm" && value.endsWith("USD")) {

    return value.slice(0, -3) + "-USD-SWAP";

  }

  return null;

}

async function getBybitTicker(market, symbol) {

  const category = MARKETS[market];

  if (!category) {

    throw new Error("Geçersiz piyasa türü.");

  }

  const data = await bybit("/v5/market/tickers", {

    category,

    symbol

  });

  const ticker = data.result?.list?.[0];

  if (!ticker) {

    throw new Error("Bybit bu sembol için veri döndürmedi.");

  }

  return {

    ticker,

    serverTime: Number(data.time || Date.now())

  };

}

async function getOkxTicker(market, symbol) {

  const instId = getOkxInstrument(market, symbol);

  if (!instId) {

    throw new Error("OKX paritesi eşleştirilemedi.");

  }

  const data = await okx("/api/v5/market/ticker", {

    instId

  });

  const ticker = data.data?.[0];

  if (!ticker) {

    throw new Error("OKX veri döndürmedi.");

  }

  return ticker;

}

function emaSeries(values, period) {

  const output = new Array(values.length).fill(null);

  if (values.length < period) {

    return output;

  }

  let sum = 0;

  for (let i = 0; i < period; i++) {

    sum += values[i];

  }

  let current = sum / period;

  output[period - 1] = current;

  const multiplier = 2 / (period + 1);

  for (let i = period; i < values.length; i++) {

    current =

      values[i] * multiplier +

      current * (1 - multiplier);

    output[i] = current;

  }

  return output;

}

function rsiWilder(values, period = 14) {

  if (values.length <= period) {

    return null;

  }

  let gains = 0;

  let losses = 0;

  for (let i = 1; i <= period; i++) {

    const change = values[i] - values[i - 1];

    if (change > 0) {

      gains += change;

    } else {

      losses -= change;

    }

  }

  let averageGain = gains / period;

  let averageLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {

    const change = values[i] - values[i - 1];

    averageGain =

      (averageGain * (period - 1) + Math.max(change, 0)) /

      period;

    averageLoss =

      (averageLoss * (period - 1) + Math.max(-change, 0)) /

      period;

  }

  if (averageLoss === 0) {

    return 100;

  }

  const relativeStrength = averageGain / averageLoss;

  return 100 - 100 / (1 + relativeStrength);

}

function calculateMacd(values) {

  const fast = emaSeries(values, 12);

  const slow = emaSeries(values, 26);

  const macdValues = [];

  for (let i = 0; i < values.length; i++) {

    if (fast[i] !== null && slow[i] !== null) {

      macdValues.push(fast[i] - slow[i]);

    }

  }

  const signalValues = emaSeries(macdValues, 9);

  return {

    macd: macdValues.length

      ? macdValues[macdValues.length - 1]

      : null,

    signal: signalValues.length

      ? signalValues[signalValues.length - 1]

      : null

  };

}

function calculateAnalysis(rows) {

  const candles = rows.map(row => ({

    time: Number(row[0]),

    open: Number(row[1]),

    high: Number(row[2]),

    low: Number(row[3]),

    close: Number(row[4]),

    volume: Number(row[5])

  })).reverse();

  const closes = candles.map(c => c.close);

  const highs = candles.map(c => c.high);

  const lows = candles.map(c => c.low);

  const lastPrice = closes[closes.length - 1];

  const ema20Values = emaSeries(closes, 20);

  const ema50Values = emaSeries(closes, 50);

  const ema20 = ema20Values[ema20Values.length - 1];

  const ema50 = ema50Values[ema50Values.length - 1];

  const rsi = rsiWilder(closes, 14);

  const macd = calculateMacd(closes);

  const recent = closes.slice(-20);

  const average =

    recent.reduce((sum, value) => sum + value, 0) /

    recent.length;

  const variance =

    recent.reduce(

      (sum, value) => sum + Math.pow(value - average, 2),

      0

    ) / recent.length;

  const deviation = Math.sqrt(variance);

  let trueRangeSum = 0;

  for (let i = candles.length - 14; i < candles.length; i++) {

    const previousClose = closes[i - 1];

    const trueRange = Math.max(

      highs[i] - lows[i],

      Math.abs(highs[i] - previousClose),

      Math.abs(lows[i] - previousClose)

    );

    trueRangeSum += trueRange;

  }

  const atr14 = trueRangeSum / 14;

  let score = 0;

  if (lastPrice > ema20) {

    score++;

  } else {

    score--;

  }

  if (ema20 > ema50) {

    score++;

  } else {

    score--;

  }

  if (rsi > 55) {

    score++;

  } else if (rsi < 45) {

    score--;

  }

  if (macd.macd > macd.signal) {

    score++;

  } else {

    score--;

  }

  let signal = "TUT";

  if (score >= 3) {

    signal = "AL";

  }

  if (score <= -3) {

    signal = "SAT";

  }

  return {

    mumSayisi: candles.length,

    sonKapanmisMumZamani: candles[candles.length - 1].time,

    sonFiyat: lastPrice,

    rsi14: rsi,

    ema20,

    ema50,

    macd: macd.macd,

    macdSinyal: macd.signal,

    bollinger: {

      ust: average + 2 * deviation,

      orta: average,

      alt: average - 2 * deviation

    },

    atr14,

    puan: score,

    sinyal: signal

  };

}

function createServer() {

  const server = new McpServer({

    name: "kripto-analiz",

    version: "2.0.0"

  });

  server.registerTool(

    "health_check",

    {

      description:

        "Bybit ve OKX herkese açık piyasa veri bağlantılarını BTCUSDT üzerinden test eder.",

      inputSchema: z.object({})

    },

    async () => {

      const checks = await Promise.allSettled([

        getBybitTicker("spot", "BTCUSDT"),

        getOkxTicker("spot", "BTCUSDT")

      ]);

      return toolResult({

        bybit:

          checks[0].status === "fulfilled"

            ? {

                durum: "çalışıyor",

                fiyat: checks[0].value.ticker.lastPrice

              }

            : {

                durum: "hata",

                hata: checks[0].reason.message

              },

        okx:

          checks[1].status === "fulfilled"

            ? {

                durum: "çalışıyor",

                fiyat: checks[1].value.last

              }

            : {

                durum: "hata",

                hata: checks[1].reason.message

              }

      });

    }

  );

  server.registerTool(

    "get_market_ticker",

    {

      description:

        "Bybit Spot, USDT-M veya COIN-M fiyatını getirir ve eşleşen OKX paritesiyle karşılaştırır.",

      inputSchema: z.object({

        market: z.enum(["spot", "usdtm", "coinm"]),

        symbol: z.string().min(2).max(40)

      })

    },

    async ({ market, symbol }) => {

      try {

        const normalized = symbol.toUpperCase().trim();

        const primary = await getBybitTicker(

          market,

          normalized

        );

        let secondary = null;

        let comparisonError = null;

        try {

          secondary = await getOkxTicker(

            market,

            normalized

          );

        } catch (error) {

          comparisonError = error.message;

        }

        const primaryPrice = Number(

          primary.ticker.lastPrice

        );

        const secondaryPrice = secondary

          ? Number(secondary.last)

          : null;

        const difference =

          secondaryPrice && primaryPrice

            ? ((secondaryPrice - primaryPrice) / primaryPrice) * 100

            : null;

        return toolResult({

          piyasa: market,

          sembol: normalized,

          anaKaynak: {

            ad: "Bybit",

            sonFiyat: primary.ticker.lastPrice,

            degisim24SaatYuzde:

              Number(primary.ticker.price24hPcnt || 0) * 100,

            hacim24Saat: primary.ticker.volume24h,

            islemHacmi24Saat: primary.ticker.turnover24h,

            markPrice: primary.ticker.markPrice || null,

            indexPrice: primary.ticker.indexPrice || null,

            openInterest: primary.ticker.openInterest || null,

            fundingRate: primary.ticker.fundingRate || null,

            veriDurumu: getFreshness(primary.serverTime)

          },

          karsilastirmaKaynak: secondary

            ? {

                ad: "OKX",

                parite: secondary.instId,

                sonFiyat: secondary.last,

                veriDurumu: getFreshness(secondary.ts)

              }

            : {

                ad: "OKX",

                durum: "karşılaştırma alınamadı",

                hata: comparisonError

              },

          kaynakFiyatFarkiYuzde:

            difference === null

              ? null

              : Number(difference.toFixed(5)),

          not:

            "Borsa fiyatları farklı olabilir. Bu fark tek başına veri hatası anlamına gelmez."

        });

      } catch (error) {

        return toolResult({

          hata: error.message,

          sinyal: "SİNYAL YOK"

        });

      }

    }

  );

  server.registerTool(

    "get_technical_analysis",

    {

      description:

        "Bybit kapanmış mumlarından RSI, MACD, EMA, Bollinger ve ATR hesaplar.",

      inputSchema: z.object({

        market: z.enum(["spot", "usdtm", "coinm"]),

        symbol: z.string().min(2).max(40),

        interval: z.enum(["15m", "1h", "4h", "1d", "1w"]).default("1h")

      })

    },

    async ({ market, symbol, interval }) => {

      try {

        const normalized = symbol.toUpperCase();

        const period = INTERVALS[interval];

        const data = await bybit("/v5/market/kline", {

          category: MARKETS[market],

          symbol: normalized,

          interval: period.value,

          limit: 200

        });

        const rows = data.result?.list;

        if (!Array.isArray(rows)) {

          throw new Error("Mum verisi alınamadı.");

        }

        const closedRows = rows.filter(

          row => Number(row[0]) + period.ms <= Date.now()

        );

        if (closedRows.length < 60) {

          throw new Error(

            "En az 60 kapanmış mum bulunamadı."

          );

        }

        const analysis = calculateAnalysis(closedRows);

        const candleCloseTime =

          analysis.sonKapanmisMumZamani + period.ms;

        const stale =

          Date.now() - candleCloseTime > period.ms * 2;

        if (stale) {

          analysis.sinyal = "SİNYAL YOK";

          analysis.sinyalNedeni =

            "Mum verisi beklenenden eski.";

        }

        return toolResult({

          sembol: normalized,

          piyasa: market,

          zamanDilimi: interval,

          kaynak: "Bybit",

          analiz: analysis,

          veriBayat: stale,

          uyari:

            "Teknik göstergeler yatırım tavsiyesi değildir. Bu ilk sürümdeki AL/SAT/TUT değerlendirmesi tek başına işlem kararı için kullanılmamalıdır."

        });

      } catch (error) {

        return toolResult({

          hata: error.message,

          sinyal: "SİNYAL YOK"

        });

      }

    }

  );

  server.registerTool(

    "get_derivatives_snapshot",

    {

      description:

        "Bybit USDT-M veya COIN-M sözleşmesinin mark/index fiyatı, açık pozisyon ve fonlama verilerini getirir.",

      inputSchema: z.object({

        market: z.enum(["usdtm", "coinm"]),

        symbol: z.string().min(2).max(40)

      })

    },

    async ({ market, symbol }) => {

      try {

        const data = await getBybitTicker(

          market,

          symbol.toUpperCase()

        );

        const ticker = data.ticker;

        return toolResult({

          kaynak: "Bybit",

          piyasa: market,

          sembol: symbol.toUpperCase(),

          sonFiyat: ticker.lastPrice,

          markPrice: ticker.markPrice,

          indexPrice: ticker.indexPrice,

          openInterest: ticker.openInterest,

          openInterestValue: ticker.openInterestValue,

          fundingRate: ticker.fundingRate,

          nextFundingTime: ticker.nextFundingTime,

          hacim24Saat: ticker.volume24h,

          islemHacmi24Saat: ticker.turnover24h,

          veriDurumu: getFreshness(data.serverTime),

          uyari:

            "COIN-M ve USDT-M verilerinin birimleri farklı olabilir. Hacim ve açık pozisyon değerleri birim kontrolü yapılmadan doğrudan karşılaştırılmamalıdır."

        });

      } catch (error) {

        return toolResult({

          hata: error.message

        });

      }

    }

  );

  server.registerTool(

    "scan_market_universe",

    {

      description:

        "Bybit Spot USDT paritelerini işlem hacmine göre tarar. Aynı coin için varsa USDT-M ve COIN-M sözleşmelerini eşleştirir. En fazla 500 coin döndürür.",

      inputSchema: z.object({

        limit: z.number().int().min(1).max(500).default(500),

        minTurnover24h: z.number().min(0).default(0)

      })

    },

    async ({ limit, minTurnover24h }) => {

      try {

        const [spotData, linearData, inverseData] =

          await Promise.all([

            bybit("/v5/market/tickers", {

              category: "spot"

            }),

            bybit("/v5/market/tickers", {

              category: "linear"

            }),

            bybit("/v5/market/tickers", {

              category: "inverse"

            })

          ]);

        const spotList = spotData.result?.list || [];

        const linearList = linearData.result?.list || [];

        const inverseList = inverseData.result?.list || [];

        const spot = spotList

          .filter(t => t.symbol.endsWith("USDT"))

          .filter(

            t =>

              Number(t.turnover24h || 0) >= minTurnover24h

          )

          .sort(

            (a, b) =>

              Number(b.turnover24h || 0) -

              Number(a.turnover24h || 0)

          )

          .slice(0, limit);

        const linearMap = new Map();

        for (const ticker of linearList) {

          if (ticker.symbol.endsWith("USDT")) {

            const base = ticker.symbol.slice(0, -4);

            if (!linearMap.has(base)) {

              linearMap.set(base, ticker);

            }

          }

        }

        const inverseMap = new Map();

        for (const ticker of inverseList) {

          if (ticker.symbol.endsWith("USD")) {

            const base = ticker.symbol.slice(0, -3);

            if (!inverseMap.has(base)) {

              inverseMap.set(base, ticker);

            }

          }

        }

        const assets = spot.map(ticker => {

          const base = ticker.symbol.slice(0, -4);

          const linear = linearMap.get(base);

          const inverse = inverseMap.get(base);

          return {

            varlik: base,

            spot: {

              sembol: ticker.symbol,

              fiyat: ticker.lastPrice,

              degisim24SaatYuzde:

                Number(ticker.price24hPcnt || 0) * 100,

              hacim24Saat: ticker.volume24h,

              islemHacmi24SaatUSDT: ticker.turnover24h

            },

            usdtm: linear

              ? {

                  sembol: linear.symbol,

                  fiyat: linear.lastPrice,

                  markPrice: linear.markPrice,

                  openInterest: linear.openInterest,

                  fundingRate: linear.fundingRate,

                  islemHacmi24Saat: linear.turnover24h

                }

              : null,

            coinm: inverse

              ? {

                  sembol: inverse.symbol,

                  fiyat: inverse.lastPrice,

                  markPrice: inverse.markPrice,

                  indexPrice: inverse.indexPrice,

                  openInterest: inverse.openInterest,

                  fundingRate: inverse.fundingRate,

                  islemHacmi24Saat: inverse.turnover24h

                }

              : null

          };

        });

        return toolResult({

          kaynak: "Bybit",

          tarananCoinSayisi: assets.length,

          istenenLimit: limit,

          minimumSpotIslemHacmiUSDT: minTurnover24h,

          veriZamani: Number(spotData.time || Date.now()),

          varliklar: assets,

          not:

            "Tarama Spot USDT paritelerinden oluşturulur. Vadeli sözleşmesi bulunmayan coinlerde ilgili alan null olur. Bu araç emir göndermez."

        });

      } catch (error) {

        return toolResult({

          hata: error.message,

          varliklar: []

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
