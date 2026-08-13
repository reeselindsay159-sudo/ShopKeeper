# Shopkeeper

An in-game shop interface module for Foundry VTT (v13+) and the dnd5e system.

## Features

- A new **Shop** control category at the bottom of the left-hand scene control toolbar.
  - **Open Shop** — visible to everyone. Opens the Market: a scrollable list of shops.
  - **Edit Shops** — GM only. Opens the shop admin panel.
- **Market window** — thick horizontal rows, one per shop, each with an image, name, and short description. Click a row to open that shop.
- **Individual shop window** — shop image on the left, a 4-column inventory table (item, cost, quantity, add-to-cart) on the right, and a cart at the bottom with quantity steppers, per-line removal, a running total, and a Checkout button.
- **Checkout** deducts gold (auto-converting across pp/gp/ep/sp/cp) from the player's assigned character, adds the purchased items to their inventory, and posts a receipt to chat for the whole table to see. If they can't afford it, they get a "Not enough Coin" popup instead — nothing is charged.
- **Edit Shops (GM)** — create/delete shops, toggle whether a shop is visible to players, set its image/name/description, and drag & drop items from the sidebar, a compendium, or an actor sheet straight into its inventory. Each inventory row has an editable price (gp) and quantity, plus an "unlimited stock" checkbox.

## Installation

1. In Foundry's **Add-on Modules** tab, choose **Install Module**.
2. Since this isn't published to the package registry, use **Manifest URL** if you host `module.json` somewhere, or simply unzip the delivered `shopkeeper.zip` into your `Data/modules/` folder (so you end up with `Data/modules/shopkeeper/module.json`).
3. Enable **Shopkeeper** in your world's Module Management.

## Using it

**As GM:**
1. Click the shop icon at the bottom of the scene control toolbar, then **Edit Shops**.
2. Click **New Shop**, give it a name/description/image, and check **Visible to players** when you're ready to open it for business.
3. Drag items into the drop zone (from the Items sidebar tab, a compendium, or directly off an actor sheet) to stock the shop. Set price (in gp) and quantity per item — check the infinity box for unlimited stock.
4. Click **Save**.

**As a player (or GM):**
1. Click the shop icon, then **Open Shop** to see the Market.
2. Click a shop row to open it, add items to your cart, and hit **Checkout**. Your character (`game.user.character`) needs to be assigned for this to work — ask your GM if you don't have one.

## Notes on how it works

- Shop data lives in a world setting, editable only by a GM client (that's a Foundry permission rule, not a module choice).
- Because of that, checkout is processed by whichever GM client Foundry currently considers the "active GM" (`game.users.activeGM`) via the module's socket channel: it re-validates stock and coin server-side, applies the transaction, and reports back to the buyer. If no GM is online, players will be told a GM needs to be online to complete a purchase.
- Currency conversion for checkout uses the standard 5e rates (1 pp = 10 gp = 2 ep = 100 sp = 1000 cp) and always re-composes the remainder using the fewest coins (maximizing higher denominations).

## Compatibility

Targets Foundry VTT v13+ (built/tested against v14) and the dnd5e system (2014 rules data model: `actor.system.currency`, `item.system.price.value`, `item.system.quantity`).
