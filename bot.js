// bot.js - запускать ОТДЕЛЬНО
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const API_BASE_URL = 'https://food-delivery-api-production-8385.up.railway.app'; // Ваш Railway API

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

async function callAdminAPI(endpoint, method = 'GET') {
    try {
        const response = await axios({
            method,
            url: `${API_BASE_URL}${endpoint}`,
            headers: {
                'X-Admin-API-Key': ADMIN_API_KEY,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error('API Error:', error.response?.data || error.message);
        throw error;
    }
}

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, '🤖 Бот управления рестораном запущен!');
});

bot.onText(/\/toggle (\d+)/, async (msg, match) => {
    const dishId = match[1];

    try {
        const result = await callAdminAPI(`/bot/dish/${dishId}/toggle`, 'POST');
        bot.sendMessage(msg.chat.id, `✅ ${result.message}`);
    } catch (error) {
        bot.sendMessage(msg.chat.id, `❌ Ошибка: ${error.response?.data?.error || error.message}`);
    }
});

bot.onText(/\/dish (\d+)/, async (msg, match) => {
    const dishId = match[1];

    try {
        const result = await callAdminAPI(`/bot/dish/${dishId}`);
        const dish = result.dish;

        bot.sendMessage(msg.chat.id,
            `🍽️ ${dish.name}\n` +
            `💰 ${dish.price} ₽\n` +
            `✅ ${dish.is_available ? 'Доступно' : 'Недоступно'}\n` +
            `🏪 ${dish.restaurant_name}`
        );
    } catch (error) {
        bot.sendMessage(msg.chat.id, `❌ Ошибка: ${error.response?.data?.error || error.message}`);
    }
});

console.log('🤖 Telegram бот запущен локально...');
console.log('🔗 Подключен к API:', API_BASE_URL);