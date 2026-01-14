// bot-admin-panel.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const http = require('http');

console.log('🚀 Admin Panel Telegram Bot starting...');

// ==================== CONFIG ====================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE_URL = 'https://food-delivery-api-production-8385.up.railway.app';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || ''; // Для уведомлений о заказах

// Список администраторов
const ADMIN_USERS = process.env.ADMIN_USERS ? 
  process.env.ADMIN_USERS.split(',').map(id => parseInt(id.trim())) : 
  [];

// Проверка прав администратора
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
// Храним состояние для каждого пользователя
const userStates = new Map();

function getUserState(chatId) {
  if (!userStates.has(chatId)) {
    userStates.set(chatId, {
      mode: 'normal',
      editingDishId: null,
      creatingDish: null,
      editingRestaurantId: null,
      currentOrderPage: 0
    });
  }
  return userStates.get(chatId);
}

function setUserState(chatId, updates) {
  const state = getUserState(chatId);
  Object.assign(state, updates);
  userStates.set(chatId, state);
}

function resetUserState(chatId) {
  userStates.set(chatId, {
    mode: 'normal',
    editingDishId: null,
    creatingDish: null,
    editingRestaurantId: null,
    currentOrderPage: 0
  });
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

// ==================== KEYBOARDS & MENUS ====================

// Главное меню для админов
const adminMainMenu = {
  reply_markup: {
    keyboard: [
      ['🍽️ Управление блюдами', '🏪 Управление ресторанами'],
      ['📦 Управление заказами', '📊 Статистика'],
      ['⚙️ Админ-панель', '🆘 Помощь']
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};

// Меню управления блюдами
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

// Меню управления ресторанами
const restaurantsManagementMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📋 Список ресторанов', callback_data: 'restaurants_list' },
        { text: '➕ Новый ресторан', callback_data: 'restaurant_create' }
      ],
      [
        { text: '🍽️ Просмотреть меню', callback_data: 'restaurant_view_menu' }
      ],
      [
        { text: '🏠 Главное меню', callback_data: 'main_menu' }
      ]
    ]
  }
};

// Меню управления заказами
const ordersManagementMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🆕 Новые заказы', callback_data: 'orders_new' },
        { text: '⏳ В обработке', callback_data: 'orders_processing' }
      ],
      [
        { text: '🚚 Доставляются', callback_data: 'orders_delivering' },
        { text: '✅ Завершенные', callback_data: 'orders_completed' }
      ],
      [
        { text: '📊 Все заказы', callback_data: 'orders_all' }
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

// Меню действий с заказом
function createOrderActionsMenu(orderId, currentStatus) {
  const buttons = [];
  
  // В зависимости от текущего статуса показываем доступные действия
  switch(currentStatus) {
    case 'pending':
      buttons.push([
        { text: '✅ Подтвердить', callback_data: `order_confirm_${orderId}` },
        { text: '❌ Отменить', callback_data: `order_cancel_${orderId}` }
      ]);
      break;
    case 'confirmed':
      buttons.push([
        { text: '👨‍🍳 В приготовлении', callback_data: `order_prepare_${orderId}` }
      ]);
      break;
    case 'preparing':
      buttons.push([
        { text: '🚚 В доставке', callback_data: `order_deliver_${orderId}` }
      ]);
      break;
    case 'delivering':
      buttons.push([
        { text: '✅ Доставлен', callback_data: `order_delivered_${orderId}` }
      ]);
      break;
  }
  
  buttons.push([
    { text: '📋 Все заказы', callback_data: 'orders_all' },
    { text: '🏠 Главное меню', callback_data: 'main_menu' }
  ]);
  
  return {
    reply_markup: {
      inline_keyboard: buttons
    }
  };
}

// Клавиатура отмены
const cancelKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '❌ Отмена', callback_data: 'cancel_action' }]
    ]
  }
};

