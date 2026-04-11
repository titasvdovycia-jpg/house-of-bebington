// FLASH ENGINE v2.9.7 Stable - GLOBAL RESILIENCE WRAPPER
window.onerror = function(msg, url, line, col, error) {
    const overlay = document.getElementById('flash-error-overlay');
    const statusText = document.getElementById('error-message-text');
    if (overlay && statusText) {
        overlay.style.display = 'block';
        statusText.innerHTML = `ERROR: ${msg}<br><br>Source: ${url.split('/').pop()}<br>Line: ${line}`;
    }
};

console.log("⚡ [FLASH ENGINE] v2.9.7 Stable: Online & Initializing...");

const FIXED_STAKE = 10; // Fixed baseline for all calculations

// Arbitrage Math Utility (Using European Decimal Odds)
function calculateArbitrage(legs) {
    let totalProb = 0;
    legs.forEach(leg => {
        totalProb += (1 / leg.odds);
    });
    const profitMargin = (1 - totalProb) * 100;
    return { isArb: totalProb < 1, margin: profitMargin, totalProb: totalProb };
}

function calculateStakes(totalProb, legs, strategy = 'arb') {
    let fractions = [];
    if (strategy === 'arb') {
        fractions = legs.map(leg => ((1 / leg.odds) / totalProb));
    } else if (strategy === 'under') {
        const sorted = [...legs].sort((a, b) => b.odds - a.odds);
        const longshot = sorted[0];
        fractions = legs.map(leg => leg.bookmaker === longshot.bookmaker ? (1 / longshot.odds) : (1 - (1 / longshot.odds)));
    }

    const bottlenecks = [];
    let isZeroBalance = false;

    legs.forEach((leg, idx) => {
        const cb = cleanBookie(leg.bookmaker);
        const balance = bookieBalances[cb] || 0;
        const required = FIXED_STAKE * fractions[idx];
        if (balance < required) {
            isZeroBalance = true;
            bottlenecks.push({ name: cb.toUpperCase(), needed: required - balance });
        }
    });

    return {
        isZeroBalance,
        bottlenecks,
        idealInvestment: FIXED_STAKE,
        stakedLegs: legs.map((leg, idx) => ({
            ...leg,
            actualStake: FIXED_STAKE * fractions[idx],
            idealStake: FIXED_STAKE * fractions[idx]
        }))
    };
}

function calculateKelly(match) {
    const avgProbTotal = match.totalProb;
    return match.legs.map(leg => {
        const b = leg.odds - 1;
        const p = (1 / leg.odds) / avgProbTotal;
        const q = 1 - p;
        const f = (b * p - q) / b;
        const suggestedStake = Math.max(0, f * getGlobalBankroll().total * 0.1); 
        return { ...leg, kellyStake: suggestedStake, kellyPercent: (f * 100).toFixed(1) };
    });
}

const formatCurrency = (val) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(val);

function formatOdds(val) {
    const format = localStorage.getItem('odds_format') || 'decimal';
    if (format === 'fractional') {
        const d = val - 1;
        const tolerance = 1.0E-6;
        let h = 1, k = 0, h2 = 0, k2 = 1, b = d;
        do {
            let a = Math.floor(b);
            let aux = h; h = a * h + h2; h2 = aux;
            aux = k; k = a * k + k2; k2 = aux;
            b = 1 / (b - a);
        } while (Math.abs(d - h / k) > d * tolerance);
        if (k === 1) return `${h}/1`;
        return `${h}/${k}`;
    }
    return val.toFixed(2);
}

let systemBlacklist = JSON.parse(localStorage.getItem('arb_blacklist')) || ['betfair'];

const BOOKIE_SEARCH_URLS = {
    '888sport': 'https://www.888sport.com/search?q=', 'william hill': 'https://sports.williamhill.com/betting/en-gb/search?q=',
    'paddy power': 'https://www.paddypower.com/search?q=', 'sky bet': 'https://m.skybet.com/search?q=',
    'ladbrokes': 'https://sports.ladbrokes.com/search?q=', 'coral': 'https://sports.coral.co.uk/search?q=',
    'unibet': 'https://www.unibet.co.uk/search?q=', 'betfred': 'https://www.betfred.com/sports/search?q=',
    'bet victor': 'https://www.betvictor.com/en-gb/sports/all/search?q=', 'smarkets': 'https://smarkets.com/search?query=',
    'matchbook': 'https://www.matchbook.com/search?q=', 'boylesports': 'https://www.boylesports.com/sports/search?q=',
    'betway': 'https://betway.com/en-gb/sports/all/search?q=', 'grosvenor': 'https://www.grosvenorcasinos.com/sport#search/query=',
    'livescore': 'https://www.livescorebet.com/uk/search?q=', 'virgin': 'https://www.virginbet.com/uk/search?q=',
    '10bet': 'https://www.10bet.co.uk/search?q=', 'spreadex': 'https://www.spreadex.com/sports/search?q=',
    'kwiff': 'https://kwiff.com/search?q=', 'leovegas': 'https://www.leovegas.com/en-gb/sport#search/query=',
    'mr green': 'https://www.mrgreen.com/en-gb/betting#search/query=', 'casumo': 'https://www.casumo.com/en-gb/sports#search/'
};

