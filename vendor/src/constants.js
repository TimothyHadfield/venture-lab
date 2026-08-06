// constants.js — Global application state and utilities. Not L0 — contains runtime state used across all layers.

let colorblindMode=localStorage.getItem(CONFIG.storagePrefix+'-colorblind')==='true';
let highContrastMode=localStorage.getItem(CONFIG.storagePrefix+'-highcontrast')==='true';
// Call initHighContrast() after DOM ready
function initHighContrast(){
  highContrastMode=localStorage.getItem(CONFIG.storagePrefix+'-highcontrast')==='true';
  // Emit event for rendering layer to handle DOM changes
  if (typeof emit === 'function') {
    emit('highContrastModeChange', highContrastMode);
  }
}
let liveScoreEnabled=localStorage.getItem(CONFIG.storagePrefix+'-livescore')!=='false'; // on by default
let deckCountEnabled=localStorage.getItem(CONFIG.storagePrefix+'-deckcount')!=='false'; // on by default
let matchScore={you:0,opp:0};
let matchFirstPlayer='player1'; // alternates each rematch

let myId=null, userSlot=null, roomCode=null, roomRef=null, gameState=null;
let selectedCard=null, listeners=[];
let spreadPile=null; // {who:'my'|'opp', color:'red'} — which pile is spread out
let collapsingPile=null; // pile still floating at spread z while its collapse animation lands
let variant='classic'; // 'classic' or 'single'
let isAIGame=false;
let aiPersonality='expert'; // default AI personality — Sage (only opponent in the picker, CEO 2026-07-22)
let lastPlayedCard=null; // {card, from:'expedition'|'discard'|'single', color} for undo
// Sticky per-game flag: once an "unfair" undo (one that reveals hidden info —
// re-drawing after seeing the opponent's move, or a multi-turn rewind) is used,
// this game earns no ELO and no achievements for the rest of the game. Reset on
// newGame. In AI games it is set locally by the tiered undo; in multiplayer it
// mirrors the SHARED game.unranked flag synced through Firebase (see multiplayer.js).
let gameUnranked=false;
// Multiplayer pre-game opt-in: when true, a room created here starts undo-enabled
// AND unranked for BOTH players. Toggled on the Game Setup sheet (online mode).
let allowUndosSetting=false;

// Variant helper — check if using single shared discard pile
function useSinglePile(){return CONFIG.variants[variant].discardPiles===1}

// Venture count — dynamically set 4, 5, or 6 colors
function setVentureCount(n){
  n=Math.max(4,Math.min(6,n));
  CONFIG.ventureCount=n;
  CONFIG.colors=CONFIG.allColors.slice(0,n);
  if(typeof document!=='undefined'){
    document.documentElement.style.setProperty('--num-colors',n);
  }
}


// Premium status — PREMIUM_DEFAULT=true during dev (all features unlocked).
// Flip to false for freemium launch. Purchase system sets localStorage flag.
const PREMIUM_DEFAULT = true; // flip to false for freemium launch
function isPremium() {
  return localStorage.getItem(CONFIG.storagePrefix + '-premium') === 'true' || PREMIUM_DEFAULT;
}
function setPremium(val) {
  localStorage.setItem(CONFIG.storagePrefix + '-premium', val ? 'true' : 'false');
}

// Firebase strips empty arrays — this safely gets nested arrays
function getCards(obj, ...keys){
  let v=obj;
  for(const k of keys){if(!v||typeof v!=='object')return[];v=v[k]}
  return Array.isArray(v)?v:[];
}

function genId(){return Math.random().toString(36).substr(2,9)}

// Sound loaded from src/sound.js, animations from src/animations.js
function genRoomCode(){const c='ABCDEFGHJKLMNPQRSTUVWXYZ';let r='';for(let i=0;i<4;i++)r+=c[Math.floor(Math.random()*c.length)];return r}
// ===== TURN NOTIFICATIONS =====
function requestNotificationPermission(){
  if('Notification' in window && Notification.permission==='default'){
    Notification.requestPermission();
  }
}
function notifyTurn(){
  if('Notification' in window && Notification.permission==='granted'){
    try{new Notification('Venture',{body:"It's your turn!",icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="%23d4a843"/><text x="16" y="22" text-anchor="middle" font-size="18">%E2%9C%A6</text></svg>'});}catch(e){}
  }
}


