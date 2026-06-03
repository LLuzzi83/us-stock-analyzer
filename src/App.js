import { useState, useEffect, useCallback } from "react";

const METRICS = [
  { key: "pe",              label: "P/L (P/E)",             desc: "Preço / Lucro" },
  { key: "forward_pe",      label: "Forward P/E",           desc: "P/E estimado próx. 12m" },
  { key: "peg",             label: "PEG Ratio",             desc: "P/E ÷ Crescimento" },
  { key: "pb",              label: "P/VP (P/B)",            desc: "Preço / Valor Patrimonial" },
  { key: "ps",              label: "P/S",                   desc: "Preço / Receita" },
  { key: "price_fcf",       label: "P/FCF",                 desc: "Preço / Fluxo de Caixa Livre" },
  { key: "ev_ebitda",       label: "EV/EBITDA",             desc: "Valor da Empresa / EBITDA" },
  { key: "ev_fcf",          label: "EV/FCF",                desc: "Enterprise Value / FCF" },
  { key: "roe",             label: "ROE",                   desc: "Retorno sobre Patrimônio" },
  { key: "roic",            label: "ROIC",                  desc: "Retorno sobre Capital Investido" },
  { key: "asset_turnover",  label: "Asset Turnover",        desc: "Eficiência no uso dos ativos" },
  { key: "interest_coverage",label:"Interest Coverage",     desc: "EBIT / Despesa de Juros" },
  { key: "altman_z",        label: "Altman Z-Score",        desc: "Risco de falência (>2.99 seguro)" },
  { key: "dy",              label: "Dividend Yield",        desc: "Rendimento de Dividendos" },
  { key: "div_cagr_5y",     label: "CAGR Div. 5 anos",     desc: "Crescimento anual composto do div." },
  { key: "div_years",       label: "Anos de Crescimento",  desc: "Anos consecutivos crescendo div." },
  { key: "buyback_yield",   label: "Buyback Yield",        desc: "Recompra de ações / Market Cap" },
  { key: "total_shareholder_yield", label: "Total Shareholder Yield", desc: "DY + Buyback Yield" },
  { key: "payout",          label: "Payout Ratio",          desc: "% do Lucro distribuído" },
  { key: "debt_equity",     label: "Dívida/Patrimônio",    desc: "Alavancagem financeira" },
  { key: "current_ratio",   label: "Liquidez Corrente",    desc: "Saúde financeira de curto prazo" },
  { key: "revenue_growth",  label: "Crescimento Receita",  desc: "YoY" },
  { key: "eps_growth",      label: "Crescimento EPS",      desc: "Lucro por ação YoY" },
  { key: "earnings_surprise",label:"Earnings Surprise",    desc: "Resultado vs consenso analistas" },
  { key: "analyst_target",  label: "Preço-Alvo Analistas", desc: "Consenso Bloomberg/FactSet" },
  { key: "analyst_consensus",label:"Consenso",             desc: "Buy / Hold / Sell analistas" },
  { key: "beta",            label: "Beta",                  desc: "Volatilidade vs S&P 500" },
  { key: "short_interest",  label: "Short Interest",       desc: "% ações vendidas a descoberto" },
  { key: "gross_margin",    label: "Margem Bruta",         desc: "" },
  { key: "net_margin",      label: "Margem Líquida",       desc: "" },
  { key: "fcf_yield",       label: "FCF Yield",            desc: "Fluxo de Caixa Livre / Market Cap" },
];

const REC_COLOR = {
  "COMPRAR": "#00d68f",
  "MANTER":  "#4fc3f7",
  "AGUARDAR":"#ffaa00",
  "EVITAR":  "#ff4d6d",
};

const STORAGE_KEY_FAVS   = "stock_favorites_v1";
const STORAGE_KEY_APIKEY = "gemini_api_key";

