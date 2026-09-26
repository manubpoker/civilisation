// 100 professions. `kind` selects the behaviour routine; `fx` are outputs per
// work cycle; `aff` are belief affinities used when people choose jobs (they
// prefer work matching their convictions); `inf` pushes the worker's (and, for
// preachers, their audience's) beliefs; `mil` holds combat stats.

const P = (id, name, kind, cat, o = {}) => ({ id, name, kind, cat, ...o });

export const PROFESSIONS = [
  // ---- general
  P('laborer', 'Laborer', 'laborer', 'general', { tech: null, color: [170, 160, 140], desc: 'Unskilled worker who carries loads and helps builders.' }),
  P('builder', 'Builder', 'builder', 'general', { color: [200, 150, 80], aff: { collectivism: 0.3, diligence: 0.3 }, desc: 'Constructs and repairs buildings.' }),
  P('scout', 'Scout', 'scout', 'general', { color: [120, 200, 120], aff: { curiosity: 0.6, mobility: 0.5, adventure: 0.5 }, desc: 'Explores the unknown, revealing land and resources.' }),
  // ---- government
  P('administrator', 'Administrator', 'service', 'government', { color: [150, 120, 200], fx: { order: 1, coins: 0.4 }, aff: { law: 0.5, discipline: 0.3 }, desc: 'Keeps records and collects taxes; improves order.' }),
  P('courtier', 'Courtier', 'service', 'government', { color: [190, 110, 210], fx: { culture: 0.8 }, inf: { hierarchy: 0.2 }, aff: { hierarchy: 0.8, pride: 0.4 }, desc: 'Nobles of the court; culture and hierarchy.' }),
  P('politician', 'Politician', 'service', 'government', { color: [120, 130, 230], fx: { order: 1, diplomacy: 0.5 }, inf: { authority: -0.1 }, aff: { ambition: 0.6, xenophilia: 0.2 }, desc: 'Elected representative; reduces unrest.' }),
  P('judge', 'Judge', 'service', 'government', { color: [90, 90, 120], fx: { order: 2 }, inf: { law: 0.2 }, aff: { law: 0.8, honesty: 0.4 }, desc: 'Tries criminals, deterring crime.' }),
  P('guard', 'Guard', 'guard', 'government', { color: [80, 100, 160], aff: { law: 0.6, courage: 0.3 }, mil: { atk: 6, def: 4, hp: 20, range: 1.6, rate: 30, speed: 1.1 }, desc: 'Patrols streets and arrests thieves.' }),
  P('diplomat', 'Diplomat', 'diplomat', 'government', { color: [230, 230, 250], aff: { xenophilia: 0.8, honesty: 0.3, harmony: 0.3 }, desc: 'Travels abroad to improve relations and negotiate treaties.' }),
  P('spy', 'Spy', 'spy', 'government', { color: [60, 60, 70], aff: { honesty: -0.8, suspicion: 0.4, adventure: 0.3 }, desc: 'Steals foreign technology and sabotages rivals.' }),
  P('propagandist', 'Propagandist', 'service', 'government', { color: [200, 60, 60], fx: { loyalty: 1 }, doctrine: true, aff: { authority: 0.7, patriotism: 0.6 }, desc: 'Pushes the population towards the official doctrine.' }),
  // ---- food
  P('gatherer', 'Gatherer', 'harvest', 'food', { color: [200, 90, 130], aff: { nature: 0.3, mobility: 0.3 }, desc: 'Forages berries, herbs, wild cotton and spices.' }),
  P('hunter', 'Hunter', 'hunt', 'food', { color: [150, 90, 50], aff: { courage: 0.4, animals: -0.8, mobility: 0.3 }, mil: { atk: 5, def: 1, hp: 0, range: 6, rate: 40, speed: 1.1 }, desc: 'Tracks and kills game for meat and hides.' }),
  P('fisher', 'Fisher', 'harvest', 'food', { color: [80, 150, 200], aff: { sea: 0.7 }, desc: 'Catches fish from shore and boat.' }),
  P('farmer', 'Farmer', 'field', 'food', { color: [210, 190, 80], aff: { tradition: 0.3, diligence: 0.3, mobility: -0.4 }, desc: 'Sows and harvests grain.' }),
  P('herder', 'Herder', 'field', 'food', { color: [170, 140, 90], aff: { mobility: 0.4, animals: -0.2 }, desc: 'Tends livestock; with riding, breeds horses.' }),
  P('miller', 'Miller', 'craft', 'food', { color: [230, 220, 190], desc: 'Grinds grain to flour.' }),
  P('baker', 'Baker', 'craft', 'food', { color: [220, 160, 90], aff: { empathy: 0.2 }, desc: 'Bakes bread.' }),
  P('brewer', 'Brewer', 'craft', 'food', { color: [200, 150, 60], aff: { revelry: 0.6, hedonism: 0.3 }, desc: 'Brews beer.' }),
  P('vintner', 'Vintner', 'field', 'food', { color: [140, 40, 90], aff: { hedonism: 0.4, art: 0.2 }, desc: 'Tends vines and makes wine.' }),
  // ---- materials
  P('woodcutter', 'Woodcutter', 'harvest', 'material', { color: [120, 80, 40], aff: { nature: -0.5, diligence: 0.2 }, desc: 'Fells trees for wood.' }),
  P('forester', 'Forester', 'plant', 'material', { color: [60, 140, 60], inf: { nature: 0.2 }, aff: { nature: 0.9 }, desc: 'Plants saplings to regrow forests.' }),
  P('quarrier', 'Quarrier', 'harvest', 'material', { color: [160, 160, 160], aff: { diligence: 0.3 }, desc: 'Cuts stone and marble.' }),
  P('clay_digger', 'Clay Digger', 'harvest', 'material', { color: [170, 110, 80], desc: 'Digs clay from riverbanks.' }),
  P('miner', 'Miner', 'harvest', 'material', { color: [110, 100, 90], aff: { courage: 0.3, diligence: 0.4, nature: -0.3 }, desc: 'Extracts ores deep underground.' }),
  P('oil_driller', 'Oil Driller', 'harvest', 'material', { color: [40, 40, 40], aff: { nature: -0.6 }, desc: 'Drills and pumps crude oil.' }),
  P('sawyer', 'Sawyer', 'craft', 'material', { color: [190, 140, 90], desc: 'Saws logs into lumber.' }),
  P('potter', 'Potter', 'craft', 'material', { color: [190, 120, 80], aff: { art: 0.3 }, desc: 'Throws and fires pottery.' }),
  P('brickmaker', 'Brickmaker', 'craft', 'material', { color: [180, 80, 60], desc: 'Moulds and fires bricks; mixes concrete.' }),
  P('smelter', 'Smelter', 'craft', 'material', { color: [220, 110, 50], aff: { nature: -0.3 }, desc: 'Smelts ores into bronze and iron.' }),
  P('charcoal_burner', 'Charcoal Burner', 'craft', 'material', { color: [70, 60, 60], desc: 'Burns wood into charcoal.' }),
  P('glassblower', 'Glassblower', 'craft', 'material', { color: [170, 220, 230], aff: { art: 0.4 }, desc: 'Blows glass for windows and lenses.' }),
  P('steelworker', 'Steelworker', 'craft', 'material', { color: [150, 160, 175], aff: { nature: -0.4, diligence: 0.4 }, desc: 'Works blast furnaces making steel.' }),
  P('refiner', 'Refiner', 'craft', 'material', { color: [120, 90, 60], aff: { nature: -0.5 }, desc: 'Refines oil into fuel and plastics.' }),
  // ---- crafts
  P('weaver', 'Weaver', 'craft', 'craft', { color: [220, 200, 170], aff: { art: 0.2, diligence: 0.2 }, desc: 'Weaves cloth.' }),
  P('planter', 'Planter', 'field', 'craft', { color: [230, 230, 210], desc: 'Grows cotton, flax and spices.' }),
  P('tailor', 'Tailor', 'craft', 'craft', { color: [120, 80, 170], aff: { art: 0.3 }, desc: 'Tans leather and sews clothing.' }),
  P('toolsmith', 'Toolsmith', 'craft', 'craft', { color: [140, 145, 155], aff: { invention: 0.4 }, desc: 'Forges tools.' }),
  P('weaponsmith', 'Weaponsmith', 'craft', 'military', { color: [100, 100, 110], inf: { aggression: 0.05 }, aff: { aggression: 0.5, discipline: 0.2 }, desc: 'Forges weapons and gunpowder.' }),
  P('armorer', 'Armorer', 'craft', 'military', { color: [130, 140, 160], aff: { courage: 0.3, discipline: 0.3 }, desc: 'Makes armour.' }),
  P('jeweler', 'Jeweler', 'craft', 'craft', { color: [240, 210, 100], aff: { hedonism: 0.4, art: 0.5, spirituality: -0.3 }, desc: 'Crafts jewellery.' }),
  P('papermaker', 'Papermaker', 'craft', 'craft', { color: [240, 235, 215], desc: 'Makes paper.' }),
  P('printer', 'Printer', 'craft', 'craft', { color: [80, 70, 70], inf: { scholarship: 0.1, authority: -0.1 }, aff: { scholarship: 0.5, authority: -0.4 }, desc: 'Prints books and pamphlets.' }),
  P('carpenter', 'Carpenter', 'craft', 'craft', { color: [170, 120, 70], aff: { craft: 0.4 }, desc: 'Makes furniture and planed lumber.' }),
  P('minter', 'Minter', 'craft', 'commerce', { color: [240, 200, 60], aff: { law: 0.3, honesty: 0.3 }, desc: 'Strikes coins.' }),
  P('factory_worker', 'Factory Worker', 'craft', 'industry', { color: [140, 110, 100], inf: { collectivism: 0.05, craft: -0.05 }, aff: { craft: -0.5, diligence: 0.2 }, desc: 'Operates machines in factories.' }),
  P('technician', 'Technician', 'craft', 'industry', { color: [80, 200, 230], aff: { invention: 0.6, reason: 0.3 }, desc: 'Builds electronics and maintains solar arrays.' }),
  P('plant_operator', 'Plant Operator', 'craft', 'industry', { color: [200, 200, 80], desc: 'Keeps power plants running.' }),
  P('nuclear_engineer', 'Nuclear Engineer', 'craft', 'industry', { color: [140, 240, 110], aff: { reason: 0.6, courage: 0.2 }, desc: 'Runs reactors safely (usually).' }),
  // ---- commerce & transport
  P('merchant', 'Merchant', 'merchant', 'commerce', { color: [230, 180, 60], fx: { coins: 0.6 }, inf: { commerce: 0.1 }, aff: { commerce: 0.8, collectivism: -0.3, spirituality: -0.3 }, desc: 'Sells luxuries at market and runs caravans between towns.' }),
  P('trader', 'Trader', 'trader', 'commerce', { color: [240, 150, 40], inf: { xenophilia: 0.1 }, aff: { commerce: 0.6, xenophilia: 0.7, adventure: 0.4 }, desc: 'Carries goods to foreign markets.' }),
  P('porter', 'Porter', 'porter', 'transport', { color: [160, 130, 100], desc: 'Carries goods between towns on foot.' }),
  P('carter', 'Carter', 'porter', 'transport', { tech: 'the_wheel', color: [150, 110, 60], carry: 3, speed: 1.4, desc: 'Drives an ox-cart; carries more, faster on roads.' }),
  P('banker', 'Banker', 'service', 'commerce', { color: [60, 140, 90], fx: { coins: 2 }, aff: { commerce: 0.6, charity: -0.4 }, desc: 'Manages loans and deposits.' }),
  P('broker', 'Broker', 'service', 'commerce', { color: [40, 160, 120], fx: { coins: 3, trade: 0.5 }, aff: { commerce: 0.7, adventure: 0.4 }, desc: 'Trades shares and commodities.' }),
  // ---- religion
  P('shaman', 'Shaman', 'preacher', 'religion', { color: [180, 120, 40], fx: { faith: 1, health: 0.3 }, inf: { piety: 0.3, reason: -0.3, nature: 0.1 }, aff: { reason: -0.8, piety: 0.6 }, desc: 'Reads omens, heals with rituals, spreads mysticism.' }),
  P('druid', 'Druid', 'preacher', 'religion', { color: [60, 130, 50], fx: { faith: 1 }, inf: { nature: 0.4, animals: 0.3 }, aff: { nature: 1.0, piety: 0.4 }, desc: 'Guardian of the sacred groves.' }),
  P('priest', 'Priest', 'preacher', 'religion', { color: [240, 230, 190], fx: { faith: 2, happy: 0.3 }, inf: { piety: 0.4, zeal: 0.1, empathy: 0.1 }, aff: { piety: 1.0, spirituality: 0.4 }, desc: 'Leads worship and preaches in the streets.' }),
  P('monk', 'Monk', 'service', 'religion', { color: [150, 110, 80], fx: { faith: 1, research: 0.8 }, inf: { piety: 0.2, hedonism: -0.3 }, aff: { piety: 0.6, hedonism: -0.8, scholarship: 0.3 }, desc: 'Prays, studies and copies manuscripts.' }),
  P('missionary', 'Missionary', 'missionary', 'religion', { color: [255, 250, 220], inf: { piety: 0.2 }, aff: { zeal: 0.9, piety: 0.6, adventure: 0.3 }, desc: 'Travels to foreign towns converting people to the home faith.' }),
  // ---- knowledge
  P('scribe', 'Scribe', 'service', 'knowledge', { color: [200, 190, 150], fx: { research: 1 }, inf: { scholarship: 0.05 }, aff: { scholarship: 0.6 }, desc: 'Records and copies knowledge.' }),
  P('teacher', 'Teacher', 'teacher', 'knowledge', { color: [100, 170, 220], fx: { edu: 3, research: 0.2 }, inf: { scholarship: 0.1 }, aff: { scholarship: 0.8, empathy: 0.3 }, desc: 'Educates children.' }),
  P('philosopher', 'Philosopher', 'preacher', 'knowledge', { color: [220, 220, 240], fx: { research: 1.8, culture: 0.4 }, inf: { reason: 0.3, curiosity: 0.2 }, aff: { reason: 0.7, curiosity: 0.6 }, desc: 'Questions everything; shapes the beliefs of listeners.' }),
  P('professor', 'Professor', 'service', 'knowledge', { color: [90, 90, 180], fx: { research: 3, edu: 1 }, inf: { scholarship: 0.1, reason: 0.1 }, aff: { scholarship: 1.0, reason: 0.4 }, desc: 'Teaches and researches at the university.' }),
  P('astronomer', 'Astronomer', 'service', 'knowledge', { color: [60, 80, 160], fx: { research: 2.5 }, inf: { curiosity: 0.1 }, aff: { curiosity: 0.8, reason: 0.4 }, desc: 'Charts the stars.' }),
  P('scientist', 'Scientist', 'service', 'knowledge', { color: [240, 250, 255], fx: { research: 4.5 }, inf: { reason: 0.15 }, aff: { reason: 1.0, curiosity: 0.5, piety: -0.3 }, desc: 'Performs experiments.' }),
  P('researcher', 'Researcher', 'service', 'knowledge', { color: [150, 230, 255], fx: { research: 7 }, inf: { invention: 0.1 }, aff: { invention: 0.8, reason: 0.6 }, desc: 'Works on cutting-edge science.' }),
  P('programmer', 'Programmer', 'service', 'knowledge', { color: [80, 255, 160], fx: { research: 6 }, aff: { invention: 0.7, tradition: -0.4 }, desc: 'Writes software that accelerates everything.' }),
  // ---- culture
  P('actor', 'Actor', 'service', 'culture', { color: [240, 120, 160], fx: { culture: 1.2, happy: 0.6 }, inf: { art: 0.1 }, aff: { art: 0.8, stoicism: -0.4 }, desc: 'Performs plays.' }),
  P('innkeeper', 'Innkeeper', 'service', 'culture', { color: [180, 120, 60], fx: { happy: 0.8, coins: 0.3 }, aff: { hospitality: 0.7, revelry: 0.5 }, desc: 'Keeps a tavern.' }),
  P('gladiator', 'Gladiator', 'service', 'culture', { color: [200, 60, 40], fx: { happy: 0.8, culture: 0.4 }, inf: { aggression: 0.1, courage: 0.1 }, aff: { courage: 0.7, aggression: 0.6 }, mil: { atk: 9, def: 4, hp: 20, range: 1.6, rate: 28, speed: 1.1 }, desc: 'Fights in the arena to thrill crowds.' }),
  P('musician', 'Musician', 'service', 'culture', { color: [250, 170, 220], fx: { culture: 2, happy: 0.6 }, inf: { art: 0.1 }, aff: { art: 1.0, hedonism: 0.3 }, desc: 'Performs music and opera.' }),
  // ---- health
  P('herbalist', 'Herbalist', 'healer', 'health', { color: [120, 190, 100], fx: { health: 1 }, aff: { nature: 0.5, empathy: 0.4 }, desc: 'Prepares remedies and tends the sick.' }),
  P('bath_attendant', 'Bath Attendant', 'service', 'health', { color: [150, 210, 230], fx: { health: 0.8, happy: 0.4 }, inf: { hygiene: 0.1 }, aff: { hygiene: 0.8 }, desc: 'Keeps the public baths.' }),
  P('doctor', 'Doctor', 'healer', 'health', { color: [255, 255, 255], fx: { health: 3 }, inf: { reason: 0.05 }, aff: { empathy: 0.6, reason: 0.5, mortality: -0.5 }, desc: 'Diagnoses and cures disease.' }),
  P('nurse', 'Nurse', 'healer', 'health', { color: [255, 200, 210], fx: { health: 1.5 }, aff: { empathy: 0.9 }, desc: 'Cares for patients.' }),
  // ---- military
  P('watchman', 'Watchman', 'watchman', 'military', { color: [150, 110, 70], aff: { suspicion: 0.6, discipline: 0.3 }, mil: { atk: 5, def: 2, hp: 10, range: 12, rate: 45, speed: 1 }, desc: 'Mans watchtowers and raises the alarm.' }),
  P('warrior', 'Warrior', 'military', 'military', { tech: 'tribal_law', branch: 'infantry', tier: 0, color: [230, 90, 70], aff: { aggression: 0.8, courage: 0.5 }, mil: { atk: 4, def: 1, hp: 10, range: 1.6, rate: 30, speed: 1.05 }, desc: 'Tribal fighter with club and spear.' }),
  P('spearman', 'Spearman', 'military', 'military', { tech: 'bronze_working', branch: 'infantry', tier: 1, color: [230, 110, 70], equip: { weapons: 1 }, aff: { aggression: 0.6, discipline: 0.4 }, mil: { atk: 6, def: 3, hp: 15, range: 2, rate: 30, speed: 1 }, desc: 'Bronze-tipped spear and shield.' }),
  P('swordsman', 'Swordsman', 'military', 'military', { tech: 'iron_working', branch: 'infantry', tier: 2, color: [240, 120, 90], equip: { weapons: 1, armor: 1 }, aff: { aggression: 0.6, courage: 0.6 }, mil: { atk: 9, def: 5, hp: 20, range: 1.6, rate: 28, speed: 1 }, desc: 'Iron sword and armour.' }),
  P('pikeman', 'Pikeman', 'military', 'military', { tech: 'feudalism', branch: 'infantry', tier: 3, color: [220, 140, 110], equip: { weapons: 1, armor: 1 }, aff: { discipline: 0.7 }, mil: { atk: 10, def: 8, hp: 25, range: 2.4, rate: 30, speed: 0.95, antiCav: 2 }, desc: 'Long pikes in tight formation; deadly against cavalry.' }),
  P('musketeer', 'Musketeer', 'military', 'military', { tech: 'gunpowder', branch: 'ranged', tier: 2, color: [250, 150, 120], equip: { weapons: 1, gunpowder: 1 }, aff: { discipline: 0.7, aggression: 0.3 }, mil: { atk: 16, def: 4, hp: 25, range: 7, rate: 60, speed: 1, gun: true }, desc: 'Matchlock infantry firing volleys.' }),
  P('rifleman', 'Rifleman', 'military', 'military', { tech: 'rifling', branch: 'infantry', tier: 4, color: [255, 170, 140], equip: { weapons: 1, gunpowder: 1 }, aff: { discipline: 0.6, patriotism: 0.5 }, mil: { atk: 24, def: 7, hp: 30, range: 10, rate: 40, speed: 1.05, gun: true }, desc: 'Rifled infantry; accurate at long range.' }),
  P('archer', 'Archer', 'military', 'military', { tech: 'archery', branch: 'ranged', tier: 0, color: [200, 160, 60], equip: { wood: 1 }, aff: { discipline: 0.3, courage: -0.2 }, mil: { atk: 5, def: 1, hp: 5, range: 11, rate: 45, speed: 1.05 }, desc: 'Longbow skirmisher.' }),
  P('crossbowman', 'Crossbowman', 'military', 'military', { tech: 'machinery', branch: 'ranged', tier: 1, color: [210, 180, 80], equip: { weapons: 1 }, aff: { discipline: 0.4 }, mil: { atk: 10, def: 3, hp: 10, range: 12, rate: 60, speed: 1 }, desc: 'Mechanical bows that pierce armour.' }),
  P('horseman', 'Horseman', 'military', 'military', { tech: 'horseback_riding', branch: 'cavalry', tier: 0, color: [240, 200, 120], equip: { horses: 1 }, aff: { mobility: 0.6, courage: 0.5 }, mil: { atk: 8, def: 3, hp: 20, range: 1.8, rate: 28, speed: 1.9, cav: true }, desc: 'Fast mounted raider.' }),
  P('knight', 'Knight', 'military', 'military', { tech: 'chivalry', branch: 'cavalry', tier: 1, color: [250, 230, 160], equip: { horses: 1, armor: 1, weapons: 1 }, aff: { honor: 0.8, hierarchy: 0.5, courage: 0.6 }, mil: { atk: 15, def: 10, hp: 40, range: 1.8, rate: 28, speed: 1.6, cav: true }, desc: 'Armoured noble cavalry bound by chivalry.' }),
  P('cavalryman', 'Dragoon', 'military', 'military', { tech: 'rifling', branch: 'cavalry', tier: 2, color: [255, 220, 180], equip: { horses: 1, weapons: 1, gunpowder: 1 }, aff: { courage: 0.6, mobility: 0.4 }, mil: { atk: 20, def: 7, hp: 40, range: 5, rate: 40, speed: 2.0, cav: true, gun: true }, desc: 'Mounted riflemen.' }),
  P('tank_crew', 'Tank Crew', 'military', 'military', { tech: 'mechanized_warfare', branch: 'cavalry', tier: 3, color: [120, 140, 90], equip: { steel: 4, fuel: 1 }, aff: { discipline: 0.5, invention: 0.3 }, mil: { atk: 45, def: 30, hp: 250, range: 10, rate: 45, speed: 2.2, siege: 5, vehicle: 'tank' }, desc: 'Armoured tanks: the end of trench warfare.' }),
  P('catapult_crew', 'Catapult Crew', 'military', 'military', { tech: 'military_tactics', branch: 'siege', tier: 0, color: [160, 120, 80], equip: { lumber: 2 }, aff: { invention: 0.3 }, mil: { atk: 12, def: 1, hp: 10, range: 16, rate: 120, speed: 0.6, siege: 8, vehicle: 'catapult' }, desc: 'Hurls stones at walls and buildings.' }),
  P('cannoneer', 'Cannoneer', 'military', 'military', { tech: 'metallurgy', branch: 'siege', tier: 1, color: [90, 90, 90], equip: { iron: 2, gunpowder: 1 }, aff: { discipline: 0.4 }, mil: { atk: 30, def: 2, hp: 15, range: 20, rate: 100, speed: 0.7, siege: 10, gun: true, vehicle: 'cannon' }, desc: 'Artillery that smashes fortifications.' }),
  P('general', 'General', 'military', 'military', { tech: 'military_tactics', branch: 'command', color: [255, 255, 120], aff: { discipline: 0.8, ambition: 0.6 }, mil: { atk: 8, def: 8, hp: 40, range: 1.8, rate: 30, speed: 1.2, command: 0.25 }, desc: 'Leads armies; nearby troops fight harder.' }),
  // ---- transport & logistics
  P('sailor', 'Sailor', 'sailor', 'transport', { color: [60, 110, 180], aff: { sea: 0.9, adventure: 0.4 }, desc: 'Crews ships for trade, fishing and transport.' }),
  P('shipwright', 'Shipwright', 'craft', 'transport', { color: [140, 100, 60], aff: { sea: 0.6 }, desc: 'Builds ships.' }),
  P('road_builder', 'Road Builder', 'road', 'transport', { color: [180, 170, 150], aff: { collectivism: 0.3, ancestry: -0.2 }, desc: 'Paves roads and builds bridges.' }),
  P('railwayman', 'Railwayman', 'rail', 'transport', { color: [120, 60, 40], aff: { invention: 0.3, discipline: 0.4 }, desc: 'Lays track and runs the trains.' }),
  P('driver', 'Truck Driver', 'porter', 'transport', { color: [230, 180, 30], carry: 8, speed: 2.6, vehicle: 'truck', desc: 'Drives freight trucks along highways.' }),
  P('pilot', 'Pilot', 'pilot', 'transport', { color: [200, 220, 255], aff: { adventure: 0.8, courage: 0.4 }, desc: 'Flies aircraft between airports.' }),
  // ---- advanced
  P('astronaut', 'Astronaut', 'service', 'knowledge', { color: [255, 255, 255], fx: { research: 4, space: 1 }, aff: { adventure: 1.0, curiosity: 0.8 }, desc: 'Trains for the voyage to the stars.' }),
  P('thief', 'Thief', 'thief', 'general', { tech: null, color: [80, 70, 90], aff: { empathy: -0.6, law: -0.6, honesty: -0.6 }, mil: { atk: 3, def: 1, hp: 0, range: 1.5, rate: 30, speed: 1.15 }, desc: 'Steals from stockpiles. Emerges among the poor, selfish and lawless.' }),
];

