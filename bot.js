require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const http = require('http');

console.log('🚀 Secure Telegram Bot starting...');

// ==================== CONFIG ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE_URL = 'https://food-delivery-api-production-8385.up.railway.app';

// Whitelist of allowed admin users (Telegram chat IDs)
const ADMIN_USERS = process.env.ADMIN_USERS ? 
  process.env.ADMIN_USERS.split(',').map(id => parseInt(id.trim())) : 
  [];

// Check if user is admin
function isAdminUser(chatId) {
  return ADMIN_USERS.length === 0 || ADMIN_USERS.includes(chatId);
}

if (!TELEGRAM_TOKEN || !ADMIN_API_KEY) {
  console.error('❌ Missing environment variables!');
  process.exit(1);
}

console.log('✅ Config loaded');
console.log('🔗 API:', API_BASE_URL);
console.log('👑 Admin users:', ADMIN_USERS.length > 0 ? ADMIN_USERS : 'All users');

// ==================== BOT SETUP ====================
const bot = new TelegramBot(TELEGRAM_TOKEN, {
  polling: {
    interval: 1000,
    params: {
      timeout: 30,
      limit: 100
    }
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

// Главное меню (для всех пользователей)
const mainMenu = {
  reply_markup: {
    keyboard: [
      ['🍽️ Блюда', '🏪 Рестораны'],
      ['📊 Статистика', '🆘 Помощь']
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

// Админское меню (только для админов)
const adminMenu = {
  reply_markup: {
    keyboard: [
      ['🍽️ Блюда', '🏪 Рестораны'],
      ['📊 Статистика', '⚙️ Админ'],
      ['🆘 Помощь']
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

// Меню блюд (для всех)
const dishesMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📋 Список блюд', callback_data: 'dishes_list' },
        { text: '🔍 Поиск блюда', callback_data: 'dish_search' }
      ],
      [
        { text: '🏠 Главное меню', callback_data: 'main_menu' }
      ]
    ]
  }
};

// Админское меню блюд (только для админов)
const adminDishesMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📋 Список блюд', callback_data: 'dishes_list' },
        { text: '🔍 Поиск блюда', callback_data: 'dish_search' }
      ],
      [
        { text: '🔄 Управление доступностью', callback_data: 'dish_manage' }
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

// Меню управления блюдом (только для админов)
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

// Меню только для просмотра (для обычных пользователей)
function createDishViewMenu(dishId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
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

// Админ-панель
const adminPanel = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📊 Системная статистика', callback_data: 'system_stats' }
      ],
      [
        { text: '👥 Управление доступом', callback_data: 'access_manage' }
      ],
      [
        { text: '🏠 Главное меню', callback_data: 'main_menu' }
      ]
    ]
  }
};

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
  const isAdmin = isAdminUser(chatId);
  
  console.log(`👋 Start from ${chatId} (Admin: ${isAdmin})`);
  
  const menu = isAdmin ? adminMenu : mainMenu;
  
  bot.sendMessage(chatId,
    '🤖 *Управление доставкой еды*\n\n' +
    (isAdmin ? '👑 *Режим администратора*\n\n' : '') +
    'Выберите действие из меню ниже:',
    { 
      parse_mode: 'Markdown',
      reply_markup: menu.reply_markup 
    }
  );
});

// /menu - Показать меню
bot.onText(/\/menu/, (msg) => {
  const chatId = msg.chat.id;
  const isAdmin = isAdminUser(chatId);
  const menu = isAdmin ? adminMenu : mainMenu;
  
  bot.sendMessage(chatId, 'Меню:', menu);
});

// /admin - Админ-панель (только для админов)
bot.onText(/\/admin/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdminUser(chatId)) {
    return bot.sendMessage(chatId, '⛔ У вас нет доступа к этой команде.', mainMenu);
  }
  
  showAdminPanel(chatId);
});

// ==================== TEXT MESSAGE HANDLERS ====================

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const isAdmin = isAdminUser(chatId);
  
  if (!text || text.startsWith('/')) return;
  
  console.log(`💬 Menu from ${chatId}: ${text} (Admin: ${isAdmin})`);
  
  switch(text) {
    case '🍽️ Блюда':
      showDishesMenu(chatId, isAdmin);
      break;
      
    case '🏪 Рестораны':
      showRestaurantsMenu(chatId);
      break;
      
    case '📊 Статистика':
      showStatistics(chatId, isAdmin);
      break;
      
    case '⚙️ Админ':
      if (isAdmin) {
        showAdminPanel(chatId);
      } else {
        bot.sendMessage(chatId, '⛔ У вас нет доступа.', mainMenu);
      }
      break;
      
    case '🆘 Помощь':
      showHelp(chatId, isAdmin);
      break;
      
    default:
      // Если введен ID блюда
      if (/^\d+$/.test(text)) {
        showDishInfo(chatId, parseInt(text), null, isAdmin);
      } else {
        bot.sendMessage(chatId, 'Используйте меню или команды', mainMenu);
      }
  }
});

