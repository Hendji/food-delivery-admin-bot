require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const http = require('http');

console.log('🚀 Admin Bot Fixed Starting...');

// ==================== CONFIG ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE_URL = 'https://food-delivery-api-production-8385.up.railway.app';

// Список администраторов
const ADMIN_USERS = process.env.ADMIN_USERS ? 
  process.env.ADMIN_USERS.split(',').map(id => parseInt(id.trim())) : 
  [];

// Проверка прав
function isAdminUser(chatId) {
  return ADMIN_USERS.length === 0 || ADMIN_USERS.includes(chatId);
}

if (!TELEGRAM_TOKEN || !ADMIN_API_KEY) {
  console.error('❌ Missing environment variables!');
  process.exit(1);
}

console.log('✅ Config loaded');
console.log('🔗 API:', API_BASE_URL);
console.log('👑 Admin users:', ADMIN_USERS);

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

// ==================== STATE MANAGEMENT ====================
const userStates = new Map();

function getUserState(chatId) {
  if (!userStates.has(chatId)) {
    userStates.set(chatId, { mode: 'normal' });
  }
  return userStates.get(chatId);
}

// ==================== API HELPER ====================
async function callAPI(endpoint, method = 'GET', data = null) {
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

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error('API Error:', error.response?.data || error.message);
    throw error;
  }
}

// ==================== KEYBOARDS (ИСПРАВЛЕННЫЕ) ====================

// Главное меню для админов (РЕПЛИ-КЛАВИАТУРА)
const adminMainMenu = {
  reply_markup: {
    keyboard: [
      ['🍽️ Управление блюдами', '🏪 Рестораны'],
      ['📦 Управление заказами', '📊 Статистика'],
      ['⚙️ Админ-панель', '🆘 Помощь']
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

// Меню управления блюдами (INLINE-КЛАВИАТУРА)
const dishesManagementMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📋 Список блюд', callback_data: 'dishes_list' },
        { text: '➕ Новое блюдо', callback_data: 'dish_create' }
      ],
      [
        { text: '🔍 Найти блюдо', callback_data: 'dish_search' },
        { text: '🔄 Быстрое управление', callback_data: 'dish_quick_manage' }
      ],
      [
        { text: '🏠 Главное меню', callback_data: 'main_menu' }
      ]
    ]
  }
};

// Меню управления заказами (INLINE-КЛАВИАТУРА)
const ordersManagementMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🆕 Новые заказы', callback_data: 'orders_new' },
        { text: '✅ Подтвержденные', callback_data: 'orders_confirmed' }
      ],
      [
        { text: '👨‍🍳 В готовке', callback_data: 'orders_preparing' },
        { text: '🚚 В доставке', callback_data: 'orders_delivering' }
      ],
      [
        { text: '🎉 Доставленные', callback_data: 'orders_delivered' },
        { text: '❌ Отмененные', callback_data: 'orders_cancelled' }
      ],
      [
        { text: '🏠 Главное меню', callback_data: 'main_menu' }
      ]
    ]
  }
};

// Админ-панель (INLINE-КЛАВИАТУРА)
const adminPanelMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📊 Системная статистика', callback_data: 'system_stats' },
        { text: '👥 Управление доступом', callback_data: 'access_manage' }
      ],
      [
        { text: '🔧 Настройки API', callback_data: 'api_settings' }
      ],
      [
        { text: '🏠 Главное меню', callback_data: 'main_menu' }
      ]
    ]
  }
};

// Меню действий с блюдом
function createDishActionsMenu(dishId, isAvailable) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: isAvailable ? '❌ Сделать недоступным' : '✅ Сделать доступным', 
            callback_data: `dish_toggle_${dishId}` }
        ],
        [
          { text: '✏️ Редактировать', callback_data: `dish_edit_${dishId}` },
          { text: '🗑️ Удалить', callback_data: `dish_delete_${dishId}` }
        ],
        [
          { text: '📋 Список блюд', callback_data: 'dishes_list' },
          { text: '🏠 Главное меню', callback_data: 'main_menu' }
        ]
      ]
    }
  };
}

