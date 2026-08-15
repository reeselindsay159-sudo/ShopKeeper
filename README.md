# Shopkeeper

An in-game shop interface module for Foundry VTT (v13+) and the dnd5e system.

## Features

- A new **Shop** control category at the bottom of the left-hand scene control toolbar.
  - **Open Shop** — visible to everyone. Opens the Market: a scrollable list of shops.
  - **Edit Shops** — GM only. Opens the shop admin panel.
- **Market window** — thick horizontal rows, one per shop, each with an image, name, and short description. Click a row to open that shop.
- **Individual shop window** — shop image on the left, a 4-column inventory table (item, cost, quantity, add-to-cart) on the right, and a cart at the bottom with quantity steppers, per-line removal, a running total, and a Checkout button.
- **Checkout** deducts gold (auto-converting across pp/gp/ep/sp/cp) from the player's assigned character, adds the purchased items to their inventory, and posts a receipt to chat for the whole table to see. If they can't afford it, they get a "Not enough Coin" popup instead — nothing is charged.
- **Edit Shops (GM)** — create/delete shops, toggle whether a shop is visible to players, set its image/name/description/accent colour, and drag & drop items from the sidebar, a compendium, or an actor sheet straight into its inventory. Each inventory row has an editable price (gp) and quantity, plus an "unlimited stock" checkbox.
- **Market themes** — nine visual styles for the Market's shop rows, picked by the GM under **Edit Shops → Market Theme**. The picker previews each theme using your own shop art, and the choice applies to everyone in the world.
- **Inventory tools** — populate a shop by rolling on any rollable table, auto-generate prices for magic items by rarity, and clear a shop's stock in one click.
- **Image framing** — zoom and pan each shop's artwork, framed separately for the shop page and the Market banner.

## Image framing

**Edit Shops → Image Framing** gives each shop two independent crops of the same source image:

- **Shop image** — the square crop. Used by *both* the shop page portrait and the shop thumbnail in the Market row, since they are the same picture in the same shape. Editing it moves both.
- **Market banner** — the wide crop. Used only by themes that stretch the artwork across the whole row (Cinematic, Purple Haze).

The banner can also use a **completely different image** from the shop. In the Market banner pane, choose *Use a different image* to pick one, or clear it to fall back to the shop image. This is the better option when your shop art is a portrait or icon that will never crop well into a wide strip.

Drag inside a preview to pan, scroll over it or use the slider to zoom (1x–4x), and press the reset arrow to return to fit. Dragging moves the picture 1:1 with the cursor.

**Fit whole image** (per frame) switches from filling the frame to fitting inside it, so nothing is ever cropped. Because that leaves a gap on one axis, the gap is filled with a blurred, darkened copy of the same picture rather than bare letterbox bars. Use it when the art's shape doesn't match the frame's — a tall portrait in the square shop image, for instance — and you'd rather see all of it than crop it.

The whole image is reachable. Images are laid out to cover the frame, so a square image in a wide banner already extends far above and below it even at 1x — panning brings that hidden part into view, and stops exactly when the image's edge meets the frame's, so empty space is never exposed.

Pan is stored as a fraction of the available travel rather than in pixels or percent-of-frame, so a crop looks the same on a player's screen as it did in the editor, whatever size their window is.

Framing is stored per shop and applies for every player. Shops made before this version default to 1x with no pan, which is exactly how they looked previously.

## Inventory tools

Each of these sits above the inventory list in the shop editor. All three edit the working copy — **nothing is written to the world until you press Save**, so a mis-click is undone by switching shops and discarding.

**Roll from table.** Pick a rollable table, set how many items you want, and press Load. It keeps rolling until it has that many *items*, so text entries mixed into a loot table don't eat your count, and nested tables resolve normally. Duplicates stack into a single row rather than repeating. You can also drag a rollable table straight onto the drop zone.

This uses `RollTable#roll()` rather than `draw()`, which means **your tables are never modified** — results are not flagged as drawn, so a "draw without replacement" table is left exactly as you set it up.

**Generate Prices.** Rolls a price for every item currently at 0 gp (or with no price at all), based on its magic-item rarity. Items that already have a price are left alone.

| Rarity | Magic item | Consumable |
| --- | --- | --- |
| Common | 1d4 × 50 gp | 1d4 × 25 gp |
| Uncommon | 1d6 × 100 gp | 1d6 × 50 gp |
| Rare | 1d6 × 1,000 gp | 1d6 × 500 gp |
| Very rare | 1d6 × 10,000 gp | 1d6 × 5,000 gp |
| Legendary / artifact | 1d6 × 100,000 gp | 1d6 × 50,000 gp |

An item counts as a consumable when its document type is `consumable` (potions, scrolls, ammunition). Legendary and artifact were not part of the original spec — they continue the same ×10 progression purely so that legendary loot can never sit in a shop at 0 gp, where players could take it for free. To change any of this, edit `RARITY_PRICING` at the top of `scripts/pricing.js`; nothing else needs touching.

Mundane gear has no rarity in dnd5e, so it can't be priced from this table and stays at 0 gp. Those items are called out by name in a warning, highlighted in the inventory list, and flagged with a banner — because **an item at 0 gp is free at checkout**.

**Clear Shop.** Removes every item from the current shop, after a confirmation showing how many will go.

### Spells become spell scrolls

In dnd5e a spell is an Item, so a spell sitting on a loot table would otherwise drop into a shop as a raw spell — unpriced, and useless to a player who bought it. Any spell rolled off a table (or dragged onto the drop zone) is converted into a **spell scroll** instead, using the system's own `createScrollFromSpell` so the scroll carries the right description, save DC and attack bonus for its level. If that API is unavailable the module builds an equivalent consumable itself, so a roll is never silently dropped.

Scroll price is **base cost for the spell's level, plus the cost of any material components** the spell requires:

| Spell level | Base | | Spell level | Base |
| --- | --- | --- | --- | --- |
| Cantrip | 50 gp | | 5th | 2,500 gp |
| 1st | 50 gp | | 6th | 25,000 gp |
| 2nd | 250 gp | | 7th | 25,000 gp |
| 3rd | 250 gp | | 8th | 25,000 gp |
| 4th | 2,500 gp | | 9th | 50,000 gp |

So a scroll of *Revivify* (3rd level, 300 gp diamond) prices at 250 + 300 = 550 gp. The base table is the DMG's suggested purchase prices for consumables; to switch to Xanathar's crafting costs instead, edit `SCROLL_BASE_PRICE` at the top of `scripts/scrolls.js` — the alternative numbers are written out in the comment there. Scrolls are priced on creation, so Generate Prices leaves them alone.

## Market themes

| Theme | Look |
| --- | --- |
| Cinematic Banner | Full-bleed art behind a dark scrim, with a slow zoom on hover |
| Illuminated Tome | Parchment and gilt rules, like a page from a spellbook |
| Hanging Shop Sign | Carved wood and brass rivets that sway when hovered |
| Arcane Glass | Frosted glass with a coloured halo and a light sweep |
| Tavern Chalkboard | Slate in a wooden frame, chalked by hand |
| Heraldic Banner | Hanging cloth with a shield badge in the shop's colours |
| Stained Glass | Leaded cathedral panes lit from behind |
| Purple Haze | Drifting violet mist over the storefront — dark fantasy / Drakkenheim |
| Black Market Crate | Stencilled smuggler's crate with iron banding |

Four themes (Cinematic, Arcane Glass, Heraldic Banner, Stained Glass) use each shop's **accent colour**, set per shop in the editor. Purple Haze animates continuously; it respects the OS "reduce motion" accessibility preference and stops animating when that is enabled.

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
