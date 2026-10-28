export type Faction = 'player' | 'enemy' | 'creep' | 'neutral';
export type UnitKind = 'worker' | 'melee' | 'ranged' | 'hero' | 'siege';

export interface UnitDef {
  id: string;
  name: string;
  kind: UnitKind;
  hp: number;
  speed: number;
  damage: number;
  armor: number;
  range: number; // Abstand zwischen den Rändern
  cooldown: number;
  radius: number;
  sight: number;
  gold: number;
  wood: number;
  supply: number;
  trainTime: number;
  xpValue: number;
  bounty?: number; // Gold für den Töter (Kreaturen)
  requires?: string; // Gebäude, das gebaut sein muss
  icon: string;
  desc: string;
  look: UnitLook;
}

/** Zeichenstil einer Einheit (siehe render.ts) */
export interface UnitLook {
  body: string; // Rumpf/Tabard (Teamfarbe mischt sich ein)
  skin: string;
  trim: string; // Zweitfarbe: Hose, Kapuze, Rüstungsdetails
  weapon: 'pick' | 'sword' | 'bow' | 'greatsword' | 'claw' | 'spit' | 'lance' | 'catapult' | 'bite' | 'club' | 'bonehurler' | 'none';
  head: 'cap' | 'helm' | 'hood' | 'crown' | 'bare' | 'skull' | 'horns' | 'none';
  shield?: boolean;
  cape?: string;
  scale: number;
  shape?: 'biped' | 'beast' | 'blob' | 'machine';
  glow?: string;
}

export interface BuildingDef {
  id: string;
  name: string;
  hp: number;
  armor: number;
  size: number; // Kacheln (quadratisch)
  gold: number;
  wood: number;
  buildTime: number;
  trains: string[];
  upgrades?: string[];
  supply: number;
  sight: number;
  color: string;
  icon: string;
  desc: string;
  isHall?: boolean;
  attack?: { damage: number; range: number; cooldown: number };
  style: 'keep' | 'barracks' | 'homestead' | 'tower' | 'forge' | 'crypt' | 'pit' | 'mound' | 'spire';
}

export interface UpgradeDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  levels: { gold: number; wood: number; time: number }[];
}

const PLAYER_SKIN = '#e8c39e';
const UNDEAD_SKIN = '#9aa58a';

