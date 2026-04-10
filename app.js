// Arbitrage Math Utility (Using European Decimal Odds)
function calculateArbitrage(legs) {
    let totalProb = 0;
    legs.forEach(leg => {
        totalProb += (1 / leg.odds);
    });
    
    const profitMargin = (1 - totalProb) * 100; // Positive margin = Arb! (e.g. 100% - 95% = 5%)
    return {
        isArb: totalProb < 1,
        margin: profitMargin,
        totalProb: totalProb
    };
}

function calculateStakes(globalBankroll, totalProb, legs, strategy = 'arb') {
    if (strategy === 'arb') {
        // Equal profit on all sides
        return legs.map(leg => {
            const prob = 1 / leg.odds;
            const stake = (globalBankroll * prob) / totalProb;
            return { ...leg, stake };
        });
    } else if (strategy === 'under') {
        // UNDER-HEDGING: 
        // We stake just enough on the longshot (higher odds) to break even, 
        // and put the rest on the favorite to maximize profit.
        const sorted = [...legs].sort((a, b) => b.odds - a.odds);
        const longshot = sorted[0];
        const favorite = sorted[1];
        
        const longshotStake = globalBankroll / longshot.odds;
        const favoriteStake = globalBankroll - longshotStake;
        
        return legs.map(leg => {
            const stake = (leg.bookmaker === longshot.bookmaker) ? longshotStake : favoriteStake;
            return { ...leg, stake };
        });
    }
}

function calculateKelly(match, bankroll) {
    // Kelly Criterion: f* = (bp - q) / b
    // b = decimal odds - 1
    // p = "True" probability (We use average market prob)
    // q = 1 - p
    
    // 1. Get average price for each leg to estimate "True" probability
    // (In a real app, you'd fetch more bookies, but we use the legs we have)
    const avgProbTotal = match.totalProb;
    
    return match.legs.map(leg => {
        const b = leg.odds - 1;
        const p = (1 / leg.odds) / avgProbTotal; // Normalized probability
        const q = 1 - p;
        const f = (b * p - q) / b;
        const suggestedStake = Math.max(0, f * bankroll * 0.1); // Use quarter-kelly (0.1) for safety
        return { ...leg, kellyStake: suggestedStake, kellyPercent: (f * 100).toFixed(1) };
    });
}

const formatCurrency = (val) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(val);
const formatOdds = (val) => val.toFixed(2);

// Bookmaker Search Patterns (Level 1 Automation)
const BOOKIE_SEARCH_URLS = {
    'betfair': 'https://www.betfair.com/sport/search?q=',
    '888sport': 'https://www.888sport.com/search?q=',
    'william hill': 'https://sports.williamhill.com/betting/en-gb/search?q=',
    'paddy power': 'https://www.paddypower.com/search?q=',
    'sky bet': 'https://m.skybet.com/search?q=',
    'ladbrokes': 'https://sports.ladbrokes.com/search?q=',
    'coral': 'https://sports.coral.co.uk/search?q=',
    'unibet': 'https://www.unibet.co.uk/search?q=',
    'betfred': 'https://www.betfred.com/sports/search?q=',
    'bet victor': 'https://www.betvictor.com/en-gb/sports/all/search?q=',
    'smarkets': 'https://smarkets.com/search?query=',
    'matchbook': 'https://www.matchbook.com/search?q=',
    'boylesports': 'https://www.boylesports.com/sports/search?q=',
    'betway': 'https://betway.com/en-gb/sports/all/search?q=',
    'grosvenor': 'https://www.grosvenorcasinos.com/sport#search/query=',
    'livescore': 'https://www.livescorebet.com/uk/search?q=',
    'virgin': 'https://www.virginbet.com/uk/search?q=',
    '10bet': 'https://www.10bet.co.uk/search?q=',
    'spreadex': 'https://www.spreadex.com/sports/search?q=',
    'kwiff': 'https://kwiff.com/search?q=',
    'leovegas': 'https://www.leovegas.com/en-gb/sport#search/query=',
    'mr green': 'https://www.mrgreen.com/en-gb/betting#search/query=',
    'casumo': 'https://www.casumo.com/en-gb/sports#search/'
};

// App State
let currentBankroll = parseFloat(localStorage.getItem('arb_bankroll')) || 1000;
let apiKey = localStorage.getItem('arb_api_key') || '6cbd5867fac1c7ea342a271600898dd9'; 
let tgToken = localStorage.getItem('tg_bot_token') || '8393406772:AAEEvxoyvv5weSH3-gDEC3fk6ldskXP6AT0';
let tgChatId = '5761611308'; 

let betHistory = JSON.parse(localStorage.getItem('arb_bet_history')) || [];
let loadedMatches = [];
let autoScanInterval = null;

