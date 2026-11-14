import { McpServer } from "@modelcontextprotocol/server";

import { createMcpHandler } from "agents/mcp/server";

import { z } from "zod";

const OKX = "https://www.okx.com";

const VERSION = "3.1.0";

const CACHE = new Map();

const IN_FLIGHT = new Map();

const CACHE_LIMIT = 400;

const BAR = {

  "5m": { okx: "5m", ms: 300000 },

  "15m": { okx: "15m", ms: 900000 },

  "1h": { okx: "1H", ms: 3600000 },

  "4h": { okx: "4H", ms: 14400000 },

  "1d": { okx: "1D", ms: 86400000 },

  "1w": { okx: "1W", ms: 604800000 }

};

const ALLOWED_ORIGINS = new Set([

  "https://engellihaklari480-hash.github.io",

  "http://localhost:4173",

  "http://localhost:5173"

]);

class ApiError extends Error {

  constructor(message, status = 502, retryAfter = null) {

    super(message);

    this.name = "ApiError";

    this.status = status;

    this.retryAfter = retryAfter;

  }

}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function json(data, status = 200, origin = "", extraHeaders = {}) {

  const headers = {

    "content-type": "application/json; charset=utf-8",

    "cache-control": "no-store",

    "x-content-type-options": "nosniff",

    "referrer-policy": "no-referrer",

    ...extraHeaders

  };

  if (ALLOWED_ORIGINS.has(origin)) {

    headers["access-control-allow-origin"] = origin;

    headers.vary = "Origin";

    headers["access-control-allow-methods"] = "GET, OPTIONS";

    headers["access-control-allow-headers"] = "Content-Type";

  }

  return new Response(JSON.stringify(data), { status, headers });

}

function cacheGet(key, allowExpired = false) {

  const item = CACHE.get(key);

  if (!item) return null;

  const now = Date.now();

  if (item.expiresAt > now) {

    return {

      value: item.value,

      stale: false,

      fetchedAt: item.fetchedAt

    };

  }

  if (allowExpired && item.staleUntil > now) {

    return {

      value: item.value,

      stale: true,

      fetchedAt: item.fetchedAt

    };

  }

  if (item.staleUntil <= now) {

    CACHE.delete(key);

  }

  return null;

}

function cacheSet(key, value, ttl) {

  if (CACHE.size >= CACHE_LIMIT) {

    const oldestKey = CACHE.keys().next().value;

    if (oldestKey !== undefined) {

      CACHE.delete(oldestKey);

    }

  }

  const now = Date.now();

  CACHE.set(key, {

    value,

    fetchedAt: now,

    expiresAt: now + ttl,

    staleUntil: now + ttl + 10 * 60 * 1000

  });

  return value;

}

async function requestOkx(url, timeoutMs = 12000) {

  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {

    const response = await fetch(url, {

      method: "GET",

      headers: {

        Accept: "application/json"

      },

      signal: controller.signal

    });

    if (!response.ok) {

      const retryHeader = Number(response.headers.get("Retry-After"));

      const retryAfter =

        Number.isFinite(retryHeader) && retryHeader > 0

          ? retryHeader

          : null;

      throw new ApiError(

        `OKX HTTP ${response.status}`,

        response.status,

        retryAfter

      );

    }

    const body = await response.json();

    if (!body || body.code !== "0" || !Array.isArray(body.data)) {

      throw new ApiError(

        `OKX ${body?.code || "API"}: ${

          body?.msg || "Geçersiz veya beklenmeyen API yanıtı."

        }`,

        502

      );

    }

    return body.data;

  } catch (error) {

    if (error.name === "AbortError") {

      throw new ApiError("OKX isteği zaman aşımına uğradı.", 504);

    }

    if (error instanceof ApiError) {

      throw error;

    }

    throw new ApiError(

      `OKX bağlantı hatası: ${

        error.message || "Bilinmeyen ağ hatası"

      }`,

      502

    );

  } finally {

    clearTimeout(timer);

  }

}

async function okx(path, params = {}, ttl = 10000, options = {}) {

  const url = new URL(path, OKX);

  for (const [key, value] of Object.entries(params)) {

    if (value !== undefined && value !== null && value !== "") {

      url.searchParams.set(key, String(value));

    }

  }

  const key = url.toString();

  const fresh = cacheGet(key);

  if (fresh) {

    return fresh.value;

  }

  if (IN_FLIGHT.has(key)) {

    return IN_FLIGHT.get(key);

  }

  const task = (async () => {

    try {

      let lastError;

      for (let attempt = 0; attempt < 2; attempt++) {

        try {

          const data = await requestOkx(

            url,

            options.timeoutMs || 12000

          );

          return cacheSet(key, data, ttl);

        } catch (error) {

          lastError = error;

          if (attempt === 0 && error.status === 429) {

            const waitMs = Math.min(

              2000,

              Math.max(500, (error.retryAfter || 1) * 1000)

            );

            await sleep(waitMs);

            continue;

          }

          break;

        }

      }

      // Eski veri güncelmiş gibi sunulmaz.

      // 429 ve 5xx durumlarında hata açıkça döndürülür.

      throw lastError;

    } finally {

      IN_FLIGHT.delete(key);

    }

  })();

  IN_FLIGHT.set(key, task);

  return task;

}

