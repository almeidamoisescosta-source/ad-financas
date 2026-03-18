/**
 * ADFinanças - Core Application Logic (Alasql Version)
 * Optimized for local file usage (file://)
 */

let currentUser = null;
const MASTER_USER = { email: "moises@", password: "ad2026", role: "MASTER", name: "MASTER" };
const USER_SESSIONS = {};

const CHURCH_INFO = {
    name: "Igreja Evangelica Assembleia de Deus em Luis Domingues-MA",
    address: "Rua Duque de Caxias, Centro"
};

// --- Cloud Configuration ---
const safeFormat = (val) => {
    const value = (val === null || val === undefined || isNaN(val)) ? 0 : parseFloat(val);
    return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
};

const getFormattedMonth = (monthStr) => {
    if (!monthStr) return "";
    const [year, month] = monthStr.split('-');
    const names = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    return `${names[parseInt(month) - 1]} / ${year}`;
};

let supabase = null;
const CLOUD_CONFIG = {
    url: localStorage.getItem('sb_url') || '',
    key: localStorage.getItem('sb_key') || '',
    enabled: localStorage.getItem('sb_enabled') === 'true'
};
let isSyncing = false;

function initSupabase() {
    if (CLOUD_CONFIG.enabled && CLOUD_CONFIG.url && CLOUD_CONFIG.key) {
        try {
            const { createClient } = window.supabase;
            supabase = createClient(CLOUD_CONFIG.url, CLOUD_CONFIG.key);
            console.log("Supabase Cloud Connected.");
            
            // Realtime Subscription
            supabase.channel('custom-all-channel')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, payload => {
                    console.log('Realtime change:', payload);
                    handleRealtimeChange(payload);
                })
                .subscribe();
        } catch (e) {
            console.error("Supabase Init Error:", e);
        }
    }
}

// --- Initialization ---
function handleUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('sb_url');
    const key = params.get('sb_key');
    
    if (url && key) {
        localStorage.setItem('sb_url', url);
        localStorage.setItem('sb_key', key);
        localStorage.setItem('sb_enabled', 'true');
        
        // Update CLOUD_CONFIG immediately
        CLOUD_CONFIG.url = url;
        CLOUD_CONFIG.key = key;
        CLOUD_CONFIG.enabled = true;
        
        alert("Configuração automática do Supabase aplicada com sucesso!");
        
        // Clean URL without reloading
        const cleanUrl = window.location.href.split('?')[0].split('#')[0];
        window.history.pushState({path:cleanUrl},'',cleanUrl);
    }
}

async function initApp() {
    try {
        handleUrlParams();
        console.log("Initializing Alasql...");
        
        // Setup Alasql Persistence
        alasql('CREATE localStorage DATABASE IF NOT EXISTS church_db');
        alasql('ATTACH localStorage DATABASE church_db');
        alasql('USE church_db');

        // Create Schema
        createSchema();
        
        // Init Cloud
        initSupabase();
        
        // Auto-Pull from Cloud
        if (supabase) {
            await pullFromCloud();
        }
        
        setupGlobalEvents();
        
        // Auto-Login
        const lastUser = localStorage.getItem('last_user');
        if (lastUser) {
            currentUser = JSON.parse(lastUser);
            USER_SESSIONS[currentUser.id] = { name: currentUser.name, lastActive: Date.now() };
            showPage("main-container");
            loadTab("dashboard");
            console.log("Auto-Login successful:", currentUser.name);
        }

        // Apply Theme
        const savedTheme = localStorage.getItem('church_theme') || 'default';
        const root = document.documentElement;
        if (savedTheme === 'emerald') root.style.setProperty('--bg-gradient', 'linear-gradient(135deg, #dcfce7, #f0fdf4)');
        else if (savedTheme === 'dark') root.style.setProperty('--bg-gradient', 'linear-gradient(135deg, #1e293b, #0f172a)');
        else if (savedTheme === 'gold') root.style.setProperty('--bg-gradient', 'linear-gradient(135deg, #fefce8, #fef9c3)');
        else root.style.setProperty('--bg-gradient', 'linear-gradient(135deg, #f8fafc, #f1f5f9)');

        // Hide Loader
        setTimeout(() => {
            document.getElementById("app-loading").style.display = "none";
        }, 500);

        console.log("ADFinanças Ready.");
    } catch (err) {
        console.error("Init Error:", err);
        alert("Erro ao carregar banco de dados: " + err.message);
    }
}

function createSchema() {
    alasql(`CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, email STRING, password STRING, name STRING, role STRING)`);
    alasql(`CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY, type STRING, category STRING, description STRING, 
        amount FLOAT, date STRING, method STRING, observation STRING, user_id INT, user_name STRING, month_ref STRING, sync_id STRING
    )`);
    
    // Migration: Direct ALTER TABLE (Safe way for Alasql + LocalStorage)
    const migrate = (col, type) => {
        try {
            alasql(`ALTER TABLE transactions ADD COLUMN ${col} ${type}`);
            console.log(`Migration: Added ${col}`);
        } catch (e) {
            // Ignore if column already exists
        }
    };

    migrate('user_id', 'INT');
    migrate('user_name', 'STRING');
    migrate('month_ref', 'STRING');
    migrate('sync_id', 'STRING');
    
    // Check if master exists
    const master = alasql('SELECT * FROM users WHERE email = ?', [MASTER_USER.email]);
    if (master.length === 0) {
        alasql('INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)', 
            [MASTER_USER.email, MASTER_USER.password, MASTER_USER.name, MASTER_USER.role]);
    }
}

// --- Auth & Navigation ---
function setupGlobalEvents() {
    const loginForm = document.getElementById("login-form");
    if(loginForm) {
        loginForm.addEventListener("submit", async e => {
            e.preventDefault();
            const email = document.getElementById("login-email").value;
            const pass = document.getElementById("login-password").value;
            
            let user = null;
            if (supabase) {
                const { data } = await supabase.from('users').select('*').eq('email', email).eq('password', pass).single();
                if (data) user = data;
            }
            
            if (!user) {
                const results = alasql('SELECT * FROM users WHERE email=? AND password=?', [email, pass]);
                if (results.length > 0) user = results[0];
            }
            
            if (user) {
                currentUser = user;
                localStorage.setItem('last_user', JSON.stringify(currentUser));
                USER_SESSIONS[currentUser.id] = { name: currentUser.name, lastActive: Date.now() };
                showPage("main-container");
                loadTab("dashboard");
                alert("Bem Vindo ao ADFinança da Assembleia de Deus em Luis Domingues-MA");
            } else {
                alert("Acesso Negado. Verifique o login e a senha.");
            }
        });
    }


    document.querySelectorAll(".nav-item").forEach(btn => {
        btn.addEventListener("click", () => loadTab(btn.dataset.tab));
    });
    
    document.getElementById("btn-back").addEventListener("click", () => handleNav('back'));
    document.getElementById("btn-forward").addEventListener("click", () => handleNav('forward'));
}

function showPage(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

let tabHistory = ["dashboard"];
function loadTab(tab) {
    if (tabHistory[tabHistory.length - 1] !== tab) tabHistory.push(tab);
    document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.tab === tab));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.toggle("active", c.id === `tab-${tab}`));
    
    const titles = { dashboard: "Menu Principal", tithes: "Dízimos", offerings: "Ofertas" };
    document.getElementById("current-page-title").innerText = titles[tab] || "ADFinanças";

    if (tab === "dashboard") renderDashboard();
    else renderFinancialTab(tab === "tithes" ? "tithe" : "offering");
}

function handleNav(dir) {
    if (dir === 'back' && tabHistory.length > 1) {
        tabHistory.pop();
        loadTab(tabHistory[tabHistory.length - 1]);
    }
}

