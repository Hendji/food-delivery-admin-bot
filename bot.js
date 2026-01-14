require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const http = require('http');

console.log('🚀 Telegram Bot with Menu starting...');

// ==================== CONFIG ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE_URL = 'https://food-delivery-api-production-8385.up.railway.app';

if (!TELEGRAM_TOKEN || !ADMIN_API_KEY) {
  console.error('❌ Missing environment variables!');
  process.exit(1);
}

console.log('✅ Config loaded');
console.log('🔗 API:', API_BASE_URL);

// ==================== BOT SETUP ====================
const bot = new TelegramBot(TELEGRAM_TOKEN, {
  polling: {
    interval: 1000,
    timeout: 30
  },
  request: {
    timeout: 30000
  }
});

// ==================== API HELPER ====================
async function callAPI(endpoint, method = 'GET') {
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

// ==================== KEYBOARDS & MENUS ====================

// Главное меню
const mainMenu = {
  reply_markup: {
    keyboard: [
      ['🍽️ Блюда', '🏪 Рестораны'],
      ['📊 Статистика', '⚙️ Настройки'],
      ['🆘 Помощь']
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

// Меню управления блюдами
const dishesMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📋 Список блюд', callback_data: 'dishes_list' },
        { text: '🔍 Поиск блюда', callback_data: 'dish_search' }
      ],
      [
        { text: '➕ Добавить блюдо', callback_data: 'dish_add' },
        { text: '🔄 Управление', callback_data: 'dish_manage' }
      ],
      [
        { text: '🏠 Главное меню', callback_data: 'main_menu' }
      ]
    ]
  }
};

// Меню ресторанов
const restaurantsMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📋 Список ресторанов', callback_data: 'restaurants_list' }
      ],
      [
        { text: '🍽️ Посмотреть меню', callback_data: 'view_menu' }
      ],
      [
        { text: '🏠 Главное меню', callback_data: 'main_menu' }
      ]
    ]
  }
};

// Меню управления доступностью блюда
function createDishControlMenu(dishId, isAvailable) {
  const statusText = isAvailable ? '❌ Сделать недоступным' : '✅ Сделать доступным';
  const statusData = isAvailable ? `dish_disable_${dishId}` : `dish_enable_${dishId}`;
  
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: statusText, callback_data: statusData },
          { text: '📝 Информация', callback_data: `dish_info_${dishId}` }
        ],
        [
          { text: '🍽️ Другие блюда', callback_data: 'dishes_list' },
          { text: '🏠 Главное меню', callback_data: 'main_menu' }
        ]
      ]
    }
  };
}

// Клавиатура "Назад"
const backButton = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🔙 Назад', callback_data: 'main_menu' }]
    ]
  }
};

// ==================== COMMAND HANDLERS ====================

// /start - Главное меню
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  console.log(`👋 Start from ${chatId}`);
  
  bot.sendMessage(chatId,
    '🤖 *Управление доставкой еды*\n\n' +
    'Выберите действие из меню ниже:',
    { 
      parse_mode: 'Markdown',
      reply_markup: mainMenu.reply_markup 
    }
  );
});

// /menu - Показать главное меню
bot.onText(/\/menu/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Главное меню:', mainMenu);
});

// ==================== TEXT MESSAGE HANDLERS ====================

// Обработка текстовых сообщений (меню)
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (!text || text.startsWith('/')) return;
  
  console.log(`💬 Menu selection from ${chatId}: ${text}`);
  
  switch(text) {
    case '🍽️ Блюда':
      showDishesMenu(chatId);
      break;
      
    case '🏪 Рестораны':
      showRestaurantsMenu(chatId);
      break;
      
    case '📊 Статистика':
      showStatistics(chatId);
      break;
      
    case '⚙️ Настройки':
      showSettings(chatId);
      break;
      
    case '🆘 Помощь':
      showHelp(chatId);
      break;
      
    default:
      // Если введен ID блюда (просто число)
      if (/^\d+$/.test(text)) {
        showDishInfo(chatId, parseInt(text));
      } else {
        bot.sendMessage(chatId, 'Используйте меню или команды');
      }
  }
});

// ==================== CALLBACK QUERY HANDLERS ====================