function cleanSymbol(value) {

  const symbol = String(value || "")

    .trim()

    .toUpperCase()

    .replaceAll("_", "-");

  if (!/^[A-Z0-9-]{2,40}$/.test(symbol)) {

    throw new ApiError("Geçersiz sembol.", 400);

  }

  return symbol;

}

function spotInstrument(symbol) {

  const value = cleanSymbol(symbol);

  if (value.includes("-")) {

    return value;

  }

  for (const quote of ["USDT", "USDC", "BTC", "USD"]) {

    if (value.endsWith(quote) && value.length > quote.length) {

      return `${value.slice(0, -quote.length)}-${quote}`;

    }

  }

  throw new ApiError(

    "Spot paritesi OKX biçiminde olmalı. Örnek: BTC-USDT.",

    400

  );

}

async function resolveInstrument(market, symbol) {

  if (market === "spot") {

    return {

      instId: spotInstrument(symbol),

      instType: "SPOT"

    };

  }

  if (market !== "usdtm" && market !== "coinm") {

    throw new ApiError(

      "Piyasa türü spot, usdtm veya coinm olmalı.",

      400

    );

  }

  const raw = cleanSymbol(symbol);

  const base = raw.includes("-")

    ? raw.split("-")[0]

    : raw.replace(/USDT$|USD$/, "");

  const list = await okx(

    "/api/v5/public/instruments",

    { instType: "SWAP" },

    120000

  );

  const candidates = list.filter(

    item => item.state === "live" && item.baseCcy === base

  );

  const chosen =

    market === "usdtm"

      ? candidates.find(item => item.settleCcy === "USDT")

      : candidates.find(

          item =>

            item.settleCcy === base &&

            item.ctType === "inverse"

        );

  if (!chosen) {

    throw new ApiError(

      `${base} için OKX ${

        market === "usdtm" ? "USDT-M" : "COIN-M"

      } canlı SWAP sözleşmesi bulunamadı.`,

      404

    );

  }

  return {

    instId: chosen.instId,

    instType: "SWAP",

    metadata: chosen

  };

}

function num(value) {

  if (value === null || value === undefined || value === "") {

    return null;

  }

  const result = Number(value);

  return Number.isFinite(result) ? result : null;

}

function pct(current, base) {

  return current !== null && base !== null && base !== 0

    ? ((current - base) / base) * 100

    : null;

}

function round(value, digits = 8) {

  return value === null ||

    value === undefined ||

    !Number.isFinite(value)

    ? null

    : Number(value.toFixed(digits));

}

function freshness(timestamp, maxAgeMs = 120000) {

  const time = Number(timestamp || 0);

  const age =

    time > 0

      ? Math.max(0, Date.now() - time)

      : null;

  return {

    timestamp: time || null,

    ageSeconds: age === null ? null : Math.round(age / 1000),

    stale: age === null || age > maxAgeMs

  };

}

async function ticker(market, symbol) {

  const instrument = await resolveInstrument(market, symbol);

  const rows = await okx(

    "/api/v5/market/ticker",

    { instId: instrument.instId },

    8000

  );

  const item = rows[0];

  if (!item) {

    throw new ApiError(

      "OKX bu enstrüman için fiyat döndürmedi.",

      404

    );

  }

  const last = num(item.last);

  const open = num(item.open24h);

  return {

    source: "OKX",

    market,

    instrument: instrument.instId,

    instrumentType: instrument.instType,

    last: round(last),

    change24hPercent: round(pct(last, open), 5),

    high24h: num(item.high24h),

    low24h: num(item.low24h),

    open24h: open,

    volume24hBase: num(item.vol24h),

    volume24hQuote: num(item.volCcy24h),

    bid: num(item.bidPx),

    ask: num(item.askPx),

    timestamp: num(item.ts),

    freshness: freshness(item.ts),

    settlementCurrency:

      instrument.metadata?.settleCcy || null,

    quoteCurrency:

      instrument.metadata?.quoteCcy || null

  };

}

function ema(values, period) {

  const output = Array(values.length).fill(null);

  if (values.length < period) {

    return output;

  }

  let sum = 0;

  for (let index = 0; index < period; index++) {

    sum += values[index];

  }

  let current = sum / period;

  output[period - 1] = current;

  const multiplier = 2 / (period + 1);

  for (let index = period; index < values.length; index++) {

    current =

      values[index] * multiplier +

      current * (1 - multiplier);

    output[index] = current;

  }

  return output;

}

function sma(values, period) {

  if (values.length < period) {

    return null;

  }

  return values

    .slice(-period)

    .reduce((sum, value) => sum + value, 0) / period;

}

