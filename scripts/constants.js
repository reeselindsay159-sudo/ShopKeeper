export const MODULE_ID = "shopkeeper";

export const SETTINGS = {
  SHOPS: "shops"
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
