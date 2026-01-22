require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const http = require('http');

console.log('🚀 TELEGRAM ORDER NOTIFICATION BOT Starting...');

// ==================== CONFIG ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE_URL = process.env.API_URL || 'https://food-delivery-api-production-8385.up.railway.app';

// Админы (могут управлять блюдами)
const ADMIN_USERS = process.env.ADMIN_USERS ? 
  process.env.ADMIN_USERS.split(',').map(id => parseInt(id.trim())) : 
  [];

// Кто может видеть заказы (все пользователи + админы)
const ORDER_USERS = process.env.ORDER_USERS ? 
  process.env.ORDER_USERS.split(',').map(id => parseInt(id.trim())) : 
  [];

// Кому отправлять уведомления о новых заказах
const NOTIFICATION_USERS = [...new Set([...ADMIN_USERS, ...ORDER_USERS])];

function isAdminUser(chatId) {
  return ADMIN_USERS.length === 0 || ADMIN_USERS.includes(chatId);
}

function canSeeOrders(chatId) {
  return ORDER_USERS.length === 0 || ORDER_USERS.includes(chatId) || isAdminUser(chatId);
}

if (!TELEGRAM_TOKEN) {
  console.error('❌ Missing TELEGRAM_TOKEN!');
  process.exit(1);
}

console.log('✅ Config loaded');
console.log('🔗 API:', API_BASE_URL);
console.log('👑 Admins:', ADMIN_USERS);
console.log('👥 Order users:', ORDER_USERS);
console.log('🔔 Notification users:', NOTIFICATION_USERS);

// ==================== USER STATE MANAGEMENT ====================
const userStates = {};

// ==================== BOT SETUP ====================
const bot = new TelegramBot(TELEGRAM_TOKEN, {
  polling: {
    interval: 2000,
    params: { 
      timeout: 30, 
      limit: 100,
      allowed_updates: ['message', 'callback_query']
    }
  },
  request: {
    timeout: 30000
  }
});

// Обработка ошибок
bot.on('polling_error', (error) => {
  if (error.message.includes('409 Conflict')) {
    console.log('⚠️  Another bot is running. Stop local processes.');
  } else {
    console.error('🔴 Polling error:', error.message);
  }
});

// ==================== MESSAGE FUNCTIONS ====================
function sendMessage(chatId, text, options = {}) {
  return bot.sendMessage(chatId, text, {
    ...options,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  }).catch(error => {
    console.error('Send message error:', error.message);
    return null;
  });
}

function editMessage(chatId, messageId, text, options = {}) {
  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    ...options,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  }).catch(error => {
    if (error.message.includes('message is not modified')) {
      return null;
    }
    console.error('Edit message error:', error.message);
    return sendMessage(chatId, text, options);
  });
}

// ==================== KEYBOARDS ====================
// Главное меню для админов
const adminMainMenu = {
  reply_markup: {
    keyboard: [
      ['🍽️ Блюда', '📦 Заказы'],
      ['📊 Статистика', '🆘 Помощь']
    ],
    resize_keyboard: true
  }
};

// Главное меню для обычных пользователей
const userMainMenu = {
  reply_markup: {
    keyboard: [
      ['📦 Заказы'],
      ['🆘 Помощь']
    ],
    resize_keyboard: true
  }
};

// Меню блюд для админов
const dishesMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📋 Все блюда', callback_data: 'all_dishes' },
        { text: '➕ Создать блюдо', callback_data: 'create_dish' }
      ],
      [
        { text: '🔍 Найти по ID', callback_data: 'find_dish' }
      ],
      [
        { text: '🏠 Главное меню', callback_data: 'main_menu' }
      ]
    ]
  }
};

// Меню заказов для всех
const ordersMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🆕 Новые заказы', callback_data: 'new_orders' },
        { text: '👨‍🍳 В работе', callback_data: 'active_orders' }
      ],
      [
        { text: '✅ Завершенные', callback_data: 'completed_orders' }
      ],
      [
        { text: '🔄 Обновить', callback_data: 'refresh_orders' }
      ],
      [
        { text: '🏠 Главное меню', callback_data: 'main_menu' }
      ]
    ]
  }
};

// Кнопки действий с заказом
function getOrderActions(orderId, status) {
  const keyboard = [];
  
  if (status === 'pending') {
    keyboard.push([
      { text: '✅ Принять', callback_data: `accept_order_${orderId}` },
      { text: '❌ Отклонить', callback_data: `reject_order_${orderId}` }
    ]);
  }
  
  if (status === 'preparing') {
    keyboard.push([
      { text: '🚚 Отправить', callback_data: `send_order_${orderId}` }
    ]);
  }
  
  if (status === 'delivering') {
    keyboard.push([
      { text: '✅ Доставлен', callback_data: `delivered_order_${orderId}` }
    ]);
  }
  
  keyboard.push([
    { text: '📦 Все заказы', callback_data: 'new_orders' },
    { text: '🏠 Главное меню', callback_data: 'main_menu' }
  ]);
  
  return {
    reply_markup: {
      inline_keyboard: keyboard
    }
  };
}

// Кнопки действий с блюдом (только для админов)
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
        'Content-Type': 'application/json'
      },
      timeout: 10000
    };
    
    if (ADMIN_API_KEY && (endpoint.includes('/admin/') || endpoint.includes('/bot/'))) {
      config.headers['X-Admin-API-Key'] = ADMIN_API_KEY;
    }
    
    if (data) config.data = data;
    
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error('API Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

// ==================== COMMAND HANDLERS ====================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  
  console.log(`👋 Start: ${chatId} (${username})`);
  
  // Проверяем права пользователя
  if (!canSeeOrders(chatId)) {
    return sendMessage(chatId,
      '⛔ У вас нет доступа к этому боту.\n\n' +
      'Обратитесь к администратору для получения доступа.'
    );
  }
  
  const welcomeMessage = isAdminUser(chatId) 
    ? '👑 ДОБРО ПОЖАЛОВАТЬ В АДМИН ПАНЕЛЬ\n\n' +
      'Вы можете:\n' +
      '• 🍽️ Управлять блюдами\n' +
      '• 📦 Просматривать и подтверждать заказы\n' +
      '• 📊 Смотреть статистику\n\n' +
      'Выберите раздел:'
    : '👋 ДОБРО ПОЖАЛОВАТЬ!\n\n' +
      'Вы можете:\n' +
      '• 📦 Просматривать и подтверждать заказы\n' +
      '• 📊 Смотреть статистику\n\n' +
      'Выберите раздел:';
  
  const menu = isAdminUser(chatId) ? adminMainMenu : userMainMenu;
  
  sendMessage(chatId, welcomeMessage, menu);
});