let bookieBalances = JSON.parse(localStorage.getItem('arb_bookie_balances')) || {};
let apiKeys = (localStorage.getItem('arb_api_key') || '6cbd5867fac1c7ea342a271600898dd9').split(',').map(s => s.trim());
let currentApiKeyIndex = 0;
let tokenUsageLog = JSON.parse(localStorage.getItem('arb_token_usage_log')) || [];
let arbArchive = JSON.parse(localStorage.getItem('arb_archive')) || [];
let betHistory = JSON.parse(localStorage.getItem('arb_bet_history')) || [];

let matches = [];
let loadedMatches = [];
let autoScanInterval = null;

function recordTokenUsage() {
    tokenUsageLog.push(Date.now());
    localStorage.setItem('arb_token_usage_log', JSON.stringify(tokenUsageLog));
    updateUsageStats();
}

function updateUsageStats() {
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    const thirtyDayUsage = tokenUsageLog.filter(t => t > thirtyDaysAgo).length;
    if (DOM.actualUsageInfo) DOM.actualUsageInfo.innerText = `Total: ${tokenUsageLog.length} | 31-day: ${thirtyDayUsage}`;
}

const BOOKIE_REGIONS = {
    '888sport': 'UK', 'william hill': 'UK', 'paddy power': 'UK', 'sky bet': 'UK', 'ladbrokes': 'UK', 'coral': 'UK', 'unibet': 'UK', 'betfred': 'UK', 'bet victor': 'UK', 'smarkets': 'UK', 'matchbook': 'UK', 'boylesports': 'UK', 'betway': 'UK', 'grosvenor': 'UK', 'livescore': 'UK', 'virgin': 'UK', '10bet': 'UK', 'spreadex': 'UK', 'kwiff': 'UK', 'coolbet': 'EU', 'betclic': 'EU', 'leovegas': 'EU', 'mr green': 'EU', 'casumo': 'EU'
};

function getGlobalBankroll() {
    let available = Object.values(bookieBalances).reduce((sum, val) => sum + val, 0);
    let locked = betHistory.filter(b => b.status === 'pending').reduce((sum, b) => sum + b.totalStake, 0);
    return { available, locked, total: available + locked };
}

const SPORT_CONFIG = [
    { key: 'basketball_nba', name: 'NBA (Basketball)' }, { key: 'basketball_euroleague', name: 'EuroLeague' }, { key: 'basketball_ncaab', name: 'NCAAB (College)' }, { key: 'soccer_epl', name: 'Premier League' }, { key: 'soccer_uefa_champs_league', name: 'Champions League' }, { key: 'tennis_atp_monte_carlo_masters', name: 'ATP Tennis' }, { key: 'mma_mixed_martial_arts', name: 'UFC (MMA)' }, { key: 'cricket_ipl', name: 'IPL (Cricket)' }, { key: 'baseball_mlb', name: 'MLB (Baseball)' }, { key: 'icehockey_nhl', name: 'NHL (Hockey)' }
];

const DOM = {
    actionCenter: document.getElementById('action-center'), arbFeed: document.getElementById('arb-feed'), globalBankroll: document.getElementById('global-bankroll'), bankrollAvailable: document.getElementById('bankroll-available'), bankrollLocked: document.getElementById('bankroll-locked'), bankrollGlobal: document.getElementById('bankroll-global'), bookieBalancesGrid: document.getElementById('bookie-balances-grid'), blacklistInput: document.getElementById('blacklist-input'), addBlacklistBtn: document.getElementById('add-blacklist-btn'), blacklistTags: document.getElementById('blacklist-tags'), autoSettleBtn: document.getElementById('auto-settle-btn'), autoSettleStatus: document.getElementById('auto-settle-status'), profitChart: document.getElementById('profitChart'), activeArbsCount: document.getElementById('active-arbs-count'), bestMargin: document.getElementById('best-margin'), refreshBtn: document.getElementById('refresh-btn'), statusText: document.getElementById('status-text'), autoScanToggle: document.getElementById('auto-scan-toggle'), navDashboard: document.getElementById('nav-dashboard'), navPortfolio: document.getElementById('nav-portfolio'), navBankroll: document.getElementById('nav-bankroll'), navOpportunities: document.getElementById('nav-opportunities'), navSettings: document.getElementById('nav-settings'), viewDashboard: document.getElementById('view-dashboard'), viewPortfolio: document.getElementById('view-portfolio'), viewBankroll: document.getElementById('view-bankroll'), viewOpportunities: document.getElementById('view-opportunities'), viewSettings: document.getElementById('view-settings'), portTotalProfit: document.getElementById('port-total-profit'), portRoi: document.getElementById('port-roi'), portActiveBets: document.getElementById('port-active-bets'), betHistoryTable: document.getElementById('bet-history-table'), apiKeyInput: document.getElementById('api-key-input'), oddsFormatSelect: document.getElementById('odds-format-select'), tgTokenInput: document.getElementById('tg-token'), tgChatIdInput: document.getElementById('tg-chat-id'), findIdBtn: document.getElementById('find-id-btn'), findIdStatus: document.getElementById('find-id-status'), saveSettingsBtn: document.getElementById('save-settings-btn'), sportsGrid: document.getElementById('sports-selection-grid'), healthStatusText: document.getElementById('health-status-text'), healthProgress: document.getElementById('health-progress'), tokenUsageInfo: document.getElementById('token-usage-info'), actualUsageInfo: document.getElementById('actual-usage-info'), masterResetBtn: document.getElementById('master-reset-btn'), rebalanceSuggestions: document.getElementById('rebalance-suggestions')
};

