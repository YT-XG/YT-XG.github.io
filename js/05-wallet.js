/* ============================================================
   05-wallet.js —— 全局金币 / 每日赠送 / 玩家姓名存档
   ------------------------------------------------------------
   · 金币是「全局」的：单机押注与赛事押注共用同一份余额
   · 每天首次打开自动送 1000（按本地日期判断，只补一次）
   · 玩家姓名存 localStorage，开赛时直接沿用，避免重复填写
   只做存取，不碰 DOM；界面在 js/80-mobi.js 与 js/60-tournament.js
   ============================================================ */
'use strict';

var COIN_KEY = 'mcduel.coins.v1';
var COIN_START = 1000;      // 新玩家初始金币
var COIN_GIFT = 1000;       // 每日赠送

var coinState = { coins: COIN_START, gift: '' };

function coinsToday() {
  var d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function coinsLoad() {
  try {
    var raw = localStorage.getItem(COIN_KEY);
    if (!raw) return;
    var d = JSON.parse(raw);
    if (!d) return;
    coinState.coins = Math.max(0, Math.round(d.coins || 0));
    coinState.gift = d.gift || '';
  } catch (e) {}
}

function coinsSave() {
  try { localStorage.setItem(COIN_KEY, JSON.stringify(coinState)); } catch (e) {}
}

function coinsGet() { return coinState.coins; }

function coinsSet(n) {
  coinState.coins = Math.max(0, Math.round(n || 0));
  coinsSave();
}

function coinsAdd(n) {
  coinsSet(coinsGet() + n);
}

/* 返回本次实际赠送的金币（0 = 今天已领过） */
function coinsDailyGift() {
  var today = coinsToday();
  if (coinState.gift === today) return 0;
  coinState.gift = today;
  coinsAdd(COIN_GIFT);
  coinsSave();
  return COIN_GIFT;
}

coinsLoad();
var COIN_GIFTED = coinsDailyGift();

/* ---------- 自定义玩家姓名 ---------- */
var DUEL_NAMES_KEY = 'mcduel.names.v1';

function duelNamesGet() {
  try {
    var raw = localStorage.getItem(DUEL_NAMES_KEY);
    if (!raw) return null;
    var a = JSON.parse(raw);
    return (a && a.length) ? a : null;
  } catch (e) { return null; }
}

function duelNamesSet(a) {
  try { localStorage.setItem(DUEL_NAMES_KEY, JSON.stringify(a || [])); } catch (e) {}
}

/* ---------- 赛季 / 成绩存档 ----------
   浏览器保存：姓名 + 赛季 + 排名 + 分数（每人每赛季一行）
   重开同一赛季时，用新成绩覆盖该赛季旧行，避免重复 */
var RECORD_KEY = 'mcduel.records.v1';
var seasonState = { season: 1, rows: [] };

function recordsLoad() {
  try {
    var raw = localStorage.getItem(RECORD_KEY);
    if (!raw) return;
    var d = JSON.parse(raw);
    if (!d) return;
    seasonState.season = Math.max(1, Math.round(d.season || 1));
    seasonState.rows = (d.rows && d.rows.length) ? d.rows : [];
  } catch (e) {}
}

function recordsSave() {
  try { localStorage.setItem(RECORD_KEY, JSON.stringify(seasonState)); } catch (e) {}
}

function seasonGet() { return seasonState.season; }

function seasonNext() {
  seasonState.season++;
  recordsSave();
  return seasonState.season;
}

function recordsGet() { return seasonState.rows.slice(); }

function recordsSaveSeason(season, rows) {
  seasonState.rows = seasonState.rows.filter(function (r) { return r.season !== season; });
  seasonState.rows = seasonState.rows.concat(rows || []);
  if (seasonState.rows.length > 800) seasonState.rows = seasonState.rows.slice(-800);
  recordsSave();
}

recordsLoad();