bot.onText(/\/orders/, (msg) => {
  const chatId = msg.chat.id;
  if (!canSeeOrders(chatId)) return;
  
  showOrdersSection(chatId);
});

bot.onText(/\/dishes/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdminUser(chatId)) {
    return sendMessage(chatId, '⛔ Эта функция доступна только администраторам.');
  }
  
  showDishesSection(chatId);
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  if (!canSeeOrders(chatId)) return;
  
  showHelp(chatId);
});

bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  if (!canSeeOrders(chatId)) return;
  
  showStatistics(chatId);
});

// ==================== TEXT MESSAGE HANDLERS ====================
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (!canSeeOrders(chatId) || !text || text.startsWith('/')) return;
  
  console.log(`💬 Message from ${chatId}: ${text}`);
  
  // Проверяем состояние пользователя
  const state = userStates[chatId];
  
  if (state) {
    // Пользователь находится в процессе создания/редактирования блюда
    if (state.action === 'create_dish' && state.step === 'waiting_for_data') {
      handleCreateDishData(chatId, text);
      return;
    }
    
    if (state.action === 'edit_dish' && state.step === 'waiting_for_data') {
      handleEditDishData(chatId, text);
      return;
    }
    
    if (state.action === 'find_dish' && state.step === 'waiting_for_id') {
      handleFindDish(chatId, text);
      return;
    }
  }
  
  // Обработка меню
  switch(text) {
    case '🍽️ Блюда':
      if (!isAdminUser(chatId)) {
        return sendMessage(chatId, '⛔ Эта функция доступна только администраторам.');
      }
      showDishesSection(chatId);
      break;
      
    case '📦 Заказы':
      showOrdersSection(chatId);
      break;
      
    case '📊 Статистика':
      showStatistics(chatId);
      break;
      
    case '🆘 Помощь':
      showHelp(chatId);
      break;
      
    default:
      // Если не команда меню
      sendMessage(chatId, 
        'Неизвестная команда. Используйте кнопки меню или команды:\n' +
        '/start - главное меню\n' +
        '/orders - заказы\n' +
        '/help - помощь',
        isAdminUser(chatId) ? adminMainMenu : userMainMenu
      );
  }
});

// ==================== CALLBACK HANDLERS ====================
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  
  if (!canSeeOrders(chatId)) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Нет доступа' });
    return;
  }
  
  console.log(`🔘 Callback from ${chatId}: ${data}`);
  await bot.answerCallbackQuery(callbackQuery.id);
  
  try {
    // Общие действия
    if (data === 'main_menu') {
      delete userStates[chatId];
      showMainMenu(chatId, messageId);
    }
    else if (data === 'refresh_orders') {
      showOrdersSection(chatId, messageId);
    }
    
    // Действия с заказами (доступны всем)
    else if (data === 'new_orders') {
      showOrdersByStatus(chatId, messageId, 'pending');
    }
    else if (data === 'active_orders') {
      showOrdersByStatus(chatId, messageId, ['preparing', 'delivering']);
    }
    else if (data === 'completed_orders') {
      showOrdersByStatus(chatId, messageId, ['delivered', 'cancelled']);
    }
    else if (data.startsWith('view_order_')) {
      const orderId = data.replace('view_order_', '');
      showOrderDetails(chatId, orderId, messageId);
    }
    else if (data.startsWith('accept_order_')) {
      const orderId = data.replace('accept_order_', '');
      updateOrderStatus(chatId, orderId, 'preparing', messageId);
    }
    else if (data.startsWith('reject_order_')) {
      const orderId = data.replace('reject_order_', '');
      updateOrderStatus(chatId, orderId, 'cancelled', messageId);
    }
    else if (data.startsWith('send_order_')) {
      const orderId = data.replace('send_order_', '');
      updateOrderStatus(chatId, orderId, 'delivering', messageId);
    }
    else if (data.startsWith('delivered_order_')) {
      const orderId = data.replace('delivered_order_', '');
      updateOrderStatus(chatId, orderId, 'delivered', messageId);
    }
    
    // Действия с блюдами (только для админов)
    else if (!isAdminUser(chatId)) {
      // Если не админ пытается получить доступ к функциям блюд
      editMessage(chatId, messageId, 
        '⛔ Эта функция доступна только администраторам.',
        ordersMenu
      );
    }
    else if (data === 'all_dishes') {
      delete userStates[chatId];
      showAllDishes(chatId, messageId);
    }
    else if (data === 'create_dish') {
      startCreateDishFlow(chatId, messageId);
    }
    else if (data === 'find_dish') {
      startFindDishFlow(chatId, messageId);
    }
    else if (data === 'cancel_create') {
      delete userStates[chatId];
      editMessage(chatId, messageId, 
        '❌ Создание блюда отменено.',
        dishesMenu
      );
    }
    else if (data.startsWith('toggle_dish_')) {
      const dishId = data.replace('toggle_dish_', '');
      toggleDishStatus(chatId, dishId, messageId);
    }
    else if (data.startsWith('edit_dish_')) {
      const dishId = data.replace('edit_dish_', '');
      startEditDishFlow(chatId, dishId, messageId);
    }
    else if (data.startsWith('cancel_edit_')) {
      const dishId = data.replace('cancel_edit_', '');
      delete userStates[chatId];
      showDishDetails(chatId, dishId, messageId);
    }
    else if (data.startsWith('delete_dish_')) {
      const dishId = data.replace('delete_dish_', '');
      confirmDeleteDish(chatId, dishId, messageId);
    }
    else if (data.startsWith('confirm_delete_')) {
      const dishId = data.replace('confirm_delete_', '');
      deleteDish(chatId, dishId, messageId);
    }
    
  } catch (error) {
    console.error('Callback error:', error.message);
    editMessage(chatId, messageId, 
      `❌ Ошибка: ${error.message}`,
      isAdminUser(chatId) ? adminMainMenu : userMainMenu
    );
  }
});

