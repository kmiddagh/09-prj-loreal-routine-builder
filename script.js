/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  productsContainer.innerHTML = products
    .map(
      (product) => `
    <div class="product-card" data-id="${product.id}">
      <img src="${product.image}" alt="${product.name}">
      <div class="product-info">
        <h3>${product.name}</h3>
        <p>${product.brand}</p>
        <div class="product-actions">
          <button class="btn btn-primary" data-action="toggle" data-id="${product.id}">Add</button>
          <button class="btn btn-ghost" data-action="info" data-id="${product.id}" aria-expanded="false" aria-controls="desc-${product.id}">Info</button>
        </div>
        <div id="desc-${product.id}" class="product-desc" aria-hidden="true">${product.description}</div>
      </div>
    </div>
  `
    )
    .join("");
}

/* ----- selection state + helpers ----- */
const selectedIds = new Set();
let allProductsCache = [];
// conversation history used for follow-up chats
const conversationMessages = [];
// localStorage keys
const STORAGE_KEY = "selectedProducts";

function saveSelectedToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selectedIds)));
  } catch (e) {
    console.warn("Failed to save selections", e);
  }
}

function loadSelectedFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) arr.forEach((id) => selectedIds.add(String(id)));
  } catch (e) {
    console.warn("Failed to load selections", e);
  }
}

function findProductById(id) {
  return allProductsCache.find((p) => String(p.id) === String(id));
}

function updateCardSelectionState(container = productsContainer) {
  container.querySelectorAll(".product-card").forEach((card) => {
    const id = card.getAttribute("data-id");
    if (selectedIds.has(String(id))) {
      card.classList.add("selected");
      const btn = card.querySelector('[data-action="toggle"]');
      if (btn) btn.textContent = "Remove";
    } else {
      card.classList.remove("selected");
      const btn = card.querySelector('[data-action="toggle"]');
      if (btn) btn.textContent = "Add";
    }
  });
}

function renderSelectedProductsList() {
  const list = document.getElementById("selectedProductsList");
  if (!list) return;

  if (selectedIds.size === 0) {
    list.innerHTML =
      '<p class="placeholder-message">No products selected yet.</p>';
    return;
  }

  list.innerHTML = Array.from(selectedIds)
    .map((id) => {
      const p = findProductById(id);
      if (!p) return "";
      return `
        <div class="pill" data-id="${p.id}">
          ${p.name} <button class="remove-pill" aria-label="Remove ${p.name}" data-id="${p.id}">&times;</button>
        </div>
      `;
    })
    .join("");
}

function toggleSelection(id) {
  const sid = String(id);
  if (selectedIds.has(sid)) selectedIds.delete(sid);
  else selectedIds.add(sid);
  updateCardSelectionState();
  renderSelectedProductsList();
  saveSelectedToStorage();
}

/* Filter and display products when category changes */
categoryFilter.addEventListener("change", async (e) => {
  const products = await loadProducts();
  // cache all products so selection list can show full product names
  allProductsCache = products;
  const selectedCategory = e.target.value;

  /* filter() creates a new array containing only products 
     where the category matches what the user selected */
  const filteredProducts = products.filter(
    (product) => product.category === selectedCategory
  );

  displayProducts(filteredProducts);
  updateCardSelectionState();
});

/* Chat form submission handler - follow-up questions using conversation history */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text) return;

  // show the user's message in the chat window
  appendChatMessage("user", text);
  input.value = "";

  // Ensure we have a system message if conversation is empty
  if (conversationMessages.length === 0) {
    conversationMessages.push({
      role: "system",
      content:
        "You are a helpful, concise beauty advisor who only answers questions related to the generated routine, skincare, haircare, makeup, fragrance, and related beauty topics. Be polite and brief.",
    });
  }

  // Append the user's follow-up to the conversation
  conversationMessages.push({ role: "user", content: text });

  const endpoint = window.CLOUDFLARE_WORKER_URL || window.OPENAI_PROXY_URL;
  if (!endpoint) {
    appendChatMessage(
      "assistant",
      "No Cloudflare worker URL configured. Please set `window.CLOUDFLARE_WORKER_URL` in `secrets.js`."
    );
    return;
  }

  // Send full conversation history to the worker
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversationMessages, model: "gpt-4o" }),
    });

    if (!resp.ok) {
      const textErr = await resp.text();
      appendChatMessage(
        "assistant",
        `Error from worker: ${resp.status} — ${textErr}`
      );
      return;
    }

    const data = await resp.json();
    const aiText =
      data?.choices?.[0]?.message?.content ||
      data?.result ||
      data?.text ||
      JSON.stringify(data);
    appendChatMessage("assistant", aiText);
    // store assistant reply in conversation history for further follow-ups
    conversationMessages.push({ role: "assistant", content: aiText });
  } catch (err) {
    appendChatMessage("assistant", `Request failed: ${err.message}`);
  }
});