// --- Dashboard Logic ---
async function renderDashboard() {

    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);
    const prevDate = new Date();
    prevDate.setMonth(prevDate.getMonth() - 1);
    const prevMonth = prevDate.toISOString().slice(0, 7);

    const getStats = async (type, month) => {
        try {
            if (supabase) {
                let query = supabase.from('transactions').select('category, amount').eq('type', type).eq('month_ref', month);
                if (currentUser.role !== 'MASTER') query = query.eq('user_id', currentUser.id);
                const { data } = await query;
                if (data) {
                    const inc = data.filter(r => r.category === 'income').reduce((s, r) => s + r.amount, 0);
                    const exp = data.filter(r => r.category === 'expense').reduce((s, r) => s + r.amount, 0);
                    return { inc, exp };
                }
            }
            let sql = 'SELECT SUM(CASE WHEN category="income" THEN amount ELSE 0 END) as inc, SUM(CASE WHEN category="expense" THEN amount ELSE 0 END) as exp FROM transactions WHERE type=? AND month_ref=?';
            const params = [type, month];
            if (currentUser.role !== 'MASTER') {
                sql += ' AND user_id=?';
                params.push(currentUser.id);
            }
            const res = alasql(sql, params);
            if (res && res.length > 0 && res[0]) {
                return { inc: res[0].inc || 0, exp: res[0].exp || 0 };
            }
        } catch (e) { console.error("Stats Error:", e); }
        return { inc: 0, exp: 0 };
    };

    const getBalance = async (month) => {
        try {
            if (supabase) {
                let query = supabase.from('transactions').select('category, amount').eq('month_ref', month);
                if (currentUser.role !== 'MASTER') query = query.eq('user_id', currentUser.id);
                const { data } = await query;
                if (data) {
                    return data.reduce((s, r) => s + (r.category === 'income' ? r.amount : -r.amount), 0);
                }
            }
            let sql = 'SELECT SUM(CASE WHEN category="income" THEN amount ELSE -amount END) as bal FROM transactions WHERE month_ref=?';
            const params = [month];
            if (currentUser.role !== 'MASTER') {
                sql += ' AND user_id=?';
                params.push(currentUser.id);
            }
            const res = alasql(sql, params);
            if (res && res.length > 0 && res[0] && res[0].bal !== undefined) {
                return res[0].bal || 0;
            }
        } catch (e) { console.error("Balance Error:", e); }
        return 0;
    };

    const tCur = await getStats('tithe', currentMonth);
    const oCur = await getStats('offering', currentMonth);
    
    const prevBal = await getBalance(prevMonth);
    const currentBal = await getBalance(currentMonth);



    const syncStatus = CLOUD_CONFIG.enabled ? (supabase ? (isSyncing ? '⏳ Sincronizando...' : '🟢 Nuvem Ativa') : '🔴 Nuvem Offline') : '⚪ Local-only';


    const tab = document.getElementById("tab-dashboard");
    tab.innerHTML = `
        <div class="glass-card info-block" style="display:flex; justify-content:space-between; align-items:center; border:none; background:white; padding:15px;">
             <span style="font-weight:600; font-size:0.9rem;">${new Date().toLocaleDateString('pt-BR')}</span>
             <span style="font-size:0.7rem; color:var(--text-dim); background:#f1f5f9; padding:6px 12px; border-radius:20px; font-weight:600;">${syncStatus}</span>
             <button onclick="handleExit()" style="background:none; border:none; font-size:1.2rem; cursor:pointer; opacity:0.6;">🚪</button>
        </div>

        <div class="glass-card total-card info-block" style="background:white; border: 1px solid #e2e8f0;">
            <span class="stat-label" style="text-transform:uppercase; letter-spacing:1px; font-weight:700;">RESUMO FINANCEIRO</span>
            <div style="display:flex; justify-content:space-around; margin-top:20px;">
                <div><small style="color:var(--text-dim)">Saldo Anterior</small><div class="stat-value" style="color:var(--text-main)">R$ ${safeFormat(prevBal)}</div></div>
                <div><small style="color:var(--text-dim)">Saldo Atual</small><div class="stat-value" style="color:var(--primary)">R$ ${safeFormat(currentBal)}</div></div>
            </div>
            <div style="margin-top:20px; border-top:1px solid #f1f5f9; padding-top:15px;">
                <small style="color:var(--text-dim)">SALDO TOTAL ACUMULADO</small>
                <div class="stat-value" style="font-size:1.8rem; color:var(--text-main)">R$ ${safeFormat(prevBal + currentBal)}</div>
            </div>
        </div>

        <div class="info-block">
            <h3 class="block-title" style="color:var(--text-main)">📊 Dízimos</h3>
            <div class="glass-card stats-grid" style="background:white; border: 1px solid #e2e8f0;">
                <div class="stat-item"><span class="stat-label">Entradas</span><span class="stat-value" style="color:#10b981">R$ ${safeFormat(tCur.inc)}</span></div>
                <div class="stat-item"><span class="stat-label">Saídas</span><span class="stat-value" style="color:#ef4444">R$ ${safeFormat(tCur.exp)}</span></div>
                <div class="stat-item" style="grid-column: span 2; border-top:1px solid #f1f5f9;"><span class="stat-label">Saldo Dízimos</span><span class="stat-value" style="color:var(--text-main)">R$ ${safeFormat(tCur.inc - tCur.exp)}</span></div>
            </div>
        </div>

        <div class="info-block">
            <h3 class="block-title" style="color:var(--text-main)">🎁 Ofertas</h3>
            <div class="glass-card stats-grid" style="background:white; border: 1px solid #e2e8f0;">
                <div class="stat-item"><span class="stat-label">Entradas</span><span class="stat-value" style="color:#10b981">R$ ${safeFormat(oCur.inc)}</span></div>
                <div class="stat-item"><span class="stat-label">Saídas</span><span class="stat-value" style="color:#ef4444">R$ ${safeFormat(oCur.exp)}</span></div>
                <div class="stat-item" style="grid-column: span 2; border-top:1px solid #f1f5f9;"><span class="stat-label">Saldo Ofertas</span><span class="stat-value" style="color:var(--text-main)">R$ ${safeFormat(oCur.inc - oCur.exp)}</span></div>
            </div>
        </div>

        <div class="action-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:30px;">
            <button class="btn-primary" onclick="showReports()" style="background:#f8fafc; color:var(--text-main); border:1px solid #e2e8f0; box-shadow:none;">📄 Relatórios</button>
            ${currentUser.role === 'MASTER' ? `
                <button class="btn-primary" onclick="showInfo()" style="background:#f8fafc; color:var(--text-main); border:1px solid #e2e8f0; box-shadow:none;">ℹ️ Informação</button>
                <button class="btn-primary" onclick="showUserMgmt()" style="background:#f8fafc; color:var(--text-main); border:1px solid #e2e8f0; box-shadow:none;">👥 Usuários</button>
                <button class="btn-primary" onclick="showConfig()" style="background:#f8fafc; color:var(--text-main); border:1px solid #e2e8f0; box-shadow:none;">⚙️ Config</button>
            ` : ''}
            <button class="btn-primary" onclick="handleExit()" style="background:#fee2e2; color:#b91c1c; grid-column: span 2; box-shadow:none;">🚪 Finalizar Sessão</button>
        </div>

    `;
}

