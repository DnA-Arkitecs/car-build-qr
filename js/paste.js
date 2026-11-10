// Turns a mod list the owner already wrote (an Instagram caption, a notes app,
// a forum signature) into mods: brand, part, part number, notes and a
// category. It guesses; the owner sees every guess before anything is added
// and can edit any mod afterwards. Pure text in, plain data out: nothing here
// touches the page.
import { LIMITS, CATEGORIES, OTHER_CATEGORY, SPEC_KINDS } from './config.js';
import { normalizeMod, modIsEmpty, cleanText } from './model.js';

const CAT = Object.fromEntries(CATEGORIES.map((c, i) => [c, i]));
const SPEC = Object.fromEntries(SPEC_KINDS.map((k, i) => [k.name, i]));

// Well-known aftermarket brands, with the category a part from them usually
// belongs to when its words do not say (null: they make many kinds of parts).
const BRANDS = [
  // engine internals and oiling
  ['Manley', 'Engine'], ['Wiseco', 'Engine'], ['CP Pistons', 'Engine'], ['Carrillo', 'Engine'], ['Brian Crower', 'Engine'],
  ['Supertech', 'Engine'], ['Ferrea', 'Engine'], ['ARP', 'Engine'], ['Cometic', 'Engine'], ['Killer B', 'Engine'], ['IAG', null],
  ['Comp Cams', 'Engine'], ['Edelbrock', null], ['Mahle', 'Engine'], ['NGK', 'Engine'], ['Skunk2', null], ['Toda', 'Engine'],
  // intake and fuel
  ['K&N', 'Intake'], ['Injen', 'Intake'], ['aFe', 'Intake'], ['Eventuri', 'Intake'], ['AEM', null],
  ['DeatschWerks', 'Fuel'], ['Walbro', 'Fuel'], ['Injector Dynamics', 'Fuel'], ['Aeromotive', 'Fuel'], ['Fuelab', 'Fuel'], ['Radium', 'Fuel'],
  // exhaust
  ['Invidia', 'Exhaust'], ['Borla', 'Exhaust'], ['Corsa', 'Exhaust'], ['MagnaFlow', 'Exhaust'], ['Flowmaster', 'Exhaust'],
  ['Akrapovic', 'Exhaust'], ['Akrapovič', 'Exhaust'], ['Milltek', 'Exhaust'], ['Remus', 'Exhaust'], ['Kooks', 'Exhaust'],
  ['Hooker', 'Exhaust'], ['MBRP', 'Exhaust'], ['Fujitsubo', 'Exhaust'], ['Kakimoto', 'Exhaust'], ['Nameless', 'Exhaust'],
  ['Yoshimura', 'Exhaust'], ['Vance & Hines', 'Exhaust'], ['Two Brothers', 'Exhaust'], ['Arrow', 'Exhaust'], ['SC-Project', 'Exhaust'],
  ['Grimmspeed', null], ['Tomei', null], ['HKS', null], ['Greddy', null], ['Blitz', null], ['Apexi', null], ['Perrin', null],
  // forced induction
  ['Garrett', 'Forced induction'], ['BorgWarner', 'Forced induction'], ['Borg Warner', 'Forced induction'], ['Precision Turbo', 'Forced induction'],
  ['Blouch', 'Forced induction'], ['Xona Rotor', 'Forced induction'], ['Pure Turbos', 'Forced induction'], ['Holset', 'Forced induction'],
  ['Turbosmart', 'Forced induction'], ['Tial', 'Forced induction'], ['Vortech', 'Forced induction'], ['ProCharger', 'Forced induction'],
  ['Whipple', 'Forced induction'], ['Magnuson', 'Forced induction'], ['ETS', 'Forced induction'], ['Full Race', 'Forced induction'],
  ['Wagner Tuning', 'Forced induction'], ['Do88', null],
  // tuning
  ['Cobb', null], ['Hondata', 'Tune / ECU'], ['EcuTek', 'Tune / ECU'], ['Haltech', 'Tune / ECU'], ['MoTeC', 'Tune / ECU'],
  ['Link ECU', 'Tune / ECU'], ['Bootmod3', 'Tune / ECU'], ['MHD', 'Tune / ECU'], ['Unitronic', 'Tune / ECU'], ['Dinan', null],
  ['Burger Motorsports', 'Tune / ECU'], ['HP Tuners', 'Tune / ECU'], ['SCT', 'Tune / ECU'], ['Dynojet', 'Tune / ECU'],
  ['Power Commander', 'Tune / ECU'], ['Holley', null], ['APR', null], ['Integrated Engineering', null], ['034Motorsport', null],
  // cooling
  ['Mishimoto', 'Cooling'], ['CSF', 'Cooling'], ['Koyo', 'Cooling'], ['Koyorad', 'Cooling'], ['Fluidyne', 'Cooling'], ['Setrab', 'Cooling'],
  // drivetrain
  ['Exedy', 'Drivetrain'], ['ACT', 'Drivetrain'], ['Clutch Masters', 'Drivetrain'], ['South Bend', 'Drivetrain'],
  ['Competition Clutch', 'Drivetrain'], ['Wavetrac', 'Drivetrain'], ['Quaife', 'Drivetrain'], ['OS Giken', 'Drivetrain'],
  ['Kaaz', 'Drivetrain'], ['Cusco', null], ['Kartboy', 'Drivetrain'], ['Torsen', 'Drivetrain'], ['Eaton', 'Drivetrain'],
  ['Dynatrac', 'Drivetrain'], ['Yukon', 'Drivetrain'], ['Hybrid Racing', null], ['K-Tuned', null], ['Ktuned', null],
  // suspension
  ['KW', 'Suspension'], ['Bilstein', 'Suspension'], ['Tein', 'Suspension'], ['BC Racing', 'Suspension'], ['Fortune Auto', 'Suspension'],
  ['Ohlins', 'Suspension'], ['Öhlins', 'Suspension'], ['Eibach', 'Suspension'], ['H&R', 'Suspension'], ['Whiteline', 'Suspension'],
  ['SPL', 'Suspension'], ['Hardrace', 'Suspension'], ['Megan Racing', 'Suspension'], ['Stance', 'Suspension'], ['Fox', 'Suspension'],
  ['King Shocks', 'Suspension'], ['Icon', 'Suspension'], ['Old Man Emu', 'Suspension'], ['Rough Country', 'Suspension'],
  ['Air Lift', 'Suspension'], ['Air Lift Performance', 'Suspension'], ['AccuAir', 'Suspension'], ['Universal Air', 'Suspension'],
  ['Bag Riders', 'Suspension'], ['Swift', 'Suspension'], ['Tanabe', 'Suspension'], ['ISC', 'Suspension'], ['Ground Control', 'Suspension'],
  // brakes
  ['Brembo', 'Brakes'], ['StopTech', 'Brakes'], ['Wilwood', 'Brakes'], ['AP Racing', 'Brakes'], ['Hawk', 'Brakes'], ['EBC', 'Brakes'],
  ['Ferodo', 'Brakes'], ['Carbotech', 'Brakes'], ['Project Mu', 'Brakes'], ['Endless', 'Brakes'], ['Akebono', 'Brakes'],
  ['Rotora', 'Brakes'], ['Galfer', 'Brakes'], ['Motul', null], ['Castrol', null],
  // wheels and tires
  ['Enkei', 'Wheels & tires'], ['Volk', 'Wheels & tires'], ['Volk Racing', 'Wheels & tires'], ['Rays', 'Wheels & tires'],
  ['Work', 'Wheels & tires'], ['Work Wheels', 'Wheels & tires'], ['BBS', 'Wheels & tires'], ['Advan', 'Wheels & tires'],
  ['Konig', 'Wheels & tires'], ['Method', 'Wheels & tires'], ['Method Race Wheels', 'Wheels & tires'], ['Fuel Off-Road', 'Wheels & tires'],
  ['Titan 7', 'Wheels & tires'], ['Apex', 'Wheels & tires'], ['Rotiform', 'Wheels & tires'], ['Vossen', 'Wheels & tires'],
  ['HRE', 'Wheels & tires'], ['Fifteen52', 'Wheels & tires'], ['Gram Lights', 'Wheels & tires'], ['SSR', 'Wheels & tires'],
  ['Weds', 'Wheels & tires'], ['Cosmis', 'Wheels & tires'], ['ESR', 'Wheels & tires'], ['Michelin', 'Wheels & tires'],
  ['Bridgestone', 'Wheels & tires'], ['Continental', 'Wheels & tires'], ['Pirelli', 'Wheels & tires'], ['Toyo', 'Wheels & tires'],
  ['Nitto', 'Wheels & tires'], ['Falken', 'Wheels & tires'], ['Yokohama', 'Wheels & tires'], ['Hankook', 'Wheels & tires'],
  ['BFGoodrich', 'Wheels & tires'], ['BFG', 'Wheels & tires'], ['Goodyear', 'Wheels & tires'], ['Federal', 'Wheels & tires'],
  ['Nankang', 'Wheels & tires'], ['Achilles', 'Wheels & tires'], ['Cooper', 'Wheels & tires'], ['General Tire', 'Wheels & tires'],
  ['Dunlop', 'Wheels & tires'], ['Metzeler', 'Wheels & tires'], ['Kumho', 'Wheels & tires'], ['Nexen', 'Wheels & tires'],
  // aero and body
  ['Seibon', 'Aero & body'], ['Voltex', 'Aero & body'], ['Varis', 'Aero & body'], ['Rocket Bunny', 'Aero & body'],
  ['Pandem', 'Aero & body'], ['Liberty Walk', 'Aero & body'], ['Chargespeed', 'Aero & body'], ['Rexpeed', 'Aero & body'],
  ['ARB', null], ['Warn', null], ['Smittybilt', null], ['Rhino-Rack', 'Aero & body'], ['Front Runner', 'Aero & body'],
  // lighting
  ['Morimoto', 'Lighting'], ['Diode Dynamics', 'Lighting'], ['Baja Designs', 'Lighting'], ['Rigid', 'Lighting'],
  ['KC HiLiTES', 'Lighting'], ['Spyder', 'Lighting'], ['Philips', 'Lighting'], ['Osram', 'Lighting'],
  // interior
  ['Recaro', 'Interior'], ['Bride', 'Interior'], ['Sparco', 'Interior'], ['OMP', 'Interior'], ['Momo', 'Interior'],
  ['Nardi', 'Interior'], ['NRG', 'Interior'], ['Takata', 'Interior'], ['Schroth', 'Interior'], ['Defi', 'Interior'],
  ['Prosport', 'Interior'], ['Cobra', 'Interior'], ['Corbeau', 'Interior'], ['WeatherTech', 'Interior'],
  // audio and electronics
  ['JL Audio', 'Audio & electronics'], ['Focal', 'Audio & electronics'], ['Rockford Fosgate', 'Audio & electronics'],
  ['Alpine', 'Audio & electronics'], ['Kenwood', 'Audio & electronics'], ['Pioneer', 'Audio & electronics'],
  ['Sony', 'Audio & electronics'], ['Kicker', 'Audio & electronics'], ['Escort', 'Audio & electronics'],
  ['Valentine One', 'Audio & electronics'], ['AiM', 'Audio & electronics'], ['Racelogic', 'Audio & electronics'],
  // paint, wrap, protection
  ['3M', 'Paint & wrap'], ['Avery', 'Paint & wrap'], ['Avery Dennison', 'Paint & wrap'], ['XPEL', 'Paint & wrap'],
  ['Inozetek', 'Paint & wrap'], ['Gtechniq', 'Paint & wrap'], ['Ceramic Pro', 'Paint & wrap'],
];

