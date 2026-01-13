const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE_URL = process.env.API_BASE_URL;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Функция для вызова API
async function callAdminAPI(endpoint, method = 'GET', data = null) {
    try {
        const response = await axios({
            method,
            url: `${API_BASE_URL}${endpoint}`,
            headers: {
                'X-Admin-API-Key': ADMIN_API_KEY
            },
            data
        });
        return response.data;
    } catch (error) {
        console.error('API Error:', error.message);
        throw error;
    }
}

// Команды бота
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
        `👨‍🍳 Привет, администратор!\n\n` +
        `Команды:\n` +
        `/toggle ДИШ_ИД - Переключить доступность блюда\n` +
        `/stats - Статистика\n` +
        `/help - Помощь`
    );
});

bot.onText(/\/toggle (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const dishId = match[1];

    try {
        const result = await callAdminAPI(`/bot/dish/${dishId}/toggle`, 'POST');
        bot.sendMessage(chatId, result.message);
    } catch (error) {
        bot.sendMessage(chatId, '❌ Ошибка обновления блюда');
    }
});

bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        // Простая статистика
        const restaurants = await callAdminAPI('/restaurants');
        const message =
            `📊 Статистика:\n\n` +
            `🍽️ Активных ресторанов: ${restaurants.length}\n` +
            `🕒 Обновлено: ${new Date().toLocaleTimeString()}`;

        bot.sendMessage(chatId, message);
    } catch (error) {
        bot.sendMessage(chatId, 'Ошибка получения статистики');
    }
});

console.log('🤖 Telegram бот запущен...');
