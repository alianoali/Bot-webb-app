const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

// التوكن الخاص بك
const TOKEN = '8746894087:AAHmdTT-2GMK0YnAcHLymSrUow5nKGukd3Q';

// معرف المشرف
const ADMIN_IDS = [6183869749];

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// قاعدة البيانات
// ============================================
const db = new Database('database.db');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        first_name TEXT,
        username TEXT,
        balance REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT,
        amount REAL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
`);

function getUser(userId, firstName, username) {
    let user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!user) {
        db.prepare('INSERT INTO users (user_id, first_name, username, balance) VALUES (?, ?, ?, 0)')
            .run(userId, firstName, username || '');
        db.prepare('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, 0, ?)')
            .run(userId, 'create', 'إنشاء الحساب');
        user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    }
    return user;
}

function updateBalance(userId, amount, type, description) {
    const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!user) return { success: false, message: '❌ المستخدم غير موجود', balance: 0 };
    const newBalance = user.balance + amount;
    if (newBalance < 0 && amount < 0) {
        return { success: false, message: '❌ رصيد غير كافي', balance: user.balance };
    }
    db.prepare('UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
        .run(newBalance, userId);
    db.prepare('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)')
        .run(userId, type, amount, description);
    return { success: true, balance: newBalance };
}

function getTransactions(userId, limit = 10) {
    return db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(userId, limit);
}

// ============================================
// API لتطبيق الويب
// ============================================
app.get('/api/user', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.json({ success: false, message: 'معرف المستخدم مطلوب' });
    const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!user) return res.json({ success: false, message: 'المستخدم غير موجود' });
    res.json({
        success: true,
        user: { user_id: user.user_id, first_name: user.first_name, username: user.username, balance: user.balance }
    });
});

app.get('/api/transactions', (req, res) => {
    const userId = req.query.user_id;
    const limit = req.query.limit || 10;
    if (!userId) return res.json({ success: false, message: 'معرف المستخدم مطلوب' });
    const transactions = getTransactions(userId, limit);
    res.json({ success: true, transactions });
});

// ============================================
// تشغيل الخادم
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على المنفذ ${PORT}`);
    console.log(`✅ المشرف: ${ADMIN_IDS.join(', ')}`);
});

// ⚠️ هذا الرابط ستغيره بعد النشر على Render
let WEB_APP_URL = process.env.RENDER_EXTERNAL_URL || 'https://bot-webb-app.onrender.com';

// ============================================
// أمر /start
// ============================================
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name;
    const username = msg.from.username;

    const user = getUser(userId, firstName, username);

    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🚀 افتح التطبيق', web_app: { url: WEB_APP_URL } }],
                [
                    { text: '💰 رصيدي', callback_data: 'balance' },
                    { text: '📋 كشف الحساب', callback_data: 'history' }
                ],
                [{ text: 'ℹ️ عن البوت', callback_data: 'about' }]
            ]
        }
    };

    bot.sendMessage(
        chatId,
        `👋 مرحباً ${firstName}!\n\n💰 رصيدك الحالي: **${user.balance.toFixed(2)}**\n\nاضغط على الزر لفتح التطبيق أو اختر من القائمة:`,
        { ...options, parse_mode: 'Markdown' }
    );
});

// ============================================
// أمر /help
// ============================================
bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id,
        '📖 **الأوامر المتاحة:**\n\n' +
        '/start - القائمة الرئيسية\n' +
        '/balance - عرض رصيدك\n' +
        '/history - كشف المعاملات\n' +
        '/addbalance [user_id] [المبلغ] - إضافة رصيد (للمشرف)\n' +
        '/broadcast [رسالة] - إرسال للجميع (للمشرف)\n' +
        '/users - عرض عدد المستخدمين (للمشرف)\n' +
        '/help - المساعدة'
    );
});