const SPORT_CONFIG = [
    { key: 'basketball_nba', name: 'NBA (Basketball)' },
    { key: 'basketball_euroleague', name: 'EuroLeague' },
    { key: 'basketball_ncaab', name: 'NCAAB (College)' },
    { key: 'soccer_epl', name: 'Premier League' },
    { key: 'soccer_uefa_champs_league', name: 'Champions League' },
    { key: 'tennis_atp_monte_carlo_masters', name: 'ATP Tennis' },
    { key: 'mma_mixed_martial_arts', name: 'UFC (MMA)' },
    { key: 'cricket_ipl', name: 'IPL (Cricket)' },
    { key: 'baseball_mlb', name: 'MLB (Baseball)' },
    { key: 'icehockey_nhl', name: 'NHL (Hockey)' }
];

const DOM = {
    arbFeed: document.getElementById('arb-feed'),
    globalBankroll: document.getElementById('global-bankroll'),
    activeArbsCount: document.getElementById('active-arbs-count'),
    bestMargin: document.getElementById('best-margin'),
    refreshBtn: document.getElementById('refresh-btn'),
    statusText: document.getElementById('status-text'),
    autoScanToggle: document.getElementById('auto-scan-toggle'),
    
    // Nav
    navDashboard: document.getElementById('nav-dashboard'),
    navPortfolio: document.getElementById('nav-portfolio'),
    navSettings: document.getElementById('nav-settings'),
    viewDashboard: document.getElementById('view-dashboard'),
    viewPortfolio: document.getElementById('view-portfolio'),
    viewSettings: document.getElementById('view-settings'),
    
    // Portfolio Metrics
    portTotalProfit: document.getElementById('port-total-profit'),
    portRoi: document.getElementById('port-roi'),
    betHistoryTable: document.getElementById('bet-history-table'),
    
    // Settings
    apiKeyInput: document.getElementById('api-key-input'),
    tgTokenInput: document.getElementById('tg-token'),
    tgChatIdInput: document.getElementById('tg-chat-id'),
    findIdBtn: document.getElementById('find-id-btn'),
    findIdStatus: document.getElementById('find-id-status'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),
    
    // Sports Selection
    sportsGrid: document.getElementById('sports-selection-grid'),
    healthStatusText: document.getElementById('health-status-text'),
    healthProgress: document.getElementById('health-progress'),
    tokenUsageInfo: document.getElementById('token-usage-info'),
    tokenDaysInfo: document.getElementById('token-days-info')
};

// --- Telegram Logic ---
async function findChatId() {
    // Aggressive Auto-Healing
    let box1 = DOM.tgTokenInput.value.trim();
    let box2 = DOM.tgChatIdInput.value.trim();
    
    let combined = (box1 + ":" + box2).replace(/[^a-zA-Z0-9:\-_]/g, '');
    if (!combined.includes(':')) combined = (box2 + ":" + box1).replace(/[^a-zA-Z0-9:\-_]/g, '');
    let testToken = combined.length > 20 ? combined : '8490087884:AAHwFwk7WVwsuPP4yeikHfdxBAmcuvvvG0Y';
    if (testToken.toLowerCase().startsWith('bot')) testToken = testToken.substring(3);

    DOM.findIdStatus.innerText = "Verifying Bot Token...";
    DOM.findIdStatus.style.color = "var(--accent-blue)";
    
    try {
        // Step 1: Identity the bot
        const meRes = await fetch(`https://api.telegram.org/bot${testToken}/getMe`);
        const meData = await meRes.json();
        
        if (!meData.ok) {
            DOM.findIdStatus.innerText = "Error: Invalid Token! Copy exactly from @BotFather.";
            DOM.findIdStatus.style.color = "#ff4444";
            return;
        }

        const botName = meData.result.username;
        DOM.findIdStatus.innerText = `Connected to @${botName}. Send a text to @${botName} now!`;
        
        // Step 2: Look for messages
        const res = await fetch(`https://api.telegram.org/bot${testToken}/getUpdates`);
        const data = await res.json();
        
        if (data.ok && data.result.length > 0) {
            const lastMsg = data.result[data.result.length - 1];
            if (lastMsg.message && lastMsg.message.from) {
                const realCid = lastMsg.message.from.id;
                tgToken = testToken;
                tgChatId = realCid.toString();
                DOM.tgTokenInput.value = tgToken;
                DOM.tgChatIdInput.value = tgChatId;
                localStorage.setItem('tg_bot_token', tgToken);
                localStorage.setItem('tg_chat_id', tgChatId);
                DOM.findIdStatus.innerText = "SUCCESS! Everything fixed and saved.";
                DOM.findIdStatus.style.color = "var(--accent-green)";
            }
        } else {
            DOM.findIdStatus.innerHTML = `Still no messages. <strong>Search for @${botName}</strong>, click START, and send a text!`;
        }
    } catch (e) {
        DOM.findIdStatus.innerText = "Error: Connection failed. Use http://localhost:8000.";
        DOM.findIdStatus.style.color = "#ff4444";
    }
}
async function sendTelegramReport(topMatches) {
    if (!tgToken || !tgChatId) return;
    
    let reportText = `🏆 *House of Bebington: Top 3 Report*\n\n`;
    
    topMatches.forEach((match, i) => {
        const sign = match.isArb ? '🚨 ' : '📊 ';
        const marginSign = match.margin > 0 ? '+' : '';
        reportText += `${sign}#${i+1}: ${match.matchup}\n`;
        reportText += `Margin: ${marginSign}${match.margin.toFixed(2)}%\n`;
        
        match.legs.forEach(leg => {
            reportText += `• ${leg.bookmaker}: ${formatOdds(leg.odds)}\n`;
        });
        reportText += `\n`;
    });
    
    let cleanToken = tgToken.replace(/[^a-zA-Z0-9:\-_]/g, '');
    let cleanChat = tgChatId.replace(/[^0-9\-]/g, '');
    if (cleanToken.toLowerCase().startsWith('bot')) cleanToken = cleanToken.substring(3);

    const telegramUrl = `https://api.telegram.org/bot${cleanToken}/sendMessage?chat_id=${cleanChat}&text=${encodeURIComponent(reportText)}&parse_mode=Markdown`;
    
    try {
        const res = await fetch(telegramUrl);
        const json = await res.json();
        
        if (!res.ok) {
            DOM.arbFeed.innerHTML = `<div style="background: rgba(255,0,0,0.2); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
                <p style="color: #ffaa44; font-weight: bold; margin:0">Telegram API Error:</p>
                <p style="color: #ffaa44; font-size: 0.85em; margin:0">${json.description}</p>
            </div>` + DOM.arbFeed.innerHTML;
        }
    } catch (e) {
        console.error("Telegram Report Failed", e);
    }
}

