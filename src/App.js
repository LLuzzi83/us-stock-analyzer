import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY_FAVS   = "stock_favorites_v1";
const STORAGE_KEY_APIKEY = "anthropic_api_key";

const REC_COLOR = {
  "COMPRAR": "#00d68f",
  "MANTER":  "#4fc3f7",
  "AGUARDAR":"#ffaa00",
  "EVITAR":  "#ff4d6d",
};

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

function Spinner({ size=16 }) {
  return (
    <span style={{ display:"inline-block", width:size, height:size, border:`2px solid #1e2d3d`, borderTop:`2px solid #4fc3f7`, borderRadius:"50%", animation:"spin 0.8s linear infinite", flexShrink:0 }} />
  );
}

function parseAnalysis(text) {
  if (!text) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const fenced2 = text.match(/```\s*([\s\S]*?)\s*```/);
  if (fenced2) { try { return JSON.parse(fenced2[1]); } catch {} }
  const b1 = text.indexOf("{"), b2 = text.lastIndexOf("}");
  if (b1 !== -1 && b2 !== -1) { try { return JSON.parse(text.slice(b1, b2+1)); } catch {} }
  try { return JSON.parse(text.replace(/```json|```/g,"").trim()); } catch {}
  return null;
}

function buildPrompt(sym) {
  const today = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"short", year:"numeric" });
  return `Você é um analista fundamentalista especializado em ações americanas. Hoje é ${today}.

Analise a ação ${sym} buscando dados ATUAIS e retorne APENAS um JSON válido (sem texto fora do JSON):

{
  "ticker": "${sym}",
  "company": "nome completo",
  "sector": "setor",
  "industry": "subsetor",
  "description": "descrição do negócio em 2 linhas",
  "price": "preço atual ex: $189.50",
  "market_cap": "ex: $2.1T",
  "last_updated": "${today}",
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
    "peg": "ex: 1.8x",
    "pb": "ex: 4.2x",
    "ps": "ex: 6.1x",
    "price_fcf": "ex: 22.3x",
    "ev_ebitda": "ex: 18.4x",
    "ev_fcf": "ex: 25.1x",
    "roe": "ex: 32.5%",
    "roic": "ex: 18.2%",
    "roa": "ex: 12.1%",
    "asset_turnover": "ex: 0.85",
    "interest_coverage": "ex: 12.3x",
    "altman_z": "ex: 4.2",
    "gross_margin": "ex: 43.2%",
    "op_margin": "ex: 29.1%",
    "net_margin": "ex: 25.1%",
    "fcf_yield": "ex: 3.8%",
    "dy": "ex: 1.8%",
    "div_cagr_5y": "ex: 5.2%",
    "div_years": "ex: 12 anos",
    "buyback_yield": "ex: 2.1%",
    "total_shareholder_yield": "ex: 3.9%",
    "payout": "ex: 28%",
    "revenue_growth": "ex: +12.3%",
    "eps_growth": "ex: +18.5%",
    "earnings_surprise": "ex: +4.2% acima do consenso",
    "debt_equity": "ex: 0.45",
    "current_ratio": "ex: 1.8",
    "quick_ratio": "ex: 1.2",
    "total_debt": "ex: $110B",
    "total_cash": "ex: $65B",
    "analyst_target": "ex: $230.00",
    "analyst_low": "ex: $180.00",
    "analyst_high": "ex: $275.00",
    "analyst_consensus": "ex: 78% Buy · 18% Hold · 4% Sell",
    "analyst_count": "ex: 42",
    "beta": "ex: 1.15",
    "short_interest": "ex: 0.8%",
    "week52_high": "ex: $237.23",
    "week52_low": "ex: $164.08",
    "eps_ttm": "ex: $6.43",
    "eps_forward": "ex: $7.21",
    "revenue_ttm": "ex: $391B",
    "ex_div_date": "ex: 08/Nov/2024"
  },
  "fair_value": {
    "method": "ex: DCF + múltiplos setoriais",
    "estimate": "ex: $195–$220",
    "current_vs_fair": "ex: 8% abaixo do valor justo",
    "upside": "ex: +12%"
  },
  "strengths": ["ponto forte 1", "ponto forte 2", "ponto forte 3"],
  "risks": ["risco 1", "risco 2", "risco 3"],
  "dividend_history": "descrição da consistência histórica",
  "moat": "descrição do fosso competitivo",
  "outlook": "perspectiva para médio e longo prazo em 3 linhas",
  "recommendation": "COMPRAR",
  "recommendation_reason": "motivo em 1 linha"
}`;
}