/* ----- event delegation for product selection and remove pills ----- */
productsContainer.addEventListener("click", (e) => {
  const toggle = e.target.closest('[data-action="toggle"]');
  if (toggle) {
    const id = toggle.getAttribute("data-id");
    toggleSelection(id);
    return;
  }

  const infoBtn = e.target.closest('[data-action="info"]');
  if (infoBtn) {
    // toggle expanded description without selecting the card
    const id = infoBtn.getAttribute("data-id");
    const card = productsContainer.querySelector(
      `.product-card[data-id="${id}"]`
    );
    if (!card) return;
    const desc = card.querySelector(".product-desc");
    const expanded = card.classList.toggle("expanded");
    // set ARIA attributes for accessibility
    infoBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (desc) desc.setAttribute("aria-hidden", expanded ? "false" : "true");
    return;
  }

  const card = e.target.closest(".product-card");
  if (card) {
    const id = card.getAttribute("data-id");
    toggleSelection(id);
  }
});

document
  .getElementById("selectedProductsList")
  .addEventListener("click", (e) => {
    const remove = e.target.closest(".remove-pill");
    if (remove) {
      const id = remove.getAttribute("data-id");
      toggleSelection(id);
    }
  });

// initialize selected list placeholder
renderSelectedProductsList();

/* ----- generate routine (send selected products to OpenAI via Cloudflare worker) ----- */
const generateBtn = document.getElementById("generateRoutine");

// small helper to append messages to the chat window
function appendChatMessage(role, text) {
  const el = document.createElement("div");
  el.className = `chat-message chat-${role}`;
  // escape HTML then convert newlines to <br>
  const escaped = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = escaped.replace(/\n/g, "<br />");
  el.innerHTML = `<strong>${
    role === "assistant" ? "Routine" : role
  }:</strong><div class="chat-text">${html}</div>`;
  chatWindow.appendChild(el);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function generateRoutine() {
  // Make sure there are selected products
  if (selectedIds.size === 0) {
    appendChatMessage(
      "user",
      "Please select one or more products before generating a routine."
    );
    return;
  }

  // Resolve selected products from the cached product list
  const selectedProducts = Array.from(selectedIds)
    .map((id) => findProductById(id))
    .filter(Boolean)
    .map((p) => ({
      name: p.name,
      brand: p.brand,
      category: p.category,
      description: p.description,
    }));

  // The page can define the worker URL in secrets.js as window.CLOUDFLARE_WORKER_URL
  const endpoint = window.CLOUDFLARE_WORKER_URL || window.OPENAI_PROXY_URL;
  if (!endpoint) {
    appendChatMessage(
      "assistant",
      "No Cloudflare worker URL configured. Please set `window.CLOUDFLARE_WORKER_URL` in `secrets.js` to your proxy/worker endpoint."
    );
    return;
  }

  // initialize conversation history for this routine and include the products
  const systemMessage = {
    role: "system",
    content:
      "You are a helpful, concise beauty advisor that writes clear step-by-step routines using only the provided products. Keep recommendations practical and mention when to use each product (AM/PM or morning/night) and any short tips. Only answer questions related to routine, skincare, haircare, makeup, fragrance, or related topics.",
  };

  const userMessage = {
    role: "user",
    content: `Here are the selected products (JSON array). Create a personalized routine that uses these products and explain the steps clearly. Return a human-readable routine.\n\nProducts:\n${JSON.stringify(
      selectedProducts,
      null,
      2
    )}`,
  };

  // reset conversation and seed with system + user for the routine
  conversationMessages.length = 0;
  conversationMessages.push(systemMessage, userMessage);
  const messages = conversationMessages;

  // Show a loading message
  generateBtn.disabled = true;
  const originalText = generateBtn.textContent;
  generateBtn.textContent = "Generating…";

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, model: "gpt-4o" }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      appendChatMessage(
        "assistant",
        `Error from worker: ${resp.status} — ${text}`
      );
      return;
    }

    const data = await resp.json();

    // Prefer the common Chat API shape
    const aiText =
      data?.choices?.[0]?.message?.content ||
      data?.result ||
      data?.text ||
      JSON.stringify(data);

    appendChatMessage("assistant", aiText);
    // save assistant reply so follow-ups include it
    conversationMessages.push({ role: "assistant", content: aiText });
  } catch (err) {
    appendChatMessage("assistant", `Request failed: ${err.message}`);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = originalText;
  }
}

if (generateBtn) {
  generateBtn.addEventListener("click", generateRoutine);
}

// wire up clear all button
const clearBtn = document.getElementById("clearSelections");
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    selectedIds.clear();
    saveSelectedToStorage();
    renderSelectedProductsList();
    updateCardSelectionState();
  });
}

// initialize: load products cache and restore saved selections
(async function init() {
  try {
    allProductsCache = await loadProducts();
  } catch (e) {
    console.warn("Failed to load products on init", e);
  }
  loadSelectedFromStorage();
  // render selected list with names (requires products cache)
  renderSelectedProductsList();
  updateCardSelectionState();
})();