// ==================== COMMAND HANDLERS ====================

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const isAdmin = isAdminUser(chatId);
  
  if (!isAdmin) {
    return bot.sendMessage(chatId,
      '⛔ У вас нет доступа к админ-панели.\n' +
      'Обратитесь к администратору.',
      { parse_mode: 'Markdown' }
    );
  }
  
  console.log(`👑 Admin start from ${chatId}`);
  resetUserState(chatId);
  
  bot.sendMessage(chatId,
    '👑 *Административная панель*\n\n' +
    'Выберите раздел для управления:',
    { 
      parse_mode: 'Markdown',
      reply_markup: adminMainMenu.reply_markup 
    }
  );
});

// /orders - быстрый доступ к заказам
bot.onText(/\/orders/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdminUser(chatId)) return;
  
  showOrdersMenu(chatId);
});

// ==================== TEXT MESSAGE HANDLERS ====================

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const isAdmin = isAdminUser(chatId);
  
  if (!isAdmin || !text || text.startsWith('/')) return;
  
  const state = getUserState(chatId);
  
  console.log(`💬 Admin message from ${chatId}: ${text} | Mode: ${state.mode}`);
  
  // Обработка в зависимости от режима
  switch(state.mode) {
    case 'creating_dish':
      await handleDishCreation(chatId, text, state);
      break;
      
    case 'editing_dish_name':
    case 'editing_dish_description':
    case 'editing_dish_price':
    case 'editing_dish_prep_time':
      await handleDishEditing(chatId, text, state);
      break;
      
    case 'searching_dish':
      await handleDishSearch(chatId, text);
      break;
      
    default:
      // Обработка главного меню
      handleMainMenu(chatId, text);
  }
});

function handleMainMenu(chatId, text) {
  switch(text) {
    case '🍽️ Управление блюдами':
      showDishesManagementMenu(chatId);
      break;
      
    case '🏪 Управление ресторанами':
      showRestaurantsManagementMenu(chatId);
      break;
      
    case '📦 Управление заказами':
      showOrdersMenu(chatId);
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
      bot.sendMessage(chatId, 'Используйте меню для навигации', adminMainMenu);
  }
}

// ==================== CALLBACK QUERY HANDLERS ====================

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  
  if (!isAdminUser(chatId)) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Нет доступа' });
    return;
  }
  
  console.log(`🔘 Admin callback from ${chatId}: ${data}`);
  
  await bot.answerCallbackQuery(callbackQuery.id);
  
  // Обработка callback данных
  if (data === 'main_menu') {
    showMainMenu(chatId, messageId);
    
  } else if (data === 'dishes_list') {
    showAllDishes(chatId, messageId);
    
  } else if (data === 'dish_create') {
    startDishCreation(chatId, messageId);
    
  } else if (data === 'dish_search') {
    startDishSearch(chatId, messageId);
    
  } else if (data.startsWith('dish_toggle_')) {
    const dishId = data.replace('dish_toggle_', '');
    toggleDishAvailability(chatId, dishId, messageId);
    
  } else if (data.startsWith('dish_edit_')) {
    const dishId = data.replace('dish_edit_', '');
    startDishEditing(chatId, dishId, messageId);
    
  } else if (data.startsWith('dish_delete_')) {
    const dishId = data.replace('dish_delete_', '');
    confirmDishDeletion(chatId, dishId, messageId);
    
  } else if (data.startsWith('dish_field_')) {
    const [_, dishId, field] = data.split('_');
    startEditDishField(chatId, dishId, field, messageId);
    
  } else if (data === 'orders_new') {
    showOrdersByStatus(chatId, 'pending', messageId);
    
  } else if (data === 'orders_processing') {
    showOrdersByStatus(chatId, 'confirmed', messageId);
    
  } else if (data.startsWith('order_')) {
    handleOrderAction(chatId, data, messageId);
    
  } else if (data === 'cancel_action') {
    cancelCurrentAction(chatId, messageId);
    
  } else if (data.startsWith('confirm_delete_')) {
    const dishId = data.replace('confirm_delete_', '');
    deleteDish(chatId, dishId, messageId);
  }
});

// ==================== DISH MANAGEMENT FUNCTIONS ====================