async function callClaude(apiKey, prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Erro ${res.status}`);
  }
  const json = await res.json();
  const text = json.content
    .map(b => b.type === "text" ? b.text : "")
    .filter(Boolean)
    .join("\n");
  return text;
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
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=IBM+Plex+Sans:wght@300;400;600;700&display=swap');
        * { box-sizing:border-box; } input:focus { outline:none; }
      `}</style>
      <div style={{ maxWidth:500, width:"100%" }}>
        <div style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{ fontSize:52, marginBottom:14 }}>📈</div>
          <h1 style={{ color:"#e2f0ff", fontSize:26, fontWeight:700, margin:"0 0 8px" }}>US Stock Analyzer</h1>
          <p style={{ color:"#4a6a8a", fontSize:14, margin:0 }}>
            Análise fundamentalista com IA · Powered by Claude
          </p>
        </div>

        <div style={{ background:"#0d1b2a", border:"1px solid #1e3a5a", borderRadius:14, padding:28 }}>
          <label style={{ color:"#4fc3f7", fontSize:12, fontWeight:700, letterSpacing:2, textTransform:"uppercase", display:"block", marginBottom:10 }}>
            Chave da API Anthropic
          </label>
          <div style={{ position:"relative", marginBottom:16 }}>
            <input
              type={show ? "text" : "password"}
              value={key}
              onChange={e => { setKey(e.target.value); setError(""); }}
              onKeyDown={e => e.key === "Enter" && handleSave()}
              placeholder="sk-ant-..."
              style={{ width:"100%", background:"#060d14", border:`1px solid ${error ? "#ff4d6d" : "#1e3a5a"}`, borderRadius:8, padding:"12px 44px 12px 14px", color:"#e2f0ff", fontSize:14, fontFamily:"'IBM Plex Mono',monospace" }}
            />
            <button onClick={() => setShow(v => !v)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"#4a6a8a", cursor:"pointer", fontSize:16, padding:0 }}>
              {show ? "🙈" : "👁️"}
            </button>
          </div>
          {error && <div style={{ color:"#ff4d6d", fontSize:12, marginBottom:12 }}>⚠ {error}</div>}

          <button onClick={handleSave} disabled={!key.trim()} style={{ width:"100%", background: key.trim() ? "linear-gradient(135deg,#7c3aed,#a78bfa)" : "#1e2d3d", color:"#fff", border:"none", borderRadius:8, padding:"13px", fontWeight:700, fontSize:15, cursor: key.trim() ? "pointer" : "not-allowed", letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif", transition:"all 0.2s" }}>
            Salvar e Continuar →
          </button>

          <div style={{ marginTop:20, padding:"16px 18px", background:"#060d14", borderRadius:10, border:"1px solid #1e2d3d" }}>
            <div style={{ color:"#a78bfa", fontSize:11, fontWeight:700, letterSpacing:2, marginBottom:10 }}>🔑 COMO OBTER SUA CHAVE</div>
            <ol style={{ color:"#7a9ab8", fontSize:13, margin:0, paddingLeft:18, lineHeight:2.2 }}>
              <li>Acesse <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ color:"#a78bfa" }}>console.anthropic.com</a></li>
              <li>Crie uma conta (US$ 5 de crédito grátis)</li>
              <li>Vá em <strong style={{ color:"#e2f0ff" }}>API Keys → Create Key</strong></li>
              <li>Copie e cole acima</li>
            </ol>
            <div style={{ marginTop:10, padding:"8px 12px", background:"#0d1b2a", borderRadius:6, border:"1px solid #a78bfa33" }}>
              <span style={{ color:"#a78bfa", fontSize:12, fontWeight:700 }}>~US$ 0,01 por análise</span>
              <span style={{ color:"#4a6a8a", fontSize:12 }}> · Web search em tempo real · Dados sempre atualizados</span>
            </div>
          </div>

          <div style={{ marginTop:14, color:"#2a4a6a", fontSize:11, textAlign:"center", lineHeight:1.7 }}>
            🔒 Sua chave fica salva apenas neste navegador.<br/>
            Nunca é enviada a nenhum servidor além da API da Anthropic.
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
        const c  = scoreColor(fav.scores?.overall ?? 0);
        const rc = REC_COLOR[fav.recommendation] || "#888";
        const isRefreshing = refreshingTickers.has(fav.ticker);
        return (
          <div key={fav.ticker} style={{ background:"#060d14", border:`1px solid ${isRefreshing?"#1e3a5a":"#1e2d3d"}`, borderRadius:10, padding:"14px 16px", marginBottom:10, display:"flex", alignItems:"center", gap:12, opacity:isRefreshing?0.7:1, transition:"all 0.2s" }}>
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

  const fetchAnalysis = useCallback(async (sym) => {
    const text   = await callClaude(apiKey, buildPrompt(sym));
    const parsed = parseAnalysis(text);
    if (!parsed) throw new Error("Não foi possível estruturar os dados. Tente novamente.");
    return parsed;
  }, [apiKey]);

  const analyze = async (sym_override) => {
    const sym = (sym_override || ticker).trim().toUpperCase();
    if (!sym) return;
    if (!sym_override) setTicker(sym);
    setLoading(true); setData(null); setError(""); setActiveTab("overview");
    try {
      const result = await fetchAnalysis(sym);
      setData(result);
    } catch(e) { setError(`Erro: ${e.message}`); }
    setLoading(false);
  };

  const refreshOne = useCallback(async (sym) => {
    setRefreshingTickers(prev => new Set([...prev, sym]));
    try {
      const result = await fetchAnalysis(sym);
      setFavorites(prev => prev.map(f => f.ticker === sym ? result : f));
      setData(prev => prev?.ticker === sym ? result : prev);
    } catch {}
    setRefreshingTickers(prev => { const next = new Set(prev); next.delete(sym); return next; });
  }, [fetchAnalysis]);

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
            <div style={{ color:"#a78bfa", fontSize:11, letterSpacing:4, fontFamily:"'IBM Plex Mono',monospace", marginBottom:8 }}>ANÁLISE FUNDAMENTALISTA</div>
            <h1 style={{ fontSize:32, fontWeight:700, margin:0, background:"linear-gradient(135deg,#e2f0ff,#a78bfa)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", letterSpacing:-1 }}>
              US Stock Analyzer
            </h1>
            <p style={{ color:"#4a6a8a", marginTop:8, fontSize:13 }}>
              <span style={{ color:"#a78bfa" }}>●</span> Powered by Claude · Web Search em tempo real
            </p>
          </div>
          <button onClick={()=>setShowSettings(v=>!v)} title="Configurações"
            style={{ background:"none", border:"1px solid #1e2d3d", borderRadius:8, padding:"6px 10px", color:"#4a6a8a", cursor:"pointer", fontSize:16, flexShrink:0, transition:"all 0.2s" }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="#a78bfa";e.currentTarget.style.color="#a78bfa";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="#1e2d3d";e.currentTarget.style.color="#4a6a8a";}}
          >⚙</button>
        </div>

        {/* Settings */}
        {showSettings && (
          <div style={{ background:"#0d1b2a", border:"1px solid #1e3a5a", borderRadius:14, padding:"20px 24px", marginBottom:20, animation:"fadeIn 0.2s ease" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ color:"#a78bfa", fontSize:12, fontWeight:700, letterSpacing:2, textTransform:"uppercase" }}>⚙ Configurações</div>
              <button onClick={()=>setShowSettings(false)} style={{ background:"none", border:"none", color:"#4a6a8a", fontSize:20, cursor:"pointer" }}>×</button>
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <div style={{ flex:1, background:"#060d14", border:"1px solid #1e2d3d", borderRadius:8, padding:"10px 14px", color:"#4a6a8a", fontSize:13, fontFamily:"'IBM Plex Mono',monospace" }}>
                Chave Anthropic: {apiKey.slice(0,12)}••••••••
              </div>
              <button onClick={()=>{ localStorage.removeItem(STORAGE_KEY_APIKEY); setApiKey(""); setShowSettings(false); }}
                style={{ background:"#ff4d6d22", border:"1px solid #ff4d6d44", borderRadius:8, padding:"10px 16px", color:"#ff4d6d", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"'IBM Plex Sans',sans-serif", whiteSpace:"nowrap" }}>
                Trocar Chave
              </button>
            </div>
            <div style={{ color:"#2a4a6a", fontSize:11, marginTop:10 }}>
              🔒 Salva apenas neste navegador. Nunca enviada a terceiros além da API da Anthropic.
            </div>
          </div>
        )}

        {/* Search */}
        <div style={{ display:"flex", gap:8, marginBottom:20 }}>
          <div style={{ flex:1, display:"flex", gap:10, background:"#0d1b2a", border:"1px solid #1e3a5a", borderRadius:12, padding:"12px 16px" }}>
            <input value={ticker} onChange={e=>setTicker(e.target.value)} onKeyDown={e=>e.key==="Enter"&&analyze()}
              placeholder="Ex: AAPL, MSFT, KO, JNJ, NVDA..."
              style={{ flex:1, background:"transparent", border:"none", color:"#e2f0ff", fontSize:18, fontFamily:"'IBM Plex Mono',monospace", fontWeight:700, letterSpacing:2 }}/>
            <button onClick={()=>analyze()} disabled={loading||!ticker.trim()} style={{ background:loading?"#1e2d3d":"linear-gradient(135deg,#7c3aed,#a78bfa)", color:"#fff", border:"none", borderRadius:8, padding:"10px 24px", fontWeight:700, fontSize:14, cursor:loading?"not-allowed":"pointer", letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif", transition:"all 0.2s", display:"flex", alignItems:"center", gap:8 }}>
              {loading ? <><Spinner/>Analisando...</> : "Analisar →"}
            </button>
          </div>
          <button onClick={()=>setShowFavs(v=>!v)} style={{ background:showFavs?"#1e3a5a":"#0d1b2a", border:`1px solid ${showFavs?"#a78bfa":"#1e3a5a"}`, borderRadius:12, padding:"0 18px", cursor:"pointer", color:showFavs?"#a78bfa":"#4a6a8a", fontSize:13, fontWeight:700, letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif", display:"flex", alignItems:"center", gap:6, flexShrink:0, transition:"all 0.2s" }}>
            <span style={{ fontSize:16 }}>★</span><span>Favoritos</span>
            {favorites.length > 0 && <span style={{ background:"#a78bfa", color:"#060d14", borderRadius:"50%", width:18, height:18, fontSize:10, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>{favorites.length}</span>}
          </button>
        </div>

        {/* Favorites */}
        {showFavs && (
          <div style={{ background:"#0d1b2a", border:"1px solid #1e3a5a", borderRadius:14, padding:"20px", marginBottom:20, animation:"fadeIn 0.2s ease" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ color:"#a78bfa", fontWeight:700, fontSize:13, letterSpacing:2, textTransform:"uppercase", display:"flex", alignItems:"center", gap:8 }}>
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
            <div style={{ color:"#a78bfa", fontFamily:"'IBM Plex Mono',monospace", fontSize:13, marginTop:18 }}>
              Buscando dados e calculando métricas...
            </div>
            <div style={{ color:"#2a4a6a", fontSize:11, marginTop:8 }}>Claude · Web Search em tempo real</div>
          </div>
        )}

        {data && (
          <div style={{ animation:"popIn 0.25s ease" }}>
            {/* Company Header */}
            <div style={{ background:"linear-gradient(135deg,#0d1b2a,#0a2236)", border:"1px solid #1e3a5a", borderRadius:14, padding:"24px 28px", marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:16 }}>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:6, flexWrap:"wrap" }}>
                  <span style={{ fontSize:28, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace", color:"#a78bfa" }}>{data.ticker}</span>
                  {data.recommendation && (
                    <span style={{ background:(REC_COLOR[data.recommendation]||"#888")+"22", color:REC_COLOR[data.recommendation]||"#888", border:`1px solid ${(REC_COLOR[data.recommendation]||"#888")}44`, borderRadius:6, padding:"3px 12px", fontWeight:700, fontSize:12, letterSpacing:1 }}>{data.recommendation}</span>
                  )}
                  {data.last_updated && <span style={{ color:"#2a4a6a", fontSize:11, fontFamily:"'IBM Plex Mono',monospace" }}>· {data.last_updated}</span>}
                </div>
                <div style={{ color:"#e2f0ff", fontWeight:600, fontSize:18, marginBottom:4 }}>{data.company}</div>
                <div style={{ color:"#4a6a8a", fontSize:13 }}>{data.sector} · {data.industry}</div>
                <div style={{ color:"#7a9ab8", fontSize:13, marginTop:8, maxWidth:440, lineHeight:1.5 }}>{data.description}</div>
                <button onClick={toggleFavorite} style={{ marginTop:14, background:isFavorited?"#ffaa0022":"transparent", border:`1px solid ${isFavorited?"#ffaa00":"#1e3a5a"}`, borderRadius:8, padding:"6px 16px", color:isFavorited?"#ffaa00":"#4a6a8a", fontSize:12, fontWeight:700, cursor:"pointer", letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif", display:"inline-flex", alignItems:"center", gap:6, transition:"all 0.2s" }}>
                  {favSaved ? <><span>✓</span>Salvo!</> : isFavorited ? <><span>★</span>Nos Favoritos</> : <><span>☆</span>Salvar nos Favoritos</>}
                </button>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ color:"#e2f0ff", fontSize:28, fontWeight:700, fontFamily:"'IBM Plex Mono',monospace" }}>{data.price}</div>
                <div style={{ color:"#4a6a8a", fontSize:12, marginTop:2 }}>Market Cap: {data.market_cap}</div>
                {m.week52_high && <div style={{ color:"#4a6a8a", fontSize:11, marginTop:2 }}>52w: {m.week52_low} – {m.week52_high}</div>}
                {data.fair_value?.upside && (
                  <div style={{ color:data.fair_value.upside.startsWith("+")?"#00d68f":"#ff4d6d", fontWeight:700, fontSize:14, marginTop:6, fontFamily:"'IBM Plex Mono',monospace" }}>
                    Upside: {data.fair_value.upside}
                  </div>
                )}
                {m.analyst_target && <div style={{ color:"#a8c0d6", fontSize:12, marginTop:4 }}>Alvo analistas: {m.analyst_target}</div>}
                {m.analyst_consensus && <div style={{ color:"#4a6a8a", fontSize:11, marginTop:2 }}>{m.analyst_consensus}</div>}
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
                <button key={tab} onClick={()=>setActiveTab(tab)} style={{ background:"none", border:"none", borderBottom:activeTab===tab?"2px solid #a78bfa":"2px solid transparent", color:activeTab===tab?"#a78bfa":"#4a6a8a", fontWeight:600, fontSize:13, padding:"8px 14px", letterSpacing:1, fontFamily:"'IBM Plex Sans',sans-serif", marginBottom:-1, textTransform:"capitalize", cursor:"pointer", whiteSpace:"nowrap" }}>
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
                  <MetricRow label="P/L (P/E)"        value={m.pe}          desc="Preço / Lucro TTM"/>
                  <MetricRow label="Forward P/E"      value={m.forward_pe}  desc="P/E estimado próx. 12m"/>
                  <MetricRow label="PEG Ratio"        value={m.peg}         desc="P/E ÷ Crescimento"/>
                  <MetricRow label="P/VP (P/B)"       value={m.pb}          desc="Preço / Valor Patrimonial"/>
                  <MetricRow label="P/S"              value={m.ps}          desc="Preço / Receita"/>
                  <MetricRow label="P/FCF"            value={m.price_fcf}   desc="Preço / Fluxo de Caixa Livre"/>
                  <MetricRow label="EV/EBITDA"        value={m.ev_ebitda}   desc="Enterprise Value / EBITDA"/>
                  <MetricRow label="EV/FCF"           value={m.ev_fcf}      desc="Enterprise Value / FCF"/>
                </Section>
                <Section title="Rentabilidade & Margens" icon="◈">
                  <MetricRow label="ROE"              value={m.roe}         desc="Retorno sobre Patrimônio"/>
                  <MetricRow label="ROIC"             value={m.roic}        desc="Retorno sobre Capital Investido"/>
                  <MetricRow label="ROA"              value={m.roa}         desc="Retorno sobre Ativos"/>
                  <MetricRow label="Margem Bruta"     value={m.gross_margin}/>
                  <MetricRow label="Margem Operacional" value={m.op_margin}/>
                  <MetricRow label="Margem Líquida"   value={m.net_margin}/>
                  <MetricRow label="FCF Yield"        value={m.fcf_yield}/>
                  <MetricRow label="Asset Turnover"   value={m.asset_turnover} desc="Eficiência no uso dos ativos"/>
                </Section>
                <Section title="Saúde Financeira" icon="♥">
                  <MetricRow label="Dívida/Patrimônio"   value={m.debt_equity}       desc="Alavancagem"/>
                  <MetricRow label="Liquidez Corrente"   value={m.current_ratio}/>
                  <MetricRow label="Liquidez Rápida"     value={m.quick_ratio}/>
                  <MetricRow label="Interest Coverage"   value={m.interest_coverage} desc="EBIT / Juros"/>
                  <MetricRow label="Altman Z-Score"      value={m.altman_z}          desc=">2.99 seguro"
                    color={m.altman_z && m.altman_z!=="N/A" ? (parseFloat(m.altman_z)>=2.99?"#00d68f":parseFloat(m.altman_z)>=1.81?"#ffaa00":"#ff4d6d") : undefined}/>
                  <MetricRow label="Dívida Total"        value={m.total_debt}/>
                  <MetricRow label="Caixa Total"         value={m.total_cash}/>
                </Section>
                {data.fair_value && (
                  <Section title="Estimativa de Valor Justo" icon="◎">
                    <MetricRow label="Método"          value={data.fair_value.method}/>
                    <MetricRow label="Faixa Estimada"  value={data.fair_value.estimate}  color="#a78bfa"/>
                    <MetricRow label="Vs. Preço Atual" value={data.fair_value.current_vs_fair}/>
                    <MetricRow label="Potencial"       value={data.fair_value.upside} color={data.fair_value.upside?.startsWith("+")?"#00d68f":"#ff4d6d"}/>
                  </Section>
                )}
              </div>
            )}

            {/* Dividendos */}
            {activeTab==="dividendos" && (
              <div>
                <Section title="Métricas de Dividendos" icon="◈">
                  <MetricRow label="Dividend Yield"       value={m.dy}           desc="Rendimento anual"/>
                  <MetricRow label="CAGR Div. 5 anos"     value={m.div_cagr_5y}  desc="Crescimento anual composto"/>
                  <MetricRow label="Anos Consecutivos"    value={m.div_years}    desc="Anos crescendo dividendo"/>
                  <MetricRow label="Payout Ratio"         value={m.payout}       desc="% do lucro distribuído"/>
                  <MetricRow label="Ex-Dividend Date"     value={m.ex_div_date}/>
                </Section>
                <Section title="Retorno Total ao Acionista" icon="↑">
                  <MetricRow label="Buyback Yield"        value={m.buyback_yield}           desc="Recompra / Market Cap"/>
                  <MetricRow label="Total Shareholder Yield" value={m.total_shareholder_yield} desc="DY + Buyback Yield"/>
                  <MetricRow label="EPS TTM"              value={m.eps_ttm}/>
                  <MetricRow label="EPS Forward"          value={m.eps_forward}/>
                </Section>
                {data.dividend_history && (
                  <Section title="Histórico & Consistência" icon="★">
                    <p style={{ color:"#a8c0d6", fontSize:14, margin:0, lineHeight:1.6 }}>{data.dividend_history}</p>
                  </Section>
                )}
              </div>
            )}

            {/* Risco */}
            {activeTab==="risco" && (
              <div>
                <Section title="Indicadores de Risco" icon="⚠">
                  <MetricRow label="Beta"            value={m.beta}          desc="Volatilidade vs S&P 500"
                    color={m.beta && m.beta!=="N/A" ? (parseFloat(m.beta)<1?"#00d68f":parseFloat(m.beta)<1.5?"#ffaa00":"#ff4d6d") : undefined}/>
                  <MetricRow label="Short Interest"  value={m.short_interest} desc="% ações vendidas a descoberto"/>
                  <MetricRow label="Altman Z-Score"  value={m.altman_z}      desc=">2.99 zona segura"
                    color={m.altman_z && m.altman_z!=="N/A" ? (parseFloat(m.altman_z)>=2.99?"#00d68f":parseFloat(m.altman_z)>=1.81?"#ffaa00":"#ff4d6d") : undefined}/>
                  <MetricRow label="Interest Coverage" value={m.interest_coverage} desc="Capacidade de pagar juros"/>
                  <MetricRow label="Dívida/Patrimônio" value={m.debt_equity}/>
                </Section>
                <Section title="Expectativas de Mercado" icon="◎">
                  <MetricRow label="Earnings Surprise"    value={m.earnings_surprise}  desc="Resultado vs consenso"/>
                  <MetricRow label="Alvo Analistas"       value={m.analyst_target}/>
                  <MetricRow label="Alvo Mínimo"          value={m.analyst_low}/>
                  <MetricRow label="Alvo Máximo"          value={m.analyst_high}/>
                  <MetricRow label="Consenso"             value={m.analyst_consensus}/>
                  <MetricRow label="Nº Analistas"         value={m.analyst_count}/>
                </Section>
              </div>
            )}

            {/* Perspectiva */}
            {activeTab==="perspectiva" && (
              <div>
                <Section title="Crescimento" icon="↑">
                  <MetricRow label="Crescimento Receita" value={m.revenue_growth}  desc="YoY"/>
                  <MetricRow label="Crescimento EPS"     value={m.eps_growth}      desc="YoY"/>
                  <MetricRow label="Receita TTM"         value={m.revenue_ttm}/>
                  <MetricRow label="EPS TTM"             value={m.eps_ttm}/>
                  <MetricRow label="EPS Forward"         value={m.eps_forward}/>
                </Section>
                {data.outlook && (
                  <Section title="Perspectiva de Médio/Longo Prazo" icon="◎">
                    <p style={{ color:"#a8c0d6", fontSize:14, margin:0, lineHeight:1.7 }}>{data.outlook}</p>
                  </Section>
                )}
              </div>
            )}

            <div style={{ color:"#2a4a6a", fontSize:11, textAlign:"center", marginTop:20, lineHeight:1.7 }}>
              Análise gerada por Claude com Web Search em tempo real.<br/>
              ⚠ Fins educacionais apenas. Não constitui recomendação de investimento.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
