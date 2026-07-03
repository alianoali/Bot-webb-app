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

// ============================================
// قاعدة بيانات بسيطة (ملف JSON)
// ============================================
const DB_FILE = path.join(__dirname, 'database.json');

function readDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('خطأ في قراءة قاعدة البيانات:', e);
    }
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
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
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
    if (!db.users[userId]) {
        return { success: false, message: '❌ المستخدم غير موجود', balance: 0 };
    }
    
    const newBalance = (db.users[userId].balance || 0) + amount;
    if (newBalance < 0 && amount < 0) {
        return { success: false, message: '❌ رصيد غير كافي', balance: db.users[userId].balance };
    }
    
    db.users[userId].balance = newBalance;
    db.users[userId].updated_at = new Date().toISOString();
    
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

// ============================================
// API للموقع
// ============================================
app.get('/api/user', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) {
        return res.json({ success: false, message: 'معرف المستخدم مطلوب' });
    }
    
    const db = readDB();
    const user = db.users[userId];
    
    if (!user) {
        return res.json({ success: false, message: 'المستخدم غير موجود' });
    }
    
    res.json({
        success: true,
        user: {
            user_id: user.user_id,
            first_name: user.first_name,
            username: user.username,
            balance: user.balance,
            created_at: user.created_at
        }
    });
});

app.get('/api/transactions', (req, res) => {
    const userId = req.query.user_id;
    const limit = parseInt(req.query.limit) || 10;
    
    if (!userId) {
        return res.json({ success: false, message: 'معرف المستخدم مطلوب' });
    }
    
    const transactions = getTransactions(userId, limit);
    res.json({ success: true, transactions: transactions });
});

// الصفحة الرئيسية
app.get('/', (req, res) => {
    res.send('✅ البوت يعمل! هذا تطبيق ويب لتلغرام.');
});