async function findChatId() {
    let box1 = DOM.tgTokenInput.value.trim(); let box2 = DOM.tgChatIdInput.value.trim();
    let combined = (box1 + ":" + box2).replace(/[^a-zA-Z0-9:\-_]/g, '');
    if (!combined.includes(':')) combined = (box2 + ":" + box1).replace(/[^a-zA-Z0-9:\-_]/g, '');
    let testToken = combined.length > 20 ? combined : tgToken;
    DOM.findIdStatus.innerText = "Verifying...";
    try {
        const meRes = await fetch(`https://api.telegram.org/bot${testToken}/getMe`);
        const meData = await meRes.json();
        if (!meData.ok) { DOM.findIdStatus.innerText = "Error: Invalid Token!"; return; }
        DOM.findIdStatus.innerText = `Connected to @${meData.result.username}. Send text now!`;
        const res = await fetch(`https://api.telegram.org/bot${testToken}/getUpdates`);
        const data = await res.json();
        if (data.ok && data.result.length > 0) {
            const lastMsg = data.result[data.result.length - 1];
            tgToken = testToken; tgChatId = lastMsg.message.from.id.toString();
            DOM.tgTokenInput.value = tgToken; DOM.tgChatIdInput.value = tgChatId;
            localStorage.setItem('tg_bot_token', tgToken); localStorage.setItem('tg_chat_id', tgChatId);
            DOM.findIdStatus.innerText = "SUCCESS! Saved.";
        }
    } catch (e) { DOM.findIdStatus.innerText = "Error: Connection failed."; }
}

async function sendTelegramReport(topMatches) {
    if (!tgToken || !tgChatId) return;
    let reportText = `🏆 *Top 3 Report*\n\n`;
    topMatches.forEach((match, i) => { reportText += `${match.isArb ? '🚨 ' : '📊 '}#${i+1}: ${match.matchup}\nMargin: ${match.margin.toFixed(2)}%\n\n`; });
    fetch(`https://api.telegram.org/bot${tgToken}/sendMessage?chat_id=${tgChatId}&text=${encodeURIComponent(reportText)}&parse_mode=Markdown`).catch(e => console.error(e));
}

function cleanBookie(name) {
    let clean = name.toLowerCase().split('(')[0].trim();
    const map = { 'betfair': 'betfair', 'william hill': 'william hill', 'paddy power': 'paddy power', 'sky bet': 'sky bet', 'grosvenor': 'grosvenor', 'livescore': 'livescore', 'virgin': 'virgin', 'smarkets': 'smarkets', 'matchbook': 'matchbook', 'casumo': 'casumo' };
    for (const key in map) { if (clean.includes(key)) return map[key]; }
    return clean;
}