// Показать меню управления блюдами
function showDishesManagementMenu(chatId, messageId = null) {
  const message = '🍽️ *Управление блюдами*\n\n' +
    'Выберите действие:';
  
  updateOrSend(chatId, messageId, message, dishesManagementMenu);
}

// Показать все блюда
async function showAllDishes(chatId, messageId = null) {
  try {
    await bot.sendChatAction(chatId, 'typing');
    
    const restaurants = await callAPI('/restaurants');
    
    if (!restaurants || restaurants.length === 0) {
      return updateOrSend(chatId, messageId, 
        '😔 Рестораны не найдены. Сначала добавьте ресторан.',
        dishesManagementMenu
      );
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
                text: `${status} ${dish.name}`, 
                callback_data: `dish_edit_${dish.id}` 
              }
            ]);
          });
          
          message += '\n';
        }
      } catch (error) {
        console.error(`Error loading menu:`, error.message);
      }
    }
    
    if (dishesKeyboard.length === 0) {
      message = '😔 Блюда не найдены. Создайте первое блюдо.';
      dishesKeyboard = [[{ text: '➕ Новое блюдо', callback_data: 'dish_create' }]];
    }
    
    dishesKeyboard.push([{ text: '🔙 Назад', callback_data: 'main_menu' }]);
    
    const keyboard = { reply_markup: { inline_keyboard: dishesKeyboard } };
    
    updateOrSend(chatId, messageId, message, keyboard);
    
  } catch (error) {
    const errorMessage = '❌ Ошибка при загрузке блюд';
    updateOrSend(chatId, messageId, errorMessage, dishesManagementMenu);
  }
}

// Начать создание блюда
async function startDishCreation(chatId, messageId = null) {
  try {
    // Получаем список ресторанов для выбора
    const restaurants = await callAPI('/restaurants');
    
    if (!restaurants || restaurants.length === 0) {
      return updateOrSend(chatId, messageId,
        '❌ Нет ресторанов. Сначала создайте ресторан.',
        dishesManagementMenu
      );
    }
    
    // Создаем клавиатуру с ресторанами
    let restaurantsKeyboard = restaurants.map(rest => [
      { text: rest.name, callback_data: `create_dish_in_${rest.id}` }
    ]);
    
    restaurantsKeyboard.push([{ text: '❌ Отмена', callback_data: 'cancel_action' }]);
    
    const keyboard = { reply_markup: { inline_keyboard: restaurantsKeyboard } };
    
    updateOrSend(chatId, messageId,
      '🏪 *Выберите ресторан для нового блюда:*',
      keyboard
    );
    
  } catch (error) {
    updateOrSend(chatId, messageId,
      '❌ Ошибка при загрузке ресторанов',
      dishesManagementMenu
    );
  }
}

// Обработка выбора ресторана для создания блюда
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  
  if (!data.startsWith('create_dish_in_')) return;
  
  await bot.answerCallbackQuery(callbackQuery.id);
  
  const restaurantId = data.replace('create_dish_in_', '');
  
  // Устанавливаем состояние создания блюда
  setUserState(chatId, {
    mode: 'creating_dish',
    creatingDish: {
      restaurant_id: restaurantId,
      step: 'name'
    }
  });
  
  updateOrSend(chatId, messageId,
    '🍽️ *Создание нового блюда*\n\n' +
    'Введите название блюда:',
    cancelKeyboard
  );
});

