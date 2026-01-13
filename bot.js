require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

console.log('🚀 Запуск Telegram бота на Railway...');

// ==================== КОНФИГУРАЦИЯ ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE_URL = 'https://food-delivery-api-production-8385.up.railway.app';
const PORT = process.env.PORT || 3000;

// Проверка обязательных переменных
if (!TELEGRAM_TOKEN) {
  console.error('❌ ОШИБКА: TELEGRAM_TOKEN не установлен!');
  console.error('   Установите в Railway Variables: TELEGRAM_TOKEN');
  process.exit(1);
}

if (!ADMIN_API_KEY) {
  console.error('❌ ОШИБКА: ADMIN_API_KEY не установлен!');
  console.error('   Установите в Railway Variables: ADMIN_API_KEY');
  process.exit(1);
}

console.log('✅ Конфигурация загружена');
console.log('🔗 API сервер:', API_BASE_URL);
console.log('🔑 API Key:', ADMIN_API_KEY.substring(0, 8) + '...');

// ==================== НАСТРОЙКА ВЕБХУКА ====================
const app = express();
app.use(express.json());

// Определяем URL для вебхука
const RAILWAY_PUBLIC_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN;
const RAILWAY_STATIC_URL = process.env.RAILWAY_STATIC_URL;

let webhookUrl;
if (RAILWAY_PUBLIC_DOMAIN) {
  webhookUrl = `https://${RAILWAY_PUBLIC_DOMAIN}/bot${TELEGRAM_TOKEN}`;
} else if (RAILWAY_STATIC_URL) {
  webhookUrl = `${RAILWAY_STATIC_URL}/bot${TELEGRAM_TOKEN}`;
} else {
  // Для локальной разработки
  webhookUrl = `https://your-domain.com/bot${TELEGRAM_TOKEN}`;
  console.warn('⚠️  Не найден Railway домен. Используйте локально или установите домен.');
}

console.log('🌐 Webhook URL:', webhookUrl);

// Создаем бота
const bot = new TelegramBot(TELEGRAM_TOKEN, {
  onlyFirstMatch: true,
  request: {
    timeout: 10000
  }
});

// ==================== API ФУНКЦИИ ====================
async function callAdminAPI(endpoint, method = 'GET') {
  try {
    console.log(`📡 API запрос: ${method} ${endpoint}`);
    
    const response = await axios({
      method,
      url: `${API_BASE_URL}${endpoint}`,
      headers: {
        'X-Admin-API-Key': ADMIN_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 8000
    });
    
    console.log(`✅ API ответ: ${response.status}`);
    return response.data;
    
  } catch (error) {
    console.error('❌ API ошибка:', {
      endpoint,
      status: error.response?.status,
      message: error.response?.data?.error || error.message
    });
    throw error;
  }
}

// ==================== КОМАНДЫ БОТА ====================

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  console.log(`👋 Старт от ${chatId}`);
  
  bot.sendMessage(chatId,
    '🤖 *Бот управления рестораном*\n\n' +
    '✅ Подключено к API: ' + API_BASE_URL + '\n\n' +
    '📋 *Доступные команды:*\n' +
    '• /toggle [id] - изменить доступность блюда\n' +
    '• /dish [id] - информация о блюде\n' +
    '• /restaurants - список ресторанов\n' +
    '• /help - помощь\n\n' +
    '📝 *Примеры:*\n' +
    '/toggle 1\n' +
    '/dish 1\n' +
    '/restaurants',
    { parse_mode: 'Markdown' }
  );
});

// /help
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '📋 *Помощь по командам*\n\n' +
    '*/toggle [id]*\n' +
    'Переключить доступность блюда\n\n' +
    '*/dish [id]*\n' +
    'Информация о блюде\n\n' +
    '*/restaurants*\n' +
    'Список всех ресторанов\n\n' +
    '*/menu [id]*\n' +
    'Меню ресторана\n\n' +
    '*Примеры:*\n' +
    '/toggle 1\n' +
    '/dish 2\n' +
    '/restaurants',
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
    
    const dish = result.dish;
    const status = dish.is_available ? '✅ Доступно' : '❌ Недоступно';
    
    bot.sendMessage(chatId,
      `🔄 *Статус изменен!*\n\n` +
      `🍽️ *${dish.name}*\n` +
      `🏪 ${dish.restaurant_name}\n` +
      `💰 ${dish.price} ₽\n\n` +
      `📊 *Новый статус:* ${status}\n\n` +
      `🔍 Посмотреть: /dish ${dishId}`,
      { parse_mode: 'Markdown' }
    );
    
  } catch (error) {
    const errorMsg = error.response?.data?.error || error.message;
    bot.sendMessage(chatId,
      `❌ *Ошибка при изменении блюда*\n\n` +
      `ID: ${dishId}\n` +
      `Ошибка: ${errorMsg}\n\n` +
      `Проверьте правильность ID`,
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
    
    const status = dish.is_available ? '✅ Доступно' : '❌ Недоступно';
    const spicy = dish.is_spicy ? '🌶️ Да' : '👌 Нет';
    const veg = dish.is_vegetarian ? '🥬 Да' : '🍖 Нет';
    
    const message = 
      `🍽️ *${dish.name}*\n\n` +
      `📝 ${dish.description}\n\n` +
      `💰 *Цена:* ${dish.price} ₽\n` +
      `📊 *Статус:* ${status}\n` +
      `🏪 *Ресторан:* ${dish.restaurant_name}\n` +
      `⏱️ *Готовка:* ${dish.preparation_time} мин\n` +
      `🌶️ *Острое:* ${spicy}\n` +
      `🥦 *Вегетарианское:* ${veg}\n\n` +
      `🧂 *Ингредиенты:*\n${dish.ingredients?.join(', ') || 'Нет данных'}\n\n` +
      `🔄 *Изменить статус:* /toggle ${dishId}`;
    
    // Отправляем с фото если есть
    if (dish.image_url && dish.image_url.startsWith('http')) {
      try {
        await bot.sendPhoto(chatId, dish.image_url, {
          caption: message,
          parse_mode: 'Markdown'
        });
        return;
      } catch (photoError) {
        console.log('Не удалось отправить фото:', photoError.message);
      }
    }
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    const errorMsg = error.response?.data?.error || error.message;
    bot.sendMessage(chatId,
      `❌ *Блюдо не найдено*\n\n` +
      `ID: ${dishId}\n` +
      `Ошибка: ${errorMsg}\n\n` +
      `Проверьте правильность ID`,
      { parse_mode: 'Markdown' }
    );
  }
});

