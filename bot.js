require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

console.log('🚀 Запуск Telegram бота с вебхуками...');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE_URL = 'https://food-delivery-api-production-8385.up.railway.app';
const PORT = process.env.PORT || 3000;
const RAILWAY_STATIC_URL = process.env.RAILWAY_STATIC_URL;
const PUBLIC_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN;

if (!TELEGRAM_TOKEN) {
  console.error('❌ TELEGRAM_TOKEN не установлен!');
  process.exit(1);
}

// Определяем URL для вебхука
let webhookUrl;
if (PUBLIC_DOMAIN) {
  webhookUrl = `https://${PUBLIC_DOMAIN}/bot${TELEGRAM_TOKEN}`;
} else if (RAILWAY_STATIC_URL) {
  webhookUrl = `${RAILWAY_STATIC_URL}/bot${TELEGRAM_TOKEN}`;
} else {
  console.error('❌ Не удалось определить URL для вебхука');
  console.error('   Установите RAILWAY_PUBLIC_DOMAIN или RAILWAY_STATIC_URL');
  process.exit(1);
}

console.log('🌐 Webhook URL:', webhookUrl);

// Создаем бота в режиме вебхука
const bot = new TelegramBot(TELEGRAM_TOKEN, { 
  onlyFirstMatch: true,
  request: {
    timeout: 10000
  }
});

// Устанавливаем вебхук
bot.setWebHook(webhookUrl)
  .then(() => {
    console.log('✅ Вебхук установлен!');
  })
  .catch(error => {
    console.error('❌ Ошибка установки вебхука:', error.message);
  });

// Express сервер для обработки вебхуков
const express = require('express');
const app = express();
app.use(express.json());

// Эндпоинт для вебхука
app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Health check для Railway
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'telegram-bot',
    timestamp: new Date().toISOString()
  });
});

// Команды бота (остаются те же)
async function callAdminAPI(endpoint, method = 'GET') {
  try {
    const response = await axios({
      method,
      url: `${API_BASE_URL}${endpoint}`,
      headers: {
        'X-Admin-API-Key': ADMIN_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    return response.data;
  } catch (error) {
    console.error('API Error:', error.response?.data || error.message);
    throw error;
  }
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  console.log(`👋 Новый пользователь: ${chatId}`);
  
  bot.sendMessage(chatId,
    '🤖 *Бот управления рестораном*\n\n' +
    'Доступные команды:\n' +
    '• /toggle [id] - изменить доступность блюда\n' +
    '• /dish [id] - информация о блюде\n' +
    '• /help - помощь\n\n' +
    'Пример: /toggle 1',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/toggle (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const dishId = match[1];
  
  try {
    await bot.sendChatAction(chatId, 'typing');
    const result = await callAdminAPI(`/bot/dish/${dishId}/toggle`, 'POST');
    
    const status = result.dish.is_available ? '✅ Доступно' : '❌ Недоступно';
    bot.sendMessage(chatId,
      `🔄 *Статус изменен*\n\n` +
      `Блюдо: ${result.dish.name}\n` +
      `Новый статус: ${status}\n\n` +
      `Посмотреть: /dish ${dishId}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Toggle error:', error.message);
    bot.sendMessage(chatId,
      '❌ *Ошибка*\n\n' +
      `Детали: ${error.response?.data?.error || error.message}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// Запускаем сервер
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log('🎉 Бот готов к работе!');
  console.log('📱 Напишите /start вашему боту в Telegram');
});
