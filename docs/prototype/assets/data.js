// Invented sample data for the prototype. Every mod, author and number here is made up.
// The shape is what the website's index would hold for each mod: edgemods.json from the mod's repository,
// plus what EDGEmods adds (downloads, likes, what the downloads contain, moderation).
(function () {
  const NOW = Date.parse('2026-10-17T12:00:00Z');
  const day = 86400000;
  const ago = (d) => new Date(NOW - d * day).toISOString();
  const MB = 1024 * 1024;

  // Frameworks most Cyberpunk 2077 mods need, as external requirements (links outside EDGEmods).
  const ext = {
    archivexl: { name: 'ArchiveXL', url: 'https://www.nexusmods.com/cyberpunk2077/mods/4198' },
    tweakxl: { name: 'TweakXL', url: 'https://www.nexusmods.com/cyberpunk2077/mods/4197' },
    red4ext: { name: 'RED4ext', url: 'https://www.nexusmods.com/cyberpunk2077/mods/2380' },
    cet: { name: 'Cyber Engine Tweaks', url: 'https://www.nexusmods.com/cyberpunk2077/mods/107' },
    redscript: { name: 'redscript', url: 'https://www.nexusmods.com/cyberpunk2077/mods/1511' },
  };

  const mods = [
    {
      id: 'neon-rain-weather', name: 'Neon Rain Weather', type: 'visual', author: ['Kessler Vane', 'kvane'],
      summary: 'Heavier, slower rain with neon reflections that pool on every street in Night City.',
      tags: ['weather', 'lighting', 'night-city'], version: '2.4.0', game: '2.31', license: 'CC-BY-4.0',
      downloads: 48210, likes: 3920, published: 210, updated: 2, kinds: { archive: 3, tweak: 2 },
      req: [ext.archivexl, ext.tweakxl],
      files: [
        { name: 'neon-rain-weather-2.4.0.zip', role: 'required', title: 'Main file', size: 182 * MB },
        { name: 'neon-rain-lite-2.4.0.zip', role: 'optional', title: 'Lighter puddles', size: 12 * MB, note: 'Fewer reflections, for older graphics cards.' },
      ],
      releases: [['2.4.0', 2, ['Puddles fade out more gently at dawn.', 'Fixed rain inside the Afterlife.']], ['2.3.1', 40, ['Works with game 2.31.']], ['2.0.0', 210, ['First release on EDGEmods.']]],
    },
    {
      id: 'street-cred-overhaul', name: 'Street Cred Overhaul', type: 'gameplay', author: ['Mara Okafor', 'mokafor'],
      summary: 'Street cred is earned by how you play, not by grinding gigs: style, risk and reputation in each district.',
      tags: ['progression', 'reputation', 'balance'], version: '1.8.2', game: '2.31', license: 'MIT',
      downloads: 31877, likes: 2611, published: 160, updated: 6, kinds: { redscript: 14, tweak: 6 },
      req: [ext.redscript, ext.tweakxl, { mod: 'nc-core-lib', minVersion: '1.2.0' }],
      files: [{ name: 'street-cred-overhaul-1.8.2.zip', role: 'required', title: 'Main file', size: 1.4 * MB }],
      releases: [['1.8.2', 6, ['District reputation shows on the map.']], ['1.8.0', 30, ['New: reputation decays slowly if you leave a district.']]],
    },
    {
      id: 'kabuki-night-market', name: 'Kabuki Night Market', type: 'world', author: ['Tomo Ishikawa', 'tishikawa'],
      summary: 'Forty new stalls, vendors and crowds fill the Kabuki market after dark.',
      tags: ['kabuki', 'vendors', 'crowds', 'night-city'], version: '1.1.0', game: '2.31', license: 'CC-BY-NC-4.0',
      downloads: 9220, likes: 1404, published: 3, updated: 3, kinds: { archive: 6, tweak: 3, other: 2 },
      req: [ext.archivexl, ext.tweakxl],
      files: [{ name: 'kabuki-night-market-1.1.0.zip', role: 'required', title: 'Main file', size: 340 * MB }],
      releases: [['1.1.0', 3, ['First release on EDGEmods.']]],
    },
    {
      id: 'arasaka-tactical-wear', name: 'Arasaka Tactical Wear', type: 'clothing', author: ['Nyx Calloway', 'octo-modder'],
      summary: 'A full set of corporate tactical clothing in five colours, for every body type.',
      tags: ['arasaka', 'outfits', 'corporate'], version: '3.0.1', game: '2.31', license: 'All rights reserved',
      downloads: 22140, likes: 2980, published: 95, updated: 11, kinds: { archive: 2, tweak: 1 },
      req: [ext.archivexl, ext.tweakxl],
      files: [
        { name: 'arasaka-tactical-wear-3.0.1.zip', role: 'required', title: 'Clothing', size: 96 * MB },
        { name: 'arasaka-tactical-body-a-3.0.1.zip', role: 'choose-one', group: 'Body', title: 'Body A (vanilla)', size: 8 * MB, note: 'The game\'s own body shape.' },
        { name: 'arasaka-tactical-body-b-3.0.1.zip', role: 'choose-one', group: 'Body', title: 'Body B (athletic)', size: 8 * MB },
        { name: 'arasaka-tactical-body-c-3.0.1.zip', role: 'choose-one', group: 'Body', title: 'Body C (curvy)', size: 8 * MB },
        { name: 'arasaka-tactical-colours-3.0.1.zip', role: 'optional', title: 'Extra colours', size: 22 * MB, note: 'Five more colours for each piece.' },
      ],
      releases: [['3.0.1', 11, ['Fixed the jacket clipping with long hair.']], ['3.0.0', 50, ['New: body type C.', 'Every piece re-fitted.']], ['2.2.0', 95, ['First release on EDGEmods.']]],
    },
    {
      id: 'quadra-turbo-r-v8', name: 'Quadra Turbo-R V8', type: 'vehicles', author: ['Diego Restrepo', 'drestrepo'],
      summary: 'A rebuilt V8 for the Quadra Turbo-R: new engine sound, handling and a drivable street version.',
      tags: ['cars', 'quadra', 'handling', 'sound'], version: '1.3.0', game: '2.31', license: 'MIT',
      downloads: 17003, likes: 2204, published: 70, updated: 1, kinds: { archive: 2, tweak: 4, audio: 18 },
      req: [ext.archivexl, ext.tweakxl],
      files: [{ name: 'quadra-turbo-r-v8-1.3.0.zip', role: 'required', title: 'Main file', size: 128 * MB }],
      releases: [['1.3.0', 1, ['Smoother gear changes.']], ['1.2.0', 33, ['New: street version at the dealer.']]],
    },
    {
      id: 'smart-gun-rework', name: 'Smart Gun Rework', type: 'weapons', author: ['Kessler Vane', 'kvane'],
      summary: 'Smart guns track, curve and lock on the way the lore says they should, with honest damage.',
      tags: ['smart-weapons', 'balance', 'combat'], version: '0.9.0', game: '2.31', license: 'MIT',
      downloads: 6110, likes: 745, published: 5, updated: 5, kinds: { redscript: 6, tweak: 8 },
      req: [ext.redscript, ext.tweakxl],
      files: [{ name: 'smart-gun-rework-0.9.0.zip', role: 'required', title: 'Main file', size: 0.6 * MB }],
      releases: [['0.9.0', 5, ['First release on EDGEmods.']]],
    },
    {
      id: 'radio-free-pacifica', name: 'Radio Free Pacifica', type: 'audio', author: ['Ines Moreau', 'imoreau'],
      summary: 'A new radio station of original synthwave from Pacifica\'s pirate DJs, with talk breaks.',
      tags: ['radio', 'music', 'pacifica'], version: '1.0.0', game: '2.31', license: 'CC-BY-SA-4.0',
      downloads: 4380, likes: 980, published: 1, updated: 1, kinds: { audio: 64, archive: 1 },
      req: [ext.archivexl, { mod: 'nc-radio-framework' }],
      files: [{ name: 'radio-free-pacifica-1.0.0.zip', role: 'required', title: 'Main file', size: 410 * MB }],
      releases: [['1.0.0', 1, ['First release.']]],
    },
    {
      id: 'nc-radio-framework', name: 'NC Radio Framework', type: 'modding-resource', author: ['Ines Moreau', 'imoreau'],
      summary: 'Lets mods add radio stations to cars and the radioport. Needed by station mods.',
      tags: ['radio', 'framework', 'library'], version: '2.1.0', game: '2.31', license: 'MIT',
      downloads: 39911, likes: 1120, published: 300, updated: 20, kinds: { plugin: 1, redscript: 4 }, runsCode: ['red4ext/plugins/nc_radio/nc_radio.dll'],
      req: [ext.red4ext, ext.redscript],
      files: [{ name: 'nc-radio-framework-2.1.0.zip', role: 'required', title: 'Main file', size: 2.2 * MB }],
      releases: [['2.1.0', 20, ['Stations can have talk breaks.']], ['2.0.0', 120, ['Rewritten as a RED4ext plugin.']]],
    },
    {
      id: 'nc-core-lib', name: 'NC Core Library', type: 'modding-resource', author: ['Mara Okafor', 'mokafor'],
      summary: 'Shared scripts other mods build on: events, settings pages and save data.',
      tags: ['library', 'framework', 'scripting'], version: '1.4.0', game: '2.31', license: 'MIT',
      downloads: 61002, likes: 1730, published: 340, updated: 14, kinds: { redscript: 22, cet: 3 },
      req: [ext.redscript, ext.cet],
      files: [{ name: 'nc-core-lib-1.4.0.zip', role: 'required', title: 'Main file', size: 0.3 * MB }],
      releases: [['1.4.0', 14, ['Settings pages can have sliders.']]],
    },
    {
      id: 'clean-hud', name: 'Clean HUD', type: 'ui', author: ['Pell Anders', 'panders'],
      summary: 'Hides the HUD until you need it: health when hurt, ammo when aiming, the map when driving.',
      tags: ['hud', 'immersion', 'minimal'], version: '4.2.0', game: '2.31', license: 'MIT',
      downloads: 55230, likes: 4870, published: 400, updated: 9, kinds: { redscript: 9, cet: 2 },
      req: [ext.redscript, ext.cet, { mod: 'nc-core-lib' }],
      files: [{ name: 'clean-hud-4.2.0.zip', role: 'required', title: 'Main file', size: 0.2 * MB }],
      releases: [['4.2.0', 9, ['The minimap shows briefly when a quest updates.']]],
    },
    {
      id: 'judy-photo-mode-poses', name: 'Photo Mode Poses: Pacifica', type: 'characters', author: ['Rhea Takes', 'rtakes'],
      summary: 'Sixty new photo mode poses for one and two characters, shot around Pacifica.',
      tags: ['photo-mode', 'poses'], version: '1.2.0', game: '2.31', license: 'CC-BY-NC-4.0',
      downloads: 12880, likes: 1990, published: 120, updated: 45, kinds: { archive: 1, other: 1 },
      req: [ext.archivexl, ext.cet],
      files: [{ name: 'photo-mode-poses-pacifica-1.2.0.zip', role: 'required', title: 'Main file', size: 31 * MB }],
      releases: [['1.2.0', 45, ['Twenty duo poses.']]],
    },
    {
      id: 'the-heist-reprise', name: 'The Heist: Reprise', type: 'quests', author: ['Tomo Ishikawa', 'tishikawa'],
      summary: 'A new side job after the heist: three hours of quest with voiced calls and new locations.',
      tags: ['quest', 'side-job', 'story'], version: '1.0.2', game: '2.31', license: 'CC-BY-NC-4.0',
      downloads: 7740, likes: 1612, published: 12, updated: 4, kinds: { archive: 4, audio: 120, redscript: 3 },
      req: [ext.archivexl, ext.redscript, { mod: 'nc-core-lib' }],
      files: [{ name: 'the-heist-reprise-1.0.2.zip', role: 'required', title: 'Main file', size: 620 * MB }],
      releases: [['1.0.2', 4, ['Fixed a call that did not end.']], ['1.0.0', 12, ['First release.']]],
    },
    {
      id: 'loadout-saver', name: 'Loadout Saver', type: 'utility', author: ['Pell Anders', 'panders'],
      summary: 'Save and swap whole loadouts — weapons, cyberware and clothes — with one key.',
      tags: ['inventory', 'quality-of-life'], version: '1.6.0', game: '2.31', license: 'MIT',
      downloads: 20341, likes: 2150, published: 260, updated: 30, kinds: { cet: 5 },
      req: [ext.cet],
      files: [{ name: 'loadout-saver-1.6.0.zip', role: 'required', title: 'Main file', size: 0.1 * MB }],
      releases: [['1.6.0', 30, ['Loadouts can include cyberware.']]],
    },
    {
      id: 'dense-crowds', name: 'Dense Crowds', type: 'gameplay', author: ['Diego Restrepo', 'drestrepo'],
      summary: 'More people and traffic on the streets, tuned district by district so the game stays smooth.',
      tags: ['crowds', 'traffic', 'immersion', 'night-city'], version: '2.0.0', game: '2.31', license: 'MIT',
      downloads: 41870, likes: 3330, published: 380, updated: 8, kinds: { tweak: 3, plugin: 1 }, runsCode: ['red4ext/plugins/dense_crowds/dense_crowds.dll'],
      req: [ext.red4ext, ext.tweakxl],
      files: [
        { name: 'dense-crowds-2.0.0.zip', role: 'required', title: 'Main file', size: 1.1 * MB },
        { name: 'dense-crowds-high-2.0.0.zip', role: 'choose-one', group: 'Density', title: 'High', size: 0.1 * MB },
        { name: 'dense-crowds-ultra-2.0.0.zip', role: 'choose-one', group: 'Density', title: 'Ultra', size: 0.1 * MB, note: 'Needs a fast processor.' },
      ],
      releases: [['2.0.0', 8, ['Now a RED4ext plugin: crowds change with the time of day.']]],
    },
    {
      id: 'chrome-skin-shaders', name: 'Chrome Skin Shaders', type: 'visual', author: ['Rhea Takes', 'rtakes'],
      summary: 'Better metal and chrome on cyberware, with wear, scratches and reflections.',
      tags: ['cyberware', 'shaders', 'materials'], version: '1.0.0', game: '2.31', license: 'CC-BY-4.0',
      downloads: 1210, likes: 320, published: 0.5, updated: 0.5, kinds: { archive: 2 },
      req: [ext.archivexl],
      files: [{ name: 'chrome-skin-shaders-1.0.0.zip', role: 'required', title: 'Main file', size: 260 * MB }],
      releases: [['1.0.0', 0.5, ['First release.']]],
    },
    {
      id: 'afterlife-after-hours', name: 'Afterlife After Hours', type: 'world', author: ['Nyx Calloway', 'octo-modder'],
      summary: 'The Afterlife at 4 a.m.: new regulars, conversations and music once the main crowd leaves.',
      tags: ['afterlife', 'ambience', 'npcs'], version: '0.4.0', game: '2.31', license: 'All rights reserved', adult: true,
      downloads: 3020, likes: 610, published: 18, updated: 18, kinds: { archive: 3, audio: 22 },
      req: [ext.archivexl, ext.tweakxl],
      files: [{ name: 'afterlife-after-hours-0.4.0.zip', role: 'required', title: 'Main file', size: 150 * MB }],
      releases: [['0.4.0', 18, ['First release on EDGEmods.']]],
    },
    {
      id: 'trauma-team-response', name: 'Trauma Team Response', type: 'gameplay', author: ['Mara Okafor', 'mokafor'],
      summary: 'Trauma Team flies in for platinum clients in fights near you, and they do not like witnesses.',
      tags: ['police', 'combat', 'immersion'], version: '1.0.0', game: '2.31', license: 'MIT',
      downloads: 2410, likes: 540, published: 1.5, updated: 1.5, kinds: { redscript: 7, archive: 1 },
      req: [ext.redscript, ext.archivexl, { mod: 'nc-core-lib', minVersion: '1.4.0' }],
      files: [{ name: 'trauma-team-response-1.0.0.zip', role: 'required', title: 'Main file', size: 44 * MB }],
      releases: [['1.0.0', 1.5, ['First release.']]],
    },
    {
      id: 'netrunner-suit-pack', name: 'Netrunner Suit Pack', type: 'clothing', author: ['Kessler Vane', 'kvane'],
      summary: 'Six netrunner suits with glowing traces that react to quickhacks.',
      tags: ['netrunner', 'outfits'], version: '1.1.0', game: '2.31', license: 'CC-BY-NC-4.0',
      downloads: 14550, likes: 2075, published: 140, updated: 60, kinds: { archive: 2, tweak: 1 },
      req: [ext.archivexl, ext.tweakxl],
      files: [{ name: 'netrunner-suit-pack-1.1.0.zip', role: 'required', title: 'Main file', size: 210 * MB }],
      releases: [['1.1.0', 60, ['Traces pulse when a quickhack uploads.']]],
    },
  ];

  const people = {
    kvane: 'Kessler Vane', mokafor: 'Mara Okafor', tishikawa: 'Tomo Ishikawa', 'octo-modder': 'Nyx Calloway',
    drestrepo: 'Diego Restrepo', imoreau: 'Ines Moreau', panders: 'Pell Anders', rtakes: 'Rhea Takes',
  };

  const shaped = mods.map((m, i) => {
    const [authorName, github] = m.author;
    const required = m.files.filter((f) => f.role === 'required');
    const firstChoice = m.files.find((f) => f.role === 'choose-one');
    return {
      ...m,
      author: { name: authorName, github },
      repo: `https://github.com/${github}/${m.id}`,
      adult: Boolean(m.adult),
      runsCode: m.runsCode ?? [],
      publishedAt: ago(m.published),
      updatedAt: ago(m.updated),
      size: required.reduce((n, f) => n + f.size, 0) + (firstChoice ? firstChoice.size : 0),
      gallery: 3 + (i % 3),
      releases: m.releases.map(([version, d, notes]) => ({ version, date: ago(d), notes })),
      requirements: m.req,
      status: 'visible',
      reports: m.id === 'smart-gun-rework' ? 1 : 0,
      scannedAt: ago(m.updated),
      sha256: Array.from({ length: 64 }, (_, k) => '0123456789abcdef'[(i * 7 + k * 13) % 16]).join(''),
    };
  });

  const users = [
    { name: 'Vee Morales', email: 'vee@example.com', via: 'Email', role: 'player', joined: ago(40), seen: ago(0.1), status: 'active' },
    { name: 'Nyx Calloway', email: 'nyx@example.com', via: 'GitHub · octo-modder', role: 'modder', joined: ago(120), seen: ago(0.3), status: 'active' },
    { name: 'Kessler Vane', email: 'k@example.com', via: 'GitHub · kvane', role: 'modder', joined: ago(300), seen: ago(1), status: 'active' },
    { name: 'spamlord9000', email: 'x@example.net', via: 'Google', role: 'player', joined: ago(2), seen: ago(1.5), status: 'blocked' },
    { name: 'Mara Okafor', email: 'mara@example.com', via: 'GitHub · mokafor', role: 'modder', joined: ago(330), seen: ago(0.8), status: 'active' },
    { name: 'Jun Park', email: 'jun@example.com', via: 'Google', role: 'player', joined: ago(9), seen: ago(3), status: 'active' },
  ];

  const blocklist = [
    { what: 'GitHub account', who: 'mod-reupload-bot', reason: 'Re-uploading other people\'s mods', by: 'admin@edgemods.ai', at: ago(12) },
    { what: 'Repository', who: 'cheap-mods/free-dlc', reason: 'Malware found in a release', by: 'admin@edgemods.ai', at: ago(30) },
    { what: 'Site account', who: 'spamlord9000', reason: 'Spam reports', by: 'admin@edgemods.ai', at: ago(1) },
  ];

  const audit = [
    { at: ago(0.2), who: 'admin@edgemods.ai', what: 'Added the tag "adult" to Afterlife After Hours' },
    { at: ago(1), who: 'admin@edgemods.ai', what: 'Blocked site account spamlord9000' },
    { at: ago(3), who: 'registry checks', what: 'Merged Kabuki Night Market 1.1.0 (all checks passed)' },
    { at: ago(5), who: 'registry checks', what: 'Merged Smart Gun Rework 0.9.0 (all checks passed)' },
    { at: ago(12), who: 'admin@edgemods.ai', what: 'Blocked GitHub account mod-reupload-bot' },
  ];

  const reports = [
    { mod: 'smart-gun-rework', by: 'Jun Park', reason: 'Crashes on start with game 2.31', at: ago(0.6) },
  ];

  window.EDGEMODS_DATA = { NOW, mods: shaped, people, users, blocklist, audit, reports };
})();
