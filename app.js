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

function calculateStakes(globalBankroll, totalProb, legs) {
    // To guarantee equal profit, stake is proportional to implied probability
    return legs.map(leg => {
        const prob = 1 / leg.odds;
        const stake = (globalBankroll * prob) / totalProb;
        return { ...leg, stake };
    });
}

// Formatters
const formatCurrency = (val) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(val);
const formatOdds = (val) => val.toFixed(2);

// App State
let currentBankroll = 1000;
let apiKey = localStorage.getItem('arb_api_key') || ''; 
let tgToken = localStorage.getItem('tg_bot_token') || '';
let tgChatId = localStorage.getItem('tg_chat_id') || '';

let loadedMatches = [];
let autoScanInterval = null;

const SPORT_CONFIG = [
    { key: 'basketball_nba', name: 'NBA (Basketball)' },
    { key: 'basketball_euroleague', name: 'EuroLeague' },
    { key: 'basketball_ncaab', name: 'NCAAB (College)' },
    { key: 'soccer_epl', name: 'Premier League' },
    { key: 'soccer_uefa_champions_league', name: 'Champions League' },
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
    navSettings: document.getElementById('nav-settings'),
    viewDashboard: document.getElementById('view-dashboard'),
    viewSettings: document.getElementById('view-settings'),
    
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
    let testToken = combined.length > 20 ? combined : '';
    if (testToken.toLowerCase().startsWith('bot')) testToken = testToken.substring(3);

    if (!testToken) {
        DOM.findIdStatus.innerText = "Error: Paste your Bot Token first!";
        DOM.findIdStatus.style.color = "#ff4444";
        return;
    }

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
        DOM.findIdStatus.innerText = "Error: Connection failed.";
        DOM.findIdStatus.style.color = "#ff4444";
    }
}
async function sendTelegramReport(topMatches) {
    if (!tgToken || !tgChatId) return;
    
    let reportText = `\uD83C\uDFC6 *House of Bebington: Top 3 Report*\n\n`;
    
    topMatches.forEach((match, i) => {
        const sign = match.isArb ? '\uD83D\uDEA8 ' : '\uD83D\uDCCA ';
        const marginSign = match.margin > 0 ? '+' : '';
        reportText += `${sign}#${i+1}: ${match.matchup}\n`;
        reportText += `Margin: ${marginSign}${match.margin.toFixed(2)}%\n`;
        
        match.legs.forEach(leg => {
            reportText += `\u2022 ${leg.bookmaker}: ${formatOdds(leg.odds)}\n`;
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
            console.error("Telegram API Error", json.description);
        }
    } catch (e) {
        console.error("Telegram Report Failed", e);
    }
}

// --- API Logic ---
async function fetchLiveArbs() {
    // Aggressive Sanitization: Remove hidden spaces or invisible characters
    const cleanApiKey = apiKey.trim().replace(/[^a-z0-9]/gi, '');
    
    if (!cleanApiKey) {
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
            const targetUrl = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${cleanApiKey}&regions=uk&markets=h2h&oddsFormat=decimal`;
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
            const bestOdds = {}; // Map of outcome_name -> { price, bookmaker }
            
            game.bookmakers.forEach(bookie => {
                const h2h = bookie.markets.find(m => m.key === 'h2h');
                if (h2h) {
                    h2h.outcomes.forEach(outcome => {
                        const name = outcome.name;
                        const price = outcome.price;
                        
                        if (!bestOdds[name] || price > bestOdds[name].price) {
                            bestOdds[name] = { 
                                outcome: name, 
                                odds: price, 
                                bookmaker: bookie.title 
                            };
                        }
                    });
                }
            });

            // Convert map to array of legs
            const legs = Object.values(bestOdds);
            
            // Only consider games where we found odds for all sides
            if (legs.length >= 2) {
                const calc = calculateArbitrage(legs);
                
                // TWO-BOOKIE RULE: Count unique bookmakers
                const uniqueBookies = new Set(legs.map(l => l.bookmaker));
                const hasVariety = uniqueBookies.size > 1;

                matches.push({
                    id: game.id,
                    sport: game.sport_title,
                    matchup: `${game.home_team} vs ${game.away_team}`,
                    time: new Date(game.commence_time).toLocaleString(),
                    legs: legs,
                    margin: calc.margin,
                    totalProb: calc.totalProb,
                    isArb: calc.isArb && hasVariety, // Only TRUE Arb if from different houses
                    hasVariety: hasVariety
                });
            }
        });

        // SORTING: 
        // 1. Genuine Arbs (Different bookies) first, highest margin
        // 2. High margin single-bookie (non-arbs) second
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
function renderArbCard(match, index) {
    // If it's not an arb, we modify the styling slightly to show it's just a narrow margin
    const isArb = match.isArb;
    const badgeClass = isArb ? 'arb-profit-badge' : 'arb-profit-badge'; // We can use the same shape
    const badgeColor = isArb ? 'var(--accent-green)' : 'var(--text-secondary)';
    const badgeBg = isArb ? 'var(--accent-green-dim)' : 'rgba(255,255,255,0.05)';
    const badgeBorder = isArb ? '1px solid rgba(0, 255, 136, 0.2)' : '1px solid var(--border-color)';
    const cardBorderHighlight = isArb ? 'var(--accent-green)' : 'rgba(255,255,255,0.1)';

    const stakedLegs = calculateStakes(currentBankroll, match.totalProb, match.legs);
    
    // Total return is Stake * Decimal Odds (they will all be equal by definition of the math)
    const guaranteedReturn = stakedLegs[0].stake * stakedLegs[0].odds;
    const profit = guaranteedReturn - currentBankroll;

    let legsHtml = '';
    stakedLegs.forEach(leg => {
        legsHtml += `
            <div class="arb-leg">
                <div class="leg-top">
                    <div>
                        <div class="bookmaker-name">${leg.bookmaker}</div>
                        <div class="leg-outcome">${leg.outcome}</div>
                    </div>
                    <div class="leg-odds">${formatOdds(leg.odds)}</div>
                </div>
                <div class="leg-bet-amount">
                    <span class="bet-label">Suggested Stake</span>
                    <span class="bet-value">${formatCurrency(leg.stake)}</span>
                </div>
            </div>
        `;
    });

    return `
        <div class="arb-card animate-slide-in" style="animation-delay: ${index * 0.05}s">
            <style>
                .arb-card.card-${index}::before { background: ${cardBorderHighlight}; box-shadow: 0 0 12px ${cardBorderHighlight}; }
            </style>
            <div class="arb-header card-${index}">
                <div class="arb-game-info">
                    <h3>${match.matchup}</h3>
                    <div class="arb-meta">
                        <span>${match.sport}</span>
                        <span>\u2022</span>
                        <span>${match.time}</span>
                    </div>
                </div>
                <div class="${badgeClass}" style="background: ${badgeBg}; color: ${badgeColor}; border: ${badgeBorder}">
                    ${isArb ? '+' : ''}${match.margin.toFixed(2)}% ${isArb ? 'Arb' : 'Margin'}
                </div>
            </div>
            <div class="arb-body" style="grid-template-columns: repeat(${match.legs.length}, 1fr);">
                ${legsHtml}
            </div>
            
            <div style="background: rgba(0,0,0,0.2); padding: 1rem 1.5rem; border-top: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-secondary); font-size: 0.875rem;">Total Return: <strong style="color: var(--text-primary);">${formatCurrency(guaranteedReturn)}</strong></span>
                <span style="color: ${isArb ? 'var(--accent-green)' : 'var(--text-secondary)'}; font-weight: 700;">
                    ${isArb ? '+' : ''} ${formatCurrency(profit)} ${isArb ? 'Profit' : 'Loss'}
                </span>
            </div>
        </div>
    `;
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
        updateDashboard();
    }
});

DOM.refreshBtn.addEventListener('click', fetchLiveArbs);

DOM.navDashboard.addEventListener('click', () => {
    DOM.navDashboard.classList.add('active');
    DOM.navSettings.classList.remove('active');
    DOM.viewDashboard.style.display = 'block';
    DOM.viewSettings.style.display = 'none';
});

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
