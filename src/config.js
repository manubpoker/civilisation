// Global simulation constants. Everything time-related is expressed in ticks;
// the simulation advances in steps of `dt` ticks so high speeds stay cheap.

export const CFG = {
  W: 1440,              // world width in pixels (1 pixel = 1 person-sized cell)
  H: 900,               // world height
  NAV: 8,               // navigation cell size (pixels)
  TER: 4,               // territory / influence cell size (pixels)
  SPATIAL: 16,          // spatial hash cell size (pixels)
  MAX_PEOPLE: 90000,
  MAX_ANIMALS: 6000,
  START_POP: 150,       // people per civilisation at start
  TICKS_PER_DAY: 480,
  DAYS_PER_SEASON: 3,
  SEASONS: ['Spring', 'Summer', 'Autumn', 'Winter'],
  ADULT_AGE: 14,
  ELDER_AGE: 58,
  BASE_SPEED: 0.55,     // pixels per tick on open grass
  THINK_INTERVAL: 24,   // ticks between periodic re-evaluations
  PLAN_INTERVAL: 150,   // ticks between town planner runs
  JOB_INTERVAL: 90,     // ticks between labour assignment runs
  BELIEF_INTERVAL: 60,  // ticks between belief diffusion passes
  CIV_COLORS: [
    [214, 58, 46],      // Crimson Dominion (west)
    [48, 110, 224],     // Azure Concord (east)
    [60, 170, 80],
    [190, 90, 200],
    [230, 170, 40],
    [40, 190, 190],
    [240, 120, 160],
    [150, 150, 150],
  ],
};

CFG.DAYS_PER_YEAR = CFG.DAYS_PER_SEASON * 4;
CFG.TICKS_PER_YEAR = CFG.TICKS_PER_DAY * CFG.DAYS_PER_YEAR;
CFG.NW = Math.ceil(CFG.W / CFG.NAV);
CFG.NH = Math.ceil(CFG.H / CFG.NAV);
CFG.TW = Math.ceil(CFG.W / CFG.TER);
CFG.TH = Math.ceil(CFG.H / CFG.TER);
CFG.SW = Math.ceil(CFG.W / CFG.SPATIAL);
CFG.SH = Math.ceil(CFG.H / CFG.SPATIAL);