// --- API Logic ---
function cleanBookie(name) {
    let clean = name.toLowerCase().split('(')[0].trim();
    if (clean.includes('betfair')) return 'betfair';
    if (clean.includes('william hill')) return 'william hill';
    if (clean.includes('paddy power')) return 'paddy power';
    if (clean.includes('sky bet')) return 'sky bet';
    if (clean.includes('grosvenor')) return 'grosvenor';
    if (clean.includes('livescore')) return 'livescore';
    if (clean.includes('virgin')) return 'virgin';
    if (clean.includes('smarkets')) return 'smarkets';
    if (clean.includes('matchbook')) return 'matchbook';
    if (clean.includes('casumo')) return 'casumo';
    return clean;
}

async function fetchLiveArbs() {
    if (!apiKey) {
        alert("Please set your API Key in the Settings tab first!");
        return;
    }

    DOM.refreshBtn.innerText = "Scanning...";
    DOM.statusText.innerHTML = '<span class="dot pulse" style="background:#00b8ff;"></span> Fetching from The Odds API...';
    DOM.arbFeed.style.opacity = '0.5';

    try {
        const selectedSports = Array.from(document.querySelectorAll('.sport-checkbox:checked')).map(cb => cb.value);
        
        if (selectedSports.length === 0) {
            throw new Error("No sports selected! Enable at least one sport in Settings.");
        }

        const fetchPromises = selectedSports.map(sport => {
            const targetUrl = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${apiKey}&regions=uk&markets=h2h&oddsFormat=decimal`;
            return fetch(targetUrl).then(async res => {
                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(`API Error: ${errText}`);
                }
                return res.json();
            });
        });

        // Fetch all selected sports concurrently
        const results = await Promise.all(fetchPromises);
        
        // Combine all arrays of games into one massive list
        const data = results.flat();
        
        // Parse the data to find best odds
        const matches = [];

        data.forEach(game => {
            const outcomeNames = [...new Set(game.bookmakers.flatMap(b => b.markets.find(m => m.key === 'h2h')?.outcomes.map(o => o.name) || []))];
            if (outcomeNames.length < 2) return;

            let bestMultiMargin = -999;
            let bestMultiLegs = [];

            // Cross-Bookmaker Engine: 
            // We want to find the best combination where at least 2 bookies are involved.
            // 1. Find the best price for each outcome across all bookies
            const globalBest = {}; 
            game.bookmakers.forEach(bookie => {
                const h2h = bookie.markets.find(m => m.key === 'h2h');
                if (!h2h) return;
                h2h.outcomes.forEach(o => {
                    if (!globalBest[o.name] || o.price > globalBest[o.name].price) {
                        globalBest[o.name] = { price: o.price, bookie: bookie.title };
                    }
                });
            });

            const globalLegs = Object.values(globalBest);
            const globalUnique = new Set(globalLegs.map(l => l.bookie));

            if (globalUnique.size > 1) {
                // If the global bests already use different bookies, we are done!
                const calc = calculateArbitrage(globalLegs.map(l => ({ outcome: '', odds: l.price, bookmaker: l.bookie }))); // Simplified for calc
                bestMultiMargin = calc.margin;
                bestMultiLegs = Object.keys(globalBest).map(name => ({
                    outcome: name,
                    odds: globalBest[name].price,
                    bookmaker: globalBest[name].bookie
                }));
            } else {
                // If global best is all one bookie (e.g. Betfair), we need to find a 2nd bookie.
                // We try swapping each outcome to its 2nd best bookie and see which gives the best margin.
                outcomeNames.forEach(nameToSwap => {
                    const otherOutcomesBest = {};
                    outcomeNames.forEach(n => { if(n !== nameToSwap) otherOutcomesBest[n] = globalBest[n]; });

                    // Find best price for nameToSwap from a DIFFERENT bookie
                    let secondBestPrice = 0;
                    let secondBestBookie = '';
                    game.bookmakers.forEach(bookie => {
                        if (bookie.title === globalLegs[0].bookie) return; // Skip the dominant bookie
                        const h2h = bookie.markets.find(m => m.key === 'h2h');
                        if (!h2h) return;
                        const o = h2h.outcomes.find(out => out.name === nameToSwap);
                        if (o && o.price > secondBestPrice) {
                            secondBestPrice = o.price;
                            secondBestBookie = bookie.title;
                        }
                    });

                    if (secondBestPrice > 0) {
                        const testLegs = outcomeNames.map(n => {
                            if (n === nameToSwap) return { outcome: n, odds: secondBestPrice, bookmaker: secondBestBookie };
                            return { outcome: n, odds: globalBest[n].price, bookmaker: globalBest[n].bookie };
                        });
                        const calc = calculateArbitrage(testLegs);
                        if (calc.margin > bestMultiMargin) {
                            bestMultiMargin = calc.margin;
                            bestMultiLegs = testLegs;
                        }
                    }
                });
            }

            if (bestMultiLegs.length >= 2) {
                const uniqueCheck = new Set(bestMultiLegs.map(l => cleanBookie(l.bookmaker)));
                if (uniqueCheck.size < 2) return; // NUCLEAR OPTION: Discard if still only 1 bookie
                
                const calc = calculateArbitrage(bestMultiLegs);
                matches.push({
                    id: game.id,
                    sport: game.sport_title,
                    matchup: `${game.home_team} vs ${game.away_team}`,
                    time: new Date(game.commence_time).toLocaleString(),
                    legs: bestMultiLegs,
                    margin: calc.margin,
                    totalProb: calc.totalProb,
                    isArb: calc.isArb
                });
            }
        });

        // SORTING: Genuine Multi-Bookie Arbs first
        matches.sort((a, b) => {
            if (a.isArb && !b.isArb) return -1;
            if (!a.isArb && b.isArb) return 1;
            return b.margin - a.margin;
        });
        
        loadedMatches = matches.slice(0, 50); // Keep top 50
        updateDashboard();
        
        // Push Telegram Alert for the TOP 3 matches found
        if (loadedMatches.length > 0) {
            sendTelegramReport(loadedMatches.slice(0, 3));
        }

    } catch (e) {
        DOM.arbFeed.innerHTML = `<p style="color: #ff4444; padding: 2rem; white-space: pre-wrap; word-break: break-all;">Error Details:<br>${e.stack || e.message}</p>`;
        DOM.statusText.innerHTML = '<span class="dot" style="background:#ff4444;"></span> Scan Failed';
    } finally {
        DOM.arbFeed.style.opacity = '1';
        DOM.refreshBtn.innerText = "Scan Live Markets";
    }
}

// --- UI Logic ---
function renderArbCard(match, index, strategy = 'arb') {
    const isArb = match.isArb;
    const badgeClass = 'arb-profit-badge';
    const badgeColor = isArb ? 'var(--accent-green)' : 'var(--text-secondary)';
    const badgeBg = isArb ? 'var(--accent-green-dim)' : 'rgba(255,255,255,0.05)';
    const badgeBorder = isArb ? '1px solid rgba(0, 255, 136, 0.2)' : '1px solid var(--border-color)';
    const cardBorderHighlight = isArb ? 'var(--accent-green)' : 'rgba(255,255,255,0.1)';

    const stakedLegs = calculateStakes(currentBankroll, match.totalProb, match.legs, strategy);
    const kellyInfo = calculateKelly(match, currentBankroll);
    
    const guaranteedReturn = stakedLegs[0].stake * stakedLegs[0].odds;
    const profit = guaranteedReturn - currentBankroll;

    let legsHtml = '';
    const mainTeam = match.matchup.split(' vs ')[0]; // Use first team for search

    stakedLegs.forEach((leg, i) => {
        const k = kellyInfo[i];
        const searchBase = BOOKIE_SEARCH_URLS[cleanBookie(leg.bookmaker)];
        const searchUrl = searchBase ? `${searchBase}${encodeURIComponent(mainTeam)}` : `https://www.google.com/search?q=${encodeURIComponent(leg.bookmaker + ' ' + mainTeam)}`;

        legsHtml += `
            <div class="arb-leg">
                <div class="leg-top">
                    <div>
                        <div class="bookmaker-name">
                            ${leg.bookmaker}
                            ${searchBase ? `<a href="${searchUrl}" target="_blank" class="quick-jump-link" title="Quick Search on ${leg.bookmaker}">⚡</a>` : ''}
                        </div>
                        <div class="leg-outcome">${leg.outcome}</div>
                    </div>
                    <div class="leg-odds">${formatOdds(leg.odds)}</div>
                </div>
                <div class="leg-bet-amount">
                    <span class="bet-label">Stake</span>
                    <span class="bet-value">${formatCurrency(leg.stake)}</span>
                </div>
                <div style="margin-top: 0.5rem; font-size: 0.7rem; color: var(--text-secondary); border-top: 1px solid rgba(255,255,255,0.05); padding-top: 4px;">
                    Kelly: ${k.kellyPercent}% | True Prob: ${( (1/leg.odds)/match.totalProb * 100).toFixed(0)}%
                </div>
            </div>
        `;
    });

    return `
        <div class="arb-card animate-slide-in" id="card-${match.id}" style="animation-delay: ${index * 0.05}s">
            <style>
                .arb-card#card-${match.id}::before { background: ${cardBorderHighlight}; box-shadow: 0 0 12px ${cardBorderHighlight}; }
            </style>
            <div class="arb-header">
                <div class="arb-game-info">
                    <h3>${match.matchup}</h3>
                    <div class="arb-meta">
                        <span>${match.sport}</span>
                        <span>•</span>
                        <span>${match.time}</span>
                    </div>
                </div>
                <div class="${badgeClass}" style="background: ${badgeBg}; color: ${badgeColor}; border: ${badgeBorder}">
                    ${isArb ? '+' : ''}${match.margin.toFixed(2)}% ${isArb ? 'Arb' : 'Margin'}
                </div>
            </div>

            <div class="strategy-picker">
                <button class="strat-btn ${strategy === 'arb' ? 'active' : ''}" onclick="updateMatchStrategy('${match.id}', 'arb')">Equal Arb</button>
                <button class="strat-btn ${strategy === 'under' ? 'active' : ''}" onclick="updateMatchStrategy('${match.id}', 'under')">Under-Hedge</button>
            </div>

            <div class="arb-body" style="grid-template-columns: repeat(${match.legs.length}, 1fr);">
                ${legsHtml}
            </div>
            
            <div style="background: rgba(0,0,0,0.2); padding: 1rem 1.5rem; border-top: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; flex-direction: column;">
                    <span style="color: var(--text-secondary); font-size: 0.75rem;">Total Return</span>
                    <strong style="color: var(--text-primary); font-size: 1rem;">${formatCurrency(guaranteedReturn)}</strong>
                </div>
                <div style="display: flex; gap: 1rem; align-items: center;">
                    <span style="color: ${profit >= 0 ? 'var(--accent-green)' : '#ff4444'}; font-weight: 700;">
                        ${profit >= 0 ? '+' : ''} ${formatCurrency(profit)}
                    </span>
                    <button class="log-btn" onclick="logBet('${match.id}', '${strategy}')">Log Bet</button>
                </div>
            </div>
        </div>
    `;
}

function updateMatchStrategy(matchId, newStrategy) {
    const card = document.getElementById(`card-${matchId}`);
    const matchIndex = loadedMatches.findIndex(m => m.id === matchId);
    if (matchIndex === -1) return;
    
    // Replace the card content with new strategy render
    const newHtml = renderArbCard(loadedMatches[matchIndex], matchIndex, newStrategy);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = newHtml;
    card.replaceWith(tempDiv.firstElementChild);
}

function updateDashboard() {
    if (loadedMatches.length === 0) return;

    let html = '';
    let arbCount = 0;
    
    // Display the top 10 matches (Arbs OR closest to Arb)
    const displayMatches = loadedMatches.slice(0, 10);
    
    displayMatches.forEach((match, index) => {
        if (match.isArb) arbCount++;
        html += renderArbCard(match, index);
    });

    DOM.arbFeed.innerHTML = html;
    
    // Update Metrics
    DOM.activeArbsCount.innerText = arbCount;
    DOM.activeArbsCount.className = arbCount > 0 ? "metric-value text-glow-green" : "metric-value";
    
    // Best margin is the first item after sorting
    const bestMatch = loadedMatches[0];
    DOM.bestMargin.innerText = bestMatch ? bestMatch.margin.toFixed(2) + '%' : '0.00%';
    DOM.bestMargin.className = (bestMatch && bestMatch.isArb) ? "metric-value text-glow-green" : "metric-value";
    
    DOM.statusText.innerHTML = '<span class="dot" style="background:var(--accent-green);"></span> Scan Complete';
}

// --- Navigation & Events ---
DOM.globalBankroll.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) {
        currentBankroll = val;
        localStorage.setItem('arb_bankroll', currentBankroll);
        updateDashboard();
        updatePortfolio();
    }
});

