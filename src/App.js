import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY_FAVS   = "stock_favorites_v2";
const STORAGE_KEY_APIKEY = "gemini_api_key";

const REC_COLOR = {
  "COMPRAR": "#00d68f",
  "MANTER":  "#4fc3f7",
  "AGUARDAR":"#ffaa00",
  "EVITAR":  "#ff4d6d",
};

function scoreColor(s) {
  return s >= 7 ? "#00d68f" : s >= 5 ? "#ffaa00" : "#ff4d6d";
}

function fmt(v, suffix="") {
  if (v === null || v === undefined || v === 0) return "N/A";
  if (typeof v === "string") return v;
  return v.toFixed(2) + suffix;
}

function fmtPct(v) {
  if (v === null || v === undefined) return "N/A";
  return (v * 100).toFixed(2) + "%";
}

function fmtCurrency(v) {
  if (!v) return "N/A";
  if (v >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (v >= 1e9)  return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6)  return "$" + (v / 1e6).toFixed(2) + "M";
  return "$" + v.toFixed(2);
}

// ── Yahoo Finance via proxy ───────────────────────────────────────
async function fetchYahooData(ticker) {
  // Tenta primeiro a Netlify Function, depois fallback direto
  const endpoints = [
    `/api/yahoo?ticker=${encodeURIComponent(ticker)}`,
    `/.netlify/functions/yahoo?ticker=${encodeURIComponent(ticker)}`,
  ];

  let lastErr = "";
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
      const json = await res.json();
      if (json.error) { lastErr = json.error; continue; }
      const r = json.quoteSummary?.result?.[0];
      if (r) return r;
      lastErr = "Resposta vazia do servidor";
    } catch(e) {
      lastErr = e.message;
      continue;
    }
  }
  throw new Error(`Falha ao buscar ${ticker}: ${lastErr}. Verifique se a Netlify Function foi publicada em Site → Functions.`);
}

function extractMetrics(r) {
  const price     = r.price || {};
  const summary   = r.summaryDetail || {};
  const keyStats  = r.defaultKeyStatistics || {};
  const finData   = r.financialData || {};
  const profile   = r.assetProfile || {};

  const currentPrice  = price.regularMarketPrice?.raw;
  const prevClose     = price.regularMarketPreviousClose?.raw;
  const change1d      = currentPrice && prevClose ? ((currentPrice - prevClose) / prevClose * 100) : null;

  return {
    // Identity
    company:    price.longName || price.shortName || "",
    sector:     profile.sector || "",
    industry:   profile.industry || "",
    description: profile.longBusinessSummary || "",
    website:    profile.website || "",
    employees:  profile.fullTimeEmployees?.toLocaleString() || "N/A",

    // Price
    price:      currentPrice ? `$${currentPrice.toFixed(2)}` : "N/A",
    change1d:   change1d,
    market_cap: fmtCurrency(price.marketCap?.raw),
    volume:     price.regularMarketVolume?.raw?.toLocaleString() || "N/A",
    avg_volume: price.averageVolume?.raw?.toLocaleString() || "N/A",
    week52_high: currentPrice ? `$${summary.fiftyTwoWeekHigh?.raw?.toFixed(2)}` : "N/A",
    week52_low:  currentPrice ? `$${summary.fiftyTwoWeekLow?.raw?.toFixed(2)}` : "N/A",

    // Valuation
    pe:           fmt(summary.trailingPE?.raw, "x"),
    forward_pe:   fmt(summary.forwardPE?.raw, "x"),
    peg:          fmt(keyStats.pegRatio?.raw),
    pb:           fmt(keyStats.priceToBook?.raw, "x"),
    ps:           fmt(keyStats.priceToSalesTrailing12Months?.raw ?? summary.priceToSalesTrailing12Months?.raw, "x"),
    price_fcf:    "N/A",
    ev_ebitda:    fmt(keyStats.enterpriseToEbitda?.raw, "x"),
    ev_fcf:       "N/A",
    ev:           fmtCurrency(keyStats.enterpriseValue?.raw),

    // Profitability
    roe:          fmtPct(finData.returnOnEquity?.raw),
    roa:          fmtPct(finData.returnOnAssets?.raw),
    roic:         "N/A",
    gross_margin: fmtPct(finData.grossMargins?.raw),
    op_margin:    fmtPct(finData.operatingMargins?.raw),
    net_margin:   fmtPct(finData.profitMargins?.raw),
    ebitda_margin: "N/A",
    fcf_yield:    "N/A",
    asset_turnover: "N/A",

    // Growth
    revenue_growth:   fmtPct(finData.revenueGrowth?.raw),
    earnings_growth:  fmtPct(finData.earningsGrowth?.raw),
    eps_ttm:          fmt(keyStats.trailingEps?.raw),
    eps_forward:      fmt(keyStats.forwardEps?.raw),
    eps_growth:       fmtPct(finData.earningsGrowth?.raw),
    revenue_ttm:      fmtCurrency(finData.totalRevenue?.raw),

    // Dividends
    dy:           fmtPct(summary.dividendYield?.raw ?? summary.trailingAnnualDividendYield?.raw),
    div_rate:     fmt(summary.dividendRate?.raw),
    payout:       fmtPct(summary.payoutRatio?.raw),
    div_years:    "N/A",
    div_cagr_5y:  "N/A",
    buyback_yield: "N/A",
    total_shareholder_yield: "N/A",
    ex_div_date:  summary.exDividendDate?.fmt || "N/A",

    // Health
    current_ratio:     fmt(finData.currentRatio?.raw),
    quick_ratio:       fmt(finData.quickRatio?.raw),
    debt_equity:       fmt(finData.debtToEquity?.raw),
    total_debt:        fmtCurrency(finData.totalDebt?.raw),
    total_cash:        fmtCurrency(finData.totalCash?.raw),
    interest_coverage: "N/A",
    altman_z:          "N/A",

    // Analyst
    analyst_target:    finData.targetMeanPrice?.raw ? `$${finData.targetMeanPrice.raw.toFixed(2)}` : "N/A",
    analyst_low:       finData.targetLowPrice?.raw  ? `$${finData.targetLowPrice.raw.toFixed(2)}`  : "N/A",
    analyst_high:      finData.targetHighPrice?.raw ? `$${finData.targetHighPrice.raw.toFixed(2)}` : "N/A",
    analyst_consensus: finData.recommendationKey?.raw
      ? finData.recommendationKey.raw.toUpperCase()
      : "N/A",
    analyst_count:     finData.numberOfAnalystOpinions?.raw || "N/A",

    // Risk
    beta:          fmt(summary.beta?.raw),
    short_interest: fmtPct(keyStats.shortPercentOfFloat?.raw),
    short_ratio:    fmt(keyStats.shortRatio?.raw),
  };
}