// Обработка создания блюда по шагам
async function handleDishCreation(chatId, text, state) {
  const dishData = state.creatingDish;
  
  switch(dishData.step) {
    case 'name':
      dishData.name = text;
      dishData.step = 'description';
      
      setUserState(chatId, { creatingDish: dishData });
      
      bot.sendMessage(chatId,
        '📝 Введите описание блюда:',
        cancelKeyboard
      );
      break;
      
    case 'description':
      dishData.description = text;
      dishData.step = 'price';
      
      setUserState(chatId, { creatingDish: dishData });
      
      bot.sendMessage(chatId,
        '💰 Введите цену блюда (только число, например: 350):',
        cancelKeyboard
      );
      break;
      
    case 'price':
      const price = parseFloat(text);
      if (isNaN(price) || price <= 0) {
        return bot.sendMessage(chatId,
          '❌ Неверная цена. Введите число больше 0:',
          cancelKeyboard
        );
      }
      
      dishData.price = price;
      dishData.step = 'prep_time';
      
      setUserState(chatId, { creatingDish: dishData });
      
      bot.sendMessage(chatId,
        '⏱️ Введите время приготовления в минутах (например: 25):',
        cancelKeyboard
      );
      break;
      
    case 'prep_time':
      const prepTime = parseInt(text);
      if (isNaN(prepTime) || prepTime <= 0) {
        return bot.sendMessage(chatId,
          '❌ Неверное время. Введите число больше 0:',
          cancelKeyboard
        );
      }
      
      dishData.preparation_time = prepTime;
      
      // Создаем блюдо
      try {
        const newDish = {
          restaurant_id: dishData.restaurant_id,
          name: dishData.name,
          description: dishData.description,
          price: dishData.price,
          preparation_time: dishData.preparation_time,
          ingredients: [],
          is_vegetarian: false,
          is_spicy: false
        };
        
        const result = await callAPI('/admin/dishes', 'POST', newDish);
        
        resetUserState(chatId);
        
        bot.sendMessage(chatId,
          `✅ Блюдо "${result.dish.name}" успешно создано!\n\n` +
          `💰 Цена: ${result.dish.price} ₽\n` +
          `⏱️ Время приготовления: ${result.dish.preparation_time} мин\n\n` +
          `ID: ${result.dish.id}`,
          dishesManagementMenu
        );
        
      } catch (error) {
        resetUserState(chatId);
        bot.sendMessage(chatId,
          `❌ Ошибка при создании блюда: ${error.message}`,
          dishesManagementMenu
        );
      }
      break;
  }
}

// Начать редактирование блюда
async function startDishEditing(chatId, dishId, messageId = null) {
  try {
    const result = await callAPI(`/bot/dish/${dishId}`);
    const dish = result.dish;
    
    // Сохраняем ID редактируемого блюда
    setUserState(chatId, { editingDishId: dishId });
    
    const message = 
      `🍽️ *${dish.name}*\n\n` +
      `📝 ${dish.description}\n\n` +
      `💰 Цена: ${dish.price} ₽\n` +
      `⏱️ Время приготовления: ${dish.preparation_time} мин\n` +
      `📊 Статус: ${dish.is_available ? '✅ Доступно' : '❌ Недоступно'}\n` +
      `🌶️ Острое: ${dish.is_spicy ? 'Да' : 'Нет'}\n` +
      `🥦 Вегетарианское: ${dish.is_vegetarian ? 'Да' : 'Нет'}\n\n` +
      `🆔 ID: ${dish.id}`;
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✏️ Название', callback_data: `dish_field_${dishId}_name` },
            { text: '📝 Описание', callback_data: `dish_field_${dishId}_description` }
          ],
          [
            { text: '💰 Цена', callback_data: `dish_field_${dishId}_price` },
            { text: '⏱️ Время', callback_data: `dish_field_${dishId}_prep_time` }
          ],
          [
            { text: '🌶️ Острота', callback_data: `dish_field_${dishId}_spicy` },
            { text: '🥦 Вегетарианское', callback_data: `dish_field_${dishId}_vegetarian` }
          ],
          [
            { text: '📋 Список блюд', callback_data: 'dishes_list' },
            { text: '🏠 Главное меню', callback_data: 'main_menu' }
          ]
        ]
      }
    };
    
    updateOrSend(chatId, messageId, message, keyboard);
    
  } catch (error) {
    updateOrSend(chatId, messageId,
      `❌ Ошибка загрузки блюда: ${error.message}`,
      dishesManagementMenu
    );
  }
}

