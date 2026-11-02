"use strict";

(() => {

  const CONFIG = {

    coinGecko: "https://api.coingecko.com/api/v3",

    binanceSpot: "https://api.binance.com",

    binanceUsdt: "https://fapi.binance.com",

    binanceCoin: "https://dapi.binance.com",

    refreshMs: 60000,

    marketLimit: 100,

    watchlistKey: "kriptoAnalizIzlemeListesi",

    pinned: [

      "bitcoin", "ethereum", "solana", "cardano",

      "ripple", "dogecoin", "avalanche-2", "pepe"

    ],

    timeframes: ["5m", "15m", "1h", "4h", "1d", "1w"]

  };

  const state = {

    currency: "usd",

    market: "spot",

    coins: [],

    filtered: [],

    watchlist: [],

    signals: [],

    selectedCoin: "",

    loading: false,

    analysisLoading: false,

    refreshTimer: null,

    lastUpdated: null

  };

  const $ = (id) => document.getElementById(id);

  const el = {};

  function cacheElements() {

    [

      "connection-status", "refresh-button", "currency-select",

      "market-type", "last-updated", "btc-price", "btc-change",

      "market-overview-message", "currency-note", "coin-search",

      "market-sort", "market-table-body", "market-message",

      "signal-filter", "signal-table-body", "signal-message",

      "analysis-coin", "analysis-timeframe", "analysis-market",

      "coin-detail", "technical-analysis-results",

      "analysis-message", "watchlist-form", "watchlist-coin",

      "watchlist-items", "watchlist-message"

    ].forEach((id) => {

      el[id] = $(id);

    });

  }

  function announce(message) {

    if (el["connection-status"]) {

      el["connection-status"].textContent = message;

    }

  }

  function message(id, text, type = "") {

    if (!el[id]) return;

    el[id].textContent = text;

    el[id].className = "status-message " + type;

  }

  function number(value, digits = 2) {

    const n = Number(value);

    if (!Number.isFinite(n)) return "Veri yok";

    return new Intl.NumberFormat("tr-TR", {

      maximumFractionDigits: digits

    }).format(n);

  }

  function price(value, currency = state.currency) {

    const n = Number(value);

    if (!Number.isFinite(n)) return "Veri yok";

    if (currency === "usdt") {

      return number(n, n < 1 ? 8 : 2) + " USDT";

    }

    return new Intl.NumberFormat("tr-TR", {

      style: "currency",

      currency: currency.toUpperCase(),

      maximumFractionDigits: n < 1 ? 8 : 2

    }).format(n);

  }

  function percent(value) {

    const n = Number(value);

    if (!Number.isFinite(n)) return "Veri yok";

    return (n > 0 ? "+" : "") + number(n, 2) + "%";

  }

  function signClass(value) {

    const n = Number(value);

    if (!Number.isFinite(n) || n === 0) return "neutral";

    return n > 0 ? "positive" : "negative";

  }

  async function request(url) {

    const response = await fetch(url, {

      method: "GET",

      headers: { Accept: "application/json" }

    });

    if (!response.ok) {

      if (response.status === 429) {

        throw new Error("Veri kaynağının istek sınırına ulaşıldı. Biraz sonra tekrar deneyin.");

      }

      throw new Error("Veri kaynağı HTTP " + response.status + " hatası döndürdü.");

    }

    return response.json();

  }

  function coinById(id) {

    return state.coins.find((coin) => coin.id === id);

  }

  function coinSymbol(coin) {

    return String(coin?.symbol || "").toUpperCase();

  }

  function formatMarketValue(value) {

    const n = Number(value);

    if (!Number.isFinite(n)) return "Veri yok";

    if (n >= 1e12) return number(n / 1e12, 2) + " trilyon";

    if (n >= 1e9) return number(n / 1e9, 2) + " milyar";

    if (n >= 1e6) return number(n / 1e6, 2) + " milyon";

    return number(n, 0);

  }

  function setCurrencyNote() {

    if (!el["currency-note"]) return;

    if (state.currency === "usdt") {

      el["currency-note"].textContent =

        "USDT gösterimi spot fiyatlarda CoinGecko USD karşılığına dayanır; birebir USDT işlem fiyatı değildir. Vadeli piyasa verileri USDT veya sözleşme birimi cinsindendir.";

    } else {

      el["currency-note"].textContent =

        "Spot fiyatlar seçilen para biriminde gösterilir. Vadeli sözleşme verileri kendi kotasyon biriminde sunulur.";

    }

  }

  async function fetchSpotMarkets() {

    const currency = state.currency === "usdt" ? "usd" : state.currency;

    const params = new URLSearchParams({

      vs_currency: currency,

      order: "market_cap_desc",

      per_page: String(CONFIG.marketLimit),

      page: "1",

      sparkline: "false",

      price_change_percentage: "24h"

    });

    const data = await request(

      CONFIG.coinGecko + "/coins/markets?" + params.toString()

    );

    if (!Array.isArray(data)) {

      throw new Error("Piyasa verisi beklenen biçimde gelmedi.");

    }

    const found = new Set(data.map((coin) => coin.id));

    const missing = CONFIG.pinned.filter((id) => !found.has(id));

    if (missing.length) {

      try {

        const extra = await request(

          CONFIG.coinGecko + "/coins/markets?" +

          new URLSearchParams({

            vs_currency: currency,

            ids: missing.join(","),

            order: "market_cap_desc",

            per_page: String(missing.length),

            page: "1",

            sparkline: "false",

            price_change_percentage: "24h"

          }).toString()

        );

        if (Array.isArray(extra)) data.push(...extra);

      } catch (_) {

        // Ana piyasa verisi geldiyse ek coin isteğinin hatası engel değildir.

      }

    }

    return data;

  }

  function renderBitcoin() {

    const btc = coinById("bitcoin");

    if (!btc) return;

    if (el["btc-price"]) {

      el["btc-price"].textContent = price(btc.current_price);

    }

    if (el["btc-change"]) {

      el["btc-change"].textContent =

        "24 saat: " + percent(btc.price_change_percentage_24h);

      el["btc-change"].className =

        "change-value " + signClass(btc.price_change_percentage_24h);

    }

    if (el["market-overview-message"]) {

      el["market-overview-message"].textContent =

        state.coins.length + " coin listelendi. Veriler son güncelleme zamanına aittir.";

    }

  }

  function renderMarketTable() {

    const body = el["market-table-body"];

    if (!body) return;

    let coins = [...state.filtered];

    const sort = el["market-sort"]?.value || "market-cap";

    if (sort === "change-desc") {

      coins.sort((a, b) =>

        (b.price_change_percentage_24h || 0) -

        (a.price_change_percentage_24h || 0)

      );

    } else if (sort === "change-asc") {

      coins.sort((a, b) =>

        (a.price_change_percentage_24h || 0) -

        (b.price_change_percentage_24h || 0)

      );

    } else if (sort === "volume") {

      coins.sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0));

    } else {

      coins.sort((a, b) => (a.market_cap_rank || 999999) - (b.market_cap_rank || 999999));

    }

    if (!coins.length) {

      body.innerHTML = '<tr><td colspan="5">Aramanızla eşleşen coin bulunamadı.</td></tr>';

      return;

    }

    const fragment = document.createDocumentFragment();

    coins.forEach((coin) => {

      const row = document.createElement("tr");

      const nameCell = document.createElement("td");

      const selectButton = document.createElement("button");

      selectButton.type = "button";

      selectButton.className = "coin-name-button";

      selectButton.textContent =

        coin.name + " (" + coinSymbol(coin) + ")";

      selectButton.setAttribute(

        "aria-label",

        coin.name + " ayrıntılı analizini aç"

      );

      selectButton.addEventListener("click", () => {

        openCoinAnalysis(coin.id);

      });

      nameCell.appendChild(selectButton);

      row.appendChild(nameCell);

      row.appendChild(makeCell(price(coin.current_price)));

      row.appendChild(makeCell(

        percent(coin.price_change_percentage_24h),

        signClass(coin.price_change_percentage_24h)

      ));

      row.appendChild(makeCell(formatMarketValue(coin.market_cap)));

      const actionCell = document.createElement("td");

      const detailButton = document.createElement("button");

      detailButton.type = "button";

      detailButton.textContent = "Analiz et";

      detailButton.setAttribute("aria-label", coin.name + " analiz et");

      detailButton.addEventListener("click", () => openCoinAnalysis(coin.id));

      actionCell.appendChild(detailButton);

      row.appendChild(actionCell);

      fragment.appendChild(row);

    });

    body.replaceChildren(fragment);

  }

  function makeCell(text, className = "") {

    const cell = document.createElement("td");

    cell.textContent = text;

    if (className) cell.className = className;

    return cell;

  }

  function searchCoins() {

    const query = (el["coin-search"]?.value || "")

      .trim().toLocaleLowerCase("tr-TR");

    state.filtered = state.coins.filter((coin) => {

      if (!query) return true;

      return (

        String(coin.name).toLocaleLowerCase("tr-TR").includes(query) ||

        coinSymbol(coin).toLocaleLowerCase("tr-TR").includes(query) ||

        String(coin.id).toLocaleLowerCase("tr-TR").includes(query)

      );

    });

    renderMarketTable();

    message("market-message", state.filtered.length + " coin bulundu.");

  }

  function fillAnalysisOptions() {

    const select = el["analysis-coin"];

    if (!select) return;

    const previous = state.selectedCoin || select.value;

    const fragment = document.createDocumentFragment();

    const first = document.createElement("option");

    first.value = "";

    first.textContent = "Coin seçin";

    fragment.appendChild(first);

    state.coins.forEach((coin) => {

      const option = document.createElement("option");

      option.value = coin.id;

      option.textContent = coin.name + " (" + coinSymbol(coin) + ")";

      fragment.appendChild(option);

    });

    select.replaceChildren(fragment);

    if (previous && coinById(previous)) {

      select.value = previous;

    }

  }

  function saveWatchlist() {

    try {

      localStorage.setItem(CONFIG.watchlistKey, JSON.stringify(state.watchlist));

    } catch (_) {

      message("watchlist-message", "Takip listesi cihazınıza kaydedilemedi.", "error-message");

    }

  }

  function loadWatchlist() {

    try {

      const value = JSON.parse(localStorage.getItem(CONFIG.watchlistKey) || "[]");

      state.watchlist = Array.isArray(value)

        ? value.filter((id) => typeof id === "string")

        : [];

    } catch (_) {

      state.watchlist = [];

    }

  }

  function renderWatchlist() {

    const list = el["watchlist-items"];

    if (!list) return;

    list.replaceChildren();

    if (!state.watchlist.length) {

      const item = document.createElement("li");

      item.textContent = "Takip listeniz henüz boş.";

      list.appendChild(item);

      return;

    }

    state.watchlist.forEach((id) => {

      const coin = coinById(id);

      const item = document.createElement("li");

      const wrapper = document.createElement("div");

      wrapper.className = "watchlist-item";

      const label = document.createElement("span");

      label.textContent = coin

        ? coin.name + " (" + coinSymbol(coin) + ")"

        : id;

      const remove = document.createElement("button");

      remove.type = "button";

      remove.textContent = "Listeden çıkar";

      remove.setAttribute("aria-label", label.textContent + " listesinden çıkar");

      remove.addEventListener("click", () => {

        state.watchlist = state.watchlist.filter((itemId) => itemId !== id);

        saveWatchlist();

        renderWatchlist();

        message("watchlist-message", "Coin takip listenizden çıkarıldı.");

      });

      wrapper.append(label, remove);

      item.appendChild(wrapper);

      list.appendChild(item);

    });

  }

  function addWatchlist() {

    const input = el["watchlist-coin"];

    const query = (input?.value || "").trim().toLocaleLowerCase("tr-TR");

    if (!query) return;

    const coin = state.coins.find((item) =>

      item.id.toLocaleLowerCase("tr-TR") === query ||

      item.name.toLocaleLowerCase("tr-TR") === query ||

      coinSymbol(item).toLocaleLowerCase("tr-TR") === query

    );

    if (!coin) {

      message("watchlist-message", "Coin bulunamadı. Önce piyasa listesinden verilerin yüklenmesini bekleyin.", "error-message");

      return;

    }

    if (state.watchlist.includes(coin.id)) {

      message("watchlist-message", "Bu coin zaten takip listenizde.");

      return;

    }

    state.watchlist.push(coin.id);

    saveWatchlist();

    renderWatchlist();

    input.value = "";

    message("watchlist-message", coin.name + " takip listenize eklendi.", "success-message");

  }

  function average(values) {

    if (!values.length) return null;

    return values.reduce((sum, value) => sum + value, 0) / values.length;

  }

  function ema(values, period) {

    if (values.length < period) return [];

    const multiplier = 2 / (period + 1);

    let previous = average(values.slice(0, period));

    const result = [previous];

    for (let i = period; i < values.length; i++) {

      previous = (values[i] - previous) * multiplier + previous;

      result.push(previous);

    }

    return result;

  }

  function sma(values, period) {

    if (values.length < period) return null;

    return average(values.slice(-period));

  }

  function rsi(values, period = 14) {

    if (values.length <= period) return null;

    let gains = 0;

    let losses = 0;

    for (let i = 1; i <= period; i++) {

      const diff = values[i] - values[i - 1];

      if (diff > 0) gains += diff;

      else losses += Math.abs(diff);

    }

    let avgGain = gains / period;

    let avgLoss = losses / period;

    for (let i = period + 1; i < values.length; i++) {

      const diff = values[i] - values[i - 1];

      avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;

      avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;

    }

    if (avgLoss === 0) return 100;

    return 100 - 100 / (1 + avgGain / avgLoss);

  }

  function macd(values) {

    const fast = ema(values, 12);

    const slow = ema(values, 26);

    if (!fast.length || !slow.length) return null;

    const offset = fast.length - slow.length;

    const line = slow.map((value, index) => fast[index + offset] - value);

    const signalLine = ema(line, 9);

    if (!signalLine.length) return null;

    const lineValue = line[line.length - 1];

    const signalValue = signalLine[signalLine.length - 1];

    return {

      line: lineValue,

      signal: signalValue,

      histogram: lineValue - signalValue

    };

  }

  function bollinger(values, period = 20) {

    if (values.length < period) return null;

    const sample = values.slice(-period);

    const mid = average(sample);

    const variance = average(sample.map((v) => Math.pow(v - mid, 2)));

    const deviation = Math.sqrt(variance);

    return {

      upper: mid + deviation * 2,

      middle: mid,

      lower: mid - deviation * 2

    };

  }

  function atr(candles, period = 14) {

    if (candles.length <= period) return null;

    const ranges = [];

    for (let i = 1; i < candles.length; i++) {

      const current = candles[i];

      const previous = candles[i - 1];

      ranges.push(Math.max(

        current.high - current.low,

        Math.abs(current.high - previous.close),

        Math.abs(current.low - previous.close)

      ));

    }

    return average(ranges.slice(-period));

  }

  function adx(candles, period = 14) {

    if (candles.length <= period + 1) return null;

    const plus = [];

    const minus = [];

    const tr = [];

    for (let i = 1; i < candles.length; i++) {

      const current = candles[i];

      const previous = candles[i - 1];

      const up = current.high - previous.high;

      const down = previous.low - current.low;

      plus.push(up > down && up > 0 ? up : 0);

      minus.push(down > up && down > 0 ? down : 0);

      tr.push(Math.max(

        current.high - current.low,

        Math.abs(current.high - previous.close),

        Math.abs(current.low - previous.close)

      ));

    }

    const trSum = tr.slice(-period).reduce((a, b) => a + b, 0);

    if (!trSum) return null;

    const plusDI = 100 * plus.slice(-period).reduce((a, b) => a + b, 0) / trSum;

    const minusDI = 100 * minus.slice(-period).reduce((a, b) => a + b, 0) / trSum;

    if (plusDI + minusDI === 0) return 0;

    return 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI);

  }

  function vwap(candles) {

    let numerator = 0;

    let denominator = 0;

    candles.slice(-20).forEach((candle) => {

      const typical = (candle.high + candle.low + candle.close) / 3;

      numerator += typical * candle.volume;

      denominator += candle.volume;

    });

    return denominator ? numerator / denominator : null;

  }

  function calculateIndicators(candles) {

    const closes = candles.map((c) => c.close);

    const last = closes[closes.length - 1];

    const ema20 = ema(closes, 20);

    const ema50 = ema(closes, 50);

    const ema100 = ema(closes, 100);

    const ema200 = ema(closes, 200);

    const bands = bollinger(closes);

    const macdValue = macd(closes);

    const atrValue = atr(candles);

    return {

      last,

      rsi: rsi(closes),

      ema20: ema20.at(-1) ?? null,

      ema50: ema50.at(-1) ?? null,

      ema100: ema100.at(-1) ?? null,

      ema200: ema200.at(-1) ?? null,

      sma50: sma(closes, 50),

      sma200: sma(closes, 200),

      macd: macdValue,

      bollinger: bands,

      atr: atrValue,

      adx: adx(candles),

      vwap: vwap(candles),

      volume: candles.at(-1)?.volume ?? null,

      averageVolume: average(candles.slice(-20).map((c) => c.volume)),

      support: Math.min(...candles.slice(-20).map((c) => c.low)),

      resistance: Math.max(...candles.slice(-20).map((c) => c.high))

    };

  }

  function evaluateSignal(indicators) {

    let score = 0;

    const reasons = [];

    if (indicators.rsi !== null) {

      if (indicators.rsi < 30) {

        score += 1;

        reasons.push("RSI aşırı satım bölgesinde");

      } else if (indicators.rsi > 70) {

        score -= 1;

        reasons.push("RSI aşırı alım bölgesinde");

      } else if (indicators.rsi >= 50) {

        score += 0.5;

        reasons.push("RSI pozitif bölgede");

      } else {

        score -= 0.5;

        reasons.push("RSI negatif bölgede");

      }

    }

    if (indicators.ema20 !== null && indicators.ema50 !== null) {

      if (indicators.ema20 > indicators.ema50) {

        score += 1;

        reasons.push("EMA 20, EMA 50 üzerinde");

      } else {

        score -= 1;

        reasons.push("EMA 20, EMA 50 altında");

      }

    }

    if (indicators.macd) {

      if (indicators.macd.histogram > 0) {

        score += 1;

        reasons.push("MACD histogramı pozitif");

      } else {

        score -= 1;

        reasons.push("MACD histogramı negatif");

      }

    }

    if (indicators.last !== null && indicators.vwap !== null) {

      if (indicators.last > indicators.vwap) {

        score += 0.5;

        reasons.push("Fiyat VWAP üzerinde");

      } else {

        score -= 0.5;

        reasons.push("Fiyat VWAP altında");

      }

    }

    let signal = "TUT";

    if (score >= 2.5) signal = "GÜÇLÜ AL";

    else if (score >= 1) signal = "AL";

    else if (score <= -2.5) signal = "GÜÇLÜ SAT";

    else if (score <= -1) signal = "SAT";

    const atrPercent = indicators.atr && indicators.last

      ? indicators.atr / indicators.last * 100

      : null;

    let risk = "Belirlenemedi";

    if (atrPercent !== null) {

      if (atrPercent < 2) risk = "Düşük";

      else if (atrPercent < 5) risk = "Orta";

      else risk = "Yüksek";

    }

    return {

      signal,

      score,

      alignment: Math.min(100, Math.round(Math.abs(score) / 4 * 100)),

      risk,

      atrPercent,

      reasons

    };

  }

  function renderSignals() {

    const body = el["signal-table-body"];

    if (!body) return;

    const filter = el["signal-filter"]?.value || "all";

    const names = {

      "GÜÇLÜ AL": "strong-buy",

      "AL": "buy",

      "TUT": "hold",

      "SAT": "sell",

      "GÜÇLÜ SAT": "strong-sell"

    };

    const filtered = state.signals.filter((item) =>

      filter === "all" || names[item.signal] === filter

    );

    body.replaceChildren();

    if (!filtered.length) {

      body.innerHTML = '<tr><td colspan="5">Bu filtrede sinyal bulunamadı.</td></tr>';

      return;

    }

    filtered.forEach((item) => {

      const row = document.createElement("tr");

      row.appendChild(makeCell(item.name + " (" + item.symbol + ")"));

      const signalCell = makeCell(item.signal);

      signalCell.className = "signal-label " +

        (item.signal.includes("AL") ? "signal-buy" :

          item.signal.includes("SAT") ? "signal-sell" : "signal-hold");

      row.appendChild(signalCell);

      row.appendChild(makeCell("%" + item.alignment));

      row.appendChild(makeCell(item.risk));

      const actionCell = document.createElement("td");

      const button = document.createElement("button");

      button.type = "button";

      button.textContent = "İncele";

      button.setAttribute("aria-label", item.name + " sinyal ayrıntılarını incele");

      button.addEventListener("click", () => openCoinAnalysis(item.id));

      actionCell.appendChild(button);

      row.appendChild(actionCell);

      body.appendChild(row);

    });

    message("signal-message", filtered.length + " sinyal gösteriliyor.");

  }

  function renderDetails(coin, indicators, evaluation, market, timeframe) {

    const detail = el["coin-detail"];

    const results = el["technical-analysis-results"];

    if (!detail || !results) return;

    detail.replaceChildren();

    results.replaceChildren();

    const heading = document.createElement("h3");

    heading.textContent = coin.name + " (" + coinSymbol(coin) + ")";

    detail.appendChild(heading);

    const grid = document.createElement("dl");

    grid.className = "detail-grid";

    const details = [

      ["Piyasa türü", marketName(market)],

      ["Zaman dilimi", timeframeName(timeframe)],

      ["Spot piyasa fiyatı", price(coin.current_price)],

      ["24 saatlik değişim", percent(coin.price_change_percentage_24h)],

      ["Piyasa değeri", formatMarketValue(coin.market_cap)],

      ["24 saatlik hacim", formatMarketValue(coin.total_volume)],

      ["Teknik sinyal", evaluation.signal],

      ["Gösterge uyum puanı", "%" + evaluation.alignment],

      ["Risk seviyesi", evaluation.risk]

    ];

    details.forEach(([label, value]) => {

      const wrapper = document.createElement("div");

      wrapper.className = "detail-item";

      const term = document.createElement("dt");

      const description = document.createElement("dd");

      term.textContent = label;

      description.textContent = value;

      wrapper.append(term, description);

      grid.appendChild(wrapper);

    });

    detail.appendChild(grid);

    const title = document.createElement("h3");

    title.textContent = "Teknik göstergeler";

    results.appendChild(title);

    const list = document.createElement("ul");

    list.className = "indicator-list";

    const entries = [

      ["RSI (14)", indicators.rsi === null ? "Yetersiz veri" : number(indicators.rsi) ],

      ["EMA 20", price(indicators.ema20)],

      ["EMA 50", price(indicators.ema50)],

      ["EMA 100", price(indicators.ema100)],

      ["EMA 200", price(indicators.ema200)],

      ["SMA 50", price(indicators.sma50)],

      ["SMA 200", price(indicators.sma200)],

      ["MACD", indicators.macd ? number(indicators.macd.line, 8) : "Yetersiz veri"],

      ["MACD sinyal", indicators.macd ? number(indicators.macd.signal, 8) : "Yetersiz veri"],

      ["MACD histogramı", indicators.macd ? number(indicators.macd.histogram, 8) : "Yetersiz veri"],

      ["Bollinger üst", indicators.bollinger ? price(indicators.bollinger.upper) : "Yetersiz veri"],

      ["Bollinger orta", indicators.bollinger ? price(indicators.bollinger.middle) : "Yetersiz veri"],

      ["Bollinger alt", indicators.bollinger ? price(indicators.bollinger.lower) : "Yetersiz veri"],

      ["ATR (14)", indicators.atr === null ? "Yetersiz veri" : number(indicators.atr, 8)],

      ["ADX", indicators.adx === null ? "Yetersiz veri" : number(indicators.adx)],

      ["VWAP", price(indicators.vwap)],

      ["Son mum hacmi", number(indicators.volume, 4)],

      ["20 mum ortalama hacim", number(indicators.averageVolume, 4)],

      ["Destek seviyesi", price(indicators.support)],

      ["Direnç seviyesi", price(indicators.resistance)]

    ];

    entries.forEach(([label, value]) => {

      const item = document.createElement("li");

      item.textContent = label + ": " + value;

      list.appendChild(item);

    });

    results.appendChild(list);

    const signalHeading = document.createElement("h3");

    signalHeading.textContent = "Sinyal gerekçeleri";

    results.appendChild(signalHeading);

    const reasonList = document.createElement("ul");

    evaluation.reasons.forEach((reason) => {

      const item = document.createElement("li");

      item.textContent = reason;

      reasonList.appendChild(item);

    });

    if (!evaluation.reasons.length) {

      const item = document.createElement("li");

      item.textContent = "Yeterli gösterge verisi bulunamadı.";

      reasonList.appendChild(item);

    }

    results.appendChild(reasonList);

    const riskText = document.createElement("p");

    riskText.textContent =

      "ATR tabanlı volatilite: " +

      (evaluation.atrPercent === null

        ? "Hesaplanamadı."

        : "%" + number(evaluation.atrPercent));

    results.appendChild(riskText);

    const disclaimer = document.createElement("p");

    disclaimer.className = "notice";

    disclaimer.textContent =

      "Gösterge uyum puanı istatistiksel başarı olasılığı değildir. Destek ve direnç, son 20 mumun en düşük ve en yüksek değerlerinden hesaplanmıştır. Bu veriler yatırım tavsiyesi değildir.";

    results.appendChild(disclaimer);

  }

  function marketName(value) {

    return value === "usdt-m" ? "USDT-M Vadeli" :

      value === "coin-m" ? "COIN-M Vadeli" : "Spot";

  }

  function timeframeName(value) {

    const names = {

      "5m": "5 dakika", "15m": "15 dakika",

      "1h": "1 saat", "4h": "4 saat",

      "1d": "1 gün", "1w": "1 hafta"

    };

    return names[value] || value;

  }

  function binanceSymbol(coin) {

    return coinSymbol(coin) + "USDT";

  }

  function coinMSymbol(coin) {

    return coinSymbol(coin) + "USD_PERP";

  }

  async function fetchCandles(coin, market, timeframe) {

    const limit = 250;

    let url;

    if (market === "usdt-m") {

      url = CONFIG.binanceUsdt + "/fapi/v1/klines?" +

        new URLSearchParams({

          symbol: binanceSymbol(coin),

          interval: timeframe,

          limit: String(limit)

        });

    } else if (market === "coin-m") {

      url = CONFIG.binanceCoin + "/dapi/v1/klines?" +

        new URLSearchParams({

          symbol: coinMSymbol(coin),

          interval: timeframe,

          limit: String(limit)

        });

    } else {

      url = CONFIG.binanceSpot + "/api/v3/klines?" +

        new URLSearchParams({

          symbol: binanceSymbol(coin),

          interval: timeframe,

          limit: String(limit)

        });

    }

    const raw = await request(url);

    if (!Array.isArray(raw) || !raw.length) {

      throw new Error("Bu coin ve piyasa için mum verisi bulunamadı.");

    }

    return raw.map((item) => ({

      time: Number(item[0]),

      open: Number(item[1]),

      high: Number(item[2]),

      low: Number(item[3]),

      close: Number(item[4]),

      volume: Number(item[5])

    })).filter((item) =>

      Number.isFinite(item.close) &&

      Number.isFinite(item.high) &&

      Number.isFinite(item.low)

    );

  }

  async function openCoinAnalysis(id) {

    const coin = coinById(id);

    if (!coin) {

      message("analysis-message", "Seçilen coin bulunamadı.", "error-message");

      return;

    }

    state.selectedCoin = id;

    if (el["analysis-coin"]) el["analysis-coin"].value = id;

    const market = el["analysis-market"]?.value || state.market;

    const timeframe = el["analysis-timeframe"]?.value || "1d";

    if (el["analysis-market"]) el["analysis-market"].value = market;

    if (el["market-type"]) el["market-type"].value = market;

    $("analysis").scrollIntoView({ behavior: "smooth" });

    await runAnalysis();

  }

  async function runAnalysis() {

    if (state.analysisLoading) return;

    const id = el["analysis-coin"]?.value;

    const coin = coinById(id);

    if (!coin) {

      message("analysis-message", "Önce analiz edilecek bir coin seçin.");

      return;

    }

    const market = el["analysis-market"]?.value || "spot";

    const timeframe = el["analysis-timeframe"]?.value || "1d";

    if (!CONFIG.timeframes.includes(timeframe)) {

      message("analysis-message", "Geçersiz zaman dilimi seçildi.", "error-message");

      return;

    }

    state.analysisLoading = true;

    message("analysis-message", coin.name + " için mum verileri alınıyor.");

    announce(coin.name + " teknik analizi hazırlanıyor.");

    try {

      const candles = await fetchCandles(coin, market, timeframe);

      if (candles.length < 30) {

        throw new Error("Bu analiz için yeterli mum verisi bulunamadı.");

      }

      const indicators = calculateIndicators(candles);

      const evaluation = evaluateSignal(indicators);

      renderDetails(coin, indicators, evaluation, market, timeframe);

      message("analysis-message", coin.name + " analizi tamamlandı.", "success-message");

      announce(coin.name + " analizi tamamlandı. Sinyal: " + evaluation.signal);

      if (market === "spot" && timeframe === "1d") {

        const existing = state.signals.find((item) => item.id === coin.id);

        const signal = {

          id: coin.id,

          name: coin.name,

          symbol: coinSymbol(coin),

          signal: evaluation.signal,

          alignment: evaluation.alignment,

          risk: evaluation.risk

        };

        if (existing) {

          state.signals = state.signals.map((item) =>

            item.id === coin.id ? signal : item

          );

        } else {

          state.signals.push(signal);

        }

        renderSignals();

      }

    } catch (error) {

      message("analysis-message", error.message || "Analiz yapılamadı.", "error-message");

      if (el["technical-analysis-results"]) {

        el["technical-analysis-results"].textContent = error.message;

      }

      announce("Analiz yapılamadı. " + error.message);

    } finally {

      state.analysisLoading = false;

    }

  }

  async function buildInitialSignals() {

    state.signals = [];

    const candidates = CONFIG.pinned

      .map((id) => coinById(id))

      .filter(Boolean);

    message("signal-message", "Öncelikli coinler analiz ediliyor.");

    for (const coin of candidates) {

      try {

        const candles = await fetchCandles(coin, "spot", "1d");

        if (candles.length < 30) continue;

        const indicators = calculateIndicators(candles);

        const evaluation = evaluateSignal(indicators);

        state.signals.push({

          id: coin.id,

          name: coin.name,

          symbol: coinSymbol(coin),

          signal: evaluation.signal,

          alignment: evaluation.alignment,

          risk: evaluation.risk

        });

      } catch (_) {

        // Bir coinin verisi alınamazsa diğer coinlerin analizi sürer.

      }

    }

    renderSignals();

    if (!state.signals.length) {

      message("signal-message", "Şu anda otomatik sinyal üretmek için veri alınamadı.", "error-message");

    } else {

      message("signal-message", state.signals.length + " coin için günlük sinyal hesaplandı.");

    }

  }

  async function loadMarkets() {

    if (state.loading) return;

    state.loading = true;

    if (el["refresh-button"]) el["refresh-button"].disabled = true;

    announce("Piyasa verileri yükleniyor.");

    message("market-message", "Piyasa verileri alınıyor.");

    try {

      state.coins = await fetchSpotMarkets();

      state.filtered = [...state.coins];

      state.lastUpdated = new Date();

      renderBitcoin();

      renderMarketTable(); 
      fillAnalysisOptions();

      renderWatchlist();

      setCurrencyNote();

      if (el["last-updated"]) {

        el["last-updated"].textContent =

          "Son güncelleme: " + state.lastUpdated.toLocaleTimeString("tr-TR");

      }

      message("market-message", state.coins.length + " coin için spot piyasa verileri güncellendi.", "success-message");

      announce("Piyasa verileri güncellendi.");

      await buildInitialSignals();

    } catch (error) {

      message("market-message", error.message || "Piyasa verileri alınamadı.", "error-message");

      announce("Piyasa verileri alınamadı. " + error.message);

    } finally {

      state.loading = false;

      if (el["refresh-button"]) el["refresh-button"].disabled = false;

    }

  }

  function bindEvents() {

    el["refresh-button"]?.addEventListener("click", loadMarkets);

    el["currency-select"]?.addEventListener("change", (event) => {

      const value = event.target.value;

      if (!["usd", "usdt", "try"].includes(value)) return;

      state.currency = value;

      loadMarkets();

    });

    el["market-type"]?.addEventListener("change", (event) => {

      state.market = event.target.value;

      if (el["analysis-market"]) {

        el["analysis-market"].value = state.market;

      }

      if (state.selectedCoin) runAnalysis();

      else message("market-message", marketName(state.market) + " seçildi. Analiz için coin seçin.");

    });

    el["coin-search"]?.addEventListener("input", searchCoins);

    el["market-sort"]?.addEventListener("change", renderMarketTable);

    el["signal-filter"]?.addEventListener("change", renderSignals);

    el["analysis-coin"]?.addEventListener("change", () => {

      if (el["analysis-coin"].value) runAnalysis();

    });

    el["analysis-timeframe"]?.addEventListener("change", runAnalysis);

    el["analysis-market"]?.addEventListener("change", (event) => {

      state.market = event.target.value;

      if (el["market-type"]) el["market-type"].value = state.market;

      runAnalysis();

    });

    el["watchlist-form"]?.addEventListener("submit", (event) => {

      event.preventDefault();

      addWatchlist();

    });

  }

  function startRefresh() {

    if (state.refreshTimer) clearInterval(state.refreshTimer);

    state.refreshTimer = setInterval(() => {

      if (!document.hidden) loadMarkets();

    }, CONFIG.refreshMs);

  }

  function initialize() {

    cacheElements();

    loadWatchlist();

    bindEvents();

    renderWatchlist();

    if (el["currency-select"]) {

      state.currency = el["currency-select"].value;

    }

    if (el["market-type"]) {

      state.market = el["market-type"].value;

    }

    setCurrencyNote();

    loadMarkets();

    startRefresh();

    document.addEventListener("visibilitychange", () => {

      if (!document.hidden) {

        announce("Platform yeniden etkinleştirildi.");

      }

    });

  }

  if (document.readyState === "loading") {

    document.addEventListener("DOMContentLoaded", initialize);

  } else {

    initialize();

  }

})();