function rsi(values, period = 14) {

  if (values.length <= period) {

    return null;

  }

  let gains = 0;

  let losses = 0;

  for (let index = 1; index <= period; index++) {

    const change = values[index] - values[index - 1];

    gains += Math.max(change, 0);

    losses += Math.max(-change, 0);

  }

  let averageGain = gains / period;

  let averageLoss = losses / period;

  for (

    let index = period + 1;

    index < values.length;

    index++

  ) {

    const change = values[index] - values[index - 1];

    averageGain =

      (averageGain * (period - 1) + Math.max(change, 0)) /

      period;

    averageLoss =

      (averageLoss * (period - 1) + Math.max(-change, 0)) /

      period;

  }

  if (averageLoss === 0) {

    return averageGain === 0 ? 50 : 100;

  }

  return 100 - 100 / (1 + averageGain / averageLoss);

}

function stochasticRsi(values, period = 14) {

  if (values.length < period * 2 + 1) {

    return null;

  }

  const series = [];

  for (

    let end = period + 1;

    end <= values.length;

    end++

  ) {

    series.push(

      rsi(values.slice(0, end), period)

    );

  }

  const recent = series

    .slice(-period)

    .filter(value => value !== null);

  if (recent.length !== period) {

    return null;

  }

  const current = recent[recent.length - 1];

  const low = Math.min(...recent);

  const high = Math.max(...recent);

  return high === low

    ? 50

    : ((current - low) / (high - low)) * 100;

}

function atr(candles, period = 14) {

  if (candles.length < period + 1) {

    return null;

  }

  const ranges = [];

  for (let index = 1; index < candles.length; index++) {

    const current = candles[index];

    const previousClose = candles[index - 1].close;

    ranges.push(

      Math.max(

        current.high - current.low,

        Math.abs(current.high - previousClose),

        Math.abs(current.low - previousClose)

      )

    );

  }

  let value =

    ranges

      .slice(0, period)

      .reduce((sum, item) => sum + item, 0) / period;

  for (let index = period; index < ranges.length; index++) {

    value =

      (value * (period - 1) + ranges[index]) / period;

  }

  return value;

}

function adx(candles, period = 14) {

  if (candles.length < period * 2 + 1) {

    return null;

  }

  const tr = [];

  const plusDm = [];

  const minusDm = [];

  for (let index = 1; index < candles.length; index++) {

    const previous = candles[index - 1];

    const current = candles[index];

    const up = current.high - previous.high;

    const down = previous.low - current.low;

    plusDm.push(

      up > down && up > 0 ? up : 0

    );

    minusDm.push(

      down > up && down > 0 ? down : 0

    );

    tr.push(

      Math.max(

        current.high - current.low,

        Math.abs(current.high - previous.close),

        Math.abs(current.low - previous.close)

      )

    );

  }

  let trSmooth = tr

    .slice(0, period)

    .reduce((sum, item) => sum + item, 0);

  let plusSmooth = plusDm

    .slice(0, period)

    .reduce((sum, item) => sum + item, 0);

  let minusSmooth = minusDm

    .slice(0, period)

    .reduce((sum, item) => sum + item, 0);

  const dx = [];

  for (let index = period; index < tr.length; index++) {

    if (index > period - 1) {

      trSmooth =

        trSmooth - trSmooth / period + tr[index];

      plusSmooth =

        plusSmooth - plusSmooth / period + plusDm[index];

      minusSmooth =

        minusSmooth - minusSmooth / period + minusDm[index];

    }

    if (trSmooth <= 0) {

      continue;

    }

    const plusDi = 100 * plusSmooth / trSmooth;

    const minusDi = 100 * minusSmooth / trSmooth;

    const denominator = plusDi + minusDi;

    dx.push(

      denominator === 0

        ? 0

        : 100 * Math.abs(plusDi - minusDi) / denominator

    );

  }

  if (dx.length < period) {

    return null;

  }

  let value =

    dx

      .slice(0, period)

      .reduce((sum, item) => sum + item, 0) / period;

  for (let index = period; index < dx.length; index++) {

    value =

      (value * (period - 1) + dx[index]) / period;

  }

  return value;

}

