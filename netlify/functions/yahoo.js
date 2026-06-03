const https = require("https");

exports.handler = async function (event) {
  const ticker = event.queryStringParameters?.ticker;
  if (!ticker) {
    return { statusCode: 400, body: JSON.stringify({ error: "ticker obrigatório" }) };
  }

  const modules = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile";
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`;

  try {
    const data = await new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }, (res) => {
        let body = "";
        res.on("data", chunk => body += chunk);
        res.on("end", () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error("Resposta inválida do Yahoo Finance")); }
        });
      });
      req.on("error", reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
    });

    if (data.quoteSummary?.error) {
      return {
        statusCode: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Ticker não encontrado: " + ticker }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