// --- Financial Management Logic ---
function renderFinancialTab(type) {
    const tabId = type === 'tithe' ? 'tab-tithes' : 'tab-offerings';
    const tab = document.getElementById(tabId);
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);

    let sqlSum = 'SELECT SUM(CASE WHEN category="income" THEN amount ELSE 0 END) as ent, SUM(CASE WHEN category="expense" THEN amount ELSE 0 END) as sai FROM transactions WHERE type=? AND month_ref=?';
    const paramsSum = [type, currentMonth];
    if (currentUser.role !== 'MASTER') {
        sqlSum += ' AND user_id=?';
        paramsSum.push(currentUser.id);
    }
    const res = alasql(sqlSum, paramsSum)[0];
    const ent = res.ent || 0;
    const sai = res.sai || 0;

    tab.innerHTML = `
        <div class="glass-card info-block">
            <div style="display:flex; justify-content:space-between; margin-bottom:15px;">
                <div style="text-align:center"><small>Entradas</small><div class="stat-value up">R$ ${safeFormat(ent)}</div></div>
                <div style="text-align:center"><small>Saídas</small><div class="stat-value down">R$ ${safeFormat(sai)}</div></div>
                <div style="text-align:center"><small>Saldo</small><div class="stat-value">R$ ${safeFormat(ent - sai)}</div></div>
            </div>
            <form id="trans-form-${type}" onsubmit="handleSaveTransaction(event, '${type}')">
                <div class="input-group">
                    <label>Descrição</label>
                    <input type="text" id="${type}-desc" required oninput="this.value = this.value.toUpperCase()">
                </div>
                <div class="input-group" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <div>
                        <label>Valor</label>
                        <input type="number" step="0.01" id="${type}-val" required>
                    </div>
                    <div>
                        <label>Tipo</label>
                        <select id="${type}-cat" style="width:100%; padding:12px; border-radius:12px; background:#ffffff; border:1px solid #e2e8f0; color:var(--text-main); font-weight:600;">
                            <option value="income">Entrada</option>
                            <option value="expense">Saída</option>
                        </select>
                    </div>
                </div>
                <div class="input-group">
                    <label>Data</label>
                    <input type="date" id="${type}-date" value="${now.toISOString().split('T')[0]}" required>
                </div>
                ${type === 'offering' ? `
                    <div class="input-group">
                        <label>Observação</label>
                        <input type="text" id="${type}-obs">
                    </div>
                ` : ''}
                <button type="submit" class="btn-primary">Salvar ${type === 'tithe' ? 'Dízimo' : 'Oferta'}</button>
            </form>
        </div>


        <div class="info-block">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:15px;">
                <h3 style="margin:0;">Lançamentos</h3>
                <div style="display:flex; gap:8px;">
                    <input type="month" id="t-month" value="${currentMonth}" onchange="renderListView('${type}')" style="background:white; color:var(--text-main); border:1px solid #e2e8f0; border-radius:8px; padding:6px; font-weight:600; font-size:0.8rem; outline:none;">
                    <select id="t-filter" onchange="renderListView('${type}')" style="background:white; color:var(--text-main); border:1px solid #e2e8f0; border-radius:8px; padding:6px; font-weight:600; font-size:0.8rem; outline:none;">
                        <option value="all">Ver Tudo</option>
                        <option value="income">Só Entradas</option>
                        <option value="expense">Só Saídas</option>
                    </select>
                    ${currentUser.role === 'MASTER' ? `
                        <select id="t-user" onchange="renderListView('${type}')" style="background:white; color:var(--text-main); border:1px solid #e2e8f0; border-radius:8px; padding:6px; font-weight:600; font-size:0.8rem; outline:none;">
                            <option value="all">Todos Usuários</option>
                            ${alasql("SELECT id, name FROM users").map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
                        </select>
                    ` : ''}
                </div>
            </div>
            <div id="list-${type}"></div>
        </div>
    `;
    renderListView(type);
}

function handleSaveTransaction(e, type) {
    e.preventDefault();
    const desc = document.getElementById(`${type}-desc`).value;
    const val = parseFloat(document.getElementById(`${type}-val`).value);
    const date = document.getElementById(`${type}-date`).value;
    const cat = document.getElementById(`${type}-cat`).value;
    const obs = document.getElementById(`${type}-obs`)?.value || "";
    const month = date.slice(0, 7);

    const nowMonth = new Date().toISOString().slice(0, 7);
    if (month < nowMonth && currentUser.role !== 'MASTER') {
        return alert("Somente o usuário MASTER pode alterar meses finalizados.");
    }

    // Modal with Closure-based confirmation instead of string-injection to avoid quote issues
    showModal(`
        <div class="glass-card" style="max-width:320px; text-align:center; background:white; border:none; padding:30px;">
            <h3 style="color:var(--text-main); font-size:1.2rem; margin-bottom:10px;">Forma de Pagamento</h3>
            <p style="color:var(--text-dim); font-size:0.9rem; margin-bottom:25px;">Escolha como foi recebido ou pago o valor:</p>
            <div style="display:flex; flex-direction:column; gap:12px;">
                <button class="btn-primary" id="btn-pay-cash" style="background:#f8fafc; color:var(--text-main); border:1px solid #e2e8f0; box-shadow:none; font-weight:600;">💵 Espécie (Dinheiro)</button>
                <button class="btn-primary" id="btn-pay-pix" style="background:#f0f9ff; color:#0369a1; border:1px solid #bae6fd; box-shadow:none; font-weight:600;">📱 Transferência / PIX</button>
            </div>
            <button class="btn-primary" onclick="hideModal()" style="margin-top:20px; background:none; color:var(--text-dim); box-shadow:none; font-size:0.85rem; font-weight:500;">Cancelar</button>
        </div>
    `);

    document.getElementById("btn-pay-cash").onclick = () => confirmSave(type, cat, desc, val, date, 'ESPÉCIE', obs);
    document.getElementById("btn-pay-pix").onclick = () => confirmSave(type, cat, desc, val, date, 'PIX', obs);
}