// ============================================
// أمر /balance
// ============================================
bot.onText(/\/balance/, (msg) => {
    const userId = msg.from.id;
    const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!user) return bot.sendMessage(msg.chat.id, '❌ لم يتم العثور على حسابك. أرسل /start');
    bot.sendMessage(msg.chat.id, `💰 **رصيدك الحالي:** **${user.balance.toFixed(2)}**`);
});

// ============================================
// أمر /history
// ============================================
bot.onText(/\/history/, (msg) => {
    const userId = msg.from.id;
    const transactions = getTransactions(userId, 10);
    if (transactions.length === 0) return bot.sendMessage(msg.chat.id, '📋 لا توجد معاملات بعد.');
    let text = '📋 **آخر المعاملات:**\n\n';
    transactions.forEach((t) => {
        const sign = t.amount >= 0 ? '+' : '';
        const emoji = t.type === 'add' ? '🟢' : t.type === 'deduct' ? '🔴' : '⚪';
        text += `${emoji} ${t.description}\n   ${sign}${t.amount.toFixed(2)} | ${t.created_at}\n\n`;
    });
    bot.sendMessage(msg.chat.id, text);
});

// ============================================
// أمر /addbalance (للمشرف فقط)
// ============================================
bot.onText(/\/addbalance (.+)/, (msg, match) => {
    const senderId = msg.from.id;
    if (!ADMIN_IDS.includes(senderId)) {
        return bot.sendMessage(msg.chat.id, '❌ هذا الأمر للمشرف فقط.');
    }
    const parts = match[1].split(' ');
    const targetUserId = parseInt(parts[0]);
    const amount = parseFloat(parts[1]);
    if (!targetUserId || !amount || isNaN(amount)) {
        return bot.sendMessage(msg.chat.id, '❌ الاستخدام: /addbalance [user_id] [المبلغ]');
    }
    const result = updateBalance(targetUserId, amount, 'add', `إضافة رصيد من المشرف`);
    if (result.success) {
        bot.sendMessage(msg.chat.id, `✅ تمت إضافة ${amount.toFixed(2)} للمستخدم ${targetUserId}\nالرصيد الجديد: ${result.balance.toFixed(2)}`);
        bot.sendMessage(targetUserId, `💰 تمت إضافة **${amount.toFixed(2)}** إلى رصيدك!\nرصيدك الحالي: **${result.balance.toFixed(2)}**`)
            .catch(() => console.log('لم يتم إرسال الإشعار للمستخدم'));
    } else {
        bot.sendMessage(msg.chat.id, result.message);
    }
});

// ============================================
// أمر /broadcast (للمشرف فقط)
// ============================================
bot.onText(/\/broadcast (.+)/, (msg, match) => {
    const senderId = msg.from.id;
    if (!ADMIN_IDS.includes(senderId)) {
        return bot.sendMessage(msg.chat.id, '❌ هذا الأمر للمشرف فقط.');
    }
    const message = match[1];
    const users = db.prepare('SELECT user_id FROM users').all();
    let successCount = 0;
    let failCount = 0;
    users.forEach((user) => {
        bot.sendMessage(user.user_id, `📢 **إشعار من الإدارة:**\n\n${message}`)
            .then(() => successCount++)
            .catch(() => failCount++);
    });
    setTimeout(() => {
        bot.sendMessage(msg.chat.id, `✅ تم الإرسال إلى ${successCount} مستخدم\n❌ فشل: ${failCount}`);
    }, 2000);
});

// ============================================
// أمر /users (للمشرف فقط)
// ============================================
bot.onText(/\/users/, (msg) => {
    const senderId = msg.from.id;
    if (!ADMIN_IDS.includes(senderId)) {
        return bot.sendMessage(msg.chat.id, '❌ هذا الأمر للمشرف فقط.');
    }
    const count = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const totalBalance = db.prepare('SELECT SUM(balance) as total FROM users').get();
    bot.sendMessage(msg.chat.id,
        `📊 **إحصائيات:**\n\n` +
        `👥 عدد المستخدمين: **${count.count}**\n` +
        `💰 إجمالي الأرصدة: **${totalBalance.total?.toFixed(2) || '0.00'}**`
    );
});

