const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const fs = require('fs');

// ============================================
// الإعدادات
// ============================================
const TOKEN = '8746894087:AAHmdTT-2GMK0YnAcHLymSrUow5nKGukd3Q';
const ADMIN_IDS = [6183869749];
const DB_FILE = path.join(__dirname, 'database.json');

// ============================================
// تهيئة البوت والخادم
// ============================================
const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// نظام قاعدة البيانات (JSON)
// ============================================
function readDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            if (!data.users) data.users = {};
            if (!data.transactions) data.transactions = [];
            return data;
        }
    } catch (e) {
        console.error('❌ خطأ في قراءة قاعدة البيانات:', e.message);
    }
    return { users: {}, transactions: [] };
}

function writeDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('❌ خطأ في كتابة قاعدة البيانات:', e.message);
        return false;
    }
}

function getUser(userId, firstName, username) {
    const db = readDB();
    
    if (!db.users[userId]) {
        db.users[userId] = {
            user_id: userId,
            first_name: firstName || 'مستخدم',
            username: username || '',
            balance: 0,
            total_earned: 0,
            total_spent: 0,
            purchases_count: 0,
            created_at: new Date().toISOString(),
            last_activity: new Date().toISOString()
        };
        
        db.transactions.push({
            id: Date.now(),
            user_id: userId,
            type: 'welcome',
            amount: 0,
            description: '🎉 إنشاء الحساب - مرحباً بك!',
            created_at: new Date().toISOString()
        });
        
        writeDB(db);
    }
    
    return db.users[userId];
}

function updateBalance(userId, amount, type, description) {
    const db = readDB();
    
    if (!db.users[userId]) {
        return { success: false, message: '❌ المستخدم غير موجود. أرسل /start أولاً.', balance: 0 };
    }
    
    const user = db.users[userId];
    const newBalance = (user.balance || 0) + amount;
    
    if (newBalance < 0 && amount < 0) {
        return { 
            success: false, 
            message: `❌ رصيدك غير كافي!\n💰 رصيدك: ${user.balance.toFixed(2)}\n💸 المطلوب: ${Math.abs(amount).toFixed(2)}`, 
            balance: user.balance 
        };
    }
    
    user.balance = newBalance;
    user.last_activity = new Date().toISOString();
    
    if (amount > 0) {
        user.total_earned = (user.total_earned || 0) + amount;
    } else {
        user.total_spent = (user.total_spent || 0) + Math.abs(amount);
        user.purchases_count = (user.purchases_count || 0) + 1;
    }
    
    db.transactions.push({
        id: Date.now(),
        user_id: userId,
        type: type,
        amount: amount,
        description: description,
        created_at: new Date().toISOString()
    });
    
    if (writeDB(db)) {
        return { success: true, balance: newBalance, user: user };
    } else {
        return { success: false, message: '❌ خطأ في حفظ البيانات. حاول مرة أخرى.', balance: user.balance };
    }
}

function getTransactions(userId, limit = 20) {
    const db = readDB();
    return db.transactions
        .filter(t => t.user_id == userId)
        .sort((a, b) => b.id - a.id)
        .slice(0, limit);
}

function getUserStats(userId) {
    const db = readDB();
    const user = db.users[userId];
    if (!user) return null;
    
    const allTransactions = db.transactions.filter(t => t.user_id == userId);
    const purchases = allTransactions.filter(t => t.type === 'deduct');
    
    return {
        balance: user.balance || 0,
        total_earned: user.total_earned || 0,
        total_spent: user.total_spent || 0,
        purchases_count: purchases.length,
        member_since: user.created_at,
        last_activity: user.last_activity,
        level: getLevel(user.balance || 0)
    };
}

