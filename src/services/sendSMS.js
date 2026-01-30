import axios from 'axios';
import Setting from '../models/Setting.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const smsTemplates = require('./smsTemplates.json');


/**
 * Send SMS using Fast2SMS API
 * @param {string} template_name - Message Name
 * @param {string|string[]} variables_values - Single number or array of numbers
 * @param {string|string[]} numbers - Single number or array of numbers
 * @returns {Promise<Object>} Response data from Fast2SMS
 */
const sendSMS = async (template_name, variables_values, numbers) => {
    try {
        // Check DB setting first
        const smsSetting = await Setting.findOne({ key: 'SMS_ENABLED' });

        // If DB setting exists, use its value. If not, fallback to env var (legacy support)
        const isEnabled = smsSetting ? smsSetting.value === true : process.env.ENABLE_SMS_SERVICE === 'true';

        if (!isEnabled) {
            console.log('SMS Service is disabled (DB/Env). Skipping SMS sending.');
            return null;
        }

        const apiKey = process.env.FAST2SMS_API_KEY;

        if (!apiKey) {
            console.error('FAST2SMS_API_KEY is missing in environment variables');
            return null;
        }

        if (!template_name || !numbers) {
            console.warn("No template name or mobile numbers provided");
            return null;
        }

        const template = smsTemplates.find(t => t.template_name === template_name);
        if (!template) {
            console.warn('Template not found for template_name:', template_name);
            return null;
        }


        const payload = {
            route: template.route || "dlt",
            message: template.template_id,
            variables_values: Array.isArray(variables_values) ? variables_values.join('|') : variables_values,
            sender_id: template.sender_id,
            language: template.language,
            flash: template.flash,
            numbers: Array.isArray(numbers) ? numbers.join(',') : numbers,
        };
        // console.log("payload", payload);
        // return null

        const response = await axios.post('https://www.fast2sms.com/dev/bulkV2', payload, {
            headers: {
                "authorization": apiKey,
                "Content-Type": "application/json"
            }
        });
        console.log("SMS Response", response.data);
        return response.data;
    } catch (error) {
        console.error('Fast2SMS Error:', error.response?.data || error.message);
        // You might want to throw or just return null depending on how strict the app is
        // Returning null/false allows the app to continue even if SMS fails
        return null;
    }
};

export default sendSMS;

// Example usage:
// sendSMS('add_sales', ["Tauhid", "434344"], ["7414969691"]);
// sendSMS('update_sales', ["Tauhid", "434344"], ["7414969691"]);

