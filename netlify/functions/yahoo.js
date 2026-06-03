const https = require("https");

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
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
    const parsed = JSON.parse(body);
    // Rejeita respostas de erro do FMP
    if (parsed?.["Error Message"] || parsed?.error) return null;
    return parsed;
  } catch { return null; }
}

exports.handler = async function (event) {
  const ticker = (event.queryStringParameters?.ticker || "").toUpperCase().trim();
  const fmpKey = process.env.FMP_API_KEY || event.queryStringParameters?.fmpkey || "";

  if (!ticker) {
    return { statusCode: 400, body: JSON.stringify({ error: "ticker obrigatório" }) };
  }
  if (!fmpKey) {
    return { statusCode: 400, body: JSON.stringify({ error: "Chave FMP não configurada. Adicione FMP_API_KEY no Netlify → Environment Variables." }) };
  }

  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
  };

  try {
    const base = "https://financialmodelingprep.com/stable";
    const k    = `apikey=${fmpKey}`;

    // Busca em paralelo — endpoints da API stable (pós ago/2025)
    const [quote, profile, ratios, keyMetrics, growth, outlook] = await Promise.all([
      tryJSON(`${base}/quote?symbol=${ticker}&${k}`),
      tryJSON(`${base}/profile?symbol=${ticker}&${k}`),
      tryJSON(`${base}/ratios-ttm?symbol=${ticker}&${k}`),
      tryJSON(`${base}/key-metrics-ttm?symbol=${ticker}&${k}`),
      tryJSON(`${base}/financial-growth?symbol=${ticker}&limit=1&${k}`),
      tryJSON(`${base}/analyst-estimates?symbol=${ticker}&limit=1&${k}`),
    ]);

    const q  = Array.isArray(quote)      ? quote[0]      : (quote      || {});
    const p  = Array.isArray(profile)    ? profile[0]    : (profile    || {});
    const r  = Array.isArray(ratios)     ? ratios[0]     : (ratios     || {});
    const km = Array.isArray(keyMetrics) ? keyMetrics[0] : (keyMetrics || {});
    const g  = Array.isArray(growth)     ? growth[0]     : (growth     || {});
    const ov = Array.isArray(outlook)    ? outlook[0]    : (outlook    || {});

    if (!q.price && !p.companyName && !p.symbol) {
      return {
        statusCode: 404,
        headers: cors,
        body: JSON.stringify({
          error: `Ticker "${ticker}" não encontrado.`,
          debug: {
            quote:   JSON.stringify(quote)?.slice(0,150),
            profile: JSON.stringify(profile)?.slice(0,150),
          }
        }),
      };
    }

    const unified = {
      longName:    p.companyName || q.name || ticker,
      shortName:   q.symbol      || ticker,
      sector:      p.sector      || "",
      industry:    p.industry    || "",
      longBusinessSummary: p.description || "",
      website:     p.website     || "",
      ceo:         p.ceo         || "",
      employees:   p.fullTimeEmployees,
      exchange:    p.exchangeShortName || "",
      ipoDate:     p.ipoDate     || "",

      regularMarketPrice:         q.price,
      regularMarketPreviousClose: q.previousClose,
      regularMarketVolume:        q.volume,
      averageVolume:              q.avgVolume,
      marketCap:                  q.marketCap,
      fiftyTwoWeekHigh:           q.yearHigh,
      fiftyTwoWeekLow:            q.yearLow,

      trailingPE:           r.peRatioTTM          || q.pe,
      forwardPE:            ov.estimatedEpsAvg    ? (q.price / ov.estimatedEpsAvg) : null,
      pegRatio:             r.pegRatioTTM,
      priceToBook:          r.priceToBookRatioTTM || km.pbRatioTTM,
      priceToSales:         r.priceToSalesRatioTTM,
      priceToFreeCashFlow:  r.priceToFreeCashFlowsTTM,
      evToEbitda:           km.evToEbitdaTTM      || km.enterpriseValueOverEBITDATTM,
      evToFreeCashFlow:     km.evToFreeCashFlowTTM,
      enterpriseValue:      km.enterpriseValueTTM,

      returnOnEquity:    r.returnOnEquityTTM,
      returnOnAssets:    r.returnOnAssetsTTM,
      returnOnCapital:   r.returnOnCapitalEmployedTTM,
      grossMargins:      r.grossProfitMarginTTM,
      operatingMargins:  r.operatingProfitMarginTTM,
      profitMargins:     r.netProfitMarginTTM,
      assetTurnover:     r.assetTurnoverTTM,
      interestCoverage:  r.interestCoverageTTM,

      revenueGrowth:     g.revenueGrowth,
      earningsGrowth:    g.netIncomeGrowth,
      epsGrowth:         g.epsgrowth,
      trailingEps:       q.eps,
      forwardEps:        ov.estimatedEpsAvg || null,

      dividendYield:     r.dividendYieldTTM || q.dividendYield,
      dividendRate:      p.lastDiv,
      payoutRatio:       r.payoutRatioTTM,
      exDividendDate:    null,

      currentRatio:      r.currentRatioTTM,
      quickRatio:        r.quickRatioTTM,
      debtToEquity:      r.debtEquityRatioTTM,
      totalDebt:         km.netDebtTTM,
      totalCash:         null,

      targetMeanPrice:   ov.estimatedRevenueavg ? null : (q.priceAvg200 || null),
      targetLowPrice:    null,
      targetHighPrice:   null,
      recommendationKey: null,
      numberOfAnalystOpinions: ov.numberAnalysts || null,

      beta:              p.beta || q.beta,
      shortPercentFloat: null,
      shortRatio:        null,
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
