import Setting from '../models/Setting.js';

// Get all settings or a specific one by key query
export const getSettings = async (req, res) => {
    try {
        const settings = await Setting.find({});
        // Transform array to object for easier frontend consumption { KEY: value }
        const formattedSettings = settings.reduce((acc, curr) => {
            acc[curr.key] = curr.value;
            return acc;
        }, {});

        res.status(200).json({
            success: true,
            data: formattedSettings
        });
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch settings'
        });
    }
};

// Update or Create a setting
export const updateSetting = async (req, res) => {
    try {
        const { key, value } = req.body;

        if (!key) {
            return res.status(400).json({
                success: false,
                message: 'Setting key is required'
            });
        }

        const setting = await Setting.findOneAndUpdate(
            { key: key.toUpperCase() },
            {
                value,
                updatedBy: req.user?._id
            },
            { new: true, upsert: true } // Upsert: create if not exists
        );

        res.status(200).json({
            success: true,
            data: setting,
            message: 'Setting updated successfully'
        });
    } catch (error) {
        console.error('Error updating setting:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update setting'
        });
    }
};
