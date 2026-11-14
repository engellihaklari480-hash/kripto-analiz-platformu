

"use strict";

(() => {

  const CONFIG = {

    api: "https://kripto-analiz-api.engellihaklari480.workers.dev",

    refreshMs: 300000,

    timeoutMs: 18000,

    marketLimit: 500,

    watchlistKey: "kriptoAnalizIzlemeListesi",

    timeframes: ["5m", "15m", "1h", "4h", "1d", "1w"],

    pinned: ["BTC", "ETH", "SOL", "ADA", "XRP", "DOGE", "AVAX", "PEPE"]

  };

  const state = {

    currency: "usdt",

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

    lastUpdated: null

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

      "coin-detail", "technical-analysis-results", "analysis-message",

      "watchlist-form", "watchlist-coin", "watchlist-items", "watchlist-message"

    ].forEach(id => { el[id] = $(id); });

  }

  function announce(text) {

    if (el["connection-status"]) el["connection-status"].textContent = text;

  }

  function message(id, text, type = "") {

    if (!el[id]) return;

    el[id].textContent = text;

    el[id].className = "status-message " + type;

  }

  function number(value, digits = 2) {

    if (value === null || value === undefined || value === "") return "Veri yok";

    const n = Number(value);

    return Number.isFinite(n)

      ? new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(n)

      : "Veri yok";

  }

  function price(value, currency = displayCurrency()) {

    if (value === null || value === undefined || value === "") return "Veri yok";

    const n = Number(value);

    if (!Number.isFinite(n)) return "Veri yok";

    const digits = n < 1 ? 8 : 2;

    return number(n, digits) + " " + String(currency).toUpperCase();

  }

  function percent(value) {

    if (value === null || value === undefined || value === "") return "Veri yok";

    const n = Number(value);

    return Number.isFinite(n) ? (n > 0 ? "+" : "") + number(n, 2) + "%" : "Veri yok";

  }

  function signClass(value) {

    const n = Number(value);

    return !Number.isFinite(n) || n === 0 ? "neutral" : n > 0 ? "positive" : "negative";

  }

  function apiMarket(market = state.market) {

    return market === "usdt-m" ? "usdtm" : market === "coin-m" ? "coinm" : "spot";

  }

  function marketName(market) {

    return market === "usdt-m" ? "USDT-M Vadeli" : market === "coin-m" ? "COIN-M Vadeli" : "Spot";

  }

  function displayCurrency(market = state.market) {

    return market === "coin-m" ? "USD" : "USDT";

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

  function baseSymbol(item) {

    const instrument = String(item.instrument || item.symbol || "");

    const clean = instrument.replace(/-SWAP$/i, "");

    return clean.split("-")[0].replace(/USDT$|USD$/i, "").toUpperCase() || "?";

  }

  function normalizeMarketItem(item, index) {

    const symbol = baseSymbol(item);

    return {

      id: item.instrument || item.symbol || symbol + "-" + index,

      name: symbol,

      symbol,

      current_price: Number(item.last),

      price_change_percentage_24h: item.change24hPercent,

      volume_value: item.volume24hQuote ?? item.volume24hBase,

      volume_unit: state.market === "coin-m" ? "USD" : "USDT",

      instrument: item.instrument || item.symbol,

      market_cap: null,

      timestamp: item.timestamp

    };

  }

  async function request(path, params = {}) {

    const url = new URL(CONFIG.api + path);

    Object.entries(params).forEach(([key, value]) => {

      if (value !== undefined && value !== null && value !== "") {

        url.searchParams.set(key, String(value));

      }

    });

    const controller = new AbortController();

    const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

    try {

      const response = await fetch(url.toString(), {

        method: "GET",

        headers: { Accept: "application/json" },

        signal: controller.signal

      });

      let data;

      try {

        data = await response.json();

      } catch (_) {

        throw new Error("Sunucudan okunabilir bir yanıt alınamadı.");

      }

      if (!response.ok) {

        const detail = data && data.error ? data.error : "HTTP " + response.status;

        if (response.status === 429) {

          throw new Error("OKX istek sınırına ulaşıldı. Biraz bekleyip yeniden deneyin. " + detail);

        }

        throw new Error(detail);

      }

      return data;

    } catch (error) {

      if (error.name === "AbortError") {

        throw new Error("Veri isteği zaman aşımına uğradı.");

      }

      throw error;

    } finally {

      clearTimeout(timer);

    }

  }

  function setCurrencyNote() {

    if (!el["currency-note"]) return;

    const market = state.market;

    el["currency-note"].textContent = market === "coin-m"

      ? "COIN-M sözleşme fiyatları OKX tarafından USD kotasyonuyla sunulur. TRY dönüşümü yapılmaz. USD ve USDT farklı varlıklardır."

      : "Fiyatlar OKX'in USDT kotasyonlu paritelerinden alınır ve USDT olarak gösterilir. USD'ye veya TRY'ye çevrilmez. USD ile USDT aynı varlık değildir.";

    if (el["currency-select"]) {

      const select = el["currency-select"];

      Array.from(select.options).forEach(option => {

        option.disabled =

          option.value === "try" ||

          (option.value === "usd" && market !== "coin-m") ||

          (option.value === "usdt" && market === "coin-m");

      });

      const wanted = displayCurrency(market).toLowerCase();

      select.value = wanted;

      state.currency = wanted;

    }

  }

  function coinById(id) {

    return state.coins.find(coin => coin.id === id);

  }

  function renderBitcoin() {

    const btc = state.coins.find(coin => coin.symbol === "BTC");

    if (el["btc-price"]) {

      el["btc-price"].textContent = btc

        ? price(btc.current_price)

        : "Bu piyasada Bitcoin verisi yok";

    }

    if (el["btc-change"]) {

      el["btc-change"].textContent = btc

        ? "24 saat: " + percent(btc.price_change_percentage_24h)

        : "Veri yok";

      el["btc-change"].className =

        "change-value " + (btc ? signClass(btc.price_change_percentage_24h) : "neutral");

    }

    if (el["market-overview-message"]) {

      el["market-overview-message"].textContent =

        state.coins.length + " coin listelendi. Piyasa: " +

        marketName(state.market) + ". Veri kaynağı: OKX.";

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

    const sort = el["market-sort"]?.value || "volume";

    if (sort === "change-desc") {

      coins.sort((a, b) =>

        (Number(b.price_change_percentage_24h) || 0) -

        (Number(a.price_change_percentage_24h) || 0)

      );

    } else if (sort === "change-asc") {

      coins.sort((a, b) =>

        (Number(a.price_change_percentage_24h) || 0) -

        (Number(b.price_change_percentage_24h) || 0)

      );

    } else {

      coins.sort((a, b) =>

        (Number(b.volume_value) || 0) -

        (Number(a.volume_value) || 0)

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

      button.textContent = coin.name + " (" + coin.symbol + ")";

      button.setAttribute("aria-label", coin.name + " ayrıntılı analizini aç");

      button.addEventListener("click", () => openCoinAnalysis(coin.id));

      nameCell.appendChild(button);

      row.appendChild(nameCell);

      row.appendChild(makeCell(price(coin.current_price)));

      row.appendChild(makeCell(

        percent(coin.price_change_percentage_24h),

        signClass(coin.price_change_percentage_24h)

      ));

      row.appendChild(makeCell("OKX piyasa değeri sağlamıyor"));

      const actionCell = document.createElement("td");

      const action = document.createElement("button");

      action.type = "button";

      action.textContent = "Analiz et";

      action.setAttribute("aria-label", coin.name + " analiz et");

      action.addEventListener("click", () => openCoinAnalysis(coin.id));

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

      coin.name.toLocaleLowerCase("tr-TR").includes(query) ||

      coin.symbol.toLocaleLowerCase("tr-TR").includes(query) ||

      coin.instrument.toLocaleLowerCase("tr-TR").includes(query)

    );

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

      option.textContent = coin.name + " (" + coin.symbol + ")";

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

        ? value.filter(id => typeof id === "string")

        : [];

    } catch (_) {

      state.watchlist = [];

    }

  }

  function migrateWatchlistIds() {

    const legacy = {

      bitcoin: "BTC",

      ethereum: "ETH",

      solana: "SOL",

      cardano: "ADA",

      ripple: "XRP",

      dogecoin: "DOGE",

      "avalanche-2": "AVAX",

      pepe: "PEPE"

    };

    state.watchlist = state.watchlist.map(id => {

      const symbol = legacy[id] || id.toUpperCase();

      const match = state.coins.find(coin =>

        coin.symbol === symbol || coin.instrument === id

      );

      return match ? match.id : id;

    });

    state.watchlist = [...new Set(state.watchlist)];

    saveWatchlist();

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

      label.textContent = coin ? coin.name + " (" + coin.symbol + ")" : id;

      remove.type = "button";

      remove.textContent = "Listeden çıkar";

      remove.setAttribute("aria-label", label.textContent + " listesinden çıkar");

      remove.addEventListener("click", () => {

        state.watchlist = state.watchlist.filter(itemId => itemId !== id);

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

    const coin = state.coins.find(item =>

      item.instrument.toLocaleLowerCase("tr-TR") === query ||

      item.name.toLocaleLowerCase("tr-TR") === query ||

      item.symbol.toLocaleLowerCase("tr-TR") === query

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

      message("watchlist-message", "Bu coin zaten takip listenizde.");

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

  function signalClass(signal) {

    return signal.includes("AL")

      ? "signal-buy"

      : signal.includes("SAT")

        ? "signal-sell"

        : "signal-hold";

  }

  function renderSignals() {

    const body = el["signal-table-body"];

    if (!body) return;

    const filter = el["signal-filter"]?.value || "all";

    const map = {

      "GÜÇLÜ AL": "strong-buy",

      "AL": "buy",

      "TUT": "hold",

      "SAT": "sell",

      "GÜÇLÜ SAT": "strong-sell",

      "SİNYAL YOK": "none"

    };

    const filtered = state.signals.filter(item =>

      filter === "all" || map[item.signal] === filter

    );

    body.replaceChildren();

    if (!filtered.length) {

      const row = document.createElement("tr");

      row.appendChild(makeCell("Bu filtrede sinyal bulunamadı veya henüz analiz yapılmadı."));

      body.appendChild(row);

    } else {

      filtered.forEach(item => {

        const row = document.createElement("tr");

        row.appendChild(makeCell(item.name + " (" + item.symbol + ")"));

        const signal = makeCell(item.signal);

        signal.className = "signal-label " + signalClass(item.signal);

        row.appendChild(signal);

        row.appendChild(makeCell(number(item.score, 1) + " puan"));

        row.appendChild(makeCell(

          item.risk ? "Stop referansı mevcut" : "Risk seviyesi hesaplanmadı"

        ));

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

    }

    message(

      "signal-message",

      filtered.length + " sinyal gösteriliyor. Puan başarı olasılığı değildir."

    );

  }

  function addDetail(grid, label, value) {

    const wrapper = document.createElement("div");

    wrapper.className = "detail-item";

    const term = document.createElement("dt");

    const description = document.createElement("dd");

    term.textContent = label;

    description.textContent = value == null ? "Veri yok" : String(value);

    wrapper.append(term, description);

    grid.appendChild(wrapper);

  }

  function renderDetails(coin, payload, market, timeframe) {

    const detail = el["coin-detail"];

    const results = el["technical-analysis-results"];

    if (!detail || !results) return;

    const analysis = payload.analysis || {};

    detail.replaceChildren();

    results.replaceChildren();

    const heading = document.createElement("h3");

    heading.textContent = coin.name + " (" + coin.symbol + ")";

    detail.appendChild(heading);

    const grid = document.createElement("dl");

    grid.className = "detail-grid";

    addDetail(grid, "Piyasa türü", marketName(market));

    addDetail(grid, "Enstrüman", payload.instrument);

    addDetail(grid, "Zaman dilimi", timeframeName(timeframe));

    addDetail(grid, "Son fiyat", price(analysis.lastPrice, displayCurrency(market)));

    addDetail(grid, "Teknik sinyal", analysis.signal || "SİNYAL YOK");

    addDetail(grid, "Sinyal puanı", number(analysis.score, 1));

    addDetail(grid, "Kapanmış mum sayısı", analysis.candleCount);

    addDetail(

      grid,

      "Veri güncelliği",

      payload.dataFreshness?.stale ? "Eski veri — sinyal geçersiz" : "Güncel kapanmış mum"

    );

    detail.appendChild(grid);

    const title = document.createElement("h3");

    title.textContent = "Teknik göstergeler";

    results.appendChild(title);

    const list = document.createElement("ul");

    list.className = "indicator-list";

    const entries = [

      ["RSI (14)", analysis.rsi14 == null ? "Veri yok" : number(analysis.rsi14)],

      ["Stochastic RSI (14)", analysis.stochasticRsi14 == null ? "Veri yok" : number(analysis.stochasticRsi14)],

      ...[9, 20, 50, 100, 200].map(period => [

        "EMA " + period,

        price(analysis.ema?.[period], displayCurrency(market))

      ]),

      ["SMA 50", price(analysis.sma50, displayCurrency(market))],

      ["SMA 200", price(analysis.sma200, displayCurrency(market))],

      ["MACD", number(analysis.macd, 8)],

      ["MACD sinyal", number(analysis.macdSignal, 8)],

      ["MACD histogramı", number(analysis.macdHistogram, 8)],

      ["Bollinger üst", price(analysis.bollinger?.upper, displayCurrency(market))],

      ["Bollinger orta", price(analysis.bollinger?.middle, displayCurrency(market))],

      ["Bollinger alt", price(analysis.bollinger?.lower, displayCurrency(market))],

      ["ATR (14)", number(analysis.atr14, 8)],

      ["ADX (14)", number(analysis.adx14)],

      ["VWAP (20 mum)", price(analysis.vwap20, displayCurrency(market))],

      ["Destek (20 mum)", price(analysis.support20, displayCurrency(market))],

      ["Direnç (20 mum)", price(analysis.resistance20, displayCurrency(market))]

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

    const reasons = document.createElement("ul");

    (

      Array.isArray(analysis.reasons) && analysis.reasons.length

        ? analysis.reasons

        : ["Yeterli veriyle sinyal oluşturulamadı."]

    ).forEach(reason => {

      const item = document.createElement("li");

      item.textContent = reason;

      reasons.appendChild(item);

    });

    results.appendChild(reasons);

    if (analysis.riskModel) {

      const riskTitle = document.createElement("h3");

      riskTitle.textContent = "Teorik risk seviyeleri";

      results.appendChild(riskTitle);

      const riskList = document.createElement("ul");

      const riskEntries = [

        [

          "Yön",

          analysis.riskModel.direction === "long"

            ? "Yukarı yönlü senaryo"

            : "Aşağı yönlü senaryo"

        ],

        ["Referans giriş", price(analysis.riskModel.entryReference, displayCurrency(market))],

        ["Örnek stop-loss", price(analysis.riskModel.stopLossIllustrative, displayCurrency(market))],

        ["Birinci hedef", price(analysis.riskModel.target1Illustrative, displayCurrency(market))],

        ["İkinci hedef", price(analysis.riskModel.target2Illustrative, displayCurrency(market))],

        ["Risk / ödül", "1:2 ve 1:3 teorik oran"],

        ["Geçersizlik koşulu", analysis.riskModel.invalidation]

      ];

      riskEntries.forEach(([label, value]) => {

        const item = document.createElement("li");

        item.textContent = label + ": " + (value ?? "Veri yok");

        riskList.appendChild(item);

      });

      results.appendChild(riskList);

      if (analysis.riskModel.note) {

        const note = document.createElement("p");

        note.className = "notice";

        note.textContent = analysis.riskModel.note;

        results.appendChild(note);

      }

    }

    const warning = document.createElement("p");

    warning.className = "notice";

    warning.textContent = payload.warning ||

      "Bu analiz araştırma amaçlıdır; yatırım tavsiyesi veya işlem emri değildir.";

    results.appendChild(warning);

  }

  async function runAnalysis() {

    const id = el["analysis-coin"]?.value;

    const market = el["analysis-market"]?.value || state.market;

    const timeframe = el["analysis-timeframe"]?.value || "1d";

    if (!id) {

      message("analysis-message", "Önce analiz edilecek bir coin seçin.");

      return;

    }

    if (!CONFIG.timeframes.includes(timeframe)) {

      message("analysis-message", "Geçersiz zaman dilimi seçildi.", "error-message");

      return;

    }

    const token = ++state.analysisToken;

    state.selectedCoin = id;

    const coin = coinById(id);

    if (!coin) {

      message("analysis-message", "Seçilen coin bulunamadı. Piyasa listesini yenileyin.", "error-message");

      return;

    }

    message("analysis-message", coin.name + " için OKX teknik analizi alınıyor.");

    announce(coin.name + " teknik analizi hazırlanıyor.");

    try {

      const payload = await request("/api/analysis", {

        market: apiMarket(market),

        symbol: coin.instrument,

        interval: timeframe, 
        limit: 250

      });

      if (token !== state.analysisToken) return;

      renderDetails(coin, payload, market, timeframe);

      const analysis = payload.analysis || {};

      message(

        "analysis-message",

        coin.name + " analizi tamamlandı. Sinyal: " + (analysis.signal || "SİNYAL YOK"),

        "success-message"

      );

      announce(

        coin.name + " analizi tamamlandı. Sinyal: " + (analysis.signal || "SİNYAL YOK")

      );

      if (timeframe === "1d") {

        const signal = {

          id: coin.id,

          name: coin.name,

          symbol: coin.symbol,

          signal: analysis.signal || "SİNYAL YOK",

          score: analysis.score || 0,

          risk: analysis.riskModel || null

        };

        const index = state.signals.findIndex(item => item.id === coin.id);

        if (index >= 0) state.signals[index] = signal;

        else state.signals.push(signal);

        renderSignals();

      }

    } catch (error) {

      if (token !== state.analysisToken) return;

      message("analysis-message", error.message || "Analiz yapılamadı.", "error-message");

      if (el["technical-analysis-results"]) {

        el["technical-analysis-results"].textContent = error.message || "Analiz yapılamadı.";

      }

      announce("Analiz yapılamadı. " + error.message);

    }

  }

  async function openCoinAnalysis(id) {

    const coin = coinById(id);

    if (!coin) {

      message("analysis-message", "Seçilen coin bulunamadı.", "error-message");

      return;

    }

    state.selectedCoin = id;

    if (el["analysis-coin"]) el["analysis-coin"].value = id;

    if (el["analysis-market"]) el["analysis-market"].value = state.market;

    if (el["market-type"]) el["market-type"].value = state.market;

    $("analysis")?.scrollIntoView({ behavior: "smooth" });

    await runAnalysis();

  }

  async function buildInitialSignals() {

    state.signals = [];

    renderSignals();

    const candidates = CONFIG.pinned

      .map(symbol => state.coins.find(coin => coin.symbol === symbol))

      .filter(Boolean)

      .slice(0, 8);

    if (!candidates.length) {

      message("signal-message", "Bu piyasada öncelikli sinyal adayı bulunamadı.");

      return;

    }

    message("signal-message", "Öncelikli 8 coin için günlük sinyaller hazırlanıyor.");

    for (const coin of candidates) {

      try {

        const result = await request("/api/analysis", {

          market: apiMarket(),

          symbol: coin.instrument,

          interval: "1d",

          limit: 250

        });

        const analysis = result.analysis || {};

        state.signals.push({

          id: coin.id,

          name: coin.name,

          symbol: coin.symbol,

          signal: analysis.signal || "SİNYAL YOK",

          score: analysis.score || 0,

          risk: analysis.riskModel || null

        });

        renderSignals();

      } catch (_) {

        state.signals.push({

          id: coin.id,

          name: coin.name,

          symbol: coin.symbol,

          signal: "SİNYAL YOK",

          score: 0,

          risk: null

        });

        renderSignals();

      }

    }

    message(

      "signal-message",

      state.signals.length +

      " coin için günlük sinyal kontrol edildi. Puan başarı olasılığı değildir."

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

    if (el["refresh-button"]) {

      el["refresh-button"].disabled = true;

    }

    announce("OKX piyasa verileri yükleniyor.");

    message("market-message", "OKX piyasa verileri alınıyor.");

    try {

      const data = await request("/api/markets", {

        market: apiMarket(requestedMarket),

        limit: CONFIG.marketLimit

      });

      if (

        requestId !== state.marketRequest ||

        requestedMarket !== state.market

      ) {

        return;

      }

      if (!Array.isArray(data.items)) {

        throw new Error("OKX piyasa listesi beklenen biçimde gelmedi.");

      }

      state.coins = data.items

        .map(normalizeMarketItem)

        .filter(coin =>

          Number.isFinite(coin.current_price) &&

          coin.current_price > 0

        );

      state.filtered = [...state.coins];

      state.lastUpdated = new Date();

      renderBitcoin();

      renderMarketTable();

      fillAnalysisOptions();

      migrateWatchlistIds();

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

        " verileri OKX üzerinden güncellendi.",

        "success-message"

      );

      announce(

        "OKX piyasa verileri güncellendi. " +

        state.coins.length + " coin listelendi."

      );

      await buildInitialSignals();

    } catch (error) {

      if (requestId === state.marketRequest) {

        message(

          "market-message",

          error.message || "Piyasa verileri alınamadı.",

          "error-message"

        );

        announce("Piyasa verileri alınamadı. " + error.message);

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

    el["refresh-button"]?.addEventListener("click", () => loadMarkets());

    el["currency-select"]?.addEventListener("change", () => setCurrencyNote());

    el["market-type"]?.addEventListener("change", event => {

      const value = event.target.value;

      if (!["spot", "usdt-m", "coin-m"].includes(value)) return;

      state.market = value;

      if (el["analysis-market"]) {

        el["analysis-market"].value = value;

      }

      state.analysisToken++;

      setCurrencyNote();

      loadMarkets();

    });

    el["coin-search"]?.addEventListener("input", searchCoins);

    el["market-sort"]?.addEventListener("change", renderMarketTable);

    el["signal-filter"]?.addEventListener("change", renderSignals);

    el["analysis-coin"]?.addEventListener("change", () => {

      if (el["analysis-coin"].value) runAnalysis();

    });

    el["analysis-timeframe"]?.addEventListener("change", runAnalysis);

    el["analysis-market"]?.addEventListener("change", event => {

      const value = event.target.value;

      if (!["spot", "usdt-m", "coin-m"].includes(value)) return;

      state.market = value;

      if (el["market-type"]) {

        el["market-type"].value = value;

      }
       state.analysisToken++;

      setCurrencyNote();

      loadMarkets();

    });

    el["watchlist-form"]?.addEventListener("submit", event => {

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

  async function initialize() {

    cacheElements();

    loadWatchlist();

    bindEvents();

    renderWatchlist();

    const footerSource = document.querySelector(".site-footer p:last-child");

    if (footerSource) {

      footerSource.textContent =

        "Piyasa ve teknik analiz verileri OKX herkese açık API uç noktalarından alınır.";

    }

    if (el["market-type"]) {

      state.market = el["market-type"].value || "spot";

    }

    setCurrencyNote();

    try {

      const health = await request("/api/health");

      announce(

        "Worker bağlantısı başarılı. Sürüm " +

        (health.version || "bilinmiyor") +

        ". OKX veri kaynağı hazır."

      );

    } catch (error) {

      announce("Worker bağlantı kontrolü başarısız. " + error.message);

    }

    await loadMarkets();

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
