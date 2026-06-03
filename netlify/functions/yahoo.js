const https = require("https");

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location, headers).then(resolve).catch(reject);
      }
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
};

// Step 1: get cookie from Yahoo Finance homepage
async function getCookie() {
  const r = await get("https://finance.yahoo.com/", BASE_HEADERS);
  const setCookie = r.headers["set-cookie"] || [];
  const cookie = setCookie.map(c => c.split(";")[0]).join("; ");
  return cookie || "";
}

// Step 2: get crumb using the cookie
async function getCrumb(cookie) {
  const r = await get("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    ...BASE_HEADERS,
    "Accept": "text/plain, */*",
    "Cookie": cookie,
  });
  if (r.status === 200 && r.body && !r.body.includes("Unauthorized")) {
    return r.body.trim();
  }
  // fallback crumb endpoint
  const r2 = await get("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    ...BASE_HEADERS,
    "Accept": "text/plain, */*",
    "Cookie": cookie,
  });
  return r2.body.trim();
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
    // ── Obter cookie + crumb ──────────────────────────────────────
    const cookie = await getCookie();
    const crumb  = await getCrumb(cookie);

    const authHeaders = {
      ...BASE_HEADERS,
      "Accept": "application/json",
      "Cookie": cookie,
    };

    // ── Buscar dados fundamentais com crumb ───────────────────────
    const modules = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile";
    const summaryUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(modules)}&crumb=${encodeURIComponent(crumb)}&formatted=false&corsDomain=finance.yahoo.com`;

    const summaryRes = await get(summaryUrl, authHeaders);
    let summary = null;
    if (summaryRes.status === 200) {
      try {
        const parsed = JSON.parse(summaryRes.body);
        summary = parsed?.quoteSummary?.result?.[0] || null;
      } catch {}
    }

    // ── Buscar quote (preço em tempo real) ────────────────────────
    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}&crumb=${encodeURIComponent(crumb)}&formatted=false`;
    const quoteRes = await get(quoteUrl, authHeaders);
    let q = {};
    if (quoteRes.status === 200) {
      try {
        const parsed = JSON.parse(quoteRes.body);
        q = parsed?.quoteResponse?.result?.[0] || {};
      } catch {}
    }

    // ── Fallback: v8 chart para preço se quote falhou ─────────────
    let meta = {};
    if (!q.regularMarketPrice) {
      const chartRes = await get(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
        authHeaders
      );
      if (chartRes.status === 200) {
        try { meta = JSON.parse(chartRes.body)?.chart?.result?.[0]?.meta || {}; } catch {}
      }
    }

    const p  = summary?.price             || {};
    const sd = summary?.summaryDetail     || {};
    const ks = summary?.defaultKeyStatistics || {};
    const fd = summary?.financialData     || {};
    const ap = summary?.assetProfile      || {};

    const unified = {
      longName:    q.longName    || p.longName    || q.shortName || meta.longName || ticker,
      shortName:   q.shortName   || p.shortName   || ticker,
      sector:      q.sector      || ap.sector     || "",
      industry:    q.industry    || ap.industry   || "",
      longBusinessSummary: ap.longBusinessSummary || "",

      regularMarketPrice:         q.regularMarketPrice         ?? p.regularMarketPrice         ?? meta.regularMarketPrice,
      regularMarketPreviousClose: q.regularMarketPreviousClose ?? p.regularMarketPreviousClose ?? meta.chartPreviousClose,
      regularMarketVolume:        q.regularMarketVolume        ?? p.regularMarketVolume        ?? meta.regularMarketVolume,
      averageVolume:              q.averageVolume              ?? p.averageDailyVolume3Month   ?? meta.regularMarketVolume,
      marketCap:                  q.marketCap                  ?? p.marketCap                 ?? meta.marketCap,
      fiftyTwoWeekHigh:           q.fiftyTwoWeekHigh           ?? sd.fiftyTwoWeekHigh         ?? meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow:            q.fiftyTwoWeekLow            ?? sd.fiftyTwoWeekLow          ?? meta.fiftyTwoWeekLow,

      trailingPE:      q.trailingPE     ?? sd.trailingPE,
      forwardPE:       q.forwardPE      ?? sd.forwardPE,
      pegRatio:        ks.pegRatio,
      priceToBook:     q.priceToBook    ?? ks.priceToBook,
      priceToSales:    sd.priceToSalesTrailing12Months,
      evToEbitda:      ks.enterpriseToEbitda,
      enterpriseValue: ks.enterpriseValue,

      returnOnEquity:   fd.returnOnEquity,
      returnOnAssets:   fd.returnOnAssets,
      grossMargins:     fd.grossMargins,
      operatingMargins: fd.operatingMargins,
      profitMargins:    fd.profitMargins  ?? ks.profitMargins,
      totalRevenue:     fd.totalRevenue,

      revenueGrowth:   fd.revenueGrowth,
      earningsGrowth:  fd.earningsGrowth,
      trailingEps:     q.epsTrailingTwelveMonths ?? ks.trailingEps,
      forwardEps:      q.epsForward             ?? ks.forwardEps,

      dividendYield:   q.dividendYield ?? q.trailingAnnualDividendYield ?? sd.dividendYield ?? sd.trailingAnnualDividendYield,
      dividendRate:    q.dividendRate  ?? sd.dividendRate,
      payoutRatio:     sd.payoutRatio,
      exDividendDate:  sd.exDividendDate?.fmt,

      currentRatio:    fd.currentRatio,
      quickRatio:      fd.quickRatio,
      debtToEquity:    fd.debtToEquity,
      totalDebt:       fd.totalDebt,
      totalCash:       fd.totalCash,

      targetMeanPrice:  fd.targetMeanPrice,
      targetLowPrice:   fd.targetLowPrice,
      targetHighPrice:  fd.targetHighPrice,
      recommendationKey: fd.recommendationKey,
      numberOfAnalystOpinions: fd.numberOfAnalystOpinions,

      beta:              q.beta ?? sd.beta ?? meta.beta,
      shortPercentFloat: ks.shortPercentOfFloat,
      shortRatio:        ks.shortRatio,
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