// Обработка нажатий на inline кнопки
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  
  console.log(`🔘 Callback from ${chatId}: ${data}`);
  
  // Ответим на callback (убираем "часики")
  await bot.answerCallbackQuery(callbackQuery.id);
  
  // Обработка различных callback данных
  if (data === 'main_menu') {
    showMainMenu(chatId, messageId);
    
  } else if (data === 'dishes_list') {
    showAllDishes(chatId, messageId);
    
  } else if (data === 'dish_search') {
    bot.editMessageText('Введите ID блюда или название:', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: backButton.reply_markup
    });
    
  } else if (data === 'dish_manage') {
    showDishManagement(chatId, messageId);
    
  } else if (data === 'restaurants_list') {
    showAllRestaurants(chatId, messageId);
    
  } else if (data === 'view_menu') {
    showRestaurantMenuPrompt(chatId, messageId);
    
  } else if (data.startsWith('dish_info_')) {
    const dishId = data.replace('dish_info_', '');
    showDishInfo(chatId, dishId, messageId);
    
  } else if (data.startsWith('dish_enable_') || data.startsWith('dish_disable_')) {
    const dishId = data.replace('dish_enable_', '').replace('dish_disable_', '');
    toggleDishAvailability(chatId, dishId, messageId);
    
  } else if (data.startsWith('restaurant_menu_')) {
    const restaurantId = data.replace('restaurant_menu_', '');
    showRestaurantMenu(chatId, restaurantId, messageId);
    
  } else if (data.startsWith('select_dish_')) {
    const dishId = data.replace('select_dish_', '');
    showDishControl(chatId, dishId, messageId);
  }
});

// ==================== MENU FUNCTIONS ====================

// Показать главное меню
function showMainMenu(chatId, messageId = null) {
  const message = '🤖 *Управление доставкой еды*\n\nВыберите действие:';
  
  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: mainMenu.reply_markup
    });
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: mainMenu.reply_markup
    });
  }
}

// Меню блюд
function showDishesMenu(chatId) {
  bot.sendMessage(chatId, 
    '🍽️ *Управление блюдами*\n\n' +
    'Выберите действие:',
    { 
      parse_mode: 'Markdown',
      reply_markup: dishesMenu.reply_markup 
    }
  );
}

// Меню ресторанов
function showRestaurantsMenu(chatId) {
  bot.sendMessage(chatId,
    '🏪 *Рестораны*\n\n' +
    'Выберите действие:',
    {
      parse_mode: 'Markdown',
      reply_markup: restaurantsMenu.reply_markup
    }
  );
}

// Показать все блюда
async function showAllDishes(chatId, messageId = null) {
  try {
    await bot.sendChatAction(chatId, 'typing');
    
    // Получаем все рестораны
    const restaurants = await callAPI('/restaurants');
    
    if (!restaurants || restaurants.length === 0) {
      const message = '😔 Рестораны не найдены';
      return updateOrSend(chatId, messageId, message, backButton);
    }
    
    let message = '📋 *Все блюда*\n\n';
    let dishesKeyboard = [];
    
    // Для каждого ресторана получаем меню
    for (const restaurant of restaurants) {
      try {
        const menu = await callAPI(`/restaurants/${restaurant.id}/menu`);
        
        if (menu && menu.length > 0) {
          message += `*${restaurant.name}*\n`;
          
          menu.forEach(dish => {
            const status = dish.is_available ? '✅' : '❌';
            message += `${status} ${dish.name} - ${dish.price} ₽ (ID: ${dish.id})\n`;
            
            // Добавляем кнопку для каждого блюда
            dishesKeyboard.push([
              { 
                text: `${status} ${dish.name} (${dish.id})`, 
                callback_data: `select_dish_${dish.id}` 
              }
            ]);
          });
          
          message += '\n';
        }
      } catch (error) {
        console.error(`Error loading menu for restaurant ${restaurant.id}:`, error.message);
      }
    }
    
    // Добавляем кнопку "Назад"
    dishesKeyboard.push([{ text: '🔙 Назад', callback_data: 'main_menu' }]);
    
    const keyboard = { reply_markup: { inline_keyboard: dishesKeyboard } };
    
    updateOrSend(chatId, messageId, message, keyboard);
    
  } catch (error) {
    const errorMessage = '❌ Ошибка при загрузке блюд';
    updateOrSend(chatId, messageId, errorMessage, backButton);
  }
}

