// bot.js - с polling для Railway
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

console.log('🚀 Telegram Bot starting on Railway (Polling mode)...');

// ==================== CONFIG ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE_URL = 'https://food-delivery-api-production-8385.up.railway.app';

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
console.log('🤖 Bot starting in POLLING mode...');

// ==================== CREATE BOT WITH POLLING ====================
const bot = new TelegramBot(TELEGRAM_TOKEN, {
  polling: {
    interval: 3000,  // Poll every 3 seconds
    autoStart: true,
    params: {
      timeout: 30,   // 30 second timeout
      limit: 100
    }
  },
  request: {
    timeout: 30000   // 30 second request timeout
  }
});

// Handle polling errors gracefully
bot.on('polling_error', (error) => {
  console.error('🔴 Polling error:', error.message);
  
  // Auto-restart on timeout
  if (error.message.includes('ESOCKETTIMEDOUT') || error.message.includes('EFATAL')) {
    console.log('🔄 Auto-restarting polling in 10 seconds...');
    setTimeout(() => {
      bot.stopPolling();
      setTimeout(() => {
        console.log('🔄 Restarting polling...');
        bot.startPolling();
      }, 2000);
    }, 10000);
  }
});

bot.on('error', (error) => {
  console.error('🔴 Bot error:', error.message);
});

// ==================== API HELPER ====================
async function callAdminAPI(endpoint, method = 'GET') {
  try {
    console.log(`📡 API call: ${method} ${endpoint}`);
    
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
    console.error('❌ API Error:', error.message);
    throw error;
  }
}

// ==================== BOT COMMANDS ====================

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  console.log(`👋 Start from ${chatId}`);
  
  bot.sendMessage(chatId,
    '🤖 *Food Delivery Admin Bot*\n\n' +
    '✅ Connected to API\n' +
    '🔗 ' + API_BASE_URL + '\n\n' +
    '📋 *Commands:*\n' +
    '• /toggle [id] - Toggle dish\n' +
    '• /dish [id] - Dish info\n' +
    '• /restaurants - List restaurants\n' +
    '• /help - Help\n\n' +
    '📝 *Examples:*\n' +
    '/toggle 1\n' +
    '/dish 1',
    { parse_mode: 'Markdown' }
  );
});

// /toggle [id]
bot.onText(/\/toggle (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const dishId = match[1];
  
  try {
    await bot.sendChatAction(chatId, 'typing');
    const result = await callAdminAPI(`/bot/dish/${dishId}/toggle`, 'POST');
    
    const status = result.dish.is_available ? '✅ Available' : '❌ Unavailable';
    bot.sendMessage(chatId,
      `🔄 *Status Changed*\n\n` +
      `🍽️ ${result.dish.name}\n` +
      `🏪 ${result.dish.restaurant_name}\n\n` +
      `📊 New status: ${status}\n\n` +
      `🔍 View: /dish ${dishId}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    bot.sendMessage(chatId,
      `❌ *Error*\n\n` +
      `${error.response?.data?.error || error.message}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// /dish [id]
bot.onText(/\/dish (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const dishId = match[1];
  
  try {
    await bot.sendChatAction(chatId, 'typing');
    const result = await callAdminAPI(`/bot/dish/${dishId}`);
    const dish = result.dish;
    
    const status = dish.is_available ? '✅ Available' : '❌ Unavailable';
    bot.sendMessage(chatId,
      `🍽️ *${dish.name}*\n\n` +
      `💰 ${dish.price} ₽\n` +
      `📊 ${status}\n` +
      `🏪 ${dish.restaurant_name}\n` +
      `⏱️ ${dish.preparation_time} min\n\n` +
      `🔄 Toggle: /toggle ${dishId}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    bot.sendMessage(chatId,
      `❌ *Error*\n\n` +
      `${error.response?.data?.error || error.message}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// /help
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '📋 *Help*\n\n' +
    '*/toggle [id]* - Toggle dish availability\n' +
    '*/dish [id]* - Show dish information\n' +
    '*/restaurants* - List all restaurants\n\n' +
    '*Examples:*\n' +
    '/toggle 1\n' +
    '/dish 2\n' +
    '/restaurants',
    { parse_mode: 'Markdown' }
  );
});

// /restaurants
bot.onText(/\/restaurants/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    await bot.sendChatAction(chatId, 'typing');
    const restaurants = await callAdminAPI('/restaurants');
    
    let message = `🏪 *Restaurants*\n\n`;
    
    restaurants.forEach(rest => {
      message += 
        `*${rest.name}*\n` +
        `⭐ ${rest.rating || 'No rating'}\n` +
        `🚚 ${rest.delivery_time}\n` +
        `💰 ${rest.delivery_price}\n` +
        `📋 /menu_${rest.id}\n\n`;
    });
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Quick commands
bot.onText(/\/dish_(\d+)/, (msg, match) => {
  msg.text = `/dish ${match[1]}`;
  bot.processUpdate({ message: msg });
});

bot.onText(/\/toggle_(\d+)/, (msg, match) => {
  msg.text = `/toggle ${match[1]}`;
  bot.processUpdate({ message: msg });
});

// ==================== HEALTH CHECK SERVER ====================
// Simple HTTP server for Railway health checks
const http = require('http');

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'telegram-bot',
      mode: 'polling',
      timestamp: new Date().toISOString(),
      api: API_BASE_URL
    }));
  } else {
    res.writeHead(200);
    res.end('🤖 Telegram Bot is running in polling mode');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Health server on port ${PORT}`);
  console.log('🎉 Bot is ready! Send /start to your bot');
});

// Log messages
bot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    console.log(`💬 Message from ${msg.chat.id}: "${msg.text.substring(0, 50)}..."`);
  }
});