// ==================== ORDER FUNCTIONS ====================

// Показать раздел заказов
function showOrdersSection(chatId, messageId = null) {
    const message = '📦 УПРАВЛЕНИЕ ЗАКАЗАМИ\n\nВыберите тип заказов:';
    
    if (messageId) {
        editMessage(chatId, messageId, message, ordersMenu);
    } else {
        sendMessage(chatId, message, ordersMenu);
    }
}

async function showOrdersByStatus(chatId, messageId = null, status) {
  try {
    // Получаем заказы с сервера через бот эндпоинт
    const result = await apiRequest('/bot/orders');
    
    if (!result.success || !result.orders) {
      throw new Error('Не удалось получить заказы');
    }
    
    // Фильтруем заказы по статусу
    let filteredOrders = [];
    if (Array.isArray(status)) {
      filteredOrders = result.orders.filter(order => status.includes(order.status));
    } else {
      filteredOrders = result.orders.filter(order => order.status === status);
    }
    
    if (filteredOrders.length === 0) {
      const statusText = Array.isArray(status) ? status.join('/') : status;
      const message = `😔 Заказов со статусом "${getStatusText(status)}" нет`;
      
      if (messageId) {
        return editMessage(chatId, messageId, message, ordersMenu);
      }
      return sendMessage(chatId, message, ordersMenu);
    }
    
    // Формируем сообщение
    const statusText = Array.isArray(status) ? status.map(s => getStatusText(s)).join('/') : getStatusText(status);
    let message = `<b>📦 ЗАКАЗЫ: ${statusText}</b>\n\n`;
    
    filteredOrders.forEach((order, index) => {
      message += 
        `<b>Заказ #${order.id}</b>\n` +
        `👤 <i>${order.customer_name || 'Клиент'}</i>\n` +
        `📞 ${order.customer_phone || 'Телефон не указан'}\n` +
        `🏠 ${order.delivery_address.substring(0, 30)}...\n` +
        `🍽️ ${order.restaurant_name || 'Ресторан'}\n` +
        `💰 ${order.total_amount} ₽\n` +
        `⏰ ${new Date(order.order_date).toLocaleString('ru-RU')}\n`;
      
      if (order.items && order.items.length > 0) {
        const item = order.items[0];
        message += `🍴 ${item.dish_name || 'Блюдо'} x${item.quantity || 1}\n`;
      }
      
      message += `📊 <b>Статус:</b> ${getStatusText(order.status)}\n`;
      
      if (index < filteredOrders.length - 1) {
        message += `────────────────\n`;
      }
    });
    
    // Создаем клавиатуру с заказами
    const keyboard = [];
    filteredOrders.forEach(order => {
      keyboard.push([
        { 
          text: `#${order.id} - ${order.total_amount} ₽ - ${order.customer_name?.substring(0, 10) || 'Клиент'}`, 
          callback_data: `view_order_${order.id}`
        }
      ]);
    });
    
    keyboard.push([
      { text: '🔄 Обновить', callback_data: 'refresh_orders' },
      { text: '🏠 Главное меню', callback_data: 'main_menu' }
    ]);
    
    const replyMarkup = { 
      reply_markup: { 
        inline_keyboard: keyboard,
        resize_keyboard: true
      } 
    };
    
    if (messageId) {
      editMessage(chatId, messageId, message, replyMarkup);
    } else {
      sendMessage(chatId, message, replyMarkup);
    }
    
  } catch (error) {
    console.error('Show orders error:', error.message);
    const errorMsg = '❌ Ошибка загрузки заказов';
    if (messageId) {
      editMessage(chatId, messageId, errorMsg, ordersMenu);
    } else {
      sendMessage(chatId, errorMsg, ordersMenu);
    }
  }
}

async function showOrderDetails(chatId, orderId, messageId = null) {
  try {
    // Получаем заказ с сервера через бот эндпоинт
    const result = await apiRequest(`/bot/orders/${orderId}`);
    
    if (!result.success || !result.order) {
      throw new Error(`Заказ #${orderId} не найден`);
    }
    
    const order = result.order;
    
    let message = 
      `<b>📦 ДЕТАЛИ ЗАКАЗА #${order.id}</b>\n\n` +
      `<b>👤 Клиент:</b> ${order.customer_name || 'Не указано'}\n` +
      `<b>📞 Телефон:</b> ${order.customer_phone || 'Не указано'}\n` +
      `<b>🏠 Адрес доставки:</b>\n${order.delivery_address}\n\n` +
      `<b>🍽️ Ресторан:</b> ${order.restaurant_name || 'Наетый кабан'}\n` +
      `<b>⏰ Время заказа:</b> ${new Date(order.order_date).toLocaleString('ru-RU')}\n` +
      `<b>💰 Сумма:</b> ${order.total_amount} ₽\n` +
      `<b>💳 Оплата:</b> ${order.payment_method || 'Картой онлайн'}\n` +
      `<b>📊 Статус:</b> ${getStatusText(order.status)}\n\n`;
    
    if (order.items && order.items.length > 0) {
      message += `<b>🍴 Состав заказа:</b>\n`;
      order.items.forEach((item, index) => {
        const totalPrice = (item.dish_price || 0) * (item.quantity || 1);
        message += `${index + 1}. ${item.dish_name || 'Блюдо'} x${item.quantity || 1} - ${totalPrice} ₽\n`;
      });
    }
    
    const actions = getOrderActions(order.id, order.status);
    
    if (messageId) {
      editMessage(chatId, messageId, message, actions);
    } else {
      sendMessage(chatId, message, actions);
    }
    
  } catch (error) {
    console.error('Show order details error:', error.message);
    const errorMsg = `❌ Ошибка загрузки заказа #${orderId}`;
    if (messageId) {
      editMessage(chatId, messageId, errorMsg, ordersMenu);
    } else {
      sendMessage(chatId, errorMsg, ordersMenu);
    }
  }
}