// ============================================
// معالجة الأزرار
// ============================================
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    switch(data) {
        case 'balance':
            const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
            const balance = user ? user.balance.toFixed(2) : '0.00';
            bot.sendMessage(chatId, `💰 رصيدك الحالي: **${balance}**`);
            break;
        case 'history':
            const transactions = getTransactions(userId, 5);
            if (transactions.length === 0) {
                bot.sendMessage(chatId, '📋 لا توجد معاملات.');
            } else {
                let text = '📋 **آخر 5 معاملات:**\n\n';
                transactions.forEach(t => {
                    const sign = t.amount >= 0 ? '+' : '';
                    text += `• ${t.description}: ${sign}${t.amount.toFixed(2)}\n`;
                });
                bot.sendMessage(chatId, text);
            }
            break;
        case 'about':
            bot.sendMessage(chatId,
                '🤖 **بوت مع تطبيق ويب ونظام رصيد مشترك**\n\n' +
                '• الرصيد موحد بين البوت والتطبيق\n' +
                '• جميع العمليات مسجلة\n' +
                '• خدمات مدفوعة ومجانية\n\n' +
                '🛠 Node.js | Express | SQLite\n' +
                '☁️ Render'
            );
            break;
    }
    bot.answerCallbackQuery(query.id);
});

// ============================================
// استقبال البيانات من تطبيق الويب
// ============================================
bot.on('web_app_data', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        const data = JSON.parse(msg.web_app_data.data);

        if (data.action === 'get_balance') {
            const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
            const balance = user ? user.balance.toFixed(2) : '0.00';
            return bot.sendMessage(chatId, `💰 رصيدك الحالي: **${balance}**`);
        }

        if (data.action === 'get_history') {
            const transactions = getTransactions(userId, 5);
            if (transactions.length === 0) return bot.sendMessage(chatId, '📋 لا توجد معاملات.');
            let text = '📋 **آخر 5 معاملات:**\n\n';
            transactions.forEach(t => {
                const sign = t.amount >= 0 ? '+' : '';
                text += `• ${t.description}: ${sign}${t.amount.toFixed(2)}\n`;
            });
            return bot.sendMessage(chatId, text);
        }

        if (data.action === 'purchase') {
            const amount = parseFloat(data.amount) || 0;
            const description = data.description || 'عملية شراء';
            if (amount <= 0) return bot.sendMessage(chatId, '❌ مبلغ غير صالح.');
            const result = updateBalance(userId, -amount, 'deduct', description);
            if (result.success) {
                return bot.sendMessage(chatId,
                    `✅ تمت العملية بنجاح!\n📝 ${description}\n💸 المبلغ: **${amount.toFixed(2)}**\n💰 رصيدك المتبقي: **${result.balance.toFixed(2)}**`
                );
            } else {
                return bot.sendMessage(chatId, result.message);
            }
        }

        let replyText = '';
        switch(data.action) {
            case 'request_consultation': replyText = '✅ تم استلام طلب الاستشارة.'; break;
            case 'book_appointment': replyText = '📅 تم استلام طلب الحجز.'; break;
            case 'get_info': replyText = 'ℹ️ نحن فريق تطوير تطبيقات.'; break;
            case 'feedback': replyText = '💬 شكراً على ملاحظاتك!'; break;
            default: replyText = `✅ تم استلام: ${data.action}`;
        }
        bot.sendMessage(chatId, replyText);
        if (data.name && data.name.trim() !== '') {
            bot.sendMessage(chatId, `👤 شكراً ${data.name}!`);
        }
    } catch (error) {
        console.error('خطأ:', error);
        bot.sendMessage(chatId, '❌ حدث خطأ.');
    }
});

bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    bot.sendMessage(msg.chat.id, '👋 استخدم /start للقائمة الرئيسية.');
});

console.log('🚀 البوت جاهز ويعمل...');