// ── Gemini qualitative analysis ───────────────────────────────────
async function callGemini(apiKey, ticker, metrics) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const prompt = `Você é um analista fundamentalista especializado em ações americanas.
Com base nos dados REAIS abaixo de ${ticker}, forneça uma análise qualitativa e retorne APENAS um JSON válido (sem texto fora do JSON):

DADOS REAIS (${new Date().toLocaleDateString("pt-BR")}):
- Empresa: ${metrics.company}
- Setor: ${metrics.sector} / ${metrics.industry}
- Preço: ${metrics.price} | Market Cap: ${metrics.market_cap}
- P/E: ${metrics.pe} | Forward P/E: ${metrics.forward_pe} | PEG: ${metrics.peg}
- P/B: ${metrics.pb} | P/S: ${metrics.ps} | EV/EBITDA: ${metrics.ev_ebitda}
- ROE: ${metrics.roe} | ROA: ${metrics.roa} | Margem Líquida: ${metrics.net_margin}
- Margem Bruta: ${metrics.gross_margin} | Margem Operacional: ${metrics.op_margin}
- Crescimento Receita: ${metrics.revenue_growth} | Crescimento Lucro: ${metrics.earnings_growth}
- Dividend Yield: ${metrics.dy} | Payout: ${metrics.payout}
- Dívida/Patrimônio: ${metrics.debt_equity} | Liquidez Corrente: ${metrics.current_ratio}
- Beta: ${metrics.beta} | Short Interest: ${metrics.short_interest}
- Alvo Analistas: ${metrics.analyst_target} | Consenso: ${metrics.analyst_consensus}

Retorne este JSON preenchido:
{
  "scores": { "valuation": 0, "health": 0, "growth": 0, "dividends": 0, "overall": 0 },
  "fair_value": { "method": "", "estimate": "", "current_vs_fair": "", "upside": "" },
  "strengths": ["", "", ""],
  "risks": ["", "", ""],
  "moat": "",
  "dividend_history": "",
  "outlook": "",
  "recommendation": "COMPRAR|MANTER|AGUARDAR|EVITAR",
  "recommendation_reason": ""
}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Erro Gemini ${res.status}`);
  }
  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => p.text && !p.thought).map(p => p.text).join("\n")
    || parts.map(p => p.text||"").filter(Boolean).join("\n");
  try {
    const m = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (m) return JSON.parse(m[1]);
    const b1 = text.indexOf("{"), b2 = text.lastIndexOf("}");
    if (b1 !== -1 && b2 !== -1) return JSON.parse(text.slice(b1, b2+1));
    return JSON.parse(text.trim());
  } catch { return null; }
}

// ── Components ────────────────────────────────────────────────────
function Spinner({ size=16 }) {
  return <span style={{ display:"inline-block", width:size, height:size, border:`2px solid #1e2d3d`, borderTop:`2px solid #4fc3f7`, borderRadius:"50%", animation:"spin 0.8s linear infinite", flexShrink:0 }} />;
}

function MetricRow({ label, value, desc, color }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:"1px solid #1e2d3d" }}>
      <div>
        <span style={{ color:"#a8c0d6", fontSize:14, fontFamily:"'IBM Plex Mono',monospace" }}>{label}</span>
        {desc && <span style={{ color:"#4a6a8a", fontSize:11, marginLeft:8 }}>{desc}</span>}
      </div>
      <span style={{ color:color||"#e2f0ff", fontWeight:700, fontFamily:"'IBM Plex Mono',monospace", fontSize:14 }}>{value ?? "—"}</span>
    </div>
  );
}