function analyze(candles) {

  if (!Array.isArray(candles) || candles.length < 210) {

    return {

      signal: "SİNYAL YOK",

      score: 0,

      reasons: [

        "EMA200 ve diğer göstergeler için en az 210 kapanmış mum gerekli."

      ],

      riskModel: null,

      candleCount: candles?.length || 0

    };

  }

  const closes = candles.map(item => item.close);

  if (

    closes.some(

      value => !Number.isFinite(value) || value <= 0

    )

  ) {

    throw new ApiError(

      "Mum verisinde geçersiz kapanış fiyatı var.",

      502

    );

  }

  const last = closes[closes.length - 1];

  const emaValues = {};

  for (const period of [9, 20, 50, 100, 200]) {

    emaValues[period] = ema(closes, period).at(-1);

  }

  const macdFast = ema(closes, 12);

  const macdSlow = ema(closes, 26);

  const macdLine = closes

    .map((_, index) =>

      macdFast[index] === null ||

      macdSlow[index] === null

        ? null

        : macdFast[index] - macdSlow[index]

    )

    .filter(value => value !== null);

  const macdSignalSeries = ema(macdLine, 9);

  const macdNow = macdLine.at(-1) ?? null;

  const macdSignal = macdSignalSeries.at(-1) ?? null;

  const last20 = closes.slice(-20);

  const mean =

    last20.reduce((sum, value) => sum + value, 0) /

    last20.length;

  const deviation = Math.sqrt(

    last20.reduce(

      (sum, value) => sum + (value - mean) ** 2,

      0

    ) / last20.length

  );

  const currentRsi = rsi(closes);

  const currentStochRsi = stochasticRsi(closes);

  const currentAtr = atr(candles);

  const currentAdx = adx(candles);

  const recent = candles.slice(-20);

  const volume = recent.reduce(

    (sum, item) => sum + (item.volume || 0),

    0

  );

  const vwap =

    volume > 0

      ? recent.reduce(

          (sum, item) =>

            sum +

            ((item.high + item.low + item.close) / 3) *

              (item.volume || 0),

          0

        ) / volume

      : null;

  const recentHigh = Math.max(

    ...recent.map(item => item.high)

  );

  const recentLow = Math.min(

    ...recent.map(item => item.low)

  );

  const required = [

    currentRsi,

    currentAtr,

    currentAdx,

    emaValues[9],

    emaValues[20],

    emaValues[50],

    emaValues[100],

    emaValues[200],

    macdNow,

    macdSignal

  ];

  if (

    required.some(

      value => value === null || !Number.isFinite(value)

    )

  ) {

    return {

      signal: "SİNYAL YOK",

      score: 0,

      reasons: [

        "Gerekli göstergelerin tamamı hesaplanamadı; eksik veriyle sinyal üretilmedi."

      ],

      candleCount: candles.length,

      lastPrice: round(last),

      riskModel: null

    };

  }

  let score = 0;

  const reasons = [];

  if (last > emaValues[20] && emaValues[20] > emaValues[50]) {

    score += 2;

    reasons.push(

      "Fiyat EMA20 ve EMA50 üzerinde; kısa vadeli trend pozitif."

    );

  } else if (

    last < emaValues[20] &&

    emaValues[20] < emaValues[50]

  ) {

    score -= 2;

    reasons.push(

      "Fiyat EMA20 ve EMA50 altında; kısa vadeli trend negatif."

    );

  }

  if (emaValues[50] > emaValues[200]) {

    score++;

    reasons.push(

      "EMA50, EMA200 üzerinde; orta vadeli eğilim pozitif."

    );

  } else if (emaValues[50] < emaValues[200]) {

    score--;

    reasons.push(

      "EMA50, EMA200 altında; orta vadeli eğilim negatif."

    );

  }

  if (currentRsi > 55 && currentRsi < 70) {

    score++;

    reasons.push(

      "RSI pozitif momentum bölgesinde."

    );

  } else if (currentRsi < 45 && currentRsi > 30) {

    score--;

    reasons.push(

      "RSI negatif momentum bölgesinde."

    );

  } else if (currentRsi >= 70) {

    reasons.push(

      "RSI aşırı alım bölgesinde; geri çekilme riski artmış olabilir."

    );

  } else if (currentRsi <= 30) {

    reasons.push(

      "RSI aşırı satım bölgesinde; tek başına dönüş teyidi değildir."

    );

  }

  if (macdNow > macdSignal) {

    score++;

    reasons.push(

      "MACD çizgisi sinyal çizgisinin üzerinde."

    );

  } else {

    score--;

    reasons.push(

      "MACD çizgisi sinyal çizgisinin altında."

    );

  }

  if (vwap !== null) {

    if (last > vwap) {

      score++;

      reasons.push(

        "Fiyat son 20 mumluk VWAP üzerinde."

      );

    } else {

      score--;

      reasons.push(

        "Fiyat son 20 mumluk VWAP altında."

      );

    }

  }

  if (currentAdx < 18) {

    reasons.push(

      "ADX zayıf trend gücüne işaret ediyor; sinyal güveni sınırlı."

    );

  }

  let signal =

    score >= 5

      ? "GÜÇLÜ AL"

      : score >= 2

        ? "AL"

        : score <= -5

          ? "GÜÇLÜ SAT"

          : score <= -2

            ? "SAT"

            : "TUT";

  if (currentAdx < 12 && Math.abs(score) < 5) {

    signal = "TUT";

  }

  const direction = signal.includes("AL")

    ? "long"

    : signal.includes("SAT")

      ? "short"

      : null;

  const stop =

    direction === "long"

      ? last - 1.5 * currentAtr

      : direction === "short" 
        ? last + 1.5 * currentAtr

        : null;

  const risk =

    stop === null

      ? null

      : Math.abs(last - stop);

  return {

    candleCount: candles.length,

    lastClosedCandleOpenTime: candles.at(-1).time,

    lastPrice: round(last),

    rsi14: round(currentRsi, 3),

    stochasticRsi14: round(currentStochRsi, 3),

    ema: Object.fromEntries(

      Object.entries(emaValues).map(

        ([key, value]) => [key, round(value)]

      )

    ),

    sma50: round(sma(closes, 50)),

    sma200: round(sma(closes, 200)),

    macd: round(macdNow),

    macdSignal: round(macdSignal),

    macdHistogram: round(macdNow - macdSignal),

    bollinger: {

      upper: round(mean + 2 * deviation),

      middle: round(mean),

      lower: round(mean - 2 * deviation)

    },

    atr14: round(currentAtr),

    adx14: round(currentAdx),

    vwap20: round(vwap),

    support20: round(recentLow),

    resistance20: round(recentHigh),

    score,

    signal,

    reasons,

    riskModel: direction

      ? {

          direction,

          entryReference: round(last),

          stopLossIllustrative: round(stop),

          target1Illustrative: round(

            direction === "long"

              ? last + 2 * risk

              : last - 2 * risk

          ),

          target2Illustrative: round(

            direction === "long"

              ? last + 3 * risk

              : last - 3 * risk

          ),

          riskRewardTarget1: 2,

          riskRewardTarget2: 3,

          invalidation:

            direction === "long"

              ? "Kapanışın örnek stop seviyesinin altına inmesi"

              : "Kapanışın örnek stop seviyesinin üstüne çıkması",

          note:

            "Bunlar ATR tabanlı teorik referans seviyeleridir; emir, kesin hedef veya yatırım tavsiyesi değildir. Komisyon ve kayma dahil değildir."

        }

      : null

  };

}