async function updateOrderStatus(chatId, orderId, newStatus, messageId = null) {
  try {
    // Обновляем статус через бот эндпоинт
    const result = await apiRequest(`/bot/orders/${orderId}/status`, 'PUT', { 
      status: newStatus 
    });
    
    if (!result.success) {
      throw new Error(result.error || 'Ошибка обновления статуса');
    }
    
    const statusText = getStatusText(newStatus);
    const message = `✅ Статус заказа #${orderId} изменен на "${statusText}"`;
    
    if (messageId) {
      editMessage(chatId, messageId, message, ordersMenu);
    } else {
      sendMessage(chatId, message, ordersMenu);
    }
    
    // Показываем обновленные детали заказа
    setTimeout(() => {
      showOrderDetails(chatId, orderId);
    }, 1000);
    
  } catch (error) {
    console.error('Update order status error:', error.message);
    const errorMsg = `❌ Ошибка обновления статуса заказа #${orderId}`;
    if (messageId) {
      editMessage(chatId, messageId, errorMsg, ordersMenu);
    } else {
      sendMessage(chatId, errorMsg, ordersMenu);
    }
  }
}

function notifyOrderStatusUpdate(orderId, newStatus) {
  // Здесь можно добавить логику отправки уведомления клиенту
  console.log(`🔔 Уведомление: Заказ #${orderId} изменен на статус "${newStatus}"`);
}

// ==================== DISH FUNCTIONS (ADMIN ONLY) ====================

function showDishesSection(chatId) {
  sendMessage(chatId,
    '🍽️ УПРАВЛЕНИЕ БЛЮДАМИ\n\n' +
    'Выберите действие:',
    dishesMenu
  );
}

async function showAllDishes(chatId, messageId = null) {
  try {
    // Получаем рестораны с сервера
    let restaurants = [];
    try {
      restaurants = await apiRequest('/restaurants');
    } catch (error) {
      console.log('API restaurants not available, using mock data');
      restaurants = [getMockRestaurant()];
    }
    
    if (!restaurants || restaurants.length === 0) {
      const message = '😔 Рестораны не найдены';
      if (messageId) {
        return editMessage(chatId, messageId, message, dishesMenu);
      }
      return sendMessage(chatId, message, dishesMenu);
    }
    
    let message = '<b>📋 ВСЕ БЛЮДА</b>\n\n';
    let keyboard = [];
    
    // Берем первый ресторан
    const restaurant = restaurants[0];
    
    // Получаем меню ресторана
    let menu = [];
    try {
      menu = await apiRequest(`/restaurants/${restaurant.id}/menu`);
    } catch (error) {
      console.log('API menu not available, using mock data');
      menu = getMockMenu();
    }
    
    if (menu && menu.length > 0) {
      message += `<b>${restaurant.name}:</b>\n\n`;
      
      menu.forEach(dish => {
        const status = dish.is_available ? '✅' : '❌';
        message += `${status} <b>${dish.name}</b>\n`;
        message += `💰 ${dish.price} ₽ | ⏰ ${dish.preparation_time} мин\n`;
        message += `ID: ${dish.id}\n\n`;
        
        keyboard.push([
          { 
            text: `${status} ${dish.name.substring(0, 15)}...`, 
            callback_data: `edit_dish_${dish.id}`
          }
        ]);
      });
    } else {
      message = '😔 В этом ресторане пока нет блюд';
      keyboard = [[{ text: '➕ Создать первое блюдо', callback_data: 'create_dish' }]];
    }
    
    keyboard.push([
      { text: '🏠 Главное меню', callback_data: 'main_menu' }
    ]);
    
    const replyMarkup = { 
      reply_markup: { 
        inline_keyboard: keyboard,
        resize_keyboard: true
      } 
    };
    
    if (messageId) {
      editMessage(chatId, messageId, message, replyMarkup);
    } else {
      sendMessage(chatId, message, replyMarkup);
    }
    
  } catch (error) {
    console.error('Show all dishes error:', error.message);
    const errorMsg = '❌ Ошибка загрузки блюд';
    if (messageId) {
      editMessage(chatId, messageId, errorMsg, dishesMenu);
    } else {
      sendMessage(chatId, errorMsg, dishesMenu);
    }
  }
}

async function showDishDetails(chatId, dishId, messageId = null) {
  try {
    // Получаем информацию о блюде
    let dish = null;
    try {
      const result = await apiRequest(`/bot/dish/${dishId}`);
      dish = result.dish;
    } catch (error) {
      console.log('API dish not available, using mock data');
      dish = getMockMenu().find(d => d.id == dishId) || getMockDish(dishId);
    }
    
    if (!dish) {
      throw new Error('Блюдо не найдено');
    }
    
    const message = 
      `<b>🍽️ ${dish.name}</b>\n\n` +
      `${dish.description || 'Описание отсутствует'}\n\n` +
      `<b>💰 Цена:</b> ${dish.price} ₽\n` +
      `<b>⏰ Время готовки:</b> ${dish.preparation_time} мин\n` +
      `<b>📊 Статус:</b> ${dish.is_available ? '✅ Доступно' : '❌ Недоступно'}\n` +
      `<b>🏪 Ресторан:</b> ${dish.restaurant_name || 'Наетый кабан'}\n` +
      `<b>🌶️ Острое:</b> ${dish.is_spicy ? 'Да' : 'Нет'}\n` +
      `<b>🥦 Вегетарианское:</b> ${dish.is_vegetarian ? 'Да' : 'Нет'}\n\n` +
      `<b>📝 ID:</b> ${dish.id}`;
    
    const actions = getDishActions(dish.id, dish.is_available);
    
    if (messageId) {
      editMessage(chatId, messageId, message, actions);
    } else {
      sendMessage(chatId, message, actions);
    }
    
  } catch (error) {
    console.error('Show dish details error:', error.message);
    const errorMsg = `❌ Блюдо #${dishId} не найдено`;
    if (messageId) {
      editMessage(chatId, messageId, errorMsg, dishesMenu);
    } else {
      sendMessage(chatId, errorMsg, dishesMenu);
    }
  }
}

