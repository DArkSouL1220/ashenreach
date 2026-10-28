export type Faction = 'player' | 'enemy' | 'neutral';
export type UnitKind = 'worker' | 'melee' | 'ranged' | 'hero';

export interface UnitDef {
  id: string;
  name: string;
  kind: UnitKind;
  hp: number;
  speed: number;
  damage: number;
  range: number; // Abstand zwischen den Rändern
  cooldown: number;
  radius: number;
  sight: number;
  gold: number;
  wood: number;
  supply: number;
  trainTime: number;
  color: string;
  xpValue: number;
  icon: string;
  desc: string;
}

export interface BuildingDef {
  id: string;
  name: string;
  hp: number;
  size: number; // Kacheln (quadratisch)
  gold: number;
  wood: number;
  buildTime: number;
  trains: string[];
  supply: number;
  sight: number;
  color: string;
  icon: string;
  desc: string;
  isHall?: boolean;
  attack?: { damage: number; range: number; cooldown: number };
}

export const UNITS: Record<string, UnitDef> = {
  // Spieler: Die Aschenmark
  worker: { id: 'worker', name: 'Arbeiter', kind: 'worker', hp: 60, speed: 78, damage: 5, range: 18, cooldown: 1.2, radius: 9, sight: 180, gold: 60, wood: 0, supply: 1, trainTime: 11, color: '#d9b38c', xpValue: 20, icon: '⛏️', desc: 'Sammelt Gold und Holz, errichtet Gebäude.' },
  swordsman: { id: 'swordsman', name: 'Schwertkämpfer', kind: 'melee', hp: 150, speed: 80, damage: 12, range: 22, cooldown: 1.1, radius: 11, sight: 220, gold: 90, wood: 10, supply: 2, trainTime: 14, color: '#8fb4d9', xpValue: 40, icon: '🗡️', desc: 'Robuster Nahkämpfer.' },
  ranger: { id: 'ranger', name: 'Waldläuferin', kind: 'ranged', hp: 85, speed: 85, damage: 10, range: 160, cooldown: 1.3, radius: 10, sight: 260, gold: 80, wood: 30, supply: 2, trainTime: 15, color: '#9fd98f', xpValue: 40, icon: '🏹', desc: 'Fernkämpferin mit großer Reichweite.' },
  warden: { id: 'warden', name: 'Wächterin', kind: 'hero', hp: 420, speed: 92, damage: 22, range: 26, cooldown: 0.9, radius: 13, sight: 280, gold: 250, wood: 0, supply: 0, trainTime: 20, color: '#f2d16b', xpValue: 150, icon: '⭐', desc: 'Heldin. Steigt mit Erfahrung auf. Fähigkeit: Erdstoß.' },
  // Gegner: Die Hohle Legion
  husk: { id: 'husk', name: 'Hülle', kind: 'melee', hp: 130, speed: 82, damage: 11, range: 22, cooldown: 1.1, radius: 11, sight: 220, gold: 0, wood: 0, supply: 2, trainTime: 10, color: '#7a8a6a', xpValue: 40, icon: '💀', desc: 'Nahkämpfer der Hohlen Legion.' },
  spitter: { id: 'spitter', name: 'Speier', kind: 'ranged', hp: 80, speed: 80, damage: 9, range: 150, cooldown: 1.4, radius: 10, sight: 240, gold: 0, wood: 0, supply: 2, trainTime: 12, color: '#9a6fb0', xpValue: 40, icon: '🧪', desc: 'Fernkämpfer der Hohlen Legion.' },
  revenant: { id: 'revenant', name: 'Wiedergänger', kind: 'hero', hp: 420, speed: 88, damage: 24, range: 26, cooldown: 1.0, radius: 13, sight: 280, gold: 0, wood: 0, supply: 0, trainTime: 20, color: '#c04a6a', xpValue: 200, icon: '👑', desc: 'Held der Hohlen Legion.' },
};

export const BUILDINGS: Record<string, BuildingDef> = {
  keep: { id: 'keep', name: 'Bergfried', hp: 1000, size: 3, gold: 320, wood: 180, buildTime: 70, trains: ['worker', 'warden'], supply: 10, sight: 260, color: '#b8a98a', icon: '🏰', desc: 'Hauptgebäude. Nimmt Rohstoffe an, bildet Arbeiter aus.', isHall: true },
  barracks: { id: 'barracks', name: 'Kaserne', hp: 650, size: 3, gold: 160, wood: 70, buildTime: 45, trains: ['swordsman', 'ranger'], supply: 0, sight: 220, color: '#9c7b5c', icon: '⚔️', desc: 'Bildet Schwertkämpfer und Waldläuferinnen aus.' },
  homestead: { id: 'homestead', name: 'Gehöft', hp: 280, size: 2, gold: 80, wood: 30, buildTime: 25, trains: [], supply: 6, sight: 160, color: '#c9b36b', icon: '🌾', desc: 'Erhöht die Versorgung um 6.' },
  tower: { id: 'tower', name: 'Wachturm', hp: 420, size: 2, gold: 110, wood: 70, buildTime: 35, trains: [], supply: 0, sight: 300, color: '#8d8d99', icon: '🗼', desc: 'Verteidigungsturm mit Fernangriff.', attack: { damage: 16, range: 190, cooldown: 1.4 } },
  crypt: { id: 'crypt', name: 'Gruft', hp: 1200, size: 3, gold: 0, wood: 0, buildTime: 1, trains: ['revenant'], supply: 10, sight: 260, color: '#4a4458', icon: '🪦', desc: 'Hauptgebäude der Hohlen Legion. Zerstöre es, um zu siegen.', isHall: true },
  pit: { id: 'pit', name: 'Brutgrube', hp: 650, size: 3, gold: 0, wood: 0, buildTime: 1, trains: ['husk', 'spitter'], supply: 0, sight: 220, color: '#5a3f55', icon: '🕳️', desc: 'Bringt Hüllen und Speier hervor.' },
  mound: { id: 'mound', name: 'Grabhügel', hp: 280, size: 2, gold: 0, wood: 0, buildTime: 1, trains: [], supply: 6, sight: 160, color: '#5c5a4a', icon: '⚰️', desc: 'Versorgung der Hohlen Legion.' },
  spire: { id: 'spire', name: 'Knochenturm', hp: 420, size: 2, gold: 0, wood: 0, buildTime: 1, trains: [], supply: 0, sight: 300, color: '#6e6a7a', icon: '🦴', desc: 'Verteidigungsturm der Hohlen Legion.', attack: { damage: 15, range: 180, cooldown: 1.5 } },
};

export const PLAYER_BUILD_ORDER = ['homestead', 'barracks', 'tower', 'keep'];

export const SHOCKWAVE = { radius: 115, baseDamage: 45, perLevel: 12, cooldown: 18 };
export const HERO_XP_PER_LEVEL = 120;
export const HERO_MAX_LEVEL = 10;
export const MAX_SUPPLY = 80;
export const CARRY_AMOUNT = 10;
export const GOLD_MINE_TIME = 3;
export const WOOD_CHOP_TIME = 4;

export const FACTION_COLOR: Record<Faction, string> = {
  player: '#3d8bff',
  enemy: '#d9403a',
  neutral: '#c9c9c9',
};
