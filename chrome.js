import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  doc,
  collection,
  updateDoc,
  arrayUnion,
  getDocs,
  addDoc,
  setDoc,
  getDoc,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import firebaseConfig from "./config.js";
import { SCRAPER_API_KEY } from "./config.js";
import { GMAIL_TEMEPLET_ID } from "./config.js";
import { GMAIL_SERVICE_ID } from "./config.js";
import { GMAIL_USER_ID } from "./config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Run this when the extension is first installed
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: "index.html" });
  }
});

// Handle when the user clicks the extension icon
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: "https://amazon-price-tracker-web-application.vercel.app/login",
  });
});

async function priceTrackingNotification(email, productName, productUrl) {
  try {
    await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: GMAIL_SERVICE_ID,
        template_id: GMAIL_TEMEPLET_ID,
        user_id: GMAIL_USER_ID,
        template_params: {
          to_email: email,
          subject: `New Price Tracking: ${productName}`,
          message: `You have started tracking a new product! Check it out here: ${productUrl}`,
        },
      }),
    });

    chrome.notifications.create(`email-sent-${Date.now()}`, {
      type: "basic",
      iconUrl: "image/image.png",
      title: "Email Sent",
      message: `✅ New price tracking email sent to ${email}`,
      priority: 2,
    });
  } catch (error) {
    chrome.notifications.create(`email-failed-${Date.now()}`, {
      type: "basic",
      iconUrl: "image/image.png",
      title: "Email Failed",
      message: `❌ Failed to send email for new price tracking`,
      priority: 2,
    });
  }
}

async function saveProduct(datas) {
  // ✅ Check internet connection before executing any code
  if (!navigator.onLine) {
    console.error("❌ No internet connection.");
    chrome.notifications.create(`offline-${Date.now()}`, {
      type: "basic",
      iconUrl: "image/image.png",
      title: "No Internet Connection",
      message: "Please check your network and try again.",
      priority: 2,
    });
    return; // Stop execution
  }

  try {
    const storedData = await chrome.storage.sync.get("userId");
    let userDocId = storedData.userId;

    if (userDocId) {
      const userDocRef = doc(db, "saveProduct", userDocId);
      const docSnap = await getDoc(userDocRef);

      if (!docSnap.exists()) {
        await chrome.storage.sync.remove("userId");
        userDocId = datas.userId;
      }
    } else {
      userDocId = datas.userId;
    }

    if (!userDocId) {
      console.error("❌ No valid userId found!");
      chrome.notifications.create(`error-${Date.now()}`, {
        type: "basic",
        iconUrl: "image/image.png",
        title: "Tracking Error",
        message: "No user ID found. Please log in first.",
        priority: 2,
      });
      return;
    }

    await chrome.storage.sync.set({ userId: userDocId });
    await chrome.storage.local.set({ userId: userDocId });

    const { userId, ...productData } = datas;
    const userDocRef = doc(db, "saveProduct", userDocId);
    const docSnap = await getDoc(userDocRef);

    if (!docSnap.exists()) {
      await setDoc(userDocRef, {
        products: [{ ...productData, timestamp: Timestamp.now() }],
        notifications: [
          {
            title: "Tracking Started",
            message: `Tracking price for ${datas.title}.`,
            timestamp: Timestamp.now(),
            read: false,
          },
        ],
      });
    } else {
      await updateDoc(userDocRef, {
        products: arrayUnion({ ...productData, timestamp: Timestamp.now() }),
        notifications: arrayUnion({
          title: `Tracking Started for ${datas.title}`,
          message:
            "Product is on review, emails will be sent to keep you updated on price changes.",
          timestamp: Timestamp.now(),
          read: false,
        }),
      });
    }

    chrome.notifications.create(`track-${Date.now()}`, {
      type: "basic",
      iconUrl: "image/image.png",
      title: "Tracking Started",
      message: `Tracking price for ${datas.title}.`,
      priority: 2,
    });

    priceTrackingNotification(datas.email, datas.title, datas.url);
  } catch (error) {
    console.error("❌ Error saving URL:", error);

    chrome.notifications.create(`product-${Date.now()}`, {
      type: "basic",
      iconUrl: "image/image.png",
      title: "Tracking Error",
      message: error.message,
      priority: 2,
    });
  }
}

// ✅ Fetch products stored in Firebase
async function fetchTrackedProducts() {
  try {
    const storedData = await chrome.storage.sync.get("userId");
    const userDocId = storedData.userId;

    if (!userDocId) return [];

    const userDocRef = doc(db, "saveProduct", userDocId);
    const userSnapshot = await getDoc(userDocRef);

    if (!userSnapshot.exists()) {
      console.warn("User document not found in Firestore. Removing userId...");

      // Delete `userId` from chrome.storage.sync
      await chrome.storage.sync.remove("userId");
      await chrome.storage.local.remove("userId");

      return [];
    }

    return userSnapshot.data().products || [];
  } catch (error) {
    console.error("Error fetching tracked products:", error);
    return [];
  }
}
async function fetchCurrentPrice(productUrl) {
  try {
    const response = await fetch(
      `https://api.scraperapi.com/?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(
        productUrl
      )}`
    );
    const html = await response.text();
    console.log(html);

    // ✅ Send HTML to content script for price extraction
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "parseAmazonHTML",
          html: html,
          url: productUrl,
        });
      }
    });

    return null;
  } catch (error) {
    console.error("❌ Error fetching product price:", error);
    chrome.notifications.create(`error-fetching-data-${Date.now()}`, {
      type: "basic",
      iconUrl: "image/image.png",
      title: "Error fetching product data",
      message: "❌ Error fetching product price",
      priority: 2,
    });
    return null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received message:", message); // ✅ Debug log
  if (message.action === "updatePrice") {
    console.log("This is the extracted Price", Number(message.price));
    checkPriceUpdates(message.url, Number(message.price));
  }
});