window.confirmSave = async (type, category, description, amount, date, method, observation) => {
    const sync_id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    const data = { type, category, description, amount, date, method, observation, user_id: currentUser.id, user_name: currentUser.name, month_ref: date.slice(0, 7), sync_id };
    
    // Save to Local
    try {
        alasql("INSERT INTO transactions (type, category, description, amount, date, method, observation, user_id, user_name, month_ref, sync_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [type, category, description, amount, date, method, observation, currentUser.id, currentUser.name, date.slice(0, 7), sync_id]);
    } catch (e) {
        console.error("Local Insert Error:", e);
        if (e.message.includes("Column does not exist")) {
            console.log("Attempting emergency migration...");
            createSchema();
            // Retry once
            try {
                alasql("INSERT INTO transactions (type, category, description, amount, date, method, observation, user_id, user_name, month_ref, sync_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    [type, category, description, amount, date, method, observation, currentUser.id, currentUser.name, date.slice(0, 7), sync_id]);
            } catch (e2) {
                alert("Erro crítico: O banco de dados está desatualizado. Por favor, use a opção 'Corrigir Erro' no menu de Informação.");
                throw e2;
            }
        } else {
            throw e;
        }
    }
    
    // Save to Cloud
    if (supabase) {
        try {
            await supabase.from('transactions').insert([data]);
        } catch (e) { console.error("Cloud Save Error:", e); }
    }
    
    hideModal();
    loadTab(type === 'tithe' ? 'tithes' : 'offerings');
};


async function fetchTransactions(type, month, filter = 'all', userId = 'all') {
    let sql = "SELECT * FROM transactions WHERE type=? AND month_ref=?";
    const params = [type, month];
    if (filter !== 'all') { sql += " AND category=?"; params.push(filter); }
    
    if (currentUser.role === 'MASTER') {
        if (userId !== 'all') { sql += " AND user_id=?"; params.push(parseInt(userId)); }
    } else {
        sql += " AND user_id=?"; params.push(currentUser.id);
    }
    
    sql += " ORDER BY date DESC, id DESC";
    return alasql(sql, params);
}


async function renderListView(type) {
    const filterInput = document.getElementById("t-filter");
    const monthInput = document.getElementById("t-month");
    const userInput = document.getElementById("t-user");
    
    const filter = filterInput ? filterInput.value : 'all';
    const month = monthInput ? monthInput.value : new Date().toISOString().slice(0, 7);
    const userId = userInput ? userInput.value : 'all';
    
    const data = await fetchTransactions(type, month, filter, userId);
    const container = document.getElementById(`list-${type}`);

    container.innerHTML = "";

    if (data.length === 0) {
        container.innerHTML = "<p style='text-align:center; opacity:0.5;'>Nenhum registro encontrado.</p>";
        return;
    }

    data.forEach(row => {
        const item = document.createElement("div");
        item.className = "glass-card";
        item.style = "margin-bottom:12px; padding:18px; display:flex; justify-content:space-between; align-items:center; background:white; border:1px solid #f1f5f9; box-shadow:0 2px 8px rgba(0,0,0,0.02);";
        item.innerHTML = `
            <div style="flex:2">
                <div style="font-weight:700; color:var(--text-main); font-size:1rem;">${row.description}</div>
                <div style="font-size:0.75rem; color:var(--text-dim); margin-top:4px; font-weight:500;">
                    ${row.date.split('-').reverse().join('/')} • <span style="color:var(--primary)">${row.method}</span> • ${row.user_name}
                </div>
            </div>
            <div style="text-align:right; flex:1">
                <div style="font-size:1rem; font-weight:700; color:${row.category === 'income' ? '#10b981' : '#ef4444'}">
                    ${row.category === 'income' ? '+' : '-'} R$ ${safeFormat(row.amount)}
                </div>
                <div style="margin-top:8px; display:flex; justify-content:flex-end; gap:12px;">
                    ${(currentUser.role === 'MASTER' || row.user_id === currentUser.id) ? `
                        <button onclick="editTransaction(${row.id})" style="background:none; border:none; color:var(--primary); font-size:1rem; cursor:pointer; opacity:0.8; transition:opacity 0.2s;">✏️</button>
                        <button onclick="deleteTransaction(${row.id})" style="background:none; border:none; color:var(--accent); font-size:1rem; cursor:pointer; opacity:0.8; transition:opacity 0.2s;">🗑️</button>
                    ` : ''}
                </div>
            </div>
        `;
        container.appendChild(item);
    });
}

// --- Reports ---
window.generateReport = async (fmt) => {
    const month = document.getElementById("rep-month").value;
    const filter = document.getElementById("rep-filter").value;
    
    let sql = "SELECT * FROM transactions WHERE month_ref=?";
    const params = [month];
    if (filter !== 'total') {
        sql += " AND type=?";
        params.push(filter);
    }
    if (currentUser.role !== 'MASTER') {
        sql += " AND user_id=?";
        params.push(currentUser.id);
    }
    const dataRows = alasql(sql, params);
    if (dataRows.length === 0) return alert("Sem dados para este período.");

    const formattedData = dataRows.map(r => ({
        Data: r.date.split('-').reverse().join('/'),
        Tipo: r.type === 'tithe' ? 'Dízimo' : 'Oferta',
        Mov: r.category === 'income' ? 'Entrada' : 'Saída',
        Descrição: r.description,
        Valor: r.amount,
        Método: r.method,
        Usuário: r.user_name
    }));

    if (fmt === 'excel') {
        const ws = XLSX.utils.json_to_sheet(formattedData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Relatório");
        XLSX.writeFile(wb, `Relatorio_${month}.xlsx`);
    } else {
        try {
            console.log("Generating PDF...");
            
            // Check for library presence
            if (!window.jspdf && !window.jsPDF) {
                throw new Error("Biblioteca jsPDF não carregada. Verifique se a pasta 'lib' existe.");
            }

            const { jsPDF } = window.jspdf || window;
            const doc = new jsPDF();
            const localizedMonth = getFormattedMonth(month);
            
            // Try to add logo
            try {
                const logoImg = await fetch('logo.png').then(r => r.blob()).then(blob => new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                }));
                doc.addImage(logoImg, 'PNG', 15, 12, 18, 18);
            } catch (e) { console.warn("Logo not found for PDF:", e); }

            doc.setFontSize(10);
            doc.text(CHURCH_INFO.name, 105, 15, { align: 'center' });
            doc.text(CHURCH_INFO.address, 105, 20, { align: 'center' });
            doc.setFontSize(14);
            doc.text(`Relatório Referente ao Mês: ${localizedMonth}`, 105, 30, { align: 'center' });
            
            // autoTable detection
            if (typeof doc.autoTable !== 'function') {
                throw new Error("Plugin AutoTable não encontrado. Verifique os arquivos na pasta 'lib'.");
            }

            doc.autoTable({
                startY: 35,
                head: [['Data', 'Tipo', 'Mov', 'Descrição', 'Valor', 'Método', 'Usuário']],
                body: formattedData.map(d => [d.Data, d.Tipo, d.Mov, d.Descrição, `R$ ${safeFormat(d.Valor)}`, d.Método, d.Usuário]),
                didDrawCell: (data) => {
                    // Highlight "Saída" rows in red
                    const isSaida = data.row.raw && data.row.raw[2] === 'Saída';
                    if (isSaida) {
                        doc.setTextColor(220, 38, 38);
                    } else {
                        doc.setTextColor(0, 0, 0);
                    }
                }
            });



            let currentY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 40) + 15;
            const summaryHeight = 90; // Approx height needed for both summaries + balance
            const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();

            if (currentY + summaryHeight > pageHeight - 20) {
                doc.addPage();
                currentY = 20;
            }
            
            // TITHE Breakdown
            const tInPix = dataRows.filter(r => r.type === 'tithe' && r.category === 'income' && r.method === 'PIX').reduce((s, r) => s + r.amount, 0);
            const tInCash = dataRows.filter(r => r.type === 'tithe' && r.category === 'income' && r.method === 'ESPÉCIE').reduce((s, r) => s + r.amount, 0);
            const tOutPix = dataRows.filter(r => r.type === 'tithe' && r.category === 'expense' && r.method === 'PIX').reduce((s, r) => s + r.amount, 0);
            const tOutCash = dataRows.filter(r => r.type === 'tithe' && r.category === 'expense' && r.method === 'ESPÉCIE').reduce((s, r) => s + r.amount, 0);
            
            // OFFERING Breakdown
            const oInPix = dataRows.filter(r => r.type === 'offering' && r.category === 'income' && r.method === 'PIX').reduce((s, r) => s + r.amount, 0);
            const oInCash = dataRows.filter(r => r.type === 'offering' && r.category === 'income' && r.method === 'ESPÉCIE').reduce((s, r) => s + r.amount, 0);
            const oOutPix = dataRows.filter(r => r.type === 'offering' && r.category === 'expense' && r.method === 'PIX').reduce((s, r) => s + r.amount, 0);
            const oOutCash = dataRows.filter(r => r.type === 'offering' && r.category === 'expense' && r.method === 'ESPÉCIE').reduce((s, r) => s + r.amount, 0);

            const tTotalIn = tInPix + tInCash;
            const tTotalOut = tOutPix + tOutCash;
            const oTotalIn = oInPix + oInCash;
            const oTotalOut = oOutPix + oOutCash;
            
            const totalIn = tTotalIn + oTotalIn;
            const totalOut = tTotalOut + oTotalOut;
            const finalBal = totalIn - totalOut;

            doc.setFont("helvetica", "bold");
            doc.setFontSize(14);
            doc.setTextColor(0, 0, 0);
            doc.text("RESUMO DE DÍZIMOS", 15, currentY);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(11);
            doc.setTextColor(0, 0, 0);
            doc.text(`Entradas:  Espécie: R$ ${safeFormat(tInCash)} | PIX: R$ ${safeFormat(tInPix)} | Total: R$ ${safeFormat(tTotalIn)}`, 15, currentY + 8);
            doc.setTextColor(220, 38, 38); // Red for Saídas
            doc.text(`Saídas:      Espécie: R$ ${safeFormat(tOutCash)} | PIX: R$ ${safeFormat(tOutPix)} | Total: R$ ${safeFormat(tTotalOut)}`, 15, currentY + 14);
            
            doc.setFont("helvetica", "bold");
            doc.setTextColor(0, 0, 0);
            doc.text(`SALDO RESUMO DE DÍZIMOS: R$ ${safeFormat(tTotalIn - tTotalOut)}`, 15, currentY + 22);

            doc.setFont("helvetica", "bold");
            doc.setFontSize(14);
            doc.text("RESUMO DE OFERTAS", 15, currentY + 35);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(11);
            doc.text(`Entradas:  Espécie: R$ ${safeFormat(oInCash)} | PIX: R$ ${safeFormat(oInPix)} | Total: R$ ${safeFormat(oTotalIn)}`, 15, currentY + 43);
            doc.setTextColor(220, 38, 38); // Red for Saídas
            doc.text(`Saídas:      Espécie: R$ ${safeFormat(oOutCash)} | PIX: R$ ${safeFormat(oOutPix)} | Total: R$ ${safeFormat(oTotalOut)}`, 15, currentY + 49);
            
            doc.setFont("helvetica", "bold");
            doc.setTextColor(0, 0, 0);
            doc.text(`SALDO RESUMO DE OFERTAS: R$ ${safeFormat(oTotalIn - oTotalOut)}`, 15, currentY + 57);

            doc.setFontSize(16);
            doc.setTextColor(26, 42, 108); // Dark Blue (#1a2a6c equivalent)
            doc.text(`SALDO GERAL DO PERÍODO: R$ ${safeFormat(finalBal)}`, 15, currentY + 75);
            
            console.log("Saving PDF...");
            doc.save(`Relatorio_${month}.pdf`);
        } catch (err) {
            console.error("PDF Error:", err);
            alert("Erro ao gerar PDF: " + err.message);
        }
    }
    hideModal();
};


