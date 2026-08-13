export const MODULE_ID = "shopkeeper";

export const SETTINGS = {
  SHOPS: "shops",
  THEME: "marketTheme"
};

export const SOCKET_NAME = `module.${MODULE_ID}`;

// Standard D&D5e coin conversion, expressed in copper pieces (the smallest unit).
export const CP_PER_DENOMINATION = {
  pp: 1000,
  gp: 100,
  ep: 50,
  sp: 10,
  cp: 1
};

// Order used when greedily re-composing a copper total back into denominations.
export const DENOMINATION_ORDER = ["pp", "gp", "ep", "sp", "cp"];

/**
 * Selectable visual themes for the Market window's shop rows.
 * `accent: true` means the theme visibly uses each shop's accent colour, so the
 * theme picker surfaces that hint to the GM.
 */
export const MARKET_THEMES = {
  cinematic: { id: "cinematic", label: "SHOPKEEPER.Themes.Cinematic", hint: "SHOPKEEPER.Themes.CinematicHint", accent: true },
  tome: { id: "tome", label: "SHOPKEEPER.Themes.Tome", hint: "SHOPKEEPER.Themes.TomeHint", accent: false },
  sign: { id: "sign", label: "SHOPKEEPER.Themes.Sign", hint: "SHOPKEEPER.Themes.SignHint", accent: false },
  arcane: { id: "arcane", label: "SHOPKEEPER.Themes.Arcane", hint: "SHOPKEEPER.Themes.ArcaneHint", accent: true },
  chalk: { id: "chalk", label: "SHOPKEEPER.Themes.Chalk", hint: "SHOPKEEPER.Themes.ChalkHint", accent: false },
  banner: { id: "banner", label: "SHOPKEEPER.Themes.Banner", hint: "SHOPKEEPER.Themes.BannerHint", accent: true },
  glass: { id: "glass", label: "SHOPKEEPER.Themes.Glass", hint: "SHOPKEEPER.Themes.GlassHint", accent: true },
  haze: { id: "haze", label: "SHOPKEEPER.Themes.Haze", hint: "SHOPKEEPER.Themes.HazeHint", accent: false },
  crate: { id: "crate", label: "SHOPKEEPER.Themes.Crate", hint: "SHOPKEEPER.Themes.CrateHint", accent: false }
};

export const DEFAULT_THEME = "haze";

export const DEFAULT_ACCENT = "#c661ff";

/** Themes whose rows animate continuously, so the GM can be warned / opt out. */
export const ANIMATED_THEMES = new Set(["haze"]);