export const UNITS: Record<string, UnitDef> = {
  // Spieler: Die Aschenmark
  worker: {
    id: 'worker', name: 'Arbeiter', kind: 'worker', hp: 60, speed: 78, damage: 5, armor: 0, range: 18, cooldown: 1.2, radius: 9, sight: 180, gold: 60, wood: 0, supply: 1, trainTime: 11, xpValue: 20, icon: '⛏️',
    desc: 'Sammelt Gold und Holz, errichtet Gebäude.', look: { body: '#8a6a3a', skin: PLAYER_SKIN, trim: '#5a4630', weapon: 'pick', head: 'cap', scale: 0.9 },
  },
  swordsman: {
    id: 'swordsman', name: 'Schwertkämpfer', kind: 'melee', hp: 160, speed: 80, damage: 12, armor: 2, range: 22, cooldown: 1.1, radius: 11, sight: 220, gold: 90, wood: 10, supply: 2, trainTime: 14, xpValue: 40, icon: '🗡️',
    desc: 'Robuster Nahkämpfer mit Schild.', look: { body: '#4f6fa6', skin: PLAYER_SKIN, trim: '#9aa6b8', weapon: 'sword', head: 'helm', shield: true, scale: 1 },
  },
  ranger: {
    id: 'ranger', name: 'Waldläuferin', kind: 'ranged', hp: 85, speed: 85, damage: 11, armor: 0, range: 160, cooldown: 1.3, radius: 10, sight: 260, gold: 80, wood: 30, supply: 2, trainTime: 15, xpValue: 40, icon: '🏹',
    desc: 'Fernkämpferin mit großer Reichweite.', look: { body: '#4a7a3a', skin: PLAYER_SKIN, trim: '#2e4a24', weapon: 'bow', head: 'hood', cape: '#355a2a', scale: 0.95 },
  },
  knight: {
    id: 'knight', name: 'Ritter', kind: 'melee', hp: 280, speed: 112, damage: 19, armor: 4, range: 24, cooldown: 1.2, radius: 13, sight: 230, gold: 170, wood: 40, supply: 3, trainTime: 20, xpValue: 70, requires: 'forge', icon: '🐎',
    desc: 'Schneller, schwer gepanzerter Reiter. Benötigt Schmiede.', look: { body: '#8c93a8', skin: PLAYER_SKIN, trim: '#5a4a30', weapon: 'lance', head: 'helm', shield: true, cape: '#8a2a2a', scale: 1.15, shape: 'beast' },
  },
  catapult: {
    id: 'catapult', name: 'Katapult', kind: 'siege', hp: 150, speed: 55, damage: 45, armor: 1, range: 230, cooldown: 3.2, radius: 14, sight: 260, gold: 180, wood: 130, supply: 3, trainTime: 26, xpValue: 70, requires: 'forge', icon: '🪨',
    desc: 'Belagerungswaffe: dreifacher Schaden gegen Gebäude, schwach gegen Einheiten.', look: { body: '#7a5a34', skin: '#7a5a34', trim: '#3a2a18', weapon: 'catapult', head: 'none', scale: 1.2, shape: 'machine' },
  },
  warden: {
    id: 'warden', name: 'Wächterin', kind: 'hero', hp: 420, speed: 92, damage: 22, armor: 3, range: 26, cooldown: 0.9, radius: 13, sight: 280, gold: 250, wood: 0, supply: 0, trainTime: 20, xpValue: 150, icon: '⭐',
    desc: 'Heldin. Steigt mit Erfahrung auf. Fähigkeiten: Erdstoß und Segen.', look: { body: '#d9b24a', skin: PLAYER_SKIN, trim: '#f2e3a0', weapon: 'greatsword', head: 'crown', cape: '#7a1f2a', scale: 1.15, glow: 'rgba(255,220,120,.55)' },
  },
  // Gegner: Die Hohle Legion
  husk: {
    id: 'husk', name: 'Hülle', kind: 'melee', hp: 130, speed: 82, damage: 11, armor: 1, range: 22, cooldown: 1.1, radius: 11, sight: 220, gold: 0, wood: 0, supply: 2, trainTime: 10, xpValue: 40, icon: '💀',
    desc: 'Nahkämpfer der Hohlen Legion.', look: { body: '#4f5a46', skin: UNDEAD_SKIN, trim: '#2a2e22', weapon: 'claw', head: 'skull', scale: 1 },
  },
  spitter: {
    id: 'spitter', name: 'Speier', kind: 'ranged', hp: 80, speed: 80, damage: 9, armor: 0, range: 150, cooldown: 1.4, radius: 10, sight: 240, gold: 0, wood: 0, supply: 2, trainTime: 12, xpValue: 40, icon: '🧪',
    desc: 'Fernkämpfer der Hohlen Legion.', look: { body: '#6a3f7a', skin: '#8a6fa0', trim: '#3a1f4a', weapon: 'spit', head: 'none', scale: 1, shape: 'blob', glow: 'rgba(170,90,220,.45)' },
  },
  ravager: {
    id: 'ravager', name: 'Verheerer', kind: 'melee', hp: 320, speed: 86, damage: 21, armor: 3, range: 26, cooldown: 1.3, radius: 14, sight: 220, gold: 0, wood: 0, supply: 3, trainTime: 18, xpValue: 80, icon: '👹',
    desc: 'Schwere Einheit der Hohlen Legion.', look: { body: '#5a2a30', skin: '#7a7060', trim: '#2a1418', weapon: 'club', head: 'horns', scale: 1.25 },
  },
  bonehurler: {
    id: 'bonehurler', name: 'Knochenwerfer', kind: 'siege', hp: 140, speed: 55, damage: 40, armor: 1, range: 220, cooldown: 3.4, radius: 14, sight: 250, gold: 0, wood: 0, supply: 3, trainTime: 24, xpValue: 70, icon: '🦴',
    desc: 'Belagerungsgerät der Hohlen Legion.', look: { body: '#6a6256', skin: '#6a6256', trim: '#2e2a24', weapon: 'bonehurler', head: 'none', scale: 1.2, shape: 'machine' },
  },
  revenant: {
    id: 'revenant', name: 'Wiedergänger', kind: 'hero', hp: 460, speed: 88, damage: 25, armor: 4, range: 26, cooldown: 1.0, radius: 13, sight: 280, gold: 0, wood: 0, supply: 0, trainTime: 20, xpValue: 200, icon: '👑',
    desc: 'Held der Hohlen Legion.', look: { body: '#2a2434', skin: '#b0b0c0', trim: '#8a3a5a', weapon: 'greatsword', head: 'crown', cape: '#3a1030', scale: 1.15, glow: 'rgba(200,60,120,.5)' },
  },
  // Kreaturen
  wolf: {
    id: 'wolf', name: 'Aschenwolf', kind: 'melee', hp: 90, speed: 105, damage: 9, armor: 0, range: 18, cooldown: 0.9, radius: 10, sight: 200, gold: 0, wood: 0, supply: 0, trainTime: 0, xpValue: 35, bounty: 12, icon: '🐺',
    desc: 'Rudeltier, bewacht Minen.', look: { body: '#6e6a66', skin: '#6e6a66', trim: '#3a3634', weapon: 'bite', head: 'none', scale: 0.9, shape: 'beast' },
  },
  brute: {
    id: 'brute', name: 'Felsschrat', kind: 'melee', hp: 380, speed: 75, damage: 24, armor: 2, range: 26, cooldown: 1.5, radius: 15, sight: 200, gold: 0, wood: 0, supply: 0, trainTime: 0, xpValue: 120, bounty: 60, icon: '🪨',
    desc: 'Steinhäutiger Riese, bewacht reiche Minen.', look: { body: '#7a6e5a', skin: '#8e8470', trim: '#4a4034', weapon: 'club', head: 'bare', scale: 1.4 },
  },
};