// Кнопка "Назад" (для отмены действий)
const cancelKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '❌ Отмена', callback_data: 'cancel_action' }]
    ]
  }
};

// ==================== ИСПРАВЛЕННАЯ ФУНКЦИЯ ОТПРАВКИ ====================
function updateOrSend(chatId, messageId, text, options) {
  // Проверяем, есть ли reply_markup в options
  const hasReplyMarkup = options && options.reply_markup;
  
  if (messageId) {
    // Для редактирования сообщения
    const editOptions = {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown'
    };
    
    if (hasReplyMarkup) {
      editOptions.reply_markup = options.reply_markup;
    }
    
    return bot.editMessageText(text, editOptions).catch(err => {
      console.log('Cannot edit message, sending new:', err.message);
      // Если не удалось отредактировать, отправляем новое сообщение
      return sendNewMessage(chatId, text, options);
    });
  } else {
    // Для нового сообщения
    return sendNewMessage(chatId, text, options);
  }
}

function sendNewMessage(chatId, text, options) {
  const sendOptions = {
    parse_mode: 'Markdown'
  };
  
  if (options && options.reply_markup) {
    sendOptions.reply_markup = options.reply_markup;
  }
  
  return bot.sendMessage(chatId, text, sendOptions);
}

// ==================== COMMAND HANDLERS ====================

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const isAdmin = isAdminUser(chatId);
  
  if (!isAdmin) {
    return bot.sendMessage(chatId,
      '⛔ У вас нет доступа к админ-панели.',
      { parse_mode: 'Markdown' }
    );
  }
  
  console.log(`👑 Admin start from ${chatId}`);
  
  bot.sendMessage(chatId,
    '👑 *АДМИНИСТРАТИВНАЯ ПАНЕЛЬ*\n\n' +
    'Выберите раздел для управления:',
    adminMainMenu
  );
});

// ==================== TEXT MESSAGE HANDLERS ====================

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const isAdmin = isAdminUser(chatId);
  
  if (!isAdmin || !text || text.startsWith('/')) return;
  
  console.log(`💬 Admin menu: ${chatId} -> ${text}`);
  
  switch(text) {
    case '🍽️ Управление блюдами':
      showDishesManagement(chatId);
      break;
      
    case '🏪 Рестораны':
      bot.sendMessage(chatId, '🏪 Раздел ресторанов в разработке...', adminMainMenu);
      break;
      
    case '📦 Управление заказами':
      showOrdersManagement(chatId);
      break;
      
    case '📊 Статистика':
      showStatistics(chatId);
      break;
      
    case '⚙️ Админ-панель':
      showAdminPanel(chatId);
      break;
      
    case '🆘 Помощь':
      showHelp(chatId);
      break;
      
    default:
      // Если введен ID блюда
      if (/^\d+$/.test(text)) {
        showDishInfo(chatId, parseInt(text));
      }
  }
});

// ==================== CALLBACK QUERY HANDLERS ====================

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
  
  // Обработка основных callback данных
  if (data === 'main_menu') {
    showMainMenu(chatId, messageId);
    
  } else if (data === 'dishes_list') {
    showAllDishes(chatId, messageId);
    
  } else if (data === 'dish_create') {
    startDishCreation(chatId, messageId);
    
  } else if (data === 'dish_search') {
    bot.editMessageText('🔍 Введите ID блюда для поиска:', {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: cancelKeyboard.reply_markup
    });
    
  } else if (data.startsWith('dish_toggle_')) {
    const dishId = data.replace('dish_toggle_', '');
    toggleDishAvailability(chatId, dishId, messageId);
    
  } else if (data.startsWith('dish_edit_')) {
    const dishId = data.replace('dish_edit_', '');
    showDishEditMenu(chatId, dishId, messageId);
    
  } else if (data.startsWith('dish_delete_')) {
    const dishId = data.replace('dish_delete_', '');
    confirmDishDeletion(chatId, dishId, messageId);
    
  } else if (data === 'orders_new') {
    showOrdersByStatus(chatId, 'pending', messageId);
    
  } else if (data === 'orders_confirmed') {
    showOrdersByStatus(chatId, 'confirmed', messageId);
    
  } else if (data.startsWith('order_action_')) {
    handleOrderAction(chatId, data, messageId);
    
  } else if (data === 'system_stats') {
    showSystemStats(chatId, messageId);
    
  } else if (data === 'access_manage') {
    showAccessInfo(chatId, messageId);
    
  } else if (data === 'cancel_action') {
    showMainMenu(chatId, messageId);
  }
});