// --- Modals, Info, Config ---
function showModal(content) {
    const overlay = document.getElementById("modal-container");
    overlay.innerHTML = content;
    overlay.classList.add("active");
}
window.hideModal = () => document.getElementById("modal-container").classList.remove("active");

window.handleExit = () => {
    if (confirm("Você deseja realmente sair?")) {
        currentUser = null;
        localStorage.removeItem('last_user'); // Optional: clear auto-login if implemented
        location.reload();
    }
};


window.showInfo = () => {
    const online = Object.values(USER_SESSIONS).map(u => u.name).join(", ");
    const userList = alasql("SELECT name FROM users").map(u => u.name).join(", ");
    showModal(`
        <div class="glass-card" style="max-width:350px; background:white; border:none; padding:30px;">
            <h3 style="color:var(--text-main); font-size:1.2rem; margin-bottom:20px;">📊 Status do Sistema</h3>
            <div style="background:#f8fafc; padding:15px; border-radius:16px; margin-bottom:15px; border:1px solid #f1f5f9;">
                <p style="font-size:0.8rem; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px; font-weight:700; margin-bottom:8px;">Usuários Cadastrados</p>
                <p style="color:var(--text-main); font-weight:500; font-size:0.9rem;">${userList}</p>
            </div>
            <div style="background:#f8fafc; padding:15px; border-radius:16px; border:1px solid #f1f5f9;">
                <p style="font-size:0.8rem; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px; font-weight:700; margin-bottom:8px;">Usuários Online</p>
                <p style="color:var(--text-main); font-weight:500; font-size:0.9rem;">${online}</p>
            </div>
            <div style="margin-top:20px; border-top:1px solid #f1f5f9; padding-top:20px;">
                <h4 style="color:var(--text-main); margin-bottom:12px; font-size:0.9rem;">Gestão de Acessos</h4>
                ${currentUser.role === 'MASTER' ? `<button class="btn-primary" onclick="showUserMgmt()" style="background:#f0f9ff; color:#0369a1; border:1px solid #bae6fd; box-shadow:none; font-size:0.85rem; margin-bottom:10px;">👥 Gerenciar Usuários (Login/Senha)</button>` : ''}
                <button class="btn-primary" onclick="forceMigration()" style="background:#fef2f2; color:#dc2626; border:1px solid #fee2e2; box-shadow:none; font-size:0.85rem;">🔧 Corrigir Erro (sync_id)</button>
            </div>
            <button class="btn-primary" onclick="hideModal()" style="margin-top:25px; font-weight:600;">Entendido</button>
        </div>
    `);
};

window.showReports = () => {
    showModal(`
        <div class="glass-card" style="max-width:380px; background:white; border:none; padding:30px;">
            <h3 style="color:var(--text-main); font-size:1.2rem; margin-bottom:20px;">📄 Gerar Relatórios</h3>
            <div class="input-group">
                <label style="color:var(--text-dim); font-weight:600;">Mês de Referência</label>
                <input type="month" id="rep-month" value="${new Date().toISOString().slice(0, 7)}" style="background:#f8fafc; border:1px solid #e2e8f0; color:var(--text-main); font-weight:600;">
            </div>
            <div class="input-group">
                <label style="color:var(--text-dim); font-weight:600;">Tipo de Filtro</label>
                <select id="rep-filter" style="width:100%; padding:14px; border-radius:12px; background:#f8fafc; border:1px solid #e2e8f0; color:var(--text-main); font-weight:600; outline:none;">
                    <option value="total">Extrato Geral (Dízimos + Ofertas)</option>
                    <option value="tithe">Dízimos (Entradas e Saídas)</option>
                    <option value="offering">Ofertas (Entradas e Saídas)</option>
                </select>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:10px;">
                <button class="btn-primary" onclick="generateReport('pdf')" style="background:#ef4444; color:white; box-shadow:0 4px 12px rgba(239, 68, 68, 0.2);">Arquivo PDF</button>
                <button class="btn-primary" onclick="generateReport('excel')" style="background:#10b981; color:white; box-shadow:0 4px 12px rgba(16, 185, 129, 0.2);">Arquivo Excel</button>
            </div>
            <button class="btn-primary" onclick="hideModal()" style="margin-top:20px; background:none; color:var(--text-dim); box-shadow:none; font-weight:600;">Voltar</button>
        </div>
    `);
};

window.showUserMgmt = () => {
    const users = alasql("SELECT * FROM users WHERE email != 'moises@'");
    let usersHtml = "";
    users.forEach(u => {
        usersHtml += `<div class="glass-card" style="margin-bottom:8px; padding:15px; display:flex; justify-content:space-between; align-items:center; border:1px solid #f1f5f9;">
            <div style="flex:1;">
                <strong style="color:var(--text-main);">${u.name}</strong><br>
                <small style="color:var(--text-dim);">Login: <b>${u.email}</b> | Senha: <b>${u.password}</b></small>
            </div>
            <div style="display:flex; gap:8px;">
                <button onclick="editUser(${u.id})" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; width:34px; height:34px; cursor:pointer;" title="Editar">✏️</button>
                <button onclick="deleteUser(${u.id})" style="background:#fff1f2; border:1px solid #fecaca; border-radius:8px; width:34px; height:34px; cursor:pointer;" title="Excluir">🗑️</button>
            </div>
        </div>`;
    });
    showModal(`
        <div class="glass-card" style="max-width:400px; max-height:90vh; overflow-y:auto; background:white; border:none; padding:30px;">
            <h3 style="color:var(--text-main); font-size:1.2rem; margin-bottom:20px;">👥 Gestão de Usuários</h3>
            <div style="margin-bottom:25px;">${usersHtml || '<p style="text-align:center; color:var(--text-dim); font-size:0.9rem;">Nenhum usuário comum.</p>'}</div>
            
            <div id="user-form-container" style="background:#f8fafc; padding:20px; border-radius:20px; border:1px solid #f1f5f9;">
                <h4 id="user-form-title" style="color:var(--text-main); margin-bottom:15px; font-weight:700;">Novo Acesso</h4>
                <form onsubmit="handleNewUser(event)">
                    <input type="hidden" id="nu-id" value="">
                    <label style="font-size:0.8rem; color:var(--text-dim); font-weight:600;">Nome de Login</label>
                    <input type="text" id="nu-login" placeholder="Ex: joao_betel" required style="width:100%; margin-bottom:12px; padding:12px; border-radius:10px; background:white; border:1px solid #e2e8f0; color:var(--text-main); outline:none;">
                    
                    <label style="font-size:0.8rem; color:var(--text-dim); font-weight:600;">Unidade / Igreja</label>
                    <select id="nu-name" required style="width:100%; margin-bottom:12px; padding:12px; border-radius:10px; background:white; border:1px solid #e2e8f0; color:var(--text-main); font-weight:500; outline:none;">
                        <option value="">Selecione Unit...</option>
                        <option value="TEMPLO CENTRAL">TEMPLO CENTRAL</option>
                        <option value="ADONAI">ADONAI</option>
                        <option value="BETEL">BETEL</option>
                        <option value="FILADELFIA">FILADELFIA</option>
                        <option value="MONTE SINAI">MONTE SINAI</option>
                        <option value="NOVA JERUSALEM">NOVA JERUSALEM</option>
                        <option value="VALE DA BENÇÃO">VALE DA BENÇÃO</option>
                    </select>
    
                    <label style="font-size:0.8rem; color:var(--text-dim); font-weight:600;">Senha</label>
                    <input type="text" id="nu-pass" placeholder="••••••••" required style="width:100%; margin-bottom:15px; padding:12px; border-radius:10px; background:white; border:1px solid #e2e8f0; color:var(--text-main); outline:none;">
                    
                    <button type="submit" id="user-form-btn" class="btn-primary" style="font-weight:700; background:var(--primary);">Criar Registro</button>
                </form>
            </div>
            <button class="btn-primary" onclick="hideModal()" style="margin-top:20px; background:none; color:var(--text-dim); box-shadow:none; font-weight:600;">Fechar Janela</button>
        </div>
    `);
};