export const BUILDINGS: Record<string, BuildingDef> = {
  keep: { id: 'keep', name: 'Bergfried', hp: 1000, armor: 5, size: 3, gold: 320, wood: 180, buildTime: 70, trains: ['worker', 'warden'], supply: 10, sight: 260, color: '#b8a98a', icon: '🏰', desc: 'Hauptgebäude. Nimmt Rohstoffe an, bildet Arbeiter aus, belebt die Heldin wieder.', isHall: true, style: 'keep' },
  barracks: { id: 'barracks', name: 'Kaserne', hp: 650, armor: 3, size: 3, gold: 160, wood: 70, buildTime: 45, trains: ['swordsman', 'ranger', 'knight', 'catapult'], supply: 0, sight: 220, color: '#9c7b5c', icon: '⚔️', desc: 'Bildet Truppen aus. Ritter und Katapult benötigen eine Schmiede.', style: 'barracks' },
  homestead: { id: 'homestead', name: 'Gehöft', hp: 280, armor: 1, size: 2, gold: 80, wood: 30, buildTime: 25, trains: [], supply: 6, sight: 160, color: '#c9b36b', icon: '🌾', desc: 'Erhöht die Versorgung um 6.', style: 'homestead' },
  tower: { id: 'tower', name: 'Wachturm', hp: 420, armor: 4, size: 2, gold: 110, wood: 70, buildTime: 35, trains: [], supply: 0, sight: 300, color: '#8d8d99', icon: '🗼', desc: 'Verteidigungsturm mit Fernangriff.', attack: { damage: 16, range: 190, cooldown: 1.4 }, style: 'tower' },
  forge: { id: 'forge', name: 'Schmiede', hp: 520, armor: 3, size: 3, gold: 140, wood: 80, buildTime: 40, trains: [], upgrades: ['attack', 'armor'], supply: 0, sight: 200, color: '#6e5a4a', icon: '⚒️', desc: 'Erforscht Waffen- und Rüstungsverbesserungen, schaltet Ritter und Katapult frei.', style: 'forge' },
  crypt: { id: 'crypt', name: 'Gruft', hp: 1300, armor: 5, size: 3, gold: 0, wood: 0, buildTime: 1, trains: ['revenant'], supply: 10, sight: 260, color: '#4a4458', icon: '🪦', desc: 'Hauptgebäude der Hohlen Legion. Zerstöre es, um zu siegen.', isHall: true, style: 'crypt' },
  pit: { id: 'pit', name: 'Brutgrube', hp: 650, armor: 3, size: 3, gold: 0, wood: 0, buildTime: 1, trains: ['husk', 'spitter', 'ravager', 'bonehurler'], supply: 0, sight: 220, color: '#5a3f55', icon: '🕳️', desc: 'Bringt die Truppen der Legion hervor.', style: 'pit' },
  mound: { id: 'mound', name: 'Grabhügel', hp: 280, armor: 1, size: 2, gold: 0, wood: 0, buildTime: 1, trains: [], supply: 6, sight: 160, color: '#5c5a4a', icon: '⚰️', desc: 'Versorgung der Hohlen Legion.', style: 'mound' },
  spire: { id: 'spire', name: 'Knochenturm', hp: 420, armor: 4, size: 2, gold: 0, wood: 0, buildTime: 1, trains: [], supply: 0, sight: 300, color: '#6e6a7a', icon: '🦴', desc: 'Verteidigungsturm der Hohlen Legion.', attack: { damage: 15, range: 180, cooldown: 1.5 }, style: 'spire' },
};