async function candles(

  market,

  symbol,

  interval = "1h",

  limit = 250

) {

  const config = BAR[interval];

  if (!config) {

    throw new ApiError(

      "Desteklenmeyen zaman dilimi.",

      400

    );

  }

  const safeLimit = Math.max(

    60,

    Math.min(300, Math.floor(Number(limit) || 250))

  );

  const instrument = await resolveInstrument(

    market,

    symbol

  );

  const rows = await okx(

    "/api/v5/market/candles",

    {

      instId: instrument.instId,

      bar: config.okx,

      limit: safeLimit

    },

    20000

  );

  const parsed = rows

    .map(row => ({

      time: Number(row[0]),

      open: num(row[1]),

      high: num(row[2]),

      low: num(row[3]),

      close: num(row[4]),

      volume: num(row[5]) || 0,

      confirm: String(row[8] || "0")

    }))

    .filter(

      item =>

        [

          item.time,

          item.open,

          item.high,

          item.low,

          item.close

        ].every(Number.isFinite) &&

        item.high >= item.low &&

        item.high >= Math.max(item.open, item.close) &&

        item.low <= Math.min(item.open, item.close)

    );

  const closed = parsed

    .filter(

      item =>

        item.confirm === "1" &&

        item.time + config.ms <= Date.now()

    )

    .sort((a, b) => a.time - b.time);

  return {

    instrument,

    candles: closed,

    newestRawTimestamp:

      parsed.length

        ? Math.max(...parsed.map(item => item.time))

        : null

  };

}

async function derivatives(symbol) {

  const instrument = await resolveInstrument(

    "usdtm",

    symbol

  );

  const [funding, interest, mark] = await Promise.all([

    okx(

      "/api/v5/public/funding-rate",

      { instId: instrument.instId },

      20000

    ),

    okx(

      "/api/v5/public/open-interest",

      {

        instType: "SWAP",

        instId: instrument.instId

      },

      20000

    ),

    okx(

      "/api/v5/public/mark-price",

      {

        instType: "SWAP",

        instId: instrument.instId

      },

      20000

    )

  ]);

  return {

    source: "OKX",

    instrument: instrument.instId,

    fundingRate: num(funding[0]?.fundingRate),

    nextFundingTime: num(funding[0]?.nextFundingTime),

    openInterest: num(interest[0]?.oi),

    openInterestCurrency: interest[0]?.oiCcy || null,

    markPrice: num(mark[0]?.markPx),

    timestamp: Date.now(),

    note:

      "Açık pozisyonun birimi sözleşme türüne göre değişebilir; ham birim ayrıca belirtilir."

  };

}

function tickerToMarketItem(

  item,

  market,

  metadata = null

) {

  return {

    symbol:

      market === "spot"

        ? item.instId.replaceAll("-", "")

        : item.instId,

    instrument: item.instId,

    market,

    last: num(item.last),

    change24hPercent: round(

      pct(num(item.last), num(item.open24h)),

      5

    ),

    volume24hBase: num(item.vol24h),

    volume24hQuote: num(item.volCcy24h),

    high24h: num(item.high24h),

    low24h: num(item.low24h),

    timestamp: num(item.ts),

    settlementCurrency:

      metadata?.settleCcy || null,

    quoteCurrency:

      metadata?.quoteCcy || null

  };

}