async function fetchLiveArbs() {
    if (apiKeys.length === 0 || !apiKeys[0]) { alert("Please set API Key!"); return; }
    DOM.refreshBtn.innerText = "Scanning..."; DOM.statusText.innerHTML = 'Scanning...';
    
    try {
        const selectedSports = Array.from(document.querySelectorAll('.sport-checkbox:checked')).map(cb => cb.value);
        if (selectedSports.length === 0) throw new Error("No sports selected!");
        
        let success = false;
        let results = [];
        
        for (let i = 0; i < apiKeys.length; i++) {
            const currentKey = apiKeys[currentApiKeyIndex];
            try {
                const queries = selectedSports.map(s => {
                    const markets = 'h2h,totals,spreads';
                    return fetch(`https://api.the-odds-api.com/v4/sports/${s}/odds/?apiKey=${currentKey}&regions=uk,eu&markets=${markets}&oddsFormat=decimal`).then(async r => {
                        if (r.status === 401 || r.status === 429) throw { status: r.status };
                        recordTokenUsage();
                        return r.json();
                    });
                });
                results = await Promise.all(queries);
                success = true;
                break;
            } catch (err) {
                if (err.status === 401 || err.status === 429) {
                    currentApiKeyIndex = (currentApiKeyIndex + 1) % apiKeys.length;
                    console.warn(`API Key ${currentKey} failed. Retrying with next key...`);
                } else {
                    throw err;
                }
            }
        }

        if (!success) throw new Error("All API keys failed or reached limits.");

        const dedupedMap = new Map();
        results.flat().forEach(game => {
            if (!dedupedMap.has(game.id)) dedupedMap.set(game.id, game);
            else {
                game.bookmakers.forEach(b => {
                    const existingBookie = dedupedMap.get(game.id).bookmakers.find(eb => eb.title === b.title);
                    if (!existingBookie) dedupedMap.get(game.id).bookmakers.push(b);
                    else {
                        // Merge markets if they are different
                        b.markets.forEach(m => {
                            if (!existingBookie.markets.some(em => em.key === m.key)) existingBookie.markets.push(m);
                        });
                    }
                });
            }
        });

        matches = [];
        dedupedMap.forEach(game => {
            game.bookmakers = game.bookmakers.filter(b => !systemBlacklist.some(black => b.title.toLowerCase().includes(black.toLowerCase())));
            
            // Handle multiple market types
            const marketKeys = ['h2h', 'totals', 'spreads'];
            marketKeys.forEach(mKey => {
                if (mKey === 'h2h') {
                    const globalBest = {};
                    game.bookmakers.forEach(b => {
                        const market = b.markets.find(m => m.key === mKey); if (!market) return;
                        market.outcomes.forEach(o => { 
                            if(!globalBest[o.name] || o.price > globalBest[o.name].price) globalBest[o.name] = { price: o.price, bookie: b.title }; 
                        });
                    });
                    const bestLegs = Object.keys(globalBest).map(name => ({ outcome: name, odds: globalBest[name].price, bookmaker: globalBest[name].bookie }));
                    const calc = calculateArbitrage(bestLegs);
                    if (calc.margin > 0.05) processArbMatch(game, mKey, null, bestLegs, calc);
                } else {
                    const allPoints = [...new Set(game.bookmakers.flatMap(b => b.markets.find(m => m.key === mKey)?.outcomes.map(o => o.point) || []))];
                    allPoints.forEach(pt => {
                        if (pt === undefined) return;
                        const globalBest = {};
                        game.bookmakers.forEach(b => {
                            const market = b.markets.find(m => m.key === mKey); if (!market) return;
                            market.outcomes.forEach(o => { 
                                if (o.point === pt) {
                                    if(!globalBest[o.name] || o.price > globalBest[o.name].price) globalBest[o.name] = { price: o.price, bookie: b.title }; 
                                }
                            });
                        });
                        const bestLegs = Object.keys(globalBest).map(name => ({ 
                            outcome: `${name} ${pt > 0 ? '+' : ''}${pt}`, 
                            odds: globalBest[name].price, 
                            bookmaker: globalBest[name].bookie 
                        }));
                        if (bestLegs.length < 2) return;
                        const calc = calculateArbitrage(bestLegs);
                        if (calc.margin > 0.05) processArbMatch(game, mKey, pt, bestLegs, calc);
                    });
                }
            });
        });


        loadedMatches = matches.sort((a,b) => b.margin - a.margin);
        
        // Add to archive
        loadedMatches.forEach(m => {
            if (!arbArchive.some(am => am.id === m.id)) {
                arbArchive.push(m);
            }
        });
        // Expire old ones (48 hours stability)
        const expiryDate = new Date(Date.now() - (48 * 60 * 60 * 1000)).toISOString();
        arbArchive = arbArchive.filter(m => m.time > expiryDate);
        localStorage.setItem('arb_archive', JSON.stringify(arbArchive));

        updateDashboard(); 
        if (loadedMatches.length > 0) sendTelegramReport(loadedMatches.slice(0, 3));
    } catch (e) { DOM.arbFeed.innerHTML = `<p>${e.message}</p>`; }
    finally { DOM.refreshBtn.innerText = "Scan Live Markets"; }
}

function processArbMatch(game, mKey, point, bestLegs, calc) {
    game.bookmakers.forEach(bk => { 
        const cb = cleanBookie(bk.title); 
        if (bookieBalances[cb] === undefined) { bookieBalances[cb] = 0; if (!BOOKIE_REGIONS[cb]) BOOKIE_REGIONS[cb] = 'EU'; } 
    });
    const marketLabel = mKey === 'h2h' ? 'Match Winner' : (mKey === 'totals' ? `Over/Under (${point})` : `Spread (${point})`);
    matches.push({ 
        id: `${game.id}_${mKey}_${point || '0'}`, 
        sport: game.sport_title, 
        market: marketLabel,
        matchup: `${game.home_team} vs ${game.away_team}`, 
        time: game.commence_time, 
        displayTime: new Date(game.commence_time).toLocaleString(),
        legs: bestLegs, 
        margin: calc.margin, 
        totalProb: calc.totalProb, 
        isArb: calc.isArb, 
        fullMarket: Object.keys(BOOKIE_SEARCH_URLS).map(bn => { 
            const bd = game.bookmakers.find(bk => bk.title.toLowerCase().includes(bn.toLowerCase())); 
            return { name: bn, odds: bd ? bd.markets.find(m => m.key === mKey)?.outcomes.map(o => `${o.name}: ${o.price}`).join('|') : '-', status: bd ? 'active' : 'missing' }; 
        }) 
    });
}