window.handleNewUser = async (e) => {
    e.preventDefault();
    const id = document.getElementById("nu-id").value;
    const login = document.getElementById("nu-login").value;
    const name = document.getElementById("nu-name").value;
    const pass = document.getElementById("nu-pass").value;
    
    if (!name) return alert("Por favor, selecione uma unidade.");
    
    if (id) {
        // Update Local
        alasql("UPDATE users SET email=?, password=?, name=? WHERE id=?", [login, pass, name, parseInt(id)]);
        // Update Cloud
        if (supabase) {
            try {
                await supabase.from('users').update({ email: login, password: pass, name }).eq('email', login);
            } catch (e) { console.error("Cloud User Update Error:", e); }
        }
    } else {
        // Local
        alasql("INSERT INTO users (email, password, name, role) VALUES (?,?,?,?)", [login, pass, name, 'COMMON']);
        // Cloud
        if (supabase) {
            try {
                await supabase.from('users').insert([{ email: login, password: pass, name, role: 'COMMON' }]);
            } catch (e) { console.error("Cloud User Save Error:", e); }
        }
    }
    
    showUserMgmt();
};

window.editUser = (id) => {
    const u = alasql("SELECT * FROM users WHERE id=?", [id])[0];
    if (u) {
        document.getElementById("nu-id").value = u.id;
        document.getElementById("nu-login").value = u.email;
        document.getElementById("nu-name").value = u.name;
        document.getElementById("nu-pass").value = u.password;
        
        document.getElementById("user-form-title").innerText = "Editar Usuário";
        document.getElementById("user-form-btn").innerText = "Salvar Alterações";
        document.getElementById("user-form-container").style.background = "#fffbeb";
        document.getElementById("user-form-container").style.borderColor = "#fef3c7";
    }
};

window.deleteUser = async (id) => {
    if (confirm("Deseja realmente excluir este usuário?")) {
        const u = alasql("SELECT email FROM users WHERE id=?", [id])[0];
        
        // Local
        alasql("DELETE FROM users WHERE id=?", [id]);
        
        // Cloud
        if (supabase && u) {
            try {
                await supabase.from('users').delete().eq('email', u.email);
            } catch (e) { console.error("Cloud User Delete Error:", e); }
        }
        showUserMgmt();
    }
};

window.deleteTransaction = async (id) => {
    if (confirm("Você tem certeza que deseja excluir?")) {
        const row = alasql("SELECT * FROM transactions WHERE id=?", [id])[0];
        if (!row) return;

        if (currentUser.role !== 'MASTER' && row.user_id && row.user_id !== currentUser.id) {
            return alert("Você não tem permissão para excluir este registro.");
        }
        
        // Local
        alasql("DELETE FROM transactions WHERE id=?", [id]);
        
        // Cloud
        if (supabase && row && row.sync_id) {
            try {
                await supabase.from('transactions').delete().eq('sync_id', row.sync_id);
            } catch (e) { console.error("Cloud Delete Error:", e); }
        }
        
        loadTab(document.querySelector(".nav-item.active").dataset.tab);
    }
};



window.editTransaction = (id) => {
    try {
        const r = alasql("SELECT * FROM transactions WHERE id=?", [id])[0];
        if (!r) return;
        
        if (currentUser.role !== 'MASTER' && r.user_id !== currentUser.id) {
            return alert("Você não tem permissão para editar este registro.");
        }

        showModal(`
            <div class="glass-card" style="max-width:350px; background:white; border:none; padding:30px;">
                <h3 style="color:var(--text-main); font-size:1.2rem; margin-bottom:20px;">Editar Lançamento</h3>
                <div class="input-group">
                    <label style="color:var(--text-dim); font-weight:600;">Descrição</label>
                    <input type="text" id="e-desc" oninput="this.value=this.value.toUpperCase()" style="background:#f8fafc; border:1px solid #e2e8f0; color:var(--text-main);">
                </div>
                <div class="input-group">
                    <label style="color:var(--text-dim); font-weight:600;">Valor</label>
                    <input type="number" step="0.01" id="e-val" style="background:#f8fafc; border:1px solid #e2e8f0; color:var(--text-main);">
                </div>
                <div class="input-group">
                    <label style="color:var(--text-dim); font-weight:600;">Data</label>
                    <input type="date" id="e-date" style="background:#f8fafc; border:1px solid #e2e8f0; color:var(--text-main);">
                </div>
                <button class="btn-primary" id="btn-save-edit" style="font-weight:700;">Salvar Alterações</button>
                <button class="btn-primary" onclick="hideModal()" style="margin-top:15px; background:none; color:var(--text-dim); box-shadow:none; font-weight:600;">Descartar</button>
            </div>
        `);

        // Set values safely
        document.getElementById("e-desc").value = r.description;
        document.getElementById("e-val").value = r.amount;
        document.getElementById("e-date").value = r.date;
        
        // Use closure for the save button
        document.getElementById("btn-save-edit").onclick = () => saveEdit(id);
    } catch (e) {
        console.error("Edit UI Error:", e);
        alert("Erro ao abrir formulário de edição.");
    }
};

window.saveEdit = async (id) => {
    try {
        const desc = document.getElementById("e-desc").value;
        const val = parseFloat(document.getElementById("e-val").value);
        const date = document.getElementById("e-date").value;
        
        if (!desc || isNaN(val) || !date) {
            return alert("Por favor, preencha todos os campos corretamente.");
        }

        const row = alasql("SELECT * FROM transactions WHERE id=?", [id])[0];
        if (!row) throw new Error("Registro não encontrado localmente.");

        if (currentUser.role !== 'MASTER' && row.user_id && row.user_id !== currentUser.id) {
            return alert("Sem permissão para salvar este registro.");
        }
        
        // Local
        alasql("UPDATE transactions SET description=?, amount=?, date=?, month_ref=? WHERE id=?", [desc, val, date, date.slice(0, 7), id]);
        
        // Cloud
        if (supabase && row && row.sync_id) {
            try {
                await supabase.from('transactions').update({ 
                    description: desc, 
                    amount: val, 
                    date, 
                    month_ref: date.slice(0, 7) 
                }).eq('sync_id', row.sync_id);
            } catch (e) { console.error("Cloud Update Error:", e); }
        }

        hideModal();
        loadTab(document.querySelector(".nav-item.active").dataset.tab);
    } catch (e) {
        console.error("Save Error:", e);
        alert("Erro ao salvar alterações: " + e.message);
    }
};