// Начать редактирование поля блюда
function startEditDishField(chatId, dishId, field, messageId = null) {
  const fieldNames = {
    'name': 'название',
    'description': 'описание',
    'price': 'цену',
    'prep_time': 'время приготовления',
    'spicy': 'остроту (да/нет)',
    'vegetarian': 'вегетарианское (да/нет)'
  };
  
  const modeMap = {
    'name': 'editing_dish_name',
    'description': 'editing_dish_description',
    'price': 'editing_dish_price',
    'prep_time': 'editing_dish_prep_time',
    'spicy': 'editing_dish_spicy',
    'vegetarian': 'editing_dish_vegetarian'
  };
  
  setUserState(chatId, {
    mode: modeMap[field],
    editingDishId: dishId
  });
  
  updateOrSend(chatId, messageId,
    `✏️ Введите новое значение для ${fieldNames[field]}:`,
    cancelKeyboard
  );
}

// Обработка редактирования полей блюда
async function handleDishEditing(chatId, text, state) {
  const dishId = state.editingDishId;
  const mode = state.mode;
  
  let updateData = {};
  let fieldName = '';
  
  switch(mode) {
    case 'editing_dish_name':
      updateData.name = text;
      fieldName = 'название';
      break;
      
    case 'editing_dish_description':
      updateData.description = text;
      fieldName = 'описание';
      break;
      
    case 'editing_dish_price':
      const price = parseFloat(text);
      if (isNaN(price) || price <= 0) {
        return bot.sendMessage(chatId,
          '❌ Неверная цена. Введите число больше 0:',
          cancelKeyboard
        );
      }
      updateData.price = price;
      fieldName = 'цену';
      break;
      
    case 'editing_dish_prep_time':
      const prepTime = parseInt(text);
      if (isNaN(prepTime) || prepTime <= 0) {
        return bot.sendMessage(chatId,
          '❌ Неверное время. Введите число больше 0:',
          cancelKeyboard
        );
      }
      updateData.preparation_time = prepTime;
      fieldName = 'время приготовления';
      break;
      
    case 'editing_dish_spicy':
      updateData.is_spicy = text.toLowerCase() === 'да';
      fieldName = 'остроту';
      break;
      
    case 'editing_dish_vegetarian':
      updateData.is_vegetarian = text.toLowerCase() === 'да';
      fieldName = 'вегетарианское';
      break;
  }
  
  try {
    const result = await callAPI(`/admin/dishes/${dishId}`, 'PUT', updateData);
    
    resetUserState(chatId);
    
    bot.sendMessage(chatId,
      `✅ ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} успешно обновлено!`,
      dishesManagementMenu
    );
    
  } catch (error) {
    resetUserState(chatId);
    bot.sendMessage(chatId,
      `❌ Ошибка при обновлении: ${error.message}`,
      dishesManagementMenu
    );
  }
}

// Подтверждение удаления блюда
async function confirmDishDeletion(chatId, dishId, messageId = null) {
  try {
    const result = await callAPI(`/bot/dish/${dishId}`);
    const dish = result.dish;
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Да, удалить', callback_data: `confirm_delete_${dishId}` },
            { text: '❌ Нет, отмена', callback_data: `dish_edit_${dishId}` }
          ]
        ]
      }
    };
    
    updateOrSend(chatId, messageId,
      `🗑️ *Подтверждение удаления*\n\n` +
      `Вы уверены, что хотите удалить блюдо?\n\n` +
      `🍽️ ${dish.name}\n` +
      `💰 ${dish.price} ₽\n` +
      `🏪 ${dish.restaurant_name}\n\n` +
      `⚠️ Если блюдо есть в заказах, оно будет сделано недоступным.`,
      keyboard
    );
    
  } catch (error) {
    updateOrSend(chatId, messageId,
      `❌ Ошибка: ${error.message}`,
      dishesManagementMenu
    );
  }
}