function renderArbCard(match, index, strategy = 'arb') {
    const sr = calculateStakes(match.totalProb, match.legs, strategy);
    const useIdeal = sr.isZeroBalance;
    const guaranteedReturn = (useIdeal ? sr.stakedLegs[0].idealStake : sr.stakedLegs[0].actualStake) * sr.stakedLegs[0].odds;
    const totalInvestment = useIdeal ? sr.idealInvestment : sr.stakedLegs.reduce((sum, l) => sum + l.actualStake, 0);
    const profit = guaranteedReturn - totalInvestment;
    let legsHtml = sr.stakedLegs.map(l => {
        const sUrl = BOOKIE_SEARCH_URLS[cleanBookie(l.bookmaker)] ? `${BOOKIE_SEARCH_URLS[cleanBookie(l.bookmaker)]}${encodeURIComponent(match.matchup.split(' vs ')[0])}` : `https://google.com/search?q=${encodeURIComponent(l.bookmaker + ' ' + match.matchup)}`;
        return `<div class="arb-leg"><div class="leg-top"><div><div class="bookmaker-name">${l.bookmaker} <a href="${sUrl}" target="_blank" class="quick-jump-link">⚡</a></div><div class="leg-outcome">${l.outcome}</div></div><div class="leg-odds">${formatOdds(l.odds)}</div></div><div class="leg-bet-amount" style="${useIdeal?'opacity:0.5':''}"><span>${useIdeal?'Ideal':'Stake'}</span><span>${formatCurrency(useIdeal?l.idealStake:l.actualStake)}</span></div><div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-top:4px;"><span>If Wins:</span><span style="color:var(--accent-green); font-weight:bold;">${formatCurrency((useIdeal?l.idealStake:l.actualStake)*l.odds)}</span></div></div>`;
    }).join('');
    return `<div class="arb-card" id="card-${match.id}" style="border-left: 2px solid ${match.isArb?'var(--accent-green)':'transparent'}"><div class="arb-header"><div class="arb-game-info"><h3>${match.matchup}</h3><div class="arb-meta">${match.sport} • ${match.market} • ${match.displayTime}</div></div><div class="arb-profit-badge">${match.margin.toFixed(2)}%</div></div><div class="strategy-picker"><button class="strat-btn ${strategy==='arb'?'active':''}" onclick="updateMatchStrategy('${match.id}', 'arb')">Equal Arb</button><button class="strat-btn ${strategy==='under'?'active':''}" onclick="updateMatchStrategy('${match.id}', 'under')">Under-Hedge</button></div>${useIdeal ? `<div style="background:rgba(255,68,68,0.1); color:#ff4444; padding:0.5rem; text-align:center; font-size:0.75rem;">⚠️ Deposit: ${sr.bottlenecks.map(b => `£${b.needed.toFixed(2)} -> ${b.name}`).join(', ')}</div>` : ''}<div class="arb-body" style="grid-template-columns: repeat(${match.legs.length}, 1fr);">${legsHtml}</div><div style="background:rgba(0,0,0,0.2); padding:1rem; border-top:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;"><div><span style="font-size:0.75rem;">Return</span><strong>${strategy==='under'?`${formatCurrency(Math.min(...sr.stakedLegs.map(l=>(useIdeal?l.idealStake:l.actualStake)*l.odds)))} - ${formatCurrency(Math.max(...sr.stakedLegs.map(l=>(useIdeal?l.idealStake:l.actualStake)*l.odds)))}`:formatCurrency(guaranteedReturn)}</strong></div><div style="display:flex; gap:1rem; align-items:center;"><span>${strategy==='under'?'Variable':formatCurrency(profit)}</span><button class="primary-btn" onclick="logBet('${match.id}', '${strategy}')">Log Bet</button></div></div><div style="padding:0.5rem 1rem;"><button onclick="toggleMarketDepth('${match.id}')" style="background:none; border:none; color:var(--accent-blue); cursor:pointer; font-size:0.75rem;">▶ Market Depth</button><div id="depth-container-${match.id}" style="display:none; margin-top:0.5rem; grid-template-columns:1fr 1fr; gap:0.5rem;">${match.fullMarket.map(f => `<div style="font-size:0.65rem; background:rgba(255,255,255,0.03); padding:4px;"><strong>${f.name}</strong>: ${f.odds}</div>`).join('')}</div></div></div>`;
}

window.toggleMarketDepth = (id) => { const c = document.getElementById(`depth-container-${id}`); c.style.display = c.style.display === 'none' ? 'grid' : 'none'; };
window.updateMatchStrategy = (id, strat) => { const idx = loadedMatches.findIndex(m => m.id === id); if(idx!==-1) document.getElementById(`card-${id}`).outerHTML = renderArbCard(loadedMatches[idx], idx, strat); };

function updateDashboard() {
    if (!DOM.arbFeed) return;
    const arbs = loadedMatches.filter(m => m.isArb);
    DOM.arbFeed.innerHTML = loadedMatches.length > 0 ? loadedMatches.slice(0, 15).map((m, i) => renderArbCard(m, i)).join('') : '<p>No matches yet.</p>';
    if (DOM.bestMargin) DOM.bestMargin.innerText = arbs[0] ? arbs[0].margin.toFixed(2) + '%' : '0.00%';
    DOM.statusText.innerText = "Scan Complete";
    updateStockyTicker(); updateRebalancer(); updateUsageStats();
}

