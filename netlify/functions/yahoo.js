const https = require("https");

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location, headers).then(resolve).catch(reject);
      }
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
  "Referer": "https://finance.yahoo.com/",
};

async function tryFetch(url) {
  const { status, body } = await get(url, HEADERS);
  if (status !== 200) return null;
  try { return JSON.parse(body); } catch { return null; }
}

exports.handler = async function (event) {
  const ticker = (event.queryStringParameters?.ticker || "").toUpperCase().trim();
  if (!ticker) {
    return { statusCode: 400, body: JSON.stringify({ error: "ticker obrigatório" }) };
  }

  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
  };

  try {
    // ── 1. quote endpoint (preço, P/E, market cap, etc.) ──────────
    const quoteData = await tryFetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}&fields=regularMarketPrice,regularMarketPreviousClose,regularMarketVolume,averageVolume,marketCap,trailingPE,forwardPE,priceToBook,fiftyTwoWeekHigh,fiftyTwoWeekLow,dividendYield,trailingAnnualDividendYield,dividendRate,beta,shortName,longName,sector,industry`
    );
    const q = quoteData?.quoteResponse?.result?.[0] || {};

    // ── 2. quoteSummary com módulos separados ─────────────────────
    const hosts = ["query1", "query2"];
    const moduleGroups = [
      "financialData,defaultKeyStatistics",
      "summaryDetail,assetProfile",
    ];

    const modules = {};
    for (const host of hosts) {
      for (const group of moduleGroups) {
        const url = `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${encodeURIComponent(group)}&corsDomain=finance.yahoo.com`;
        const data = await tryFetch(url);
        const result = data?.quoteSummary?.result?.[0];
        if (result) Object.assign(modules, result);
      }
      if (Object.keys(modules).length >= 3) break;
    }

    // ── 3. v8 chart para dados de preço confiáveis ────────────────
    const chartData = await tryFetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`
    );
    const meta = chartData?.chart?.result?.[0]?.meta || {};

    // ── Monta resposta unificada ───────────────────────────────────
    const price = modules.price || {};
    const summary = modules.summaryDetail || {};
    const keyStats = modules.defaultKeyStatistics || {};
    const finData = modules.financialData || {};
    const profile = modules.assetProfile || {};

    const unified = {
      // Preço — prioriza quote endpoint que é mais confiável
      regularMarketPrice:         q.regularMarketPrice         ?? meta.regularMarketPrice,
      regularMarketPreviousClose: q.regularMarketPreviousClose ?? meta.chartPreviousClose,
      regularMarketVolume:        q.regularMarketVolume        ?? meta.regularMarketVolume,
      averageVolume:              q.averageVolume              ?? meta.regularMarketVolume,
      marketCap:                  q.marketCap                  ?? meta.marketCap,
      longName:                   q.longName || q.shortName    || meta.longName || ticker,
      shortName:                  q.shortName                  || ticker,
      fiftyTwoWeekHigh:           q.fiftyTwoWeekHigh           ?? meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow:            q.fiftyTwoWeekLow            ?? meta.fiftyTwoWeekLow,

      // Valuation
      trailingPE:     q.trailingPE     ?? summary.trailingPE?.raw,
      forwardPE:      q.forwardPE      ?? summary.forwardPE?.raw,
      priceToBook:    q.priceToBook    ?? keyStats.priceToBook?.raw,
      pegRatio:       keyStats.pegRatio?.raw,
      priceToSales:   summary.priceToSalesTrailing12Months?.raw ?? keyStats.priceToSalesTrailing12Months?.raw,
      evToEbitda:     keyStats.enterpriseToEbitda?.raw,
      enterpriseValue: keyStats.enterpriseValue?.raw,

      // Profitability
      returnOnEquity:     finData.returnOnEquity?.raw,
      returnOnAssets:     finData.returnOnAssets?.raw,
      grossMargins:       finData.grossMargins?.raw,
      operatingMargins:   finData.operatingMargins?.raw,
      profitMargins:      finData.profitMargins?.raw ?? keyStats.profitMargins?.raw,
      totalRevenue:       finData.totalRevenue?.raw,

      // Growth
      revenueGrowth:  finData.revenueGrowth?.raw,
      earningsGrowth: finData.earningsGrowth?.raw,
      trailingEps:    keyStats.trailingEps?.raw,
      forwardEps:     keyStats.forwardEps?.raw,

      // Dividends
      dividendYield:   q.dividendYield ?? q.trailingAnnualDividendYield ?? summary.dividendYield?.raw ?? summary.trailingAnnualDividendYield?.raw,
      dividendRate:    q.dividendRate  ?? summary.dividendRate?.raw,
      payoutRatio:     summary.payoutRatio?.raw,
      exDividendDate:  summary.exDividendDate?.fmt,

      // Health
      currentRatio:   finData.currentRatio?.raw,
      quickRatio:     finData.quickRatio?.raw,
      debtToEquity:   finData.debtToEquity?.raw,
      totalDebt:      finData.totalDebt?.raw,
      totalCash:      finData.totalCash?.raw,

      // Analyst
      targetMeanPrice:  finData.targetMeanPrice?.raw,
      targetLowPrice:   finData.targetLowPrice?.raw,
      targetHighPrice:  finData.targetHighPrice?.raw,
      recommendationKey: finData.recommendationKey,
      numberOfAnalystOpinions: finData.numberOfAnalystOpinions?.raw,

      // Risk
      beta:              q.beta ?? summary.beta?.raw ?? meta.beta,
      shortPercentFloat: keyStats.shortPercentOfFloat?.raw,
      shortRatio:        keyStats.shortRatio?.raw,

      // Profile
      sector:   q.sector   || profile.sector   || "",
      industry: q.industry || profile.industry || "",
      longBusinessSummary: profile.longBusinessSummary || "",
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ unified }),
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
