import { McpServer } from "@modelcontextprotocol/server";

import { createMcpHandler } from "agents/mcp/server";

import { z } from "zod";

const OKX = "https://www.okx.com";

const VERSION = "3.0.0";

const CACHE = new Map();

const CACHE_LIMIT = 250;

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

function json(data, status = 200, origin = "") {

  const headers = {

    "content-type": "application/json; charset=utf-8",

    "cache-control": "no-store",

    "x-content-type-options": "nosniff",

    "referrer-policy": "no-referrer"

  };

  if (ALLOWED_ORIGINS.has(origin)) {

    headers["access-control-allow-origin"] = origin;

    headers["vary"] = "Origin";

    headers["access-control-allow-methods"] = "GET, OPTIONS";

    headers["access-control-allow-headers"] = "Content-Type";

  }

  return new Response(JSON.stringify(data), {

    status,

    headers

  });

}

function cacheGet(key) {

  const item = CACHE.get(key);

  if (!item || item.expires <= Date.now()) {

    CACHE.delete(key);

    return null;

  }

  return item.value;

}

function cacheSet(key, value, ttl = 15000) {

  if (CACHE.size >= CACHE_LIMIT) {

    CACHE.delete(CACHE.keys().next().value);

  }

  CACHE.set(key, {

    value,

    expires: Date.now() + ttl

  });

  return value;

}

async function okx(path, params = {}, ttl = 10000) {

  const url = new URL(path, OKX);

  for (const [key, value] of Object.entries(params)) {

    if (

      value !== undefined &&

      value !== null &&

      value !== ""

    ) {

      url.searchParams.set(key, String(value));

    }

  }

  const cacheKey = url.toString();

  const cached = cacheGet(cacheKey);

  if (cached) return cached;

  const controller = new AbortController();

  const timer = setTimeout(() => {

    controller.abort();

  }, 12000);

  try {

    const response = await fetch(url, {

      headers: {

        Accept: "application/json",

        "User-Agent": "KriptoAnalizPlatformu/3.0"

      },

      signal: controller.signal

    });

    if (!response.ok) {

      throw new Error(`OKX HTTP ${response.status}`);

    }

    const body = await response.json();

    if (body.code !== "0") {

      throw new Error(

        `OKX ${body.code}: ${body.msg || "Bilinmeyen API hatası"}`

      );

    }

    return cacheSet(cacheKey, body.data || [], ttl);

  } catch (error) {

    if (error.name === "AbortError") {

      throw new Error("OKX isteği zaman aşımına uğradı.");

    }

    throw error;

  } finally {

    clearTimeout(timer);

  }

}

function cleanSymbol(value) {

  const s = String(value || "")

    .trim()

    .toUpperCase()

    .replaceAll("_", "-");

  if (!/^[A-Z0-9-]{2,40}$/.test(s)) {

    throw new Error("Geçersiz sembol.");

  }

  return s;

}

function spotInstrument(symbol) {

  const s = cleanSymbol(symbol);

  if (s.includes("-")) return s;

  if (s.endsWith("USDT")) {

    return `${s.slice(0, -4)}-USDT`;

  }

  if (s.endsWith("USDC")) {

    return `${s.slice(0, -4)}-USDC`;

  }

  if (s.endsWith("BTC")) {

    return `${s.slice(0, -3)}-BTC`;

  }

  throw new Error(

    "Spot paritesi OKX biçiminde değil. Örnek: BTC-USDT."

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

    throw new Error(

      "Piyasa türü spot, usdtm veya coinm olmalı."

    );

  }

  const raw = cleanSymbol(symbol);

  const base = raw.includes("-")

    ? raw.split("-")[0]

    : raw.replace(/USDT$|USD$/, "");

  const list = await okx(

    "/api/v5/public/instruments",

    { instType: "SWAP" },

    60000

  );

  const candidates = list.filter(

    x => x.state === "live" && x.baseCcy === base

  );

  const chosen = market === "usdtm"

    ? candidates.find(

        x => x.settleCcy === "USDT" && x.quoteCcy === "USDT"

      )

    : candidates.find(

        x => x.settleCcy === base && x.quoteCcy === "USD"

      );

  if (!chosen) {

    throw new Error(

      `${base} için OKX ${

        market === "usdtm" ? "USDT-M" : "COIN-M"

      } canlı SWAP sözleşmesi bulunamadı.`

    );

  }

  return {

    instId: chosen.instId,

    instType: "SWAP",

    metadata: chosen

  };

}

