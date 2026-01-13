require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

console.log('🚀 Telegram Bot starting on Railway...');

// ==================== CONFIG ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE_URL = 'https://food-delivery-api-production-8385.up.railway.app';
const PORT = process.env.PORT || 3000;

// Validate required env vars
if (!TELEGRAM_TOKEN) {
  console.error('❌ ERROR: TELEGRAM_TOKEN not set!');
  process.exit(1);
}

if (!ADMIN_API_KEY) {
  console.error('❌ ERROR: ADMIN_API_KEY not set!');
  process.exit(1);
}

console.log('✅ Config loaded');
console.log('🔗 API Server:', API_BASE_URL);

// ==================== WEBHOOK SETUP ====================
const app = express();
app.use(express.json());

// Get Railway domain
const RAILWAY_PUBLIC_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN;
const RAILWAY_STATIC_URL = process.env.RAILWAY_STATIC_URL;

let webhookUrl;
if (RAILWAY_PUBLIC_DOMAIN) {
  webhookUrl = `https://${RAILWAY_PUBLIC_DOMAIN}/bot${TELEGRAM_TOKEN}`;
} else if (RAILWAY_STATIC_URL) {
  webhookUrl = `${RAILWAY_STATIC_URL}/bot${TELEGRAM_TOKEN}`;
} else {
  console.error('❌ No Railway domain found!');
  process.exit(1);
}

console.log('🌐 Webhook URL:', webhookUrl);

// Create bot
const bot = new TelegramBot(TELEGRAM_TOKEN);

// ==================== API HELPER ====================
async function callAdminAPI(endpoint, method = 'GET') {
  try {
    const response = await axios({
      method,
      url: `${API_BASE_URL}${endpoint}`,
      headers: {
        'X-Admin-API-Key': ADMIN_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    console.error('API Error:', error.message);
    throw error;
  }
}

// ==================== BOT COMMANDS ====================

// /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '🤖 *Food Delivery Admin Bot*\n\n' +
    'Commands:\n' +
    '• /toggle [id] - Toggle dish availability\n' +
    '• /dish [id] - Show dish info\n' +
    '• /restaurants - List restaurants\n' +
    '• /help - Help\n\n' +
    'Examples:\n' +
    '/toggle 1\n' +
    '/dish 1',
    { parse_mode: 'Markdown' }
  );
});

// /toggle [id]
bot.onText(/\/toggle (\d+)/, async (msg, match) => {
  const dishId = match[1];
  
  try {
    const result = await callAdminAPI(`/bot/dish/${dishId}/toggle`, 'POST');
    bot.sendMessage(msg.chat.id, `✅ ${result.message}`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.response?.data?.error || error.message}`);
  }
});

// /dish [id]
bot.onText(/\/dish (\d+)/, async (msg, match) => {
  const dishId = match[1];
  
  try {
    const result = await callAdminAPI(`/bot/dish/${dishId}`);
    const dish = result.dish;
    
    const status = dish.is_available ? '✅ Available' : '❌ Unavailable';
    bot.sendMessage(msg.chat.id,
      `🍽️ *${dish.name}*\n\n` +
      `💰 ${dish.price} ₽\n` +
      `📊 ${status}\n` +
      `🏪 ${dish.restaurant_name}\n\n` +
      `Toggle: /toggle ${dishId}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${error.response?.data?.error || error.message}`);
  }
});

// /help
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '📋 *Help*\n\n' +
    '*/toggle [id]* - Toggle dish\n' +
    '*/dish [id]* - Dish info\n' +
    '*/restaurants* - List restaurants\n\n' +
    'Example: /toggle 1',
    { parse_mode: 'Markdown' }
  );
});

// ==================== WEBHOOK ENDPOINT ====================
app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'telegram-bot',
    timestamp: new Date().toISOString()
  });
});

// ==================== START SERVER ====================
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  
  try {
    // Set webhook
    await bot.setWebHook(webhookUrl);
    console.log('✅ Webhook set');
    
    // Get bot info
    const botInfo = await bot.getMe();
    console.log(`🤖 Bot: @${botInfo.username} (${botInfo.first_name})`);
    
    console.log('🎉 Bot is ready!');
    
  } catch (error) {
    console.error('❌ Failed to start bot:', error.message);
  }
});