// Everyday work shapes outlooks in both directions.
const COUNTER_INF = {
  miner: { nature: -0.1 }, woodcutter: { nature: -0.05 }, hunter: { animals: -0.1 }, herder: { animals: -0.05 },
  factory_worker: { nature: -0.05, tradition: -0.05 }, steelworker: { nature: -0.05 }, technician: { invention: 0.1 },
  scientist: { piety: -0.1 }, professor: { tradition: -0.05 }, programmer: { invention: 0.1, ancestry: -0.05 },
  trader: { patriotism: -0.05 }, merchant: { ambition: 0.05 }, banker: { property: -0.1, commerce: 0.1 },
  spy: { honesty: -0.1, suspicion: 0.1 }, thief: { honesty: -0.1 }, innkeeper: { revelry: 0.1, hedonism: 0.05 },
  sailor: { sea: 0.1, adventure: 0.05 }, scout: { adventure: 0.1, curiosity: 0.05 }, doctor: { mortality: -0.1 },
  general: { aggression: 0.1, discipline: 0.05 }, diplomat: { xenophilia: 0.1 }, propagandist: { patriotism: 0.15, authority: 0.1 },
  politician: { ambition: 0.1 }, broker: { ambition: 0.1, charity: -0.05 }, actor: { hedonism: 0.05 },
  monk: { pride: -0.1 }, nurse: { empathy: 0.05 }, musician: { discipline: -0.05 }, farmer: { curiosity: -0.02 },
};

export const PROF_INDEX = {};
PROFESSIONS.forEach((p, i) => {
  PROF_INDEX[p.id] = i; p.idx = i;
  p.fx = p.fx || {};
  p.aff = p.aff || {};
  p.inf = Object.assign({}, p.inf || {}, COUNTER_INF[p.id] || {});
});
export function PR(id) {
  const i = PROF_INDEX[id];
  if (i === undefined) throw new Error('Unknown profession ' + id);
  return i;
}
export const MIL_BRANCHES = ['infantry', 'ranged', 'cavalry', 'siege'];
