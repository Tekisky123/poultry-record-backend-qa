import sendSMS from "../sendSMS.js";

export default function sendAddSaleSMS(numbers, messageData, dynamicVariables) {
    const templatePayload = {
        // message: "208424",
        numbers: Array.isArray(numbers) ? numbers.join(',') : numbers,
        language: "english",
        route: "dlt",
        flash: 0,
        sender_id: "TEKSKY",
        variables_values: Array.isArray(dynamicVariables) ? dynamicVariables.join('|') : dynamicVariables,
        message: `
                RAFEEQ CHICKEN CENTRE, LOKAPUR.
                Dear ${messageData.customerName},
                Thank you for purchasing with us.
                Your new birds purchase added on ${messageData.date}.
                Invoice No: ${messageData.invoiceNo}
                Old Balance: ₹${messageData.oldBalance}
                Birds: ${messageData.birds}, 
                Weight: ${messageData.weight}kg
                Amount: ₹${messageData.amount}, 
                Paid: ₹${messageData.cashPaid} Cash, ₹${messageData.onlinePaid} Online,
                Balance: ₹${messageData.balance}
                Login: https://poultry-record-frontend.vercel.app/signin
                Tekisky Private Limited.
                `.trim(),
    };
    console.log("templatePayload", templatePayload);
    return null;

    // sendSMS(templatePayload);
}