function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const BRAND_BY_KEY = new Map(BRANDS.map(([name, hint]) => [name.toLowerCase(), { name, hint }]));
const BRAND_RX = new RegExp(
  `^(${[...BRAND_BY_KEY.values()].map((b) => b.name).sort((a, b) => b.length - a.length).map(escapeRx).join('|')})(?=$|[\\s,.:;/!)-])`,
  'i',
);

// Words that say what a part is, most specific first.
const RULES = [
  ['Interior', /\b(steering wheel|shift knob|quick release|seat brackets?)\b/i],
  ['Brakes', /\b(brake (pads?|lines?|fluid|kit|rotors?|calipers?)|big brake)\b/i],
  ['Intake', /\b(intake manifold)\b/i],
  ['Cooling', /\b(oil cooler|trans(mission)? cooler)\b/i],
  ['Fuel', /\b(fuel pump|lift pump|fuel rail|fuel pressure)\b/i],
  ['Audio & electronics', /\b(dash ?cam)\b/i],
  ['Tune / ECU', /\b(accessport|access port|ap( ?v3)?|hondata|ecutek|haltech|motec|bootmod3|power commander|hp tuners|flex ?fuel tune|e85 tune)\b/i],
  ['Exhaust', /\b(cat-?back|turbo-?back|axle-?back|exhaust|mufflers?|down-?pipe|dp|j-?pipe|up-?pipe|test pipe|headers?|resonators?|res delete|straight pipe|mid-?pipe|exhaust tips?|tips)\b/i],
  ['Forced induction', /\b(turbo(charger)?s?|super-?charger|blower|intercooler|fmic|tmic|bov|blow[- ]?off|wastegate|boost controller|charge pipe|boost tube)\b/i],
  ['Fuel', /\b(injectors?|e85|flex ?fuel|fpr|meth(anol)? kit|ethanol)\b/i],
  ['Intake', /\b(intake|cai|cold air|air filter|airbox|air box|throttle body|velocity stack|snorkel|tgv)\b/i],
  ['Cooling', /\b(radiator|fans?|coolant|thermostat|cooling|silicone hoses?|heat exchanger)\b/i],
  ['Drivetrain', /\b(clutch|flywheel|lsd|limited slip|differential|diff|transmission|gearbox|trans|short ?shifter|shifter|axles?|drive ?shaft|gear set|final drive|motor mounts?|engine mounts?|trans mounts?|transfer case)\b/i],
  ['Brakes', /\b(brakes?|pads|rotors|calipers?|bbk|e-?brake|hydro ?brake)\b/i],
  ['Wheels & tires', /\b(wheels?|rims?|tires?|tyres?|spacers?|lug nuts?|lugs|tpms)\b|\b\d{2}x\d{1,2}(\.\d)?\b|\b\d{3}\/\d{2}\s?z?r\s?\d{2}\b/i],
  ['Suspension', /\b(coilovers?|coil-?overs?|springs|lowering|lowered|shocks?|struts?|sway ?bars?|anti-?roll|end links?|control arms?|camber|caster|toe arms?|strut (bar|brace)|bushings?|air ?ride|air suspension|bags|bagged|lift kit|leveling kit|leveling|lifted|lift|uca|lca|subframe|tie rods?|alignment)\b/i],
  ['Lighting', /\b(head-?lights?|tail-?lights?|leds?|hid|fog ?lights?|light ?bar|sequential|halos?|drl|turn signals?|ditch lights?|pod lights?)\b/i],
  ['Audio & electronics', /\b(stereo|head unit|speakers?|subwoofers?|subs|amps?|amplifier|carplay|android auto|radar|camera|wideband|data ?logger|gps)\b/i],
  ['Interior', /\b(seats?|harness(es)?|roll ?cage|cage|roll ?bar|gauges?|pillar pod|floor mats|pedals|interior|door cards|headliner|alcantara|bucket)\b/i],
  ['Aero & body', /\b(wing|spoiler|lip|splitter|diffuser|canards?|side ?skirts?|hood|bumper|fenders?|body ?kit|wide-?body|over-?fenders?|mirrors?|grilles?|skid ?plates?|rock ?sliders?|roof ?rack|tow hooks?|carbon|aero)\b/i],
  ['Paint & wrap', /\b(wrap(ped)?|paint(ed)?|ceramic|ppf|tint(ed)?|vinyl|decals?|powder ?coat(ed)?|plasti ?dip|respray|livery)\b/i],
  ['Tune / ECU', /\b(tune|tuned|tuning|ecu|flash(ed)?|e-?tune|pro ?tune|piggyback|stage ?[1-3])\b/i],
  ['Engine', /\b(engine|motor|swap|swapped|cams?|camshafts?|pistons?|rods|head ?gasket|block|valve ?springs?|catch can|spark plugs?|coil packs?|pulley|timing|built|short ?block|long ?block|stroker|heads|oil pan|manifold|valve cover|crank)\b/i],
];

