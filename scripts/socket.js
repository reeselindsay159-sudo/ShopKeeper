import { MODULE_ID, SOCKET_NAME } from "./constants.js";
import { getShop, getShops, saveShopsRaw } from "./shop-data.js";
import { currencyToCopper, gpToCopper, copperToCurrency, copperToGp } from "./currency.js";

const pendingRequests = new Map();
const REQUEST_TIMEOUT_MS = 15000;

export function initSocket() {
  game.socket.on(SOCKET_NAME, onSocketMessage);
}

function onSocketMessage(message) {
  if (!message?.action) return;
  if (message.action === "purchase-request") {
    // Only a single, elected GM client processes purchase requests so that
    // stock/currency changes never happen twice.
    if (!game.user.isGM) return;
    if (game.users.activeGM?.id !== game.user.id) return;
    handlePurchaseRequest(message);
  } else if (message.action === "purchase-result") {
    if (message.targetUserId !== game.user.id) return;
    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingRequests.delete(message.requestId);
    pending.resolve(message);
  }
}

/**
 * Called from a player's (or GM's own) client to request a purchase.
 * Resolves with {success, reason, data} — never rejects on a "normal" failure
 * like insufficient coin, only rejects if no GM is available or the request
 * times out.
 */
export async function requestPurchase({ shopId, actorId, cart }) {
  if (!game.users.activeGM) {
    return { success: false, reason: "no-gm" };
  }

  const requestId = foundry.utils.randomID();

  const resultPromise = new Promise(resolve => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve({ success: false, reason: "timeout" });
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve, timeout });
  });

  game.socket.emit(SOCKET_NAME, {
    action: "purchase-request",
    requestId,
    userId: game.user.id,
    actorId,
    shopId,
    cart
  });

  return resultPromise;
}

/**
 * GM-side authoritative handler. Validates stock and coin against the
 * server-side (world setting) shop data and the actor's real currency,
 * applies the transaction, posts a chat summary, and replies to the buyer.
 */
async function handlePurchaseRequest(message) {
  const { requestId, userId, actorId, shopId, cart } = message;
  const reply = (success, reason, data) => {
    game.socket.emit(SOCKET_NAME, {
      action: "purchase-result",
      requestId,
      targetUserId: userId,
      success,
      reason,
      data
    });
  };

  try {
    const shops = getShops();
    const shop = shops[shopId];
    if (!shop) return reply(false, "no-shop");

    const actor = game.actors.get(actorId);
    if (!actor) return reply(false, "no-actor");

    if (!Array.isArray(cart) || !cart.length) return reply(false, "empty-cart");

    // Resolve + validate every cart line against the authoritative shop data.
    const lines = [];
    for (const line of cart) {
      const qty = Math.max(0, Math.floor(Number(line.qty) || 0));
      if (!qty) continue;
      const entry = shop.inventory.find(i => i.id === line.entryId);
      if (!entry) return reply(false, "invalid-item");
      const hasLimitedStock = entry.quantity >= 0;
      if (hasLimitedStock && entry.quantity < qty) {
        return reply(false, "insufficient-stock", { name: entry.name });
      }
      lines.push({ entry, qty });
    }
    if (!lines.length) return reply(false, "empty-cart");

    const totalCopper = lines.reduce((sum, { entry, qty }) => sum + gpToCopper(entry.price) * qty, 0);
    const currentCopper = currencyToCopper(actor.system.currency);
    if (currentCopper < totalCopper) {
      return reply(false, "insufficient-coin", {
        cost: copperToGp(totalCopper),
        have: copperToGp(currentCopper)
      });
    }

    // -- Everything validated: apply the transaction. --

    // 1) Decrement stock on shops in limited supply, persist world data.
    for (const { entry, qty } of lines) {
      if (entry.quantity >= 0) entry.quantity = Math.max(0, entry.quantity - qty);
    }
    await saveShopsRaw(shops);

    // 2) Deduct currency.
    const newCurrency = copperToCurrency(currentCopper - totalCopper);
    await actor.update({ "system.currency": newCurrency });

    // 3) Grant items, merging into existing stacks bought from this same
    // shop entry when possible.
    const toCreate = [];
    for (const { entry, qty } of lines) {
      const existing = actor.items.find(i => i.getFlag(MODULE_ID, "entryId") === entry.id);
      if (existing) {
        const newQty = (Number(existing.system.quantity) || 0) + qty;
        await existing.update({ "system.quantity": newQty });
      } else {
        const itemData = foundry.utils.deepClone(entry.itemData);
        delete itemData._id;
        foundry.utils.setProperty(itemData, "system.quantity", qty);
        foundry.utils.setProperty(itemData, `flags.${MODULE_ID}`, { shopId, entryId: entry.id });
        toCreate.push(itemData);
      }
    }
    if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);

    // 4) Announce the sale to everyone.
    const totalGp = copperToGp(totalCopper);
    const itemLines = lines
      .map(({ entry, qty }) => `<li>${qty} &times; ${entry.name} (${(entry.price * qty).toLocaleString()} gp)</li>`)
      .join("");
    const content = `
      <div class="shopkeeper-chat-receipt">
        <h3>${game.i18n.format("SHOPKEEPER.Chat.PurchaseHeader", { buyer: actor.name, shop: shop.name })}</h3>
        <ul>${itemLines}</ul>
        <p><strong>${game.i18n.format("SHOPKEEPER.Chat.TotalPaid", { cost: totalGp.toLocaleString() })}</strong></p>
      </div>`;
    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor })
    });

    return reply(true, null, {
      total: totalGp,
      items: lines.map(({ entry, qty }) => ({ name: entry.name, qty, cost: entry.price * qty }))
    });
  } catch (err) {
    console.error(`${MODULE_ID} |`, err);
    return reply(false, "error");
  }
}
