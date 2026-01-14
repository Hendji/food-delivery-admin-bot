require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const http = require('http');

console.log('🚀 ADMIN BOT FINAL Starting...');

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

// ==================== USER STATE MANAGEMENT ====================
const userStates = {};

// ==================== BOT SETUP ====================
const bot = new TelegramBot(TELEGRAM_TOKEN, {
  polling: {
    interval: 2000,  // Увеличиваем интервал
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

// Обработка конфликтов
bot.on('polling_error', (error) => {
  if (error.message.includes('409 Conflict')) {
    console.log('⚠️  Другой бот запущен. Остановите локальные процессы.');
  } else {
    console.error('🔴 Polling error:', error.message);
  }
});

// ==================== IMPROVED MESSAGE FUNCTIONS ====================
// Кэш последних сообщений для избежания "message is not modified"
const lastMessages = new Map();

function sendMessage(chatId, text, options = {}) {
  // Проверяем, не отправляли ли мы уже такое сообщение
  const messageKey = `${chatId}:${text.substring(0, 50)}`;
  const lastMessage = lastMessages.get(messageKey);
  
  if (lastMessage && Date.now() - lastMessage < 5000) {
    console.log('⚠️  Пропускаем дублирующее сообщение');
    return Promise.resolve();
  }
  
  lastMessages.set(messageKey, Date.now());
  
  // Очистка старых записей
  setTimeout(() => lastMessages.delete(messageKey), 10000);
  
  return bot.sendMessage(chatId, text, {
    ...options,
    parse_mode: undefined // Отключаем Markdown для безопасности
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
    parse_mode: undefined
  }).catch(error => {
    // Если сообщение не изменилось - это нормально, не считаем ошибкой
    if (error.message.includes('message is not modified')) {
      console.log('ℹ️  Сообщение не изменилось (ожидаемо)');
      return null;
    }
    console.error('Edit message error:', error.message);
    // При серьезной ошибке отправляем новое сообщение
    return sendMessage(chatId, text, options);
  });
}

// ==================== KEYBOARDS ====================

const adminMainMenu = {
  reply_markup: {
    keyboard: [
      ['🍽️ Блюда', '📦 Заказы'],
      ['📊 Статистика', '⚙️ Админ'],
      ['🆘 Помощь']
    ],
    resize_keyboard: true
  }
};

const dishesMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📋 Все блюда', callback_data: 'all_dishes' },
        { text: '➕ Создать', callback_data: 'create_dish' }
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

const ordersMenu = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🆕 Новые', callback_data: 'new_orders' },
        { text: '✅ Подтвержденные', callback_data: 'confirmed_orders' }
      ],
      [
        { text: '👨‍🍳 Готовятся', callback_data: 'preparing_orders' }
      ],
      [
        { text: '🏠 Главное меню', callback_data: 'main_menu' }
      ]
    ]
  }
};

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

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  if (!isAdminUser(chatId)) {
    return sendMessage(chatId, '⛔ Нет доступа к админ-панели.');
  }
  
  console.log(`👑 Admin start: ${chatId}`);
  
  sendMessage(chatId,
    '👑 АДМИН ПАНЕЛЬ\n\n' +
    'Доступные разделы:',
    adminMainMenu
  );
});