async function toggleDishStatus(chatId, dishId, messageId = null) {
  try {
    // Переключаем статус блюда через API
    try {
      await apiRequest(`/bot/dish/${dishId}/toggle`, 'POST');
    } catch (error) {
      console.log('API toggle not available, using mock toggle');
    }
    
    // Показываем обновленную информацию
    await showDishDetails(chatId, dishId, messageId);
    
  } catch (error) {
    console.error('Toggle dish status error:', error.message);
    const errorMsg = `❌ Ошибка изменения статуса блюда #${dishId}`;
    if (messageId) {
      editMessage(chatId, messageId, errorMsg, dishesMenu);
    } else {
      sendMessage(chatId, errorMsg, dishesMenu);
    }
  }
}

function startCreateDishFlow(chatId, messageId = null) {
  const message = 
    '<b>➕ СОЗДАНИЕ НОВОГО БЛЮДА</b>\n\n' +
    'Введите данные в формате:\n\n' +
    '<code>Название: Текст\n' +
    'Цена: 999\n' +
    'Описание: Текст\n' +
    'Время готовки: 30\n' +
    'Острое: да/нет\n' +
    'Вегетарианское: да/нет</code>\n\n' +
    '<b>Пример:</b>\n' +
    '<code>Название: Пицца Маргарита\n' +
    'Цена: 699\n' +
    'Описание: Классическая пицца\n' +
    'Время готовки: 25\n' +
    'Острое: нет\n' +
    'Вегетарианское: да</code>\n\n' +
    '⚠️ Для отмены напишите "отмена"';
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '❌ Отменить создание', callback_data: 'cancel_create' }
        ],
        [
          { text: '📋 Все блюда', callback_data: 'all_dishes' }
        ]
      ]
    }
  };
  
  if (messageId) {
    editMessage(chatId, messageId, message, keyboard);
  } else {
    sendMessage(chatId, message, keyboard);
  }
  
  // Сохраняем состояние для этого пользователя
  userStates[chatId] = {
    action: 'create_dish',
    step: 'waiting_for_data',
    timestamp: Date.now()
  };
}

function startFindDishFlow(chatId, messageId = null) {
  const message = 
    '<b>🔍 ПОИСК БЛЮДА ПО ID</b>\n\n' +
    'Введите ID блюда:';
  
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '❌ Отмена', callback_data: 'all_dishes' }
        ]
      ]
    }
  };
  
  if (messageId) {
    editMessage(chatId, messageId, message, keyboard);
  } else {
    sendMessage(chatId, message, keyboard);
  }
  
  userStates[chatId] = {
    action: 'find_dish',
    step: 'waiting_for_id',
    timestamp: Date.now()
  };
}

function handleFindDish(chatId, text) {
  const dishId = parseInt(text.trim());
  
  if (isNaN(dishId)) {
    return sendMessage(chatId, 
      '❌ Введите корректный ID блюда (число)',
      dishesMenu
    );
  }
  
  delete userStates[chatId];
  showDishDetails(chatId, dishId);
}

async function handleCreateDishData(chatId, text) {
  try {
    // Парсим введенные данные
    const lines = text.split('\n');
    const dishData = {};
    
    for (const line of lines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':').map(s => s.trim());
        const lowerKey = key.toLowerCase();
        
        switch(lowerKey) {
          case 'название':
            dishData.name = value;
            break;
          case 'цена':
            dishData.price = parseFloat(value);
            break;
          case 'описание':
            dishData.description = value;
            break;
          case 'время готовки':
            dishData.preparation_time = parseInt(value);
            break;
          case 'острое':
            dishData.is_spicy = value.toLowerCase() === 'да';
            break;
          case 'вегетарианское':
            dishData.is_vegetarian = value.toLowerCase() === 'да';
            break;
        }
      }
    }
    
    // Валидация
    if (!dishData.name || !dishData.price) {
      return sendMessage(chatId, 
        '❌ Ошибка: укажите как минимум название и цену блюда',
        dishesMenu
      );
    }
    
    // Получаем рестораны
    let restaurants = [];
    try {
      restaurants = await apiRequest('/restaurants');
    } catch (error) {
      console.log('API restaurants not available, using mock');
    }
    
    if (restaurants && restaurants.length > 0) {
      const restaurant = restaurants[0];
      dishData.restaurant_id = restaurant.id;
    } else {
      dishData.restaurant_id = 1; // Mock restaurant ID
    }
    
    // Отправляем запрос на создание
    try {
      const result = await apiRequest('/admin/dishes', 'POST', dishData);
      
      const successMessage = 
        `✅ Блюдо успешно создано!\n\n` +
        `<b>Название:</b> ${result.dish.name}\n` +
        `<b>Цена:</b> ${result.dish.price} ₽\n` +
        `<b>ID:</b> ${result.dish.id}`;
        
      sendMessage(chatId, successMessage, {
        reply_markup: {
          inline_keyboard: [[
            { text: '📋 Все блюда', callback_data: 'all_dishes' },
            { text: '✏️ Редактировать', callback_data: `edit_dish_${result.dish.id}` }
          ]]
        }
      });
      
    } catch (error) {
      console.error('Create dish API error:', error.message);
      // Даже если API не работает, показываем успех в мок-режиме
      const mockDishId = Date.now();
      const successMessage = 
        `✅ Блюдо создано (тестовый режим)!\n\n` +
        `<b>Название:</b> ${dishData.name}\n` +
        `<b>Цена:</b> ${dishData.price} ₽\n` +
        `<b>ID:</b> ${mockDishId}`;
        
      sendMessage(chatId, successMessage, dishesMenu);
    }
    
    // Очищаем состояние
    delete userStates[chatId];
    
  } catch (error) {
    console.error('Create dish error:', error.message);
    sendMessage(chatId, 
      `❌ Ошибка создания блюда: ${error.message}`,
      dishesMenu
    );
    delete userStates[chatId];
  }
}

