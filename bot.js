const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const fs = require('fs');

const TOKEN = '8746894087:AAHmdTT-2GMK0YnAcHLymSrUow5nKGukd3Q';
const ADMIN_IDS = [6183869749];

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// رابط Railway - سيتم تحديثه تلقائياً
// ============================================
const RAILWAY_URL = process.env.RAILWAY_PUBLIC_URL || 'https://your-app.up.railway.app';

// ============================================
// إعداد البوت مع Webhook
// ============================================
const bot = new TelegramBot(TOKEN);

// تعيين Webhook
bot.setWebHook(`${RAILWAY_URL}/webhook`)
    .then(() => console.log('✅ Webhook تم تعيينه بنجاح'))
    .catch(err => console.error('❌ خطأ في Webhook:', err));

// استقبال التحديثات من تلغرام
app.post('/webhook', (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// ============================================
// قاعدة البيانات
// ============================================
const DB_FILE = path.join(__dirname, 'database.json');

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
    if (!db.users[userId]) return { success: false, message: 'المستخدم غير موجود', balance: 0 };
    const newBalance = (db.users[userId].balance || 0) + amount;
    if (newBalance < 0 && amount < 0) return { success: false, message: 'رصيد غير كافي', balance: db.users[userId].balance };
    db.users[userId].balance = newBalance;
    db.transactions.push({ user_id: userId, type, amount, description, created_at: new Date().toISOString() });
    writeDB(db);
    return { success: true, balance: newBalance };
}

function getTransactions(userId, limit = 10) {
    const db = readDB();
    return db.transactions.filter(t => t.user_id == userId).reverse().slice(0, limit);
}

// ============================================
// API
// ============================================
app.get('/api/user', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.json({ success: false });
    const db = readDB();
    const user = db.users[userId];
    if (!user) return res.json({ success: false });
    res.json({ success: true, user });
});

app.get('/api/transactions', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.json({ success: false });
    res.json({ success: true, transactions: getTransactions(userId, req.query.limit || 10) });
});

// ============================================
// الصفحة الرئيسية
// ============================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// صفحة فحص البوت
// ============================================
app.get('/status', (req, res) => {
    bot.getWebHookInfo().then(info => {
        res.json({
            status: 'online',
            webhook: info,
            railway_url: RAILWAY_URL
        });
    }).catch(err => {
        res.json({ status: 'error', error: err.message });
    });
});

// ============================================
// أمر /start
// ============================================
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const user = getUser(msg.from.id, msg.from.first_name, msg.from.username);

    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🚀 افتح التطبيق', web_app: { url: RAILWAY_URL } }],
                [
                    { text: '💰 رصيدي', callback_data: 'balance' },
                    { text: '📋 كشف الحساب', callback_data: 'history' }
                ]
            ]
        }
    };

    bot.sendMessage(chatId, `👋 مرحباً ${msg.from.first_name}!\n💰 رصيدك: ${user.balance.toFixed(2)}`, options);
});

// ============================================
// أمر /balance
// ============================================
bot.onText(/\/balance/, (msg) => {
    const db = readDB();
    const user = db.users[msg.from.id];
    bot.sendMessage(msg.chat.id, `💰 رصيدك: ${user ? user.balance.toFixed(2) : '0.00'}`);
});

// ============================================
// أمر /addbalance
// ============================================
bot.onText(/\/addbalance (.+)/, (msg, match) => {
    if (!ADMIN_IDS.includes(msg.from.id)) return bot.sendMessage(msg.chat.id, '❌ للمشرف فقط');
    const [targetId, amount] = match[1].split(' ');
    const result = updateBalance(parseInt(targetId), parseFloat(amount), 'add', 'إضافة من المشرف');
    bot.sendMessage(msg.chat.id, result.success ? `✅ تم. الرصيد: ${result.balance}` : result.message);
});

// ============================================
// أمر /users
// ============================================
bot.onText(/\/users/, (msg) => {
    if (!ADMIN_IDS.includes(msg.from.id)) return bot.sendMessage(msg.chat.id, '❌ للمشرف فقط');
    const db = readDB();
    bot.sendMessage(msg.chat.id, `👥 المستخدمين: ${Object.keys(db.users).length}`);
});

// ============================================
// أمر /checkwebhook
// ============================================
bot.onText(/\/checkwebhook/, (msg) => {
    bot.getWebHookInfo().then(info => {
        bot.sendMessage(msg.chat.id, `✅ Webhook:\nURL: ${info.url}\nStatus: ${info.last_error_message || 'OK'}`);
    });
});

// ============================================
// أزرار
// ============================================
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    if (query.data === 'balance') {
        const db = readDB();
        const user = db.users[query.from.id];
        bot.sendMessage(chatId, `💰 رصيدك: ${user ? user.balance.toFixed(2) : '0.00'}`);
    } else if (query.data === 'history') {
        const tx = getTransactions(query.from.id, 5);
        let text = '📋 المعاملات:\n';
        tx.forEach(t => { text += `• ${t.description}: ${t.amount >= 0 ? '+' : ''}${t.amount}\n`; });
        bot.sendMessage(chatId, text || 'لا توجد معاملات');
    }
    bot.answerCallbackQuery(query.id);
});

// ============================================
// بيانات من تطبيق الويب
// ============================================
bot.on('web_app_data', (msg) => {
    try {
        const data = JSON.parse(msg.web_app_data.data);
        if (data.action === 'purchase') {
            const result = updateBalance(msg.from.id, -parseFloat(data.amount || 0), 'deduct', data.description || 'شراء');
            return bot.sendMessage(msg.chat.id, result.success ? `✅ تم! المتبقي: ${result.balance.toFixed(2)}` : result.message);
        }
        bot.sendMessage(msg.chat.id, `✅ تم: ${data.action}`);
    } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ خطأ');
    }
});

// ============================================
// تشغيل الخادم
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على ${PORT}`);
    console.log(`✅ الرابط: ${RAILWAY_URL}`);
    console.log(`✅ Webhook: ${RAILWAY_URL}/webhook`);
});