function getLevel(balance) {
    if (balance >= 5000) return { name: '👑 الماسي', color: '#7C3AED', emoji: '💎' };
    if (balance >= 2000) return { name: '🥇 الذهبي', color: '#F59E0B', emoji: '🏆' };
    if (balance >= 1000) return { name: '🥈 الفضي', color: '#6B7280', emoji: '🥈' };
    if (balance >= 500)  return { name: '🥉 البرونزي', color: '#D97706', emoji: '🥉' };
    if (balance >= 100)  return { name: '⭐ نشط', color: '#10B981', emoji: '⭐' };
    return { name: '🌱 جديد', color: '#6B7280', emoji: '🌱' };
}

// ============================================
// واجهة API لتطبيق الويب
// ============================================
app.get('/api/user', (req, res) => {
    const userId = parseInt(req.query.user_id);
    
    if (!userId) {
        return res.status(400).json({ success: false, message: 'معرف المستخدم مطلوب' });
    }
    
    const db = readDB();
    const user = db.users[userId];
    
    if (!user) {
        return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }
    
    const stats = getUserStats(userId);
    
    res.json({
        success: true,
        user: {
            user_id: user.user_id,
            first_name: user.first_name,
            username: user.username,
            balance: user.balance,
            created_at: user.created_at,
            last_activity: user.last_activity
        },
        stats: stats
    });
});

app.get('/api/transactions', (req, res) => {
    const userId = parseInt(req.query.user_id);
    const limit = parseInt(req.query.limit) || 20;
    
    if (!userId) {
        return res.status(400).json({ success: false, message: 'معرف المستخدم مطلوب' });
    }
    
    const transactions = getTransactions(userId, limit);
    res.json({ success: true, transactions: transactions, count: transactions.length });
});

app.get('/api/stats', (req, res) => {
    const userId = parseInt(req.query.user_id);
    
    if (!userId) {
        return res.status(400).json({ success: false, message: 'معرف المستخدم مطلوب' });
    }
    
    const stats = getUserStats(userId);
    
    if (!stats) {
        return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }
    
    res.json({ success: true, stats: stats });
});

// الصفحة الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// تشغيل الخادم
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('═══════════════════════════════════');
    console.log('🚀 البوت الاحترافي جاهز ويعمل');
    console.log(`📡 الخادم: http://localhost:${PORT}`);
    console.log(`👑 المشرف: ${ADMIN_IDS.join(', ')}`);
    console.log('═══════════════════════════════════');
});

// رابط تطبيق الويب - سيتم تحديثه تلقائياً من Railway
let WEB_APP_URL = process.env.RAILWAY_PUBLIC_URL || '';

// ============================================
// أمر /start
// ============================================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name;
    const username = msg.from.username;

    const user = getUser(userId, firstName, username);
    const level = getLevel(user.balance);

    const welcomeMessage = 
        `╭━━━━━━━━━━━━━━━━━╮\n` +
        `👋 *مرحباً ${firstName}!*\n` +
        `╰━━━━━━━━━━━━━━━━━╯\n\n` +
        `${level.emoji} *المستوى:* ${level.name}\n` +
        `💰 *الرصيد:* ${user.balance.toFixed(2)} نقطة\n` +
        `📅 *عضو منذ:* ${new Date(user.created_at).toLocaleDateString('ar-SA')}\n\n` +
        `اضغط على الزر أدناه لفتح التطبيق 👇`;

    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🚀 افتح التطبيق', web_app: { url: WEB_APP_URL } }],
                [
                    { text: '💰 رصيدي', callback_data: 'balance' },
                    { text: '📋 كشف الحساب', callback_data: 'history' }
                ],
                [
                    { text: '📊 إحصائياتي', callback_data: 'stats' },
                    { text: 'ℹ️ عن البوت', callback_data: 'about' }
                ]
            ]
        },
        parse_mode: 'Markdown'
    };

    bot.sendMessage(chatId, welcomeMessage, options);
});