bot.onText(/\/orders/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdminUser(chatId)) return;
  
  showOrdersSection(chatId);
});

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
    
    console.log(`💬 Message: ${chatId} -> ${text}`);
    
    // Проверяем состояние пользователя
    const state = userStates[chatId];
    
    if (state) {
        // Пользователь находится в процессе создания/редактирования
        if (state.action === 'create_dish' && state.step === 'waiting_for_data') {
            handleCreateDishData(chatId, text);
            return;
        }
        
        if (state.action === 'edit_dish' && state.step === 'waiting_for_data') {
            handleEditDishData(chatId, text);
            return;
        }
    }
    
    // Существующая логика меню
    switch(text) {
        case '🍽️ Блюда':
            showDishesSection(chatId);
            break;
        case '📦 Заказы':
            showOrdersSection(chatId);
            break;
        case '📊 Статистика':
            showStatistics(chatId);
            break;
        case '⚙️ Админ':
            showAdminInfo(chatId);
            break;
        case '🆘 Помощь':
            showHelp(chatId);
            break;
        default:
            // Если введен ID блюда
            if (/^\d+$/.test(text)) {
                showDishDetails(chatId, parseInt(text));
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
        // ЗАМЕНИТЕ ЭТУ СТРОКУ:
        // showCreateDishInfo(chatId, messageId); // Старый код
        startCreateDishFlow(chatId, messageId); // Новый код
    } else if (data === 'find_dish') {
        editMessage(chatId, messageId,
            '🔍 ПОИСК БЛЮДА\n\n' +
            'Введите ID блюда:',
            { reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'main_menu' }]] } }
        );
    } else if (data.startsWith('toggle_dish_')) {
        const dishId = data.replace('toggle_dish_', '');
        toggleDishStatus(chatId, dishId, messageId);
    } else if (data.startsWith('edit_dish_')) {
        const dishId = data.replace('edit_dish_', '');
        // ЗАМЕНИТЕ ЭТУ СТРОКУ:
        // showDishDetails(chatId, dishId, messageId); // Старый код
        startEditDishFlow(chatId, dishId, messageId); // Новый код
    } else if (data.startsWith('delete_dish_')) {
        const dishId = data.replace('delete_dish_', '');
        confirmDeleteDish(chatId, dishId, messageId);
    } else if (data.startsWith('confirm_delete_')) {
        const dishId = data.replace('confirm_delete_', '');
        deleteDish(chatId, dishId, messageId);
    } else if (data === 'new_orders') {
        showNewOrders(chatId, messageId);
    } else if (data.startsWith('view_order_')) {
        const orderId = data.replace('view_order_', '');
        showOrderDetails(chatId, orderId, messageId);
    } else if (data.startsWith('confirm_order_')) {
        const orderId = data.replace('confirm_order_', '');
        confirmOrder(chatId, orderId, messageId);
    }
});

// ==================== DISH FUNCTIONS ====================

function showDishesSection(chatId) {
  sendMessage(chatId,
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
        return editMessage(chatId, messageId, message, dishesMenu);
      }
      return sendMessage(chatId, message, dishesMenu);
    }
    
    let message = '📋 ВСЕ БЛЮДА\n\n';
    let keyboard = [];
    
    // Берем только первый ресторан для простоты
    const restaurant = restaurants[0];
    try {
      const menu = await apiRequest(`/restaurants/${restaurant.id}/menu`);
      
      if (menu && menu.length > 0) {
        message += `${restaurant.name}:\n\n`;
        
        menu.forEach(dish => {
          const status = dish.is_available ? '✅' : '❌';
          message += `${status} ${dish.name}\nЦена: ${dish.price} ₽ (ID: ${dish.id})\n\n`;
          
          keyboard.push([
            { 
              text: `${status} ${dish.name.substring(0, 15)}`, 
              callback_data: `edit_dish_${dish.id}`
            }
          ]);
        });
      } else {
        message = '😔 В этом ресторане пока нет блюд.';
        keyboard = [[{ text: '➕ Создать первое блюдо', callback_data: 'create_dish' }]];
      }
    } catch (error) {
      message = '❌ Ошибка загрузки меню.';
    }
    
    keyboard.push([{ text: '🏠 Главное меню', callback_data: 'main_menu' }]);
    
    const replyMarkup = { reply_markup: { inline_keyboard: keyboard } };
    
    if (messageId) {
      editMessage(chatId, messageId, message, replyMarkup);
    } else {
      sendMessage(chatId, message, replyMarkup);
    }
    
  } catch (error) {
    const errorMsg = '❌ Ошибка загрузки блюд';
    if (messageId) {
      editMessage(chatId, messageId, errorMsg, dishesMenu);
    } else {
      sendMessage(chatId, errorMsg, dishesMenu);
    }
  }
}