// Удаление блюда
async function deleteDish(chatId, dishId, messageId = null) {
  try {
    const result = await callAPI(`/admin/dishes/${dishId}`, 'DELETE');
    
    let message = `✅ Блюдо успешно ${result.soft_delete ? 'сделано недоступным' : 'удалено'}`;
    
    if (result.dish) {
      message += `\n\n🍽️ "${result.dish.name}"`;
    }
    
    updateOrSend(chatId, messageId, message, dishesManagementMenu);
    
  } catch (error) {
    updateOrSend(chatId, messageId,
      `❌ Ошибка удаления: ${error.message}`,
      dishesManagementMenu
    );
  }
}

// Переключение доступности блюда
async function toggleDishAvailability(chatId, dishId, messageId = null) {
  try {
    const result = await callAPI(`/bot/dish/${dishId}/toggle`, 'POST');
    
    const status = result.dish.is_available ? '✅ Доступно' : '❌ Недоступно';
    const message = `🔄 Статус блюда изменен на: ${status}`;
    
    // Обновляем сообщение с новой информацией
    startDishEditing(chatId, dishId, messageId);
    
  } catch (error) {
    updateOrSend(chatId, messageId,
      `❌ Ошибка: ${error.message}`,
      dishesManagementMenu
    );
  }
}

// ==================== ORDER MANAGEMENT FUNCTIONS ====================

// Показать меню управления заказами
function showOrdersMenu(chatId, messageId = null) {
  const message = '📦 *Управление заказами*\n\n' +
    'Выберите статус заказов для просмотра:';
  
  updateOrSend(chatId, messageId, message, ordersManagementMenu);
}

// Показать заказы по статусу
async function showOrdersByStatus(chatId, status, messageId = null) {
  try {
    await bot.sendChatAction(chatId, 'typing');
    
    const orders = await callAPI(`/admin/orders?status=${status}&limit=10`);
    
    if (!orders || orders.length === 0) {
      const statusText = getStatusText(status);
      return updateOrSend(chatId, messageId,
        `😔 ${statusText} заказов нет.`,
        ordersManagementMenu
      );
    }
    
    let message = `${getStatusEmoji(status)} *${getStatusText(status)} заказы*\n\n`;
    
    orders.forEach((order, index) => {
      message += 
        `*Заказ #${order.id}*\n` +
        `👤 ${order.user_name || 'Клиент'} | 📞 ${order.user_phone || 'Нет телефона'}\n` +
        `🏪 ${order.restaurant_name}\n` +
        `💰 ${order.total_amount} ₽\n` +
        `📍 ${order.delivery_address}\n` +
        `🕐 ${new Date(order.order_date).toLocaleTimeString()}\n`;
      
      // Кратко о блюдах
      if (order.items && order.items.length > 0) {
        const itemsText = order.items.slice(0, 2).map(item => 
          `${item.dish_name} x${item.quantity}`
        ).join(', ');
        
        message += `🍽️ ${itemsText}`;
        if (order.items.length > 2) {
          message += ` и ещё ${order.items.length - 2}`;
        }
        message += '\n';
      }
      
      message += `🔘 [Управление](#)\n\n`;
    });
    
    // Создаем клавиатуру с заказами
    let ordersKeyboard = orders.map(order => [
      { text: `📦 Заказ #${order.id} - ${order.total_amount} ₽`, 
        callback_data: `order_view_${order.id}` }
    ]);
    
    ordersKeyboard.push([{ text: '🔙 Назад к заказам', callback_data: 'main_menu' }]);
    
    const keyboard = { reply_markup: { inline_keyboard: ordersKeyboard } };
    
    // Удаляем ссылки-заглушки из сообщения
    message = message.replace(/🔘 \[Управление\]\(#\)\n\n/g, '');
    
    updateOrSend(chatId, messageId, message, keyboard);
    
  } catch (error) {
    updateOrSend(chatId, messageId,
      `❌ Ошибка загрузки заказов: ${error.message}`,
      ordersManagementMenu
    );
  }
}

// Показать детали заказа
async function showOrderDetails(chatId, orderId, messageId = null) {
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
      `📦 *Заказ #${order.id}*\n\n` +
      `👤 *Клиент:* ${order.user_name || 'Не указано'}\n` +
      `📞 *Телефон:* ${order.user_phone || 'Не указано'}\n` +
      `🏪 *Ресторан:* ${order.restaurant_name}\n` +
      `📍 *Адрес:* ${order.delivery_address}\n` +
      `💳 *Оплата:* ${order.payment_method}\n` +
      `📊 *Статус:* ${getStatusEmoji(order.status)} ${getStatusText(order.status)}\n` +
      `🕐 *Создан:* ${new Date(order.order_date).toLocaleString()}\n\n` +
      `🍽️ *Состав заказа:*\n`;
    
    if (order.items && order.items.length > 0) {
      order.items.forEach(item => {
        message += `• ${item.dish_name} x${item.quantity} - ${item.dish_price * item.quantity} ₽\n`;
      });
    }
    
    message += `\n💰 *Итого:* ${order.total_amount} ₽`;
    
    const actionsMenu = createOrderActionsMenu(order.id, order.status);
    
    updateOrSend(chatId, messageId, message, actionsMenu);
    
  } catch (error) {
    updateOrSend(chatId, messageId,
      `❌ Ошибка загрузки заказа: ${error.message}`,
      ordersManagementMenu
    );
  }
}

// Обработка действий с заказом
async function handleOrderAction(chatId, actionData, messageId = null) {
  const [action, orderId] = actionData.split('_').slice(1);
  
  const statusMap = {
    'confirm': 'confirmed',
    'cancel': 'cancelled',
    'prepare': 'preparing',
    'deliver': 'delivering',
    'delivered': 'delivered'
  };
  
  const newStatus = statusMap[action];
  
  if (!newStatus) {
    if (action === 'view') {
      return showOrderDetails(chatId, orderId, messageId);
    }
    return;
  }
  
  try {
    const result = await callAPI(`/admin/orders/${orderId}/status`, 'PUT', {
      status: newStatus
    });
    
    bot.sendMessage(chatId,
      `✅ Статус заказа #${orderId} изменен на "${getStatusText(newStatus)}"`,
      ordersManagementMenu
    );
    
    // Обновляем сообщение с деталями заказа
    showOrderDetails(chatId, orderId, messageId);
    
  } catch (error) {
    updateOrSend(chatId, messageId,
      `❌ Ошибка обновления статуса: ${error.message}`,
      ordersManagementMenu
    );
  }
}

// Вспомогательные функции для статусов
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
    'preparing': 'В приготовлении',
    'delivering': 'В доставке',
    'delivered': 'Доставленные',
    'cancelled': 'Отмененные'
  };
  return texts[status] || status;
}