function updateOpportunitiesUI() {
    if (!DOM.oppFeed) return;
    const expiryDate = new Date(Date.now() - (48 * 60 * 60 * 1000)).toISOString();
    arbArchive = arbArchive.filter(m => m.time > expiryDate);
    arbArchive.sort((a, b) => b.margin - a.margin);
    localStorage.setItem('arb_archive', JSON.stringify(arbArchive));
    
    DOM.oppFeed.innerHTML = arbArchive.length > 0 ? arbArchive.map((m, i) => {
        const card = renderArbCard(m, i);
        // Inject a prominent time badge
        return card.replace('<div class="arb-meta">', `<div class="arb-meta"><span style="color:var(--accent-blue); font-weight:bold; border:1px solid var(--accent-blue-dim); padding:2px 6px; border-radius:4px; font-size:0.7rem;">STARTS: ${m.displayTime}</span>`);
    }).join('') : '<p style="color: var(--text-secondary); text-align: center; margin-top: 2rem;">No archived opportunities yet.</p>';
    if (DOM.oppCount) DOM.oppCount.innerText = arbArchive.length;
    if (DOM.oppAvgMargin && arbArchive.length > 0) {
        const avg = arbArchive.reduce((sum, m) => sum + m.margin, 0) / arbArchive.length;
        DOM.oppAvgMargin.innerText = avg.toFixed(2) + '%';
    }
}