window.showConfig = () => {
    showModal(`
        <div class="glass-card" style="max-width:400px; max-height:90vh; overflow-y:auto; background:white; border:none; padding:30px;">
            <h3 style="color:var(--text-main); font-size:1.2rem; margin-bottom:20px;">⚙️ Configurações</h3>
            
            <p style="font-size:0.8rem; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px; font-weight:700; margin-bottom:12px;">Paleta de Cores</p>
            <div style="grid-template-columns: 1fr 1fr; display:grid; gap:10px; margin-bottom:25px;">
                <button class="btn-primary" onclick="setTheme('default')" style="background:#f8fafc; color:var(--text-main); border:1px solid #e2e8f0; box-shadow:none;">Default Light</button>
                <button class="btn-primary" onclick="setTheme('dark')" style="background:#1e293b; color:white; border:none; box-shadow:none;">Abyssal Dark</button>
                <button class="btn-primary" onclick="setTheme('emerald')" style="background:#f0fdf4; color:#166534; border:1px solid #bbf7d0; box-shadow:none;">Emerald Soft</button>
                <button class="btn-primary" onclick="setTheme('gold')" style="background:#fefce8; color:#854d0e; border:1px solid #fef08a; box-shadow:none;">Gold Luxury</button>
            </div>
            
            <div style="background:#f0f9ff; padding:20px; border-radius:20px; border:1px solid #bae6fd;">
                <h4 style="color:#0369a1; margin-bottom:10px; font-weight:700;">☁️ Nuvem Supabase</h4>
                <p style="font-size:0.8rem; margin-bottom:15px; color:#0c4a6e; opacity:0.8;">Configuração para acesso em múltiplos dispositivos.</p>
                
                <div class="input-group">
                    <label style="color:#0c4a6e; font-size:0.75rem; font-weight:700;">PROJECT URL</label>
                    <input type="text" id="cfg-sb-url" value="${CLOUD_CONFIG.url}" placeholder="https://xyz.supabase.co" style="background:white; border:1px solid #bae6fd; color:var(--text-main);">
                </div>
                <div class="input-group">
                    <label style="color:#0c4a6e; font-size:0.75rem; font-weight:700;">ANON KEY</label>
                    <input type="password" id="cfg-sb-key" value="${CLOUD_CONFIG.key}" placeholder="sua_chave_aqui" style="background:white; border:1px solid #bae6fd; color:var(--text-main);">
                </div>
                <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px;">
                    <input type="checkbox" id="cfg-sb-enabled" ${CLOUD_CONFIG.enabled ? 'checked' : ''} style="width:22px; height:22px; accent-color:var(--primary);">
                    <label style="color:#0c4a6e; font-weight:600; font-size:0.9rem;">Habilitar Sincronia</label>
                </div>
                
                <button class="btn-primary" onclick="testCloudConnection()" style="background:#f0f9ff; color:#0369a1; border:1px solid #bae6fd; box-shadow:none; font-weight:700; margin-bottom:10px;">⚡ Testar Conexão Agora</button>
                <button class="btn-primary" onclick="saveCloudConfig()" style="background:#0284c7; color:white; border:none; font-weight:700;">Salvar e Reconectar</button>
                <div style="height:10px;"></div>
                <button class="btn-primary" onclick="generateInviteLink()" style="background:#f8fafc; color:#0369a1; border:1px solid #e2e8f0; box-shadow:none; font-weight:600; margin-bottom:10px;">🔗 Gerar Link de Convite</button>
                <button class="btn-primary" onclick="syncAllToCloud()" style="background:white; color:#0284c7; border:1px solid #bae6fd; box-shadow:none; font-weight:600;">Push: Enviar dados deste PC p/ Nuvem</button>
                <button class="btn-primary" onclick="manualPull()" style="margin-top:10px; background:white; color:#0369a1; border:1px solid #bae6fd; box-shadow:none; font-weight:600;">Pull: Buscar dados da Nuvem p/ este PC</button>
            </div>

            <div style="margin-top:30px; padding:20px; border:2px dashed #fecaca; border-radius:20px; background:#fff1f2;">
                <h4 style="color:#991b1b; margin-bottom:10px; font-weight:800;">🛑 ZONA DE PERIGO</h4>
                <p style="font-size:0.75rem; color:#991b1b; margin-bottom:15px; font-weight:500;">Esta ação irá apagar TODOS os dízimos, ofertas e usuários comuns do computador e da nuvem. Isso não pode ser desfeito.</p>
                <button class="btn-primary" onclick="clearAllData()" style="background:#dc2626; color:white; border:none; font-weight:700; box-shadow:0 4px 12px rgba(220, 38, 38, 0.2);">LIMPAR TODOS OS DADOS (RESET)</button>
            </div>
            
            <button class="btn-primary" onclick="hideModal()" style="margin-top:25px; background:none; color:var(--text-dim); box-shadow:none; font-weight:600;">Sair das Configs</button>
        </div>
    `);
};

window.syncAllToCloud = async () => {
    if (!supabase) return alert("A nuvem não está ativa. Configure e ative primeiro.");
    if (!confirm("Isso enviará todos os seus dados locais para a nuvem. Deseja continuar?")) return;
    
    try {
        const trans = alasql("SELECT * FROM transactions");
        const users = alasql("SELECT * FROM users");
        
        // Use a simpler approach for the demo: upsert based on unique keys
        // Transactions use sync_id, Users use email
        if (trans.length > 0) {
            const { error: tErr } = await supabase.from('transactions').upsert(trans.map(t => ({...t, id: undefined})));
            if (tErr) throw tErr;
        }
        if (users.length > 0) {
            const { error: uErr } = await supabase.from('users').upsert(users.map(u => ({...u, id: undefined})));
            if (uErr) throw uErr;
        }
        
        alert("Manual Sync: Envio concluído! Os dados agora estão na nuvem.");
    } catch (e) {
        console.error("Sync All Error:", e);
        let msg = e.message;
        if (e instanceof TypeError && e.message.includes('fetch')) {
            msg = "Erro de Rede: Não foi possível alcançar o servidor Supabase. Verifique se a URL está correta (deve começar com https://) e se você tem internet.";
        }
        alert("Erro no Envio (Push): " + msg);
    }
};


window.generateInviteLink = () => {
    if (!CLOUD_CONFIG.url || !CLOUD_CONFIG.key) {
        return alert("Primeiro configure e salve os dados do Supabase.");
    }
    
    const baseUrl = window.location.href.split('?')[0].split('#')[0];
    const inviteUrl = `${baseUrl}?sb_url=${encodeURIComponent(CLOUD_CONFIG.url)}&sb_key=${encodeURIComponent(CLOUD_CONFIG.key)}`;
    
    // Copy to clipboard
    navigator.clipboard.writeText(inviteUrl).then(() => {
        alert("Link de Convite copiado!\n\nEnvie este link para os outros usuários. Quando eles clicarem, o celular deles será configurado automaticamente.");
    }).catch(err => {
        console.error("Clipboard Error:", err);
        prompt("Copie este link e envie para os usuários:", inviteUrl);
    });
};

window.saveCloudConfig = () => {
    let url = document.getElementById('cfg-sb-url').value.trim();
    const key = document.getElementById('cfg-sb-key').value.trim();
    const enabled = document.getElementById('cfg-sb-enabled').checked;

    if (enabled && url) {
        if (!url.startsWith('https://')) {
            return alert("A URL do projeto deve começar com https://");
        }
        // Remove trailing slash if exists
        url = url.replace(/\/$/, "");
    }

    localStorage.setItem('sb_url', url);
    localStorage.setItem('sb_key', key);
    localStorage.setItem('sb_enabled', enabled);
    
    alert("Configurações salvas! Reiniciando para aplicar...");
    location.reload();
};

window.testCloudConnection = async () => {
    const url = document.getElementById('cfg-sb-url').value.trim();
    const key = document.getElementById('cfg-sb-key').value.trim();
    
    if (!url || !key) return alert("Preencha a URL e a Chave para testar.");
    
    try {
        const { createClient } = window.supabase;
        const testClient = createClient(url, key);
        // Test query
        const { error } = await testClient.from('users').select('count', { count: 'exact', head: true });
        
        if (error) throw error;
        alert("✅ Conexão bem sucedida! O sistema conseguiu falar com o Supabase.");
    } catch (e) {
        console.error("Test Conn Error:", e);
        let msg = e.message;
        if (e instanceof TypeError && e.message.includes('fetch')) {
            msg = "URL Inválida ou Sem Internet. Verifique se a URL do projeto está correta.";
        } else if (e.message.includes('401') || e.message.includes('Invalid API key')) {
            msg = "Chave API Invalida (Anon Key). Verifique se copiou a chave certa.";
        } else if (e.message.includes('404')) {
            msg = "Tabela 'users' não encontrada. Verifique se você rodou o código SQL no Supabase.";
        }
        alert("❌ Falha na Conexão: " + msg);
    }
};