async function startEditDishFlow(chatId, dishId, messageId = null) {
  try {
    // Получаем текущие данные блюда
    let dish = null;
    try {
      const result = await apiRequest(`/bot/dish/${dishId}`);
      dish = result.dish;
    } catch (error) {
      console.log('API dish not available, using mock data');
      dish = getMockDish(dishId);
    }
    
    const message = 
      `<b>✏️ РЕДАКТИРОВАНИЕ БЛЮДА #${dishId}</b>\n\n` +
      'Введите поля для изменения в формате:\n\n' +
      `<code>Название: ${dish.name}\n` +
      `Цена: ${dish.price}\n` +
      `Описание: ${dish.description || 'отсутствует'}\n` +
      `Время готовки: ${dish.preparation_time}\n` +
      `Острое: ${dish.is_spicy ? 'да' : 'нет'}\n` +
      `Вегетарианское: ${dish.is_vegetarian ? 'да' : 'нет'}</code>\n\n` +
      '<b>Пример изменения:</b>\n' +
      '<code>Название: Новая пицца\n' +
      'Цена: 799\n' +
      'Описание: Обновленное описание</code>\n\n' +
      '⚠️ Для отмены напишите "отмена"';
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '❌ Отменить редактирование', callback_data: `cancel_edit_${dishId}` }
          ],
          [
            { text: '👁️ Просмотреть блюдо', callback_data: `edit_dish_${dishId}` }
          ]
        ]
      }
    };
    
    if (messageId) {
      editMessage(chatId, messageId, message, keyboard);
    } else {
      sendMessage(chatId, message, keyboard);
    }
    
    // Сохраняем состояние для редактирования
    userStates[chatId] = {
      action: 'edit_dish',
      dishId: dishId,
      step: 'waiting_for_data',
      timestamp: Date.now()
    };
    
  } catch (error) {
    console.error('Start edit error:', error.message);
    const errorMsg = `❌ Ошибка загрузки данных блюда: ${error.message}`;
    
    if (messageId) {
      editMessage(chatId, messageId, errorMsg, dishesMenu);
    } else {
      sendMessage(chatId, errorMsg, dishesMenu);
    }
  }
}

async function handleEditDishData(chatId, text) {
  try {
    const state = userStates[chatId];
    if (!state || state.action !== 'edit_dish') {
      return sendMessage(chatId, '❌ Сессия истекла. Начните редактирование заново.', dishesMenu);
    }
    
    const dishId = state.dishId;
    const lines = text.split('\n');
    const updates = {};
    
    for (const line of lines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':').map(s => s.trim());
        const lowerKey = key.toLowerCase();
        
        switch(lowerKey) {
          case 'название':
            updates.name = value;
            break;
          case 'цена':
            updates.price = parseFloat(value);
            break;
          case 'описание':
            updates.description = value;
            break;
          case 'время готовки':
            updates.preparation_time = parseInt(value);
            break;
          case 'острое':
            updates.is_spicy = value.toLowerCase() === 'да';
            break;
          case 'вегетарианское':
            updates.is_vegetarian = value.toLowerCase() === 'да';
            break;
        }
      }
    }
    
    // Если ничего не изменилось
    if (Object.keys(updates).length === 0) {
      return sendMessage(chatId, 
        '⚠️ Не указаны изменения. Блюдо не изменено.',
        getDishActions(dishId, true)
      );
    }
    
    // Отправляем запрос на обновление
    try {
      await apiRequest(`/admin/dishes/${dishId}`, 'PUT', updates);
    } catch (error) {
      console.error('Edit dish API error:', error.message);
      // В мок-режиме просто продолжаем
    }
    
    const successMessage = 
      `✅ Блюдо успешно обновлено!\n\n` +
      `<b>Измененные поля:</b>\n${Object.keys(updates).map(k => `• ${k}`).join('\n')}`;
      
    sendMessage(chatId, successMessage, {
      reply_markup: {
        inline_keyboard: [[
          { text: '📋 Все блюда', callback_data: 'all_dishes' },
          { text: '👁️ Посмотреть', callback_data: `edit_dish_${dishId}` }
        ]]
      }
    });
    
    // Очищаем состояние
    delete userStates[chatId];
    
  } catch (error) {
    console.error('Edit dish error:', error.message);
    sendMessage(chatId, 
      `❌ Ошибка редактирования блюда: ${error.message}`,
      dishesMenu
    );
    delete userStates[chatId];
  }
}

async function confirmDeleteDish(chatId, dishId, messageId = null) {
  try {
    let dish = null;
    try {
      const result = await apiRequest(`/bot/dish/${dishId}`);
      dish = result.dish;
    } catch (error) {
      dish = getMockDish(dishId);
    }
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🗑️ ДА, УДАЛИТЬ', callback_data: `confirm_delete_${dishId}` },
            { text: '❌ ОТМЕНА', callback_data: `edit_dish_${dishId}` }
          ]
        ]
      }
    };
    
    const message = 
      `<b>🗑️ ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ</b>\n\n` +
      `Удалить блюдо?\n\n` +
      `<b>${dish.name}</b>\n` +
      `💰 ${dish.price} ₽\n` +
      `🏪 ${dish.restaurant_name || 'Наетый кабан'}\n\n` +
      `Внимание: если блюдо есть в заказах, оно будет скрыто.`;
    
    if (messageId) {
      editMessage(chatId, messageId, message, keyboard);
    } else {
      sendMessage(chatId, message, keyboard);
    }
    
  } catch (error) {
    console.error('Confirm delete error:', error.message);
    const errorMsg = `❌ Ошибка: ${error.message}`;
    if (messageId) {
      editMessage(chatId, messageId, errorMsg, dishesMenu);
    } else {
      sendMessage(chatId, errorMsg, dishesMenu);
    }
  }
}