// Section headings an owner writes above a group ("Suspension:", "WHEELS").
const HEADINGS = [
  ['Engine', /^(engine|motor|power ?train|powertrain|internals?)$/i],
  ['Intake', /^(intake|induction)$/i],
  ['Exhaust', /^exhaust$/i],
  ['Forced induction', /^(turbo|turbos|boost|forced induction|supercharger)$/i],
  ['Tune / ECU', /^(tune|tuning|ecu|engine management)$/i],
  ['Fuel', /^(fuel|fueling|fuel system)$/i],
  ['Cooling', /^cooling$/i],
  ['Drivetrain', /^(drivetrain|driveline|transmission|trans)$/i],
  ['Suspension', /^(suspension|chassis|handling)$/i],
  ['Brakes', /^(brakes?|braking)$/i],
  ['Wheels & tires', /^(wheels?|tires?|tyres?|wheels ?(&|and|\/) ?tires|wheels ?(&|and|\/) ?tyres|wheel ?\/ ?tire|rolling stock|fitment)$/i],
  ['Aero & body', /^(exterior|aero|body|bodywork|outside)$/i],
  ['Lighting', /^(lighting|lights)$/i],
  ['Interior', /^(interior|cabin|cockpit|inside)$/i],
  ['Audio & electronics', /^(audio|electronics|tech|audio ?(&|and) ?electronics)$/i],
  ['Paint & wrap', /^(paint|wrap|appearance|paint ?(&|and|\/) ?wrap)$/i],
];
const NEUTRAL_HEADINGS = /^(mods?|mod list|modifications|the build|build|build list|parts|parts list|upgrades|current mods|full mod list|list|specs?|spec sheet|setup|current setup)$/i;
const SPEC_LABELS = [
  ['Power', /^(power|hp|whp|bhp|horsepower)$/i],
  ['Torque', /^(torque|tq|wtq)$/i],
  ['Weight', /^(weight|curb weight)$/i],
  ['0-60', /^0\s?[-–]\s?60$/i],
  ['Quarter mile', /^(quarter mile|1\/4 mile|1\/4|quarter|et)$/i],
  ['Lap time', /^(lap|lap time|best lap)$/i],
];

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;
const BULLET = /^\s*(?:[-*•·–—>+~=]+|\(?\d{1,2}[.)](?=\s)|[a-z][.)](?=\s))\s*/i;