// Показать все рестораны
async function showAllRestaurants(chatId, messageId = null) {
  try {
    await bot.sendChatAction(chatId, 'typing');
    
    const restaurants = await callAPI('/restaurants');
    
    if (!restaurants || restaurants.length === 0) {
      const message = '😔 Рестораны не найдены';
      return updateOrSend(chatId, messageId, message, backButton);
    }
    
    let message = '🏪 *Список ресторанов*\n\n';
    let restaurantsKeyboard = [];
    
    restaurants.forEach(restaurant => {
      message += 
        `*${restaurant.name}*\n` +
        `⭐ ${restaurant.rating || 'Нет рейтинга'}\n` +
        `🚚 ${restaurant.delivery_time} (${restaurant.delivery_price})\n` +
        `📋 ID: ${restaurant.id}\n\n`;
      
      restaurantsKeyboard.push([
        { 
          text: `🍽️ ${restaurant.name}`, 
          callback_data: `restaurant_menu_${restaurant.id}` 
        }
      ]);
    });
    
    restaurantsKeyboard.push([{ text: '🔙 Назад', callback_data: 'main_menu' }]);
    
    const keyboard = { reply_markup: { inline_keyboard: restaurantsKeyboard } };
    
    updateOrSend(chatId, messageId, message, keyboard);
    
  } catch (error) {
    const errorMessage = '❌ Ошибка при загрузке ресторанов';
    updateOrSend(chatId, messageId, errorMessage, backButton);
  }
}

// Информация о блюде
async function showDishInfo(chatId, dishId, messageId = null) {
  try {
    await bot.sendChatAction(chatId, 'typing');
    
    const result = await callAPI(`/bot/dish/${dishId}`);
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
      `🆔 ID: ${dish.id}`;
    
    const controlMenu = createDishControlMenu(dish.id, dish.is_available);
    
    updateOrSend(chatId, messageId, message, controlMenu);
    
  } catch (error) {
    const errorMessage = `❌ Блюдо #${dishId} не найдено`;
    updateOrSend(chatId, messageId, errorMessage, backButton);
  }
}

// Переключение доступности блюда
async function toggleDishAvailability(chatId, dishId, messageId = null) {
  try {
    await bot.sendChatAction(chatId, 'typing');
    
    const result = await callAPI(`/bot/dish/${dishId}/toggle`, 'POST');
    
    const message = `✅ ${result.message}`;
    const controlMenu = createDishControlMenu(dishId, result.dish.is_available);
    
    updateOrSend(chatId, messageId, message, controlMenu);
    
  } catch (error) {
    const errorMessage = `❌ Ошибка при изменении блюда #${dishId}`;
    updateOrSend(chatId, messageId, errorMessage, backButton);
  }
}

// Меню ресторана
async function showRestaurantMenu(chatId, restaurantId, messageId = null) {
  try {
    await bot.sendChatAction(chatId, 'typing');
    
    const menu = await callAPI(`/restaurants/${restaurantId}/menu`);
    
    if (!menu || menu.length === 0) {
      const message = '😔 Меню ресторана пустое';
      return updateOrSend(chatId, messageId, message, backButton);
    }
    
    let message = `📋 *Меню ресторана*\n\n`;
    let menuKeyboard = [];
    
    menu.forEach(dish => {
      const status = dish.is_available ? '✅' : '❌';
      message += 
        `${status} *${dish.name}*\n` +
        `💰 ${dish.price} ₽ | ID: ${dish.id}\n` +
        `${dish.description?.substring(0, 60)}...\n\n`;
      
      menuKeyboard.push([
        { 
          text: `${status} ${dish.name}`, 
          callback_data: `select_dish_${dish.id}` 
        }
      ]);
    });
    
    menuKeyboard.push([{ text: '🔙 Назад к ресторанам', callback_data: 'restaurants_list' }]);
    
    const keyboard = { reply_markup: { inline_keyboard: menuKeyboard } };
    
    updateOrSend(chatId, messageId, message, keyboard);
    
  } catch (error) {
    const errorMessage = '❌ Ошибка при загрузке меню';
    updateOrSend(chatId, messageId, errorMessage, backButton);
  }
}