DOM.refreshBtn.addEventListener('click', fetchLiveArbs);

DOM.navDashboard.addEventListener('click', () => {
    DOM.navDashboard.classList.add('active');
    DOM.navPortfolio.classList.remove('active');
    DOM.navSettings.classList.remove('active');
    DOM.viewDashboard.style.display = 'block';
    DOM.viewPortfolio.style.display = 'none';
    DOM.viewSettings.style.display = 'none';
});

DOM.navPortfolio.addEventListener('click', () => {
    DOM.navPortfolio.classList.add('active');
    DOM.navDashboard.classList.remove('active');
    DOM.navSettings.classList.remove('active');
    DOM.viewDashboard.style.display = 'none';
    DOM.viewPortfolio.style.display = 'block';
    DOM.viewSettings.style.display = 'none';
    updatePortfolio();
});

function logBet(matchId, strategy) {
    const match = loadedMatches.find(m => m.id === matchId);
    if (!match) return;

    const stakes = calculateStakes(currentBankroll, match.totalProb, match.legs, strategy);
    const guaranteedReturn = (stakes[0].stake * stakes[0].odds);
    
    const newBet = {
        id: Date.now(),
        date: new Date().toLocaleDateString(),
        matchup: match.matchup,
        sport: match.sport,
        legs: stakes,
        totalStake: currentBankroll,
        possibleReturn: guaranteedReturn,
        status: 'pending'
    };

    betHistory.unshift(newBet);
    localStorage.setItem('arb_bet_history', JSON.stringify(betHistory));
    
    // Deduct from bankroll temporarily? No, usually hedge bettors keep bankroll as "active funds"
    // We just log it.
    
    alert("Bet Logged! Check the Portfolio tab to track results.");
    updatePortfolio();
}