async function marketList(market, limit = 500) {

  const safeLimit = Math.min(

    500,

    Math.max(1, Math.floor(Number(limit) || 500))

  );

  if (market === "spot") {

    const rows = await okx(

      "/api/v5/market/tickers",

      { instType: "SPOT" },

      30000

    );

    return rows

      .filter(

        item =>

          item.instId.endsWith("-USDT") &&

          num(item.last) > 0

      )

      .sort(

        (a, b) =>

          (num(b.volCcy24h) || 0) -

          (num(a.volCcy24h) || 0)

      )

      .slice(0, safeLimit)

      .map(item => tickerToMarketItem(item, "spot"));

  }

  if (market !== "usdtm" && market !== "coinm") {

    throw new ApiError(

      "Piyasa türü spot, usdtm veya coinm olmalı.",

      400

    );

  }

  const [rows, instruments] = await Promise.all([

    okx(

      "/api/v5/market/tickers",

      { instType: "SWAP" },

      30000

    ),

    okx(

      "/api/v5/public/instruments",

      { instType: "SWAP" },

      120000

    )

  ]);

  const metadata = new Map(

    instruments.map(item => [item.instId, item])

  );

  return rows

    .filter(item => {

      const contract = metadata.get(item.instId);

      if (!contract || contract.state !== "live") {

        return false;

      }

      return market === "usdtm"

        ? contract.settleCcy === "USDT"

        : contract.settleCcy === contract.baseCcy &&

            contract.ctType === "inverse";

    })

    .sort(

      (a, b) =>

        (num(b.volCcy24h) || 0) -

        (num(a.volCcy24h) || 0)

    )

    .slice(0, safeLimit)

    .map(

      item =>

        tickerToMarketItem(

          item,

          market,

          metadata.get(item.instId)

        )

    );

}

async function scan(limit = 500, minQuoteVolume = 0) {

  const safeLimit = Math.min(

    500,

    Math.max(1, Math.floor(Number(limit) || 500))

  );

  const minimumVolume = Math.max(

    0,

    Number(minQuoteVolume) || 0

  );

  const [tickers, instruments] = await Promise.all([

    okx(

      "/api/v5/market/tickers",

      { instType: "SPOT" },

      30000

    ),

    okx(

      "/api/v5/public/instruments",

      { instType: "SWAP" },

      120000

    )

  ]);

  const usdtBases = new Set(

    instruments

      .filter(

        item =>

          item.state === "live" &&

          item.settleCcy === "USDT"

      )

      .map(item => item.baseCcy)

  );

  const coinBases = new Set(

    instruments

      .filter(

        item =>

          item.state === "live" &&

          item.settleCcy === item.baseCcy &&

          item.ctType === "inverse"

      )

      .map(item => item.baseCcy)

  );

  const items = tickers

    .filter(

      item =>

        item.instId.endsWith("-USDT") &&

        num(item.last) > 0 &&

        (num(item.volCcy24h) || 0) >= minimumVolume

    )

    .sort(

      (a, b) =>

        (num(b.volCcy24h) || 0) -

        (num(a.volCcy24h) || 0)

    )

    .slice(0, safeLimit)

    .map(item => {

      const base = item.instId.split("-")[0];

      return {

        asset: base,

        spotInstrument: item.instId,

        last: num(item.last),

        change24hPercent: round(

          pct(

            num(item.last),

            num(item.open24h)

          ),

          5

        ),

        quoteVolume24h: num(item.volCcy24h),

        hasUsdtm: usdtBases.has(base),

        hasCoinm: coinBases.has(base),

        timestamp: num(item.ts)

      };

    });

  return {

    source: "OKX",

    count: items.length,

    requestedLimit: safeLimit,

    scannedAt: Date.now(),

    items,

    note:

      "Tarama OKX Spot USDT paritelerine göre hacim sıralıdır. OKX ticker piyasa değeri sağlamadığı için market cap üretilmez."

  };

}

function parsePositive(value, fallback, min, max) {

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {

    return fallback;

  }

  return Math.min(

    max,

    Math.max(min, Math.floor(parsed))

  );

}