function num(v) {

  const n = Number(v);

  return Number.isFinite(n) ? n : null;

}

function pct(a, b) {

  return a && b ? ((a - b) / b) * 100 : null;

}

function round(v, digits = 8) {

  return v == null || !Number.isFinite(v)

    ? null

    : Number(v.toFixed(digits));

}

function freshness(ts, maxAgeMs = 120000) {

  const time = Number(ts || 0);

  const age = time

    ? Math.max(0, Date.now() - time)

    : null;

  return {

    timestamp: time || null,

    ageSeconds: age == null

      ? null

      : Math.round(age / 1000),

    stale: age == null || age > maxAgeMs

  };

}

async function ticker(market, symbol) {

  const instrument = await resolveInstrument(market, symbol);

  const rows = await okx(

    "/api/v5/market/ticker",

    { instId: instrument.instId },

    5000

  );

  const t = rows[0];

  if (!t) {

    throw new Error(

      "OKX bu enstrüman için fiyat döndürmedi."

    );

  }

  const last = num(t.last);

  const open = num(t.open24h);

  return {

    source: "OKX",

    market,

    instrument: instrument.instId,

    instrumentType: instrument.instType,

    last: round(last),

    change24hPercent: round(pct(last, open), 5),

    high24h: num(t.high24h),

    low24h: num(t.low24h),

    open24h: open,

    volume24hBase: num(t.vol24h),

    volume24hQuote: num(t.volCcy24h),

    bid: num(t.bidPx),

    ask: num(t.askPx),

    timestamp: Number(t.ts),

    freshness: freshness(t.ts),

    settlementCurrency:

      instrument.metadata?.settleCcy || null,

    quoteCurrency:

      instrument.metadata?.quoteCcy || null

  };

}

function ema(values, period) {

  const out = Array(values.length).fill(null);

  if (values.length < period) return out;

  let sum = 0;

  for (let i = 0; i < period; i++) {

    sum += values[i];

  }

  let current = sum / period;

  out[period - 1] = current;

  const k = 2 / (period + 1);

  for (let i = period; i < values.length; i++) {

    current =

      values[i] * k +

      current * (1 - k);

    out[i] = current;

  }

  return out;

}

function sma(values, period) {

  if (values.length < period) return null;

  const slice = values.slice(-period);

  return slice.reduce((a, b) => a + b, 0) / period;

}

function rsi(values, period = 14) {

  if (values.length <= period) return null;

  let gain = 0;

  let loss = 0;

  for (let i = 1; i <= period; i++) {

    const d = values[i] - values[i - 1];

    gain += Math.max(d, 0);

    loss += Math.max(-d, 0);

  }

  let ag = gain / period;

  let al = loss / period;

  for (let i = period + 1; i < values.length; i++) {

    const d = values[i] - values[i - 1];

    ag =

      (ag * (period - 1) + Math.max(d, 0)) /

      period;

    al =

      (al * (period - 1) + Math.max(-d, 0)) /

      period;

  }

  if (al === 0) {

    return ag === 0 ? 50 : 100;

  }

  return 100 - 100 / (1 + ag / al);

}

function stochRsi(values, period = 14) {

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

    .filter(v => v != null);

  if (recent.length < period) return null;

  const current = recent.at(-1);

  const low = Math.min(...recent);

  const high = Math.max(...recent);

  return high === low

    ? 50

    : (current - low) / (high - low) * 100;

}