async function fetchUpcomingSpotlight() {
    const el = document.getElementById('upcoming-spotlight-feed');
    if (!el) return;
    
    try {
        const endpoints = [
            { name: 'Premier League', url: 'https://api.openligadb.de/getmatchdata/epl', type: 'soccer' },
            { name: 'Champions League', url: 'https://api.openligadb.de/getmatchdata/cl', type: 'soccer' },
            { name: 'NBA', url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard', type: 'espn' },
            { name: 'EuroLeague', url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-euroleague/scoreboard', type: 'espn' }
        ];

        let allMatches = [];

        const results = await Promise.allSettled(endpoints.map(e => fetch(e.url).then(r => r.json()).then(data => ({ ...e, data }))));
        
        results.forEach(res => {
            if (res.status !== 'fulfilled') return;
            const { name, type, data } = res.value;
            
            if (type === 'soccer') {
                data.slice(0, 5).forEach(m => {
                    if (new Date(m.matchDateTime) < new Date()) return;
                    allMatches.push({
                        league: name,
                        matchup: `${m.team1.teamName} vs ${m.team2.teamName}`,
                        time: new Date(m.matchDateTime).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
                    });
                });
            } else if (type === 'espn') {
                data.events?.slice(0, 5).forEach(e => {
                    allMatches.push({
                        league: name,
                        matchup: e.name,
                        time: new Date(e.date).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
                    });
                });
            }
        });

        el.innerHTML = allMatches.length > 0 ? allMatches.map(m => `
            <div class="spotlight-item">
                <div class="spotlight-match">${m.matchup}</div>
                <div class="spotlight-meta">
                    <span class="spotlight-league">${m.league}</span>
                    <span>${m.time}</span>
                </div>
                <button onclick="flashScan('${m.matchup}')" style="margin-top:8px; width:100%; font-size:0.6rem; padding:4px; background:rgba(0,184,255,0.1); border:1px solid var(--accent-blue-dim); color:var(--accent-blue); border-radius:4px; cursor:pointer;">⚡ Quick Scan (Market)</button>
            </div>
        `).join('') : '<p style="font-size:0.7rem; text-align:center;">No upcoming major matches found.</p>';

    } catch (err) {
        el.innerHTML = `<p style="font-size:0.7rem; color:#ff4444;">Failed to load spotlight.</p>`;
    }
}

window.flashScan = (matchup) => {
    alert(`Scanning markets for: ${matchup}\nThis uses 1 API Token.`);
    fetchLiveArbs();
};

function updateStockyTicker() {
    const el = document.getElementById('odds-ticker'); if (!el || loadedMatches.length === 0) return;
    const arbs = loadedMatches.filter(m => m.isArb).slice(0, 10);
    el.innerHTML = arbs.map(m => `<div class="ticker-item">${m.matchup}: ${m.legs.map(l => `${l.outcome} ${l.odds.toFixed(2)}`).join(' | ')}</div>`).join('');
}

function updateActionCenter() {
    // Removed as per user request to declutter UI
    if (DOM.actionCenter) DOM.actionCenter.innerHTML = '';
}

function updateRebalancer() {
    if (!DOM.rebalanceSuggestions) return;
    const balances = Object.entries(bookieBalances);
    const lowFunds = balances.filter(([n, b]) => b < 5).map(([n]) => n);
    const highFunds = balances.filter(([n, b]) => b > 50).sort((a,b) => b[1]-a[1]);
    if (lowFunds.length && highFunds.length) {
        DOM.rebalanceSuggestions.innerHTML = lowFunds.map(t => `<div style="background:rgba(255,255,255,0.03); padding:0.5rem; border-left:3px solid var(--accent-blue); margin-bottom:0.5rem;">Move £${(highFunds[0][1]*0.5).toFixed(2)} from ${highFunds[0][0].toUpperCase()} to ${t.toUpperCase()}</div>`).join('');
    } else { DOM.rebalanceSuggestions.innerHTML = '<p>No rebalance needed.</p>'; }
}

function logBet(matchId, strategy) {
    const match = loadedMatches.find(m => m.id === matchId); if (!match) return;
    const sr = calculateStakes(match.totalProb, match.legs, strategy);
    if (sr.isZeroBalance) { alert("❌ Deposit first!"); return; }
    
    sr.stakedLegs.forEach(l => {
        const cb = cleanBookie(l.bookmaker);
        bookieBalances[cb] -= l.actualStake;
    });

    const guaranteedReturn = (sr.stakedLegs[0].actualStake * sr.stakedLegs[0].odds);

    betHistory.unshift({ 
        id: Date.now(), 
        date: new Date().toLocaleDateString(), 
        commence_time: match.time, 
        matchup: match.matchup, 
        sport: match.sport, 
        market: match.market,
        legs: sr.stakedLegs.map(s => ({ ...s, stake: s.actualStake })), 
        totalStake: FIXED_STAKE, 
        possibleReturn: guaranteedReturn, 
        status: 'pending' 
    });

    localStorage.setItem('arb_bookie_balances', JSON.stringify(bookieBalances)); 
    localStorage.setItem('arb_bet_history', JSON.stringify(betHistory));
    
    updatePortfolio(); updateBankrollUI(); updateDashboard();
    alert("✅ Bet Logged! Balance deducted.");
}

window.settleBet = (id, result, winningLegIndex = null) => {
    const bet = betHistory.find(b => b.id === id);
    if (!bet || bet.status !== 'pending') return;

    bet.status = result;
    if (result === 'won') {
        const winningLeg = winningLegIndex !== null ? bet.legs[winningLegIndex] : bet.legs[0];
        const payout = winningLeg.stake * winningLeg.odds;
        const cb = cleanBookie(winningLeg.bookmaker);
        bookieBalances[cb] = (bookieBalances[cb] || 0) + payout;
        
        sendTelegramSettlement(bet, payout, winningLeg.bookmaker);
    }

    localStorage.setItem('arb_bookie_balances', JSON.stringify(bookieBalances));
    localStorage.setItem('arb_bet_history', JSON.stringify(betHistory));
    
    updatePortfolio(); updateBankrollUI(); updateDashboard();
};

function sendTelegramSettlement(bet, payout, bookmaker) {
    if (!tgToken || !tgChatId) return;
    const msg = `💰 *HOE Settlement*\n\nMatch: ${bet.matchup}\nResult: WON (+£${(payout - bet.totalStake).toFixed(2)})\nBookmaker: ${bookmaker}\nBalance Updated.`;
    fetch(`https://api.telegram.org/bot${tgToken}/sendMessage?chat_id=${tgChatId}&text=${encodeURIComponent(msg)}&parse_mode=Markdown`).catch(e => console.error(e));
}

function updateBankrollUI() {
    const br = getGlobalBankroll(); 
    if (DOM.bankrollAvailable) DOM.bankrollAvailable.innerText = formatCurrency(br.available); 
    if (DOM.bankrollLocked) DOM.bankrollLocked.innerText = formatCurrency(br.locked); 
    if (DOM.bankrollGlobal) DOM.bankrollGlobal.innerText = formatCurrency(br.total);
    
    const sorted = Object.keys(BOOKIE_SEARCH_URLS).sort((a,b) => (BOOKIE_REGIONS[a]==='UK'?-1:1) || a.localeCompare(b));
    DOM.bookieBalancesGrid.innerHTML = sorted.map(b => {
        const region = BOOKIE_REGIONS[b] || 'EU';
        const url = BOOKIE_SEARCH_URLS[b]?.split('search')[0];
        return `
            <div class="bookie-balance-card">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <span style="font-size: 0.6rem; color: var(--accent-blue); font-weight: bold; border: 1px solid var(--accent-blue-dim); padding: 1px 4px; border-radius: 4px;">${region}</span>
                    <a href="${url}" target="_blank" style="text-decoration: none; font-size: 0.8rem;">🔗</a>
                </div>
                <h4 style="margin: 4px 0;">${b.toUpperCase()}</h4>
                <div class="input-wrapper" style="margin-top: 4px; border: ${bookieBalances[b] > 0 ? '1px solid var(--accent-green)' : '1px solid var(--border-highlight)'}; border-radius: 8px;">
                    <span class="currency-symbol">£</span>
                    <input type="number" value="${(bookieBalances[b]||0).toFixed(2)}" onchange="updateCustomBalance('${b}', this.value)" style="width: 100%; border: none; background: transparent; color: white; padding-left: 2.5rem;" />
                </div>
            </div>
        `;
    }).join('');
    updateRebalancer();
}
window.updateCustomBalance = (b, v) => { bookieBalances[b] = parseFloat(v) || 0; localStorage.setItem('arb_bookie_balances', JSON.stringify(bookieBalances)); updateBankrollUI(); };

function updatePortfolio() {
    const table = DOM.betHistoryTable;
    if (!table) return;

    let totalProfit = 0;
    let totalStaked = 0;
    let activeCount = 0;

    table.innerHTML = betHistory.map(b => {
        if (b.status === 'pending') activeCount++;
        if (b.status === 'won') totalProfit += (b.possibleReturn - b.totalStake);
        if (b.status === 'lost') totalProfit -= b.totalStake;
        totalStaked += b.totalStake;

        const isPending = b.status === 'pending';
        const profitColor = b.status === 'won' ? 'var(--accent-green)' : (b.status === 'lost' ? '#ff4444' : 'inherit');

        return `
            <tr>
                <td>${b.date}</td>
                <td style="font-size: 0.8rem;"><strong>${b.matchup}</strong><br><small>${b.sport} • ${b.market || 'Match Winner'}</small></td>
                <td>${b.legs.length}-Way</td>
                <td>${formatCurrency(b.totalStake)}</td>
                <td style="color: ${profitColor}">${formatCurrency(b.possibleReturn)}</td>
                <td><span class="status-badge" style="background: ${isPending ? 'var(--accent-blue-dim)' : (b.status === 'won' ? 'var(--accent-green-dim)' : 'rgba(255,68,68,0.1)')}">${b.status}</span></td>
                <td>
                    <div style="display: flex; gap: 4px;">
                        ${isPending ? `
                            <button class="settle-btn" onclick="settleBet(${b.id}, 'won')" style="background: var(--accent-green); color: black; font-size: 0.6rem; padding: 2px 4px;">WON</button>
                            <button class="settle-btn" onclick="settleBet(${b.id}, 'lost')" style="background: #444; color: white; font-size: 0.6rem; padding: 2px 4px;">LOST</button>
                        ` : ''}
                        <button onclick="deleteBet(${b.id})" style="background: transparent; border: none; cursor: pointer; opacity: 0.5;">🗑️</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    if (DOM.portTotalProfit) DOM.portTotalProfit.innerText = formatCurrency(totalProfit);
    if (DOM.portActiveBets) DOM.portActiveBets.innerText = activeCount;
    if (DOM.portRoi && totalStaked > 0) DOM.portRoi.innerText = ((totalProfit / totalStaked) * 100).toFixed(2) + '%';
    
    if (window.updateProfitChart) updateProfitChart();
}
window.deleteBet = (id) => { betHistory = betHistory.filter(b=>b.id!==id); localStorage.setItem('arb_bet_history', JSON.stringify(betHistory)); updatePortfolio(); updateDashboard(); };

function renderSportsGrid() {
    const saved = JSON.parse(localStorage.getItem('selected_sports')) || ['soccer_epl', 'basketball_nba'];
    if(!DOM.sportsGrid) return;
    DOM.sportsGrid.innerHTML = SPORT_CONFIG.map(s => `<label><input type="checkbox" class="sport-checkbox" value="${s.key}" ${saved.includes(s.key)?'checked':''}>${s.name}</label>`).join('');
    document.querySelectorAll('.sport-checkbox').forEach(cb => cb.addEventListener('change', () => { localStorage.setItem('selected_sports', JSON.stringify(Array.from(document.querySelectorAll('.sport-checkbox:checked')).map(c=>c.value))); updateTokenHealth(); }));
}

function updateTokenHealth() {
    const selected = document.querySelectorAll('.sport-checkbox:checked').length; const usage = selected * (DOM.autoScanToggle?.checked?8:1) * 2 * 31;
    if(DOM.tokenUsageInfo) DOM.tokenUsageInfo.innerText = `~${usage}/month`;
    if(DOM.healthProgress) DOM.healthProgress.style.width = `${Math.min((usage/500)*100, 100)}%`;
}

// Global Nav
['dashboard', 'portfolio', 'bankroll', 'opportunities', 'settings'].forEach(p => {
    DOM[`nav${p.charAt(0).toUpperCase()+p.slice(1)}`].addEventListener('click', () => {
        ['dashboard', 'portfolio', 'bankroll', 'opportunities', 'settings'].forEach(p2 => { 
            DOM[`nav${p2.charAt(0).toUpperCase()+p2.slice(1)}`].classList.toggle('active', p===p2); 
            DOM[`view${p2.charAt(0).toUpperCase()+p2.slice(1)}`].style.display = p===p2 ? (p==='settings'?'flex':'block') : 'none'; 
        });
        if(p==='portfolio') updatePortfolio(); 
        if(p==='bankroll') updateBankrollUI();
        if(p==='opportunities') updateOpportunitiesUI();
    });
});

DOM.refreshBtn.addEventListener('click', fetchLiveArbs);
DOM.saveSettingsBtn.addEventListener('click', () => { 
    const keysInput = DOM.apiKeyInput.value; 
    apiKeys = keysInput.split(',').map(s => s.trim());
    localStorage.setItem('arb_api_key', keysInput); 
    localStorage.setItem('odds_format', DOM.oddsFormatSelect.value);
    alert("Saved!"); 
});
DOM.masterResetBtn.addEventListener('click', () => { if(confirm("Reset engine?")) { localStorage.clear(); location.reload(); } });

// Init
renderSportsGrid(); updateUsageStats(); updateBankrollUI(); updateDashboard();
fetchUpcomingSpotlight();
if (DOM.oddsFormatSelect) DOM.oddsFormatSelect.value = localStorage.getItem('odds_format') || 'decimal';
if (DOM.apiKeyInput) DOM.apiKeyInput.value = apiKeys.join(', ');