async function api(request) {

  const url = new URL(request.url);

  const origin = request.headers.get("Origin") || "";

  if (request.method === "OPTIONS") {

    if (!ALLOWED_ORIGINS.has(origin)) {

      return new Response(null, { status: 403 });

    }

    return new Response(null, {

      status: 204,

      headers: {

        "access-control-allow-origin": origin,

        "access-control-allow-methods": "GET, OPTIONS",

        "access-control-allow-headers": "Content-Type",

        "access-control-max-age": "86400",

        vary: "Origin"

      }

    });

  }

  if (request.method !== "GET") {

    return json(

      {

        error: "Yalnızca GET desteklenir.",

        signal: "SİNYAL YOK"

      },

      405,

      origin

    );

  }

  try {

    const path = url.pathname;

    const query = url.searchParams;

    if (

      path === "/api/health" ||

      path === "/api/status"

    ) {

      const btc = await ticker("spot", "BTC-USDT");

      return json(

        {

          status: "ok",

          version: VERSION,

          source: "OKX",

          publicMarketData: true,

          serverTime: Date.now(),

          cacheEntries: CACHE.size,

          inFlightRequests: IN_FLIGHT.size,

          btc

        },

        200,

        origin

      );

    }

    if (path === "/api/markets") {

      const market = query.get("market") || "spot";

      const items = await marketList(

        market,

        parsePositive(

          query.get("limit"),

          500,

          1,

          500

        )

      );

      return json(

        {

          market,

          source: "OKX",

          count: items.length,

          timestamp: Date.now(),

          items

        },

        200,

        origin

      );

    }

    if (path === "/api/ticker") {

      return json(

        await ticker(

          query.get("market") || "spot",

          query.get("symbol") ||

            query.get("instId") ||

            "BTC-USDT"

        ),

        200,

        origin

      );

    }

    if (path === "/api/analysis") {

      const market = query.get("market") || "spot";

      const symbol = query.get("symbol") || "BTC-USDT";

      const interval = query.get("interval") || "1h";

      if (!BAR[interval]) {

        throw new ApiError(

          "Desteklenmeyen zaman dilimi.",

          400

        );

      }

      const data = await candles(

        market,

        symbol,

        interval,

        parsePositive(

          query.get("limit"),

          250,

          60,

          300

        )

      );

      const result = analyze(data.candles);

      const dataFreshness = data.candles.length

        ? freshness(

            data.candles.at(-1).time + BAR[interval].ms,

            BAR[interval].ms * 2

          )

        : {

            timestamp: null,

            ageSeconds: null,

            stale: true

          };

      if (dataFreshness.stale) {

        result.signal = "SİNYAL YOK";

        result.reasons = [

          ...(result.reasons || []),

          "Son kapanmış mum beklenenden eski; sinyal güvenilir değil."

        ];

        result.riskModel = null;

      }

      return json(

        {

          market,

          symbol,

          instrument: data.instrument.instId,

          interval,

          source: "OKX",

          analysis: result,

          dataFreshness,

          warning:

            "Araştırma amaçlı teknik analizdir; yatırım tavsiyesi veya işlem emri değildir."

        },

        200,

        origin

      );

    }

    if (path === "/api/candles") {

      const interval = query.get("interval") || "1h";

      const result = await candles(

        query.get("market") || "spot",

        query.get("symbol") || "BTC-USDT",

        interval,

        parsePositive(

          query.get("limit"),

          250,

          60,

          300

        )

      );

      return json(

        {

          instrument: result.instrument.instId,

          interval,

          count: result.candles.length,

          candles: result.candles

        },

        200,

        origin

      );

    }

    if (path === "/api/derivatives") {

      return json(

        await derivatives(

          query.get("symbol") || "BTC-USDT"

        ),

        200,

        origin

      );

    }

    if (path === "/api/orderbook") {

      const instrument = await resolveInstrument(

        query.get("market") || "spot",

        query.get("symbol") || "BTC-USDT"

      );

      const rows = await okx(

        "/api/v5/market/books",

        {

          instId: instrument.instId,

          sz: parsePositive(

            query.get("depth"),

            20,

            1,

            50

          )

        },

        5000

      );

      return json(

        {

          instrument: instrument.instId,

          bids: rows[0]?.bids || [],

          asks: rows[0]?.asks || [],

          timestamp: num(rows[0]?.ts)

        },

        200,

        origin

      );

    }

    if (path === "/api/trades") {

      const instrument = await resolveInstrument(

        query.get("market") || "spot",

        query.get("symbol") || "BTC-USDT"

      );

      const trades = await okx(

        "/api/v5/market/trades",

        {

          instId: instrument.instId,

          limit: parsePositive(

            query.get("limit"),

            50,

            1,

            100

          )

        },

        5000

      );

      return json(

        {

          instrument: instrument.instId,

          count: trades.length,

          trades

        },

        200,

        origin

      );

    }

    if (path === "/api/scan") {

      return json(

        await scan(

          parsePositive(

            query.get("limit"),

            500,

            1,

            500

          ),

          query.get("minQuoteVolume") || 0

        ),

        200,

        origin

      );

    }

    if (path === "/api/ai/providers") {

      return json(

        {

          enabled: false,

          reason:

            "AI entegrasyonları henüz etkin değil. API anahtarları güvenli Worker secret olarak kurulmadan kullanılmaz.",

          providers: [

            "Gemini",

            "Groq",

            "Mistral",

            "OpenRouter",

            "Cloudflare Workers AI"

          ]

        },

        200,

        origin

      );

    }

    return json(

      {

        error: "API yolu bulunamadı.",

        available: [

          "/api/health",

          "/api/status",

          "/api/markets",

          "/api/ticker",

          "/api/candles",

          "/api/analysis",

          "/api/derivatives",

          "/api/orderbook",

          "/api/trades",

          "/api/scan",

          "/api/ai/providers"

        ]

      },

      404,

      origin

    );

  } catch (error) {

    const status =

      error instanceof ApiError

        ? error.status

        : 502;

    const headers =

      status === 429

        ? {

            "retry-after": String(

              error.retryAfter || 2

            )

          }

        : {};

    return json(

      {

        error:

          error.message ||

          "Beklenmeyen sunucu hatası.",

        status,

        signal: "SİNYAL YOK",

        source: "OKX",

        timestamp: Date.now(),

        retryable:

          status === 429 ||

          status === 502 ||

          status === 503 ||

          status === 504

      },

      status,

      origin,

      headers

    );

  }

}

function toolText(value) {

  return {

    content: [

      {

        type: "text",

        text: JSON.stringify(value, null, 2)

      }

    ]

  };

}