// ==================== CALLBACK QUERY HANDLERS ====================

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  const isAdmin = isAdminUser(chatId);
  
  console.log(`🔘 Callback from ${chatId}: ${data} (Admin: ${isAdmin})`);
  
  await bot.answerCallbackQuery(callbackQuery.id);
  
  // Обработка callback данных
  if (data === 'main_menu') {
    showMainMenu(chatId, messageId, isAdmin);
    
  } else if (data === 'dishes_list') {
    showAllDishes(chatId, messageId, isAdmin);
    
  } else if (data === 'dish_search') {
    bot.editMessageText('Введите ID блюда или название:', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: backButton.reply_markup
    });
    
  } else if (data === 'dish_manage') {
    if (isAdmin) {
      showDishManagement(chatId, messageId);
    } else {
      bot.editMessageText('⛔ У вас нет доступа к этой функции.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: backButton.reply_markup
      });
    }
    
  } else if (data === 'restaurants_list') {
    showAllRestaurants(chatId, messageId);
    
  } else if (data === 'view_menu') {
    showRestaurantMenuPrompt(chatId, messageId);
    
  } else if (data.startsWith('dish_info_')) {
    const dishId = data.replace('dish_info_', '');
    showDishInfo(chatId, dishId, messageId, isAdmin);
    
  } else if (data.startsWith('dish_enable_') || data.startsWith('dish_disable_')) {
    if (isAdmin) {
      const dishId = data.replace('dish_enable_', '').replace('dish_disable_', '');
      toggleDishAvailability(chatId, dishId, messageId);
    } else {
      bot.editMessageText('⛔ Только администраторы могут изменять доступность блюд.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: backButton.reply_markup
      });
    }
    
  } else if (data.startsWith('restaurant_menu_')) {
    const restaurantId = data.replace('restaurant_menu_', '');
    showRestaurantMenu(chatId, restaurantId, messageId, isAdmin);
    
  } else if (data.startsWith('select_dish_')) {
    const dishId = data.replace('select_dish_', '');
    showDishInfo(chatId, dishId, messageId, isAdmin);
    
  } else if (data === 'system_stats') {
    if (isAdmin) {
      showSystemStats(chatId, messageId);
    }
    
  } else if (data === 'access_manage') {
    if (isAdmin) {
      showAccessInfo(chatId, messageId);
    }
  }
});

// ==================== MENU FUNCTIONS ====================

// Главное меню
function showMainMenu(chatId, messageId = null, isAdmin = false) {
  const menu = isAdmin ? adminMenu : mainMenu;
  const message = '🤖 *Управление доставкой еды*\n\n' + 
    (isAdmin ? '👑 *Режим администратора*\n\n' : '') +
    'Выберите действие:';
  
  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: menu.reply_markup
    });
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: menu.reply_markup
    });
  }
}