function deleteBet(id) {
    if (!confirm("Delete this bet from history? This cannot be undone.")) return;
    
    betHistory = betHistory.filter(b => b.id !== id);
    localStorage.setItem('arb_bet_history', JSON.stringify(betHistory));
    updatePortfolio();
    updateDashboard();
}

function startEdit(id) {
    const bet = betHistory.find(b => b.id === id);
    if (bet) {
        bet.isEditing = true;
        updatePortfolio();
    }
}

function cancelEdit(id) {
    const bet = betHistory.find(b => b.id === id);
    if (bet) {
        delete bet.isEditing;
        updatePortfolio();
    }
}

function saveEdit(id) {
    const bet = betHistory.find(b => b.id === id);
    if (!bet) return;

    // Grab the new values from the inputs
    bet.legs.forEach((leg, idx) => {
        const oddsInput = document.getElementById(`edit-odds-${id}-${idx}`);
        const stakeInput = document.getElementById(`edit-stake-${id}-${idx}`);
        if (oddsInput) leg.odds = parseFloat(oddsInput.value) || leg.odds;
        if (stakeInput) leg.stake = parseFloat(stakeInput.value) || leg.stake;
    });

    // Recalculate totals
    bet.totalStake = bet.legs.reduce((sum, l) => sum + l.stake, 0);
    // Use first leg for guaranteed return calculation (they should be roughly equal in arb)
    bet.possibleReturn = bet.legs[0].stake * bet.legs[0].odds;
    
    delete bet.isEditing;
    localStorage.setItem('arb_bet_history', JSON.stringify(betHistory));
    updatePortfolio();
    updateDashboard();
}