// Управление блюдами
function showDishManagement(chatId, messageId = null) {
  const message = 
    '🔄 *Управление доступностью*\n\n' +
    'Для управления блюдом:\n' +
    '1. Выберите блюдо из списка\n' +
    '2. Нажмите кнопку для изменения статуса\n\n' +
    'Или введите ID блюда:';
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 Список блюд', callback_data: 'dishes_list' }],
        [{ text: '🔍 Поиск по ID', callback_data: 'dish_search' }],
        [{ text: '🔙 Назад', callback_data: 'main_menu' }]
      ]
    }
  };
  
  updateOrSend(chatId, messageId, message, keyboard);
}

// Статистика
async function showStatistics(chatId) {
  try {
    await bot.sendChatAction(chatId, 'typing');
    
    const restaurants = await callAPI('/restaurants');
    let totalDishes = 0;
    
    // Подсчитываем общее количество блюд
    for (const restaurant of restaurants) {
      try {
        const menu = await callAPI(`/restaurants/${restaurant.id}/menu`);
        totalDishes += menu?.length || 0;
      } catch (error) {
        // Игнорируем ошибки загрузки меню
      }
    }
    
    const availableDishes = totalDishes; // Здесь можно добавить логику подсчета доступных
    
    const message = 
      '📊 *Статистика системы*\n\n' +
      `🏪 Ресторанов: ${restaurants.length}\n` +
      `🍽️ Всего блюд: ${totalDishes}\n` +
      `✅ Доступных: ${availableDishes}\n` +
      `❌ Недоступных: ${totalDishes - availableDishes}\n\n` +
      `🔄 Последнее обновление: ${new Date().toLocaleTimeString()}`;
    
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: mainMenu.reply_markup
    });
    
  } catch (error) {
    bot.sendMessage(chatId, '❌ Ошибка при загрузке статистики', mainMenu);
  }
}

// Настройки
function showSettings(chatId) {
  const message = 
    '⚙️ *Настройки*\n\n' +
    'Текущие настройки:\n' +
    `🔗 API: ${API_BASE_URL}\n` +
    `🔑 Ключ: ${ADMIN_API_KEY.substring(0, 8)}...\n\n` +
    'Для изменения настроек обратитесь к администратору';
  
  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: mainMenu.reply_markup
  });
}

// Помощь
function showHelp(chatId) {
  const message = 
    '🆘 *Помощь*\n\n' +
    '*Основные возможности:*\n' +
    '• Управление доступностью блюд\n' +
    '• Просмотр информации о блюдах\n' +
    '• Список ресторанов и их меню\n\n' +
    '*Как использовать:*\n' +
    '1. Используйте кнопки меню\n' +
    '2. Нажимайте на inline-кнопки\n' +
    '3. Или вводите команды:\n' +
    '   /start - Главное меню\n' +
    '   /menu - Показать меню\n\n' +
    '*Быстрый доступ:*\n' +
    'Просто введите ID блюда (например: 1)';
  
  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: mainMenu.reply_markup
  });
}

// Вспомогательные функции
function showRestaurantMenuPrompt(chatId, messageId) {
  const message = 'Введите ID ресторана для просмотра меню:';
  updateOrSend(chatId, messageId, message, backButton);
}

function showDishControl(chatId, dishId, messageId) {
  showDishInfo(chatId, dishId, messageId);
}

function updateOrSend(chatId, messageId, text, options) {
  if (messageId) {
    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...options
    }).catch(err => {
      // Если не удалось отредактировать (старое сообщение), отправляем новое
      return bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...options });
    });
  } else {
    return bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...options });
  }
}

// ==================== ERROR HANDLING ====================
bot.on('polling_error', (error) => {
  console.error('🔴 Polling error:', error.message);
});

bot.on('error', (error) => {
  console.error('🔴 Bot error:', error.message);
});

// ==================== HEALTH SERVER ====================
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'telegram-bot-menu',
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(200);
    res.end('🤖 Telegram Bot with Menu is running');
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`✅ Health server on port ${PORT}`);
  console.log('🎉 Bot with menu is ready!');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down...');
  bot.stopPolling();
  server.close();
  process.exit(0);
});