// Меню блюд
function showDishesMenu(chatId, isAdmin = false) {
  const menu = isAdmin ? adminDishesMenu : dishesMenu;
  
  bot.sendMessage(chatId, 
    '🍽️ *Управление блюдами*\n\n' +
    (isAdmin ? '👑 Доступны функции управления\n\n' : '') +
    'Выберите действие:',
    { 
      parse_mode: 'Markdown',
      reply_markup: menu.reply_markup 
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

// Админ-панель
function showAdminPanel(chatId) {
  bot.sendMessage(chatId,
    '⚙️ *Административная панель*\n\n' +
    'Доступные функции:',
    {
      parse_mode: 'Markdown',
      reply_markup: adminPanel.reply_markup
    }
  );
}

// Показать все блюда
async function showAllDishes(chatId, messageId = null, isAdmin = false) {
  try {
    await bot.sendChatAction(chatId, 'typing');
    
    const restaurants = await callAPI('/restaurants');
    
    if (!restaurants || restaurants.length === 0) {
      const message = '😔 Рестораны не найдены';
      return updateOrSend(chatId, messageId, message, backButton);
    }
    
    let message = '📋 *Все блюда*\n\n';
    let dishesKeyboard = [];
    
    for (const restaurant of restaurants) {
      try {
        const menu = await callAPI(`/restaurants/${restaurant.id}/menu`);
        
        if (menu && menu.length > 0) {
          message += `*${restaurant.name}*\n`;
          
          menu.forEach(dish => {
            const status = dish.is_available ? '✅' : '❌';
            message += `${status} ${dish.name} - ${dish.price} ₽ (ID: ${dish.id})\n`;
            
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
    
    dishesKeyboard.push([{ text: '🔙 Назад', callback_data: 'main_menu' }]);
    
    const keyboard = { reply_markup: { inline_keyboard: dishesKeyboard } };
    
    updateOrSend(chatId, messageId, message, keyboard);
    
  } catch (error) {
    const errorMessage = '❌ Ошибка при загрузке блюд';
    updateOrSend(chatId, messageId, errorMessage, backButton);
  }
}

// Информация о блюде
async function showDishInfo(chatId, dishId, messageId = null, isAdmin = false) {
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
    
    // Разные меню для админов и обычных пользователей
    const controlMenu = isAdmin ? 
      createDishControlMenu(dish.id, dish.is_available) : 
      createDishViewMenu(dish.id);
    
    updateOrSend(chatId, messageId, message, controlMenu);
    
  } catch (error) {
    const errorMessage = `❌ Блюдо #${dishId} не найдено`;
    updateOrSend(chatId, messageId, errorMessage, backButton);
  }
}

// Переключение доступности (только для админов)
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

// Управление блюдами (только для админов)
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
async function showStatistics(chatId, isAdmin = false) {
  try {
    await bot.sendChatAction(chatId, 'typing');
    
    const restaurants = await callAPI('/restaurants');
    let totalDishes = 0;
    
    for (const restaurant of restaurants) {
      try {
        const menu = await callAPI(`/restaurants/${restaurant.id}/menu`);
        totalDishes += menu?.length || 0;
      } catch (error) {
        // Игнорируем ошибки
      }
    }
    
    const message = 
      '📊 *Статистика системы*\n\n' +
      `🏪 Ресторанов: ${restaurants.length}\n` +
      `🍽️ Всего блюд: ${totalDishes}\n` +
      `🔄 Обновлено: ${new Date().toLocaleTimeString()}`;
    
    const menu = isAdmin ? adminMenu : mainMenu;
    
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: menu.reply_markup
    });
    
  } catch (error) {
    const menu = isAdmin ? adminMenu : mainMenu;
    bot.sendMessage(chatId, '❌ Ошибка при загрузке статистики', menu);
  }
}

// Системная статистика (только для админов)
async function showSystemStats(chatId, messageId = null) {
  try {
    const health = await callAPI('/health');
    
    const message = 
      '📈 *Системная статистика*\n\n' +
      `🚀 API статус: ${health.status}\n` +
      `🗄️ База данных: ${health.database}\n` +
      `🌐 Окружение: ${health.environment}\n` +
      `⏰ Время сервера: ${health.timestamp}\n\n` +
      `🔗 URL: ${API_BASE_URL}\n` +
      `🔑 API ключ: ${ADMIN_API_KEY.substring(0, 8)}...`;
    
    updateOrSend(chatId, messageId, message, adminPanel);
    
  } catch (error) {
    updateOrSend(chatId, messageId, '❌ Ошибка загрузки статистики', adminPanel);
  }
}

// Информация о доступе
function showAccessInfo(chatId, messageId = null) {
  const message = 
    '👥 *Управление доступом*\n\n' +
    `Текущие администраторы: ${ADMIN_USERS.join(', ') || 'Все пользователи'}\n\n` +
    'Для изменения списка администраторов:\n' +
    '1. Откройте Railway проект\n' +
    '2. Добавьте переменную ADMIN_USERS\n' +
    '3. Укажите ID через запятую\n\n' +
    'Пример: ADMIN_USERS=123456,789012';
  
  updateOrSend(chatId, messageId, message, adminPanel);
}

// Помощь
function showHelp(chatId, isAdmin = false) {
  const menu = isAdmin ? adminMenu : mainMenu;
  
  let message = 
    '🆘 *Помощь*\n\n' +
    '*Основные возможности:*\n' +
    '• Просмотр информации о блюдах\n' +
    '• Список ресторанов и их меню\n' +
    '• Общая статистика\n\n';
  
  if (isAdmin) {
    message +=
      '*Административные функции:*\n' +
      '• Управление доступностью блюд\n' +
      '• Системная статистика\n\n';
  }
  
  message +=
    '*Как использовать:*\n' +
    '1. Используйте кнопки меню\n' +
    '2. Нажимайте на inline-кнопки\n' +
    '3. Или вводите команды:\n' +
    '   /start - Главное меню\n' +
    '   /menu - Показать меню\n' +
    (isAdmin ? '   /admin - Админ-панель\n' : '') +
    '\n*Быстрый доступ:*\n' +
    'Просто введите ID блюда (например: 1)';
  
  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: menu.reply_markup
  });
}

// Вспомогательные функции
function showRestaurantMenuPrompt(chatId, messageId) {
  const message = 'Введите ID ресторана для просмотра меню:';
  updateOrSend(chatId, messageId, message, backButton);
}

function updateOrSend(chatId, messageId, text, options) {
  if (messageId) {
    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...options
    }).catch(err => {
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
      service: 'secure-telegram-bot',
      admin_users: ADMIN_USERS,
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(200);
    res.end('🤖 Secure Telegram Bot is running');
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`✅ Health server on port ${PORT}`);
  console.log('🎉 Secure bot is ready!');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down...');
  bot.stopPolling();
  server.close();
  process.exit(0);
});
