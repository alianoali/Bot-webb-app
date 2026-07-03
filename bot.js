const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const fs = require('fs');

const TOKEN = '8746894087:AAHmdTT-2GMK0YnAcHLymSrUow5nKGukd3Q';
const ADMIN_IDS = [6183869749];

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// استخدام ملف JSON بدل SQLite
const DB_FILE = 'database.json';

function readDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch (e) {}
    return { users: {}, transactions: [] };
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getUser(userId, firstName, username) {
    const db = readDB();
    if (!db.users[userId]) {
        db.users[userId] = {
            user_id: userId,
            first_name: firstName,
            username: username || '',
            balance: 0,
            created_at: new Date().toISOString()
        };
        db.transactions.push({
            user_id: userId,
            type: 'create',
            amount: 0,
            description: 'إنشاء الحساب',
            created_at: new Date().toISOString()
        });
        writeDB(db);
    }
    return db.users[userId];
}

function updateBalance(userId, amount, type, description) {
    const db = readDB();
    if (!db.users[userId]) return { success: false, message: '❌ المستخدم غير موجود', balance: 0 };
    
    const newBalance = (db.users[userId].balance || 0) + amount;
    if (newBalance < 0 && amount < 0) {
        return { success: false, message: '❌ رصيد غير كافي', balance: db.users[userId].balance };
    }
    
    db.users[userId].balance = newBalance;
    db.transactions.push({
        user_id: userId,
        type: type,
        amount: amount,
        description: description,
        created_at: new Date().toISOString()
    });
    writeDB(db);
    return { success: true, balance: newBalance };
}

function getTransactions(userId, limit = 10) {
    const db = readDB();
    return db.transactions
        .filter(t => t.user_id == userId)
        .reverse()
        .slice(0, limit);
}

app.get('/api/user', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.json({ success: false });
    const db = readDB();
    const user = db.users[userId];
    if (!user) return res.json({ success: false });
    res.json({ success: true, user: user });
});

app.get('/api/transactions', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.json({ success: false });
    res.json({ success: true, transactions: getTransactions(userId, req.query.limit || 10) });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`✅ يعمل على ${PORT}`));

let WEB_APP_URL = 'https://xxxx.sse.codesandbox.io';

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const user = getUser(msg.from.id, msg.from.first_name, msg.from.username);
    bot.sendMessage(chatId, `👋 مرحباً ${msg.from.first_name}!\n💰 رصيدك: ${user.balance.toFixed(2)}`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🚀 افتح التطبيق', web_app: { url: WEB_APP_URL } }],
                [{ text: '💰 رصيدي', callback_data: 'balance' }, { text: '📋 كشف الحساب', callback_data: 'history' }]
            ]
        }
    });
});

bot.onText(/\/balance/, (msg) => {
    const db = readDB();
    const user = db.users[msg.from.id];
    bot.sendMessage(msg.chat.id, `💰 رصيدك: ${user ? user.balance.toFixed(2) : '0.00'}`);
});

bot.onText(/\/addbalance (.+)/, (msg, match) => {
    if (!ADMIN_IDS.includes(msg.from.id)) return bot.sendMessage(msg.chat.id, '❌ للمشرف فقط');
    const [targetId, amount] = match[1].split(' ');
    const result = updateBalance(parseInt(targetId), parseFloat(amount), 'add', 'إضافة من المشرف');
    bot.sendMessage(msg.chat.id, result.success ? `✅ تم. الرصيد: ${result.balance}` : result.message);
});

bot.onText(/\/users/, (msg) => {
    if (!ADMIN_IDS.includes(msg.from.id)) return bot.sendMessage(msg.chat.id, '❌ للمشرف فقط');
    const db = readDB();
    const count = Object.keys(db.users).length;
    bot.sendMessage(msg.chat.id, `👥 عدد المستخدمين: ${count}`);
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    if (query.data === 'balance') {
        const db = readDB();
        const user = db.users[query.from.id];
        bot.sendMessage(chatId, `💰 رصيدك: ${user ? user.balance.toFixed(2) : '0.00'}`);
    } else if (query.data === 'history') {
        const tx = getTransactions(query.from.id, 5);
        let text = '📋 آخر المعاملات:\n';
        tx.forEach(t => { text += `• ${t.description}: ${t.amount >= 0 ? '+' : ''}${t.amount}\n`; });
        bot.sendMessage(chatId, text || 'لا توجد معاملات');
    }
    bot.answerCallbackQuery(query.id);
});

bot.on('web_app_data', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    try {
        const data = JSON.parse(msg.web_app_data.data);
        if (data.action === 'purchase') {
            const amount = parseFloat(data.amount) || 0;
            const result = updateBalance(userId, -amount, 'deduct', data.description || 'شراء');
            return bot.sendMessage(chatId, result.success ? `✅ تم الشراء!\n💰 المتبقي: ${result.balance.toFixed(2)}` : result.message);
        }
        let reply = { request_consultation: '✅ تم استلام طلب الاستشارة', feedback: '💬 شكراً على ملاحظاتك' };
        bot.sendMessage(chatId, reply[data.action] || `✅ تم: ${data.action}`);
        if (data.name) bot.sendMessage(chatId, `👤 شكراً ${data.name}!`);
    } catch (e) {
        bot.sendMessage(chatId, '❌ خطأ');
    }
});

console.log('🚀 البوت جاهز');