// ==================== DISH MANAGEMENT FUNCTIONS ====================

function showDishesManagement(chatId) {
  bot.sendMessage(chatId,
    '🍽️ *УПРАВЛЕНИЕ БЛЮДАМИ*\n\n' +
    'Выберите действие:',
    dishesManagementMenu
  );
}

async function showAllDishes(chatId, messageId = null) {
  try {
    await bot.sendChatAction(chatId, 'typing');
    
    const restaurants = await callAPI('/restaurants');
    
    if (!restaurants || restaurants.length === 0) {
      return updateOrSend(chatId, messageId,
        '😔 Рестораны не найдены.',
        dishesManagementMenu
      );
    }
    
    let message = '📋 *ВСЕ БЛЮДА*\n\n';
    let dishesKeyboard = [];
    
    for (const restaurant of restaurants.slice(0, 3)) { // Ограничиваем 3 ресторанами
      try {
        const menu = await callAPI(`/restaurants/${restaurant.id}/menu`);
        
        if (menu && menu.length > 0) {
          message += `*${restaurant.name}*\n`;
          
          menu.slice(0, 5).forEach(dish => { // Ограничиваем 5 блюдами
            const status = dish.is_available ? '✅' : '❌';
            message += `${status} ${dish.name} - ${dish.price} ₽ (ID: ${dish.id})\n`;
            
            dishesKeyboard.push([
              { 
                text: `${status} ${dish.name.substring(0, 15)}`, 
                callback_data: `dish_edit_${dish.id}` 
              }
            ]);
          });
          
          message += '\n';
        }
      } catch (error) {
        console.error('Error loading menu:', error.message);
      }
    }
    
    if (dishesKeyboard.length === 0) {
      message = '😔 Блюда не найдены.';
      dishesKeyboard = [[{ text: '➕ Создать первое блюдо', callback_data: 'dish_create' }]];
    }
    
    dishesKeyboard.push([{ text: '🔙 Назад', callback_data: 'main_menu' }]);
    
    const keyboard = { reply_markup: { inline_keyboard: dishesKeyboard } };
    
    updateOrSend(chatId, messageId, message, keyboard);
    
  } catch (error) {
    const errorMessage = '❌ Ошибка при загрузке блюд';
    updateOrSend(chatId, messageId, errorMessage, dishesManagementMenu);
  }
}

function startDishCreation(chatId, messageId = null) {
  const message = '➕ *СОЗДАНИЕ НОВОГО БЛЮДА*\n\n' +
    'Эта функция находится в разработке.\n' +
    'Пока используйте API для создания блюд.\n\n' +
    'Endpoint: POST /admin/dishes\n' +
    'Headers: X-Admin-API-Key: ваш_ключ';
  
  updateOrSend(chatId, messageId, message, dishesManagementMenu);
}