function Section({ title, children, icon }) {
  return (
    <div style={{ background:"#0d1b2a", border:"1px solid #1e2d3d", borderRadius:12, padding:"20px 24px", marginBottom:16 }}>
      <div style={{ color:"#4fc3f7", fontWeight:700, fontSize:13, letterSpacing:2, textTransform:"uppercase", marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
        {icon} {title}
      </div>
      {children}
    </div>
  );
}

// ── API Key Setup ─────────────────────────────────────────────────
function ApiKeySetup({ onSave }) {
  const [key, setKey]     = useState("");
  const [show, setShow]   = useState(false);
  const [error, setError] = useState("");

  const handleSave = () => {
    const trimmed = key.trim();
    if (trimmed.length < 10) { setError("Chave muito curta. Verifique e tente novamente."); return; }
    localStorage.setItem(STORAGE_KEY_APIKEY, trimmed);
    onSave(trimmed);
  };

  return (
    <div style={{ minHeight:"100vh", background:"#060d14", display:"flex", alignItems:"center", justifyContent:"center", padding:24, fontFamily:"'IBM Plex Sans',sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=IBM+Plex+Sans:wght@300;400;600;700&display=swap'); *{box-sizing:border-box;} input:focus{outline:none;}`}</style>
      <div style={{ maxWidth:500, width:"100%" }}>
        <div style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{ fontSize:52, marginBottom:14 }}>📈</div>
          <h1 style={{ color:"#e2f0ff", fontSize:26, fontWeight:700, margin:"0 0 8px" }}>US Stock Analyzer</h1>
          <p style={{ color:"#4a6a8a", fontSize:14, margin:0 }}>Dados reais via Yahoo Finance · Análise IA via Google Gemini</p>
        </div>
        <div style={{ background:"#0d1b2a", border:"1px solid #1e3a5a", borderRadius:14, padding:28 }}>
          <label style={{ color:"#4fc3f7", fontSize:12, fontWeight:700, letterSpacing:2, textTransform:"uppercase", display:"block", marginBottom:10 }}>Chave API Google Gemini</label>
          <div style={{ position:"relative", marginBottom:16 }}>
            <input type={show?"text":"password"} value={key} onChange={e=>{setKey(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&handleSave()}
              placeholder="Cole sua chave aqui..."
              style={{ width:"100%", background:"#060d14", border:`1px solid ${error?"#ff4d6d":"#1e3a5a"}`, borderRadius:8, padding:"12px 44px 12px 14px", color:"#e2f0ff", fontSize:14, fontFamily:"'IBM Plex Mono',monospace" }}/>
            <button onClick={()=>setShow(v=>!v)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"#4a6a8a", cursor:"pointer", fontSize:16, padding:0 }}>{show?"🙈":"👁️"}</button>
          </div>
          {error && <div style={{ color:"#ff4d6d", fontSize:12, marginBottom:12 }}>⚠ {error}</div>}
          <button onClick={handleSave} disabled={!key.trim()} style={{ width:"100%", background:key.trim()?"linear-gradient(135deg,#1a73e8,#4fc3f7)":"#1e2d3d", color:"#fff", border:"none", borderRadius:8, padding:"13px", fontWeight:700, fontSize:15, cursor:key.trim()?"pointer":"not-allowed", letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif" }}>
            Salvar e Continuar →
          </button>
          <div style={{ marginTop:20, padding:"14px 16px", background:"#060d14", borderRadius:8, border:"1px solid #1e2d3d" }}>
            <div style={{ color:"#4fc3f7", fontSize:11, fontWeight:700, letterSpacing:2, marginBottom:8 }}>🔑 COMO OBTER SUA CHAVE GRATUITA</div>
            <ol style={{ color:"#7a9ab8", fontSize:13, margin:0, paddingLeft:18, lineHeight:2.2 }}>
              <li>Acesse <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color:"#4fc3f7" }}>aistudio.google.com/apikey</a></li>
              <li>Login com conta Google</li>
              <li>Clique em <strong style={{ color:"#e2f0ff" }}>Create API key in new project</strong></li>
              <li>Copie e cole acima</li>
            </ol>
            <div style={{ marginTop:10, padding:"8px 12px", background:"#0d1b2a", borderRadius:6, border:"1px solid #00d68f33" }}>
              <span style={{ color:"#00d68f", fontSize:12, fontWeight:700 }}>✓ 100% Gratuito</span>
              <span style={{ color:"#4a6a8a", fontSize:12 }}> · Sem cartão · Yahoo Finance para dados reais</span>
            </div>
          </div>
          <div style={{ marginTop:14, color:"#2a4a6a", fontSize:11, textAlign:"center", lineHeight:1.7 }}>
            🔒 Chave salva apenas neste navegador. Nunca enviada a terceiros.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Favorites Panel ───────────────────────────────────────────────
function FavoritesPanel({ favorites, refreshingTickers, onSelect, onRemove, onRefreshOne, onRefreshAll, onClose }) {
  const anyRefreshing = refreshingTickers.size > 0;
  if (favorites.length === 0) return (
    <div style={{ padding:"32px 0", textAlign:"center" }}>
      <div style={{ fontSize:32, marginBottom:12 }}>★</div>
      <div style={{ color:"#4a6a8a", fontSize:14 }}>Nenhum favorito ainda.</div>
      <div style={{ color:"#2a4a6a", fontSize:12, marginTop:6 }}>Analise um ativo e clique em "Salvar nos Favoritos".</div>
    </div>
  );
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:12 }}>
        <button onClick={onRefreshAll} disabled={anyRefreshing} style={{ background:anyRefreshing?"#1e2d3d":"transparent", border:"1px solid #1e3a5a", borderRadius:8, padding:"6px 14px", color:anyRefreshing?"#4a6a8a":"#4fc3f7", fontSize:12, fontWeight:700, cursor:anyRefreshing?"not-allowed":"pointer", letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif", display:"flex", alignItems:"center", gap:6 }}>
          {anyRefreshing ? <><Spinner size={12}/> Atualizando...</> : <>↺ Atualizar Todos</>}
        </button>
      </div>
      {favorites.map(fav => {
        const c = scoreColor(fav.scores?.overall ?? 0);
        const rc = REC_COLOR[fav.recommendation] || "#888";
        const isRefreshing = refreshingTickers.has(fav.ticker);
        return (
          <div key={fav.ticker} style={{ background:"#060d14", border:`1px solid ${isRefreshing?"#1e3a5a":"#1e2d3d"}`, borderRadius:10, padding:"14px 16px", marginBottom:10, display:"flex", alignItems:"center", gap:12, opacity:isRefreshing?0.7:1, transition:"all 0.2s" }}>
            <div style={{ width:44, height:44, borderRadius:"50%", border:`2px solid ${c}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              {isRefreshing ? <Spinner size={18}/> : <span style={{ color:c, fontWeight:700, fontSize:15, fontFamily:"'IBM Plex Mono',monospace" }}>{fav.scores?.overall ?? "—"}</span>}
            </div>
            <div style={{ flex:1, minWidth:0, cursor:"pointer" }} onClick={()=>{ if(!isRefreshing){onSelect(fav);onClose();} }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                <span style={{ color:"#4fc3f7", fontWeight:700, fontFamily:"'IBM Plex Mono',monospace", fontSize:15 }}>{fav.ticker}</span>
                <span style={{ background:rc+"22", color:rc, border:`1px solid ${rc}44`, borderRadius:4, padding:"1px 8px", fontSize:11, fontWeight:700 }}>{fav.recommendation}</span>
                {fav.last_updated && <span style={{ color:"#2a4a6a", fontSize:10 }}>· {fav.last_updated}</span>}
              </div>
              <div style={{ color:"#7a9ab8", fontSize:12, marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{fav.company}</div>
              <div style={{ color:"#4a6a8a", fontSize:11, marginTop:1 }}>{fav.sector} · {fav.price} · Upside: {fav.fair_value?.upside ?? "—"}</div>
            </div>
            <div style={{ display:"flex", gap:6, flexShrink:0 }}>
              {["valuation","health","growth","dividends"].map(k => {
                const s = fav.scores?.[k] ?? 0;
                return <div key={k} style={{ textAlign:"center" }}><div style={{ color:scoreColor(s), fontSize:12, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace" }}>{s}</div><div style={{ color:"#2a4a6a", fontSize:9 }}>{k.slice(0,3).toUpperCase()}</div></div>;
              })}
            </div>
            <button onClick={e=>{e.stopPropagation();onRefreshOne(fav.ticker);}} disabled={isRefreshing} title="Atualizar"
              style={{ background:"none", border:"none", color:isRefreshing?"#2a4a6a":"#4a6a8a", fontSize:15, cursor:isRefreshing?"not-allowed":"pointer", padding:"4px", lineHeight:1, flexShrink:0 }}
              onMouseEnter={e=>{if(!isRefreshing)e.currentTarget.style.color="#4fc3f7";}}
              onMouseLeave={e=>{e.currentTarget.style.color=isRefreshing?"#2a4a6a":"#4a6a8a";}}
            >↺</button>
            <button onClick={e=>{e.stopPropagation();onRemove(fav.ticker);}} title="Remover"
              style={{ background:"none", border:"none", color:"#2a4a6a", fontSize:18, cursor:"pointer", padding:"4px 6px", lineHeight:1, flexShrink:0 }}
              onMouseEnter={e=>e.currentTarget.style.color="#ff4d6d"}
              onMouseLeave={e=>e.currentTarget.style.color="#2a4a6a"}
            >×</button>
          </div>
        );
      })}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────
export default function StockAnalyzer() {
  const [apiKey, setApiKey]       = useState(() => localStorage.getItem(STORAGE_KEY_APIKEY) || "");
  const [ticker, setTicker]       = useState("");
  const [loading, setLoading]     = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [data, setData]           = useState(null);
  const [error, setError]         = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [showFavs, setShowFavs]   = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [favorites, setFavorites] = useState(() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY_FAVS)||"[]"); } catch { return []; } });
  const [favSaved, setFavSaved]   = useState(false);
  const [refreshingTickers, setRefreshingTickers] = useState(new Set());

  useEffect(() => { localStorage.setItem(STORAGE_KEY_FAVS, JSON.stringify(favorites)); }, [favorites]);

  const isFavorited = data ? favorites.some(f => f.ticker === data.ticker) : false;

  const fetchAll = useCallback(async (sym) => {
    // Step 1: real-time data from Yahoo Finance
    setLoadingStep("Buscando cotações em tempo real (Yahoo Finance)...");
    const yahooRaw = await fetchYahooData(sym);
    const metrics  = extractMetrics(yahooRaw);

    // Step 2: qualitative analysis from Gemini
    setLoadingStep("Gerando análise qualitativa (Google Gemini)...");
    const ai = await callGemini(apiKey, sym, metrics);

    const now = new Date();
    const last_updated = now.toLocaleDateString("pt-BR", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });

    return {
      ticker: sym,
      company:    metrics.company,
      sector:     metrics.sector,
      industry:   metrics.industry,
      description: metrics.description.slice(0, 300) + (metrics.description.length > 300 ? "..." : ""),
      price:      metrics.price,
      change1d:   metrics.change1d,
      market_cap: metrics.market_cap,
      last_updated,
      metrics,
      scores:     ai?.scores     || { valuation:0, health:0, growth:0, dividends:0, overall:0 },
      fair_value: ai?.fair_value || { method:"N/A", estimate:"N/A", current_vs_fair:"N/A", upside:"N/A" },
      strengths:  ai?.strengths  || [],
      risks:      ai?.risks      || [],
      moat:       ai?.moat       || "",
      dividend_history: ai?.dividend_history || "",
      outlook:    ai?.outlook    || "",
      recommendation: ai?.recommendation || "N/A",
      recommendation_reason: ai?.recommendation_reason || "",
    };
  }, [apiKey]);

  const analyze = async (sym_override) => {
    const sym = (sym_override || ticker).trim().toUpperCase();
    if (!sym) return;
    if (!sym_override) setTicker(sym);
    setLoading(true); setData(null); setError(""); setActiveTab("overview");
    try {
      const result = await fetchAll(sym);
      setData(result);
    } catch(e) { setError(`Erro: ${e.message}`); }
    setLoading(false); setLoadingStep("");
  };

  const refreshOne = useCallback(async (sym) => {
    setRefreshingTickers(prev => new Set([...prev, sym]));
    try {
      const result = await fetchAll(sym);
      setFavorites(prev => prev.map(f => f.ticker === sym ? result : f));
      setData(prev => prev?.ticker === sym ? result : prev);
    } catch {}
    setRefreshingTickers(prev => { const next = new Set(prev); next.delete(sym); return next; });
  }, [fetchAll]);

  const refreshAll = useCallback(async () => {
    for (const fav of favorites) await refreshOne(fav.ticker);
  }, [favorites, refreshOne]);

  const toggleFavorite = () => {
    if (!data) return;
    if (isFavorited) { setFavorites(prev => prev.filter(f => f.ticker !== data.ticker)); setFavSaved(false); }
    else { setFavorites(prev => [data, ...prev.filter(f => f.ticker !== data.ticker)]); setFavSaved(true); setTimeout(()=>setFavSaved(false), 2000); }
  };

  if (!apiKey) return <ApiKeySetup onSave={setApiKey} />;

  const m = data?.metrics || {};
  const tabs = ["overview","valuation","dividendos","risco","perspectiva"];

  return (
    <div style={{ minHeight:"100vh", background:"#060d14", color:"#e2f0ff", fontFamily:"'IBM Plex Sans','Segoe UI',sans-serif", padding:"32px 16px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=IBM+Plex+Sans:wght@300;400;600;700&display=swap');
        * { box-sizing:border-box; }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#060d14} ::-webkit-scrollbar-thumb{background:#1e2d3d;border-radius:2px}
        input:focus{outline:none}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes popIn{from{transform:scale(0.97);opacity:0}to{transform:scale(1);opacity:1}}
      `}</style>

      <div style={{ maxWidth:800, margin:"0 auto" }}>

        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:28 }}>
          <div style={{ flex:1, textAlign:"center" }}>
            <div style={{ color:"#4fc3f7", fontSize:11, letterSpacing:4, fontFamily:"'IBM Plex Mono',monospace", marginBottom:8 }}>ANÁLISE FUNDAMENTALISTA</div>
            <h1 style={{ fontSize:32, fontWeight:700, margin:0, background:"linear-gradient(135deg,#e2f0ff,#4fc3f7)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", letterSpacing:-1 }}>US Stock Analyzer</h1>
            <p style={{ color:"#4a6a8a", marginTop:8, fontSize:13 }}>
              <span style={{ color:"#00d68f" }}>●</span> Dados em tempo real via Yahoo Finance &nbsp;·&nbsp;
              <span style={{ color:"#4fc3f7" }}>●</span> Análise IA via Google Gemini
            </p>
          </div>
          <button onClick={()=>setShowSettings(v=>!v)} title="Configurações" style={{ background:"none", border:"1px solid #1e2d3d", borderRadius:8, padding:"6px 10px", color:"#4a6a8a", cursor:"pointer", fontSize:16, flexShrink:0, transition:"all 0.2s" }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="#4fc3f7";e.currentTarget.style.color="#4fc3f7";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="#1e2d3d";e.currentTarget.style.color="#4a6a8a";}}
          >⚙</button>
        </div>

        {/* Settings */}
        {showSettings && (
          <div style={{ background:"#0d1b2a", border:"1px solid #1e3a5a", borderRadius:14, padding:"20px 24px", marginBottom:20, animation:"fadeIn 0.2s ease" }}>
            <div style={{ color:"#4fc3f7", fontSize:12, fontWeight:700, letterSpacing:2, textTransform:"uppercase", marginBottom:14 }}>⚙ Configurações</div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <div style={{ flex:1, background:"#060d14", border:"1px solid #1e3a5a", borderRadius:8, padding:"10px 14px", color:"#4a6a8a", fontSize:13, fontFamily:"'IBM Plex Mono',monospace" }}>
                Chave Gemini: {apiKey.slice(0,8)}••••••••
              </div>
              <button onClick={()=>{ localStorage.removeItem(STORAGE_KEY_APIKEY); setApiKey(""); setShowSettings(false); }} style={{ background:"#ff4d6d22", border:"1px solid #ff4d6d44", borderRadius:8, padding:"10px 16px", color:"#ff4d6d", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"'IBM Plex Sans',sans-serif" }}>
                Trocar Chave
              </button>
            </div>
          </div>
        )}

        {/* Search */}
        <div style={{ display:"flex", gap:8, marginBottom:20 }}>
          <div style={{ flex:1, display:"flex", gap:10, background:"#0d1b2a", border:"1px solid #1e3a5a", borderRadius:12, padding:"12px 16px" }}>
            <input value={ticker} onChange={e=>setTicker(e.target.value)} onKeyDown={e=>e.key==="Enter"&&analyze()}
              placeholder="Ex: AAPL, MSFT, KO, JNJ, NVDA..."
              style={{ flex:1, background:"transparent", border:"none", color:"#e2f0ff", fontSize:18, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700, letterSpacing:2 }}/>
            <button onClick={()=>analyze()} disabled={loading||!ticker.trim()} style={{ background:loading?"#1e2d3d":"linear-gradient(135deg,#1a73e8,#4fc3f7)", color:"#fff", border:"none", borderRadius:8, padding:"10px 24px", fontWeight:700, fontSize:14, cursor:loading?"not-allowed":"pointer", letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif", display:"flex", alignItems:"center", gap:8 }}>
              {loading ? <><Spinner/>Analisando...</> : "Analisar →"}
            </button>
          </div>
          <button onClick={()=>setShowFavs(v=>!v)} style={{ background:showFavs?"#1e3a5a":"#0d1b2a", border:`1px solid ${showFavs?"#4fc3f7":"#1e3a5a"}`, borderRadius:12, padding:"0 18px", cursor:"pointer", color:showFavs?"#4fc3f7":"#4a6a8a", fontSize:13, fontWeight:700, letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif", display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
            <span style={{ fontSize:16 }}>★</span><span>Favoritos</span>
            {favorites.length > 0 && <span style={{ background:"#4fc3f7", color:"#060d14", borderRadius:"50%", width:18, height:18, fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>{favorites.length}</span>}
          </button>
        </div>

        {/* Favorites */}
        {showFavs && (
          <div style={{ background:"#0d1b2a", border:"1px solid #1e3a5a", borderRadius:14, padding:"20px", marginBottom:20, animation:"fadeIn 0.2s ease" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ color:"#4fc3f7", fontWeight:700, fontSize:13, letterSpacing:2, textTransform:"uppercase", display:"flex", alignItems:"center", gap:8 }}>
                ★ Meus Favoritos <span style={{ color:"#4a6a8a", fontWeight:400, fontSize:12 }}>({favorites.length} ativo{favorites.length!==1?"s":""})</span>
              </div>
              <button onClick={()=>setShowFavs(false)} style={{ background:"none", border:"none", color:"#4a6a8a", fontSize:20, cursor:"pointer", padding:4 }}>×</button>
            </div>
            <FavoritesPanel favorites={favorites} refreshingTickers={refreshingTickers}
              onSelect={fav=>{setData(fav);setTicker(fav.ticker);setActiveTab("overview");}}
              onRemove={t=>setFavorites(prev=>prev.filter(f=>f.ticker!==t))}
              onRefreshOne={refreshOne} onRefreshAll={refreshAll} onClose={()=>setShowFavs(false)}/>
          </div>
        )}

        {error && <div style={{ background:"#ff4d6d11", border:"1px solid #ff4d6d44", borderRadius:10, padding:"12px 18px", color:"#ff4d6d", marginBottom:20, fontSize:14 }}>⚠ {error}</div>}

        {loading && (
          <div style={{ textAlign:"center", padding:"56px 0" }}>
            <Spinner size={42}/>
            <div style={{ color:"#4fc3f7", fontFamily:"'IBM Plex Mono',monospace", fontSize:13, marginTop:18 }}>{loadingStep}</div>
          </div>
        )}

        {data && (
          <div style={{ animation:"popIn 0.25s ease" }}>

            {/* Company Header */}
            <div style={{ background:"linear-gradient(135deg,#0d1b2a,#0a2236)", border:"1px solid #1e3a5a", borderRadius:14, padding:"24px 28px", marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:16 }}>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:6, flexWrap:"wrap" }}>
                  <span style={{ fontSize:28, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace", color:"#4fc3f7" }}>{data.ticker}</span>
                  {data.recommendation && data.recommendation !== "N/A" && (
                    <span style={{ background:(REC_COLOR[data.recommendation]||"#888")+"22", color:REC_COLOR[data.recommendation]||"#888", border:`1px solid ${(REC_COLOR[data.recommendation]||"#888")}44`, borderRadius:6, padding:"3px 12px", fontWeight:700, fontSize:12, letterSpacing:1 }}>{data.recommendation}</span>
                  )}
                  {data.last_updated && <span style={{ color:"#2a4a6a", fontSize:11, fontFamily:"'IBM Plex Mono',monospace" }}>· {data.last_updated}</span>}
                </div>
                <div style={{ color:"#e2f0ff", fontWeight:600, fontSize:18, marginBottom:4 }}>{data.company}</div>
                <div style={{ color:"#4a6a8a", fontSize:13 }}>{data.sector} · {data.industry}</div>
                <div style={{ color:"#7a9ab8", fontSize:13, marginTop:8, maxWidth:440, lineHeight:1.5 }}>{data.description}</div>
                <button onClick={toggleFavorite} style={{ marginTop:14, background:isFavorited?"#ffaa0022":"transparent", border:`1px solid ${isFavorited?"#ffaa00":"#1e3a5a"}`, borderRadius:8, padding:"6px 16px", color:isFavorited?"#ffaa00":"#4a6a8a", fontSize:12, fontWeight:700, cursor:"pointer", letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif", display:"inline-flex", alignItems:"center", gap:6 }}>
                  {favSaved ? <><span>✓</span> Salvo!</> : isFavorited ? <><span>★</span> Nos Favoritos</> : <><span>☆</span> Salvar nos Favoritos</>}
                </button>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ display:"flex", alignItems:"baseline", gap:10, justifyContent:"flex-end" }}>
                  <div style={{ color:"#e2f0ff", fontSize:28, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace" }}>{data.price}</div>
                  {data.change1d !== null && (
                    <div style={{ color:data.change1d >= 0 ? "#00d68f" : "#ff4d6d", fontSize:14, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace" }}>
                      {data.change1d >= 0 ? "▲" : "▼"} {Math.abs(data.change1d).toFixed(2)}%
                    </div>
                  )}
                </div>
                <div style={{ color:"#4a6a8a", fontSize:12, marginTop:2 }}>Market Cap: {data.market_cap}</div>
                <div style={{ color:"#4a6a8a", fontSize:11, marginTop:2 }}>52w: {m.week52_low} – {m.week52_high}</div>
                {data.fair_value?.upside && data.fair_value.upside !== "N/A" && (
                  <div style={{ color:data.fair_value.upside.startsWith("+")?"#00d68f":"#ff4d6d", fontWeight:700, fontSize:14, marginTop:6, fontFamily:"'IBM Plex Mono',monospace" }}>
                    Upside: {data.fair_value.upside}
                  </div>
                )}
                {m.analyst_target !== "N/A" && <div style={{ color:"#a8c0d6", fontSize:12, marginTop:4 }}>Alvo analistas: {m.analyst_target}</div>}
                {m.analyst_consensus !== "N/A" && <div style={{ color:"#4a6a8a", fontSize:11, marginTop:2 }}>{m.analyst_consensus} ({m.analyst_count} analistas)</div>}
              </div>
            </div>

            {/* Score Cards */}
            {data.scores && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:8, marginBottom:16 }}>
                {[{key:"overall",label:"Geral"},{key:"valuation",label:"Valuation"},{key:"health",label:"Saúde"},{key:"growth",label:"Crescimento"},{key:"dividends",label:"Dividendos"}].map(({key,label}) => {
                  const s = data.scores[key] ?? 0; const c = scoreColor(s);
                  return (
                    <div key={key} style={{ background:"#0d1b2a", border:`1px solid ${c}33`, borderRadius:10, padding:"14px 8px", textAlign:"center" }}>
                      <div style={{ color:c, fontSize:22, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace" }}>{s}</div>
                      <div style={{ color:"#4a6a8a", fontSize:10, letterSpacing:1, marginTop:2 }}>{label.toUpperCase()}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Tabs */}
            <div style={{ display:"flex", gap:4, marginBottom:16, borderBottom:"1px solid #1e2d3d", overflowX:"auto" }}>
              {tabs.map(tab => (
                <button key={tab} onClick={()=>setActiveTab(tab)} style={{ background:"none", border:"none", borderBottom:activeTab===tab?"2px solid #4fc3f7":"2px solid transparent", color:activeTab===tab?"#4fc3f7":"#4a6a8a", fontWeight:600, fontSize:13, padding:"8px 14px", letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif", marginBottom:-1, textTransform:"capitalize", cursor:"pointer", whiteSpace:"nowrap" }}>
                  {tab.charAt(0).toUpperCase()+tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Overview */}
            {activeTab==="overview" && (
              <div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  <Section title="Pontos Fortes" icon="✦">
                    {(data.strengths||[]).map((s,i) => <div key={i} style={{ color:"#7cc987", fontSize:13, padding:"5px 0", borderBottom:"1px solid #1e2d3d", display:"flex", gap:8 }}><span style={{ color:"#00d68f" }}>+</span>{s}</div>)}
                  </Section>
                  <Section title="Riscos" icon="⚠">
                    {(data.risks||[]).map((r,i) => <div key={i} style={{ color:"#f07070", fontSize:13, padding:"5px 0", borderBottom:"1px solid #1e2d3d", display:"flex", gap:8 }}><span style={{ color:"#ff4d6d" }}>—</span>{r}</div>)}
                  </Section>
                </div>
                <Section title="Fosso Competitivo (Moat)" icon="🏰">
                  <p style={{ color:"#a8c0d6", fontSize:14, margin:0, lineHeight:1.6 }}>{data.moat}</p>
                </Section>
                {data.recommendation_reason && (
                  <Section title="Recomendação" icon="◎">
                    <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                      <span style={{ background:(REC_COLOR[data.recommendation]||"#888")+"22", color:REC_COLOR[data.recommendation]||"#888", border:`1px solid ${(REC_COLOR[data.recommendation]||"#888")}44`, borderRadius:6, padding:"4px 16px", fontWeight:700, fontSize:14 }}>{data.recommendation}</span>
                      <span style={{ color:"#a8c0d6", fontSize:14 }}>{data.recommendation_reason}</span>
                    </div>
                  </Section>
                )}
              </div>
            )}

            {/* Valuation */}
            {activeTab==="valuation" && (
              <div>
                <Section title="Múltiplos de Preço" icon="$">
                  <MetricRow label="P/L (P/E)"       value={m.pe}         desc="Preço / Lucro TTM"/>
                  <MetricRow label="Forward P/E"     value={m.forward_pe} desc="P/E estimado próx. 12m"/>
                  <MetricRow label="PEG Ratio"       value={m.peg}        desc="P/E ÷ Crescimento"/>
                  <MetricRow label="P/VP (P/B)"      value={m.pb}         desc="Preço / Valor Patrimonial"/>
                  <MetricRow label="P/S"             value={m.ps}         desc="Preço / Receita"/>
                  <MetricRow label="EV/EBITDA"       value={m.ev_ebitda}  desc="Enterprise Value / EBITDA"/>
                  <MetricRow label="Enterprise Value" value={m.ev}        desc=""/>
                </Section>
                <Section title="Rentabilidade & Margens" icon="◈">
                  <MetricRow label="ROE"             value={m.roe}         desc="Retorno sobre Patrimônio"/>
                  <MetricRow label="ROA"             value={m.roa}         desc="Retorno sobre Ativos"/>
                  <MetricRow label="Margem Bruta"    value={m.gross_margin}/>
                  <MetricRow label="Margem Operacional" value={m.op_margin}/>
                  <MetricRow label="Margem Líquida"  value={m.net_margin}/>
                  <MetricRow label="Receita TTM"     value={m.revenue_ttm}/>
                </Section>
                <Section title="Saúde Financeira" icon="♥">
                  <MetricRow label="Dívida/Patrimônio" value={m.debt_equity}  desc="Alavancagem"/>
                  <MetricRow label="Liquidez Corrente" value={m.current_ratio}/>
                  <MetricRow label="Liquidez Rápida"   value={m.quick_ratio}/>
                  <MetricRow label="Dívida Total"       value={m.total_debt}/>
                  <MetricRow label="Caixa Total"        value={m.total_cash}/>
                </Section>
                {data.fair_value && (
                  <Section title="Estimativa de Valor Justo (IA)" icon="◎">
                    <MetricRow label="Método"         value={data.fair_value.method}/>
                    <MetricRow label="Faixa Estimada" value={data.fair_value.estimate} color="#4fc3f7"/>
                    <MetricRow label="Vs. Preço Atual" value={data.fair_value.current_vs_fair}/>
                    <MetricRow label="Potencial"      value={data.fair_value.upside} color={data.fair_value.upside?.startsWith("+")?"#00d68f":"#ff4d6d"}/>
                  </Section>
                )}
              </div>
            )}

            {/* Dividendos */}
            {activeTab==="dividendos" && (
              <div>
                <Section title="Métricas de Dividendos" icon="◈">
                  <MetricRow label="Dividend Yield"  value={m.dy}        desc="Rendimento anual"/>
                  <MetricRow label="Dividendo/Ação"  value={m.div_rate !== "N/A" ? `$${m.div_rate}` : "N/A"} desc="Anual"/>
                  <MetricRow label="Payout Ratio"    value={m.payout}    desc="% do Lucro distribuído"/>
                  <MetricRow label="Ex-Dividend Date" value={m.ex_div_date}/>
                </Section>
                <Section title="Retorno ao Acionista" icon="↑">
                  <MetricRow label="EPS TTM"         value={m.eps_ttm !== "N/A" ? `$${m.eps_ttm}` : "N/A"}/>
                  <MetricRow label="EPS Forward"     value={m.eps_forward !== "N/A" ? `$${m.eps_forward}` : "N/A"}/>
                </Section>
                {data.dividend_history && (
                  <Section title="Histórico & Consistência (IA)" icon="★">
                    <p style={{ color:"#a8c0d6", fontSize:14, margin:0, lineHeight:1.6 }}>{data.dividend_history}</p>
                  </Section>
                )}
              </div>
            )}

            {/* Risco */}
            {activeTab==="risco" && (
              <div>
                <Section title="Indicadores de Risco" icon="⚠">
                  <MetricRow label="Beta"            value={m.beta}         desc="Volatilidade vs S&P 500" color={parseFloat(m.beta)<1?"#00d68f":parseFloat(m.beta)<1.5?"#ffaa00":"#ff4d6d"}/>
                  <MetricRow label="Short Interest"  value={m.short_interest} desc="% ações vendidas a descoberto"/>
                  <MetricRow label="Short Ratio"     value={m.short_ratio}  desc="Dias para cobrir o short"/>
                  <MetricRow label="Dívida Total"    value={m.total_debt}/>
                  <MetricRow label="Dívida/Patrimônio" value={m.debt_equity}/>
                </Section>
                <Section title="Volume & Liquidez" icon="◎">
                  <MetricRow label="Volume"          value={m.volume}     desc="Hoje"/>
                  <MetricRow label="Volume Médio"    value={m.avg_volume} desc="3 meses"/>
                </Section>
                <Section title="Expectativas de Mercado" icon="◎">
                  <MetricRow label="Alvo Analistas"  value={m.analyst_target}/>
                  <MetricRow label="Alvo Mínimo"     value={m.analyst_low}/>
                  <MetricRow label="Alvo Máximo"     value={m.analyst_high}/>
                  <MetricRow label="Consenso"        value={m.analyst_consensus}/>
                  <MetricRow label="Nº Analistas"    value={String(m.analyst_count)}/>
                </Section>
              </div>
            )}

            {/* Perspectiva */}
            {activeTab==="perspectiva" && (
              <div>
                <Section title="Crescimento" icon="↑">
                  <MetricRow label="Crescimento Receita" value={m.revenue_growth} desc="YoY"/>
                  <MetricRow label="Crescimento Lucro"   value={m.earnings_growth} desc="YoY"/>
                  <MetricRow label="EPS TTM"             value={m.eps_ttm !== "N/A" ? `$${m.eps_ttm}` : "N/A"}/>
                  <MetricRow label="EPS Forward"         value={m.eps_forward !== "N/A" ? `$${m.eps_forward}` : "N/A"}/>
                </Section>
                {data.outlook && (
                  <Section title="Perspectiva de Médio/Longo Prazo (IA)" icon="◎">
                    <p style={{ color:"#a8c0d6", fontSize:14, margin:0, lineHeight:1.7 }}>{data.outlook}</p>
                  </Section>
                )}
              </div>
            )}

            <div style={{ color:"#2a4a6a", fontSize:11, textAlign:"center", marginTop:20, lineHeight:1.7 }}>
              Dados de mercado: Yahoo Finance (tempo real) · Análise qualitativa: Google Gemini (IA)<br/>
              ⚠ Fins educacionais apenas. Não constitui recomendação de investimento.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