function scoreColor(s) {
  return s >= 7 ? "#00d68f" : s >= 5 ? "#ffaa00" : "#ff4d6d";
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

function Spinner({ size = 16 }) {
  return (
    <span style={{
      display:"inline-block", width:size, height:size,
      border:`2px solid #1e2d3d`, borderTop:`2px solid #4fc3f7`,
      borderRadius:"50%", animation:"spin 0.8s linear infinite", flexShrink:0,
    }} />
  );
}

function parseAnalysis(text) {
  try {
    const m = text.match(/```json\n?([\s\S]*?)\n?```/);
    if (m) return JSON.parse(m[1]);
    return JSON.parse(text.replace(/```json|```/g,"").trim());
  } catch { return null; }
}

function buildPrompt(sym) {
  return `Você é um analista fundamentalista especializado em ações americanas. Analise a ação ${sym} com dados atuais e retorne APENAS um JSON válido com esta estrutura exata (sem texto fora do JSON, sem markdown):

{
  "ticker": "${sym}",
  "company": "nome completo da empresa",
  "sector": "setor",
  "industry": "subsetor/indústria",
  "description": "descrição do negócio em 2 linhas",
  "price": "preço atual em USD ex: $189.50",
  "market_cap": "ex: $2.1T ou $45B",
  "last_updated": "mês e ano ex: Jun 2025",
  "scores": {
    "valuation": 7,
    "health": 8,
    "growth": 6,
    "dividends": 5,
    "overall": 7
  },
  "metrics": {
    "pe": "ex: 28.5x",
    "forward_pe": "ex: 24.2x",
    "peg": "ex: 1.8",
    "pb": "ex: 4.2x",
    "ps": "ex: 6.1x",
    "price_fcf": "ex: 22.3x",
    "ev_ebitda": "ex: 18.4x",
    "ev_fcf": "ex: 25.1x",
    "roe": "ex: 32.5%",
    "roic": "ex: 18.2%",
    "asset_turnover": "ex: 0.85",
    "interest_coverage": "ex: 12.3x",
    "altman_z": "ex: 4.2",
    "dy": "ex: 1.8%",
    "div_cagr_5y": "ex: 5.2%",
    "div_years": "ex: 12 anos",
    "buyback_yield": "ex: 2.1%",
    "total_shareholder_yield": "ex: 3.9%",
    "payout": "ex: 28%",
    "debt_equity": "ex: 0.45",
    "current_ratio": "ex: 1.8",
    "revenue_growth": "ex: +12.3%",
    "eps_growth": "ex: +18.5%",
    "earnings_surprise": "ex: +4.2% acima do consenso",
    "analyst_target": "ex: $210.00",
    "analyst_consensus": "ex: 78% Buy · 18% Hold · 4% Sell",
    "beta": "ex: 1.15",
    "short_interest": "ex: 0.8%",
    "gross_margin": "ex: 43.2%",
    "net_margin": "ex: 25.1%",
    "fcf_yield": "ex: 3.8%"
  },
  "fair_value": {
    "method": "DCF + múltiplos setoriais",
    "estimate": "ex: $195–$220",
    "current_vs_fair": "ex: 8% abaixo do valor justo",
    "upside": "ex: +12%"
  },
  "strengths": ["ponto forte 1", "ponto forte 2", "ponto forte 3"],
  "risks": ["risco 1", "risco 2", "risco 3"],
  "dividend_history": "descrição da consistência histórica de dividendos",
  "moat": "descrição do fosso competitivo da empresa",
  "outlook": "perspectiva para médio e longo prazo em 3 linhas",
  "recommendation": "COMPRAR",
  "recommendation_reason": "motivo resumido em 1 linha"
}`;
}

// ── Gemini API call ───────────────────────────────────────────────
async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `Erro ${res.status}`;
    throw new Error(msg);
  }
  const json = await res.json();
  // Extract text from response parts
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || "").filter(Boolean).join("\n");
}

