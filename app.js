

"use strict";

(() => {

  const CONFIG = {

    coinGecko: "https://api.coingecko.com/api/v3",

    binanceSpot: "https://api.binance.com",

    binanceUsdt: "https://fapi.binance.com",

    binanceCoin: "https://dapi.binance.com",

    refreshMs: 300000,

    requestTimeoutMs: 15000,

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

    pendingReload: false,

    analysisToken: 0,

    refreshTimer: null,

    lastUpdated: null,

    exchangeInfo: {

      spot: null,

      "usdt-m": null,

      "coin-m": null

    }

  };

  const $ = id => document.getElementById(id);

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

    ].forEach(id => {

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

    try {

      return new Intl.NumberFormat("tr-TR", {

        style: "currency",

        currency: currency.toUpperCase(),

        maximumFractionDigits: n < 1 ? 8 : 2

      }).format(n);

    } catch (_) {

      return number(n, 8) + " " + currency.toUpperCase();

    }

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

    const controller = new AbortController();

    const timer = setTimeout(

      () => controller.abort(),

      CONFIG.requestTimeoutMs

    );

    try {

      const response = await fetch(url, {

        method: "GET",

        headers: { Accept: "application/json" },

        signal: controller.signal

      });

      if (!response.ok) {

        if (response.status === 429) {

          throw new Error(

            "Veri kaynağının istek sınırına ulaşıldı. Biraz sonra tekrar deneyin."

          );

        }

        throw new Error(

          "Veri kaynağı HTTP " + response.status + " hatası döndürdü."

        );

      }

      return await response.json();

    } catch (error) {

      if (error.name === "AbortError") {

        throw new Error("İstek zaman aşımına uğradı. Tekrar deneyin.");

      }

      throw error;

    } finally {

      clearTimeout(timer);

    }

  }

  function coinById(id) {

    return state.coins.find(coin => coin.id === id);

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

  function marketName(value) {

    return value === "usdt-m" ? "USDT-M Vadeli" :

      value === "coin-m" ? "COIN-M Vadeli" : "Spot";

  }

  function timeframeName(value) {

    const names = {

      "5m": "5 dakika",

      "15m": "15 dakika",

      "1h": "1 saat",

      "4h": "4 saat",

      "1d": "1 gün",

      "1w": "1 hafta"

    };

    return names[value] || value;

  }

  function setCurrencyNote() {

    if (!el["currency-note"]) return;

    if (state.market === "spot") {

      if (state.currency === "usdt") {

        el["currency-note"].textContent =

          "Spot fiyatlar CoinGecko USD karşılığıyla gösterilir. USDT ve USD birebir aynı değildir.";

      } else {

        el["currency-note"].textContent =

          "Spot fiyatlar seçilen para biriminde gösterilir.";

      }

    } else if (state.market === "usdt-m") {

      el["currency-note"].textContent =

        "USDT-M vadeli sözleşme fiyatları Binance Futures verisidir ve USDT cinsindendir. TRY ve USD seçimi bu piyasanın kotasyon birimini değiştirmez.";

    } else {

      el["currency-note"].textContent =

        "COIN-M vadeli sözleşme fiyatları Binance COIN-M verisidir. Sözleşmelerin kotasyon ve teminat yapısı spot piyasadan farklıdır.";

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

      throw new Error("Spot piyasa verisi beklenen biçimde gelmedi.");

    }

    const found = new Set(data.map(coin => coin.id));

    const missing = CONFIG.pinned.filter(id => !found.has(id));

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

        // Ana liste geldiyse ek coin isteğinin hatası tüm listeyi bozmaz.

      }

    }

    return data;

  }

  async function fetchExchangeInfo(market) {

    if (state.exchangeInfo[market]) {

      return state.exchangeInfo[market];

    }

    let url;

    if (market === "spot") {

      url = CONFIG.binanceSpot + "/api/v3/exchangeInfo";

    } else if (market === "usdt-m") {

      url = CONFIG.binanceUsdt + "/fapi/v1/exchangeInfo";

    } else {

      url = CONFIG.binanceCoin + "/dapi/v1/exchangeInfo";

    }

    const data = await request(url);

    if (!Array.isArray(data.symbols)) {

      throw new Error("Binance sözleşme bilgileri alınamadı.");

    }

    state.exchangeInfo[market] = data.symbols;

    return data.symbols;

  }

  function findExchangeSymbol(coin, market, symbols) {

    const base = coinSymbol(coin);

    const matches = symbols.filter(item => {

      if (item.baseAsset !== base) return false;

      if (item.status !== "TRADING") return false;

      if (market === "usdt-m") {

        return item.quoteAsset === "USDT" &&

          (!item.contractType || item.contractType === "PERPETUAL");

      }

      if (market === "coin-m") {

        return item.quoteAsset === "USD" &&

          item.contractType === "PERPETUAL";

      }

      return item.quoteAsset === "USDT";

    });

    if (!matches.length) return null;

    return matches[0].symbol;

  }

  async function fetchDerivativeMarkets(market) {

    const metadata = await fetchSpotMarkets();

    const symbols = await fetchExchangeInfo(market);

    const tickerUrl = market === "usdt-m"

      ? CONFIG.binanceUsdt + "/fapi/v1/ticker/24hr"

      : CONFIG.binanceCoin + "/dapi/v1/ticker/24hr";

    const tickers = await request(tickerUrl);

    if (!Array.isArray(tickers)) {

      throw new Error("Vadeli piyasa fiyatları alınamadı.");

    }

    const tickerMap = new Map(

      tickers.map(item => [item.symbol, item])

    );

    const result = [];

    for (const coin of metadata) {

      const symbol = findExchangeSymbol(coin, market, symbols);

      if (!symbol) continue;

      const ticker = tickerMap.get(symbol);

      if (!ticker) continue;

      const current = Number(ticker.lastPrice);

      const change = Number(ticker.priceChangePercent);

      if (!Number.isFinite(current) || current <= 0) continue;

      result.push({

        ...coin,

        current_price: current,

        price_change_percentage_24h: change,

        total_volume: Number(ticker.quoteVolume) || Number(ticker.volume) || 0,

        exchange_symbol: symbol,

        market_type: market

      });

    }

    if (!result.length) {

      throw new Error(

        "Seçilen vadeli piyasada desteklenen coin bulunamadı."

      );

    }

    return result;

  }

  async function fetchMarkets() {

    if (state.market === "spot") {

      return fetchSpotMarkets();

    }

    return fetchDerivativeMarkets(state.market);

  }

  function renderBitcoin() {

    const btc = coinById("bitcoin");

    if (!btc) {

      if (el["btc-price"]) el["btc-price"].textContent = "Veri yok";

      if (el["btc-change"]) el["btc-change"].textContent = "Veri yok";

      return;

    }

    if (el["btc-price"]) {

      el["btc-price"].textContent = price(

        btc.current_price,

        state.market === "spot" ? state.currency :

          state.market === "usdt-m" ? "usdt" : "usd"

      );

    }

    if (el["btc-change"]) {

      el["btc-change"].textContent =

        "24 saat: " + percent(btc.price_change_percentage_24h);

      el["btc-change"].className =

        "change-value " + signClass(btc.price_change_percentage_24h);

    }

    if (el["market-overview-message"]) {

      el["market-overview-message"].textContent =

        state.coins.length + " coin listelendi. Piyasa: " +

        marketName(state.market) + ".";

    }

  }

  function makeCell(text, className = "") {

    const cell = document.createElement("td");

    cell.textContent = text;

    if (className) cell.className = className;

    return cell;

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

      coins.sort((a, b) =>

        (b.total_volume || 0) - (a.total_volume || 0)

      );

    } else {

      coins.sort((a, b) =>

        (a.market_cap_rank || 999999) -

        (b.market_cap_rank || 999999)

      );

    }

    if (!coins.length) {

      body.replaceChildren();

      const row = document.createElement("tr");

      row.appendChild(makeCell("Aramanızla eşleşen coin bulunamadı."));

      body.appendChild(row);

      return;

    }

    const active = document.activeElement;

    const activeName = active?.dataset?.coinId || null;

    const fragment = document.createDocumentFragment();

    coins.forEach(coin => {

      const row = document.createElement("tr");

      const nameCell = document.createElement("td");

      const selectButton = document.createElement("button");

      selectButton.type = "button";

      selectButton.className = "coin-name-button";

      selectButton.textContent =

        coin.name + " (" + coinSymbol(coin) + ")";

      selectButton.dataset.coinId = coin.id;

      selectButton.setAttribute(

        "aria-label",

        coin.name + " ayrıntılı analizini aç"

      );

      selectButton.addEventListener("click", () => {

        openCoinAnalysis(coin.id);

      });

      nameCell.appendChild(selectButton);

      row.appendChild(nameCell);

      const currency = state.market === "spot"

        ? state.currency

        : state.market === "usdt-m" ? "usdt" : "usd";

      row.appendChild(makeCell(price(coin.current_price, currency)));

      row.appendChild(makeCell(

        percent(coin.price_change_percentage_24h),

        signClass(coin.price_change_percentage_24h)

      ));

      row.appendChild(makeCell(formatMarketValue(coin.market_cap)));

      const actionCell = document.createElement("td");

      const detailButton = document.createElement("button");

      detailButton.type = "button";

      detailButton.textContent = "Analiz et";

      detailButton.dataset.coinId = coin.id;

      detailButton.setAttribute("aria-label", coin.name + " analiz et");

      detailButton.addEventListener("click", () => {

        openCoinAnalysis(coin.id);

      });

      actionCell.appendChild(detailButton);

      row.appendChild(actionCell);

      fragment.appendChild(row);

    });

    body.replaceChildren(fragment);

    if (activeName) {

      const replacement = body.querySelector(

        '[data-coin-id="' + activeName + '"]'

      );

      replacement?.focus();

    }

  }

  function searchCoins() {

    const query = (el["coin-search"]?.value || "")

      .trim().toLocaleLowerCase("tr-TR");

    state.filtered = state.coins.filter(coin => {

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

    state.coins.forEach(coin => {

      const option = document.createElement("option");

      option.value = coin.id;

      option.textContent =

        coin.name + " (" + coinSymbol(coin) + ")";

      fragment.appendChild(option);

    });

    select.replaceChildren(fragment);

    if (previous && coinById(previous)) {

      select.value = previous;

    }

  }

  function saveWatchlist() {

    try {

      localStorage.setItem(

        CONFIG.watchlistKey,

        JSON.stringify(state.watchlist)

      );

    } catch (_) {

      message(

        "watchlist-message",

        "Takip listesi cihazınıza kaydedilemedi.",

        "error-message"

      );

    }

  }

  function loadWatchlist() {

    try {

      const value = JSON.parse(

        localStorage.getItem(CONFIG.watchlistKey) || "[]"

      );

      state.watchlist = Array.isArray(value)

        ? value.filter(id => typeof id === "string")

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

    state.watchlist.forEach(id => {

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

      remove.setAttribute(

        "aria-label",

        label.textContent + " listesinden çıkar"

      );

      remove.addEventListener("click", () => {

        state.watchlist = state.watchlist.filter(

          itemId => itemId !== id

        );

        saveWatchlist();

        renderWatchlist();

        message(

          "watchlist-message",

          "Coin takip listenizden çıkarıldı."

        );

      });

      wrapper.append(label, remove);

      item.appendChild(wrapper);

      list.appendChild(item);

    });

  }

  function addWatchlist() {

    const input = el["watchlist-coin"];

    const query = (input?.value || "")

      .trim().toLocaleLowerCase("tr-TR");

    if (!query) return;

    const coin = state.coins.find(item =>

      item.id.toLocaleLowerCase("tr-TR") === query ||

      item.name.toLocaleLowerCase("tr-TR") === query ||

      coinSymbol(item).toLocaleLowerCase("tr-TR") === query

    );

    if (!coin) {

      message(

        "watchlist-message",

        "Coin bulunamadı. Önce piyasa verilerinin yüklenmesini bekleyin.",

        "error-message"

      );

      return;

    }

    if (state.watchlist.includes(coin.id)) {

      message(

        "watchlist-message",

        "Bu coin zaten takip listenizde."

      );

      return;

    }

    state.watchlist.push(coin.id);

    saveWatchlist();

    renderWatchlist();

    input.value = "";

    message(

      "watchlist-message",

      coin.name + " takip listenize eklendi.",

      "success-message"

    );

  }

  function average(values) {

    if (!values.length) return null;

    return values.reduce((sum, value) => sum + value, 0) /

      values.length;

  }

  function ema(values, period) {

    if (values.length < period) return [];

    const multiplier = 2 / (period + 1);

    let previous = average(values.slice(0, period));

    const result = [previous];

    for (let i = period; i < values.length; i++) {

      previous =

        (values[i] - previous) * multiplier + previous;

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

      avgGain =

        (avgGain * (period - 1) + Math.max(diff, 0)) / period;

      avgLoss =

        (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;

    }

    if (avgGain === 0 && avgLoss === 0) return 50;

    if (avgLoss === 0) return 100;

    if (avgGain === 0) return 0;

    return 100 - 100 / (1 + avgGain / avgLoss);

  }
   function macd(values) {

    const fast = ema(values, 12);

    const slow = ema(values, 26);

    if (!fast.length || !slow.length) return null;

    const offset = fast.length - slow.length;

    const line = slow.map(

      (value, index) => fast[index + offset] - value

    );

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

    const variance = average(

      sample.map(value => Math.pow(value - mid, 2))

    );

    const deviation = Math.sqrt(variance);

    return {

      upper: mid + deviation * 2,

      middle: mid,

      lower: mid - deviation * 2

    };

  }

  function trueRange(current, previous) {

    return Math.max(

      current.high - current.low,

      Math.abs(current.high - previous.close),

      Math.abs(current.low - previous.close)

    );

  }

  function atr(candles, period = 14) {

    if (candles.length < period + 1) return null;

    const ranges = [];

    for (let i = 1; i < candles.length; i++) {

      ranges.push(trueRange(candles[i], candles[i - 1]));

    }

    let value = average(ranges.slice(0, period));

    for (let i = period; i < ranges.length; i++) {

      value =

        (value * (period - 1) + ranges[i]) / period;

    }

    return value;

  }

  function adx(candles, period = 14) {

    if (candles.length < period * 2 + 1) return null;

    const trs = [];

    const plusDM = [];

    const minusDM = [];

    for (let i = 1; i < candles.length; i++) {

      const current = candles[i];

      const previous = candles[i - 1];

      const upMove = current.high - previous.high;

      const downMove = previous.low - current.low;

      plusDM.push(

        upMove > downMove && upMove > 0 ? upMove : 0

      );

      minusDM.push(

        downMove > upMove && downMove > 0 ? downMove : 0

      );

      trs.push(trueRange(current, previous));

    }

    let trSmooth = trs.slice(0, period)

      .reduce((sum, value) => sum + value, 0);

    let plusSmooth = plusDM.slice(0, period)

      .reduce((sum, value) => sum + value, 0);

    let minusSmooth = minusDM.slice(0, period)

      .reduce((sum, value) => sum + value, 0);

    const dxValues = [];

    function calculateDX() {

      if (trSmooth <= 0) return 0;

      const plusDI = 100 * plusSmooth / trSmooth;

      const minusDI = 100 * minusSmooth / trSmooth;

      const total = plusDI + minusDI;

      if (total === 0) return 0;

      return 100 * Math.abs(plusDI - minusDI) / total;

    }

    dxValues.push(calculateDX());

    for (let i = period; i < trs.length; i++) {

      trSmooth = trSmooth - trSmooth / period + trs[i];

      plusSmooth =

        plusSmooth - plusSmooth / period + plusDM[i];

      minusSmooth =

        minusSmooth - minusSmooth / period + minusDM[i];

      dxValues.push(calculateDX());

    }

    if (dxValues.length < period) return null;

    let result = average(dxValues.slice(0, period));

    for (let i = period; i < dxValues.length; i++) {

      result =

        (result * (period - 1) + dxValues[i]) / period;

    }

    return result;

  }

  function vwap(candles) {

    let numerator = 0;

    let denominator = 0;

    candles.slice(-20).forEach(candle => {

      const typical =

        (candle.high + candle.low + candle.close) / 3;

      numerator += typical * candle.volume;

      denominator += candle.volume;

    });

    return denominator ? numerator / denominator : null;

  }

  function calculateIndicators(candles) {

    if (!Array.isArray(candles) || !candles.length) {

      throw new Error("Teknik analiz için mum verisi bulunamadı.");

    }

    const closes = candles.map(candle => candle.close);

    const last = closes[closes.length - 1];

    const ema20 = ema(closes, 20);

    const ema50 = ema(closes, 50);

    const ema100 = ema(closes, 100);

    const ema200 = ema(closes, 200);

    const bands = bollinger(closes);

    const macdValue = macd(closes);

    const atrValue = atr(candles);

    const recent = candles.slice(-20);

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

      averageVolume: average(

        candles.slice(-20).map(candle => candle.volume)

      ),

      support: Math.min(...recent.map(candle => candle.low)),

      resistance: Math.max(...recent.map(candle => candle.high))

    };

  }

  function evaluateSignal(indicators) {

    let score = 0;

    const reasons = [];

    if (indicators.rsi !== null) {

      if (indicators.rsi >= 55) {

        score += 0.5;

        reasons.push("RSI pozitif momentum bölgesinde");

      } else if (indicators.rsi <= 45) {

        score -= 0.5;

        reasons.push("RSI negatif momentum bölgesinde");

      } else {

        reasons.push("RSI nötr bölgede");

      }

      if (indicators.rsi < 30) {

        reasons.push("RSI aşırı satım bölgesinde; dönüş teyidi gerekir");

      } else if (indicators.rsi > 70) {

        reasons.push("RSI aşırı alım bölgesinde; geri çekilme riski vardır");

      }

    }

    if (

      indicators.ema20 !== null &&

      indicators.ema50 !== null

    ) {

      if (indicators.ema20 > indicators.ema50) {

        score += 1;

        reasons.push("EMA 20, EMA 50 üzerinde");

      } else if (indicators.ema20 < indicators.ema50) {

        score -= 1;

        reasons.push("EMA 20, EMA 50 altında");

      }

    }

    if (indicators.macd) {

      if (indicators.macd.histogram > 0) {

        score += 1;

        reasons.push("MACD histogramı pozitif");

      } else if (indicators.macd.histogram < 0) {

        score -= 1;

        reasons.push("MACD histogramı negatif");

      }

    }

    if (

      indicators.last !== null &&

      indicators.vwap !== null

    ) {

      if (indicators.last > indicators.vwap) {

        score += 0.5;

        reasons.push("Fiyat VWAP üzerinde");

      } else if (indicators.last < indicators.vwap) {

        score -= 0.5;

        reasons.push("Fiyat VWAP altında");

      }

    }

    let signal = "TUT";

    if (score >= 2.5) signal = "GÜÇLÜ AL";

    else if (score >= 1) signal = "AL";

    else if (score <= -2.5) signal = "GÜÇLÜ SAT";

    else if (score <= -1) signal = "SAT";

    const atrPercent =

      indicators.atr !== null && indicators.last > 0

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

      alignment: Math.min(

        100,

        Math.round(Math.abs(score) / 3 * 100)

      ),

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

    const filtered = state.signals.filter(item =>

      filter === "all" || names[item.signal] === filter

    );

    const active = document.activeElement; 
    const activeId = active?.dataset?.signalId || null;

    body.replaceChildren();

    if (!filtered.length) {

      const row = document.createElement("tr");

      row.appendChild(

        makeCell("Bu filtrede sinyal bulunamadı.")

      );

      body.appendChild(row);

      return;

    }

    filtered.forEach(item => {

      const row = document.createElement("tr");

      row.appendChild(

        makeCell(item.name + " (" + item.symbol + ")")

      );

      const signalCell = makeCell(item.signal);

      signalCell.className =

        "signal-label " +

        (item.signal.includes("AL") ? "signal-buy" :

          item.signal.includes("SAT") ? "signal-sell" :

            "signal-hold");

      row.appendChild(signalCell);

      row.appendChild(makeCell("%" + item.alignment));

      row.appendChild(makeCell(item.risk));

      const actionCell = document.createElement("td");

      const button = document.createElement("button");

      button.type = "button";

      button.textContent = "İncele";

      button.dataset.signalId = item.id;

      button.setAttribute(

        "aria-label",

        item.name + " sinyal ayrıntılarını incele"

      );

      button.addEventListener("click", () => {

        openCoinAnalysis(item.id);

      });

      actionCell.appendChild(button);

      row.appendChild(actionCell);

      body.appendChild(row);

    });

    if (activeId) {

      body.querySelector(

        '[data-signal-id="' + activeId + '"]'

      )?.focus();

    }

    message(

      "signal-message",

      filtered.length + " sinyal gösteriliyor."

    );

  }

  function renderDetails(

    coin,

    indicators,

    evaluation,

    market,

    timeframe

  ) {

    const detail = el["coin-detail"];

    const results = el["technical-analysis-results"];

    if (!detail || !results) return;

    detail.replaceChildren();

    results.replaceChildren();

    const heading = document.createElement("h3");

    heading.textContent =

      coin.name + " (" + coinSymbol(coin) + ")";

    detail.appendChild(heading);

    const grid = document.createElement("dl");

    grid.className = "detail-grid";

    const displayCurrency =

      market === "spot" ? state.currency :

        market === "usdt-m" ? "usdt" : "usd";

    const details = [

      ["Piyasa türü", marketName(market)],

      ["Zaman dilimi", timeframeName(timeframe)],

      ["Piyasa fiyatı", price(coin.current_price, displayCurrency)],

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

      ["RSI (14)", indicators.rsi === null ? "Yetersiz veri" : number(indicators.rsi)],

      ["EMA 20", price(indicators.ema20, displayCurrency)],

      ["EMA 50", price(indicators.ema50, displayCurrency)],

      ["EMA 100", price(indicators.ema100, displayCurrency)],

      ["EMA 200", price(indicators.ema200, displayCurrency)],

      ["SMA 50", price(indicators.sma50, displayCurrency)],

      ["SMA 200", price(indicators.sma200, displayCurrency)],

      ["MACD", indicators.macd ? number(indicators.macd.line, 8) : "Yetersiz veri"],

      ["MACD sinyal", indicators.macd ? number(indicators.macd.signal, 8) : "Yetersiz veri"],

      ["MACD histogramı", indicators.macd ? number(indicators.macd.histogram, 8) : "Yetersiz veri"],

      ["Bollinger üst", indicators.bollinger ? price(indicators.bollinger.upper, displayCurrency) : "Yetersiz veri"],

      ["Bollinger orta", indicators.bollinger ? price(indicators.bollinger.middle, displayCurrency) : "Yetersiz veri"],

      ["Bollinger alt", indicators.bollinger ? price(indicators.bollinger.lower, displayCurrency) : "Yetersiz veri"],

      ["ATR (14)", indicators.atr === null ? "Yetersiz veri" : number(indicators.atr, 8)],

      ["ADX (14)", indicators.adx === null ? "Yetersiz veri" : number(indicators.adx)],

      ["VWAP", price(indicators.vwap, displayCurrency)],

      ["Son mum hacmi", number(indicators.volume, 4)],

      ["20 mum ortalama hacim", number(indicators.averageVolume, 4)],

      ["Destek seviyesi", price(indicators.support, displayCurrency)],

      ["Direnç seviyesi", price(indicators.resistance, displayCurrency)]

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

    evaluation.reasons.forEach(reason => {

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

      "Gösterge uyum puanı başarı olasılığı değildir. " +

      "Destek ve direnç son 20 mumun en düşük ve en yüksek " +

      "değerlerinden hesaplanmıştır. Sinyaller yatırım tavsiyesi değildir.";

    results.appendChild(disclaimer);

  }

  async function resolveSymbol(coin, market) {

    const symbols = await fetchExchangeInfo(market);

    const symbol = findExchangeSymbol(coin, market, symbols);

    if (!symbol) {

      throw new Error(

        coin.name + " için " + marketName(market) +

        " piyasasında uygun Binance sözleşmesi bulunamadı."

      );

    }

    return symbol;

  }

  async function fetchCandles(coin, market, timeframe) {

    const limit = 250;

    let baseUrl;

    if (market === "usdt-m") {

      baseUrl = CONFIG.binanceUsdt;

    } else if (market === "coin-m") {

      baseUrl = CONFIG.binanceCoin;

    } else {

      baseUrl = CONFIG.binanceSpot;

    }

    const symbol = await resolveSymbol(coin, market);

    const endpoint = market === "usdt-m"

      ? "/fapi/v1/klines"

      : market === "coin-m"

        ? "/dapi/v1/klines"

        : "/api/v3/klines";

    const params = new URLSearchParams({

      symbol,

      interval: timeframe,

      limit: String(limit)

    });

    const raw = await request(

      baseUrl + endpoint + "?" + params.toString()

    );

    if (!Array.isArray(raw) || !raw.length) {

      throw new Error(

        "Bu coin ve piyasa için mum verisi bulunamadı."

      );

    }

    const mapped = raw.map(item => ({

      time: Number(item[0]),

      open: Number(item[1]),

      high: Number(item[2]),

      low: Number(item[3]),

      close: Number(item[4]),

      volume: Number(item[5])

    }));

    const valid = mapped.filter(item =>

      Number.isFinite(item.time) &&

      item.time > 0 &&

      Number.isFinite(item.open) &&

      item.open > 0 &&

      Number.isFinite(item.high) &&

      item.high > 0 &&

      Number.isFinite(item.low) &&

      item.low > 0 &&

      Number.isFinite(item.close) &&

      item.close > 0 &&

      Number.isFinite(item.volume) &&

      item.volume >= 0 &&

      item.high >= Math.max(item.open, item.close, item.low) &&

      item.low <= Math.min(item.open, item.close, item.high)

    );

    const unique = new Map();

    valid.forEach(item => unique.set(item.time, item));

    return Array.from(unique.values())

      .sort((a, b) => a.time - b.time);

  }

  async function openCoinAnalysis(id) {

    const coin = coinById(id);

    if (!coin) {

      message(

        "analysis-message",

        "Seçilen coin bulunamadı.",

        "error-message"

      );

      return;

    }

    state.selectedCoin = id;

    if (el["analysis-coin"]) {

      el["analysis-coin"].value = id;

    }

    const market =

      el["analysis-market"]?.value || state.market;

    if (el["analysis-market"]) {

      el["analysis-market"].value = market;

    }

    if (el["market-type"]) {

      el["market-type"].value = market;

    }

    state.market = market;

    $("analysis")?.scrollIntoView({ behavior: "smooth" });

    await runAnalysis();

  }

  async function runAnalysis() {

    const id = el["analysis-coin"]?.value;

    const coin = coinById(id);

    if (!coin) {

      message(

        "analysis-message",

        "Önce analiz edilecek bir coin seçin."

      );

      return;

    }

    const market =

      el["analysis-market"]?.value || "spot";

    const timeframe =

      el["analysis-timeframe"]?.value || "1d";

    if (!CONFIG.timeframes.includes(timeframe)) {

      message(

        "analysis-message",

        "Geçersiz zaman dilimi seçildi.",

        "error-message"

      );

      return;

    }

    const token = ++state.analysisToken;

    message(

      "analysis-message",

      coin.name + " için mum verileri alınıyor."

    );

    announce(coin.name + " teknik analizi hazırlanıyor.");

    try {

      const candles = await fetchCandles(

        coin,

        market,

        timeframe

      );

      if (token !== state.analysisToken) return;

      if (candles.length < 30) {

        throw new Error(

          "Bu analiz için yeterli mum verisi bulunamadı."

        );

      }

      const indicators = calculateIndicators(candles);

      const evaluation = evaluateSignal(indicators);

      if (token !== state.analysisToken) return;

      renderDetails(

        coin,

        indicators,

        evaluation,

        market,

        timeframe

      );

      message(

        "analysis-message",

        coin.name + " analizi tamamlandı.",

        "success-message"

      );

      announce(

        coin.name + " analizi tamamlandı. Sinyal: " +

        evaluation.signal

      );

      if (market === "spot" && timeframe === "1d") {

        const signal = {

          id: coin.id,

          name: coin.name,

          symbol: coinSymbol(coin),

          signal: evaluation.signal,

          alignment: evaluation.alignment,

          risk: evaluation.risk

        };

        const existingIndex = state.signals.findIndex(

          item => item.id === coin.id

        );

        if (existingIndex >= 0) {

          state.signals[existingIndex] = signal;

        } else {

          state.signals.push(signal);

        }

        renderSignals();

      }

    } catch (error) {

      if (token !== state.analysisToken) return;

      message(

        "analysis-message",

        error.message || "Analiz yapılamadı.",

        "error-message"

      );

      if (el["technical-analysis-results"]) {

        el["technical-analysis-results"].textContent =

          error.message;

      }

      announce("Analiz yapılamadı. " + error.message);

    }

  }

  async function buildInitialSignals() {

    state.signals = [];

    if (state.market !== "spot") {

      renderSignals();

      message(

        "signal-message",

        "Otomatik günlük sinyal taraması spot piyasa üzerinden yapılır."

      );

      return;

    }

    const candidates = CONFIG.pinned

      .map(id => coinById(id))

      .filter(Boolean);

    message(

      "signal-message",

      "Öncelikli coinler analiz ediliyor."

    );

    for (const coin of candidates) {

      try {

        const candles = await fetchCandles(

          coin,

          "spot",

          "1d"

        );

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

        // Bir coin alınamazsa diğer coinlerin taraması sürer.

      }

    }

    renderSignals();

    if (!state.signals.length) {

      message(

        "signal-message",

        "Şu anda otomatik sinyal üretmek için veri alınamadı.",

        "error-message"

      );

    } else {

      message(

        "signal-message",

        state.signals.length +

        " coin için günlük sinyal hesaplandı."

      );

    }

  }

  async function loadMarkets() {

    if (state.loading) {

      state.pendingReload = true;

      return;

    }

    state.loading = true;

    if (el["refresh-button"]) {

      el["refresh-button"].disabled = true;

    }

    announce("Piyasa verileri yükleniyor.");

    message("market-message", "Piyasa verileri alınıyor.");

    try {

      const requestedMarket = state.market;

      const data = await fetchMarkets();

      if (requestedMarket !== state.market) {

        state.pendingReload = true;

        return;

      }

      state.coins = data;

      state.filtered = [...data];

      state.lastUpdated = new Date();

      renderBitcoin();

      renderMarketTable();

      fillAnalysisOptions();

      renderWatchlist();

      setCurrencyNote();

      if (el["last-updated"]) {

        el["last-updated"].textContent =

          "Son güncelleme: " +

          state.lastUpdated.toLocaleTimeString("tr-TR");

      }

      message(

        "market-message",

        state.coins.length + " coin için " +

        marketName(state.market) +

        " verileri güncellendi.",

        "success-message"

      );

      announce("Piyasa verileri güncellendi.");

      await buildInitialSignals();

    } catch (error) {

      message(

        "market-message",

        error.message || "Piyasa verileri alınamadı.",

        "error-message"

      );

      announce(

        "Piyasa verileri alınamadı. " + error.message

      );

    } finally {

      state.loading = false;

      if (el["refresh-button"]) {

        el["refresh-button"].disabled = false;

      }

      if (state.pendingReload) {

        state.pendingReload = false;

        loadMarkets();

      }

    }

  }

  function bindEvents() {

    el["refresh-button"]?.addEventListener(

      "click",

      loadMarkets

    );

    el["currency-select"]?.addEventListener(

      "change",

      event => {

        const value = event.target.value;

        if (!["usd", "usdt", "try"].includes(value)) return;

        state.currency = value;

        if (state.market === "spot") {

          loadMarkets();

        } else {

          setCurrencyNote();

          renderMarketTable();

          renderBitcoin();

        }

      }

    );

    el["market-type"]?.addEventListener(

      "change",

      event => {

        const value = event.target.value;

        if (!["spot", "usdt-m", "coin-m"].includes(value)) {

          return;

        }

        state.market = value;

        if (el["analysis-market"]) {

          el["analysis-market"].value = value;

        }

        loadMarkets();

        if (state.selectedCoin) {

          const selected = state.selectedCoin;

          setTimeout(() => {

            if (state.market === value) {

              openCoinAnalysis(selected);

            }

          }, 100);

        }

      }

    );

    el["coin-search"]?.addEventListener(

      "input",

      searchCoins

    );

    el["market-sort"]?.addEventListener(

      "change",

      renderMarketTable

    );

    el["signal-filter"]?.addEventListener(

      "change",

      renderSignals

    );

    el["analysis-coin"]?.addEventListener(

      "change",

      () => {

        if (el["analysis-coin"].value) {

          state.selectedCoin = el["analysis-coin"].value;

          runAnalysis();

        }

      }

    );

    el["analysis-timeframe"]?.addEventListener(

      "change",

      runAnalysis

    );

    el["analysis-market"]?.addEventListener(

      "change",

      event => {

        const value = event.target.value;

        if (!["spot", "usdt-m", "coin-m"].includes(value)) {

          return;

        }

        state.market = value;

        if (el["market-type"]) {

          el["market-type"].value = value;

        }

        loadMarkets();

        if (state.selectedCoin) {

          runAnalysis();

        }

      }

    );

    el["watchlist-form"]?.addEventListener(

      "submit",

      event => {

        event.preventDefault();

        addWatchlist();

      }

    );

  }

  function startRefresh() {

    if (state.refreshTimer) {

      clearInterval(state.refreshTimer);

    }

    state.refreshTimer = setInterval(() => {

      if (!document.hidden) {

        loadMarkets();

      }

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

      state.market = el["market-type"].value || "spot";

    }

    setCurrencyNote();

    loadMarkets();

    startRefresh();

    document.addEventListener(

      "visibilitychange",

      () => {

        if (!document.hidden) {

          announce("Platform yeniden etkinleştirildi.");

        }

      }

    );

  }

  if (document.readyState === "loading") {

    document.addEventListener(

      "DOMContentLoaded",

      initialize

    );

  } else {

    initialize();

  }

})();