function atr(candles, period = 14) {

  if (candles.length <= period) return null;

  const trs = [];

  for (let i = 1; i < candles.length; i++) {

    const c = candles[i];

    const prev = candles[i - 1].close;

    trs.push(

      Math.max(

        c.high - c.low,

        Math.abs(c.high - prev),

        Math.abs(c.low - prev)

      )

    );

  }

  let value =

    trs.slice(0, period).reduce((a, b) => a + b, 0) /

    period;

  for (let i = period; i < trs.length; i++) {

    value =

      (value * (period - 1) + trs[i]) /

      period;

  }

  return value;

}

function adx(candles, period = 14) {

  if (candles.length < period * 2 + 1) {

    return null;

  }

  const plus = [];

  const minus = [];

  const tr = [];

  for (let i = 1; i < candles.length; i++) {

    const a = candles[i - 1];

    const b = candles[i];

    const up = b.high - a.high;

    const down = a.low - b.low;

    plus.push(

      up > down && up > 0 ? up : 0

    );

    minus.push(

      down > up && down > 0 ? down : 0

    );

    tr.push(

      Math.max(

        b.high - b.low,

        Math.abs(b.high - a.close),

        Math.abs(b.low - a.close)

      )

    );

  }

  const dx = [];

  for (let i = period - 1; i < tr.length; i++) {

    const trSum = tr

      .slice(i - period + 1, i + 1)

      .reduce((a, b) => a + b, 0);

    if (!trSum) continue;

    const p =

      plus

        .slice(i - period + 1, i + 1)

        .reduce((a, b) => a + b, 0) /

      trSum * 100;

    const m =

      minus

        .slice(i - period + 1, i + 1)

        .reduce((a, b) => a + b, 0) /

      trSum * 100;

    dx.push(

      p + m

        ? Math.abs(p - m) / (p + m) * 100

        : 0

    );

  }

  return dx.length >= period

    ? dx.slice(-period).reduce((a, b) => a + b, 0) / period

    : null;

}
 function analyze(candles) {

  if (candles.length < 60) {

    throw new Error(

      "En az 60 kapanmış mum olmadan güvenilir analiz üretilemez."

    );

  }

  const closes = candles.map(x => x.close);

  const last = closes.at(-1);

  const emaValues = {};

  for (const p of [9, 20, 50, 100, 200]) {

    emaValues[p] = ema(closes, p).at(-1) ?? null;

  }

  const ema12 = ema(closes, 12);

  const ema26 = ema(closes, 26);

  const macdLine = ema12

    .map((v, i) =>

      v == null || ema26[i] == null

        ? null

        : v - ema26[i]

    )

    .filter(v => v != null);

  const macdSignal = ema(macdLine, 9).at(-1) ?? null;

  const macdNow = macdLine.at(-1) ?? null;

  const period = closes.slice(-20);

  const mean =

    period.reduce((a, b) => a + b, 0) /

    period.length;

  const sd = Math.sqrt(

    period.reduce(

      (a, b) => a + (b - mean) ** 2,

      0

    ) / period.length

  );

  const r = rsi(closes);

  const sr = stochRsi(closes);

  const a = atr(candles);

  const d = adx(candles);

  const recentHigh = Math.max(

    ...candles.slice(-20).map(x => x.high)

  );

  const recentLow = Math.min(

    ...candles.slice(-20).map(x => x.low)

  );

  const vwapVol = candles

    .slice(-20)

    .reduce((s, c) => s + c.volume, 0);

  const vwap = vwapVol

    ? candles

        .slice(-20)

        .reduce(

          (s, c) =>

            s +

            ((c.high + c.low + c.close) / 3) *

              c.volume,

          0

        ) / vwapVol

    : null;

  let score = 0;

  const reasons = [];

  if (

    emaValues[20] != null &&

    emaValues[50] != null

  ) {

    if (

      last > emaValues[20] &&

      emaValues[20] > emaValues[50]

    ) {

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

  }

  if (r != null) {

    if (r > 55 && r < 70) {

      score++;

      reasons.push(

        "RSI pozitif momentum bölgesinde."

      );

    } else if (r < 45 && r > 30) {

      score--;

      reasons.push(

        "RSI negatif momentum bölgesinde."

      );

    } else if (r >= 70) {

      reasons.push(

        "RSI aşırı alım bölgesinde; geri çekilme riski var."

      );

    } else if (r <= 30) {

      reasons.push(

        "RSI aşırı satım bölgesinde; tepki ihtimali var ancak dönüş teyidi yok."

      );

    }

  }

  if (

    macdNow != null &&

    macdSignal != null

  ) {

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

  }

  if (vwap != null) {

    if (last > vwap) {

      score++;

    } else {

      score--;

    }

  }

  if (d != null && d < 18) {

    reasons.push(

      "ADX zayıf trend gücüne işaret ediyor; yatay piyasa olasılığı yüksek."

    );

  }

  let signal =

    score >= 4

      ? "GÜÇLÜ AL"

      : score >= 2

        ? "AL"

        : score <= -4

          ? "GÜÇLÜ SAT"

          : score <= -2

            ? "SAT"

            : "TUT";

  if (

    [last, r, emaValues[20], macdNow, macdSignal, a]

      .some(v => v == null) ||

    !Number.isFinite(last)

  ) {

    signal = "SİNYAL YOK";

    reasons.push(

      "Gerekli göstergelerden biri hesaplanamadı."

    );

  }

  const shortBias = score < 0;

  const stop = a

    ? (

        shortBias

          ? last + 1.5 * a

          : last - 1.5 * a

      )

    : null;

  const risk = stop != null

    ? Math.abs(stop - last)

    : null;

  return {

    candleCount: candles.length,

    lastClosedCandleOpenTime:

      candles.at(-1).time,

    lastPrice: round(last),

    rsi14: round(r, 3), 
    stochasticRsi14: round(sr, 3),

    ema: Object.fromEntries(

      Object.entries(emaValues).map(

        ([k, v]) => [k, round(v)]

      )

    ),

    sma50: round(sma(closes, 50)),

    sma200: round(sma(closes, 200)),

    macd: round(macdNow),

    macdSignal: round(macdSignal),

    bollinger: {

      upper: round(mean + 2 * sd),

      middle: round(mean),

      lower: round(mean - 2 * sd)

    },

    atr14: round(a),

    adx14: round(d),

    vwap20: round(vwap),

    support20: round(recentLow),

    resistance20: round(recentHigh),

    score,

    signal,

    reasons,

    riskModel:

      signal === "SİNYAL YOK"

        ? null

        : {

            direction: shortBias

              ? "short-scenario"

              : "long-scenario",

            stopLossIllustrative: round(stop),

            target1Illustrative: round(

              shortBias

                ? last - 2 * (risk || 0)

                : last + 2 * (risk || 0)

            ),

            target2Illustrative: round(

              shortBias

                ? last - 3 * (risk || 0)

                : last + 3 * (risk || 0)

            ),

            note:

              "Örnek ATR tabanlı seviyelerdir; emir veya yatırım tavsiyesi değildir."

          }

  };

}

async function candles(

  market,

  symbol,

  interval = "1h",

  limit = 250

) {

  const cfg = BAR[interval];

  if (!cfg) {

    throw new Error("Desteklenmeyen zaman dilimi.");

  }

  const safeLimit = Math.max(

    60,

    Math.min(300, Number(limit) || 200)

  );

  const instrument = await resolveInstrument(

    market,

    symbol

  );

  const rows = await okx(

    "/api/v5/market/candles",

    {

      instId: instrument.instId,

      bar: cfg.okx,

      limit: safeLimit

    },

    10000

  );

  const parsed = rows

    .map(row => ({

      time: Number(row[0]),

      open: num(row[1]),

      high: num(row[2]),

      low: num(row[3]),

      close: num(row[4]),

      volume: num(row[5]),

      confirm: String(row[8] || "0")

    }))

    .filter(c =>

      [

        c.time,

        c.open,

        c.high,

        c.low,

        c.close

      ].every(Number.isFinite)

    );

  const closed = parsed

    .filter(

      c =>

        c.confirm === "1" &&

        c.time + cfg.ms <= Date.now()

    )

    .sort((a, b) => a.time - b.time);

  return {

    instrument,

    candles: closed,

    newestRawTimestamp: parsed.length

      ? Math.max(...parsed.map(x => x.time))

      : null

  };

}

async function derivatives(symbol) {

  const instrument = await resolveInstrument(

    "usdtm",

    symbol

  );

  const [funding, interest, mark] =

    await Promise.all([

      okx(

        "/api/v5/public/funding-rate",

        { instId: instrument.instId },

        15000

      ),

      okx(

        "/api/v5/public/open-interest",

        {

          instType: "SWAP",

          instId: instrument.instId

        },

        15000

      ),

      okx(

        "/api/v5/public/mark-price",

        {

          instType: "SWAP",

          instId: instrument.instId

        },

        15000

      )

    ]);

  return {

    instrument: instrument.instId,

    fundingRate: num(funding[0]?.fundingRate),

    nextFundingTime:

      num(funding[0]?.nextFundingTime),

    openInterest: num(interest[0]?.oi),

    openInterestCurrency:

      interest[0]?.oiCcy || null,

    markPrice: num(mark[0]?.markPx),

    timestamp: Date.now(),

    note:

      "Açık pozisyon birimi sözleşme türüne göre değişebilir; ham birim ayrıca belirtilir."

  };

}

async function marketList(market, limit = 500) {

  const safeLimit = Math.min(

    500,

    Math.max(1, Number(limit) || 500)

  );

  if (market === "spot") {

    const rows = await okx(

      "/api/v5/market/tickers",

      { instType: "SPOT" },

      15000

    );

    return rows

      .filter(t => t.instId.endsWith("-USDT"))

      .sort(

        (a, b) =>

          (num(b.volCcy24h) || 0) -

          (num(a.volCcy24h) || 0)

      )

      .slice(0, safeLimit)

      .map(t => ({

        symbol: t.instId.replaceAll("-", ""),

        instrument: t.instId,

        market: "spot",

        last: num(t.last),

        change24hPercent: round(

          pct(num(t.last), num(t.open24h)),

          5

        ),

        volume24hBase: num(t.vol24h),

        volume24hQuote: num(t.volCcy24h),

        high24h: num(t.high24h),

        low24h: num(t.low24h),

        timestamp: Number(t.ts)

      }));

  }

  if (

    market !== "usdtm" &&

    market !== "coinm"

  ) {

    throw new Error(

      "Piyasa türü spot, usdtm veya coinm olmalı."

    );

  }

  const [rows, meta] = await Promise.all([

    okx(

      "/api/v5/market/tickers",

      { instType: "SWAP" },

      15000

    ),

    okx(

      "/api/v5/public/instruments",

      { instType: "SWAP" },

      60000

    )

  ]);

  const byId = new Map(

    meta.map(x => [x.instId, x])

  );

  return rows

    .filter(t => {

      const m = byId.get(t.instId);

      return (

        m &&

        m.state === "live" &&

        (

          market === "usdtm"

            ? m.settleCcy === "USDT"

            : m.settleCcy !== "USDT" &&

              m.quoteCcy === "USD"

        )

      );

    })

    .sort(

      (a, b) =>

        (num(b.volCcy24h) || 0) -

        (num(a.volCcy24h) || 0)

    )

    .slice(0, safeLimit)

    .map(t => ({

      symbol: t.instId,

      instrument: t.instId,

      market,

      last: num(t.last),

      change24hPercent: round(

        pct(num(t.last), num(t.open24h)),

        5

      ),

      volume24hBase: num(t.vol24h),

      volume24hQuote: num(t.volCcy24h),

      high24h: num(t.high24h),

      low24h: num(t.low24h),

      settlementCurrency:

        byId.get(t.instId).settleCcy,

      timestamp: Number(t.ts)

    }));

}

async function scan(limit = 500, minQuoteVolume = 0) {

  const [tickers, instruments] = await Promise.all([

    okx(

      "/api/v5/market/tickers",

      { instType: "SPOT" },

      15000

    ),

    okx(

      "/api/v5/public/instruments",

      { instType: "SWAP" },

      60000

    )

  ]);

  const liveUsdt = new Set(

    instruments

      .filter(

        x =>

          x.state === "live" &&

          x.settleCcy === "USDT"

      )

      .map(x => x.baseCcy)

  );

  const liveCoin = new Set(

    instruments

      .filter(

        x =>

          x.state === "live" &&

          x.settleCcy !== "USDT" &&

          x.quoteCcy === "USD"

      )

      .map(x => x.baseCcy)

  );

  const items = tickers

    .filter(

      t =>

        t.instId.endsWith("-USDT") &&

        num(t.last) > 0 &&

        num(t.volCcy24h) >= minQuoteVolume

    )

    .sort(

      (a, b) =>

        (num(b.volCcy24h) || 0) -

        (num(a.volCcy24h) || 0)

    )

    .slice(

      0,

      Math.min(500, Math.max(1, limit))

    )

    .map(t => {

      const base = t.instId.split("-")[0];

      return {

        asset: base,

        spotInstrument: t.instId,

        last: num(t.last),

        change24hPercent: round(

          pct(num(t.last), num(t.open24h)),

          5

        ),

        quoteVolume24h: num(t.volCcy24h),

        hasUsdtm: liveUsdt.has(base),

        hasCoinm: liveCoin.has(base),

        timestamp: Number(t.ts)

      };

    });

  return {

    source: "OKX",

    count: items.length,

    requestedLimit: limit,

    scannedAt: Date.now(),

    items,

    note:

      "Tarama OKX Spot USDT paritelerine göre sıralanır. Market cap verisi OKX ticker tarafından sağlanmadığından üretilmez."

  };

}

async function api(request, env) {

  const url = new URL(request.url);

  const origin =

    request.headers.get("Origin") || "";

  if (request.method === "OPTIONS") {

    return new Response(null, {

      status: 204,

      headers: {

        "access-control-allow-origin":

          ALLOWED_ORIGINS.has(origin)

            ? origin

            : "null",

        "access-control-allow-methods":

          "GET, OPTIONS",

        "access-control-allow-headers":

          "Content-Type",

        "vary": "Origin"

      }

    });

  }

  if (request.method !== "GET") {

    return json(

      { error: "Yalnızca GET desteklenir." },

      405,

      origin

    );

  }

  try {

    const p = url.pathname;

    const q = url.searchParams;

    if (p === "/api/health") {

      const t = await ticker("spot", "BTC-USDT");

      return json({

        status: "ok",

        version: VERSION,

        source: "OKX",

        publicMarketData: true,

        serverTime: Date.now(),

        btc: t

      }, 200, origin);

    }

    if (p === "/api/markets") {

      const market = q.get("market") || "spot";

      return json({

        market,

        source: "OKX",

        items: await marketList(

          market,

          Number(q.get("limit") || 500)

        )

      }, 200, origin);

    }

    if (p === "/api/ticker") {

      return json(

        await ticker(

          q.get("market") || "spot",

          q.get("symbol") ||

            q.get("instId") ||

            "BTCUSDT"

        ),

        200,

        origin

      );

    }

    if (p === "/api/analysis") {

      const market =

        q.get("market") || "spot";

      const symbol =

        q.get("symbol") || "BTCUSDT";

      const interval =

        q.get("interval") || "1h";

      const data = await candles(

        market,

        symbol,

        interval,

        Number(q.get("limit") || 250)

      );

      const result = analyze(data.candles);

      const dataFreshness = freshness(

        result.lastClosedCandleOpenTime +

          BAR[interval].ms,

        BAR[interval].ms * 2

      );

      if (dataFreshness.stale) {

        result.signal = "SİNYAL YOK";

        result.reasons.push(

          "Son kapanmış mum verisi beklenenden eski; sinyal güvenilir değil."

        );

        result.riskModel = null;

      }

      return json({

        market,

        symbol,

        instrument: data.instrument.instId,

        interval,

        source: "OKX",

        analysis: result,

        dataFreshness,

        warning:

          "Bu çıktı araştırma amaçlı teknik analizdir; yatırım tavsiyesi veya işlem emri değildir."

      }, 200, origin);

    }

    if (p === "/api/candles") {

      const d = await candles(

        q.get("market") || "spot",

        q.get("symbol") || "BTCUSDT",

        q.get("interval") || "1h",

        Number(q.get("limit") || 250)

      );

      return json({

        instrument: d.instrument.instId,

        candles: d.candles

      }, 200, origin);

    }

    if (p === "/api/derivatives") {

      return json(

        await derivatives(

          q.get("symbol") || "BTCUSDT"

        ),

        200,

        origin

      );

    }

    if (p === "/api/orderbook") {

      const inst = await resolveInstrument(

        q.get("market") || "spot",

        q.get("symbol") || "BTCUSDT"

      );

      const rows = await okx(

        "/api/v5/market/books",

        {

          instId: inst.instId,

          sz: Math.min(

            50,

            Math.max(

              1,

              Number(q.get("depth") || 20)

            )

          )

        },

        5000

      );

      return json({

        instrument: inst.instId,

        bids: rows[0]?.bids || [],

        asks: rows[0]?.asks || [],

        timestamp: Number(

          rows[0]?.ts || Date.now()

        )

      }, 200, origin);

    }

    if (p === "/api/trades") {

      const inst = await resolveInstrument(

        q.get("market") || "spot",

        q.get("symbol") || "BTCUSDT"

      );

      const rows = await okx(

        "/api/v5/market/trades",

        {

          instId: inst.instId,

          limit: Math.min(

            100,

            Math.max(

              1,

              Number(q.get("limit") || 50)

            )

          )

        },

        5000

      );

      return json({

        instrument: inst.instId,

        trades: rows

      }, 200, origin);

    }

    if (p === "/api/scan") {

      return json(

        await scan(

          Number(q.get("limit") || 500),

          Number(q.get("minQuoteVolume") || 0)

        ),

        200,

        origin

      );

    }

    if (p === "/api/ai/providers") {

      return json({

        enabled: false,

        reason:

          "AI sağlayıcıları henüz etkinleştirilmedi. Önce kullanıcı bazlı erişim, kota ve anahtar güvenliği kurulmalıdır.",

        providers: [

          "Gemini",

          "Groq",

          "Mistral",

          "OpenRouter",

          "Cloudflare Workers AI"

        ]

      }, 200, origin);

    }

    return json({

      error: "API yolu bulunamadı.",

      available: [

        "/api/health",

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

    }, 404, origin);

  } catch (error) {

    return json({

      error:

        error.message ||

        "Beklenmeyen sunucu hatası.",

      signal: "SİNYAL YOK",

      source: "OKX",

      timestamp: Date.now()

    }, 502, origin);

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

        "OKX herkese açık piyasa verisi bağlantısını BTC-USDT üzerinden kontrol eder. Emir veya hesap erişimi yapmaz.",

      inputSchema: z.object({})

    },

    async () => {

      try {

        return toolText({

          status: "ok",

          version: VERSION,

          btc: await ticker("spot", "BTC-USDT")

        });

      } catch (e) {

        return toolText({

          status: "error",

          error: e.message

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

        market: z.enum([

          "spot",

          "usdtm",

          "coinm"

        ]),

        symbol: z.string().min(2).max(40)

      })

    },

    async a => {

      try {

        return toolText(

          await ticker(a.market, a.symbol)

        );

      } catch (e) {

        return toolText({

          error: e.message,

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

        market: z.enum([

          "spot",

          "usdtm",

          "coinm"

        ]),

        symbol: z.string().min(2).max(40),

        interval: z.enum([

          "5m",

          "15m",

          "1h",

          "4h",

          "1d",

          "1w"

        ]).default("1h")

      })

    },

    async a => {

      try {

        const d = await candles(

          a.market,

          a.symbol,

          a.interval,

          250

        );

        const result = analyze(d.candles);

        const dataFreshness = freshness(

          result.lastClosedCandleOpenTime +

            BAR[a.interval].ms,

          BAR[a.interval].ms * 2

        );

        if (dataFreshness.stale) {

          result.signal = "SİNYAL YOK";

          result.reasons.push(

            "Son kapanmış mum verisi beklenenden eski; sinyal güvenilir değil."

          );

          result.riskModel = null;

        }

        return toolText({

          source: "OKX",

          instrument: d.instrument.instId,

          interval: a.interval,

          analysis: result,

          dataFreshness

        });

      } catch (e) {

        return toolText({

          error: e.message,

          signal: "SİNYAL YOK"

        });

      }

    }

  );

  server.registerTool(

    "get_derivatives_snapshot",

    {

      description:

        "OKX USDT-M SWAP için fonlama, açık pozisyon ve mark fiyatı bilgisi verir.",

      inputSchema: z.object({

        symbol: z.string().min(2).max(40)

      })

    },

    async a => {

      try {

        return toolText(

          await derivatives(a.symbol)

        );

      } catch (e) {

        return toolText({

          error: e.message

        });

      }

    }

  );

  server.registerTool(

    "scan_market_universe",

    {

      description:

        "OKX Spot USDT piyasasını hacme göre en fazla 500 varlığa kadar tarar ve vadeli sözleşme varlığını metadata üzerinden eşleştirir.",

      inputSchema: z.object({

        limit: z.number()

          .int()

          .min(1)

          .max(500)

          .default(500),

        minQuoteVolume: z.number()

          .min(0)

          .default(0)

      })

    },

    async a => {

      try {

        return toolText(

          await scan(

            a.limit,

            a.minQuoteVolume

          )

        );

      } catch (e) {

        return toolText({

          error: e.message,

          items: []

        });

      }

    }

  );

  server.registerTool(

    "get_orderbook_analysis",

    {

      description:

        "OKX emir defterinin ilk 20 seviyesini getirir. Emir göndermez.",

      inputSchema: z.object({

        market: z.enum([

          "spot",

          "usdtm",

          "coinm"

        ]),

        symbol: z.string().min(2).max(40)

      })

    },

    async a => {

      try {
         const i = await resolveInstrument(

          a.market,

          a.symbol

        );

        const r = await okx(

          "/api/v5/market/books",

          {

            instId: i.instId,

            sz: 20

          },

          5000

        );

        return toolText({

          instrument: i.instId,

          bids: r[0]?.bids || [],

          asks: r[0]?.asks || [],

          timestamp: r[0]?.ts

        });

      } catch (e) {

        return toolText({

          error: e.message

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

        market: z.enum([

          "spot",

          "usdtm",

          "coinm"

        ]),

        symbol: z.string().min(2).max(40)

      })

    },

    async a => {

      try {

        const i = await resolveInstrument(

          a.market,

          a.symbol

        );

        return toolText({

          instrument: i.instId,

          trades: await okx(

            "/api/v5/market/trades",

            {

              instId: i.instId,

              limit: 100

            },

            5000

          )

        });

      } catch (e) {

        return toolText({

          error: e.message

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

      return api(request, env);

    }

    return mcpHandler(request, env, ctx);

  }

};
