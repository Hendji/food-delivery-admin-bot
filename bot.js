require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const http = require('http');

console.log('🚀 Admin Bot Safe Starting...');

// ==================== CONFIG ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE_URL = 'https://food-delivery-api-production-8385.up.railway.app';

const ADMIN_USERS = process.env.ADMIN_USERS ? 
  process.env.ADMIN_USERS.split(',').map(id => parseInt(id.trim())) : 
  [];

function isAdminUser(chatId) {
  return ADMIN_USERS.length === 0 || ADMIN_USERS.includes(chatId);
}

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
    params: { timeout: 30, limit: 100 }
  }
});

// ==================== SAFE TEXT FUNCTION ====================
// Функция для безопасной обработки текста (без Markdown)
function safeText(text) {
  // Экранируем специальные символы Markdown
  return text
    .replace(/\*/g, '•')
    .replace(/_/g, '')
    .replace(/`/g, "'")
    .replace(/\[/g, '(')
    .replace(/\]/g, ')');
}

// Альтернатива: отключаем Markdown полностью
function sendSafeMessage(chatId, text, options = {}) {
  const safeOptions = { ...options };
  delete safeOptions.parse_mode; // Убираем Markdown
  return bot.sendMessage(chatId, safeText(text), safeOptions);
}

function editSafeMessage(chatId, messageId, text, options = {}) {
  const safeOptions = {
    chat_id: chatId,
    message_id: messageId,
    ...options
  };
  delete safeOptions.parse_mode;
  return bot.editMessageText(safeText(text), safeOptions);
}

// ==================== KEYBOARDS ====================

// Главное меню
const adminMainMenu = {
  reply_markup: {
    keyboard: [
      ['🍽️ Блюда', '📦 Заказы'],
      ['🏪 Рестораны', '📊 Статистика'],
      ['⚙️ Админ', '🆘 Помощь']
    ],
    resize_keyboard: true
  }
};

// Меню блюд
const dishesMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📋 Все блюда', callback_data: 'all_dishes' },
        { text: '➕ Создать', callback_data: 'create_dish' }
      ],
      [
        { text: '🔍 Найти', callback_data: 'find_dish' }
      ],
      [
        { text: '🏠 Главное меню', callback_data: 'main_menu' }
      ]
    ]
  }
};

// Меню заказов
const ordersMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🆕 Новые', callback_data: 'new_orders' },
        { text: '✅ Подтвержденные', callback_data: 'confirmed_orders' }
      ],
      [
        { text: '👨‍🍳 Готовятся', callback_data: 'preparing_orders' },
        { text: '🚚 Доставляются', callback_data: 'delivering_orders' }
      ],
      [
        { text: '🏠 Главное меню', callback_data: 'main_menu' }
      ]
    ]
  }
};

// Меню действий с блюдом
function getDishActions(dishId, isAvailable) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { 
            text: isAvailable ? '❌ Выключить' : '✅ Включить', 
            callback_data: `toggle_dish_${dishId}`
          }
        ],
        [
          { text: '✏️ Изменить', callback_data: `edit_dish_${dishId}` },
          { text: '🗑️ Удалить', callback_data: `delete_dish_${dishId}` }
        ],
        [
          { text: '📋 Все блюда', callback_data: 'all_dishes' },
          { text: '🏠 Главное меню', callback_data: 'main_menu' }
        ]
      ]
    }
  };
}

// ==================== API FUNCTIONS ====================
async function apiRequest(endpoint, method = 'GET', data = null) {
  try {
    const config = {
      method,
      url: `${API_BASE_URL}${endpoint}`,
      headers: {
        'X-Admin-API-Key': ADMIN_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    };
    
    if (data) config.data = data;
    
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error('API Error:', error.message);
    throw error;
  }
}

// ==================== COMMAND HANDLERS ====================

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdminUser(chatId)) {
    return sendSafeMessage(chatId, '⛔ Нет доступа к админ-панели.');
  }
  
  console.log(`👑 Admin start: ${chatId}`);
  
  sendSafeMessage(chatId,
    '👑 АДМИН ПАНЕЛЬ\n\n' +
    'Доступные разделы:',
    adminMainMenu
  );
});

// /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdminUser(chatId)) return;
  
  sendSafeMessage(chatId,
    '🆘 ПОМОЩЬ АДМИНИСТРАТОРУ\n\n' +
    'Основные разделы:\n' +
    '• 🍽️ Блюда - управление меню\n' +
    '• 📦 Заказы - подтверждение заказов\n' +
    '• 📊 Статистика - общая информация\n' +
    '• ⚙️ Админ - системные настройки\n\n' +
    'Команды:\n' +
    '/start - главное меню\n' +
    '/orders - быстрый доступ к заказам\n' +
    '/dishes - управление блюдами',
    adminMainMenu
  );
});

// /orders - быстрый доступ
bot.onText(/\/orders/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdminUser(chatId)) return;
  
  showOrdersSection(chatId);
});

// /dishes - быстрый доступ
bot.onText(/\/dishes/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdminUser(chatId)) return;
  
  showDishesSection(chatId);
});

// ==================== TEXT MESSAGE HANDLERS ====================

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (!isAdminUser(chatId) || !text || text.startsWith('/')) return;
  
  console.log(`💬 Menu: ${chatId} -> ${text}`);
  
  switch(text) {
    case '🍽️ Блюда':
      showDishesSection(chatId);
      break;
      
    case '📦 Заказы':
      showOrdersSection(chatId);
      break;
      
    case '🏪 Рестораны':
      sendSafeMessage(chatId, '🏪 Раздел ресторанов в разработке...', adminMainMenu);
      break;
      
    case '📊 Статистика':
      showStatistics(chatId);
      break;
      
    case '⚙️ Админ':
      showAdminPanel(chatId);
      break;
      
    case '🆘 Помощь':
      sendSafeMessage(chatId,
        '🆘 ПОМОЩЬ\n\n' +
        'Для управления используйте меню.\n' +
        'Все функции доступны через кнопки.',
        adminMainMenu
      );
      break;
      
    default:
      // Если введен ID
      if (/^\d+$/.test(text)) {
        showDishById(chatId, parseInt(text));
      }
  }
});

// ==================== CALLBACK HANDLERS ====================

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  
  if (!isAdminUser(chatId)) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Нет доступа' });
    return;
  }
  
  console.log(`🔘 Callback: ${chatId} -> ${data}`);
  
  await bot.answerCallbackQuery(callbackQuery.id);
  
  // Обработка callback
  if (data === 'main_menu') {
    showMainMenu(chatId, messageId);
    
  } else if (data === 'all_dishes') {
    showAllDishes(chatId, messageId);
    
  } else if (data === 'create_dish') {
    sendSafeMessage(chatId,
      '➕ СОЗДАНИЕ БЛЮДА\n\n' +
      'Используйте API для создания:\n\n' +
      'POST /admin/dishes\n' +
      'Headers: X-Admin-API-Key\n\n' +
      'Пример JSON:\n' +
      '{\n' +
      '  "restaurant_id": 1,\n' +
      '  "name": "Новое блюдо",\n' +
      '  "price": 500,\n' +
      '  "description": "Описание"\n' +
      '}',
      dishesMenu
    );
    
  } else if (data === 'find_dish') {
    editSafeMessage(chatId, messageId,
      '🔍 ПОИСК БЛЮДА\n\n' +
      'Введите ID блюда:',
      { reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'main_menu' }]] } }
    );
    
  } else if (data.startsWith('toggle_dish_')) {
    const dishId = data.replace('toggle_dish_', '');
    toggleDish(chatId, dishId, messageId);
    
  } else if (data.startsWith('edit_dish_')) {
    const dishId = data.replace('edit_dish_', '');
    showDishDetails(chatId, dishId, messageId);
    
  } else if (data.startsWith('delete_dish_')) {
    const dishId = data.replace('delete_dish_', '');
    confirmDeleteDish(chatId, dishId, messageId);
    
  } else if (data === 'new_orders') {
    showNewOrders(chatId, messageId);
    
  } else if (data === 'confirmed_orders') {
    sendSafeMessage(chatId, '✅ Раздел в разработке...', ordersMenu);
  }
});

// ==================== DISH FUNCTIONS ====================

function showDishesSection(chatId) {
  sendSafeMessage(chatId,
    '🍽️ УПРАВЛЕНИЕ БЛЮДАМИ\n\n' +
    'Выберите действие:',
    dishesMenu
  );
}

async function showAllDishes(chatId, messageId = null) {
  try {
    const restaurants = await apiRequest('/restaurants');
    
    if (!restaurants || restaurants.length === 0) {
      const message = '😔 Рестораны не найдены.';
      if (messageId) {
        return editSafeMessage(chatId, messageId, message, dishesMenu);
      }
      return sendSafeMessage(chatId, message, dishesMenu);
    }
    
    let message = '📋 ВСЕ БЛЮДА\n\n';
    let keyboard = [];
    
    for (const restaurant of restaurants.slice(0, 3)) {
      try {
        const menu = await apiRequest(`/restaurants/${restaurant.id}/menu`);
        
        if (menu && menu.length > 0) {
          message += `${restaurant.name}:\n`;
          
          menu.slice(0, 5).forEach(dish => {
            const status = dish.is_available ? '✅' : '❌';
            message += `${status} ${dish.name} - ${dish.price} ₽ (ID: ${dish.id})\n`;
            
            keyboard.push([
              { 
                text: `${status} ${dish.name.substring(0, 15)}`, 
                callback_data: `edit_dish_${dish.id}`
              }
            ]);
          });
          
          message += '\n';
        }
      } catch (error) {
        console.log('Menu error:', error.message);
      }
    }
    
    if (keyboard.length === 0) {
      message = '😔 Блюда не найдены.';
      keyboard = [[{ text: '➕ Создать первое блюдо', callback_data: 'create_dish' }]];
    }
    
    keyboard.push([{ text: '🏠 Главное меню', callback_data: 'main_menu' }]);
    
    const replyMarkup = { reply_markup: { inline_keyboard: keyboard } };
    
    if (messageId) {
      editSafeMessage(chatId, messageId, message, replyMarkup);
    } else {
      sendSafeMessage(chatId, message, replyMarkup);
    }
    
  } catch (error) {
    const errorMsg = '❌ Ошибка загрузки блюд';
    if (messageId) {
      editSafeMessage(chatId, messageId, errorMsg, dishesMenu);
    } else {
      sendSafeMessage(chatId, errorMsg, dishesMenu);
    }
  }
}

async function showDishById(chatId, dishId) {
  try {
    const result = await apiRequest(`/bot/dish/${dishId}`);
    const dish = result.dish;
    
    const message = 
      `🍽️ ${dish.name}\n\n` +
      `${dish.description}\n\n` +
      `Цена: ${dish.price} ₽\n` +
      `Время готовки: ${dish.preparation_time} мин\n` +
      `Статус: ${dish.is_available ? '✅ Доступно' : '❌ Недоступно'}\n` +
      `Ресторан: ${dish.restaurant_name}\n\n` +
      `ID: ${dish.id}`;
    
    const actions = getDishActions(dish.id, dish.is_available);
    
    sendSafeMessage(chatId, message, actions);
    
  } catch (error) {
    sendSafeMessage(chatId, `❌ Блюдо #${dishId} не найдено`, dishesMenu);
  }
}

