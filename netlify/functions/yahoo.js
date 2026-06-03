const https = require("https");

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

async function tryJSON(url) {
  try {
    const { status, body } = await get(url);
    if (status !== 200) return null;
    return JSON.parse(body);
  } catch { return null; }
}

exports.handler = async function (event) {
  const ticker  = (event.queryStringParameters?.ticker || "").toUpperCase().trim();
  const fmpKey  = process.env.FMP_API_KEY || event.queryStringParameters?.fmpkey || "";

  if (!ticker) {
    return { statusCode: 400, body: JSON.stringify({ error: "ticker obrigatório" }) };
  }

  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
  };

  try {
    // ── FMP endpoints ─────────────────────────────────────────────
    const base = "https://financialmodelingprep.com/api/v3";
    const key  = `apikey=${fmpKey}`;

    const [quote, profile, ratios, keyMetrics, growth] = await Promise.all([
      tryJSON(`${base}/quote/${ticker}?${key}`),
      tryJSON(`${base}/profile/${ticker}?${key}`),
      tryJSON(`${base}/ratios-ttm/${ticker}?${key}`),
      tryJSON(`${base}/key-metrics-ttm/${ticker}?${key}`),
      tryJSON(`${base}/financial-growth/${ticker}?limit=1&${key}`),
    ]);

    const q  = quote?.[0]    || {};
    const p  = profile?.[0]  || {};
    const r  = ratios?.[0]   || {};
    const km = keyMetrics?.[0] || {};
    const g  = growth?.[0]   || {};

    if (!q.price && !p.companyName) {
      return {
        statusCode: 404,
        headers: cors,
        body: JSON.stringify({ error: `Ticker "${ticker}" não encontrado. Verifique se é um ticker americano válido.` }),
      };
    }

    const unified = {
      // Identity
      longName:    p.companyName || q.name || ticker,
      shortName:   q.symbol      || ticker,
      sector:      p.sector      || "",
      industry:    p.industry    || "",
      longBusinessSummary: p.description || "",

      // Price
      regularMarketPrice:         q.price,
      regularMarketPreviousClose: q.previousClose,
      regularMarketVolume:        q.volume,
      averageVolume:              q.avgVolume,
      marketCap:                  q.marketCap,
      fiftyTwoWeekHigh:           q.yearHigh,
      fiftyTwoWeekLow:            q.yearLow,

      // Valuation
      trailingPE:      r.peRatioTTM      || q.pe,
      forwardPE:       km.peRatioTTM     || null,
      pegRatio:        r.pegRatioTTM,
      priceToBook:     r.priceToBookRatioTTM || km.pbRatioTTM,
      priceToSales:    r.priceToSalesRatioTTM,
      evToEbitda:      km.evToEbitdaTTM  || km.enterpriseValueOverEBITDATTM,
      enterpriseValue: km.enterpriseValueTTM,
      priceToFreeCashFlow: r.priceToFreeCashFlowsTTM,
      evToFreeCashFlow: km.evToFreeCashFlowTTM,

      // Profitability
      returnOnEquity:   r.returnOnEquityTTM,
      returnOnAssets:   r.returnOnAssetsTTM,
      returnOnCapital:  r.returnOnCapitalEmployedTTM,
      grossMargins:     r.grossProfitMarginTTM,
      operatingMargins: r.operatingProfitMarginTTM,
      profitMargins:    r.netProfitMarginTTM,
      totalRevenue:     km.revenuePerShareTTM ? null : null, // use from income
      assetTurnover:    r.assetTurnoverTTM,
      interestCoverage: r.interestCoverageTTM,

      // Growth
      revenueGrowth:   g.revenueGrowth,
      earningsGrowth:  g.netIncomeGrowth,
      epsGrowth:       g.epsgrowth,
      trailingEps:     q.eps,
      forwardEps:      null,

      // Dividends
      dividendYield:   r.dividendYieldTTM || q.dividendYield,
      dividendRate:    p.lastDiv,
      payoutRatio:     r.payoutRatioTTM,
      exDividendDate:  null,

      // Health
      currentRatio:    r.currentRatioTTM,
      quickRatio:      r.quickRatioTTM,
      debtToEquity:    r.debtEquityRatioTTM,
      totalDebt:       km.netDebtTTM,
      totalCash:       null,
      altmanZScore:    km.grahamNumberTTM ? null : null,

      // Analyst
      targetMeanPrice:  q.priceAvg50  || null,
      targetLowPrice:   q.yearLow     || null,
      targetHighPrice:  q.yearHigh    || null,
      recommendationKey: null,
      numberOfAnalystOpinions: null,

      // Risk
      beta:              p.beta || q.beta,
      shortPercentFloat: null,
      shortRatio:        null,

      // Extra
      dividendYieldPct: q.dividendYield,
      sharesOutstanding: p.volAvg,
      exchange: p.exchangeShortName,
      website:  p.website,
      employees: p.fullTimeEmployees,
      ceo: p.ceo,
      ipoDate: p.ipoDate,
    };

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ unified }),
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