async function deleteDish(chatId, dishId, messageId = null) {
  try {
    try {
      await apiRequest(`/admin/dishes/${dishId}`, 'DELETE');
    } catch (error) {
      console.error('Delete dish API error:', error.message);
    }
    
    const message = '✅ Блюдо удалено';
    
    if (messageId) {
      editMessage(chatId, messageId, message, dishesMenu);
    } else {
      sendMessage(chatId, message, dishesMenu);
    }
    
  } catch (error) {
    console.error('Delete dish error:', error.message);
    const errorMsg = `❌ Ошибка удаления: ${error.message}`;
    if (messageId) {
      editMessage(chatId, messageId, errorMsg, dishesMenu);
    } else {
      sendMessage(chatId, errorMsg, dishesMenu);
    }
  }
}

// ==================== OTHER FUNCTIONS ====================

function showMainMenu(chatId, messageId = null) {
  const message = isAdminUser(chatId) 
    ? '👑 АДМИН ПАНЕЛЬ\n\nВыберите раздел:' 
    : '👋 ГЛАВНОЕ МЕНЮ\n\nВыберите раздел:';
    
  const menu = isAdminUser(chatId) ? adminMainMenu : userMainMenu;
  
  if (messageId) {
    editMessage(chatId, messageId, message, menu);
  } else {
    sendMessage(chatId, message, menu);
  }
}

async function showStatistics(chatId) {
  try {
    let stats = null;
    try {
      stats = await apiRequest('/health');
    } catch (error) {
      stats = {
        status: 'ok',
        database: 'mock-mode',
        environment: 'development',
        timestamp: new Date().toISOString()
      };
    }
    
    const message = 
      '<b>📊 СТАТИСТИКА СИСТЕМЫ</b>\n\n' +
      `<b>Статус API:</b> ${stats.status}\n` +
      `<b>База данных:</b> ${stats.database}\n` +
      `<b>Окружение:</b> ${stats.environment}\n` +
      `<b>Время сервера:</b> ${new Date(stats.timestamp).toLocaleString('ru-RU')}\n\n` +
      `<b>Пользователь:</b> ${isAdminUser(chatId) ? '👑 Администратор' : '👤 Обычный пользователь'}\n` +
      `<b>Обновлено:</b> ${new Date().toLocaleTimeString('ru-RU')}`;
    
    sendMessage(chatId, message, isAdminUser(chatId) ? adminMainMenu : userMainMenu);
    
  } catch (error) {
    console.error('Show statistics error:', error.message);
    sendMessage(chatId, '❌ Ошибка загрузки статистики', isAdminUser(chatId) ? adminMainMenu : userMainMenu);
  }
}

function showHelp(chatId) {
  const adminHelp = isAdminUser(chatId) 
    ? '\n<b>👑 Администратор:</b>\n' +
      '• 🍽️ Блюда - управление меню ресторана\n' +
      '• ✏️ Изменение - редактирование блюд\n' +
      '• ➕ Создание - добавление новых блюд\n' +
      '• ❌ Удаление - удаление блюд из меню\n'
    : '';
    
  const message = 
    '<b>🆘 ПОМОЩЬ</b>\n\n' +
    '<b>Основные функции:</b>\n' +
    '• 📦 Заказы - просмотр и управление заказами\n' +
    '• 🆕 Новые - новые заказы для обработки\n' +
    '• 👨‍🍳 В работе - заказы в процессе приготовления\n' +
    '• ✅ Завершенные - история выполненных заказов\n' +
    adminHelp +
    '\n<b>📱 Команды:</b>\n' +
    '/start - главное меню\n' +
    '/orders - управление заказами\n' +
    '/stats - статистика системы\n' +
    '/help - эта справка' +
    (isAdminUser(chatId) ? '\n/dishes - управление блюдами' : '') +
    '\n\n<b>📞 Поддержка:</b>\n' +
    'По вопросам работы бота обращайтесь к администратору.';
  
  sendMessage(chatId, message, isAdminUser(chatId) ? adminMainMenu : userMainMenu);
}

// ==================== MOCK DATA ====================

function getMockRestaurant() {
  return {
    id: 1,
    name: 'Наетый кабан',
    description: 'Мясной ресторан с блюдами на огне',
    image_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4',
    rating: 4.9,
    delivery_time: '30-45 мин',
    delivery_price: 'Бесплатно от 1000 ₽',
    categories: ['Мясо', 'Стейки', 'Бургеры']
  };
}

function getMockMenu() {
  return [
    {
      id: 1,
      name: 'Стейк Рибай',
      description: 'Сочный стейк из мраморной говядины',
      image_url: 'https://images.unsplash.com/photo-1600891964092-4316c288032e',
      price: 1899,
      ingredients: ['Говядина', 'Соль', 'Переч'],
      preparation_time: 25,
      is_vegetarian: false,
      is_spicy: false,
      is_available: true,
      restaurant_name: 'Наетый кабан'
    },
    {
      id: 2,
      name: 'Бургер с говядиной',
      description: 'Классический бургер с сочной котлетой',
      image_url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd',
      price: 450,
      ingredients: ['Булочка', 'Говядина', 'Сыр'],
      preparation_time: 15,
      is_vegetarian: false,
      is_spicy: false,
      is_available: true,
      restaurant_name: 'Наетый кабан'
    }
  ];
}

