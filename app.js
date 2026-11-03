"use strict";

(() => {

  const CONFIG = {

    coinGecko: "https://api.coingecko.com/api/v3",

    binanceSpot: "https://api.binance.com",

    binanceUsdt: "https://fapi.binance.com",

    binanceCoin: "https://dapi.binance.com",

    refreshMs: 300000,

    timeoutMs: 15000,

    marketLimit: 100,

    watchlistKey: "kriptoAnalizIzlemeListesi",

    pinned: ["bitcoin", "ethereum", "solana", "cardano", "ripple", "dogecoin", "avalanche-2", "pepe"],

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

    marketRequest: 0,

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

  function announce(text) {

    if (el["connection-status"]) {

      el["connection-status"].textContent = text;

    }

  }

  function message(id, text, type = "") {

    if (!el[id]) return;

    el[id].textContent = text;

    el[id].className = "status-message " + type;

  }

  function number(value, digits = 2) {

    const n = Number(value);

    return Number.isFinite(n)

      ? new Intl.NumberFormat("tr-TR", {

          maximumFractionDigits: digits

        }).format(n)

      : "Veri yok";

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

      return number(n, 8) + " " + String(currency).toUpperCase();

    }

  }

  function percent(value) {

    const n = Number(value);

    return Number.isFinite(n)

      ? (n > 0 ? "+" : "") + number(n) + "%"

      : "Veri yok";

  }

  function signClass(value) {

    const n = Number(value);

    return !Number.isFinite(n) || n === 0

      ? "neutral"

      : n > 0 ? "positive" : "negative";

  }

  function coinSymbol(coin) {

    return String(coin?.symbol || "").toUpperCase();

  }

  function coinById(id) {

    return state.coins.find(coin => coin.id === id);

  }

  function formatMarketValue(value) {

    const n = Number(value);

    if (!Number.isFinite(n)) return "Veri yok";

    if (n >= 1e12) return number(n / 1e12) + " trilyon";

    if (n >= 1e9) return number(n / 1e9) + " milyar";

    if (n >= 1e6) return number(n / 1e6) + " milyon";

    return number(n, 0);

  }

  function marketName(value) {

    return value === "usdt-m"

      ? "USDT-M Vadeli"

      : value === "coin-m" ? "COIN-M Vadeli" : "Spot";

  }

  function timeframeName(value) {

    return ({

      "5m": "5 dakika",

      "15m": "15 dakika",

      "1h": "1 saat",

      "4h": "4 saat",

      "1d": "1 gün",

      "1w": "1 hafta"

    })[value] || value;

  }

  function indicatorCurrency(market) {

    return market === "spot" || market === "usdt-m"

      ? "usdt"

      : "usd";

  }

  function setCurrencyNote() {

    if (!el["currency-note"]) return;

    if (state.market === "spot") {

      el["currency-note"].textContent =

        "Piyasa tablosu CoinGecko verisiyle seçtiğiniz para biriminde gösterilir. Teknik göstergeler Binance Spot USDT paritesinin kapanmış mumlarından hesaplanır ve USDT cinsindendir. USD ile USDT aynı varlık değildir.";

    } else if (state.market === "usdt-m") {

      el["currency-note"].textContent =

        "USDT-M fiyatları ve teknik göstergeleri Binance USDT teminatlı sürekli sözleşme verisidir. Değerler USDT cinsindendir; gösterim para birimi seçimi bunu değiştirmez.";

    } else {

      el["currency-note"].textContent =

        "COIN-M fiyatları Binance COIN-M sürekli sözleşme verisidir. Fiyat ve teknik seviyeler USD kotasyonundadır. Hacim sözleşme adedi (kontrat) olarak gösterilir; USDT hacmiyle doğrudan karşılaştırılamaz.";

    }

  }

  async function request(url) {

    const controller = new AbortController();

    const timer = setTimeout(

      () => controller.abort(),

      CONFIG.timeoutMs

    );

    try {

      const response = await fetch(url, {

        method: "GET",

        headers: { Accept: "application/json" },

        signal: controller.signal

      });

      if (!response.ok) {

        throw new Error(

          response.status === 429

            ? "Veri kaynağının istek sınırına ulaşıldı. Biraz sonra tekrar deneyin."

            : "Veri kaynağı HTTP " + response.status + " hatası döndürdü."

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

  async function fetchSpotMarkets(currency = state.currency) {

    const vsCurrency = currency === "usdt" ? "usd" : currency;

    const params = new URLSearchParams({

      vs_currency: vsCurrency,

      order: "market_cap_desc",

      per_page: String(CONFIG.marketLimit),

      page: "1",

      sparkline: "false",

      price_change_percentage: "24h"

    });

    const data = await request(

      CONFIG.coinGecko + "/coins/markets?" + params

    );

    if (!Array.isArray(data)) {

      throw new Error("Spot piyasa verisi beklenen biçimde gelmedi.");

    }

    const found = new Set(data.map(item => item.id));

    const missing = CONFIG.pinned.filter(id => !found.has(id));

    if (missing.length) {

      try {

        const extraParams = new URLSearchParams({

          vs_currency: vsCurrency,

          ids: missing.join(","),

          order: "market_cap_desc",

          per_page: String(missing.length),

          page: "1",

          sparkline: "false",

          price_change_percentage: "24h"

        });

        const extra = await request(

          CONFIG.coinGecko + "/coins/markets?" + extraParams

        );

        if (Array.isArray(extra)) data.push(...extra);

      } catch (_) {

        // Ana piyasa listesi geldiyse ek coin isteği başarısız olsa da liste korunur.

      }

    }

    return data.map(item => ({

      ...item,

      market_type: "spot",

      volume_value: Number(item.total_volume),

      volume_unit: vsCurrency.toUpperCase(),

      volume_source: "CoinGecko"

    }));

  }

  async function fetchExchangeInfo(market) {

    if (state.exchangeInfo[market]) {

      return state.exchangeInfo[market];

    }

    const base = market === "spot"

      ? CONFIG.binanceSpot

      : market === "usdt-m"

        ? CONFIG.binanceUsdt

        : CONFIG.binanceCoin;

    const path = market === "spot"

      ? "/api/v3/exchangeInfo"

      : market === "usdt-m"

        ? "/fapi/v1/exchangeInfo"

        : "/dapi/v1/exchangeInfo";

    const data = await request(base + path);

    if (!Array.isArray(data.symbols)) {

      throw new Error("Binance sözleşme bilgileri alınamadı.");

    }

    state.exchangeInfo[market] = data.symbols;

    return data.symbols;

  }

  function findExchangeSymbol(coin, market, symbols) {

    const base = coinSymbol(coin);

    const matches = symbols.filter(item => {

      if (item.baseAsset !== base || item.status !== "TRADING") {

        return false;

      }

      if (market === "spot") {

        return item.quoteAsset === "USDT" &&

          item.isSpotTradingAllowed !== false;

      }

      if (market === "usdt-m") {

        return item.quoteAsset === "USDT" &&

          (!item.contractType || item.contractType === "PERPETUAL");

      }

      return item.quoteAsset === "USD" &&

        item.contractType === "PERPETUAL";

    });

    if (!matches.length) return null;

    matches.sort((a, b) =>

      String(a.symbol).localeCompare(String(b.symbol))

    );

    return matches[0].symbol;

  }

  async function fetchDerivativeMarkets(market) {

    const [metadata, symbols] = await Promise.all([

      fetchSpotMarkets("usd"),

      fetchExchangeInfo(market)

    ]);

    const base = market === "usdt-m"

      ? CONFIG.binanceUsdt

      : CONFIG.binanceCoin;

    const path = market === "usdt-m"

      ? "/fapi/v1/ticker/24hr"

      : "/dapi/v1/ticker/24hr";

    const tickers = await request(base + path);

    if (!Array.isArray(tickers)) {

      throw new Error("Vadeli piyasa fiyatları alınamadı.");

    }

    const tickerMap = new Map(

      tickers.map(item => [item.symbol, item])

    );

    const result = [];

    for (const coin of metadata) {

      const symbol = findExchangeSymbol(coin, market, symbols);

      const ticker = symbol ? tickerMap.get(symbol) : null;

      if (!ticker) continue;

      const current = Number(ticker.lastPrice);

      const change = Number(ticker.priceChangePercent);

      if (

        !Number.isFinite(current) ||

        current <= 0 ||

        !Number.isFinite(change)

      ) {

        continue;

      }

      const volume = market === "coin-m"

        ? Number(ticker.volume)

        : Number(ticker.quoteVolume);

      result.push({

        ...coin,

        current_price: current,

        price_change_percentage_24h: change,

        total_volume: Number.isFinite(volume) ? volume : null,

        volume_value: Number.isFinite(volume) ? volume : null,

        volume_unit: market === "coin-m" ? "kontrat" : "USDT",

        volume_source: "Binance",

        market_cap: null,

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

  async function fetchMarkets(market, currency) {

    return market === "spot"

      ? fetchSpotMarkets(currency)

      : fetchDerivativeMarkets(market);

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

        state.market === "spot"

          ? state.currency

          : indicatorCurrency(state.market)

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

    const coins = [...state.filtered];

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

        (b.volume_value || 0) - (a.volume_value || 0)

      );

    } else {

      coins.sort((a, b) =>

        (a.market_cap_rank || 999999) -

        (b.market_cap_rank || 999999)

      );

    }

    body.replaceChildren();

    if (!coins.length) {

      const row = document.createElement("tr");

      row.appendChild(makeCell("Aramanızla eşleşen coin bulunamadı."));

      body.appendChild(row);

      return;

    }

    coins.forEach(coin => {

      const row = document.createElement("tr");

      const nameCell = document.createElement("td");

      const button = document.createElement("button");

      button.type = "button";

      button.className = "coin-name-button";

      button.textContent =

        coin.name + " (" + coinSymbol(coin) + ")";

      button.dataset.coinId = coin.id;

      button.setAttribute(

        "aria-label",

        coin.name + " ayrıntılı analizini aç"

      );

      button.addEventListener("click", () => {

        openCoinAnalysis(coin.id);

      });

      nameCell.appendChild(button);

      row.appendChild(nameCell);

      row.appendChild(makeCell(

        price(

          coin.current_price,

          state.market === "spot"

            ? state.currency

            : indicatorCurrency(state.market)

        )

      ));

      row.appendChild(makeCell(

        percent(coin.price_change_percentage_24h),

        signClass(coin.price_change_percentage_24h)

      ));

      row.appendChild(makeCell(

        coin.market_cap == null

          ? "Vadeli piyasada gösterilmiyor"

          : formatMarketValue(coin.market_cap)

      ));

      const actionCell = document.createElement("td");

      const action = document.createElement("button");

      action.type = "button";

      action.textContent = "Analiz et";

      action.dataset.coinId = coin.id;

      action.setAttribute("aria-label", coin.name + " analiz et");

      action.addEventListener("click", () => {

        openCoinAnalysis(coin.id);

      });

      actionCell.appendChild(action);

      row.appendChild(actionCell);

      body.appendChild(row);

    });

  }

  function searchCoins() {

    const query = (el["coin-search"]?.value || "")

      .trim()

      .toLocaleLowerCase("tr-TR");

    state.filtered = state.coins.filter(coin =>

      !query ||

      String(coin.name).toLocaleLowerCase("tr-TR").includes(query) ||

      coinSymbol(coin).toLocaleLowerCase("tr-TR").includes(query) ||

      String(coin.id).toLocaleLowerCase("tr-TR").includes(query)

    );

    renderMarketTable();

    message(

      "market-message",

      state.filtered.length + " coin bulundu."

    );

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

      const label = document.createElement("span");

      const remove = document.createElement("button");

      wrapper.className = "watchlist-item";

      label.textContent = coin

        ? coin.name + " (" + coinSymbol(coin) + ")"

        : id;

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

      .trim()

      .toLocaleLowerCase("tr-TR");

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

    return values.length

      ? values.reduce((sum, value) => sum + value, 0) / values.length

      : null;

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

    return values.length < period

      ? null

      : average(values.slice(-period));

  }

  function rsi(values, period = 14) {

    if (values.length <= period) return null;

    let gains = 0;

    let losses = 0;

    for (let i = 1; i <= period; i++) {

      const d = values[i] - values[i - 1];

      if (d > 0) gains += d;

      else losses += Math.abs(d);

    }

    let avgGain = gains / period;

    let avgLoss = losses / period;

    for (let i = period + 1; i < values.length; i++) {

      const d = values[i] - values[i - 1];

      avgGain =

        (avgGain * (period - 1) + Math.max(d, 0)) / period;

      avgLoss =

        (avgLoss * (period - 1) + Math.max(-d, 0)) / period;

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

    const signal = ema(line, 9);

    if (!signal.length) return null;

    const lineValue = line[line.length - 1];

    const signalValue = signal[signal.length - 1];

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

      sample.map(value => (value - mid) ** 2)

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

      const up = current.high - previous.high;

      const down = previous.low - current.low;

      plusDM.push(

        up > down && up > 0 ? up : 0

      );

      minusDM.push(

        down > up && down > 0 ? down : 0

      );

      trs.push(trueRange(current, previous));

    }

    let tr = trs.slice(0, period)

      .reduce((a, b) => a + b, 0);

    let plus = plusDM.slice(0, period)

      .reduce((a, b) => a + b, 0);

    let minus = minusDM.slice(0, period)

      .reduce((a, b) => a + b, 0);

    const dx = [];

    const getDX = () => {

      if (tr <= 0) return 0;

      const p = 100 * plus / tr;

      const m = 100 * minus / tr;

      const total = p + m;

      return total === 0

        ? 0

        : 100 * Math.abs(p - m) / total;

    };

    dx.push(getDX());

    for (let i = period; i < trs.length; i++) {

      tr = tr - tr / period + trs[i];

      plus = plus - plus / period + plusDM[i];

      minus = minus - minus / period + minusDM[i];

      dx.push(getDX());

    }

    if (dx.length < period) return null;

    let result = average(dx.slice(0, period));

    for (let i = period; i < dx.length; i++) {

      result =

        (result * (period - 1) + dx[i]) / period;

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

    return denominator > 0

      ? numerator / denominator

      : null;

  }

  function calculateIndicators(candles) {

    if (!Array.isArray(candles) || candles.length < 30) {

      throw new Error(

        "Teknik analiz için yeterli kapanmış mum bulunamadı."

      );

    }

    const closes = candles.map(candle => candle.close);

    const last = closes[closes.length - 1];

    const e20 = ema(closes, 20);

    const e50 = ema(closes, 50);

    const e100 = ema(closes, 100);

    const e200 = ema(closes, 200);

    const recent = candles.slice(-20);

    return {

      last,

      rsi: rsi(closes),

      ema20: e20.at(-1) ?? null,

      ema50: e50.at(-1) ?? null,

      ema100: e100.at(-1) ?? null,

      ema200: e200.at(-1) ?? null,

      sma50: sma(closes, 50),

      sma200: sma(closes, 200),

      macd: macd(closes),

      bollinger: bollinger(closes),

      atr: atr(candles),

      adx: adx(candles),

      vwap: vwap(candles),

      volume: candles.at(-1).volume,

      averageVolume: average(

        recent.map(candle => candle.volume)

      ),

      support: Math.min(

        ...recent.map(candle => candle.low)

      ),

      resistance: Math.max(

        ...recent.map(candle => candle.high)

      )

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

        reasons.push(

          "RSI aşırı satım bölgesinde; dönüş teyidi gerekir"

        );

      } else if (indicators.rsi > 70) {

        reasons.push(

          "RSI aşırı alım bölgesinde; geri çekilme riski vardır"

        );

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

        reasons.push(

          "Fiyat son 20 mumluk hacim ağırlıklı ortalamanın üzerinde"

        );

      } else if (indicators.last < indicators.vwap) {

        score -= 0.5;

        reasons.push(

          "Fiyat son 20 mumluk hacim ağırlıklı ortalamanın altında"

        );

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

    return {

      signal,

      score,

      alignment: Math.round(Math.abs(score) / 3 * 100),

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

      const cell = makeCell(item.signal);

      cell.className =

        "signal-label " +

        (item.signal.includes("AL")

          ? "signal-buy"

          : item.signal.includes("SAT")

            ? "signal-sell"

            : "signal-hold");

      row.appendChild(cell);

      row.appendChild(

        makeCell(number(item.score, 1) + " puan")

      );

      row.appendChild(

        makeCell(

          item.atrPercent === null

            ? "ATR yok"

            : "ATR %" + number(item.atrPercent)

        )

      );

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

    message(

      "signal-message",

      filtered.length +

      " sinyal gösteriliyor. Puan başarı olasılığı değildir."

    );

  }

  function renderDetails(

    coin,

    indicators,

    evaluation,

    market,

    timeframe,

    candleCount

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

    const displayCurrency = market === "spot"

      ? state.currency

      : indicatorCurrency(market);

    const volumeLabel = market === "coin-m"

      ? "Son 24 saat hacmi (kontrat)"

      : "Son 24 saat hacmi (" +

        (market === "spot"

          ? String(state.currency).toUpperCase()

          : "USDT") + ")";

    const details = [

      ["Piyasa türü", marketName(market)],

      ["Zaman dilimi", timeframeName(timeframe)],

      ["Piyasa fiyatı", price(coin.current_price, displayCurrency)],

      ["24 saatlik değişim", percent(coin.price_change_percentage_24h)],

      [

        "Piyasa değeri",

        coin.market_cap == null

          ? "Bu piyasada sunulmuyor"

          : formatMarketValue(coin.market_cap)

      ],

      [

        volumeLabel,

        coin.volume_value == null

          ? "Veri yok"

          : number(

              coin.volume_value,

              market === "coin-m" ? 0 : 2

            )

      ],

      ["Teknik sinyal", evaluation.signal],

      [

        "Gösterge uyum puanı",

        number(evaluation.score, 1) +

        " puan (başarı olasılığı değildir)"

      ],

      [

        "ATR / fiyat",

        evaluation.atrPercent === null

          ? "Hesaplanamadı"

          : "%" + number(evaluation.atrPercent)

      ],

      ["Kullanılan kapanmış mum", String(candleCount)]

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

    title.textContent =

      "Teknik göstergeler — " +

      (market === "spot"

        ? "USDT"

        : indicatorCurrency(market).toUpperCase());

    results.appendChild(title);

    const list = document.createElement("ul");

    list.className = "indicator-list";

    const entries = [

      [

        "RSI (14)",

        indicators.rsi === null

          ? "Yetersiz veri"

          : number(indicators.rsi)

      ],

      ["EMA 20", price(indicators.ema20, indicatorCurrency(market))],

      ["EMA 50", price(indicators.ema50, indicatorCurrency(market))],

      ["EMA 100", price(indicators.ema100, indicatorCurrency(market))],

      ["EMA 200", price(indicators.ema200, indicatorCurrency(market))],

      ["SMA 50", price(indicators.sma50, indicatorCurrency(market))],

      ["SMA 200", price(indicators.sma200, indicatorCurrency(market))],

      [

        "MACD",

        indicators.macd

          ? number(indicators.macd.line, 8)

          : "Yetersiz veri"

      ],

      [

        "MACD sinyal",

        indicators.macd

          ? number(indicators.macd.signal, 8)

          : "Yetersiz veri"

      ],

      [

        "MACD histogramı",

        indicators.macd

          ? number(indicators.macd.histogram, 8)

          : "Yetersiz veri"

      ],

      [

        "Bollinger üst",

        indicators.bollinger

          ? price(indicators.bollinger.upper, indicatorCurrency(market))

          : "Yetersiz veri"

      ],

      [

        "Bollinger orta",

        indicators.bollinger

          ? price(indicators.bollinger.middle, indicatorCurrency(market))

          : "Yetersiz veri"

      ],

      [

        "Bollinger alt",

        indicators.bollinger

          ? price(indicators.bollinger.lower, indicatorCurrency(market))

          : "Yetersiz veri"

      ],

      [

        "ATR (14)",

        indicators.atr === null

          ? "Yetersiz veri"

          : number(indicators.atr, 8)

      ],

      [

        "ADX (14)",

        indicators.adx === null

          ? "Yetersiz veri"

          : number(indicators.adx)

      ],

      [

        "Son 20 mum hacim ağırlıklı ortalaması",

        price(indicators.vwap, indicatorCurrency(market))

      ],

      ["Son kapanmış mum hacmi", number(indicators.volume, 4)],

      ["20 mum ortalama hacim", number(indicators.averageVolume, 4)],

      [

        "Destek seviyesi",

        price(indicators.support, indicatorCurrency(market))

      ],

      [

        "Direnç seviyesi",

        price(indicators.resistance, indicatorCurrency(market))

      ]

    ];

    entries.forEach(([label, value]) => {

      const item = document.createElement("li");

      item.textContent = label + ": " + value;

      list.appendChild(item);

    });

    results.appendChild(list);

    const reasonHeading = document.createElement("h3");

    reasonHeading.textContent = "Sinyal gerekçeleri";

    results.appendChild(reasonHeading);

    const reasonList = document.createElement("ul");

    (

      evaluation.reasons.length

        ? evaluation.reasons

        : ["Yeterli gösterge verisi bulunamadı."]

    ).forEach(reason => {

      const item = document.createElement("li");

      item.textContent = reason;

      reasonList.appendChild(item);

    });

    results.appendChild(reasonList);

    const note = document.createElement("p");

    note.className = "notice";

    note.textContent =

      "Sinyal puanı istatistiksel başarı yüzdesi değildir. " +

      "VWAP burada klasik seans VWAP'ı değil, son 20 kapanmış " +

      "mumun hacim ağırlıklı ortalamasıdır. Destek ve direnç " +

      "son 20 kapanmış mumun en düşük ve en yüksek değerleridir. " +

      "Spot piyasa tablosu ile spot teknik göstergelerin fiyat " +

      "kaynakları ve para birimleri farklı olabilir.";

    results.appendChild(note);

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

    const base = market === "usdt-m"

      ? CONFIG.binanceUsdt

      : market === "coin-m"

        ? CONFIG.binanceCoin

        : CONFIG.binanceSpot;

    const path = market === "usdt-m"

      ? "/fapi/v1/klines"

      : market === "coin-m"

        ? "/dapi/v1/klines"

        : "/api/v3/klines";

    const symbol = await resolveSymbol(coin, market);

    const params = new URLSearchParams({

      symbol,

      interval: timeframe,

      limit: "250"

    });

    const raw = await request(

      base + path + "?" + params

    );

    if (!Array.isArray(raw) || !raw.length) {

      throw new Error(

        "Bu coin ve piyasa için mum verisi bulunamadı."

      );

    }

    const now = Date.now();

    const mapped = raw.map(item => ({

      time: Number(item[0]),

      openTime: Number(item[0]),

      closeTime: Number(item[6]),

      open: Number(item[1]),

      high: Number(item[2]),

      low: Number(item[3]),

      close: Number(item[4]),

      volume: Number(item[5])

    }));

    const valid = mapped.filter(c =>

      Number.isFinite(c.time) &&

      c.time > 0 &&

      Number.isFinite(c.closeTime) &&

      c.closeTime < now &&

      Number.isFinite(c.open) &&

      c.open > 0 &&

      Number.isFinite(c.high) &&

      c.high > 0 &&

      Number.isFinite(c.low) &&

      c.low > 0 &&

      Number.isFinite(c.close) &&

      c.close > 0 &&

      Number.isFinite(c.volume) &&

      c.volume >= 0 &&

      c.high >= Math.max(c.open, c.close, c.low) &&

      c.low <= Math.min(c.open, c.close, c.high)

    );

    const unique = new Map();

    valid.forEach(c => unique.set(c.time, c));

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

    if (state.market !== market) {

      state.market = market;

      await loadMarkets();

    }

    const currentCoin = coinById(id);

    if (!currentCoin) {

      message(

        "analysis-message",

        "Bu coin seçilen piyasada listelenmiyor. Başka bir piyasa deneyin.",

        "error-message"

      );

      return;

    }

    $("analysis")?.scrollIntoView({ behavior: "smooth" });

    await runAnalysis();

  }

  async function runAnalysis() {

    const id = el["analysis-coin"]?.value;

    const market =

      el["analysis-market"]?.value || state.market;

    const timeframe =

      el["analysis-timeframe"]?.value || "1d";

    if (!id) {

      message(

        "analysis-message",

        "Önce analiz edilecek bir coin seçin."

      );

      return;

    }

    if (!CONFIG.timeframes.includes(timeframe)) {

      message(

        "analysis-message",

        "Geçersiz zaman dilimi seçildi.",

        "error-message"

      );

      return;

    }

    const token = ++state.analysisToken;

    state.selectedCoin = id;

    if (state.market !== market) {

      state.market = market;

      if (el["market-type"]) {

        el["market-type"].value = market;

      }

      await loadMarkets();

      if (token !== state.analysisToken) return;

    }

    const coin = coinById(id);

    if (!coin) {

      message(

        "analysis-message",

        "Seçilen coin bu piyasada bulunamadı.",

        "error-message"

      );

      return;

    }

    message(

      "analysis-message",

      coin.name + " için kapanmış mum verileri alınıyor."

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

          "Bu analiz için yeterli kapanmış mum verisi bulunamadı."

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

        timeframe,

        candles.length

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

          score: evaluation.score,

          atrPercent: evaluation.atrPercent

        };

        const index = state.signals.findIndex(

          item => item.id === coin.id

        );

        if (index >= 0) {

          state.signals[index] = signal;

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

        "Otomatik günlük sinyal taraması yalnızca Spot piyasada yapılır."

      );

      return;

    }

    const candidates = CONFIG.pinned

      .map(id => coinById(id))

      .filter(Boolean);

    message(

      "signal-message",

      "Öncelikli coinler kapanmış günlük mumlarla analiz ediliyor."

    );

    for (const coin of candidates) {

      try {

        const candles = await fetchCandles(

          coin,

          "spot",

          "1d"

        );

        if (candles.length < 30) continue;

        const evaluation = evaluateSignal(

          calculateIndicators(candles)

        );

        state.signals.push({

          id: coin.id,

          name: coin.name,

          symbol: coinSymbol(coin),

          signal: evaluation.signal,

          score: evaluation.score,

          atrPercent: evaluation.atrPercent

        });

      } catch (_) {

        // Bir coin verisi alınamazsa diğer coinler taranmaya devam eder.

      }

    }

    renderSignals();

    message(

      "signal-message",

      state.signals.length

        ? state.signals.length +

          " coin için günlük sinyal hesaplandı. Puan başarı olasılığı değildir."

        : "Şu anda otomatik sinyal üretmek için veri alınamadı.",

      state.signals.length ? "" : "error-message"

    );

  }

  async function loadMarkets() {

    if (state.loading) {

      state.pendingReload = true;

      return;

    }

    state.loading = true;

    const requestId = ++state.marketRequest;

    const requestedMarket = state.market;

    const requestedCurrency = state.currency;

    if (el["refresh-button"]) {

      el["refresh-button"].disabled = true;

    }

    announce("Piyasa verileri yükleniyor.");

    message("market-message", "Piyasa verileri alınıyor.");

    try {

      const data = await fetchMarkets(

        requestedMarket,

        requestedCurrency

      );

      if (

        requestId !== state.marketRequest ||

        requestedMarket !== state.market ||

        requestedCurrency !== state.currency

      ) {

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

      if (requestId === state.marketRequest) {

        message(

          "market-message",

          error.message || "Piyasa verileri alınamadı.",

          "error-message"

        );

        announce(

          "Piyasa verileri alınamadı. " + error.message

        );

      }

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

      () => loadMarkets()

    );

    el["currency-select"]?.addEventListener(

      "change",

      event => {

        const value = event.target.value;

        if (!["usd", "usdt", "try"].includes(value)) {

          return;

        }

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

        state.analysisToken++;

        loadMarkets();

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

        state.analysisToken++;

        loadMarkets();

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

    document.addEventListener("DOMContentLoaded", initialize);

  } else {

    initialize();

  }

})();
