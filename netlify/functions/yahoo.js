const https = require("https");

function fetchUrl(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      // Segue redirecionamentos
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, headers).then(resolve).catch(reject);
      }
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

exports.handler = async function (event) {
  const ticker = event.queryStringParameters?.ticker;
  if (!ticker) {
    return { statusCode: 400, body: JSON.stringify({ error: "ticker obrigatório" }) };
  }

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    "Referer": "https://finance.yahoo.com/",
    "Origin": "https://finance.yahoo.com",
  };

  // Tenta v10 primeiro, depois v11 como fallback
  const urls = [
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=price%2CsummaryDetail%2CdefaultKeyStatistics%2CfinancialData%2CassetProfile`,
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=price%2CsummaryDetail%2CdefaultKeyStatistics%2CfinancialData%2CassetProfile`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
  ];

  let lastStatus = 0;
  let lastBody = "";

  for (const url of urls) {
    try {
      const { status, body } = await fetchUrl(url, headers);
      lastStatus = status;
      lastBody = body;

      if (status !== 200) continue;

      let parsed;
      try { parsed = JSON.parse(body); } catch { continue; }

      // v10 quoteSummary
      if (parsed.quoteSummary) {
        if (parsed.quoteSummary.error) {
          return {
            statusCode: 404,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ error: "Ticker não encontrado: " + ticker }),
          };
        }
        const result = parsed.quoteSummary.result?.[0];
        if (result) {
          return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify(parsed),
          };
        }
      }

      // v8 chart fallback — monta estrutura mínima compatível
      if (parsed.chart?.result?.[0]) {
        const chart = parsed.chart.result[0];
        const meta = chart.meta || {};
        const minimal = {
          quoteSummary: {
            result: [{
              price: {
                regularMarketPrice: { raw: meta.regularMarketPrice },
                regularMarketPreviousClose: { raw: meta.chartPreviousClose },
                regularMarketVolume: { raw: meta.regularMarketVolume },
                marketCap: { raw: meta.marketCap },
                longName: meta.longName || meta.symbol,
                shortName: meta.symbol,
              },
              summaryDetail: {
                trailingPE: {},
                forwardPE: {},
                dividendYield: {},
                beta: { raw: meta.beta },
                fiftyTwoWeekHigh: { raw: meta.fiftyTwoWeekHigh },
                fiftyTwoWeekLow: { raw: meta.fiftyTwoWeekLow },
              },
              defaultKeyStatistics: {},
              financialData: {},
              assetProfile: { sector: "", industry: "", longBusinessSummary: "" },
            }],
          },
        };
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify(minimal),
        };
      }
    } catch (e) {
      lastBody = e.message;
      continue;
    }
  }

  return {
    statusCode: 502,
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({
      error: `Yahoo Finance retornou status ${lastStatus}. Tente novamente em instantes.`,
      debug: lastBody.slice(0, 300),
    }),
  };
};
