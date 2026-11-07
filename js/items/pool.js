/* 角色池：每个角色在 1v1 里算一个"整体"，可以包含多个单位（units 数组）。
   新增角色：在这里加一项 + 在 js/items/ 下建对应文件；卡片与选人会自动生成。 */
'use strict';

// 角色池：每个角色在 1v1 里算一个"整体"，可以包含多个单位
// 新增角色：在 POOL 里加一项；卡片与选人逻辑会自动生成
var POOL = [
  {
    key: 'duo',
    name: '红石块 + 青金石块',
    short: '红青组合',
    role: '羁绊组合',
    units: ['red', 'lapis'],
    body: '#c8342b',
    glow: '#ff5a44'
  },
  {
    key: 'spear',
    name: '长矛',
    short: '长矛',
    role: '单点爆发',
    units: ['spear'],
    body: '#b9c4d4',
    glow: '#cfe0ff'
  },
  {
    key: 'bow',
    name: '弓箭',
    short: '弓箭',
    role: '远程持续',
    units: ['bow'],
    body: '#5f8f4a',
    glow: '#a4e86b'
  },
  {
    key: 'ice',
    name: '冰块',
    short: '冰块',
    role: '控制 / 续航',
    units: ['ice'],
    body: '#6fd3e8',
    glow: '#9beeff'
  },
  {
    key: 'dog',
    name: '大狗',
    short: '大狗',
    role: '远程 / 压制',
    units: ['dog'],
    body: '#b5723a',
    glow: '#ffb765'
  },
  {
    key: 'grass',
    name: '草',
    short: '草',
    role: '召唤 / 控制',
    units: ['grass'],
    body: '#5fbf5a',
    glow: '#9be36f'
  },
  {
    key: 'anvil',
    name: '铁砧',
    short: '铁砧',
    role: '延迟爆发 / 区域压制',
    units: ['anvil'],
    body: '#8b98ab',
    glow: '#c6d7ee'
  },
  {
    key: 'milk',
    name: '野生狗奶',
    short: '狗奶',
    role: '全域压制 / 引导',
    units: ['milk'],
    body: '#e6cfa8',
    glow: '#ffe0a0',
    img: 'assets/milk.png'
  }
];
var POOL_BY_KEY = {};
for (var pi = 0; pi < POOL.length; pi++) POOL_BY_KEY[POOL[pi].key] = POOL[pi];
