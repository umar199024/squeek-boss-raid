/* Squeek Boss Raid · configuration
 * Every address below was read back on Sepolia (chain 11155111) on 2026-11-05:
 * token.mining() -> mining, mining.core() -> core, core.configuration().genesisTimestamp.
 * Squeekchain's Sepolia deployment is in active development and has been re-deployed
 * more than once, so the game does not trust a single core: it reads all known ones
 * and merges their certified rounds by wall-clock slot (see js/chain.js).
 */
(function (root) {
  "use strict";

  const CONFIG = {
    chainId: 11155111,
    chainIdHex: "0xaa36a7",
    chainName: "Sepolia",

    api: "https://api.squeekchain.com/v1",

    // JSON-RPC endpoints with browser CORS, tried in order.
    rpcs: [
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://sepolia.drpc.org",
      "https://1rpc.io/sepolia",
      "https://rpc.sepolia.org",
    ],
    // publicnode keeps only about 12k blocks of logs; older roster history comes from
    // Blockscout's free, keyless, CORS-enabled Etherscan-style API.
    blockscoutApi: "https://eth-sepolia.blockscout.com/api",
    explorer: "https://sepolia.etherscan.io",
    recentLogBlocks: 9000, // eth_getLogs window per request on the public RPC

    // Known Squeekchain deployments (newest first).
    deployments: [
      {
        id: "core-sepolia-20261103",
        core: "0xFD6C166D4B8E2962E65746a13e5a0797CD4dE0c4",
        token: "0xd78a3956cF63164d1Fa1C622ad3c66623162Fa1e",
        mining: "0x2dCcB11fcC2dEfdd188555e45aCb52231e82e218",
        source: "api.squeekchain.com /v1/core + /v1/economy/state (installation sepolia-core-sepolia-20261103)",
      },
      {
        id: "stream-game-sepolia",
        core: "0x980B4424c007CAf7a1f3670B48c8EaEf7EbC3d44",
        token: "0x5501E1Fa81Be1c3F49225fa7668DA0245d07Db60",
        mining: "0xcd46990f8349057335289Ef282c276204B6CDC62",
        source: "verified on-chain: SQK.mining() -> SqueekMining, SqueekMining.core() -> SqueekCore",
      },
      {
        id: "docs-sepolia (launch)",
        core: "0x74665dAecA35A2303e767E76a2FF1FB6F93e119f",
        token: "0x6872BfA5CcC3E9e440C6c16e5fFdAbb8DBA4Cc76",
        mining: "0x3beE588fC20dE788Bac17d33b41Da7346cb27EC4",
        source: "docs.squeekchain.com/developers (Deployments, sepolia-env.sh)",
      },
    ],

    // The raid's sigil: the spender in every Raid Order approve().
    // = last 20 bytes of keccak256("squeek-boss-raid:sigil:v1"). Nobody holds a key for it;
    // it exists only so the game can filter Approval logs by topic2.
    sigil: "0x4EC63CB72aD4701A640370A59c73c16431D3e330",

    // Raid calendar: Season 1 week 1 starts Monday 2026-10-26 00:00 UTC.
    epoch: 1792972800,
    weekSeconds: 604800,
    slotSeconds: 600,
    slotsPerWeek: 1008,

    pollStatusMs: 15000,
    pollChainMs: 45000,
    pollRosterMs: 60000,
  };

  // Weekly bosses, rotating by week number. HP is in wheel work units (accepted
  // wheel-magnet passes), the unit SqueekCore records.
  CONFIG.bosses = [
    { key: "cat", name: "The Cat", title: "Whisker Tyrant", hp: 42000,
      taunt: "It sits. It stares. It waits for the wheel to stop.",
      colors: ["#f39a3d", "#c4651d", "#ffd27a"] },
    { key: "vacuum", name: "The Vacuum", title: "Dust Devourer", hp: 48000,
      taunt: "VRRRRRMMM. Every seed in this cage is mine.",
      colors: ["#7b6cf6", "#4b3fc0", "#c9c2ff"] },
    { key: "vet", name: "The Vet", title: "Dr. Needles", hp: 36000,
      taunt: "Just a little pinch. Hold still, small one.",
      colors: ["#e9f1f7", "#9bb4c6", "#5ad1c5"] },
    { key: "bath", name: "The Bath", title: "Soap Kraken", hp: 44000,
      taunt: "Hamsters don't bathe? Tonight they do.",
      colors: ["#59b8f0", "#2c7bc0", "#d6f2ff"] },
    { key: "bowl", name: "The Empty Bowl", title: "Famine Dish", hp: 40000,
      taunt: "Nothing left. Nothing at all. Run for it.",
      colors: ["#e45b6a", "#a3303f", "#ffd0d6"] },
    { key: "owl", name: "The Owl", title: "Midnight Talon", hp: 52000,
      taunt: "Who runs at night? Who-who?",
      colors: ["#8a6a4a", "#5a4130", "#f5d36b"] },
  ];

  // Party classes. The id (1-4) is the class digit encoded in a Raid Order.
  CONFIG.classes = [
    { id: 1, key: "warrior", name: "Wheel Warrior", icon: "⚔", color: "#ff7a45",
      blurb: "Smash specialist. Assists on Smash rounds count ×1.5 and correct Smash calls score ×1.5." },
    { id: 2, key: "mage", name: "Seed Mage", icon: "✦", color: "#a77bff",
      blurb: "Precision caster. Correct Jab calls score ×1.5 and the crit streak grows twice as fast." },
    { id: 3, key: "tank", name: "Cheek Pouch Tank", icon: "⛨", color: "#ffc93c",
      blurb: "Soaks the boss. All assists count ×1.25 and a wrong call never breaks the streak." },
    { id: 4, key: "healer", name: "Nap Healer", icon: "✚", color: "#4fd6a2",
      blurb: "Guards the sleep. Correct Nap calls score ×3, plus Second Wind when he wakes from a long nap." },
  ];

  // Round outcomes, from the round's certified work.
  CONFIG.outcomes = [
    { id: 1, key: "nap", name: "Nap", short: "Z", rule: "0 work", base: 10 },
    { id: 2, key: "jab", name: "Jab", short: "J", rule: "1–399 work", base: 100 },
    { id: 3, key: "smash", name: "Smash", short: "S", rule: "400+ work", base: 120 },
  ];
  CONFIG.smashThreshold = 400;

  // 12x12 pixel icons for the classes (rows of a 12-wide grid; "#" = ink, "o" = light).
  CONFIG.icons = {
    warrior: ["..........##", ".........#o#", "........#o#.", ".......#o#..", "......#o#...", ".#...#o#....", "..#.#o#.....", "...#o#......", "..#.##......", ".#o#..#.....", "#o#.........", "##.........."],
    mage:    [".....##.....", ".....##.....", "....#oo#....", "##########..", ".#oooooo#...", "..#oooo#....", "..#o##o#....", ".#o#..#o#...", ".##....##...", "............", "........#...", ".......###.."],
    tank:    ["############", "#oooooooooo#", "#oooooooooo#", "#ooo####ooo#", "#ooo#oo#ooo#", "#ooo#oo#ooo#", ".#oo####oo#.", ".#oooooooo#.", "..#oooooo#..", "...#oooo#...", "....#oo#....", ".....##....."],
    healer:  ["....####....", "....#oo#....", "....#oo#....", "....#oo#....", "#####oo#####", "#oooooooooo#", "#oooooooooo#", "#####oo#####", "....#oo#....", "....#oo#....", "....#oo#....", "....####...."],
  };
  CONFIG.iconSvg = function (key, size) {
    const rows = CONFIG.icons[key] || [];
    let d1 = "", d2 = "";
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      if (ch === "#") d1 += `M${x} ${y}h1v1h-1z`;
      else if (ch === "o") d2 += `M${x} ${y}h1v1h-1z`;
    }));
    return `<svg viewBox="0 0 12 12" width="${size || 18}" height="${size || 18}" shape-rendering="crispEdges" aria-hidden="true"><path d="${d1}" fill="#2a1630"/><path d="${d2}" fill="#fff"/></svg>`;
  };

  root.SBR_CONFIG = CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
