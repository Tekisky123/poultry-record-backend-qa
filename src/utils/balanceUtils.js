/**
 * Convert balance to signed value
 * Debit = positive, Credit = negative
 */
export const toSignedValue = (amount, type) => {
    if (!type || type === 'debit') {
        return Math.abs(amount);
    }
    return -Math.abs(amount);
};

/**
 * Convert signed value to balance format
 * Returns { amount, type }
 */
export const fromSignedValue = (signedValue) => {
    if (signedValue >= 0) {
        return {
            amount: Math.abs(signedValue),
            type: 'debit'
        };
    }
    return {
        amount: Math.abs(signedValue),
        type: 'credit'
    };
};

/**
 * Sync outstanding balance when opening balance changes
 * @param {Number} oldOpeningAmount - Old opening balance amount
 * @param {String} oldOpeningType - Old opening balance type ('debit' or 'credit')
 * @param {Number} newOpeningAmount - New opening balance amount
 * @param {String} newOpeningType - New opening balance type ('debit' or 'credit')
 * @param {Number} currentOutstandingAmount - Current outstanding balance amount
 * @param {String} currentOutstandingType - Current outstanding balance type ('debit' or 'credit')
 * @returns {Object} - { amount, type } for new outstanding balance
 */
export const syncOutstandingBalance = (
    oldOpeningAmount,
    oldOpeningType,
    newOpeningAmount,
    newOpeningType,
    currentOutstandingAmount,
    currentOutstandingType
) => {
    // Convert to signed values
    const oldOpeningSigned = toSignedValue(oldOpeningAmount || 0, oldOpeningType || 'debit');
    const newOpeningSigned = toSignedValue(newOpeningAmount || 0, newOpeningType || 'debit');
    const currentOutstandingSigned = toSignedValue(currentOutstandingAmount || 0, currentOutstandingType || 'debit');

    // Compute the difference
    const difference = newOpeningSigned - oldOpeningSigned;

    // Apply the difference
    const newOutstandingSigned = currentOutstandingSigned + difference;

    // Convert back to balance format
    return fromSignedValue(newOutstandingSigned);
};

/**
 * Add amount to balance (for payments/credits)
 * @param {Number} currentAmount - Current balance amount
 * @param {String} currentType - Current balance type ('debit' or 'credit')
 * @param {Number} amountToAdd - Amount to add (always positive)
 * @param {String} transactionType - Type of transaction ('debit' or 'credit')
 * @returns {Object} - { amount, type } for new balance
 */
export const addToBalance = (currentAmount, currentType, amountToAdd, transactionType) => {
    const currentSigned = toSignedValue(currentAmount || 0, currentType || 'debit');
    const amountSigned = toSignedValue(amountToAdd || 0, transactionType || 'credit');
    const newSigned = currentSigned + amountSigned;
    return fromSignedValue(newSigned);
};

/**
 * Subtract amount from balance (for reversing transactions)
 * @param {Number} currentAmount - Current balance amount
 * @param {String} currentType - Current balance type ('debit' or 'credit')
 * @param {Number} amountToSubtract - Amount to subtract (always positive)
 * @param {String} transactionType - Type of transaction that was added ('debit' or 'credit')
 * @returns {Object} - { amount, type } for new balance
 */
export const subtractFromBalance = (currentAmount, currentType, amountToSubtract, transactionType) => {
    const currentSigned = toSignedValue(currentAmount || 0, currentType || 'debit');
    const amountSigned = toSignedValue(amountToSubtract || 0, transactionType || 'credit');
    const newSigned = currentSigned - amountSigned;
    return fromSignedValue(newSigned);
};