// ── API Key Setup Screen ──────────────────────────────────────────
function ApiKeySetup({ onSave }) {
  const [key, setKey]   = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");

  const handleSave = () => {
    const trimmed = key.trim();
    if (trimmed.length < 10) {
      setError("Chave muito curta. Verifique e tente novamente.");
      return;
    }
    localStorage.setItem(STORAGE_KEY_APIKEY, trimmed);
    onSave(trimmed);
  };

  return (
    <div style={{ minHeight:"100vh", background:"#060d14", display:"flex", alignItems:"center", justifyContent:"center", padding:24, fontFamily:"'IBM Plex Sans',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=IBM+Plex+Sans:wght@300;400;600;700&display=swap');
        * { box-sizing:border-box; }
        input:focus { outline:none; }
      `}</style>
      <div style={{ maxWidth:500, width:"100%" }}>
        <div style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{ fontSize:52, marginBottom:14 }}>📈</div>
          <h1 style={{ color:"#e2f0ff", fontSize:26, fontWeight:700, margin:"0 0 8px", letterSpacing:-0.5 }}>
            US Stock Analyzer
          </h1>
          <p style={{ color:"#4a6a8a", fontSize:14, margin:0 }}>
            Análise fundamentalista com IA — 100% gratuito via Google Gemini
          </p>
        </div>

        <div style={{ background:"#0d1b2a", border:"1px solid #1e3a5a", borderRadius:14, padding:28 }}>
          <div style={{ marginBottom:20 }}>
            <label style={{ color:"#4fc3f7", fontSize:12, fontWeight:700, letterSpacing:2, textTransform:"uppercase", display:"block", marginBottom:10 }}>
              Chave da API Google Gemini
            </label>
            <div style={{ position:"relative" }}>
              <input
                type={show ? "text" : "password"}
                value={key}
                onChange={e => { setKey(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && handleSave()}
                placeholder="Cole sua chave aqui..."
                style={{
                  width:"100%", background:"#060d14", border:`1px solid ${error ? "#ff4d6d" : "#1e3a5a"}`,
                  borderRadius:8, padding:"12px 44px 12px 14px",
                  color:"#e2f0ff", fontSize:14, fontFamily:"'IBM Plex Mono',monospace",
                  transition:"border-color 0.2s",
                }}
              />
              <button onClick={() => setShow(v => !v)} style={{
                position:"absolute", right:12, top:"50%", transform:"translateY(-50%)",
                background:"none", border:"none", color:"#4a6a8a", cursor:"pointer", fontSize:16, padding:0,
              }}>
                {show ? "🙈" : "👁️"}
              </button>
            </div>
            {error && <div style={{ color:"#ff4d6d", fontSize:12, marginTop:6 }}>⚠ {error}</div>}
          </div>

          <button onClick={handleSave} disabled={!key.trim()} style={{
            width:"100%",
            background: key.trim() ? "linear-gradient(135deg,#1a73e8,#4fc3f7)" : "#1e2d3d",
            color:"#fff", border:"none", borderRadius:8, padding:"13px",
            fontWeight:700, fontSize:15, cursor: key.trim() ? "pointer" : "not-allowed",
            letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif", transition:"all 0.2s",
          }}>
            Salvar e Continuar →
          </button>

          {/* Instructions */}
          <div style={{ marginTop:22, padding:"16px 18px", background:"#060d14", borderRadius:10, border:"1px solid #1e2d3d" }}>
            <div style={{ color:"#4fc3f7", fontSize:11, fontWeight:700, letterSpacing:2, marginBottom:10 }}>
              🔑 COMO OBTER SUA CHAVE GRATUITA
            </div>
            <ol style={{ color:"#7a9ab8", fontSize:13, margin:0, paddingLeft:18, lineHeight:2.2 }}>
              <li>Acesse <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" style={{ color:"#4fc3f7", textDecoration:"none" }}>aistudio.google.com</a></li>
              <li>Faça login com sua conta Google</li>
              <li>Clique em <strong style={{ color:"#e2f0ff" }}>Get API Key → Create API key</strong></li>
              <li>Copie a chave e cole acima</li>
            </ol>
            <div style={{ marginTop:10, padding:"8px 12px", background:"#0d1b2a", borderRadius:6, border:"1px solid #00d68f33" }}>
              <span style={{ color:"#00d68f", fontSize:12, fontWeight:700 }}>✓ Gratuito</span>
              <span style={{ color:"#4a6a8a", fontSize:12 }}> · Sem cartão de crédito · 1.500 análises/dia</span>
            </div>
          </div>

          <div style={{ marginTop:14, color:"#2a4a6a", fontSize:11, textAlign:"center", lineHeight:1.7 }}>
            🔒 Sua chave fica salva apenas neste navegador (localStorage).<br/>
            Nunca é enviada a nenhum servidor além da API do Google.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Favorites Panel ───────────────────────────────────────────────
function FavoritesPanel({ favorites, refreshingTickers, onSelect, onRemove, onRefreshOne, onRefreshAll, onClose }) {
  const anyRefreshing = refreshingTickers.size > 0;

  if (favorites.length === 0) {
    return (
      <div style={{ padding:"32px 0", textAlign:"center" }}>
        <div style={{ fontSize:32, marginBottom:12 }}>★</div>
        <div style={{ color:"#4a6a8a", fontSize:14 }}>Nenhum favorito ainda.</div>
        <div style={{ color:"#2a4a6a", fontSize:12, marginTop:6 }}>Analise um ativo e clique em "Salvar nos Favoritos".</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:12 }}>
        <button onClick={onRefreshAll} disabled={anyRefreshing} style={{
          background: anyRefreshing ? "#1e2d3d" : "transparent",
          border:"1px solid #1e3a5a", borderRadius:8, padding:"6px 14px",
          color: anyRefreshing ? "#4a6a8a" : "#4fc3f7",
          fontSize:12, fontWeight:700, cursor: anyRefreshing ? "not-allowed" : "pointer",
          letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif",
          display:"flex", alignItems:"center", gap:6,
        }}>
          {anyRefreshing ? <><Spinner size={12}/> Atualizando...</> : <>↺ Atualizar Todos</>}
        </button>
      </div>

      {favorites.map((fav) => {
        const c  = scoreColor(fav.scores?.overall ?? 0);
        const rc = REC_COLOR[fav.recommendation] || "#888";
        const isRefreshing = refreshingTickers.has(fav.ticker);
        return (
          <div key={fav.ticker} style={{
            background:"#060d14", border:`1px solid ${isRefreshing ? "#1e3a5a" : "#1e2d3d"}`,
            borderRadius:10, padding:"14px 16px", marginBottom:10,
            display:"flex", alignItems:"center", gap:12,
            opacity: isRefreshing ? 0.7 : 1, transition:"all 0.2s",
          }}>
            <div style={{ width:44, height:44, borderRadius:"50%", border:`2px solid ${c}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              {isRefreshing ? <Spinner size={18}/> : <span style={{ color:c, fontWeight:700, fontSize:15, fontFamily:"'IBM Plex Mono',monospace" }}>{fav.scores?.overall ?? "—"}</span>}
            </div>

            <div style={{ flex:1, minWidth:0, cursor:"pointer" }} onClick={() => { if (!isRefreshing) { onSelect(fav); onClose(); } }}>
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
                return (
                  <div key={k} style={{ textAlign:"center" }}>
                    <div style={{ color:scoreColor(s), fontSize:12, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace" }}>{s}</div>
                    <div style={{ color:"#2a4a6a", fontSize:9, letterSpacing:0.5 }}>{k.slice(0,3).toUpperCase()}</div>
                  </div>
                );
              })}
            </div>

            <button onClick={(e) => { e.stopPropagation(); onRefreshOne(fav.ticker); }} disabled={isRefreshing}
              title="Atualizar" style={{ background:"none", border:"none", color: isRefreshing ? "#2a4a6a" : "#4a6a8a", fontSize:15, cursor: isRefreshing ? "not-allowed" : "pointer", padding:"4px", lineHeight:1, flexShrink:0, transition:"color 0.2s" }}
              onMouseEnter={e => { if (!isRefreshing) e.currentTarget.style.color="#4fc3f7"; }}
              onMouseLeave={e => { e.currentTarget.style.color = isRefreshing ? "#2a4a6a" : "#4a6a8a"; }}
            >↺</button>

            <button onClick={(e) => { e.stopPropagation(); onRemove(fav.ticker); }}
              title="Remover" style={{ background:"none", border:"none", color:"#2a4a6a", fontSize:18, cursor:"pointer", padding:"4px 6px", lineHeight:1, flexShrink:0, transition:"color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.color="#ff4d6d"}
              onMouseLeave={e => e.currentTarget.style.color="#2a4a6a"}
            >×</button>
          </div>
        );
      })}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────
export default function StockAnalyzer() {
  const [apiKey, setApiKey]     = useState(() => localStorage.getItem(STORAGE_KEY_APIKEY) || "");
  const [ticker, setTicker]     = useState("");
  const [loading, setLoading]   = useState(false);
  const [data, setData]         = useState(null);
  const [error, setError]       = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [showFavs, setShowFavs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_FAVS) || "[]"); } catch { return []; }
  });
  const [favSaved, setFavSaved] = useState(false);
  const [refreshingTickers, setRefreshingTickers] = useState(new Set());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_FAVS, JSON.stringify(favorites));
  }, [favorites]);

  const isFavorited = data ? favorites.some(f => f.ticker === data.ticker) : false;

  const fetchAnalysis = useCallback(async (sym) => {
    const text = await callGemini(apiKey, buildPrompt(sym));
    return parseAnalysis(text);
  }, [apiKey]);

  const analyze = async (sym_override) => {
    const sym = (sym_override || ticker).trim().toUpperCase();
    if (!sym) return;
    if (!sym_override) setTicker(sym);
    setLoading(true); setData(null); setError(""); setActiveTab("overview");
    try {
      const parsed = await fetchAnalysis(sym);
      if (parsed) setData(parsed);
      else setError("Não foi possível estruturar os dados. Tente novamente.");
    } catch(e) { setError(`Erro: ${e.message}`); }
    setLoading(false);
  };

  const refreshOne = useCallback(async (sym) => {
    setRefreshingTickers(prev => new Set([...prev, sym]));
    try {
      const parsed = await fetchAnalysis(sym);
      if (parsed) {
        setFavorites(prev => prev.map(f => f.ticker === sym ? parsed : f));
        setData(prev => prev?.ticker === sym ? parsed : prev);
      }
    } catch {}
    setRefreshingTickers(prev => { const next = new Set(prev); next.delete(sym); return next; });
  }, [fetchAnalysis]);

  const refreshAll = useCallback(async () => {
    for (const fav of favorites) await refreshOne(fav.ticker);
  }, [favorites, refreshOne]);

  const toggleFavorite = () => {
    if (!data) return;
    if (isFavorited) {
      setFavorites(prev => prev.filter(f => f.ticker !== data.ticker));
      setFavSaved(false);
    } else {
      setFavorites(prev => [data, ...prev.filter(f => f.ticker !== data.ticker)]);
      setFavSaved(true);
      setTimeout(() => setFavSaved(false), 2000);
    }
  };

  if (!apiKey) return <ApiKeySetup onSave={setApiKey} />;

  const tabs = ["overview","valuation","dividendos","risco","perspectiva"];

  return (
    <div style={{ minHeight:"100vh", background:"#060d14", color:"#e2f0ff", fontFamily:"'IBM Plex Sans','Segoe UI',sans-serif", padding:"32px 16px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=IBM+Plex+Sans:wght@300;400;600;700&display=swap');
        * { box-sizing:border-box; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:#060d14; }
        ::-webkit-scrollbar-thumb { background:#1e2d3d; border-radius:2px; }
        input:focus { outline:none; }
        @keyframes spin   { to { transform:rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes popIn  { from { transform:scale(0.97); opacity:0; } to { transform:scale(1); opacity:1; } }
      `}</style>

      <div style={{ maxWidth:780, margin:"0 auto" }}>

        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:28 }}>
          <div style={{ flex:1, textAlign:"center" }}>
            <div style={{ color:"#4fc3f7", fontSize:11, letterSpacing:4, fontFamily:"'IBM Plex Mono',monospace", marginBottom:8 }}>ANÁLISE FUNDAMENTALISTA</div>
            <h1 style={{ fontSize:32, fontWeight:700, margin:0, background:"linear-gradient(135deg,#e2f0ff,#4fc3f7)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", letterSpacing:-1 }}>
              US Stock Analyzer
            </h1>
            <p style={{ color:"#4a6a8a", marginTop:8, fontSize:14 }}>
              Powered by <span style={{ color:"#4fc3f7" }}>Google Gemini</span> · Valuation · Saúde · Dividendos · Risco
            </p>
          </div>
          <button onClick={() => setShowSettings(v => !v)} title="Configurações" style={{
            background:"none", border:"1px solid #1e2d3d", borderRadius:8, padding:"6px 10px",
            color:"#4a6a8a", cursor:"pointer", fontSize:16, flexShrink:0, transition:"all 0.2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor="#4fc3f7"; e.currentTarget.style.color="#4fc3f7"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor="#1e2d3d"; e.currentTarget.style.color="#4a6a8a"; }}
          >⚙</button>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div style={{ background:"#0d1b2a", border:"1px solid #1e3a5a", borderRadius:14, padding:"20px 24px", marginBottom:20, animation:"fadeIn 0.2s ease" }}>
            <div style={{ color:"#4fc3f7", fontSize:12, fontWeight:700, letterSpacing:2, textTransform:"uppercase", marginBottom:14 }}>⚙ Configurações</div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <div style={{ flex:1, background:"#060d14", border:"1px solid #1e3a5a", borderRadius:8, padding:"10px 14px", color:"#4a6a8a", fontSize:13, fontFamily:"'IBM Plex Mono',monospace" }}>
                Chave Gemini: {apiKey.slice(0,8)}••••••••
              </div>
              <button onClick={() => { localStorage.removeItem(STORAGE_KEY_APIKEY); setApiKey(""); setShowSettings(false); }} style={{
                background:"#ff4d6d22", border:"1px solid #ff4d6d44", borderRadius:8, padding:"10px 16px",
                color:"#ff4d6d", fontSize:12, fontWeight:700, cursor:"pointer", letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif",
              }}>
                Trocar Chave
              </button>
            </div>
            <div style={{ color:"#2a4a6a", fontSize:11, marginTop:10 }}>
              🔒 Salva apenas neste navegador. Nunca enviada a servidores além da API do Google.
            </div>
          </div>
        )}

        {/* Search + Favorites */}
        <div style={{ display:"flex", gap:8, marginBottom:20 }}>
          <div style={{ flex:1, display:"flex", gap:10, background:"#0d1b2a", border:"1px solid #1e3a5a", borderRadius:12, padding:"12px 16px" }}>
            <input
              value={ticker}
              onChange={e => setTicker(e.target.value)}
              onKeyDown={e => e.key==="Enter" && analyze()}
              placeholder="Ex: AAPL, MSFT, KO, JNJ, NVDA..."
              style={{ flex:1, background:"transparent", border:"none", color:"#e2f0ff", fontSize:18, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700, letterSpacing:2 }}
            />
            <button onClick={() => analyze()} disabled={loading || !ticker.trim()} style={{
              background: loading ? "#1e2d3d" : "linear-gradient(135deg,#1a73e8,#4fc3f7)",
              color:"#fff", border:"none", borderRadius:8, padding:"10px 24px",
              fontWeight:700, fontSize:14, cursor: loading ? "not-allowed" : "pointer",
              letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif", transition:"all 0.2s",
              display:"flex", alignItems:"center", gap:8,
            }}>
              {loading ? <><Spinner/>Analisando...</> : "Analisar →"}
            </button>
          </div>

          <button onClick={() => setShowFavs(v => !v)} style={{
            background: showFavs ? "#1e3a5a" : "#0d1b2a",
            border:`1px solid ${showFavs ? "#4fc3f7" : "#1e3a5a"}`,
            borderRadius:12, padding:"0 18px", cursor:"pointer",
            color: showFavs ? "#4fc3f7" : "#4a6a8a",
            fontSize:13, fontWeight:700, letterSpacing:1,
            fontFamily:"'IBM Plex Sans',sans-serif",
            display:"flex", alignItems:"center", gap:6, flexShrink:0, transition:"all 0.2s",
          }}>
            <span style={{ fontSize:16 }}>★</span>
            <span>Favoritos</span>
            {favorites.length > 0 && (
              <span style={{ background:"#4fc3f7", color:"#060d14", borderRadius:"50%", width:18, height:18, fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>
                {favorites.length}
              </span>
            )}
          </button>
        </div>

        {/* Favorites panel */}
        {showFavs && (
          <div style={{ background:"#0d1b2a", border:"1px solid #1e3a5a", borderRadius:14, padding:"20px", marginBottom:20, animation:"fadeIn 0.2s ease" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ color:"#4fc3f7", fontWeight:700, fontSize:13, letterSpacing:2, textTransform:"uppercase", display:"flex", alignItems:"center", gap:8 }}>
                ★ Meus Favoritos
                <span style={{ color:"#4a6a8a", fontWeight:400, fontSize:12, letterSpacing:0 }}>({favorites.length} ativo{favorites.length!==1?"s":""})</span>
              </div>
              <button onClick={() => setShowFavs(false)} style={{ background:"none", border:"none", color:"#4a6a8a", fontSize:20, cursor:"pointer", padding:4 }}>×</button>
            </div>
            <FavoritesPanel
              favorites={favorites}
              refreshingTickers={refreshingTickers}
              onSelect={(fav) => { setData(fav); setTicker(fav.ticker); setActiveTab("overview"); }}
              onRemove={(t) => setFavorites(prev => prev.filter(f => f.ticker !== t))}
              onRefreshOne={refreshOne}
              onRefreshAll={refreshAll}
              onClose={() => setShowFavs(false)}
            />
          </div>
        )}

        {error && (
          <div style={{ background:"#ff4d6d11", border:"1px solid #ff4d6d44", borderRadius:10, padding:"12px 18px", color:"#ff4d6d", marginBottom:20, fontSize:14 }}>
            ⚠ {error}
          </div>
        )}

        {loading && (
          <div style={{ textAlign:"center", padding:"56px 0" }}>
            <Spinner size={42}/>
            <div style={{ color:"#4a6a8a", fontFamily:"'IBM Plex Mono',monospace", fontSize:13, marginTop:18 }}>
              Buscando dados e calculando métricas...
            </div>
            <div style={{ color:"#2a4a6a", fontSize:11, marginTop:8 }}>Google Gemini + Google Search</div>
          </div>
        )}

        {data && (
          <div style={{ animation:"popIn 0.25s ease" }}>

            {/* Company Header */}
            <div style={{ background:"linear-gradient(135deg,#0d1b2a,#0a2236)", border:"1px solid #1e3a5a", borderRadius:14, padding:"24px 28px", marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:16 }}>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:6, flexWrap:"wrap" }}>
                  <span style={{ fontSize:28, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace", color:"#4fc3f7" }}>{data.ticker}</span>
                  {data.recommendation && (
                    <span style={{ background:(REC_COLOR[data.recommendation]||"#888")+"22", color:REC_COLOR[data.recommendation]||"#888", border:`1px solid ${(REC_COLOR[data.recommendation]||"#888")}44`, borderRadius:6, padding:"3px 12px", fontWeight:700, fontSize:12, letterSpacing:1 }}>
                      {data.recommendation}
                    </span>
                  )}
                  {data.last_updated && <span style={{ color:"#2a4a6a", fontSize:11, fontFamily:"'IBM Plex Mono',monospace" }}>{data.last_updated}</span>}
                </div>
                <div style={{ color:"#e2f0ff", fontWeight:600, fontSize:18, marginBottom:4 }}>{data.company}</div>
                <div style={{ color:"#4a6a8a", fontSize:13 }}>{data.sector} · {data.industry}</div>
                <div style={{ color:"#7a9ab8", fontSize:13, marginTop:8, maxWidth:440, lineHeight:1.5 }}>{data.description}</div>

                <button onClick={toggleFavorite} style={{
                  marginTop:14, background: isFavorited ? "#ffaa0022" : "transparent",
                  border:`1px solid ${isFavorited ? "#ffaa00" : "#1e3a5a"}`,
                  borderRadius:8, padding:"6px 16px",
                  color: isFavorited ? "#ffaa00" : "#4a6a8a",
                  fontSize:12, fontWeight:700, cursor:"pointer",
                  letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif",
                  display:"inline-flex", alignItems:"center", gap:6, transition:"all 0.2s",
                }}>
                  {favSaved ? <><span>✓</span> Salvo!</> : isFavorited ? <><span>★</span> Nos Favoritos</> : <><span>☆</span> Salvar nos Favoritos</>}
                </button>
              </div>

              <div style={{ textAlign:"right" }}>
                <div style={{ color:"#e2f0ff", fontSize:26, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace" }}>{data.price}</div>
                <div style={{ color:"#4a6a8a", fontSize:12, marginTop:2 }}>Market Cap: {data.market_cap}</div>
                {data.fair_value?.upside && (
                  <div style={{ color:data.fair_value.upside.startsWith("+") ? "#00d68f" : "#ff4d6d", fontWeight:700, fontSize:14, marginTop:6, fontFamily:"'IBM Plex Mono',monospace" }}>
                    Upside: {data.fair_value.upside}
                  </div>
                )}
                {data.metrics?.analyst_target && <div style={{ color:"#a8c0d6", fontSize:12, marginTop:4 }}>Alvo analistas: {data.metrics.analyst_target}</div>}
                {data.metrics?.analyst_consensus && <div style={{ color:"#4a6a8a", fontSize:11, marginTop:2 }}>{data.metrics.analyst_consensus}</div>}
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
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  background:"none", border:"none",
                  borderBottom: activeTab===tab ? "2px solid #4fc3f7" : "2px solid transparent",
                  color: activeTab===tab ? "#4fc3f7" : "#4a6a8a",
                  fontWeight:600, fontSize:13, padding:"8px 14px", letterSpacing:1,
                  fontFamily:"'IBM Plex Sans',sans-serif", marginBottom:-1,
                  textTransform:"capitalize", cursor:"pointer", transition:"color 0.2s", whiteSpace:"nowrap",
                }}>
                  {tab.charAt(0).toUpperCase()+tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Tab: Overview */}
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

            {/* Tab: Valuation */}
            {activeTab==="valuation" && data.metrics && (
              <div>
                <Section title="Múltiplos de Preço" icon="$">
                  {["pe","forward_pe","peg","pb","ps","price_fcf"].map(k => { const m=METRICS.find(x=>x.key===k); return <MetricRow key={k} label={m?.label} value={data.metrics[k]} desc={m?.desc}/>; })}
                </Section>
                <Section title="EV Multiples" icon="◈">
                  {["ev_ebitda","ev_fcf"].map(k => { const m=METRICS.find(x=>x.key===k); return <MetricRow key={k} label={m?.label} value={data.metrics[k]} desc={m?.desc}/>; })}
                </Section>
                <Section title="Rentabilidade & Margens" icon="◈">
                  {["roe","roic","asset_turnover","gross_margin","net_margin","fcf_yield"].map(k => { const m=METRICS.find(x=>x.key===k); return <MetricRow key={k} label={m?.label} value={data.metrics[k]} desc={m?.desc}/>; })}
                </Section>
                <Section title="Saúde Financeira" icon="♥">
                  {["debt_equity","current_ratio","interest_coverage","altman_z"].map(k => {
                    const m=METRICS.find(x=>x.key===k);
                    const az = k==="altman_z" ? (parseFloat(data.metrics[k])>=2.99?"#00d68f":parseFloat(data.metrics[k])>=1.81?"#ffaa00":"#ff4d6d") : undefined;
                    return <MetricRow key={k} label={m?.label} value={data.metrics[k]} desc={m?.desc} color={az}/>;
                  })}
                </Section>
                {data.fair_value && (
                  <Section title="Estimativa de Valor Justo" icon="◎">
                    <MetricRow label="Método" value={data.fair_value.method}/>
                    <MetricRow label="Faixa Estimada" value={data.fair_value.estimate} color="#4fc3f7"/>
                    <MetricRow label="Vs. Preço Atual" value={data.fair_value.current_vs_fair}/>
                    <MetricRow label="Potencial" value={data.fair_value.upside} color={data.fair_value.upside?.startsWith("+")?"#00d68f":"#ff4d6d"}/>
                  </Section>
                )}
              </div>
            )}

            {/* Tab: Dividendos */}
            {activeTab==="dividendos" && data.metrics && (
              <div>
                <Section title="Métricas de Dividendos" icon="◈">
                  {["dy","div_cagr_5y","div_years","payout"].map(k => { const m=METRICS.find(x=>x.key===k); return <MetricRow key={k} label={m?.label} value={data.metrics[k]} desc={m?.desc}/>; })}
                </Section>
                <Section title="Retorno Total ao Acionista" icon="↑">
                  {["buyback_yield","total_shareholder_yield"].map(k => { const m=METRICS.find(x=>x.key===k); return <MetricRow key={k} label={m?.label} value={data.metrics[k]} desc={m?.desc}/>; })}
                </Section>
                {data.dividend_history && (
                  <Section title="Histórico & Consistência" icon="★">
                    <p style={{ color:"#a8c0d6", fontSize:14, margin:0, lineHeight:1.6 }}>{data.dividend_history}</p>
                  </Section>
                )}
              </div>
            )}

            {/* Tab: Risco */}
            {activeTab==="risco" && data.metrics && (
              <div>
                <Section title="Indicadores de Risco" icon="⚠">
                  {["beta","short_interest","interest_coverage","altman_z"].map(k => {
                    const m=METRICS.find(x=>x.key===k);
                    let col;
                    if (k==="altman_z") col=parseFloat(data.metrics[k])>=2.99?"#00d68f":parseFloat(data.metrics[k])>=1.81?"#ffaa00":"#ff4d6d";
                    if (k==="beta") col=parseFloat(data.metrics[k])<1?"#00d68f":parseFloat(data.metrics[k])<1.5?"#ffaa00":"#ff4d6d";
                    return <MetricRow key={k} label={m?.label} value={data.metrics[k]} desc={m?.desc} color={col}/>;
                  })}
                </Section>
                <Section title="Expectativas de Mercado" icon="◎">
                  {["earnings_surprise","analyst_target","analyst_consensus"].map(k => { const m=METRICS.find(x=>x.key===k); return <MetricRow key={k} label={m?.label} value={data.metrics[k]} desc={m?.desc}/>; })}
                </Section>
                <Section title="Saúde do Balanço" icon="♥">
                  {["debt_equity","current_ratio"].map(k => { const m=METRICS.find(x=>x.key===k); return <MetricRow key={k} label={m?.label} value={data.metrics[k]} desc={m?.desc}/>; })}
                </Section>
              </div>
            )}

            {/* Tab: Perspectiva */}
            {activeTab==="perspectiva" && (
              <div>
                <Section title="Crescimento" icon="↑">
                  {["revenue_growth","eps_growth"].map(k => { const m=METRICS.find(x=>x.key===k); return <MetricRow key={k} label={m?.label} value={data.metrics?.[k]} desc={m?.desc}/>; })}
                </Section>
                {data.outlook && (
                  <Section title="Perspectiva de Médio/Longo Prazo" icon="◎">
                    <p style={{ color:"#a8c0d6", fontSize:14, margin:0, lineHeight:1.7 }}>{data.outlook}</p>
                  </Section>
                )}
              </div>
            )}

            <div style={{ color:"#2a4a6a", fontSize:11, textAlign:"center", marginTop:20, lineHeight:1.7 }}>
              ⚠ Esta análise é gerada por IA com fins educacionais. Não constitui recomendação de investimento.<br/>
              Sempre consulte um profissional qualificado antes de tomar decisões financeiras.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