// ============================================
// أمر /help
// ============================================
bot.onText(/\/help/, (msg) => {
    const helpText = 
        '╭━━━━━━━━━━━━━━━━━╮\n' +
        '📖 *دليل الأوامر*\n' +
        '╰━━━━━━━━━━━━━━━━━╯\n\n' +
        '🎯 *الأوامر الأساسية:*\n' +
        '• /start - القائمة الرئيسية\n' +
        '• /balance - عرض رصيدك\n' +
        '• /history - كشف المعاملات\n' +
        '• /stats - إحصائياتك\n' +
        '• /help - هذه القائمة\n\n' +
        '👑 *أوامر المشرف:*\n' +
        '• /addbalance [id] [مبلغ]\n' +
        '• /broadcast [رسالة]\n' +
        '• /users - إحصائيات البوت\n\n' +
        '💡 *نصيحة:* افتح التطبيق لتجربة أفضل!';

    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
});

// ============================================
// أمر /balance
// ============================================
bot.onText(/\/balance/, (msg) => {
    const userId = msg.from.id;
    const db = readDB();
    const user = db.users[userId];
    
    if (!user) {
        return bot.sendMessage(msg.chat.id, '❌ لم يتم العثور على حسابك.\nأرسل /start للبدء.');
    }
    
    const level = getLevel(user.balance);
    
    const balanceText = 
        `╭━━━━━━━━━━━━━━━━━╮\n` +
        `💰 *رصيدي*\n` +
        `╰━━━━━━━━━━━━━━━━━╯\n\n` +
        `💎 *الرصيد:* ${user.balance.toFixed(2)} نقطة\n` +
        `${level.emoji} *المستوى:* ${level.name}\n` +
        `📥 *المستلم:* ${(user.total_earned || 0).toFixed(2)}\n` +
        `📤 *المنفق:* ${(user.total_spent || 0).toFixed(2)}`;

    bot.sendMessage(msg.chat.id, balanceText, { parse_mode: 'Markdown' });
});