function showCreateDishInfo(chatId, messageId = null) {
  const message = 
    '➕ СОЗДАНИЕ БЛЮДА\n\n' +
    'Используйте API для создания блюд:\n\n' +
    'Endpoint: POST /admin/dishes\n' +
    'Headers: X-Admin-API-Key: ваш_ключ\n\n' +
    'Пример JSON:\n' +
    '{\n' +
    '  "restaurant_id": 1,\n' +
    '  "name": "Название блюда",\n' +
    '  "price": 500,\n' +
    '  "description": "Описание"\n' +
    '}';
  
  if (messageId) {
    editMessage(chatId, messageId, message, dishesMenu);
  } else {
    sendMessage(chatId, message, dishesMenu);
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
      `• Время готовки: ${dish.preparation_time} мин\n` +
      `• Статус: ${dish.is_available ? '✅ Доступно' : '❌ Недоступно'}\n` +
      `• Ресторан: ${dish.restaurant_name}\n` +
      `• Острое: ${dish.is_spicy ? 'Да' : 'Нет'}\n` +
      `• Вегетарианское: ${dish.is_vegetarian ? 'Да' : 'Нет'}\n\n` +
      `ID: ${dish.id}`;
    
    const actions = getDishActions(dish.id, dish.is_available);
    
    if (messageId) {
      editMessage(chatId, messageId, message, actions);
    } else {
      sendMessage(chatId, message, actions);
    }
    
  } catch (error) {
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
    const result = await apiRequest(`/bot/dish/${dishId}/toggle`, 'POST');
    
    // Показываем обновленную информацию
    await showDishDetails(chatId, dishId, messageId);
    
  } catch (error) {
    const errorMsg = `❌ Ошибка: ${error.message}`;
    if (messageId) {
      editMessage(chatId, messageId, errorMsg, dishesMenu);
    } else {
      sendMessage(chatId, errorMsg, dishesMenu);
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
            { text: '🗑️ ДА, УДАЛИТЬ', callback_data: `confirm_delete_${dishId}` },
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
      editMessage(chatId, messageId, message, keyboard);
    } else {
      sendMessage(chatId, message, keyboard);
    }
    
  } catch (error) {
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
    const result = await apiRequest(`/admin/dishes/${dishId}`, 'DELETE');
    
    const message = result.soft_delete ? 
      '✅ Блюдо скрыто (используется в заказах)' : 
      '✅ Блюдо удалено';
    
    if (messageId) {
      editMessage(chatId, messageId, message, dishesMenu);
    } else {
      sendMessage(chatId, message, dishesMenu);
    }
    
  } catch (error) {
    const errorMsg = `❌ Ошибка удаления: ${error.message}`;
    if (messageId) {
      editMessage(chatId, messageId, errorMsg, dishesMenu);
    } else {
      sendMessage(chatId, errorMsg, dishesMenu);
    }
  }
}

async function startCreateDishFlow(chatId, messageId = null) {
    const message = 
        '➕ СОЗДАНИЕ НОВОГО БЛЮДА\n\n' +
        'Введите данные в формате:\n\n' +
        'Название: Текст\n' +
        'Цена: 999\n' +
        'Описание: Текст\n' +
        'Время готовки: 30\n' +
        'Острое: да/нет\n' +
        'Вегетарианское: да/нет\n\n' +
        'Пример:\n' +
        'Название: Пицца Маргарита\n' +
        'Цена: 699\n' +
        'Описание: Классическая пицца\n' +
        'Время готовки: 25\n' +
        'Острое: нет\n' +
        'Вегетарианское: да';

    const keyboard = {
        reply_markup: {
            inline_keyboard: [[
                { text: '❌ Отмена', callback_data: 'all_dishes' }
            ]]
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
        step: 'waiting_for_data'
    };
}

async function handleCreateDishData(chatId, text, messageId = null) {
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
        
        // Получаем первый ресторан для привязки блюда
        const restaurants = await apiRequest('/restaurants');
        if (!restaurants || restaurants.length === 0) {
            return sendMessage(chatId, 
                '❌ Нет доступных ресторанов. Сначала создайте ресторан.',
                dishesMenu
            );
        }
        
        const restaurant = restaurants[0];
        dishData.restaurant_id = restaurant.id;
        
        // Отправляем запрос на создание
        const result = await apiRequest('/admin/dishes', 'POST', dishData);
        
        const successMessage = 
            `✅ Блюдо успешно создано!\n\n` +
            `Название: ${result.dish.name}\n` +
            `Цена: ${result.dish.price} ₽\n` +
            `ID: ${result.dish.id}`;
            
        sendMessage(chatId, successMessage, {
            reply_markup: {
                inline_keyboard: [[
                    { text: '📋 Все блюда', callback_data: 'all_dishes' },
                    { text: '✏️ Редактировать', callback_data: `edit_dish_${result.dish.id}` }
                ]]
            }
        });
        
        // Очищаем состояние
        delete userStates[chatId];
        
    } catch (error) {
        console.error('Create dish error:', error.message);
        sendMessage(chatId, 
            `❌ Ошибка создания блюда: ${error.response?.data?.error || error.message}`,
            dishesMenu
        );
        delete userStates[chatId];
    }
}