async function showDishDetails(chatId, dishId, messageId = null) {
  try {
    const result = await apiRequest(`/bot/dish/${dishId}`);
    const dish = result.dish;
    
    const message = 
      `🍽️ ${dish.name}\n\n` +
      `${dish.description}\n\n` +
      `• Цена: ${dish.price} ₽\n` +
      `• Время: ${dish.preparation_time} мин\n` +
      `• Статус: ${dish.is_available ? '✅ Доступно' : '❌ Недоступно'}\n` +
      `• Ресторан: ${dish.restaurant_name}\n` +
      `• Острое: ${dish.is_spicy ? 'Да' : 'Нет'}\n` +
      `• Вегетарианское: ${dish.is_vegetarian ? 'Да' : 'Нет'}\n\n` +
      `ID: ${dish.id}`;
    
    const actions = getDishActions(dish.id, dish.is_available);
    
    if (messageId) {
      editSafeMessage(chatId, messageId, message, actions);
    } else {
      sendSafeMessage(chatId, message, actions);
    }
    
  } catch (error) {
    const errorMsg = `❌ Блюдо #${dishId} не найдено`;
    if (messageId) {
      editSafeMessage(chatId, messageId, errorMsg, dishesMenu);
    } else {
      sendSafeMessage(chatId, errorMsg, dishesMenu);
    }
  }
}