export const UPGRADES: Record<string, UpgradeDef> = {
  attack: { id: 'attack', name: 'Waffen schärfen', icon: '⚔️', desc: '+2 Schaden für alle Kampfeinheiten je Stufe.', levels: [{ gold: 100, wood: 60, time: 40 }, { gold: 160, wood: 100, time: 55 }, { gold: 240, wood: 150, time: 70 }] },
  armor: { id: 'armor', name: 'Rüstung härten', icon: '🛡️', desc: '+1 Rüstung für alle Einheiten je Stufe.', levels: [{ gold: 100, wood: 60, time: 40 }, { gold: 160, wood: 100, time: 55 }, { gold: 240, wood: 150, time: 70 }] },
};

export const PLAYER_BUILD_ORDER = ['homestead', 'barracks', 'forge', 'tower', 'keep'];

export const ABILITIES = {
  shockwave: { id: 'shockwave', name: 'Erdstoß', icon: '💥', radius: 115, baseDamage: 45, perLevel: 12, cooldown: 18, desc: 'Schaden an allen Feinden im Umkreis.' },
  blessing: { id: 'blessing', name: 'Segen', icon: '✨', radius: 150, baseHeal: 60, perLevel: 15, cooldown: 26, desc: 'Heilt Verbündete im Umkreis.' },
};

export const HERO_XP_PER_LEVEL = 120;
export const HERO_MAX_LEVEL = 10;
export const MAX_SUPPLY = 80;
export const CARRY_AMOUNT = 10;
export const GOLD_MINE_TIME = 3;
export const WOOD_CHOP_TIME = 4;
export const DAY_LENGTH = 240; // Sekunden für einen vollen Tag/Nacht-Zyklus
export const SIEGE_BUILDING_MULT = 3;
export const SIEGE_UNIT_MULT = 0.5;

export const FACTION_COLOR: Record<Faction, string> = {
  player: '#3d8bff',
  enemy: '#d9403a',
  creep: '#d9a23a',
  neutral: '#c9c9c9',
};

export function hostile(a: Faction, b: Faction) {
  return a !== b && a !== 'neutral' && b !== 'neutral';
}