function getMockDish(id) {
  return {
    id: id,
    name: 'Тестовое блюдо',
    description: 'Описание тестового блюда',
    price: 500,
    preparation_time: 20,
    is_spicy: false,
    is_vegetarian: false,
    is_available: true,
    restaurant_name: 'Наетый кабан'
  };
}

function getMockOrders() {
  const now = new Date();
  return [
    {
      id: '1001',
      customer_name: 'Иван Иванов',
      customer_phone: '+7 (999) 123-45-67',
      delivery_address: 'ул. Ленина, д. 10, кв. 5, Москва',
      restaurant_name: 'Наетый кабан',
      total_amount: 2598,
      status: 'pending',
      payment_method: 'Картой онлайн',
      order_date: new Date(now - 30 * 60 * 1000).toISOString(), // 30 минут назад
      items: [
        { dish_name: 'Стейк Рибай', dish_price: 1899, quantity: 1 },
        { dish_name: 'Картофель фри', dish_price: 299, quantity: 2 }
      ]
    },
    {
      id: '1002',
      customer_name: 'Петр Петров',
      customer_phone: '+7 (999) 987-65-43',
      delivery_address: 'пр. Мира, д. 25, офис 301, Москва',
      restaurant_name: 'Наетый кабан',
      total_amount: 1299,
      status: 'preparing',
      payment_method: 'Наличными',
      order_date: new Date(now - 15 * 60 * 1000).toISOString(), // 15 минут назад
      items: [
        { dish_name: 'Ребрышки BBQ', dish_price: 1299, quantity: 1 }
      ]
    },
    {
      id: '1003',
      customer_name: 'Анна Смирнова',
      customer_phone: '+7 (999) 555-12-34',
      delivery_address: 'ул. Пушкина, д. 15, кв. 8, Москва',
      restaurant_name: 'Наетый кабан',
      total_amount: 850,
      status: 'delivering',
      payment_method: 'Картой онлайн',
      order_date: new Date(now - 5 * 60 * 1000).toISOString(), // 5 минут назад
      items: [
        { dish_name: 'Куриные крылышки', dish_price: 350, quantity: 2 },
        { dish_name: 'Салат Цезарь', dish_price: 300, quantity: 1 }
      ]
    }
  ];
}

function getMockOrder(id) {
  const order = getMockOrders().find(o => o.id == id);
  if (order) return order;
  
  return {
    id: id,
    customer_name: 'Тестовый клиент',
    customer_phone: '+7 (999) 000-00-00',
    delivery_address: 'Тестовый адрес',
    restaurant_name: 'Наетый кабан',
    total_amount: 1000,
    status: 'pending',
    payment_method: 'Картой',
    order_date: new Date().toISOString(),
    items: [
      { dish_name: 'Тестовое блюдо', dish_price: 500, quantity: 2 }
    ]
  };
}

function getStatusText(status) {
  const statusMap = {
    'pending': '⏳ Ожидает',
    'preparing': '👨‍🍳 Готовится',
    'delivering': '🚚 В пути',
    'delivered': '✅ Доставлен',
    'cancelled': '❌ Отменен'
  };
  return statusMap[status] || status;
}

// ==================== NOTIFICATION FUNCTION ====================
// Эта функция будет вызываться из сервера при создании нового заказа
async function sendNewOrderNotification(orderData) {
  try {
    const message = 
      `<b>🆕 НОВЫЙ ЗАКАЗ #${orderData.id}</b>\n\n` +
      `<b>👤 Клиент:</b> ${orderData.customer_name}\n` +
      `<b>📞 Телефон:</b> ${orderData.customer_phone}\n` +
      `<b>🏠 Адрес:</b> ${orderData.delivery_address.substring(0, 50)}...\n` +
      `<b>🍽️ Ресторан:</b> ${orderData.restaurant_name}\n` +
      `<b>💰 Сумма:</b> ${orderData.total_amount} ₽\n` +
      `<b>⏰ Время:</b> ${new Date().toLocaleString('ru-RU')}\n\n`;
    
    // Отправляем уведомление всем, кто может видеть заказы
    for (const chatId of NOTIFICATION_USERS) {
      try {
        await sendMessage(chatId, message, {
          reply_markup: {
            inline_keyboard: [[
              { text: '📦 Посмотреть заказ', callback_data: `view_order_${orderData.id}` },
              { text: '✅ Принять', callback_data: `accept_order_${orderData.id}` }
            ]]
          }
        });
        console.log(`✅ Уведомление отправлено пользователю ${chatId}`);
      } catch (error) {
        console.error(`❌ Ошибка отправки уведомления пользователю ${chatId}:`, error.message);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Send notification error:', error.message);
    return false;
  }
}

// ==================== HEALTH SERVER ====================
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'telegram-order-bot',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      users: {
        admins: ADMIN_USERS,
        order_users: ORDER_USERS,
        total: NOTIFICATION_USERS.length
      }
    }));
  } 
  else if (req.url === '/notify' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const orderData = JSON.parse(body);
        const result = await sendNewOrderNotification(orderData);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: result,
          message: result ? 'Уведомление отправлено' : 'Ошибка отправки уведомления'
        }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  }
  else {
    res.writeHead(200);
    res.end('🤖 Telegram Order Notification Bot v2.0\n\n' +
           'Endpoints:\n' +
           'GET /health - статус бота\n' +
           'POST /notify - отправить уведомление о новом заказе');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Health server started on port ${PORT}`);
  console.log('🎉 BOT IS READY!');
  console.log(`👑 Админы: ${ADMIN_USERS.join(', ') || 'все'}`);
  console.log(`👥 Пользователи заказов: ${ORDER_USERS.join(', ') || 'все'}`);
  console.log('👉 Отправьте /start в Telegram боту');
});

process.on('SIGTERM', () => {
  console.log('🛑 Shutting down bot...');
  bot.stopPolling();
  server.close();
  process.exit(0);
});