// ==================== HELPER FUNCTIONS ====================

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

function cancelCurrentAction(chatId, messageId = null) {
  resetUserState(chatId);
  updateOrSend(chatId, messageId, '❌ Действие отменено.', adminMainMenu);
}

// Показать главное меню
function showMainMenu(chatId, messageId = null) {
  resetUserState(chatId);
  const message = '👑 *Административная панель*\n\nВыберите раздел:';
  updateOrSend(chatId, messageId, message, adminMainMenu);
}

// Показать статистику
async function showStatistics(chatId) {
  try {
    await bot.sendChatAction(chatId, 'typing');
    
    const orders = await callAPI('/admin/orders');
    const restaurants = await callAPI('/restaurants');
    
    // Подсчет статистики
    const stats = {
      totalOrders: orders.length,
      pendingOrders: orders.filter(o => o.status === 'pending').length,
      totalRevenue: orders.reduce((sum, o) => sum + parseFloat(o.total_amount), 0),
      totalRestaurants: restaurants.length,
      totalDishes: 0
    };
    
    // Подсчет блюд
    for (const restaurant of restaurants) {
      try {
        const menu = await callAPI(`/restaurants/${restaurant.id}/menu`);
        stats.totalDishes += menu?.length || 0;
      } catch (error) {
        // Пропускаем ошибки
      }
    }
    
    const message = 
      '📊 *Статистика системы*\n\n' +
      `📦 Всего заказов: ${stats.totalOrders}\n` +
      `🆕 Новых заказов: ${stats.pendingOrders}\n` +
      `💰 Общая выручка: ${stats.totalRevenue.toFixed(2)} ₽\n` +
      `🏪 Ресторанов: ${stats.totalRestaurants}\n` +
      `🍽️ Блюд в системе: ${stats.totalDishes}\n\n` +
      `🔄 Обновлено: ${new Date().toLocaleTimeString()}`;
    
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: adminMainMenu.reply_markup
    });
    
  } catch (error) {
    bot.sendMessage(chatId, '❌ Ошибка загрузки статистики', adminMainMenu);
  }
}