// ============================================
// أمر /stats
// ============================================
bot.onText(/\/stats/, (msg) => {
    const userId = msg.from.id;
    const stats = getUserStats(userId);
    
    if (!stats) {
        return bot.sendMessage(msg.chat.id, '❌ لم يتم العثور على حسابك.\nأرسل /start للبدء.');
    }
    
    const statsText = 
        `╭━━━━━━━━━━━━━━━━━╮\n` +
        `📊 *إحصائياتي*\n` +
        `╰━━━━━━━━━━━━━━━━━╯\n\n` +
        `${stats.level.emoji} *المستوى:* ${stats.level.name}\n` +
        `💰 *الرصيد:* ${stats.balance.toFixed(2)}\n` +
        `📥 *إجمالي المستلم:* ${stats.total_earned.toFixed(2)}\n` +
        `📤 *إجمالي المنفق:* ${stats.total_spent.toFixed(2)}\n` +
        `🛒 *عدد المشتريات:* ${stats.purchases_count}\n` +
        `📅 *عضو منذ:* ${new Date(stats.member_since).toLocaleDateString('ar-SA')}`;

    bot.sendMessage(msg.chat.id, statsText, { parse_mode: 'Markdown' });
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
    
    let text = '╭━━━━━━━━━━━━━━━━━╮\n📋 *كشف المعاملات*\n╰━━━━━━━━━━━━━━━━━╯\n\n';
    
    transactions.forEach((t, i) => {
        const emoji = t.type === 'add' || t.type === 'welcome' ? '🟢' : 
                      t.type === 'deduct' ? '🔴' : '⚪';
        const sign = t.amount >= 0 ? '+' : '';
        const date = new Date(t.created_at).toLocaleDateString('ar-SA');
        text += `${i + 1}. ${emoji} ${t.description}\n   💰 ${sign}${t.amount.toFixed(2)} | 📅 ${date}\n\n`;
    });
    
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

// ============================================
// أمر /addbalance (للمشرف)
// ============================================
bot.onText(/\/addbalance (.+)/, (msg, match) => {
    const senderId = msg.from.id;
    
    if (!ADMIN_IDS.includes(senderId)) {
        return bot.sendMessage(msg.chat.id, '⛔ هذا الأمر للمشرف فقط.');
    }
    
    const parts = match[1].trim().split(/\s+/);
    
    if (parts.length < 2) {
        return bot.sendMessage(msg.chat.id, '❌ *الاستخدام:* `/addbalance [user_id] [المبلغ]`\n\n*مثال:* `/addbalance 123456789 500`', { parse_mode: 'Markdown' });
    }
    
    const targetUserId = parseInt(parts[0]);
    const amount = parseFloat(parts[1]);
    const reason = parts.slice(2).join(' ') || 'إضافة رصيد من المشرف';
    
    if (isNaN(targetUserId) || isNaN(amount)) {
        return bot.sendMessage(msg.chat.id, '❌ قيم غير صالحة.\n*الاستخدام:* `/addbalance [user_id] [المبلغ]`', { parse_mode: 'Markdown' });
    }
    
    const result = updateBalance(targetUserId, amount, 'add', reason);
    
    if (result.success) {
        bot.sendMessage(
            msg.chat.id,
            `✅ *تمت الإضافة بنجاح!*\n\n👤 المستخدم: ${targetUserId}\n💰 المبلغ: ${amount.toFixed(2)}\n📝 السبب: ${reason}\n💎 الرصيد الجديد: ${result.balance.toFixed(2)}`,
            { parse_mode: 'Markdown' }
        );
        
        bot.sendMessage(
            targetUserId,
            `🎉 *مبروك!*\n\n💰 تمت إضافة *${amount.toFixed(2)}* نقطة إلى رصيدك!\n📝 ${reason}\n💎 رصيدك الحالي: *${result.balance.toFixed(2)}*`,
            { parse_mode: 'Markdown' }
        ).catch(() => {
            bot.sendMessage(msg.chat.id, '⚠️ لم يتم إرسال إشعار للمستخدم.');
        });
    } else {
        bot.sendMessage(msg.chat.id, result.message);
    }
});

// ============================================
// أمر /broadcast (للمشرف)
// ============================================
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    const senderId = msg.from.id;
    
    if (!ADMIN_IDS.includes(senderId)) {
        return bot.sendMessage(msg.chat.id, '⛔ هذا الأمر للمشرف فقط.');
    }
    
    const message = match[1];
    const db = readDB();
    const userIds = Object.keys(db.users);
    
    if (userIds.length === 0) {
        return bot.sendMessage(msg.chat.id, '❌ لا يوجد مستخدمين.');
    }
    
    let success = 0;
    let failed = 0;
    
    bot.sendMessage(msg.chat.id, `📢 جاري الإرسال إلى ${userIds.length} مستخدم...`);
    
    for (const userId of userIds) {
        try {
            await bot.sendMessage(
                userId,
                `📢 *إشعار من الإدارة*\n\n${message}\n\n───\n🤖 ${new Date().toLocaleDateString('ar-SA')}`,
                { parse_mode: 'Markdown' }
            );
            success++;
        } catch (e) {
            failed++;
        }
        await new Promise(r => setTimeout(r, 50));
    }
    
    bot.sendMessage(
        msg.chat.id,
        `✅ *تم الإرسال!*\n\n📊 النتائج:\n✅ ناجح: ${success}\n❌ فشل: ${failed}`,
        { parse_mode: 'Markdown' }
    );
});