function isPartNumber(t) {
  if (/^\d{6,}$/.test(t)) return true;
  return /^[A-Z0-9][A-Z0-9.\-/]{4,}$/.test(t) && /\d.*\d/.test(t) && /[A-Z]/.test(t)
    && !/^\d{2}X\d/.test(t) && !/^\d{3}\/\d{2}/.test(t);
}

function tidy(s) {
  return s.replace(/\s+/g, ' ').replace(/^[\s,;:/|-]+|[\s,;:/|-]+$/g, '').trim();
}

function categoryOf(text) {
  for (const [name, rx] of RULES) if (rx.test(text)) return CAT[name];
  return null;
}

function headingCategory(label) {
  const key = label.replace(/[^\p{L}\p{N}&/ ]/gu, ' ').replace(/\s+/g, ' ').trim();
  for (const [name, rx] of HEADINGS) if (rx.test(key)) return CAT[name];
  return NEUTRAL_HEADINGS.test(key) ? -1 : null;
}

function specKindOf(label) {
  const key = label.replace(/\s+/g, ' ').trim();
  for (const [name, rx] of SPEC_LABELS) if (rx.test(key)) return SPEC[name];
  return null;
}

// "450whp / 400wtq on E85": power and torque written as numbers.
function numberSpecs(text) {
  const out = [];
  // A real figure: up to 4 digits, an optional thousands group or decimals.
  const num = String.raw`(?<![\d,.])(\d{1,4}(?:,\d{3})?(?:\.\d{1,2})?)`;
  const power = text.match(new RegExp(`${num}\\s?(whp|bhp|hp)\\b`, 'i'));
  const torque = text.match(new RegExp(`${num}\\s?(wtq|tq|lb-?ft|ft-?lbs?)\\b`, 'i'));
  if (power) out.push({ kind: SPEC.Power, value: `${power[1]} ${power[2].toLowerCase()}` });
  if (torque) out.push({ kind: SPEC.Torque, value: `${torque[1]} ${torque[2].toLowerCase()}` });
  return out;
}

