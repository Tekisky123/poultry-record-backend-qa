import axios from "axios";

export const addSaleWhatsappMessage = async (recipientNumber, customerName) => {
  try {
    // const accessToken = process.env.WHATSAPP_TOKEN;
    const accessToken = "EAAMgJY6bX98BQNIwGYizfKd5eUjowTDfn1WPKDvOJvQt4gsu8rduQyNqkEcDop5CRrLhRUbdDQl9s96cOyX0WZA3WsZAE8MRwD6ai7ZBvbyraWPwse8zLjb2zExFSftonws2rHKgqQV8NAlhFjyJVZC9tr1NiM859PdhOHG4FdKKKQwcFTIRc5KeOwYrZA1eq8yCvDJS9ZBw52wtfoFbIIHeUMqw9jsJZCEtfmpq2UbTd55jbawgYZAf1VRwI7mqqZCYDtLgtbt1K6ZAZBPwRdrRZAeMuuWZB8AZDZD";
    const url = "https://graph.facebook.com/v18.0/880954898437355/messages";

    // Construct the message template data
    // const templateData = {
    //   messaging_product: "whatsapp",
    //   type: "template",
    //   template: {
    //     name: "customer_sale_confirmation",
    //     language: {
    //       code: "en_US",
    //     },
    //     components: [
    //       {
    //         type: "body",
    //         parameters: [
    //           {
    //             type: "text",
    //             text: customerName || "Customer", // Placeholder for the customer's name to be provided in the parameters
    //           },
    //         ],
    //       },
    //     ],
    //   },
    // };
    const templateData = {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: "hello_world",
        language: {
          code: "en_US",
        },
      },
    };

    // Set the request headers
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    };

    // Set the recipient and data for the message
    const data = { ...templateData, to: recipientNumber };

    // Log the data being sent
    console.log("Sending message with data:", JSON.stringify(data));

    // Send the message using Axios
    const response = await axios.post(url, data, { headers });

    // Log the response
    console.log("WhatsApp API response:", response.data);

    // Check the response status
    if (response.status !== 200) {
      console.error(
        `WhatsApp API request failed with status code ${response.status}`
      );
    } else {
      console.log("Message sent successfully!");
    }
  } catch (error) {
    // Log any errors during sending
    console.error("Error sending WhatsApp message:", error.message);
    if (error.response) {
      console.error("WhatsApp API error response:", error.response.data);
    }
  }
};

// addSaleWhatsappMessage("917414969691", "Tauhid")