async function sendNewPriceTrackingNotification(
  email,
  productName,
  productUrl,
  extractedPriceNum,
  message,
  heading
) {
  try {
    const response = await fetch(
      "https://api.emailjs.com/api/v1.0/email/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: GMAIL_SERVICE_ID,
          template_id: GMAIL_TEMEPLET_ID,
          user_id: GMAIL_USER_ID,
          template_params: {
            to_email: email,
            subject: `New Price Tracking: ${productName}`,
            message: message,
            heading: heading,
          },
        }),
      }
    );

    let result;
    const contentType = response.headers.get("content-type");

    if (contentType && contentType.includes("application/json")) {
      result = await response.json();
    } else {
      result = await response.text(); // Handle plain text response (like "OK")
    }

    if (response.ok) {
      console.log(`📩 Email Sent Successfully: ${email}`);
      chrome.notifications.create(`email-sent-${Date.now()}`, {
        type: "basic",
        iconUrl: "image/image.png",
        title: "Email Sent",
        message: `✅ Price update email sent to ${email}`,
        priority: 2,
      });
    } else {
      throw new Error(`EmailJS Error: ${result.message || result}`);
    }
  } catch (error) {
    console.error("❌ Email Sending Failed:", error);
    chrome.notifications.create(`email-failed-${Date.now()}`, {
      type: "basic",
      iconUrl: "image/image.png",
      title: "Email Failed",
      message: `❌ Failed to send price update email`,
      priority: 2,
    });
  }
}

async function checkPriceUpdates(url, extractedPrice) {
  try {
    const products = await fetchTrackedProducts();
    let message;
    let heading;

    for (const product of products) {
      if (product.url === url) {
        const storedData = await chrome.storage.sync.get("userId");
        const storedUserId = storedData.userId;
        const { userPrice, email, title, price, priceHistory = [] } = product;

        console.log(extractedPrice);
        const extractedPriceNum = Number(extractedPrice);
        console.log(extractedPriceNum);
        const userPriceNum = Number(userPrice);
        const prevPriceNum = Number(price);

        if (isNaN(extractedPriceNum) || extractedPriceNum === prevPriceNum) {
          message = `The price of ${title} remains $${prevPriceNum}. No change detected.`;
          heading = "Price still remains the same";
        } else if (extractedPriceNum < prevPriceNum) {
          message = `The price of ${title} dropped from $${prevPriceNum} to $${extractedPriceNum}.`;
          heading = "Price Drop Alert!";
        } else if (!isNaN(userPriceNum) && extractedPriceNum <= userPriceNum) {
          message = `The price of ${title} is now $${extractedPriceNum}, matching your desired price!`;
          heading = "Great News! 🎉";
        } else if (extractedPriceNum > prevPriceNum) {
          message = `The price of ${title} has increased to $${extractedPriceNum}.`;
          heading = "Tracking Updated";
        }

        if (message) {
          // ✅ Create Chrome Notification
          chrome.notifications.create(`price-update-${Date.now()}`, {
            type: "basic",
            iconUrl: "image/image.png",
            title: heading,
            message: message,
            priority: 2,
          });

          // ✅ Update Firestore: Price and Price History
          const userDocRef = doc(db, "saveProduct", storedUserId);
          const userSnapshot = await getDoc(userDocRef);

          if (userSnapshot.exists()) {
            const data = userSnapshot.data().products;
            const productIndex = data.findIndex((item) => item.url === url);

            if (productIndex !== -1) {
              data[productIndex].price = extractedPriceNum;
              data[productIndex].priceHistory = [
                ...priceHistory,
                { price: extractedPriceNum, timestamp: Timestamp.now() },
              ];

              // ✅ Update Firestore (Products)
              await updateDoc(userDocRef, { products: data });

              // ✅ Add Notification at the User Level
              await updateDoc(userDocRef, {
                notifications: arrayUnion({
                  title: heading,
                  message: message,
                  url: url,
                  timestamp: Timestamp.now(),
                  read: false, // Mark as unread initially
                }),
              });
            }
          }

          // ✅ Send Email Notification
          sendNewPriceTrackingNotification(
            email,
            title,
            url,
            extractedPriceNum,
            message,
            heading
          );
        }
      }
    }
  } catch (error) {
    console.error("❌ Error checking price updates:", error);
    chrome.notifications.create(`error-${Date.now()}`, {
      type: "basic",
      iconUrl: "image/image.png",
      title: "Tracking Error",
      message: error.message,
      priority: 2,
    });
  }
}

chrome.alarms.create("priceCheck", { periodInMinutes: 1440 }); // 1440 minutes = 24 hours

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "priceCheck") {
    const products = await fetchTrackedProducts(); // ✅ Call the function once, without passing a URL

    for (const product of products) {
      fetchCurrentPrice(product.url);
      console.log("Caleed the fetchCurrentPrice");
    }
  }
});

// Listen for messages from the popup or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "saveProduct") {
    saveProduct(message.data);
  }
});