function settleBet(id, result) {
    const bet = betHistory.find(b => b.id === id);
    if (!bet || bet.status !== 'pending') return;

    bet.status = result;
    
    if (result === 'won') {
        const netProfit = bet.possibleReturn - bet.totalStake;
        currentBankroll += netProfit;
    } else {
        currentBankroll -= bet.totalStake;
    }

    localStorage.setItem('arb_bankroll', currentBankroll);
    localStorage.setItem('arb_bet_history', JSON.stringify(betHistory));
    DOM.globalBankroll.value = currentBankroll.toFixed(2);
    updatePortfolio();
    updateDashboard();
}

function updatePortfolio() {
    let totalProfit = 0;
    let totalStaked = 0;
    let activeCount = 0;

    const tableHtml = betHistory.map(bet => {
        if (bet.status === 'pending') activeCount++;
        if (bet.status === 'won') totalProfit += (bet.possibleReturn - bet.totalStake);
        if (bet.status === 'lost') totalProfit -= bet.totalStake;
        totalStaked += bet.totalStake;

        const profitVal = bet.possibleReturn - bet.totalStake;
        const color = bet.status === 'won' ? 'var(--accent-green)' : (bet.status === 'lost' ? '#ff4444' : 'var(--text-primary)');

        if (bet.isEditing) {
            return `
                <tr class="editing-row">
                    <td>${bet.date}</td>
                    <td><strong>${bet.matchup}</strong></td>
                    <td colspan="3">
                        <div style="display: grid; gap: 4px;">
                            ${bet.legs.map((l, idx) => `
                                <div style="display: flex; gap: 8px; align-items: center; background: rgba(255,255,255,0.05); padding: 4px 8px; border-radius: 4px;">
                                    <span style="font-size: 0.7rem; width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${l.bookmaker}</span>
                                    <input type="number" step="0.01" value="${l.odds}" id="edit-odds-${bet.id}-${idx}" style="width: 60px; background: #222; border: 1px solid #444; color: white; padding: 2px 4px; border-radius: 4px;">
                                    <span style="font-size: 0.7rem;">@</span>
                                    <input type="number" step="0.1" value="${l.stake.toFixed(2)}" id="edit-stake-${bet.id}-${idx}" style="width: 70px; background: #222; border: 1px solid #444; color: white; padding: 2px 4px; border-radius: 4px;">
                                </div>
                            `).join('')}
                        </div>
                    </td>
                    <td><span class="status-badge status-${bet.status}">${bet.status}</span></td>
                    <td>
                        <button class="settle-btn" style="background: var(--accent-green); color: black;" onclick="saveEdit(${bet.id})">Save</button>
                        <button class="settle-btn" style="background: #444; color: white; margin-top: 4px;" onclick="cancelEdit(${bet.id})">Cancel</button>
                    </td>
                </tr>
            `;
        }

        return `
            <tr>
                <td>${bet.date}</td>
                <td><strong>${bet.matchup}</strong><br><small>${bet.sport}</small></td>
                <td>${bet.legs.length}-Way</td>
                <td>${formatCurrency(bet.totalStake)}</td>
                <td style="color: ${color}">${formatCurrency(bet.possibleReturn)}</td>
                <td><span class="status-badge status-${bet.status}">${bet.status}</span></td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        ${bet.status === 'pending' ? `
                            <div style="display: flex; gap: 4px;">
                                <button class="settle-btn settle-won" onclick="settleBet(${bet.id}, 'won')" style="flex:1">Won</button>
                                <button class="settle-btn settle-lost" onclick="settleBet(${bet.id}, 'lost')" style="flex:1">Lost</button>
                            </div>
                            <div style="display: flex; gap: 4px;">
                                <button class="settle-btn" onclick="startEdit(${bet.id})" style="flex:1; background: #333; color: white; height: 24px; padding: 0; font-size: 0.6rem;">✏️ Edit</button>
                                <button class="settle-btn" onclick="deleteBet(${bet.id})" style="flex:1; background: #333; color: #ff4444; height: 24px; padding: 0; font-size: 0.6rem;">🗑️ Del</button>
                            </div>
                        ` : `
                            <button class="settle-btn" onclick="deleteBet(${bet.id})" style="background: transparent; color: #666; font-size: 0.6rem;">🗑️ Remove</button>
                        `}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    DOM.betHistoryTable.innerHTML = tableHtml || '<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-secondary);">No bets logged yet.</td></tr>';
    
    DOM.portTotalProfit.innerText = formatCurrency(totalProfit);
    DOM.portTotalProfit.style.color = totalProfit >= 0 ? 'var(--accent-green)' : '#ff4444';
    
    const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0;
    DOM.portRoi.innerText = `${roi.toFixed(2)}%`;
    document.getElementById('port-active-bets').innerText = activeCount;
}

DOM.navSettings.addEventListener('click', () => {
    DOM.navSettings.classList.add('active');
    DOM.navDashboard.classList.remove('active');
    DOM.viewDashboard.style.display = 'none';
    DOM.viewSettings.style.display = 'flex';
    DOM.apiKeyInput.value = apiKey; // Show current key
    DOM.tgTokenInput.value = tgToken;
    DOM.tgChatIdInput.value = tgChatId;
});

DOM.saveSettingsBtn.addEventListener('click', () => {
    apiKey = DOM.apiKeyInput.value.trim();
    tgToken = DOM.tgTokenInput.value.trim();
    tgChatId = DOM.tgChatIdInput.value.trim();
    
    if (apiKey) localStorage.setItem('arb_api_key', apiKey);
    localStorage.setItem('tg_bot_token', tgToken);
    localStorage.setItem('tg_chat_id', tgChatId);
    
    DOM.saveSettingsBtn.innerText = "Saved!";
    setTimeout(() => DOM.saveSettingsBtn.innerText = "Save Settings", 2000);
});

DOM.findIdBtn.addEventListener('click', findChatId);

DOM.autoScanToggle.addEventListener('change', (e) => {
    updateTokenHealth();
    if (e.target.checked) {
        safeAutoScan(); // Run once immediately (if awake)
        // 500 requests/month = 2 sports = 250 scans/month = ~8 scans/day
        // To spread 8 scans across 15 waking hours -> 1 scan roughly every 2 hours (7200000 ms)
        autoScanInterval = setInterval(safeAutoScan, 7200000);
    } else {
        clearInterval(autoScanInterval);
        DOM.statusText.innerHTML = '<span class="dot" style="background:var(--accent-green);"></span> Scan Complete';
    }
});
// Wrapper that ensures we only scan during UK Waking Hours (8 AM to 11 PM)
function safeAutoScan() {
    const ukTimeStr = new Date().toLocaleString("en-GB", { timeZone: "Europe/London", hour12: false, hour: "numeric" });
    const ukHour = parseInt(ukTimeStr, 10);
    
    // If it's between 8 AM (08:00) and 10:59 PM (22:59)
    if (ukHour >= 8 && ukHour < 23) {
        fetchLiveArbs();
    } else {
        console.log("UK Sleep Hours: Skipping scan to save tokens.");
        DOM.statusText.innerHTML = '<span class="dot" style="background:var(--text-secondary);"></span> Paused (UK Sleep Hrs)';
    }
}

// --- UI Rendering Helpers ---
function renderSportsGrid() {
    const saved = JSON.parse(localStorage.getItem('selected_sports')) || ['basketball_nba', 'basketball_euroleague'];
    
    DOM.sportsGrid.innerHTML = SPORT_CONFIG.map(sport => `
        <label class="sport-option">
            <input type="checkbox" class="sport-checkbox" value="${sport.key}" ${saved.includes(sport.key) ? 'checked' : ''}>
            ${sport.name}
        </label>
    `).join('');

    // Add listeners to checkboxes
    document.querySelectorAll('.sport-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            const selected = Array.from(document.querySelectorAll('.sport-checkbox:checked')).map(c => c.value);
            localStorage.setItem('selected_sports', JSON.stringify(selected));
            updateTokenHealth();
        });
    });
}

function updateTokenHealth() {
    const selectedCount = document.querySelectorAll('.sport-checkbox:checked').length;
    const scansPerDay = DOM.autoScanToggle.checked ? 8 : 1;
    const monthlyUsage = selectedCount * scansPerDay * 31;
    const limit = 500;
    
    const usagePercent = Math.min((monthlyUsage / limit) * 100, 100);
    const scansRemaining = Math.max(0, limit);
    const daysLast = Math.floor(limit / (selectedCount * scansPerDay));
    const safetyDays = isFinite(daysLast) ? Math.min(daysLast, 31) : 31;

    DOM.tokenUsageInfo.innerText = `Using ~${monthlyUsage} tokens/month`;
    DOM.tokenDaysInfo.innerText = `Tokens will last ~${safetyDays} days`;
    
    DOM.healthProgress.style.width = `${usagePercent}%`;
    
    if (usagePercent < 70) {
        DOM.healthStatusText.innerText = "Safe";
        DOM.healthStatusText.className = "health-status-text safe";
        DOM.healthProgress.style.background = "var(--accent-green)";
    } else if (usagePercent < 100) {
        DOM.healthStatusText.innerText = "Warning";
        DOM.healthStatusText.className = "health-status-text warning";
        DOM.healthProgress.style.background = "#ffaa44";
    } else {
        DOM.healthStatusText.innerText = "Danger";
        DOM.healthStatusText.className = "health-status-text danger";
        DOM.healthProgress.style.background = "#ff4444";
    }
}

// Init - set settings value if exists
DOM.apiKeyInput.value = apiKey;
DOM.tgTokenInput.value = tgToken;
DOM.tgChatIdInput.value = tgChatId;

renderSportsGrid();
updateTokenHealth();