async function toggleDish(chatId, dishId, messageId = null) {
  try {
    const result = await apiRequest(`/bot/dish/${dishId}/toggle`, 'POST');
    
    const status = result.dish.is_available ? '✅ Включено' : '❌ Выключено';
    const message = `🔄 Статус изменен: ${status}`;
    
    // Показываем обновленную информацию
    showDishDetails(chatId, dishId, messageId);
    
  } catch (error) {
    const errorMsg = `❌ Ошибка: ${error.message}`;
    if (messageId) {
      editSafeMessage(chatId, messageId, errorMsg, dishesMenu);
    } else {
      sendSafeMessage(chatId, errorMsg, dishesMenu);
    }
  }
}

async function confirmDeleteDish(chatId, dishId, messageId = null) {
  try {
    const result = await apiRequest(`/bot/dish/${dishId}`);
    const dish = result.dish;
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🗑️ УДАЛИТЬ', callback_data: `confirm_delete_${dishId}` },
            { text: '❌ ОТМЕНА', callback_data: `edit_dish_${dishId}` }
          ]
        ]
      }
    };
    
    const message = 
      `🗑️ ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ\n\n` +
      `Удалить блюдо?\n\n` +
      `${dish.name}\n` +
      `${dish.price} ₽\n` +
      `${dish.restaurant_name}\n\n` +
      `Внимание: если блюдо есть в заказах, оно будет скрыто.`;
    
    if (messageId) {
      editSafeMessage(chatId, messageId, message, keyboard);
    } else {
      sendSafeMessage(chatId, message, keyboard);
    }
    
  } catch (error) {
    const errorMsg = `❌ Ошибка: ${error.message}`;
    if (messageId) {
      editSafeMessage(chatId, messageId, errorMsg, dishesMenu);
    } else {
      sendSafeMessage(chatId, errorMsg, dishesMenu);
    }
  }
}