async function startEditDishFlow(chatId, dishId, messageId = null) {
    try {
        // Получаем текущие данные блюда
        const result = await apiRequest(`/bot/dish/${dishId}`);
        const dish = result.dish;
        
        const message = 
            '✏️ РЕДАКТИРОВАНИЕ БЛЮДА\n\n' +
            'Введите поля для изменения в формате:\n\n' +
            `Название: ${dish.name}\n` +
            `Цена: ${dish.price}\n` +
            `Описание: ${dish.description || 'отсутствует'}\n` +
            `Время готовки: ${dish.preparation_time}\n` +
            `Острое: ${dish.is_spicy ? 'да' : 'нет'}\n` +
            `Вегетарианское: ${dish.is_vegetarian ? 'да' : 'нет'}\n` +
            `Доступно: ${dish.is_available ? 'да' : 'нет'}\n\n` +
            'Пример изменения:\n' +
            'Название: Новая пицца\n' +
            'Цена: 799\n' +
            'Описание: Обновленное описание';
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [[
                    { text: '❌ Отмена', callback_data: `edit_dish_${dishId}` }
                ]]
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
            step: 'waiting_for_data'
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

async function handleEditDishData(chatId, text, messageId = null) {
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
                    case 'доступно':
                        updates.is_available = value.toLowerCase() === 'да';
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
        const result = await apiRequest(`/admin/dishes/${dishId}`, 'PUT', updates);
        
        const successMessage = 
            `✅ Блюдо успешно обновлено!\n\n` +
            `Измененные поля:\n${Object.keys(updates).map(k => `• ${k}`).join('\n')}`;
            
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
            `❌ Ошибка редактирования блюда: ${error.response?.data?.error || error.message}`,
            dishesMenu
        );
        delete userStates[chatId];
    }
}

// ==================== ORDER FUNCTIONS ====================

function showOrdersSection(chatId) {
  sendMessage(chatId,
    '📦 УПРАВЛЕНИЕ ЗАКАЗАМИ\n\n' +
    'Выберите статус заказов:',
    ordersMenu
  );
}

async function showNewOrders(chatId, messageId = null) {
  try {
    const orders = await apiRequest('/admin/orders?status=pending&limit=5');
    
    if (!orders || orders.length === 0) {
      const message = '😔 Новых заказов нет';
      if (messageId) {
        return editMessage(chatId, messageId, message, ordersMenu);
      }
      return sendMessage(chatId, message, ordersMenu);
    }
    
    let message = '🆕 НОВЫЕ ЗАКАЗЫ\n\n';
    let keyboard = [];
    
    orders.forEach(order => {
      message += 
        `Заказ #${order.id}\n` +
        `Клиент: ${order.user_name || 'Не указано'}\n` +
        `Ресторан: ${order.restaurant_name}\n` +
        `Сумма: ${order.total_amount} ₽\n` +
        `Адрес: ${order.delivery_address.substring(0, 30)}\n`;
      
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
      editMessage(chatId, messageId, message, replyMarkup);
    } else {
      sendMessage(chatId, message, replyMarkup);
    }
    
  } catch (error) {
    console.log('Orders error:', error.message);
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
    const orders = await apiRequest('/admin/orders');
    const order = orders.find(o => o.id == orderId);
    
    if (!order) {
      const errorMsg = '❌ Заказ не найден';
      if (messageId) {
        return editMessage(chatId, messageId, errorMsg, ordersMenu);
      }
      return sendMessage(chatId, errorMsg, ordersMenu);
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
        { text: '✅ Подтвердить', callback_data: `confirm_order_${order.id}` }
      ]);
    }
    
    inlineKeyboard.push([
      { text: '📦 Все заказы', callback_data: 'new_orders' },
      { text: '🏠 Главное меню', callback_data: 'main_menu' }
    ]);
    
    const keyboard = { reply_markup: { inline_keyboard: inlineKeyboard } };
    
    if (messageId) {
      editMessage(chatId, messageId, message, keyboard);
    } else {
      sendMessage(chatId, message, keyboard);
    }
    
  } catch (error) {
    const errorMsg = `❌ Ошибка: ${error.message}`;
    if (messageId) {
      editMessage(chatId, messageId, errorMsg, ordersMenu);
    } else {
      sendMessage(chatId, errorMsg, ordersMenu);
    }
  }
}