async function showDishInfo(chatId, dishId, messageId = null) {
  try {
    const result = await callAPI(`/bot/dish/${dishId}`);
    const dish = result.dish;
    
    const message = 
      `🍽️ *${dish.name}*\n\n` +
      `📝 ${dish.description}\n` +
      `💰 Цена: ${dish.price} ₽\n` +
      `⏱️ Время готовки: ${dish.preparation_time} мин\n` +
      `📊 Статус: ${dish.is_available ? '✅ Доступно' : '❌ Недоступно'}\n` +
      `🏪 Ресторан: ${dish.restaurant_name}\n\n` +
      `🆔 ID: ${dish.id}`;
    
    const keyboard = createDishActionsMenu(dish.id, dish.is_available);
    
    updateOrSend(chatId, messageId, message, keyboard);
    
  } catch (error) {
    updateOrSend(chatId, messageId,
      `❌ Блюдо #${dishId} не найдено`,
      dishesManagementMenu
    );
  }
}

function showDishEditMenu(chatId, dishId, messageId = null) {
  showDishInfo(chatId, dishId, messageId);
}

async function toggleDishAvailability(chatId, dishId, messageId = null) {
  try {
    const result = await callAPI(`/bot/dish/${dishId}/toggle`, 'POST');
    
    const status = result.dish.is_available ? '✅ Доступно' : '❌ Недоступно';
    const message = `🔄 Статус изменен: ${status}`;
    
    // Обновляем информацию о блюде
    showDishInfo(chatId, dishId, messageId);
    
  } catch (error) {
    updateOrSend(chatId, messageId,
      `❌ Ошибка: ${error.message}`,
      dishesManagementMenu
    );
  }
}

async function confirmDishDeletion(chatId, dishId, messageId = null) {
  try {
    const result = await callAPI(`/bot/dish/${dishId}`);
    const dish = result.dish;
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🗑️ УДАЛИТЬ', callback_data: `confirm_delete_${dishId}` },
            { text: '❌ ОТМЕНА', callback_data: `dish_edit_${dishId}` }
          ]
        ]
      }
    };
    
    updateOrSend(chatId, messageId,
      `🗑️ *ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ*\n\n` +
      `Удалить блюдо?\n\n` +
      `🍽️ ${dish.name}\n` +
      `💰 ${dish.price} ₽\n` +
      `🏪 ${dish.restaurant_name}\n\n` +
      `⚠️ Если блюдо есть в заказах, оно будет скрыто.`,
      keyboard
    );
    
  } catch (error) {
    updateOrSend(chatId, messageId,
      `❌ Ошибка: ${error.message}`,
      dishesManagementMenu
    );
  }
}

// ==================== ORDER MANAGEMENT FUNCTIONS ====================

function showOrdersManagement(chatId) {
  bot.sendMessage(chatId,
    '📦 *УПРАВЛЕНИЕ ЗАКАЗАМИ*\n\n' +
    'Выберите статус заказов:',
    ordersManagementMenu
  );
}

async function showOrdersByStatus(chatId, status, messageId = null) {
  try {
    const orders = await callAPI('/admin/orders?status=pending&limit=5');
    
    if (!orders || orders.length === 0) {
      const statusText = getStatusText(status);
      return updateOrSend(chatId, messageId,
        `😔 ${statusText} заказов нет.`,
        ordersManagementMenu
      );
    }
    
    let message = `${getStatusEmoji(status)} *${getStatusText(status).toUpperCase()} ЗАКАЗЫ*\n\n`;
    
    orders.forEach((order, index) => {
      message += 
        `📦 *Заказ #${order.id}*\n` +
        `👤 ${order.user_name || 'Клиент'}\n` +
        `🏪 ${order.restaurant_name}\n` +
        `💰 ${order.total_amount} ₽\n` +
        `📍 ${order.delivery_address.substring(0, 30)}...\n`;
      
      // Кратко о блюдах
      if (order.items && order.items.length > 0) {
        const firstItem = order.items[0];
        message += `🍽️ ${firstItem.dish_name} x${firstItem.quantity}`;
        if (order.items.length > 1) {
          message += ` + еще ${order.items.length - 1}`;
        }
        message += '\n';
      }
      
      message += `---\n`;
    });
    
    // Создаем клавиатуру с заказами
    let ordersKeyboard = orders.map(order => [
      { text: `📦 #${order.id} - ${order.total_amount} ₽`, 
        callback_data: `order_view_${order.id}` }
    ]);
    
    ordersKeyboard.push([{ text: '🔙 Назад', callback_data: 'main_menu' }]);
    
    const keyboard = { reply_markup: { inline_keyboard: ordersKeyboard } };
    
    updateOrSend(chatId, messageId, message, keyboard);
    
  } catch (error) {
    console.error('Orders error:', error.message);
    updateOrSend(chatId, messageId,
      '❌ Ошибка загрузки заказов.\nПроверьте API эндпоинт /admin/orders',
      ordersManagementMenu
    );
  }
}

