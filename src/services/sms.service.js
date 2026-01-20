import axios from 'axios';
import Setting from '../models/Setting.js';

const FAST2SMS_URL = 'https://www.fast2sms.com/dev/bulkV2';

/**
 * Send SMS using Fast2SMS API
 * @param {string} message - The message content
 * @param {string} numbers - Comma separated mobile numbers
 * @returns {Promise<Object>} - The API response
 */
export const sendSms = async (message, numbers) => {
    try {
        // Check DB setting first
        const smsSetting = await Setting.findOne({ key: 'SMS_ENABLED' });

        // If DB setting exists, use its value. If not, fallback to env var (legacy support)
        const isEnabled = smsSetting ? smsSetting.value === true : process.env.ENABLE_SMS_SERVICE === 'true';

        if (!isEnabled) {
            console.log('SMS Service is disabled (DB/Env). Skipping SMS sending.');
            return { success: false, message: 'SMS Service disabled' };
        }

        if (!process.env.FAST2SMS_API_KEY) {
            console.error('FAST2SMS_API_KEY is missing in environment variables');
            return { success: false, message: 'API Key missing' };
        }

        if (!numbers) {
            return { success: false, message: 'No mobile numbers provided' };
        }

        const payload = {
            route: 'q', // 'q' for Quick SMS (transactional) or 'v' for voice. 'dlt' might be required for some. usage 'q' is common for simple integration.
            message: message,
            language: 'english',
            flash: 0,
            numbers: numbers,
        };

        console.log('Sending SMS to:', numbers);
        console.log('SMS Message:', message);

        // const response = await axios.post(FAST2SMS_URL, payload, {
        //     headers: {
        //         'authorization': process.env.FAST2SMS_API_KEY,
        //         'Content-Type': 'application/json'
        //     }
        // });

        // console.log('SMS sent successfully:', response.data);
        // return { success: true, data: response.data };
        return { success: true, message: 'SMS Tested' };
    } catch (error) {
        console.error('Error sending SMS:', error.response?.data || error.message);
        // We don't throw error to avoid breaking the main transaction flow
        return { success: false, error: error.message };
    }
};

/**
 * Send Sale SMS
 */
export const sendSaleSms = async (customerName, amount, billNumber, date, mobileNumber) => {
    if (!mobileNumber) return;

    // Template: "Dear {#var#}, thank you for purchasing with us. Your invoice no.{#var#}. RCC & Trading Company."
    const message = `Dear ${customerName}, thank you for purchasing with us. Your invoice no.${billNumber}. RCC & Trading Company.`;

    return sendSms(message, mobileNumber);
};

/**
 * Send Receipt SMS
 */
export const sendReceiptSms = async (customerName, amount, billNumber, date, mobileNumber) => {
    if (!mobileNumber) return;

    const formattedDate = new Date(date).toLocaleDateString('en-IN');
    const message = `Dear ${customerName}, Payment of Rs.${amount} received vide Receipt #${billNumber} on ${formattedDate}. Thank you.`;

    return sendSms(message, mobileNumber);
};