window.pullFromCloud = async () => {
    if (!supabase) return;
    isSyncing = true;
    if (currentUser) renderDashboard();
    
    console.log("Pulling data from cloud...");
    try {
        // 1. Fetch Transactions
        const { data: cloudTrans, error: tErr } = await supabase.from('transactions').select('*');
        if (tErr) throw tErr;
        
        // 2. Fetch Users
        const { data: cloudUsers, error: uErr } = await supabase.from('users').select('*');
        if (uErr) throw uErr;

        // Sync Transactions
        if (cloudTrans && cloudTrans.length > 0) {
            cloudTrans.forEach(row => {
                const exists = alasql("SELECT id FROM transactions WHERE sync_id=?", [row.sync_id])[0];
                if (exists) {
                    alasql("UPDATE transactions SET type=?, category=?, description=?, amount=?, date=?, method=?, observation=?, user_id=?, user_name=?, month_ref=? WHERE sync_id=?",
                        [row.type, row.category, row.description, row.amount, row.date, row.method, row.observation, row.user_id, row.user_name, row.month_ref, row.sync_id]);
                } else {
                    alasql("INSERT INTO transactions (type, category, description, amount, date, method, observation, user_id, user_name, month_ref, sync_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        [row.type, row.category, row.description, row.amount, row.date, row.method, row.observation, row.user_id, row.user_name, row.month_ref, row.sync_id]);
                }
            });
        }

        // Sync Users
        if (cloudUsers && cloudUsers.length > 0) {
            cloudUsers.forEach(row => {
                const exists = alasql("SELECT id FROM users WHERE email=?", [row.email])[0];
                if (exists) {
                    alasql("UPDATE users SET password=?, name=?, role=? WHERE email=?", [row.password, row.name, row.role, row.email]);
                } else {
                    alasql("INSERT INTO users (email, password, name, role) VALUES (?,?,?,?)", [row.email, row.password, row.name, row.role]);
                }
            });
        }
        
        console.log("Cloud Pull Completed.");
        isSyncing = false;
        if (currentUser) {
            renderDashboard();
            const activeTab = document.querySelector(".nav-item.active")?.dataset.tab;
            if (activeTab === 'tithes') renderListView('tithe');
            if (activeTab === 'offerings') renderListView('offering');
        }
        return true;
    } catch (e) {
        console.error("Cloud Pull Error:", e);
        isSyncing = false;
        if (currentUser) renderDashboard();
        return false;
    }
};

window.handleRealtimeChange = (payload) => {
    const { eventType, new: newRow, old: oldRow } = payload;
    
    if (eventType === 'INSERT' || eventType === 'UPDATE') {
        const row = newRow;
        const exists = alasql("SELECT id FROM transactions WHERE sync_id=?", [row.sync_id])[0];
        if (exists) {
            alasql("UPDATE transactions SET type=?, category=?, description=?, amount=?, date=?, method=?, observation=?, user_id=?, user_name=?, month_ref=? WHERE sync_id=?",
                [row.type, row.category, row.description, row.amount, row.date, row.method, row.observation, row.user_id, row.user_name, row.month_ref, row.sync_id]);
        } else {
            alasql("INSERT INTO transactions (type, category, description, amount, date, method, observation, user_id, user_name, month_ref, sync_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                [row.type, row.category, row.description, row.amount, row.date, row.method, row.observation, row.user_id, row.user_name, row.month_ref, row.sync_id]);
        }
    } else if (eventType === 'DELETE') {
        alasql("DELETE FROM transactions WHERE sync_id=?", [oldRow.sync_id]);
    }
    
    if (currentUser) renderDashboard();
};

window.manualPull = async () => {
    alert("Iniciando busca de novos dados na nuvem...");
    const success = await pullFromCloud();
    if (success) {
        alert("Busca concluída! Se havia dados novos no outro aparelho, eles já apareceram aqui.");
    } else {
        alert("Erro ao buscar dados. Verifique sua conexão e se o Supabase está configurado corretamente.");
    }
}

window.clearAllData = async () => {
    const confirm1 = confirm("⚠️ ATENÇÃO: Você está prestes a apagar TODOS os dados do sistema (Dízimos, Ofertas e Usuários Comuns).\n\nEsta ação não pode ser desfeita. Deseja continuar?");
    if (!confirm1) return;

    const confirm2 = confirm("CONFIRMAÇÃO FINAL: Tem certeza absoluta? Isso limpará também os dados na Nuvem.");
    if (!confirm2) return;

    try {
        console.log("Starting System Reset...");
        
        // 1. Clear Local Database
        alasql("DELETE FROM transactions");
        alasql("DELETE FROM users WHERE email != 'moises@'");
        
        // 2. Clear Cloud Database
        if (supabase) {
            // Delete all transactions
            const { error: tErr } = await supabase.from('transactions').delete().neq('id', 0); // Hack to delete all
            if (tErr) console.error("Cloud Clear Transactions Error:", tErr);
            
            // Delete all common users
            const { error: uErr } = await supabase.from('users').delete().neq('email', 'moises@');
            if (uErr) console.error("Cloud Clear Users Error:", uErr);
        }

        alert("✅ Sistema limpo com sucesso! O aplicativo será reiniciado.");
        location.reload();
    } catch (e) {
        console.error("Reset Error:", e);
        alert("Erro durante a limpeza: " + e.message);
    }
};


window.setTheme = (theme) => {
    const root = document.documentElement;
    let gradient = 'linear-gradient(135deg, #1a2a6c, #b21f1f, #fdbb2d)';
    if (theme === 'emerald') gradient = 'linear-gradient(135deg, #00b09b, #96c93d)';
    else if (theme === 'dark') gradient = 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)';
    else if (theme === 'gold') gradient = 'linear-gradient(135deg, #000000, #434343)';
    
    root.style.setProperty('--bg-gradient', gradient);
    localStorage.setItem('church_theme', theme);
    hideModal();
};

// Add this to initApp
function applySavedTheme() {
    const theme = localStorage.getItem('church_theme') || 'default';
    setTheme(theme);
}


window.showUserMovs = (userId) => {
    const res = alasql("SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC", [userId]);
    let html = "<h4>Movimentações</h4>";
    res.forEach(r => {
        html += `<div style="font-size:0.8rem; border-bottom:1px solid rgba(255,255,255,0.1); padding:5px 0;">
            ${r.date}: ${r.description} - R$ ${safeFormat(r.amount)} (${r.type})
        </div>`;
    });
    showModal(`<div class="glass-card" style="max-width:400px; max-height:80vh; overflow-y:auto;">${html || '<p>Sem registros.</p>'}<button class="btn-primary" onclick="showUserMgmt()" style="margin-top:15px;">Voltar</button></div>`);
};

window.forceMigration = () => {
    try {
        console.log("Starting full database repair...");
        
        // 1. Backup existing data
        const oldData = alasql("SELECT * FROM transactions");
        
        // 2. Rename it just in case
        alasql("ALTER TABLE transactions RENAME TO transactions_old");
        
        // 3. Create fresh table with full schema
        alasql(`CREATE TABLE transactions (
            id INT AUTO_INCREMENT PRIMARY KEY, type STRING, category STRING, description STRING, 
            amount FLOAT, date STRING, method STRING, observation STRING, user_id INT, user_name STRING, month_ref STRING, sync_id STRING
        )`);
        
        // 4. Migrate data back
        if (oldData && oldData.length > 0) {
            oldData.forEach(row => {
                const s_id = row.sync_id || (Date.now().toString(36) + Math.random().toString(36).substr(2));
                const u_id = row.user_id || currentUser.id;
                const u_name = row.user_name || currentUser.name;
                const m_ref = row.month_ref || (row.date ? row.date.slice(0, 7) : "");
                
                alasql("INSERT INTO transactions (type, category, description, amount, date, method, observation, user_id, user_name, month_ref, sync_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    [row.type, row.category, row.description, row.amount, row.date, row.method, row.observation, u_id, u_name, m_ref, s_id]);
            });
        }
        
        // 5. Cleanup
        alasql("DROP TABLE transactions_old");
        
        alert("Banco de dados reconstruído e corrigido com sucesso! Todos os dados foram preservados.");
        location.reload();
    } catch (e) {
        console.error("Repair Error:", e);
        alert("Erro na reconstrução: " + e.message + ". Tente atualizar a página e usar o botão novamente.");
    }
};

window.handleGlobalError = (e) => {
    console.error("Global Error:", e);
    // Don't show alert for every minor thing, but useful for debug
};

// Bootstrap
initApp();