async function handleOrderAction(chatId, actionData, messageId = null) {
  const [_, orderId] = actionData.split('_').slice(2);
  
  // Пока просто показываем детали заказа
  try {
    const orders = await callAPI('/admin/orders');
    const order = orders.find(o => o.id == orderId);
    
    if (!order) {
      return updateOrSend(chatId, messageId,
        '❌ Заказ не найден',
        ordersManagementMenu
      );
    }
    
    let message = 
      `📦 *ЗАКАЗ #${order.id}*\n\n` +
      `👤 Клиент: ${order.user_name || 'Не указано'}\n` +
      `📞 Телефон: ${order.user_phone || 'Не указано'}\n` +
      `🏪 Ресторан: ${order.restaurant_name}\n` +
      `📍 Адрес: ${order.delivery_address}\n` +
      `📊 Статус: ${getStatusEmoji(order.status)} ${getStatusText(order.status)}\n` +
      `💰 Сумма: ${order.total_amount} ₽\n\n` +
      `🍽️ Состав:\n`;
    
    if (order.items && order.items.length > 0) {
      order.items.forEach(item => {
        message += `• ${item.dish_name} x${item.quantity} - ${item.dish_price * item.quantity} ₽\n`;
      });
    }
    
    // Кнопки управления в зависимости от статуса
    let inlineKeyboard = [];
    
    if (order.status === 'pending') {
      inlineKeyboard.push([
        { text: '✅ Подтвердить', callback_data: `order_action_confirm_${order.id}` },
        { text: '❌ Отменить', callback_data: `order_action_cancel_${order.id}` }
      ]);
    } else if (order.status === 'confirmed') {
      inlineKeyboard.push([
        { text: '👨‍🍳 В готовку', callback_data: `order_action_prepare_${order.id}` }
      ]);
    }
    
    inlineKeyboard.push([
      { text: '📦 Все заказы', callback_data: 'orders_new' },
      { text: '🏠 Главное меню', callback_data: 'main_menu' }
    ]);
    
    const keyboard = { reply_markup: { inline_keyboard: inlineKeyboard } };
    
    updateOrSend(chatId, messageId, message, keyboard);
    
  } catch (error) {
    updateOrSend(chatId, messageId,
      `❌ Ошибка: ${error.message}`,
      ordersManagementMenu
    );
  }
}

// ==================== ADMIN PANEL FUNCTIONS ====================

function showAdminPanel(chatId) {
  bot.sendMessage(chatId,
    '⚙️ *АДМИН-ПАНЕЛЬ*\n\n' +
    'Системные функции:',
    adminPanelMenu
  );
}

async function showSystemStats(chatId, messageId = null) {
  try {
    const health = await callAPI('/health');
    const orders = await callAPI('/admin/orders?limit=1');
    const restaurants = await callAPI('/restaurants');
    
    const message = 
      '📈 *СИСТЕМНАЯ СТАТИСТИКА*\n\n' +
      `🚀 API: ${health.status}\n` +
      `🗄️ База: ${health.database}\n` +
      `📦 Заказов: ${orders?.length || 0}\n` +
      `🏪 Ресторанов: ${restaurants?.length || 0}\n` +
      `⏰ Время: ${new Date().toLocaleTimeString()}\n\n` +
      `🔗 ${API_BASE_URL}`;
    
    updateOrSend(chatId, messageId, message, adminPanelMenu);
    
  } catch (error) {
    updateOrSend(chatId, messageId,
      '❌ Ошибка загрузки статистики',
      adminPanelMenu
    );
  }
}