// Обработка подтверждения удаления
bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  
  if (!data.startsWith('confirm_delete_')) return;
  
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const dishId = data.replace('confirm_delete_', '');
  
  await bot.answerCallbackQuery(callbackQuery.id);
  
  try {
    const result = await apiRequest(`/admin/dishes/${dishId}`, 'DELETE');
    
    const message = result.soft_delete ? 
      '✅ Блюдо скрыто (есть в заказах)' : 
      '✅ Блюдо удалено';
    
    editSafeMessage(chatId, messageId, message, dishesMenu);
    
  } catch (error) {
    editSafeMessage(chatId, messageId, `❌ Ошибка удаления: ${error.message}`, dishesMenu);
  }
});

// ==================== ORDER FUNCTIONS ====================

function showOrdersSection(chatId) {
  sendSafeMessage(chatId,
    '📦 УПРАВЛЕНИЕ ЗАКАЗАМИ\n\n' +
    'Выберите статус:',
    ordersMenu
  );
}

async function showNewOrders(chatId, messageId = null) {
  try {
    // Пробуем получить заказы
    const orders = await apiRequest('/admin/orders?status=pending&limit=5');
    
    if (!orders || orders.length === 0) {
      const message = '😔 Новых заказов нет';
      if (messageId) {
        return editSafeMessage(chatId, messageId, message, ordersMenu);
      }
      return sendSafeMessage(chatId, message, ordersMenu);
    }
    
    let message = '🆕 НОВЫЕ ЗАКАЗЫ\n\n';
    let keyboard = [];
    
    orders.forEach(order => {
      message += 
        `Заказ #${order.id}\n` +
        `Клиент: ${order.user_name || 'Не указано'}\n` +
        `Ресторан: ${order.restaurant_name}\n` +
        `Сумма: ${order.total_amount} ₽\n` +
        `Адрес: ${order.delivery_address.substring(0, 30)}...\n`;
      
      if (order.items && order.items.length > 0) {
        const item = order.items[0];
        message += `Блюдо: ${item.dish_name} x${item.quantity}\n`;
      }
      
      message += `---\n`;
      
      keyboard.push([
        { 
          text: `📦 #${order.id} - ${order.total_amount} ₽`, 
          callback_data: `view_order_${order.id}`
        }
      ]);
    });
    
    keyboard.push([{ text: '🏠 Главное меню', callback_data: 'main_menu' }]);
    
    const replyMarkup = { reply_markup: { inline_keyboard: keyboard } };
    
    if (messageId) {
      editSafeMessage(chatId, messageId, message, replyMarkup);
    } else {
      sendSafeMessage(chatId, message, replyMarkup);
    }
    
  } catch (error) {
    console.log('Orders error:', error.message);
    const errorMsg = '❌ Ошибка загрузки заказов. Проверьте API эндпоинт.';
    if (messageId) {
      editSafeMessage(chatId, messageId, errorMsg, ordersMenu);
    } else {
      sendSafeMessage(chatId, errorMsg, ordersMenu);
    }
  }
}