// Показать админ-панель
function showAdminPanel(chatId) {
  const message = 
    '⚙️ *Административная панель*\n\n' +
    `🔗 API: ${API_BASE_URL}\n` +
    `👑 Админы: ${ADMIN_USERS.join(', ') || 'Все пользователи'}\n` +
    `🤖 Бот: @${bot.options.username}\n\n` +
    `🔄 Последний запуск: ${new Date().toLocaleString()}`;
  
  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: adminMainMenu.reply_markup
  });
}

// Показать помощь
function showHelp(chatId) {
  const message = 
    '🆘 *Помощь администратору*\n\n' +
    '*Основные функции:*\n' +
    '• 🍽️ Управление блюдами (создание, редактирование, удаление)\n' +
    '• 📦 Управление заказами (подтверждение, отслеживание)\n' +
    '• 📊 Просмотр статистики\n\n' +
    '*Быстрые команды:*\n' +
    '/start - Главное меню\n' +
    '/orders - Управление заказами\n\n' +
    '*Как работать:*\n' +
    '1. Используйте кнопки меню\n' +
    '2. Следуйте инструкциям бота\n' +
    '3. Для отмены действия нажмите "Отмена"';
  
  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: adminMainMenu.reply_markup
  });
}

// ==================== ORDER NOTIFICATION SYSTEM ====================

// Функция для отправки уведомлений о новых заказах
async function notifyAboutNewOrder(order) {
  try {
    // Отправляем всем администраторам
    for (const adminId of ADMIN_USERS) {
      try {
        const message = 
          `🆕 *Новый заказ!* #${order.id}\n\n` +
          `🏪 ${order.restaurant_name}\n` +
          `💰 ${order.total_amount} ₽\n` +
          `📍 ${order.delivery_address}\n` +
          `🕐 ${new Date(order.order_date).toLocaleTimeString()}\n\n` +
          `Для управления: /orders`;
        
        await bot.sendMessage(adminId, message, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '📦 Управление заказами', callback_data: 'orders_new' }
            ]]
          }
        });
      } catch (error) {
        console.error(`Failed to notify admin ${adminId}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Order notification error:', error);
  }
}

// Эндпоинт для приема уведомлений о заказах
const express = require('express');
const notificationApp = express();
notificationApp.use(express.json());

notificationApp.post('/webhook/new-order', async (req, res) => {
  try {
    const { order } = req.body;
    
    if (!order) {
      return res.status(400).json({ error: 'No order data' });
    }
    
    console.log('📦 New order received via webhook:', order.id);
    
    // Отправляем уведомление в Telegram
    await notifyAboutNewOrder(order);
    
    res.json({ success: true, notified: true });
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Notification failed' });
  }
});

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
      service: 'admin-telegram-bot',
      admins: ADMIN_USERS,
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(200);
    res.end('🤖 Admin Telegram Bot is running');
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`✅ Health server on port ${PORT}`);
  console.log('🎉 Admin bot is ready!');
  
  // Запускаем сервер уведомлений на другом порту
  const NOTIFICATION_PORT = process.env.NOTIFICATION_PORT || 8081;
  notificationApp.listen(NOTIFICATION_PORT, () => {
    console.log(`✅ Notification server on port ${NOTIFICATION_PORT}`);
    console.log(`📨 Webhook URL: http://your-domain:${NOTIFICATION_PORT}/webhook/new-order`);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down...');
  bot.stopPolling();
  server.close();
  process.exit(0);
});