function showAccessInfo(chatId, messageId = null) {
  const message = 
    '👥 *УПРАВЛЕНИЕ ДОСТУПОМ*\n\n' +
    `Текущие администраторы:\n${ADMIN_USERS.join('\n') || 'Все пользователи'}\n\n` +
    'Для изменения добавьте переменную ADMIN_USERS в Railway.';
  
  updateOrSend(chatId, messageId, message, adminPanelMenu);
}

// ==================== HELPER FUNCTIONS ====================

function showMainMenu(chatId, messageId = null) {
  if (messageId) {
    bot.editMessageText('👑 *АДМИНИСТРАТИВНАЯ ПАНЕЛЬ*\n\nВыберите раздел:', {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: adminMainMenu.reply_markup
    }).catch(err => {
      bot.sendMessage(chatId, '👑 Админ-панель:', adminMainMenu);
    });
  } else {
    bot.sendMessage(chatId, '👑 Админ-панель:', adminMainMenu);
  }
}

async function showStatistics(chatId) {
  try {
    const orders = await callAPI('/admin/orders');
    const restaurants = await callAPI('/restaurants');
    
    let totalDishes = 0;
    for (const restaurant of restaurants) {
      try {
        const menu = await callAPI(`/restaurants/${restaurant.id}/menu`);
        totalDishes += menu?.length || 0;
      } catch (error) {
        // Пропускаем
      }
    }
    
    const message = 
      '📊 *СТАТИСТИКА СИСТЕМЫ*\n\n' +
      `📦 Всего заказов: ${orders?.length || 0}\n` +
      `🆕 Новых (pending): ${orders?.filter(o => o.status === 'pending').length || 0}\n` +
      `🏪 Ресторанов: ${restaurants.length}\n` +
      `🍽️ Блюд: ${totalDishes}\n\n` +
      `🔄 ${new Date().toLocaleTimeString()}`;
    
    bot.sendMessage(chatId, message, adminMainMenu);
    
  } catch (error) {
    bot.sendMessage(chatId, '❌ Ошибка статистики', adminMainMenu);
  }
}

function showHelp(chatId) {
  const message = 
    '🆘 *ПОМОЩЬ АДМИНИСТРАТОРУ*\n\n' +
    '*Основные разделы:*\n' +
    '• 🍽️ Блюда - управление меню\n' +
    '• 📦 Заказы - подтверждение и отслеживание\n' +
    '• 📊 Статистика - общая информация\n' +
    '• ⚙️ Админ-панель - системные настройки\n\n' +
    '*Быстрые команды:*\n' +
    '/start - Главное меню\n' +
    '/help - Эта справка';
  
  bot.sendMessage(chatId, message, adminMainMenu);
}

function getStatusEmoji(status) {
  const emojis = {
    'pending': '🆕',
    'confirmed': '✅',
    'preparing': '👨‍🍳',
    'delivering': '🚚',
    'delivered': '🎉',
    'cancelled': '❌'
  };
  return emojis[status] || '📦';
}

function getStatusText(status) {
  const texts = {
    'pending': 'Новые',
    'confirmed': 'Подтвержденные',
    'preparing': 'В готовке',
    'delivering': 'В доставке',
    'delivered': 'Доставленные',
    'cancelled': 'Отмененные'
  };
  return texts[status] || status;
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
      service: 'admin-bot-fixed',
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(200);
    res.end('🤖 Admin Bot v2.0 Fixed');
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`✅ Health server: ${PORT}`);
  console.log('🎉 Fixed bot is ready!');
});

process.on('SIGTERM', () => {
  console.log('🛑 Shutting down...');
  bot.stopPolling();
  server.close();
  process.exit(0);
});