// ============================================
// تشغيل الخادم
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على المنفذ ${PORT}`);
    console.log(`✅ المشرف: ${ADMIN_IDS.join(', ')}`);
});

// ============================================
// رابط تطبيق الويب - Railway يضبطه تلقائياً
// ============================================
// بعد النشر على Railway، استبدل الرابط بالرابط الحقيقي
let WEB_APP_URL = process.env.RAILWAY_PUBLIC_URL || 'https://telegram-bot-production.up.railway.app';

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
        `👋 مرحباً ${firstName}!\n\n` +
        `💰 رصيدك الحالي: **${user.balance.toFixed(2)}**\n\n` +
        `اضغط على الزر لفتح التطبيق أو اختر من القائمة:`,
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
    const db = readDB();
    const user = db.users[userId];
    
    if (!user) {
        return bot.sendMessage(msg.chat.id, '❌ لم يتم العثور على حسابك. أرسل /start');
    }
    
    bot.sendMessage(msg.chat.id, `💰 **رصيدك الحالي:** **${user.balance.toFixed(2)}**`);
});

// ============================================
// أمر /history
// ============================================
bot.onText(/\/history/, (msg) => {
    const userId = msg.from.id;
    const transactions = getTransactions(userId, 10);
    
    if (transactions.length === 0) {
        return bot.sendMessage(msg.chat.id, '📋 لا توجد معاملات بعد.');
    }
    
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
    
    const result = updateBalance(targetUserId, amount, 'add', 'إضافة رصيد من المشرف');
    
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
    const db = readDB();
    const users = Object.keys(db.users);
    
    let successCount = 0;
    let failCount = 0;
    
    users.forEach((userId) => {
        bot.sendMessage(userId, `📢 **إشعار من الإدارة:**\n\n${message}`)
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
    
    const db = readDB();
    const count = Object.keys(db.users).length;
    let totalBalance = 0;
    
    Object.values(db.users).forEach(u => {
        totalBalance += u.balance || 0;
    });
    
    bot.sendMessage(msg.chat.id,
        `📊 **إحصائيات:**\n\n` +
        `👥 عدد المستخدمين: **${count}**\n` +
        `💰 إجمالي الأرصدة: **${totalBalance.toFixed(2)}**`
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
            const db = readDB();
            const user = db.users[userId];
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
            bot.sendMessage(
                chatId,
                '🤖 **بوت مع تطبيق ويب ونظام رصيد مشترك**\n\n' +
                '• الرصيد موحد بين البوت والتطبيق\n' +
                '• جميع العمليات مسجلة\n' +
                '• خدمات مدفوعة ومجانية\n\n' +
                '🛠 Node.js | Express | Railway\n' +
                '👑 المشرف: ' + ADMIN_IDS.join(', ')
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
        
        // طلب الرصيد
        if (data.action === 'get_balance') {
            const db = readDB();
            const user = db.users[userId];
            const balance = user ? user.balance.toFixed(2) : '0.00';
            return bot.sendMessage(chatId, `💰 رصيدك الحالي: **${balance}**`);
        }
        
        // طلب كشف الحساب
        if (data.action === 'get_history') {
            const transactions = getTransactions(userId, 5);
            if (transactions.length === 0) return bot.sendMessage(chatId, '📋 لا توجد معاملات.');
            let text = '📋 **آخر المعاملات:**\n\n';
            transactions.forEach(t => {
                const sign = t.amount >= 0 ? '+' : '';
                text += `• ${t.description}: ${sign}${t.amount.toFixed(2)}\n`;
            });
            return bot.sendMessage(chatId, text);
        }
        
        // عملية شراء
        if (data.action === 'purchase') {
            const amount = parseFloat(data.amount) || 0;
            const description = data.description || 'عملية شراء';
            
            if (amount <= 0) {
                return bot.sendMessage(chatId, '❌ مبلغ غير صالح.');
            }
            
            const result = updateBalance(userId, -amount, 'deduct', description);
            
            if (result.success) {
                return bot.sendMessage(
                    chatId,
                    `✅ تمت العملية بنجاح!\n` +
                    `📝 ${description}\n` +
                    `💸 المبلغ: **${amount.toFixed(2)}**\n` +
                    `💰 رصيدك المتبقي: **${result.balance.toFixed(2)}**`
                );
            } else {
                return bot.sendMessage(chatId, result.message);
            }
        }
        
        // ردود عادية
        let replyText = '';
        switch(data.action) {
            case 'request_consultation':
                replyText = '✅ تم استلام طلب الاستشارة.\nفريقنا سيتواصل معك قريباً.';
                break;
            case 'book_appointment':
                replyText = '📅 تم استلام طلب الحجز.\nسنرسل لك تأكيداً بالموعد.';
                break;
            case 'get_info':
                replyText = 'ℹ️ نحن فريق تطوير تطبيقات.\nنقدم خدمات برمجية متنوعة.';
                break;
            case 'feedback':
                replyText = '💬 شكراً على ملاحظاتك!\nنقدر وقتك وآرائك.';
                break;
            default:
                replyText = `✅ تم استلام: ${data.action}`;
        }
        
        bot.sendMessage(chatId, replyText);
        
        if (data.name && data.name.trim() !== '') {
            bot.sendMessage(chatId, `👤 شكراً ${data.name}! تم تسجيل اسمك مع الطلب.`);
        }
        
        if (data.message && data.message.trim() !== '') {
            bot.sendMessage(chatId, `📝 ملاحظتك: "${data.message}"`);
        }
        
    } catch (error) {
        console.error('خطأ في تحليل البيانات:', error);
        bot.sendMessage(chatId, '❌ حدث خطأ. حاول مرة أخرى.');
    }
});

// ============================================
// الرد على الرسائل النصية
// ============================================
bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    
    bot.sendMessage(
        msg.chat.id,
        '👋 أهلاً!\n\nاستخدم /start لرؤية القائمة الرئيسية وفتح التطبيق.\nأو استخدم /help لرؤية جميع الأوامر.'
    );
});

console.log('🚀 البوت جاهز ويعمل...');