// Просмотр деталей заказа
bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  
  if (!data.startsWith('view_order_')) return;
  
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const orderId = data.replace('view_order_', '');
  
  await bot.answerCallbackQuery(callbackQuery.id);
  
  try {
    const orders = await apiRequest('/admin/orders');
    const order = orders.find(o => o.id == orderId);
    
    if (!order) {
      return editSafeMessage(chatId, messageId, '❌ Заказ не найден', ordersMenu);
    }
    
    let message = 
      `📦 ЗАКАЗ #${order.id}\n\n` +
      `Клиент: ${order.user_name || 'Не указано'}\n` +
      `Телефон: ${order.user_phone || 'Не указано'}\n` +
      `Ресторан: ${order.restaurant_name}\n` +
      `Адрес: ${order.delivery_address}\n` +
      `Статус: ${order.status}\n` +
      `Сумма: ${order.total_amount} ₽\n` +
      `Оплата: ${order.payment_method}\n` +
      `Время: ${new Date(order.order_date).toLocaleString()}\n\n` +
      `Состав заказа:\n`;
    
    if (order.items && order.items.length > 0) {
      order.items.forEach(item => {
        message += `• ${item.dish_name} x${item.quantity} - ${item.dish_price * item.quantity} ₽\n`;
      });
    }
    
    // Кнопки управления
    let inlineKeyboard = [];
    
    if (order.status === 'pending') {
      inlineKeyboard.push([
        { text: '✅ Подтвердить', callback_data: `confirm_order_${order.id}` },
        { text: '❌ Отменить', callback_data: `cancel_order_${order.id}` }
      ]);
    }
    
    inlineKeyboard.push([
      { text: '📦 Все заказы', callback_data: 'new_orders' },
      { text: '🏠 Главное меню', callback_data: 'main_menu' }
    ]);
    
    const keyboard = { reply_markup: { inline_keyboard: inlineKeyboard } };
    
    editSafeMessage(chatId, messageId, message, keyboard);
    
  } catch (error) {
    editSafeMessage(chatId, messageId, `❌ Ошибка: ${error.message}`, ordersMenu);
  }
});

// Подтверждение заказа
bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data;
  
  if (!data.startsWith('confirm_order_')) return;
  
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const orderId = data.replace('confirm_order_', '');
  
  await bot.answerCallbackQuery(callbackQuery.id);
  
  try {
    const result = await apiRequest(`/admin/orders/${orderId}/status`, 'PUT', {
      status: 'confirmed'
    });
    
    editSafeMessage(chatId, messageId, 
      `✅ Заказ #${orderId} подтвержден!\n\n` +
      `Статус изменен на "подтвержден".`,
      ordersMenu
    );
    
  } catch (error) {
    editSafeMessage(chatId, messageId, 
      `❌ Ошибка подтверждения: ${error.message}`,
      ordersMenu
    );
  }
});

// ==================== OTHER FUNCTIONS ====================

function showMainMenu(chatId, messageId = null) {
  if (messageId) {
    editSafeMessage(chatId, messageId, '👑 АДМИН ПАНЕЛЬ\n\nВыберите раздел:', adminMainMenu);
  } else {
    sendSafeMessage(chatId, '👑 Админ панель:', adminMainMenu);
  }
}

async function showStatistics(chatId) {
  try {
    const orders = await apiRequest('/admin/orders');
    const restaurants = await apiRequest('/restaurants');
    const health = await apiRequest('/health');
    
    const pendingOrders = orders ? orders.filter(o => o.status === 'pending').length : 0;
    
    const message = 
      '📊 СТАТИСТИКА СИСТЕМЫ\n\n' +
      `Заказов всего: ${orders?.length || 0}\n` +
      `Новых заказов: ${pendingOrders}\n` +
      `Ресторанов: ${restaurants?.length || 0}\n` +
      `Статус API: ${health?.status || 'недоступен'}\n` +
      `База данных: ${health?.database || 'неизвестно'}\n\n` +
      `Обновлено: ${new Date().toLocaleTimeString()}`;
    
    sendSafeMessage(chatId, message, adminMainMenu);
    
  } catch (error) {
    sendSafeMessage(chatId, '❌ Ошибка загрузки статистики', adminMainMenu);
  }
}

function showAdminPanel(chatId) {
  sendSafeMessage(chatId,
    '⚙️ АДМИН ПАНЕЛЬ\n\n' +
    `API: ${API_BASE_URL}\n` +
    `Админы: ${ADMIN_USERS.join(', ') || 'Все'}\n` +
    `Время: ${new Date().toLocaleString()}`,
    adminMainMenu
  );
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
      service: 'admin-bot-safe',
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(200);
    res.end('🤖 Admin Bot Safe');
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`✅ Health server: ${PORT}`);
  console.log('🎉 Safe bot is ready!');
});

process.on('SIGTERM', () => {
  console.log('🛑 Shutting down...');
  bot.stopPolling();
  server.close();
  process.exit(0);
});