// /restaurants
bot.onText(/\/restaurants/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    await bot.sendChatAction(chatId, 'typing');
    const restaurants = await callAdminAPI('/restaurants');
    
    if (!restaurants || restaurants.length === 0) {
      return bot.sendMessage(chatId, '😔 Рестораны не найдены');
    }
    
    let message = `🏪 *Список ресторанов*\n\n`;
    
    restaurants.forEach((rest, index) => {
      message += 
        `*${index + 1}. ${rest.name}*\n` +
        `⭐ ${rest.rating || 'Нет рейтинга'}\n` +
        `🚚 ${rest.delivery_time} (${rest.delivery_price})\n` +
        `📋 Категории: ${rest.categories?.join(', ') || 'Нет'}\n` +
        `🍽️ Меню: /menu_${rest.id}\n\n`;
    });
    
    message += `📝 *Всего ресторанов:* ${restaurants.length}`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    bot.sendMessage(chatId,
      `❌ *Ошибка загрузки ресторанов*\n\n` +
      `${error.message}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// /menu [id] или /menu_id
bot.onText(/\/menu(?:_(\d+)|\s+(\d+))/, async (msg, match) => {
  const chatId = msg.chat.id;
  const restaurantId = match[1] || match[2];
  
  if (!restaurantId) {
    return bot.sendMessage(chatId, 'Укажите ID ресторана: /menu [id]');
  }
  
  try {
    await bot.sendChatAction(chatId, 'typing');
    const menu = await callAdminAPI(`/restaurants/${restaurantId}/menu`);
    
    if (!menu || menu.length === 0) {
      return bot.sendMessage(chatId, `😔 Меню ресторана ${restaurantId} пустое`);
    }
    
    let message = `📋 *Меню ресторана*\n\n`;
    
    menu.forEach((dish, index) => {
      const status = dish.is_available ? '✅' : '❌';
      message += 
        `${status} *${dish.name}*\n` +
        `💰 ${dish.price} ₽ | ID: ${dish.id}\n` +
        `${dish.description?.substring(0, 60)}...\n` +
        `🔍 /dish_${dish.id}\n\n`;
    });
    
    message += `🍽️ *Всего блюд:* ${menu.length}`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    bot.sendMessage(chatId,
      `❌ *Ошибка загрузки меню*\n\n` +
      `Ресторан ID: ${restaurantId}\n` +
      `${error.message}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// Быстрые команды /dish_1, /toggle_1
bot.onText(/\/dish_(\d+)/, (msg, match) => {
  msg.text = `/dish ${match[1]}`;
  bot.processUpdate({ message: msg });
});

bot.onText(/\/toggle_(\d+)/, (msg, match) => {
  msg.text = `/toggle ${match[1]}`;
  bot.processUpdate({ message: msg });
});

bot.onText(/\/menu_(\d+)/, (msg, match) => {
  msg.text = `/menu ${match[1]}`;
  bot.processUpdate({ message: msg });
});

// ==================== ВЕБХУК ЭНДПОИНТ ====================
app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('Ошибка обработки вебхука:', error);
    res.sendStatus(500);
  }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'telegram-bot',
    timestamp: new Date().toISOString(),
    api: API_BASE_URL,
    bot: 'running'
  });
});

app.get('/', (req, res) => {
  res.json({
    message: '🤖 Telegram Bot for Food Delivery API',
    endpoints: {
      health: '/health',
      webhook: `/bot${TELEGRAM_TOKEN.substring(0, 10)}...`
    },
    status: 'operational'
  });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
app.listen(PORT, async () => {
  console.log(`✅ Express сервер запущен на порту ${PORT}`);
  
  try {
    // Устанавливаем вебхук
    await bot.setWebHook(webhookUrl);
    console.log('✅ Вебхук установлен:', webhookUrl);
    
    // Получаем информацию о боте
    const botInfo = await bot.getMe();
    console.log('🤖 Информация о боте:');
    console.log('   Имя:', botInfo.first_name);
    console.log('   Username:', botInfo.username);
    console.log('   ID:', botInfo.id);
    
    console.log('\n🎉 Бот успешно запущен и готов к работе!');
    console.log('📱 Найдите бота в Telegram: @' + botInfo.username);
    console.log('💬 Отправьте /start для начала работы');
    
  } catch (error) {
    console.error('❌ Ошибка при запуске бота:', error.message);
    console.error('Проверьте TELEGRAM_TOKEN и интернет соединение');
  }
});

// Обработка ошибок бота
bot.on('error', (error) => {
  console.error('🔴 Ошибка бота:', error.message);
});

// Логирование входящих сообщений
bot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    console.log(`💬 Сообщение от ${msg.chat.id}: "${msg.text.substring(0, 50)}..."`);
  }
});