// ============================================
// أمر /users (للمشرف)
// ============================================
bot.onText(/\/users/, (msg) => {
    const senderId = msg.from.id;
    
    if (!ADMIN_IDS.includes(senderId)) {
        return bot.sendMessage(msg.chat.id, '⛔ هذا الأمر للمشرف فقط.');
    }
    
    const db = readDB();
    const userIds = Object.keys(db.users);
    let totalBalance = 0;
    let activeToday = 0;
    
    const today = new Date().toDateString();
    
    userIds.forEach(id => {
        const user = db.users[id];
        totalBalance += user.balance || 0;
        if (user.last_activity && new Date(user.last_activity).toDateString() === today) {
            activeToday++;
        }
    });
    
    const statsText = 
        `╭━━━━━━━━━━━━━━━━━╮\n` +
        `📊 *إحصائيات البوت*\n` +
        `╰━━━━━━━━━━━━━━━━━╯\n\n` +
        `👥 *إجمالي المستخدمين:* ${userIds.length}\n` +
        `🟢 *نشط اليوم:* ${activeToday}\n` +
        `💰 *إجمالي الأرصدة:* ${totalBalance.toFixed(2)}\n` +
        `💵 *متوسط الرصيد:* ${userIds.length > 0 ? (totalBalance / userIds.length).toFixed(2) : '0.00'}`;

    bot.sendMessage(msg.chat.id, statsText, { parse_mode: 'Markdown' });
});

// ============================================
// معالجة الأزرار (Callback Query)
// ============================================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    try {
        switch(data) {
            case 'balance': {
                const db = readDB();
                const user = db.users[userId];
                if (!user) {
                    await bot.sendMessage(chatId, '❌ لم يتم العثور على حسابك.\nأرسل /start للبدء.');
                    break;
                }
                const level = getLevel(user.balance);
                await bot.sendMessage(
                    chatId,
                    `💰 *رصيدك:* ${user.balance.toFixed(2)} نقطة\n${level.emoji} *المستوى:* ${level.name}`,
                    { parse_mode: 'Markdown' }
                );
                break;
            }
            
            case 'history': {
                const transactions = getTransactions(userId, 5);
                if (transactions.length === 0) {
                    await bot.sendMessage(chatId, '📋 لا توجد معاملات.');
                    break;
                }
                let text = '📋 *آخر 5 معاملات:*\n\n';
                transactions.forEach(t => {
                    const emoji = t.amount >= 0 ? '🟢' : '🔴';
                    const sign = t.amount >= 0 ? '+' : '';
                    text += `${emoji} ${t.description}: ${sign}${t.amount.toFixed(2)}\n`;
                });
                await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                break;
            }
            
            case 'stats': {
                const stats = getUserStats(userId);
                if (!stats) {
                    await bot.sendMessage(chatId, '❌ لم يتم العثور على حسابك.');
                    break;
                }
                await bot.sendMessage(
                    chatId,
                    `📊 *إحصائياتك*\n\n${stats.level.emoji} المستوى: ${stats.level.name}\n💰 الرصيد: ${stats.balance.toFixed(2)}\n🛒 المشتريات: ${stats.purchases_count}`,
                    { parse_mode: 'Markdown' }
                );
                break;
            }
            
            case 'about': {
                await bot.sendMessage(
                    chatId,
                    '🤖 *بوت احترافي*\n\n' +
                    '✨ مميزات كاملة:\n' +
                    '• تطبيق ويب احترافي\n' +
                    '• نظام رصيد مشترك\n' +
                    '• مستويات للأعضاء\n' +
                    '• إحصائيات مفصلة\n\n' +
                    '🛠 Node.js | Express | Railway\n' +
                    '👑 بوت آمن وموثوق',
                    { parse_mode: 'Markdown' }
                );
                break;
            }
        }
    } catch (e) {
        console.error('خطأ في معالجة الزر:', e);
    }
    
    bot.answerCallbackQuery(query.id).catch(() => {});
});