async function confirmOrder(chatId, orderId, messageId = null) {
  try {
    const result = await apiRequest(`/admin/orders/${orderId}/status`, 'PUT', {
      status: 'confirmed'
    });
    
    const message = `✅ Заказ #${orderId} подтвержден!`;
    
    if (messageId) {
      editMessage(chatId, messageId, message, ordersMenu);
    } else {
      sendMessage(chatId, message, ordersMenu);
    }
    
  } catch (error) {
    const errorMsg = `❌ Ошибка подтверждения: ${error.message}`;
    if (messageId) {
      editMessage(chatId, messageId, errorMsg, ordersMenu);
    } else {
      sendMessage(chatId, errorMsg, ordersMenu);
    }
  }
}

// ==================== OTHER FUNCTIONS ====================

function showMainMenu(chatId, messageId = null) {
  const message = '👑 АДМИН ПАНЕЛЬ\n\nВыберите раздел:';
  if (messageId) {
    editMessage(chatId, messageId, message, adminMainMenu);
  } else {
    sendMessage(chatId, message, adminMainMenu);
  }
}

async function showStatistics(chatId) {
  try {
    const health = await apiRequest('/health');
    
    const message = 
      '📊 СТАТИСТИКА СИСТЕМЫ\n\n' +
      `Статус API: ${health.status}\n` +
      `База данных: ${health.database}\n` +
      `Окружение: ${health.environment}\n\n` +
      `Обновлено: ${new Date().toLocaleTimeString()}`;
    
    sendMessage(chatId, message, adminMainMenu);
    
  } catch (error) {
    sendMessage(chatId, '❌ Ошибка загрузки статистики', adminMainMenu);
  }
}

function showAdminInfo(chatId) {
  const message = 
    '⚙️ ИНФОРМАЦИЯ О СИСТЕМЕ\n\n' +
    `API: ${API_BASE_URL}\n` +
    `Время сервера: ${new Date().toLocaleString()}`;
  
  sendMessage(chatId, message, adminMainMenu);
}

function showHelp(chatId) {
  const message = 
    '🆘 ПОМОЩЬ АДМИНИСТРАТОРУ\n\n' +
    'Основные функции:\n' +
    '• 🍽️ Блюда - просмотр и управление меню\n' +
    '• 📦 Заказы - подтверждение новых заказов\n' +
    '• 📊 Статистика - информация о системе\n\n' +
    'Команды:\n' +
    '/start - главное меню\n' +
    '/orders - управление заказами\n' +
    '/dishes - управление блюдами';
  
  sendMessage(chatId, message, adminMainMenu);
}

// ==================== HEALTH SERVER ====================
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'admin-bot-final',
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(200);
    res.end('🤖 Admin Bot Final v1.0');
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`✅ Health server: ${PORT}`);
  console.log('🎉 FINAL BOT IS READY!');
  console.log('👉 Отправьте /start в Telegram');
});

process.on('SIGTERM', () => {
  console.log('🛑 Shutting down...');
  bot.stopPolling();
  server.close();
  process.exit(0);
});
