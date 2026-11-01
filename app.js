

"use strict";

/*

 * KRİPTO ANALİZ PLATFORMU

 * Dosya: app.js

 * Sürüm: 1.0

 *

 * Özellikler:

 * - CoinGecko API üzerinden piyasa verileri

 * - İlk 100 coin ve temel coinlerin takibi

 * - USD, USDT ve TRY gösterimi

 * - Coin arama ve filtreleme

 * - İzleme listesi

 * - RSI, EMA, MACD ve Bollinger Bands hesaplamaları

 * - Teknik analiz sonuçlarının erişilebilir gösterimi

 * - VoiceOver için durum duyuruları

 *

 * Önemli:

 * - USDT gösterimi USD fiyatına yaklaşık eşdeğer kabul edilir.

 * - API ücretsiz kullanım sınırlarına tabidir.

 * - Teknik göstergeler yatırım garantisi veya kesin tahmin değildir.

 * - Bu sürüm otomatik alım satım yapmaz.

 */

(() => {

  "use strict";

  const CONFIG = {

    apiBase: "https://api.coingecko.com/api/v3",

    refreshInterval: 60000,

    defaultCurrency: "usd",

    marketPageSize: 100,

    watchlistStorageKey: "kriptoAnalizIzlemeListesi",

    pinnedCoins: [

      "bitcoin",

      "ethereum",

      "solana",

      "cardano",

      "ripple",

      "pepe",

      "dogecoin",

      "avalanche-2"

    ]

  };

  const state = {

    currency: CONFIG.defaultCurrency,

    coins: [],

    filteredCoins: [],

    watchlist: [],

    loading: false,

    analysisLoading: false,

    lastUpdated: null,

    refreshTimer: null,

    selectedCoin: null

  };

  const elements = {};

  function getElement(id) {

    return document.getElementById(id);

  }

  function cacheElements() {

    const ids = [

      "connection-status",

      "currency-select",

      "refresh-button",

      "last-updated",

      "btc-price",

      "btc-change",

      "eth-price",

      "eth-change",

      "sol-price",

      "sol-change",

      "coin-search",

      "market-table-body",

      "market-message",

      "signal-table-body",

      "analysis-coin",

      "technical-analysis-results",

      "watchlist-form",

      "watchlist-coin",

      "watchlist-items"

    ];

    ids.forEach((id) => {

      elements[id] = getElement(id);

    });

  }

  function announce(message) {

    if (elements["connection-status"]) {

      elements["connection-status"].textContent = message;

    }

  }

  function setMessage(message) {

    if (elements["market-message"]) {

      elements["market-message"].textContent = message;

    }

  }

  function formatNumber(value, digits = 2) {

    const number = Number(value);

    if (!Number.isFinite(number)) {

      return "Veri yok";

    }

    return new Intl.NumberFormat("tr-TR", {

      maximumFractionDigits: digits

    }).format(number);

  }

  function formatPrice(value) {

    const number = Number(value);

    if (!Number.isFinite(number)) {

      return "Veri yok";

    }

    if (state.currency === "usdt") {

      return `${formatNumber(number, number < 1 ? 8 : 2)} USDT`;

    }

    return new Intl.NumberFormat("tr-TR", {

      style: "currency",

      currency: state.currency.toUpperCase(),

      maximumFractionDigits: number < 1 ? 8 : 2

    }).format(number);

  }

  function formatPercentage(value) {

    const number = Number(value);

    if (!Number.isFinite(number)) {

      return "Veri yok";

    }

    const sign = number > 0 ? "+" : "";

    return `${sign}${formatNumber(number, 2)}%`;

  }

  function formatMarketCap(value) {

    const number = Number(value);

    if (!Number.isFinite(number)) {

      return "Veri yok";

    }

    return formatNumber(number, 0);

  }

  function changeClass(value) {

    const number = Number(value);

    if (!Number.isFinite(number)) {

      return "neutral";

    }

    if (number > 0) {

      return "positive";

    }

    if (number < 0) {

      return "negative";

    }

    return "neutral";

  }

  function createCell(text, className = "") {

    const cell = document.createElement("td");

    cell.textContent = text;

    if (className) {

      cell.className = className;

    }

    return cell;

  }

  function createMessageRow(tableBody, message, columnCount) {

    if (!tableBody) return;

    const row = document.createElement("tr");

    const cell = document.createElement("td");

    cell.colSpan = columnCount;

    cell.textContent = message;

    row.appendChild(cell);

    tableBody.replaceChildren(row);

  }

  function saveWatchlist() {

    try {

      localStorage.setItem(

        CONFIG.watchlistStorageKey,

        JSON.stringify(state.watchlist)

      );

    } catch (error) {

      announce("İzleme listesi cihazınıza kaydedilemedi.");

    }

  }

  function loadWatchlist() {

    try {

      const saved = localStorage.getItem(

        CONFIG.watchlistStorageKey

      );

      const parsed = saved ? JSON.parse(saved) : [];

      state.watchlist = Array.isArray(parsed)

        ? parsed.filter((item) => typeof item === "string")

        : [];

    } catch (error) {

      state.watchlist = [];

    }

  }

  async function apiRequest(endpoint) {

    const response = await fetch(

      `${CONFIG.apiBase}${endpoint}`,

      {

        method: "GET",

        headers: {

          Accept: "application/json"

        }

      }

    );

    if (!response.ok) {

      if (response.status === 429) {

        throw new Error(

          "Ücretsiz API istek sınırına ulaşıldı. Biraz sonra tekrar deneyin."

        );

      }

      if (response.status === 404) {

        throw new Error("İstenen piyasa verisi bulunamadı.");

      }

      throw new Error(

        `Veri sunucusu HTTP ${response.status} hatası döndürdü.`

      );

    }

    return response.json();

  }

  async function fetchMarketData() {

    if (state.loading) return;

    state.loading = true;

    if (elements["refresh-button"]) {

      elements["refresh-button"].disabled = true;

    }

    announce("Piyasa verileri yükleniyor.");

    setMessage("Piyasa verileri alınıyor.");

    try {

      const currency = state.currency === "usdt"

        ? "usd"

        : state.currency;

      const params = new URLSearchParams({

        vs_currency: currency,

        order: "market_cap_desc",

        per_page: String(CONFIG.marketPageSize),

        page: "1",

        sparkline: "false",

        price_change_percentage: "24h"

      });

      const data = await apiRequest(

        `/coins/markets?${params.toString()}`

      );

      if (!Array.isArray(data)) {

        throw new Error("Sunucudan geçersiz veri alındı.");

      }

      const existingIds = new Set(

        data.map((coin) => coin.id)

      );

      const missingPinned = CONFIG.pinnedCoins.filter(

        (id) => !existingIds.has(id)

      );

      if (missingPinned.length > 0) {

        try {

          const pinnedParams = new URLSearchParams({

            vs_currency: currency,

            ids: missingPinned.join(","),

            order: "market_cap_desc",

            per_page: String(missingPinned.length),

            page: "1",

            sparkline: "false",

            price_change_percentage: "24h"

          });

          const pinnedData = await apiRequest(

            `/coins/markets?${pinnedParams.toString()}`

          );

          if (Array.isArray(pinnedData)) {

            data.push(...pinnedData);

          }

        } catch (pinnedError) {

          /*

           * İlk piyasa isteği başarılıysa ikinci istek başarısız

           * olduğunda mevcut piyasa verileri kullanılmaya devam eder.

           */

        }

      }

      state.coins = data;

      state.filteredCoins = [...data];

      state.lastUpdated = new Date();

      renderMarketTable();

      renderSummaryCards();

      renderAnalysisCoinOptions();

      renderWatchlist();

      setMessage(

        `${data.length} coin için piyasa verileri güncellendi.`

      );

      if (elements["last-updated"]) {

        elements["last-updated"].textContent =

          `Son güncelleme: ${state.lastUpdated.toLocaleTimeString("tr-TR")}`;

      }

      announce(

        `${data.length} coin için piyasa verileri güncellendi.`

      );

    } catch (error) {

      const message =

        error.message || "Bilinmeyen bir hata oluştu.";

      setMessage(`Hata: ${message}`);

      announce(`Piyasa verileri alınamadı. ${message}`);

      if (state.coins.length === 0) {

        createMessageRow(

          elements["market-table-body"],

          "Piyasa verileri alınamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.",

          4

        );

      }

    } finally {

      state.loading = false;

      if (elements["refresh-button"]) {

        elements["refresh-button"].disabled = false;

      }

    }

  }

  function renderSummaryCards() {

    const summaries = [

      {

        id: "bitcoin",

        priceElement: elements["btc-price"],

        changeElement: elements["btc-change"]

      },

      {

        id: "ethereum",

        priceElement: elements["eth-price"],

        changeElement: elements["eth-change"]

      },

      {

        id: "solana",

        priceElement: elements["sol-price"],

        changeElement: elements["sol-change"]

      }

    ];

    summaries.forEach((item) => {

      const coin = state.coins.find(

        (entry) => entry.id === item.id

      );

      if (!coin) return;

      if (item.priceElement) {

        item.priceElement.textContent =

          formatPrice(coin.current_price);

      }

      if (item.changeElement) {

        item.changeElement.textContent =

          formatPercentage(coin.price_change_percentage_24h);

        item.changeElement.className =

          changeClass(coin.price_change_percentage_24h);

      }

    });

  }

  function renderMarketTable() {

    const tableBody = elements["market-table-body"];

    if (!tableBody) return;

    if (state.filteredCoins.length === 0) {

      createMessageRow(

        tableBody,

        "Aramanızla eşleşen coin bulunamadı.",

        4

      );

      return;

    }

    const fragment = document.createDocumentFragment();

    state.filteredCoins.forEach((coin) => {

      const row = document.createElement("tr");

      const name = `${coin.name} (${String(

        coin.symbol || ""

      ).toUpperCase()})`;

      row.appendChild(createCell(name));

      row.appendChild(createCell(formatPrice(coin.current_price)));

      row.appendChild(

        createCell(

          formatPercentage(coin.price_change_percentage_24h),

          changeClass(coin.price_change_percentage_24h)

        )

      );

      row.appendChild(

        createCell(formatMarketCap(coin.market_cap))

      );

      fragment.appendChild(row);

    });

    tableBody.replaceChildren(fragment);

  }

  function searchCoins() {

    const query = elements["coin-search"]

      ? elements["coin-search"].value.trim().toLocaleLowerCase("tr-TR")

      : "";

    if (!query) {

      state.filteredCoins = [...state.coins];

    } else {

      state.filteredCoins = state.coins.filter((coin) => {
         const name = String(coin.name || "")

          .toLocaleLowerCase("tr-TR");

        const symbol = String(coin.symbol || "")

          .toLocaleLowerCase("tr-TR");

        const id = String(coin.id || "")

          .toLocaleLowerCase("tr-TR");

        return (

          name.includes(query) ||

          symbol.includes(query) ||

          id.includes(query)

        );

      });

    }

    renderMarketTable();

    announce(

      `Arama tamamlandı. ${state.filteredCoins.length} coin bulundu.`

    );

  }

  function renderAnalysisCoinOptions() {

    const select = elements["analysis-coin"];

    if (!select) return;

    const previousValue = select.value;

    const fragment = document.createDocumentFragment();

    const defaultOption = document.createElement("option");

    defaultOption.value = "";

    defaultOption.textContent = "Coin seçin";

    fragment.appendChild(defaultOption);

    state.coins.forEach((coin) => {

      const option = document.createElement("option");

      option.value = coin.id;

      option.textContent =

        `${coin.name} (${String(coin.symbol).toUpperCase()})`;

      fragment.appendChild(option);

    });

    select.replaceChildren(fragment);

    if (

      previousValue &&

      state.coins.some((coin) => coin.id === previousValue)

    ) {

      select.value = previousValue;

    }

  }

  function renderWatchlist() {

    const container = elements["watchlist-items"];

    if (!container) return;

    container.replaceChildren();

    if (state.watchlist.length === 0) {

      const message = document.createElement("p");

      message.textContent = "İzleme listeniz henüz boş.";

      message.className = "empty-message";

      container.appendChild(message);

      return;

    }

    state.watchlist.forEach((coinId) => {

      const coin = state.coins.find(

        (item) => item.id === coinId

      );

      const item = document.createElement("div");

      item.className = "project-item";

      const label = document.createElement("span");

      label.textContent = coin

        ? `${coin.name} (${String(coin.symbol).toUpperCase()})`

        : coinId;

      const removeButton = document.createElement("button");

      removeButton.type = "button";

      removeButton.textContent = "Listeden çıkar";

      removeButton.setAttribute(

        "aria-label",

        `${label.textContent} izleme listesinden çıkar`

      );

      removeButton.addEventListener("click", () => {

        removeFromWatchlist(coinId);

      });

      item.append(label, removeButton);

      container.appendChild(item);

    });

  }

  function addToWatchlist() {

    const input = elements["watchlist-coin"];

    if (!input) return;

    const query = input.value.trim().toLocaleLowerCase("tr-TR");

    if (!query) {

      announce("Lütfen izleme listesine eklemek için bir coin girin.");

      return;

    }

    const coin = state.coins.find((item) => {

      return (

        item.id.toLocaleLowerCase("tr-TR") === query ||

        item.symbol.toLocaleLowerCase("tr-TR") === query ||

        item.name.toLocaleLowerCase("tr-TR") === query

      );

    });

    if (!coin) {

      announce(

        "Coin bulunamadı. Coin adını, sembolünü veya kimliğini kontrol edin."

      );

      return;

    }

    if (state.watchlist.includes(coin.id)) {

      announce("Bu coin zaten izleme listenizde.");

      return;

    }

    state.watchlist.push(coin.id);

    saveWatchlist();

    renderWatchlist();

    input.value = "";

    announce(`${coin.name} izleme listenize eklendi.`);

  }

  function removeFromWatchlist(coinId) {

    state.watchlist = state.watchlist.filter(

      (id) => id !== coinId

    );

    saveWatchlist();

    renderWatchlist();

    announce("Coin izleme listenizden çıkarıldı.");

  }

  function calculateEMA(values, period) {

    if (!Array.isArray(values) || values.length < period) {

      return [];

    }

    const multiplier = 2 / (period + 1);

    const result = [];

    let previous = values

      .slice(0, period)

      .reduce((sum, value) => sum + value, 0) / period;

    result.push(previous);

    for (let i = period; i < values.length; i += 1) {

      previous =

        (values[i] - previous) * multiplier + previous;

      result.push(previous);

    }

    return result;

  }

  function calculateRSI(values, period = 14) {

    if (!Array.isArray(values) || values.length <= period) {

      return null;

    }

    let gains = 0;

    let losses = 0;

    for (let i = 1; i <= period; i += 1) {

      const difference = values[i] - values[i - 1];

      if (difference > 0) {

        gains += difference;

      } else {

        losses += Math.abs(difference);

      }

    }

    let averageGain = gains / period;

    let averageLoss = losses / period;

    for (let i = period + 1; i < values.length; i += 1) {

      const difference = values[i] - values[i - 1];

      const gain = Math.max(difference, 0);

      const loss = Math.max(-difference, 0);

      averageGain =

        ((averageGain * (period - 1)) + gain) / period;

      averageLoss =

        ((averageLoss * (period - 1)) + loss) / period;

    }

    if (averageLoss === 0) {

      return 100;

    }

    const relativeStrength = averageGain / averageLoss;

    return 100 - (100 / (1 + relativeStrength));

  }

  function calculateMACD(values) {

    const shortEMA = calculateEMA(values, 12);

    const longEMA = calculateEMA(values, 26);

    if (shortEMA.length === 0 || longEMA.length === 0) {

      return null;

    }

    const difference = shortEMA.length - longEMA.length;

    const macdValues = [];

    for (let i = 0; i < longEMA.length; i += 1) {

      macdValues.push(

        shortEMA[i + difference] - longEMA[i]

      );

    }

    const signalValues = calculateEMA(macdValues, 9);

    if (signalValues.length === 0) {

      return null;

    }

    return {

      macd: macdValues[macdValues.length - 1],

      signal: signalValues[signalValues.length - 1],

      histogram:

        macdValues[macdValues.length - 1] -

        signalValues[signalValues.length - 1]

    };

  }

  function calculateBollingerBands(values, period = 20) {

    if (!Array.isArray(values) || values.length < period) {

      return null;

    }

    const sample = values.slice(-period);

    const average =

      sample.reduce((sum, value) => sum + value, 0) / period;

    const variance =

      sample.reduce(

        (sum, value) => sum + Math.pow(value - average, 2),

        0

      ) / period;

    const standardDeviation = Math.sqrt(variance);

    return {

      middle: average,

      upper: average + (2 * standardDeviation),

      lower: average - (2 * standardDeviation)

    };

  }

  function describeRSI(value) {

    if (value === null) {

      return "Yetersiz veri";

    }

    if (value >= 70) {

      return "Aşırı alım bölgesi";

    }

    if (value <= 30) {

      return "Aşırı satım bölgesi";

    }

    return "Nötr bölge";

  }

  function renderAnalysisResult(coin, indicators) {

    const container = elements["technical-analysis-results"];

    if (!container) return;

    container.replaceChildren();

    const heading = document.createElement("h3");

    heading.textContent = `${coin.name} teknik analiz sonuçları`;

    container.appendChild(heading);

    const entries = [

      [

        "RSI (14)",

        indicators.rsi === null

          ? "Yetersiz veri"

          : `${formatNumber(indicators.rsi, 2)} - ${describeRSI(indicators.rsi)}`

      ],

      [

        "EMA (20)",

        indicators.ema20 === null

          ? "Yetersiz veri"

          : formatPrice(indicators.ema20)

      ],

      [

        "EMA (50)",

        indicators.ema50 === null

          ? "Yetersiz veri"

          : formatPrice(indicators.ema50)

      ],

      [

        "MACD",

        indicators.macd === null

          ? "Yetersiz veri"

          : formatNumber(indicators.macd.macd, 8)

      ],

      [

        "MACD sinyal çizgisi",

        indicators.macd === null

          ? "Yetersiz veri"

          : formatNumber(indicators.macd.signal, 8)

      ],

      [

        "MACD histogramı",

        indicators.macd === null

          ? "Yetersiz veri"

          : formatNumber(indicators.macd.histogram, 8)

      ],

      [

        "Bollinger üst bandı",

        indicators.bollinger === null

          ? "Yetersiz veri"

          : formatPrice(indicators.bollinger.upper)

      ],

      [

        "Bollinger orta bandı",

        indicators.bollinger === null

          ? "Yetersiz veri"

          : formatPrice(indicators.bollinger.middle)

      ],

      [

        "Bollinger alt bandı",

        indicators.bollinger === null

          ? "Yetersiz veri"

          : formatPrice(indicators.bollinger.lower)

      ]

    ];

    const list = document.createElement("dl");

    entries.forEach(([label, value]) => {

      const term = document.createElement("dt");

      const description = document.createElement("dd");

      term.textContent = label;

      description.textContent = value;

      list.append(term, description);

    });

    container.appendChild(list);

    const disclaimer = document.createElement("p");

    disclaimer.className = "info-text";

    disclaimer.textContent =

      "Bu göstergeler geçmiş fiyat verilerine dayanır. Tek başına yatırım kararı vermek için kullanılmamalıdır.";

    container.appendChild(disclaimer);

  }

  async function runTechnicalAnalysis() {

    const select = elements["analysis-coin"];

    if (!select || !select.value) {

      announce("Teknik analiz için önce bir coin seçin.");

      return;

    }

    if (state.analysisLoading) return;

    const coinId = select.value;

    const coin = state.coins.find(

      (item) => item.id === coinId

    );

    if (!coin) {

      announce("Seçilen coin için piyasa verisi bulunamadı.");

      return;

    }

    state.analysisLoading = true;

    state.selectedCoin = coinId;

    const container = elements["technical-analysis-results"];

    if (container) {

      container.textContent = "Teknik analiz hesaplanıyor.";

    }

    announce(`${coin.name} için teknik analiz yapılıyor.`);

    try {

      const currency = state.currency === "usdt"

        ? "usd"

        : state.currency;

      const params = new URLSearchParams({

        vs_currency: currency,

        days: "90",

        interval: "daily"

      });

      const data = await apiRequest(

        `/coins/${encodeURIComponent(coinId)}/market_chart?${params.toString()}`

      );

      if (!data || !Array.isArray(data.prices)) {

        throw new Error("Geçmiş fiyat verileri alınamadı.");

      }

      const values = data.prices

        .map((entry) => Number(entry[1]))

        .filter((value) => Number.isFinite(value));

      if (values.length < 50) {

        throw new Error(

          "Teknik analiz için yeterli geçmiş fiyat verisi bulunamadı."

        );

      }

      const indicators = {

        rsi: calculateRSI(values, 14),

        ema20: calculateEMA(values, 20).slice(-1)[0] ?? null,

        ema50: calculateEMA(values, 50).slice(-1)[0] ?? null,

        macd: calculateMACD(values),

        bollinger: calculateBollingerBands(values, 20)

      };

      renderAnalysisResult(coin, indicators);

      announce(`${coin.name} teknik analizi tamamlandı.`);

    } catch (error) {

      const message =

        error.message || "Teknik analiz sırasında hata oluştu.";

      if (container) {

        container.textContent = message;

      }

      announce(`Teknik analiz yapılamadı. ${message}`);

    } finally {

      state.analysisLoading = false;

    }

  }

  function renderSignalPlaceholder() {

    const tableBody = elements["signal-table-body"];

    if (!tableBody) return;

    createMessageRow(

      tableBody,

      "Henüz doğrulanmış işlem sinyali bulunmuyor. Teknik analiz bölümünden coin seçerek göstergeleri inceleyebilirsiniz.",

      3

    );

  }

  function bindEvents() {

    if (elements["refresh-button"]) {

      elements["refresh-button"].addEventListener(

        "click",

        fetchMarketData

      );

    }

    if (elements["currency-select"]) {

      elements["currency-select"].addEventListener(

        "change",

        (event) => {

          const selected = event.target.value.toLowerCase();

          if (!["usd", "usdt", "try"].includes(selected)) {

            announce("Geçersiz para birimi seçildi.");

            return;

          }

          state.currency = selected;

          fetchMarketData();

        }

      );

    }

    if (elements["coin-search"]) {

      elements["coin-search"].addEventListener(

        "input",

        searchCoins

      );

    }

    if (elements["watchlist-form"]) {

      elements["watchlist-form"].addEventListener(

        "submit",

        (event) => {

          event.preventDefault();

          addToWatchlist();

        }

      );

    }

    if (elements["analysis-coin"]) {

      elements["analysis-coin"].addEventListener(

        "change",

        runTechnicalAnalysis

      );

    }

  }

  function startAutomaticRefresh() {

    if (state.refreshTimer) {

      window.clearInterval(state.refreshTimer);

    }

    state.refreshTimer = window.setInterval(() => {

      if (!document.hidden) {

        fetchMarketData();

      }

    }, CONFIG.refreshInterval);

  }

  function initialize() {

    cacheElements();

    loadWatchlist();

    bindEvents();

    renderWatchlist();

    renderSignalPlaceholder();

    if (elements["currency-select"]) {

      const initialCurrency =

        elements["currency-select"].value.toLowerCase();

      if (["usd", "usdt", "try"].includes(initialCurrency)) {

        state.currency = initialCurrency;

      }

    }

    fetchMarketData();

    startAutomaticRefresh();

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