// ============================================
// استقبال البيانات من تطبيق الويب
// ============================================
bot.on('web_app_data', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        const data = JSON.parse(msg.web_app_data.data);
        
        // طلب الرصيد
        if (data.action === 'get_balance') {
            const db = readDB();
            const user = db.users[userId];
            const balance = user ? user.balance.toFixed(2) : '0.00';
            const level = user ? getLevel(user.balance) : getLevel(0);
            return bot.sendMessage(
                chatId,
                `${level.emoji} *${level.name}*\n💰 رصيدك: *${balance}* نقطة`,
                { parse_mode: 'Markdown' }
            );
        }
        
        // طلب الإحصائيات
        if (data.action === 'get_stats') {
            const stats = getUserStats(userId);
            if (!stats) return bot.sendMessage(chatId, '❌ لم يتم العثور على حسابك.');
            return bot.sendMessage(
                chatId,
                `📊 *إحصائياتك*\n\n${stats.level.emoji} المستوى: ${stats.level.name}\n💰 الرصيد: ${stats.balance.toFixed(2)}\n📥 المستلم: ${stats.total_earned.toFixed(2)}\n📤 المنفق: ${stats.total_spent.toFixed(2)}\n🛒 المشتريات: ${stats.purchases_count}`,
                { parse_mode: 'Markdown' }
            );
        }
        
        // طلب كشف الحساب
        if (data.action === 'get_history') {
            const transactions = getTransactions(userId, 5);
            if (transactions.length === 0) return bot.sendMessage(chatId, '📋 لا توجد معاملات.');
            let text = '📋 *آخر المعاملات:*\n\n';
            transactions.forEach(t => {
                const emoji = t.amount >= 0 ? '🟢' : '🔴';
                const sign = t.amount >= 0 ? '+' : '';
                text += `${emoji} ${t.description}: ${sign}${t.amount.toFixed(2)}\n`;
            });
            return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
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
                    `✅ *تمت العملية بنجاح!*\n\n🛒 ${description}\n💸 المبلغ: *${amount.toFixed(2)}*\n💰 المتبقي: *${result.balance.toFixed(2)}*`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                return bot.sendMessage(chatId, result.message);
            }
        }
        
        // ردود الخدمات المجانية
        const replies = {
            'request_consultation': '✅ *تم استلام طلب الاستشارة*\n📋 فريقنا سيتواصل معك قريباً.',
            'book_appointment': '📅 *تم استلام طلب الحجز*\n✅ سنرسل لك تأكيداً بالموعد.',
            'get_info': 'ℹ️ *معلومات عنا*\n\nنحن فريق محترف في تطوير التطبيقات والخدمات البرمجية.',
            'feedback': '💬 *شكراً على ملاحظاتك!*\n🌟 نقدر وقتك وآرائك.',
            'support': '🎧 *الدعم الفني*\n\nتم استلام طلبك وسنرد عليك بأقرب وقت.'
        };
        
        const replyText = replies[data.action] || `✅ تم استلام: ${data.action}`;
        await bot.sendMessage(chatId, replyText, { parse_mode: 'Markdown' });
        
        if (data.name && data.name.trim()) {
            await bot.sendMessage(chatId, `👤 شكراً *${data.name}*! تم تسجيل بياناتك.`, { parse_mode: 'Markdown' });
        }
        
        if (data.message && data.message.trim()) {
            await bot.sendMessage(chatId, `📝 *ملاحظتك:* ${data.message}`, { parse_mode: 'Markdown' });
        }
        
    } catch (error) {
        console.error('❌ خطأ في معالجة بيانات تطبيق الويب:', error);
        bot.sendMessage(chatId, '❌ حدث خطأ في معالجة طلبك. حاول مرة أخرى.');
    }
});

// ============================================
// الرد على الرسائل النصية العادية
// ============================================
bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    
    const replies = [
        '👋 أهلاً! استخدم /start للقائمة الرئيسية.',
        '💡 افتح التطبيق للحصول على تجربة أفضل! أرسل /start',
        '📖 لرؤية جميع الأوامر، أرسل /help',
        '🎯 أرسل /start للبدء'
    ];
    
    const randomReply = replies[Math.floor(Math.random() * replies.length)];
    bot.sendMessage(msg.chat.id, randomReply);
});

// ============================================
// معالجة الأخطاء العامة
// ============================================
process.on('uncaughtException', (error) => {
    console.error('❌ خطأ غير معالج:', error.message);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ خطأ في Promise:', error.message);
});

console.log('✅ تم تحميل جميع الأنظمة بنجاح');