function createServer() {

  const server = new McpServer({

    name: "kripto-analiz-okx",

    version: VERSION

  });

  server.registerTool(

    "health_check",

    {

      description:

        "OKX herkese açık piyasa verisini BTC-USDT ile kontrol eder. Hesap veya emir erişimi yapmaz.",

      inputSchema: z.object({})

    },

    async () => {

      try {

        return toolText({

          status: "ok",

          version: VERSION,

          btc: await ticker("spot", "BTC-USDT")

        });

      } catch (error) {

        return toolText({

          status: "error",

          error: error.message

        });

      }

    }

  );

  server.registerTool(

    "get_market_ticker",

    {

      description:

        "OKX Spot, USDT-M veya COIN-M fiyat ve 24 saat piyasa verisini getirir.",

      inputSchema: z.object({

        market: z.enum(["spot", "usdtm", "coinm"]),

        symbol: z.string().min(2).max(40)

      })

    },

    async args => {

      try {

        return toolText(

          await ticker(args.market, args.symbol)

        );

      } catch (error) {

        return toolText({

          error: error.message,

          signal: "SİNYAL YOK"

        });

      }

    }

  );

  server.registerTool(

    "get_technical_analysis",

    {

      description:

        "OKX kapanmış mumlarından RSI, Stochastic RSI, MACD, EMA, SMA, Bollinger, ATR, ADX ve VWAP hesaplar.",

      inputSchema: z.object({

        market: z.enum(["spot", "usdtm", "coinm"]),

        symbol: z.string().min(2).max(40),

        interval: z

          .enum(["5m", "15m", "1h", "4h", "1d", "1w"])

          .default("1h")

      })

    },

    async args => {

      try {

        const data = await candles(

          args.market,

          args.symbol,

          args.interval,

          250

        );

        const result = analyze(data.candles);

        const dataFreshness = data.candles.length

          ? freshness(

              data.candles.at(-1).time +

                BAR[args.interval].ms,

              BAR[args.interval].ms * 2

            )

          : {

              stale: true

            };

        if (dataFreshness.stale) {

          result.signal = "SİNYAL YOK";

          result.riskModel = null;

          result.reasons = [

            ...(result.reasons || []),

            "Son kapanmış mum verisi eski."

          ];

        }

        return toolText({

          source: "OKX",

          instrument: data.instrument.instId,

          interval: args.interval,

          analysis: result,

          dataFreshness

        });

      } catch (error) {

        return toolText({

          error: error.message,

          signal: "SİNYAL YOK"

        });

      }

    }

  );

  server.registerTool(

    "get_derivatives_snapshot",

    {

      description:

        "OKX USDT-M SWAP fonlama, açık pozisyon ve mark fiyatı bilgisi verir.",

      inputSchema: z.object({

        symbol: z.string().min(2).max(40)

      })

    },

    async args => {

      try {

        return toolText(

          await derivatives(args.symbol)

        );

      } catch (error) {

        return toolText({

          error: error.message

        });

      }

    }

  );

  server.registerTool(

    "scan_market_universe",

    {

      description:

        "OKX Spot USDT piyasasını hacme göre en fazla 500 varlığa kadar tarar.",

      inputSchema: z.object({

        limit: z.number().int().min(1).max(500).default(500),

        minQuoteVolume: z.number().min(0).default(0)

      })

    },

    async args => {

      try {

        return toolText(

          await scan(

            args.limit,

            args.minQuoteVolume

          )

        );

      } catch (error) {

        return toolText({

          error: error.message,

          items: []

        });

      }

    }

  );

  server.registerTool(

    "get_orderbook_analysis",

    {

      description:

        "OKX emir defterinin ilk 20 seviyesini getirir; emir göndermez.",

      inputSchema: z.object({

        market: z.enum(["spot", "usdtm", "coinm"]),

        symbol: z.string().min(2).max(40)

      })

    },

    async args => {

      try {

        const instrument = await resolveInstrument(

          args.market,

          args.symbol

        );

        const rows = await okx(

          "/api/v5/market/books",

          {

            instId: instrument.instId,

            sz: 20

          },

          5000

        );

        return toolText({

          instrument: instrument.instId,

          bids: rows[0]?.bids || [],

          asks: rows[0]?.asks || [],

          timestamp: num(rows[0]?.ts)

        });

      } catch (error) {

        return toolText({

          error: error.message

        });

      }

    }

  );

  server.registerTool(

    "get_recent_trades",

    {

      description:

        "OKX enstrümanındaki son işlemleri getirir; alım satım yapmaz.",

      inputSchema: z.object({

        market: z.enum(["spot", "usdtm", "coinm"]),

        symbol: z.string().min(2).max(40)

      })

    },

    async args => {

      try {

        const instrument = await resolveInstrument(

          args.market,

          args.symbol

        );

        return toolText({

          instrument: instrument.instId,

          trades: await okx(

            "/api/v5/market/trades",

            {

              instId: instrument.instId,

              limit: 100

            },

            5000

          )

        });

      } catch (error) {

        return toolText({

          error: error.message

        });

      }

    }

  );

  return server;

}

const mcpHandler = createMcpHandler(createServer);

export default {

  async fetch(request, env, ctx) {

    const path = new URL(request.url).pathname;

    if (path.startsWith("/api/")) {

      return api(request);

    }

    return mcpHandler(request, env, ctx);

  }

};
