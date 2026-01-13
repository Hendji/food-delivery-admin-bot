require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

console.log('🚀 Запуск Telegram бота...');

// Проверка переменных окружения
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE_URL = 'https://food-delivery-api-production-8385.up.railway.app';

if (!TELEGRAM_TOKEN) {
  console.error('❌ ОШИБКА: TELEGRAM_TOKEN не установлен!');
  process.exit(1);
}

if (!ADMIN_API_KEY) {
  console.error('❌ ОШИБКА: ADMIN_API_KEY не установлен!');
  process.exit(1);
}

console.log('✅ Конфигурация загружена');
console.log('🔗 API:', API_BASE_URL);

// Создание бота с настройками для продакшена
const bot = new TelegramBot(TELEGRAM_TOKEN, {
  polling: {
    interval: 1000,
    timeout: 10,
    limit: 100
  },
  request: {
    timeout: 10000
  }
});

// Обработчик ошибок
bot.on('polling_error', (error) => {
  console.error('🔴 Polling error:', error.message);
  
  // Автоматический перезапуск при некоторых ошибках
  if (error.code === 'EFATAL') {
    console.log('🔄 Перезапуск через 10 секунд...');
    setTimeout(() => {
      bot.stopPolling();
      setTimeout(() => bot.startPolling(), 1000);
    }, 10000);
  }
});

bot.on('error', (error) => {
  console.error('🔴 Bot error:', error.message);
});

// Функция для API запросов с ретраями
async function callAdminAPI(endpoint, method = 'GET', retries = 3) {
  for (let i = 0; i < retries; i++) {
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
      if (i === retries - 1) throw error;
      console.log(`🔄 Ретрай ${i + 1}/${retries} для ${endpoint}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Команды бота
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

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '📋 *Помощь по командам*\n\n' +
    '*/toggle [id]* - переключить доступность блюда\n' +
    '*/dish [id]* - показать информацию о блюде\n\n' +
    '*Примеры:*\n' +
    '/toggle 1\n' +
    '/dish 1',
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

bot.onText(/\/dish (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const dishId = match[1];
  
  try {
    await bot.sendChatAction(chatId, 'typing');
    const result = await callAdminAPI(`/bot/dish/${dishId}`);
    const dish = result.dish;
    
    const status = dish.is_available ? '✅ Доступно' : '❌ Недоступно';
    const message = 
      `🍽️ *${dish.name}*\n\n` +
      `💰 Цена: ${dish.price} ₽\n` +
      `📋 Статус: ${status}\n` +
      `🏪 Ресторан: ${dish.restaurant_name}\n` +
      `⏱️ Время готовки: ${dish.preparation_time} мин\n` +
      `🌶️ Острое: ${dish.is_spicy ? 'Да' : 'Нет'}\n` +
      `🥦 Вегетарианское: ${dish.is_vegetarian ? 'Да' : 'Нет'}\n\n` +
      `🔄 Изменить статус: /toggle ${dishId}`;
    
    // Отправляем фото если есть
    if (dish.image_url) {
      bot.sendPhoto(chatId, dish.image_url, {
        caption: message,
        parse_mode: 'Markdown'
      });
    } else {
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error('Dish error:', error.message);
    bot.sendMessage(chatId,
      '❌ *Ошибка*\n\n' +
      `Блюдо ${dishId} не найдено или ошибка сервера`,
      { parse_mode: 'Markdown' }
    );
  }
});

// Эндпоинт здоровья для Railway
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    bot: 'running',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`✅ Health endpoint на порту ${PORT}`);
});

console.log('🎉 Бот успешно запущен!');
console.log('📱 Напишите /start вашему боту в Telegram');