function splitItems(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  // A caption on one or two lines ("Mods: Cobb AP, Invidia Q300, KW V3") lists by commas.
  const inline = lines.length <= 2 && lines.some((l) => (l.match(/,/g) || []).length >= 2);
  const out = [];
  for (const line of lines) {
    const parts = inline ? line.split(/,|;|\s[|•·]\s/) : line.split(/;|\s[|•·]\s/);
    for (const p of parts) out.push(p);
  }
  return out;
}

// Returns { mods, specs, skipped }: mods cleaned like the form's, specs for the
// spec strip, and how many lines were set aside (headings, hashtags, blanks).
export function parseModList(text) {
  const src = String(text || '').slice(0, LIMITS.paste);
  const mods = [];
  const specs = [];
  let skipped = 0;
  let section = null;
  const items = splitItems(src);
  // Captions often open with a sentence ("Finally dialed in"). When a list
  // heading such as "Mods:" follows, only specs are read above it.
  const listStart = items.findIndex((it) => {
    const t = it.replace(EMOJI, ' ').replace(BULLET, '').trim().replace(/:$/, '').trim();
    return NEUTRAL_HEADINGS.test(t);
  });
  items.forEach((raw, i) => { if (i < listStart && !/^\d[\d,.]*\s?(whp|bhp|hp|wtq|tq)\b/i.test(raw.trim())) items[i] = ''; });
  for (const raw of items) {
    if (!raw) continue;
    if (mods.length >= LIMITS.mods) break;
    let s = raw.replace(EMOJI, ' ');
    let pn = '';
    // "#HS15SSTGTC" is a part number; "#wrx" is a hashtag.
    s = s.replace(/(^|\s)#([\p{L}\p{N}_.-]+)/gu, (all, lead, tag) => {
      if (!pn && isPartNumber(tag)) {
        pn = tag;
        return lead;
      }
      return lead;
    });
    s = s.replace(BULLET, '').trim();
    const colon = s.endsWith(':');
    s = tidy(s);
    if (!s) {
      skipped += 1;
      continue;
    }
    // A heading on its own line: "Suspension:", "== WHEELS ==", "[Interior]".
    const heading = s.match(/^[[(=*_~-]*\s*([\p{L}0-9&/ ]{2,30}?)\s*[\])=*_~-]*$/u);
    if (heading && (colon || /^[[(=*_~-]/.test(s) || heading[1] === heading[1].toUpperCase())) {
      const cat = headingCategory(heading[1]);
      if (cat !== null) {
        section = cat >= 0 ? cat : null;
        skipped += 1;
        continue;
      }
    }
    // "Label: value": a spec ("Power: 350whp"), a category ("Exhaust: Invidia Q300"), or a list heading ("Mods: ...").
    let cat = null;
    const labelled = s.match(/^([\p{L}0-9 /&–-]{1,24}?)\s*:\s*(.+)$/u);
    if (labelled) {
      const kind = specKindOf(labelled[1]);
      if (kind !== null) {
        specs.push({ kind, value: cleanText(labelled[2], LIMITS.specValue) });
        continue;
      }
      const hc = headingCategory(labelled[1]);
      if (hc !== null) {
        if (hc >= 0) cat = hc;
        s = tidy(labelled[2]);
      }
    }
    // A line that is just numbers: "450whp/400wtq on E85".
    if (/^\d[\d,.]*\s?(whp|bhp|hp|wtq|tq)\b/i.test(s)) {
      specs.push(...numberSpecs(s));
      continue;
    }
    if (!/[\p{L}\p{N}]/u.test(s)) {
      skipped += 1;
      continue;
    }
    const mod = toMod(s, pn, cat, section);
    if (modIsEmpty(mod)) {
      skipped += 1;
      continue;
    }
    mods.push(mod);
  }
  const seen = new Set();
  const uniqueSpecs = specs.filter((sp) => sp.value && !seen.has(sp.kind) && seen.add(sp.kind)).slice(0, LIMITS.specs);
  return { mods, specs: uniqueSpecs, skipped };
}

function toMod(input, pnFromTag, labelCat, section) {
  let text = input;
  let pn = pnFromTag;
  let link = '';
  const notes = [];
  const url = text.match(/\bhttps?:\/\/\S+/i);
  if (url) {
    link = url[0].replace(/[.,;:!?)\]]+$/, '');
    text = text.replace(url[0], ' ');
  }
  const marked = text.match(/\b(?:p\/?n|part ?(?:no\.?|number|#)|sku)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9.\-/]{2,})/i);
  if (marked) {
    pn = pn || marked[1];
    text = text.replace(marked[0], ' ');
  }
  text = text.replace(/\(([^()]{1,140})\)/g, (all, inner) => {
    const t = inner.trim();
    if (!pn && isPartNumber(t)) pn = t;
    else if (t) notes.push(t);
    return ' ';
  });
  const dash = tidy(text).match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash && dash[1].split(' ').length >= 2) {
    text = dash[1];
    notes.unshift(dash[2]);
  }
  text = tidy(text);
  let brand = '';
  let hint = null;
  const b = text.match(BRAND_RX);
  if (b) {
    const known = BRAND_BY_KEY.get(b[1].toLowerCase());
    brand = known.name;
    hint = known.hint;
    text = tidy(text.slice(b[1].length));
  }
  const noteText = notes.join('; ');
  let category = categoryOf(text);
  if (category === null) category = labelCat;
  if (category === null) category = categoryOf(noteText);
  if (category === null && hint) category = CAT[hint];
  if (category === null) category = section;
  if (category === null) category = OTHER_CATEGORY;
  return normalizeMod({ category, brand, part: text, partNumber: pn, link, notes: noteText });
}
