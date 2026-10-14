/**
 * Demo seed for Tradeflow.
 *
 * Run with `pnpm --filter @tradeflow/api db:seed` (tsx, cwd = apps/api).
 *
 * ## Idempotency
 *
 * The script deletes and recreates the demo tenant rather than upserting every
 * row. `tenants` cascades to users, customers, sites, the price book, quotes,
 * jobs, invoices and counters; the five RESTRICT edges (quotes → customers/sites,
 * jobs → quotes/customers/sites, invoices → customers) are cleared explicitly
 * first, in dependency order, inside the same transaction. Every id below is
 * derived from a fixed seed, so a second run reproduces the same rows — a demo
 * database and a CI database built from this file are the same database.
 *
 * ## Determinism
 *
 * No `Math.random()`. Ids come from a seeded linear congruential generator, every
 * choice that is not hand-written is an array read at a counter index, and every
 * timestamp is an offset from one clock reading taken at process start. Two runs
 * against the same database produce the same rows; two runs a day apart differ
 * only in the timestamps that are *meant* to track the wall clock, so the demo
 * never looks stale.
 *
 * ## Totals
 *
 * Every document total is derived with `computeTotals` from `@tradeflow/shared`,
 * which is the same function the API serves to the browser. Nothing here
 * hand-rolls VAT arithmetic, so the seeded rows cannot disagree with the UI by a
 * penny.
 */

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// The single .env lives at the repo root; this script runs from apps/api.
loadEnv({ path: resolve(process.cwd(), '../../.env') });

import { PrismaPg } from '@prisma/adapter-pg';
import {
  AttachmentKind,
  InvoiceStatus,
  PrismaClient,
  PriceUnit,
  QuoteStatus,
  UserRole,
} from '../src/generated/prisma';
// Imported from the generated output rather than from `@prisma/client`.
//
// `@prisma/client` re-exports `.prisma/client/default` from a content-addressed
// store directory, which is a *different copy* from the one the application
// uses. After a schema change the two drift, and the seed then writes enum values
// the database rejects — with an error that points at the column rather than at
// the import. Everything imports from the generated output for this reason.
import { computeTotals } from '@tradeflow/shared';
import { hashPassword } from '../src/auth/password';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

/* ------------------------------------------------------------------ */
/* Determinism                                                         */
/* ------------------------------------------------------------------ */

const SEED = 0x5eed_2026;

/**
 * Mulberry32. Small, fast, and — unlike `Math.random()` — reproducible, so the
 * demo dataset is identical on every machine and every run.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(SEED);

/** RFC 4122 v4 shape, filled from the seeded stream. */
function id(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i += 1) out += hex[(random() * 16) | 0];
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-a${out.slice(
    17,
    20,
  )}-${out.slice(20, 32)}`;
}

/**
 * Stable, unique stand-in for the link token a real send would generate.
 * Deterministic so re-seeding does not invalidate a demo link in a slide deck.
 */
function token(prefix: string, n: number): string {
  return `${prefix}${n.toString(36).padStart(3, '0')}${id().replace(/-/g, '')}`.slice(0, 64);
}

/* ------------------------------------------------------------------ */
/* Clock                                                               */
/* ------------------------------------------------------------------ */

/**
 * The clock the seed is anchored to, read once at process start.
 *
 * Deliberately the *database's* clock rather than Node's. Every timestamp here
 * is stored as `timestamptz`, so what matters is the instant, and a workstation
 * whose system clock is set to local time while reporting UTC as an offset — a
 * common enough misconfiguration — would otherwise seed a calendar that is hours
 * out of step with the `now()` the API and the scheduler compare against. The
 * result of that mismatch is a job flagged IN_PROGRESS whose window already
 * closed, which is exactly the sort of thing a demo is not allowed to show.
 *
 * Truncated to the second on purpose: `Date` carries milliseconds, and the
 * in-progress job is anchored a few hours either side of this instant, so the
 * last three digits would otherwise churn on every run and make "is the seed
 * deterministic?" a question nobody can answer by inspection.
 */
let NOW = new Date(Math.floor(Date.now() / 1000) * 1000);

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight for a day offset from today. */
function dayStart(offsetDays: number): Date {
  const d = new Date(NOW);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * DAY_MS);
}

function at(offsetDays: number, hours: number, minutes = 0): Date {
  return new Date(dayStart(offsetDays).getTime() + (hours * 60 + minutes) * 60 * 1000);
}

function daysFromNow(days: number, from: Date = NOW): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

function hoursFromNow(hours: number): Date {
  return new Date(NOW.getTime() + hours * 60 * 60 * 1000);
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60 * 1000);
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Business days after `from`, skipping weekends — how a quote validity works. */
function businessDaysAfter(from: Date, days: number): Date {
  const d = dateOnly(from);
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* Curated domain data                                                 */
/* ------------------------------------------------------------------ */

const TENANT = {
  id: id(),
  name: 'Halstead Electrical & Heating Ltd',
  slug: 'halstead-electrical',
  currency: 'GBP',
  vatNumber: 'GB 412 8836 47',
};

const DEMO_PASSWORD = 'demo-password-2026';

type StaffSeed = { name: string; email: string; role: UserRole };

/**
 * Twelve people: one owner, two office, nine engineers (including the owner
 * doubling as the responsible person on site). Names and mailboxes are the kind
 * a UK firm actually uses — first initial plus surname, no vanity domains.
 */
const STAFF: StaffSeed[] = [
  {
    name: 'Daniel Halstead',
    email: 'daniel.halstead@halsteadelectrical.co.uk',
    role: UserRole.OWNER,
  },
  {
    name: 'Priya Nair',
    email: 'priya.nair@halsteadelectrical.co.uk',
    role: UserRole.OFFICE,
  },
  {
    name: 'Karen Wilcox',
    email: 'karen.wilcox@halsteadelectrical.co.uk',
    role: UserRole.OFFICE,
  },
  {
    name: 'Gary Mercer',
    email: 'gary.mercer@halsteadelectrical.co.uk',
    role: UserRole.ENGINEER,
  },
  {
    name: 'Tom Bramley',
    email: 'tom.bramley@halsteadelectrical.co.uk',
    role: UserRole.ENGINEER,
  },
  {
    name: 'Ade Okafor',
    email: 'ade.okafor@halsteadelectrical.co.uk',
    role: UserRole.ENGINEER,
  },
  {
    name: 'Ryan Kenyon',
    email: 'ryan.kenyon@halsteadelectrical.co.uk',
    role: UserRole.ENGINEER,
  },
  {
    name: 'Sophie Alderton',
    email: 'sophie.alderton@halsteadelectrical.co.uk',
    role: UserRole.ENGINEER,
  },
  {
    name: 'Marek Nowak',
    email: 'marek.nowak@halsteadelectrical.co.uk',
    role: UserRole.ENGINEER,
  },
  {
    name: 'Callum Reid',
    email: 'callum.reid@halsteadelectrical.co.uk',
    role: UserRole.ENGINEER,
  },
  {
    name: 'Vikram Shah',
    email: 'vikram.shah@halsteadelectrical.co.uk',
    role: UserRole.ENGINEER,
  },
  {
    name: 'Nathan Pryce',
    email: 'nathan.pryce@halsteadelectrical.co.uk',
    role: UserRole.ENGINEER,
  },
];

const ENGINEER_COUNT = STAFF.filter((s) => s.role === UserRole.ENGINEER).length;

/**
 * Tax treatment, in basis points.
 *
 * UK VAT on a domestic electrical job is not uniformly 20%: retro-fit energy
 * saving materials are zero-rated, qualifying heating and insulation work on
 * homes is reduced-rated, and the rest is standard. Seeding a mixed basket is
 * the only way the per-line rounding in `computeTotals` gets exercised on
 * screen.
 */
const VAT_ABOLISHED = 0;
const VAT_REDUCED = 500;
const VAT_STANDARD = 2000;

type PriceSeed = {
  code: string;
  description: string;
  unit: PriceUnit;
  unitPrice: number; // net, in pence
  taxRateBp: number;
};

const PRICE_BOOK: PriceSeed[] = [
  // Labour and attendance
  {
    code: 'LAB-HR-STD',
    description: 'Electrical labour — qualified electrician (per hour)',
    unit: PriceUnit.HOUR,
    unitPrice: 5200,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'LAB-HR-APPR',
    description: 'Electrical labour — improver / apprentice (per hour)',
    unit: PriceUnit.HOUR,
    unitPrice: 3200,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'HEAT-HR',
    description: 'Heating engineer labour — Gas Safe registered (per hour)',
    unit: PriceUnit.HOUR,
    unitPrice: 5800,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'LAB-DAY',
    description: 'Day rate — two electricians and van',
    unit: PriceUnit.DAY,
    unitPrice: 72000,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'CALLOUT-STD',
    description: 'Emergency call-out — first hour (out of hours)',
    unit: PriceUnit.EACH,
    unitPrice: 14500,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'FAULT-FIRST',
    description: 'Fault find — first hour',
    unit: PriceUnit.EACH,
    unitPrice: 7800,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'FAULT-ADDL',
    description: 'Fault find — each additional half hour',
    unit: PriceUnit.EACH,
    unitPrice: 3400,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'SURVEY',
    description: 'Site survey and written report',
    unit: PriceUnit.EACH,
    unitPrice: 6500,
    taxRateBp: VAT_STANDARD,
  },

  // Consumer units and distribution
  {
    code: 'CU-REPLACE-18',
    description: 'Consumer unit replacement (18th Edition, metal, SPD)',
    unit: PriceUnit.EACH,
    unitPrice: 82500,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'CU-UPGRADE-RCBO',
    description: 'Addition of RCBO protection to existing consumer unit',
    unit: PriceUnit.EACH,
    unitPrice: 6600,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'CONSUMER-UNIT-10W',
    description: 'Consumer unit — 10-way dual RCD',
    unit: PriceUnit.EACH,
    unitPrice: 14500,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'EARTH-BOND-MAIN',
    description: 'Main protective bonding conductor upgrade (10mm²)',
    unit: PriceUnit.EACH,
    unitPrice: 9500,
    taxRateBp: VAT_STANDARD,
  },

  // Testing and certification
  {
    code: 'EICR-DOM',
    description: 'EICR — electrical installation condition report (up to 3 bed)',
    unit: PriceUnit.EACH,
    unitPrice: 14500,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'EICR-DOM-L',
    description: 'EICR — electrical installation condition report (4–5 bed)',
    unit: PriceUnit.EACH,
    unitPrice: 19500,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'EICR-COMM',
    description: 'EICR — commercial premises, priced per circuit',
    unit: PriceUnit.EACH,
    unitPrice: 2800,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'EIC',
    description: 'Electrical Installation Certificate (new circuit)',
    unit: PriceUnit.EACH,
    unitPrice: 8500,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'PAT-APPLIANCE',
    description: 'PAT testing — per appliance',
    unit: PriceUnit.EACH,
    unitPrice: 250,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'PART-P',
    description: 'Part P building control notification',
    unit: PriceUnit.EACH,
    unitPrice: 3200,
    taxRateBp: VAT_STANDARD,
  },

  // Circuits and accessories
  {
    code: 'CIRCUIT-ADD',
    description: 'New radial or ring main circuit (up to 20m)',
    unit: PriceUnit.EACH,
    unitPrice: 38000,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'RCD-SOCKET-KIT',
    description: 'RCD socket outlet — supplied and fitted',
    unit: PriceUnit.EACH,
    unitPrice: 8200,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'OUTDOOR-SOCKET',
    description: 'Weatherproof outdoor socket outlet',
    unit: PriceUnit.EACH,
    unitPrice: 11500,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'LED-DOWNLIGHT',
    description: 'Fire-rated LED downlight — supplied and fitted',
    unit: PriceUnit.EACH,
    unitPrice: 4200,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'SMOKE-ALARM',
    description: 'Mains interlinked smoke alarm — supplied and fitted',
    unit: PriceUnit.EACH,
    unitPrice: 6800,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'EXTRACT-FAN',
    description: 'Extractor fan with humidity timer',
    unit: PriceUnit.EACH,
    unitPrice: 15500,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'CO-ALARM',
    description: 'Carbon monoxide alarm — supplied and fitted',
    unit: PriceUnit.EACH,
    unitPrice: 5400,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'EM-LIGHT',
    description: 'Emergency lighting — maintained bulkhead luminaire',
    unit: PriceUnit.EACH,
    unitPrice: 9500,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'FIRE-ALARM-POINT',
    description: 'Grade D fire detection — additional detection point',
    unit: PriceUnit.EACH,
    unitPrice: 7800,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'LIGHTING-REWIRE',
    description: 'Lighting circuit rewire (per room)',
    unit: PriceUnit.EACH,
    unitPrice: 21000,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'SHOWER-INSTALL',
    description: 'Electric shower installation (9.5kW, dedicated circuit)',
    unit: PriceUnit.EACH,
    unitPrice: 34000,
    taxRateBp: VAT_STANDARD,
  },

  // Heating
  {
    code: 'BOILER-SERVICE',
    description: 'Boiler service — gas',
    unit: PriceUnit.EACH,
    unitPrice: 8900,
    taxRateBp: VAT_REDUCED,
  },
  {
    code: 'BOILER-SERVICE-LANDLORD',
    description: 'Landlord gas safety record (CP12)',
    unit: PriceUnit.EACH,
    unitPrice: 9500,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'BOILER-REPAIR',
    description: 'Gas boiler repair — up to two hours, parts extra',
    unit: PriceUnit.EACH,
    unitPrice: 18500,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'TRV-FIT',
    description: 'Thermostatic radiator valve — supplied and fitted',
    unit: PriceUnit.EACH,
    unitPrice: 11000,
    taxRateBp: VAT_REDUCED,
  },
  {
    code: 'RADIATOR-FIT',
    description: 'Radiator — supplied and fitted (up to 1200mm)',
    unit: PriceUnit.EACH,
    unitPrice: 27500,
    taxRateBp: VAT_REDUCED,
  },
  {
    code: 'SMART-STAT',
    description: 'Smart thermostat — supplied and fitted',
    unit: PriceUnit.EACH,
    unitPrice: 23500,
    taxRateBp: VAT_REDUCED,
  },
  {
    code: 'MAGNETIC-FILTER',
    description: 'Magnetic system filter — supplied and fitted',
    unit: PriceUnit.EACH,
    unitPrice: 24000,
    taxRateBp: VAT_REDUCED,
  },
  {
    code: 'POWERFLUSH',
    description: 'Powerflush — central heating system',
    unit: PriceUnit.EACH,
    unitPrice: 52000,
    taxRateBp: VAT_REDUCED,
  },
  {
    code: 'ZTSTAT',
    description: 'Zone valve and programmer replacement',
    unit: PriceUnit.EACH,
    unitPrice: 26500,
    taxRateBp: VAT_REDUCED,
  },
  {
    code: 'AIR-CON-SERVICE',
    description: 'Air conditioning service — per indoor unit',
    unit: PriceUnit.EACH,
    unitPrice: 12500,
    taxRateBp: VAT_STANDARD,
  },

  // Renewables
  {
    code: 'SOLAR-SURVEY',
    description: 'Solar PV and battery site survey',
    unit: PriceUnit.EACH,
    unitPrice: 8500,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'EV-POINT',
    description: 'EV charge point installation (7kW, OZEV compliant)',
    unit: PriceUnit.EACH,
    unitPrice: 118000,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'SOLAR-BATTERY',
    description: 'Battery storage installation (5kWh)',
    unit: PriceUnit.EACH,
    unitPrice: 285000,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'SOLAR-PANEL',
    description: 'Solar PV panel installation — per panel',
    unit: PriceUnit.EACH,
    unitPrice: 32000,
    taxRateBp: VAT_STANDARD,
  },

  // Materials — mostly billed per metre or per item
  {
    code: 'CABLE-TE-2.5',
    description: 'Twin and earth cable 2.5mm² (per metre)',
    unit: PriceUnit.METRE,
    unitPrice: 195,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'CABLE-TE-1.5',
    description: 'Twin and earth cable 1.5mm² (per metre)',
    unit: PriceUnit.METRE,
    unitPrice: 145,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'CABLE-SWA-4.0',
    description: 'Steel wire armoured cable 4mm² (per metre)',
    unit: PriceUnit.METRE,
    unitPrice: 640,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'TRUNKING-50',
    description: 'PVC trunking 50mm (per metre)',
    unit: PriceUnit.METRE,
    unitPrice: 420,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'CONDUIT-20',
    description: 'PVC conduit 20mm with accessories (per metre)',
    unit: PriceUnit.METRE,
    unitPrice: 340,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'MAT-CONSUMABLES',
    description: 'Consumables — clips, glands, sleeving, fixings',
    unit: PriceUnit.EACH,
    unitPrice: 2200,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'MAT-CORES-DRILL',
    description: 'Core drilling through masonry (per hole)',
    unit: PriceUnit.EACH,
    unitPrice: 3500,
    taxRateBp: VAT_STANDARD,
  },
  {
    code: 'MAT-WALL-CHASE',
    description: 'Wall chasing and making good (per metre)',
    unit: PriceUnit.METRE,
    unitPrice: 5800,
    taxRateBp: VAT_STANDARD,
  },

  // Zero-rated: qualifying energy saving materials supplied with installation
  {
    code: 'ESM-LOFT-INSUL',
    description: 'Loft insulation top-up (270mm) — supplied and fitted',
    unit: PriceUnit.SQUARE_METRE,
    unitPrice: 3400,
    taxRateBp: VAT_ABOLISHED,
  },
  {
    code: 'ESM-CAVITY-INSUL',
    description: 'Cavity wall insulation — qualifying installation',
    unit: PriceUnit.SQUARE_METRE,
    unitPrice: 4200,
    taxRateBp: VAT_ABOLISHED,
  },
  {
    code: 'ESM-SOLAR-THERMAL',
    description: 'Solar thermal hot water — qualifying installation',
    unit: PriceUnit.EACH,
    unitPrice: 320000,
    taxRateBp: VAT_ABOLISHED,
  },
  {
    code: 'ESM-HEAT-PUMP',
    description: 'Air source heat pump — qualifying installation',
    unit: PriceUnit.EACH,
    unitPrice: 1150000,
    taxRateBp: VAT_ABOLISHED,
  },
];

type AddressSeed = {
  label: string;
  line1: string;
  line2?: string;
  city: string;
  postcode: string;
  accessNotes?: string;
};

type SiteSeed = AddressSeed & { key: string };

type CustomerSeed = {
  key: string;
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
  billing: { line1: string; line2?: string; city: string; postcode: string };
  sites: SiteSeed[];
};

/**
 * Fourteen accounts. The letting agent carries five properties and the
 * commercial landlord three, which is the reason Site exists as its own entity:
 * one payer, several front doors, each with its own key safe and parking.
 */
const CUSTOMERS: CustomerSeed[] = [
  {
    key: 'whitfield',
    name: 'Mr & Mrs Whitfield',
    email: 'j.whitfield@gmail.com',
    phone: '07700 900412',
    billing: {
      line1: '14 Ashcombe Road',
      city: 'Bristol',
      postcode: 'BS6 7QT',
    },
    sites: [
      {
        key: 'whitfield-home',
        label: 'Home',
        line1: '14 Ashcombe Road',
        city: 'Bristol',
        postcode: 'BS6 7QT',
        accessNotes: 'Key safe by the side gate, code 4417. Dog in the back garden — ring first.',
      },
    ],
  },
  {
    key: 'fraser',
    name: 'Alan Fraser',
    email: 'alan.fraser@outlook.com',
    phone: '07700 900733',
    billing: {
      line1: '3 Headland Court',
      line2: 'Clifton',
      city: 'Bristol',
      postcode: 'BS8 3HP',
    },
    sites: [
      {
        key: 'fraser-home',
        label: 'Home',
        line1: '3 Headland Court',
        line2: 'Clifton',
        city: 'Bristol',
        postcode: 'BS8 3HP',
        accessNotes: 'Top floor flat, no lift. Meter cupboard in the communal hall.',
      },
    ],
  },
  {
    key: 'baxter',
    name: 'Diane Baxter',
    phone: '0117 496 0182',
    notes: 'Prefers a phone call to email. Works from home — avoid Tuesday mornings.',
    billing: {
      line1: '88 Sandholme Lane',
      city: 'Bristol',
      postcode: 'BS16 2RG',
    },
    sites: [
      {
        key: 'baxter-home',
        label: 'Home',
        line1: '88 Sandholme Lane',
        city: 'Bristol',
        postcode: 'BS16 2RG',
        accessNotes: 'Side access to the rear garden. Driveway free for the van.',
      },
    ],
  },
  {
    key: 'oakleigh',
    name: 'Oakleigh Lettings Ltd',
    email: 'maintenance@oakleighlettings.co.uk',
    phone: '0117 332 7788',
    notes:
      'Portfolio account. All work must be quoted before attendance; invoices go to the accounts inbox with the property reference in the subject line.',
    billing: {
      line1: 'Unit 4, Kingsway Business Park',
      line2: 'Stoke Gifford',
      city: 'Bristol',
      postcode: 'BS34 8XZ',
    },
    sites: [
      {
        key: 'oakleigh-12-station',
        label: '12 Station Road, Kingswood',
        line1: '12 Station Road',
        line2: 'Kingswood',
        city: 'Bristol',
        postcode: 'BS15 4XQ',
        accessNotes: 'Managed let, tenant in situ. 24 hours notice required — gate code 3391.',
      },
      {
        key: 'oakleigh-45-gloucester',
        label: '45 Gloucester Road',
        line1: '45 Gloucester Road',
        city: 'Bristol',
        postcode: 'BS7 8AS',
        accessNotes: 'Keys held in the office. Ground floor commercial, flats above.',
      },
      {
        key: 'oakleigh-9-tyndall',
        label: '9 Tyndall Avenue — flat 3',
        line1: '9 Tyndall Avenue',
        line2: 'Flat 3',
        city: 'Bristol',
        postcode: 'BS8 1UD',
        accessNotes: 'Student let, void over the summer. Key safe on the rear wall.',
      },
      {
        key: 'oakleigh-22-redland',
        label: '22 Redland Grove',
        line1: '22 Redland Grove',
        city: 'Bristol',
        postcode: 'BS6 6PS',
        accessNotes: 'Alarm code changes each tenancy — confirm with the office before entry.',
      },
      {
        key: 'oakleigh-7-bedminster',
        label: '7 Bedminster Parade',
        line1: '7 Bedminster Parade',
        line2: 'Bedminster',
        city: 'Bristol',
        postcode: 'BS3 4HS',
        accessNotes: 'Loading bay restriction 08:00–09:30. Park on Sheene Road.',
      },
    ],
  },
  {
    key: 'harrow',
    name: 'Harrowgate Property Investments Ltd',
    email: 'accounts@harrowgateproperty.co.uk',
    phone: '0113 288 4410',
    notes: 'Commercial landlord. Purchase orders required on invoices over £1,000.',
    billing: {
      line1: '1 Wellington Place',
      line2: 'Floor 6',
      city: 'Leeds',
      postcode: 'LS1 4AP',
    },
    sites: [
      {
        key: 'harrow-argyle',
        label: 'Argyle House, Leeds',
        line1: '22 Argyle Road',
        city: 'Leeds',
        postcode: 'LS8 5NA',
        accessNotes:
          'Six self-contained flats plus communal stairwell lighting. Sign in at the concierge desk.',
      },
      {
        key: 'harrow-bramley',
        label: 'Bramley Trade Centre',
        line1: 'Unit 11, Bramley Trade Centre',
        line2: 'Stanningley Road',
        city: 'Leeds',
        postcode: 'LS13 3EG',
        accessNotes: 'Three-phase supply in the rear workshop. Hot works permit needed for any drilling.',
      },
      {
        key: 'harrow-meanwood',
        label: 'Meanwood Road Retail',
        line1: '148 Meanwood Road',
        city: 'Leeds',
        postcode: 'LS7 2LP',
        accessNotes: 'Out of hours only — the retail unit trades 07:00–22:00.',
      },
    ],
  },
  {
    key: 'penrose',
    name: 'Dr Helen Penrose',
    email: 'h.penrose@btinternet.com',
    phone: '07700 900188',
    billing: {
      line1: 'The Old Coach House',
      line2: 'Church Lane',
      city: 'Bath',
      postcode: 'BA2 4QN',
    },
    sites: [
      {
        key: 'penrose-home',
        label: 'Home',
        line1: 'The Old Coach House',
        line2: 'Church Lane',
        city: 'Bath',
        postcode: 'BA2 4QN',
        accessNotes: 'Grade II listed — no chasing of the original stonework.',
      },
    ],
  },
  {
    key: 'conway',
    name: 'Conway Street Dental Practice',
    email: 'practice@conwaystreetdental.co.uk',
    phone: '0117 944 2210',
    notes: 'Clinical areas must be clear by 08:00. No work during surgery hours without notice.',
    billing: {
      line1: '31 Conway Street',
      city: 'Bristol',
      postcode: 'BS3 1BP',
    },
    sites: [
      {
        key: 'conway-practice',
        label: 'Surgery',
        line1: '31 Conway Street',
        city: 'Bristol',
        postcode: 'BS3 1BP',
        accessNotes: 'Emergency lighting and fire alarm test log held at reception.',
      },
    ],
  },
  {
    key: 'marsh',
    name: 'Reverend Peter Marsh',
    email: 'p.marsh@stbarnabas-church.org.uk',
    phone: '07700 900515',
    billing: {
      line1: 'St Barnabas Vicarage',
      line2: 'Whitby Road',
      city: 'Bristol',
      postcode: 'BS4 1NX',
    },
    sites: [
      {
        key: 'marsh-vicarage',
        label: 'Vicarage',
        line1: 'St Barnabas Vicarage',
        line2: 'Whitby Road',
        city: 'Bristol',
        postcode: 'BS4 1NX',
        accessNotes: 'Park on the church forecourt. Halls are booked most evenings.',
      },
      {
        key: 'marsh-hall',
        label: 'St Barnabas Church Hall',
        line1: 'St Barnabas Church Hall',
        line2: 'Whitby Road',
        city: 'Bristol',
        postcode: 'BS4 1NX',
        accessNotes: 'Heating controls in the vestry cupboard. Alarm code held by the warden.',
      },
    ],
  },
  {
    key: 'kettleby',
    name: 'Julia Kettleby',
    email: 'julia.kettleby@icloud.com',
    phone: '07700 900226',
    billing: {
      line1: 'Anchor Cottage',
      line2: 'The Quay',
      city: 'Bideford',
      postcode: 'EX39 2AN',
    },
    sites: [
      {
        key: 'kettleby-home',
        label: 'Home',
        line1: 'Anchor Cottage',
        line2: 'The Quay',
        city: 'Bideford',
        postcode: 'EX39 2AN',
        accessNotes: 'Sea-front property. Single-track lane, no van access — park on the quay.',
      },
    ],
  },
  {
    key: 'newland',
    name: 'Newland Park Developments',
    email: 'sitemanager@newlandpark.co.uk',
    phone: '0117 300 9900',
    notes: 'Ongoing new-build site. Site induction required before first attendance.',
    billing: {
      line1: 'Newland Park Site Office',
      line2: 'Off Folly Lane',
      city: 'Bristol',
      postcode: 'BS10 6TB',
    },
    sites: [
      {
        key: 'newland-plots',
        label: 'Plots 12–18, Newland Park',
        line1: 'Newland Park',
        line2: 'Off Folly Lane',
        city: 'Bristol',
        postcode: 'BS10 6TB',
        accessNotes: 'Hard hat and high-vis mandatory. Welfare unit on the left of the site entrance.',
      },
    ],
  },
  {
    key: 'brindley',
    name: 'Brindley & Sons (Bristol) Ltd',
    email: 'facilities@brindleyandsons.co.uk',
    phone: '0117 955 3311',
    billing: {
      line1: 'Brindley Works',
      line2: 'Feeder Road',
      city: 'Bristol',
      postcode: 'BS2 0SB',
    },
    sites: [
      {
        key: 'brindley-works',
        label: 'Brindley Works',
        line1: 'Brindley Works',
        line2: 'Feeder Road',
        city: 'Bristol',
        postcode: 'BS2 0SB',
        accessNotes: 'Isolate and lock off at the main panel before any work on the ring mains.',
      },
    ],
  },
  {
    key: 'osborne',
    name: 'Grace Osborne',
    email: 'grace.osborne@gmail.com',
    phone: '07700 900641',
    billing: {
      line1: '27 Fairfield Terrace',
      city: 'Bristol',
      postcode: 'BS5 9LH',
    },
    sites: [
      {
        key: 'osborne-home',
        label: 'Home',
        line1: '27 Fairfield Terrace',
        city: 'Bristol',
        postcode: 'BS5 9LH',
        accessNotes: 'Loft hatch in the back bedroom. Board is fragile — take the boards.',
      },
    ],
  },
  {
    key: 'ridley',
    name: 'Ridley Court Management Co.',
    email: 'secretary@ridleycourt.co.uk',
    phone: '0117 944 6677',
    notes: 'Residents’ management company. Works funded from the sinking fund — quote required in advance.',
    billing: {
      line1: 'Ridley Court',
      line2: 'Ashley Down Road',
      city: 'Bristol',
      postcode: 'BS7 9DB',
    },
    sites: [
      {
        key: 'ridley-communal',
        label: 'Communal areas — blocks A and B',
        line1: 'Ridley Court',
        line2: 'Ashley Down Road',
        city: 'Bristol',
        postcode: 'BS7 9DB',
        accessNotes: 'Access via the resident caretaker, Monday to Friday 08:00–16:00.',
      },
    ],
  },
  {
    key: 'chandra',
    name: 'Anita Chandra',
    email: 'anita.chandra@yahoo.co.uk',
    phone: '07700 900317',
    billing: { line1: '5 Marlow Gardens', city: 'Bath', postcode: 'BA1 6RY' },
    sites: [
      {
        key: 'chandra-home',
        label: 'Home',
        line1: '5 Marlow Gardens',
        city: 'Bath',
        postcode: 'BA1 6RY',
        accessNotes: 'Electric gate — call on arrival for the code.',
      },
    ],
  },
];

/**
 * Quote line templates. Written out rather than randomised so every document
 * reads like something a trade business would actually send.
 */
type QuoteLineSeed = { priceCode: string; quantity: number };

const QUOTES: (QuoteLineSeed[] | null)[] = [
  // 0 — full rewire of a Victorian terrace: labour, parts, certification.
  [
    { priceCode: 'SURVEY', quantity: 1 },
    { priceCode: 'LAB-DAY', quantity: 3 },
    { priceCode: 'EICR-DOM-L', quantity: 1 },
    { priceCode: 'CABLE-TE-2.5', quantity: 120 },
    { priceCode: 'MAT-CONSUMABLES', quantity: 3 },
  ],
  // 1 — consumer unit swap plus remedial bonding.
  [
    { priceCode: 'CU-REPLACE-18', quantity: 1 },
    { priceCode: 'EARTH-BOND-MAIN', quantity: 1 },
    { priceCode: 'LAB-HR-STD', quantity: 4 },
    { priceCode: 'PART-P', quantity: 1 },
  ],
  // 2 — landlord EICR with the remedials already priced.
  [
    { priceCode: 'EICR-DOM', quantity: 1 },
    { priceCode: 'CU-UPGRADE-RCBO', quantity: 2 },
    { priceCode: 'SMOKE-ALARM', quantity: 3 },
    { priceCode: 'PART-P', quantity: 1 },
  ],
  // 3 — boiler service and gas safety record.
  [
    { priceCode: 'BOILER-SERVICE', quantity: 1 },
    { priceCode: 'BOILER-SERVICE-LANDLORD', quantity: 1 },
    { priceCode: 'CO-ALARM', quantity: 2 },
    { priceCode: 'MAT-CONSUMABLES', quantity: 1 },
  ],
  // 4 — remedial C2/C3 works from an EICR.
  [
    { priceCode: 'EARTH-BOND-MAIN', quantity: 1 },
    { priceCode: 'CU-UPGRADE-RCBO', quantity: 4 },
    { priceCode: 'LAB-HR-STD', quantity: 6 },
    { priceCode: 'MAT-CONSUMABLES', quantity: 2 },
  ],
  // 5 — outdoor socket, garden circuit and an EV point.
  [
    { priceCode: 'EV-POINT', quantity: 1 },
    { priceCode: 'OUTDOOR-SOCKET', quantity: 2 },
    { priceCode: 'CABLE-SWA-4.0', quantity: 28 },
    { priceCode: 'MAT-CORES-DRILL', quantity: 2 },
    { priceCode: 'EIC', quantity: 1 },
    { priceCode: 'PART-P', quantity: 1 },
  ],
  // 6 — fault find on a tripping ring main.
  [
    { priceCode: 'FAULT-FIRST', quantity: 1 },
    { priceCode: 'FAULT-ADDL', quantity: 3 },
    { priceCode: 'LAB-HR-STD', quantity: 2 },
    { priceCode: 'MAT-CONSUMABLES', quantity: 1 },
  ],
  // 7 — heating upgrade: TRVs, smart stat, magnetic filter.
  [
    { priceCode: 'TRV-FIT', quantity: 6 },
    { priceCode: 'SMART-STAT', quantity: 1 },
    { priceCode: 'MAGNETIC-FILTER', quantity: 1 },
    { priceCode: 'HEAT-HR', quantity: 4 },
  ],
  // 8 — commercial EICR and emergency lighting.
  [
    { priceCode: 'EICR-COMM', quantity: 24 },
    { priceCode: 'EM-LIGHT', quantity: 6 },
    { priceCode: 'FIRE-ALARM-POINT', quantity: 3 },
    { priceCode: 'LAB-HR-STD', quantity: 8 },
  ],
  // 9 — kitchen and utility refurbishment, first fix to second fix.
  [
    { priceCode: 'LAB-DAY', quantity: 2 },
    { priceCode: 'CABLE-TE-2.5', quantity: 60 },
    { priceCode: 'LED-DOWNLIGHT', quantity: 10 },
    { priceCode: 'MAT-WALL-CHASE', quantity: 6 },
    { priceCode: 'EIC', quantity: 1 },
  ],
  // 10 — powerflush and radiator replacement.
  [
    { priceCode: 'POWERFLUSH', quantity: 1 },
    { priceCode: 'RADIATOR-FIT', quantity: 2 },
    { priceCode: 'HEAT-HR', quantity: 6 },
    { priceCode: 'MAT-CONSUMABLES', quantity: 1 },
  ],
  // 11 — loft insulation and cavity wall, zero-rated.
  [
    { priceCode: 'ESM-LOFT-INSUL', quantity: 78 },
    { priceCode: 'ESM-CAVITY-INSUL', quantity: 62 },
    { priceCode: 'SURVEY', quantity: 1 },
  ],
  // 12 — extractor fan and additional fire detection.
  [
    { priceCode: 'EXTRACT-FAN', quantity: 1 },
    { priceCode: 'FIRE-ALARM-POINT', quantity: 2 },
    { priceCode: 'LAB-HR-STD', quantity: 3 },
    { priceCode: 'PART-P', quantity: 1 },
  ],
  // 13 — out-of-hours emergency call-out.
  [
    { priceCode: 'CALLOUT-STD', quantity: 1 },
    { priceCode: 'RCD-SOCKET-KIT', quantity: 1 },
    { priceCode: 'MAT-CONSUMABLES', quantity: 1 },
  ],
  // 14 — small works, single line.
  [
    { priceCode: 'EXTRACT-FAN', quantity: 1 },
    { priceCode: 'LAB-HR-STD', quantity: 2 },
  ],
  // 15 — shower installation with a dedicated circuit.
  [
    { priceCode: 'SHOWER-INSTALL', quantity: 1 },
    { priceCode: 'CABLE-TE-2.5', quantity: 18 },
    { priceCode: 'CU-UPGRADE-RCBO', quantity: 1 },
    { priceCode: 'PART-P', quantity: 1 },
  ],
  // 16 — two-line follow-up quote to a commercial landlord.
  [
    { priceCode: 'CONSUMER-UNIT-10W', quantity: 1 },
    { priceCode: 'LAB-HR-STD', quantity: 5 },
  ],
  // 17 — boiler repair out of warranty, priced with the parts that usually go.
  [
    { priceCode: 'BOILER-REPAIR', quantity: 1 },
    { priceCode: 'ZTSTAT', quantity: 1 },
    { priceCode: 'MAT-CONSUMABLES', quantity: 1 },
  ],
  // 18 — single-line remedial from a landlord inspection.
  [
    { priceCode: 'RCD-SOCKET-KIT', quantity: 2 },
    { priceCode: 'LAB-HR-STD', quantity: 1 },
  ],
  // 19 — accepted, then called off before anyone attended.
  [
    { priceCode: 'EICR-DOM', quantity: 1 },
    { priceCode: 'CU-UPGRADE-RCBO', quantity: 1 },
    { priceCode: 'SMOKE-ALARM', quantity: 2 },
    { priceCode: 'PART-P', quantity: 1 },
  ],
  // 20 — landlord heating job, priced and sent, not yet answered.
  [
    { priceCode: 'BOILER-REPAIR', quantity: 1 },
    { priceCode: 'TRV-FIT', quantity: 4 },
    { priceCode: 'HEAT-HR', quantity: 3 },
    { priceCode: 'MAT-CONSUMABLES', quantity: 1 },
  ],
  // 21 — first-fix for a new-build plot, priced from the site drawings.
  [
    { priceCode: 'LAB-DAY', quantity: 4 },
    { priceCode: 'CABLE-TE-2.5', quantity: 240 },
    { priceCode: 'CABLE-TE-1.5', quantity: 180 },
    { priceCode: 'CONDUIT-20', quantity: 90 },
    { priceCode: 'MAT-CORES-DRILL', quantity: 12 },
    { priceCode: 'EIC', quantity: 1 },
  ],
];

const QUOTE_DECISION_NOTES: Record<string, string> = {
  ACCEPTED: 'Accepted over the phone — please book the first available slot.',
  DECLINED: 'Went with a cheaper quote from another firm.',
};

const DECLINE_REASONS = [
  'Customer has decided to postpone the work until the spring.',
  'Went with a lower quote from a firm recommended by a neighbour.',
];

const WITHDRAWN_NOTE = 'Accepted elsewhere before we could attend. No work carried out.';

/** Out-of-band call-off reasons a planner would actually type. */
const CANCELLED_NOTES = [
  'Customer called to cancel — property sale fell through. No charge raised.',
  'Cancelled by the letting agent; the tenant moved out before the visit.',
];

const COMPLETION_SUMMARIES = [
  'Consumer unit replaced with an 18th Edition metal enclosure and SPD. All circuits tested and RCBO protected, main bonding upgraded to 10mm². EIC issued, Part P notified to building control.',
  'Fault traced to a damaged leg of the ring main behind the kitchen units. Section replaced, insulation resistance retested at >200MΩ across all circuits. No further tripping reported by the customer.',
  'Boiler serviced, gas rate and combustion readings within manufacturer tolerance. CP12 issued for the managed property and a copy left with the tenant.',
  'Loose connection at the shower isolator tightened and the circuit re-terminated. RCD trip times verified within BS 7671 limits and recorded on the certificate.',
  'Two weatherproof outdoor sockets installed off a new 16A radial, SWA run clipped along the boundary wall. Circuit tested and EIC issued with Part P notification.',
  'Six TRVs fitted and the smart thermostat commissioned with the customer. System flushed and inhibitor added; flow temperatures balanced across all radiators.',
  'Emergency lighting tested and three units replaced. Fire alarm detection extended to the rear store room. Log book updated and left at reception.',
  'Downlights and first fix completed for the kitchen refurbishment. Circuits labelled at the consumer unit and the schedule left in the meter cupboard.',
  'Ring main fault found at a junction box under the landing floorboards. Joint remade with maintenance-free connectors and the circuit retested end to end.',
  'Extractor fan fitted with a humidity timer and ducted through the external wall. Additional smoke detection installed to bring the hall up to Grade D.',
  'Powerflush completed with a magnetic filter fitted afterwards. Two radiators replaced and the system refilled with corrosion inhibitor.',
  'Loft insulation topped up to 270mm and cavity walls injected. Both measures signed off and the guarantee paperwork left with the homeowner.',
  'Out-of-hours call-out for a total loss of power. Supply restored by replacing a failed main switch and the installation retested before leaving site.',
  'Shower circuit installed from the consumer unit with a dedicated 40A RCBO. Earth bonding verified and the certificate issued to the customer.',
];

const ATTACHMENT_KINDS: AttachmentKind[] = [
  AttachmentKind.PHOTO,
  AttachmentKind.PHOTO,
  AttachmentKind.DOCUMENT,
  AttachmentKind.SIGNATURE,
];

const PHOTO_NAMES = [
  'consumer-unit-before.jpg',
  'consumer-unit-after.jpg',
  'fault-at-junction-box.jpg',
  'boiler-flue-reading.jpg',
  'outdoor-socket-run.jpg',
  'trv-fitted.jpg',
  'emergency-light-test.jpg',
  'landing-floorboards.jpg',
];

const DOCUMENT_NAMES = [
  'eicr-schedule.pdf',
  'cp12-certificate.pdf',
  'eic-certificate.pdf',
  'test-schedule.pdf',
];

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

type PriceMap = Map<string, { id: string; description: string; unitPrice: number; taxRateBp: number }>;

function buildPriceBook(tenantId: string): {
  rows: unknown[];
  byCode: PriceMap;
} {
  const byCode: PriceMap = new Map();
  const rows = PRICE_BOOK.map((item) => {
    const rowId = id();
    byCode.set(item.code, {
      id: rowId,
      description: item.description,
      unitPrice: item.unitPrice,
      taxRateBp: item.taxRateBp,
    });
    return {
      id: rowId,
      tenantId,
      code: item.code,
      description: item.description,
      unit: item.unit,
      unitPrice: item.unitPrice,
      taxRateBp: item.taxRateBp,
      active: true,
    };
  });
  return { rows, byCode };
}

function buildCustomers(tenantId: string) {
  const customers: unknown[] = [];
  const sites: unknown[] = [];
  const siteIdByKey = new Map<string, string>();
  const customerIdByKey = new Map<string, string>();
  const siteIdsByCustomer = new Map<string, string[]>();

  for (const c of CUSTOMERS) {
    const customerId = id();
    customerIdByKey.set(c.key, customerId);
    customers.push({
      id: customerId,
      tenantId,
      name: c.name,
      email: c.email ?? null,
      phone: c.phone ?? null,
      notes: c.notes ?? null,
      billingLine1: c.billing.line1,
      billingLine2: c.billing.line2 ?? null,
      billingCity: c.billing.city,
      billingPostcode: c.billing.postcode,
      billingCountry: 'GB',
    });
    const ids: string[] = [];
    for (const s of c.sites) {
      const siteId = id();
      siteIdByKey.set(s.key, siteId);
      ids.push(siteId);
      sites.push({
        id: siteId,
        tenantId,
        customerId,
        label: s.label,
        line1: s.line1,
        line2: s.line2 ?? null,
        city: s.city,
        postcode: s.postcode,
        country: 'GB',
        accessNotes: s.accessNotes ?? null,
      });
    }
    siteIdsByCustomer.set(c.key, ids);
  }

  return { customers, sites, siteIdByKey, customerIdByKey, siteIdsByCustomer };
}

/* Fields omitted here on purpose: each job's quoteId/customerId/siteId are
 * filled from the quote it was raised from, so a job can never point at a site
 * that does not belong to its customer. */
type JobPlan = {
  quoteIdx: number;
  dayOffset: number;
  startHour: number;
  durationHours: number;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'SCHEDULED' | 'CANCELLED';
  assigneeIdx: number;
};

/**
 * Fifteen jobs across the two weeks either side of today.
 *
 * Two properties of this table are load-bearing:
 *
 *  1. `assigneeIdx` and `dayOffset` form a Latin square — engineer i works on
 *     day i — so no two jobs can occupy the same engineer's time. The database
 *     exclusion constraint (`jobs_no_overlapping_assignments`) rejects an
 *     overlapping pair outright rather than skewing the calendar, so an
 *     accidental collision would fail the seed rather than produce bad data.
 *
 *  2. The CANCELLED job is deliberately assigned to an engineer who already has
 *     work that day. Cancelled assignments are outside the constraint, and a
 *     real planner's day shows exactly that.
 */
const JOBS: JobPlan[] = [
  {
    quoteIdx: 0,
    dayOffset: -12,
    startHour: 8,
    durationHours: 8,
    status: 'COMPLETED',
    assigneeIdx: 0,
  },
  {
    quoteIdx: 1,
    dayOffset: -11,
    startHour: 8,
    durationHours: 4,
    status: 'COMPLETED',
    assigneeIdx: 1,
  },
  {
    quoteIdx: 2,
    dayOffset: -10,
    startHour: 9,
    durationHours: 3,
    status: 'COMPLETED',
    assigneeIdx: 2,
  },
  {
    quoteIdx: 3,
    dayOffset: -7,
    startHour: 8,
    durationHours: 2,
    status: 'COMPLETED',
    assigneeIdx: 3,
  },
  {
    quoteIdx: 4,
    dayOffset: -6,
    startHour: 8,
    durationHours: 6,
    status: 'COMPLETED',
    assigneeIdx: 4,
  },
  {
    quoteIdx: 5,
    dayOffset: -4,
    startHour: 8,
    durationHours: 8,
    status: 'COMPLETED',
    assigneeIdx: 5,
  },
  {
    quoteIdx: 6,
    dayOffset: -2,
    startHour: 13,
    durationHours: 3,
    status: 'COMPLETED',
    assigneeIdx: 6,
  },
  {
    quoteIdx: 7,
    dayOffset: -1,
    startHour: 8,
    durationHours: 8,
    status: 'COMPLETED',
    assigneeIdx: 7,
  },
  {
    quoteIdx: 8,
    dayOffset: 0,
    startHour: 8,
    durationHours: 8,
    status: 'IN_PROGRESS',
    assigneeIdx: 8,
  },
  {
    quoteIdx: 9,
    dayOffset: 1,
    startHour: 8,
    durationHours: 8,
    status: 'SCHEDULED',
    assigneeIdx: 0,
  },
  {
    quoteIdx: 10,
    dayOffset: 2,
    startHour: 8,
    durationHours: 4,
    status: 'SCHEDULED',
    assigneeIdx: 1,
  },
  {
    quoteIdx: 13,
    dayOffset: 3,
    startHour: 10,
    durationHours: 2,
    status: 'SCHEDULED',
    assigneeIdx: 2,
  },
  {
    quoteIdx: 14,
    dayOffset: 4,
    startHour: 9,
    durationHours: 2,
    status: 'SCHEDULED',
    assigneeIdx: 3,
  },
  {
    quoteIdx: 15,
    dayOffset: 6,
    startHour: 8,
    durationHours: 4,
    status: 'SCHEDULED',
    assigneeIdx: 4,
  },
  {
    quoteIdx: 18,
    dayOffset: 8,
    startHour: 9,
    durationHours: 2,
    status: 'SCHEDULED',
    assigneeIdx: 5,
  },
  // Called off after the customer had already accepted: kept on the calendar as
  // a cancelled assignment, which is why it may sit on top of another booking.
  {
    quoteIdx: 19,
    dayOffset: -10,
    startHour: 13,
    durationHours: 2,
    status: 'CANCELLED',
    assigneeIdx: 2,
  },
];

/**
 * Quote statuses by index.
 *
 * Every index `JOBS` references must be ACCEPTED, and the guard in `main`
 * enforces it — this array and the job plans drifted apart once during authoring
 * and produced completed work against a quote that was never sent, which is
 * the kind of detail a demo audience notices. The remaining indices carry the
 * other four statuses so every list filter in the UI has something in it.
 */
const QUOTE_STATUSES: QuoteStatus[] = [
  QuoteStatus.ACCEPTED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.DRAFT,
  QuoteStatus.EXPIRED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.DECLINED,
  QuoteStatus.SENT,
  QuoteStatus.ACCEPTED,
  QuoteStatus.ACCEPTED,
  QuoteStatus.DRAFT,
  QuoteStatus.EXPIRED,
];

/**
 * How long ago each quote was raised. A quote's validity is 30 business days
 * from its creation, so the EXPIRED entries are old enough to have lapsed and
 * the DRAFT ones are recent enough that nobody has chased them yet.
 */
const QUOTE_DAY_OFFSETS = [
  -34, -30, -26, -22, -19, -5, -2, -26, -20, -3, -12, 0, -60, -8, -1, -4, -25, -6, -15, -7, -18, -46,
];

/** Which site a quote is priced for. Omitted means the customer's first site. */
const QUOTE_SITE_KEYS: (string | null)[] = [
  null,
  null,
  'oakleigh-12-station',
  'oakleigh-45-gloucester',
  'harrow-argyle',
  null,
  null,
  'marsh-hall',
  'harrow-bramley',
  'newland-plots',
  'conway-practice',
  'chandra-home',
  'osborne-home',
  'oakleigh-9-tyndall',
  null,
  'penrose-home',
  'brindley-works',
  'ridley-communal',
  'oakleigh-22-redland',
  'harrow-meanwood',
  'ridley-communal',
];

/**
 * Quote → customer. Every account gets at least one document so no list view in
 * the demo is empty, and the two multi-site accounts appear more than once
 * because that is what their portfolios look like.
 */
const QUOTE_CUSTOMER_KEYS: string[] = [
  'whitfield',
  'baxter',
  'oakleigh',
  'oakleigh',
  'harrow',
  'fraser',
  'kettleby',
  'marsh',
  'harrow',
  'newland',
  'conway',
  'chandra',
  'osborne',
  'oakleigh',
  'penrose',
  'penrose',
  'brindley',
  'ridley',
  'oakleigh',
  'harrow',
  'ridley',
];

type InvoicePlan = {
  jobIdx: number;
  status: InvoiceStatus;
  issuedOffsetDays: number;
  dueOffsetDays: number;
  depositAmount: number;
  paymentReference?: string;
};

/**
 * Invoices raised from completed jobs. DRAFT invoices have no issue date;
 * SENT ones are due 14 days out; PAID ones settle inside that window with the
 * bank reference the customer quoted back.
 */
const INVOICES: InvoicePlan[] = [
  {
    jobIdx: 0,
    status: InvoiceStatus.PAID,
    issuedOffsetDays: -11,
    dueOffsetDays: 3,
    depositAmount: 20000,
    paymentReference: 'BACS 4471',
  },
  {
    jobIdx: 1,
    status: InvoiceStatus.PAID,
    issuedOffsetDays: -9,
    dueOffsetDays: 5,
    depositAmount: 0,
    paymentReference: 'FPS 90/HAL',
  },
  {
    jobIdx: 2,
    status: InvoiceStatus.SENT,
    issuedOffsetDays: -9,
    dueOffsetDays: 5,
    depositAmount: 0,
  },
  {
    jobIdx: 3,
    status: InvoiceStatus.SENT,
    issuedOffsetDays: -6,
    dueOffsetDays: 8,
    depositAmount: 0,
  },
  {
    jobIdx: 4,
    status: InvoiceStatus.PAID,
    issuedOffsetDays: -5,
    dueOffsetDays: 9,
    depositAmount: 0,
    paymentReference: 'CHQ 100442',
  },
  {
    jobIdx: 5,
    status: InvoiceStatus.SENT,
    issuedOffsetDays: -3,
    dueOffsetDays: 11,
    depositAmount: 50000,
  },
  {
    jobIdx: 6,
    status: InvoiceStatus.SENT,
    issuedOffsetDays: -2,
    dueOffsetDays: 12,
    depositAmount: 0,
  },
  {
    jobIdx: 7,
    status: InvoiceStatus.PAID,
    issuedOffsetDays: -1,
    dueOffsetDays: 13,
    depositAmount: 0,
    paymentReference: 'BACS 8812',
  },
  {
    jobIdx: 4,
    status: InvoiceStatus.DRAFT,
    issuedOffsetDays: 0,
    dueOffsetDays: 14,
    depositAmount: 0,
  },
  {
    jobIdx: 5,
    status: InvoiceStatus.DRAFT,
    issuedOffsetDays: 0,
    dueOffsetDays: 14,
    depositAmount: 0,
  },
  {
    jobIdx: 7,
    status: InvoiceStatus.DRAFT,
    issuedOffsetDays: 0,
    dueOffsetDays: 14,
    depositAmount: 0,
  },
];

/* ------------------------------------------------------------------ */
/* Seed                                                                */
/* ------------------------------------------------------------------ */

/**
 * Stamp each customer — and the sites they own — with the date the account was
 * opened. A site is at least as old as its customer, and usually the same day.
 */
function applyCustomerCreatedAt(
  customers: unknown[],
  sites: unknown[],
  customerIdByKey: Map<string, string>,
  createdAtByKey: Map<string, Date>,
): void {
  const keyById = new Map<string, string>();
  for (const [key, customerId] of customerIdByKey) keyById.set(customerId, key);

  for (const row of customers as Record<string, unknown>[]) {
    const key = keyById.get(row.id as string);
    if (key) row.createdAt = createdAtByKey.get(key);
  }
  for (const row of sites as Record<string, unknown>[]) {
    const key = keyById.get(row.customerId as string);
    if (key) row.createdAt = createdAtByKey.get(key);
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();

  // See the note on NOW. Read before anything is computed, so the whole dataset
  // shares one instant rather than drifting across the run.
  const clock = await prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  const serverNow = clock[0]?.now;
  if (!serverNow) throw new Error('Could not read the database clock.');
  NOW = new Date(Math.floor(serverNow.getTime() / 1000) * 1000);

  // One hash for everybody. Hashing twelve times costs a second and proves
  // nothing: the demo password is a constant, and scrypt's salt is embedded in
  // the string, so the same hash is still a valid independent credential.
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const year = NOW.getUTCFullYear();

  const tenantId = TENANT.id;
  const { rows: priceRows, byCode } = buildPriceBook(tenantId);
  const { customers, sites, siteIdByKey, customerIdByKey, siteIdsByCustomer } = buildCustomers(tenantId);

  // An account predates the first thing it was ever quoted for. Deriving it from
  // the customer's earliest document keeps the CRM history readable — a customer
  // whose first quote is two months old did not appear on the system today.
  const customerCreatedAt = new Map<string, Date>();
  CUSTOMERS.forEach((customer, index) => {
    const offsets = QUOTE_CUSTOMER_KEYS.flatMap((key, quoteIndex) =>
      key === customer.key ? [QUOTE_DAY_OFFSETS[quoteIndex] ?? -30] : [],
    );
    const earliest = offsets.length > 0 ? Math.min(...offsets) : -index * 9;
    customerCreatedAt.set(customer.key, daysFromNow(earliest - 12 - (earliest % 7)));
  });
  applyCustomerCreatedAt(customers, sites, customerIdByKey, customerCreatedAt);

  const users = STAFF.map((member, index) => ({
    id: id(),
    tenantId,
    email: member.email.toLowerCase(),
    name: member.name,
    role: member.role,
    passwordHash,
    active: true,
    // Deterministic spread so "joined six months ago" looks like a real team.
    createdAt: daysFromNow(-540 + index * 37),
  }));

  const owner = users[0]!;
  const officeUsers = users.filter((u) => u.role === UserRole.OFFICE);
  const engineers = users.filter((u) => u.role === UserRole.ENGINEER);

  if (engineers.length < ENGINEER_COUNT) throw new Error('Engineer pool shorter than expected.');

  // A job may only be raised from an accepted quote. The API refuses otherwise,
  // so a seed that breaks the rule produces a database the application could
  // never have written — and one that a reviewer would rightly call a bug.
  if (QUOTE_STATUSES.length !== QUOTES.length) {
    throw new Error(
      `QUOTE_STATUSES has ${QUOTE_STATUSES.length} entries for ${QUOTES.length} quotes; every quote needs a status.`,
    );
  }
  for (const plan of JOBS) {
    if (QUOTE_STATUSES[plan.quoteIdx] !== QuoteStatus.ACCEPTED) {
      throw new Error(
        `Job plan ${JOBS.indexOf(plan)} points at quote ${plan.quoteIdx}, which is ${QUOTE_STATUSES[plan.quoteIdx]}. ` +
          'Only ACCEPTED quotes can be scheduled.',
      );
    }
  }

  /* Quotes ---------------------------------------------------------- */

  const quoteRows: unknown[] = [];
  const quoteLineRows: unknown[] = [];
  const decisionRows: unknown[] = [];
  const quoteLinesByIndex = new Map<
    number,
    {
      id: string;
      description: string;
      quantity: number;
      unitPrice: number;
      taxRateBp: number;
    }[]
  >();
  const quoteMeta: {
    id: string;
    number: string;
    customerId: string;
    siteId: string;
    status: QuoteStatus;
    issuedAt: Date | null;
  }[] = [];

  QUOTES.forEach((template, index) => {
    const status = QUOTE_STATUSES[index] ?? QuoteStatus.DRAFT;
    const customerKey = QUOTE_CUSTOMER_KEYS[index] ?? CUSTOMERS[0]!.key;
    const customerId = customerIdByKey.get(customerKey)!;
    const siteKey = QUOTE_SITE_KEYS[index];
    const siteId = siteKey ? siteIdByKey.get(siteKey)! : (siteIdsByCustomer.get(customerKey) ?? [])[0]!;
    const quoteId = id();
    const number = `Q-${year}-${String(index + 1).padStart(4, '0')}`;
    const createdOffset = QUOTE_DAY_OFFSETS[index] ?? -30;
    const createdAt = daysFromNow(createdOffset);
    const issuedAt = status === QuoteStatus.DRAFT ? null : daysFromNow(createdOffset + 1);
    const decided =
      status === QuoteStatus.ACCEPTED || status === QuoteStatus.DECLINED
        ? daysFromNow(createdOffset + 3)
        : null;

    const lines = (template ?? []).map((seed, position) => {
      const item = byCode.get(seed.priceCode);
      if (!item) throw new Error(`Unknown price book code in quote ${index}: ${seed.priceCode}`);
      return {
        id: id(),
        quoteId,
        priceBookItemId: item.id,
        position: position + 1,
        description: item.description,
        quantity: seed.quantity,
        unitPrice: item.unitPrice,
        taxRateBp: item.taxRateBp,
      };
    });

    // Totals are computed here only to prove the seed and the API agree. The
    // quote tables store line inputs; the read model derives the same numbers.
    computeTotals(
      lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: { amount: l.unitPrice, currency: 'GBP' as const },
        taxRateBp: l.taxRateBp,
      })),
      'GBP',
    );

    quoteLineRows.push(...lines);
    quoteLinesByIndex.set(index, lines);
    quoteMeta.push({
      id: quoteId,
      number,
      customerId,
      siteId,
      status,
      issuedAt,
    });

    quoteRows.push({
      id: quoteId,
      tenantId,
      customerId,
      siteId,
      number,
      status,
      // Drafts have been saved once; a sent quote has been edited; a decided one
      // has been through the send round trip. Nothing here is version 1.
      version: status === QuoteStatus.DRAFT ? 1 : status === QuoteStatus.SENT ? 2 : 3,
      currency: 'GBP',
      notes:
        status === QuoteStatus.DRAFT
          ? 'Draft — waiting on the customer to confirm access arrangements before sending.'
          : null,
      validUntil: businessDaysAfter(createdAt, 30),
      issuedAt,
      decidedAt: decided,
      publicToken: token(`q${index.toString(36)}`, index),
      createdAt,
    });

    if (status === QuoteStatus.ACCEPTED || status === QuoteStatus.DECLINED) {
      // Exactly one decision arrives through the customer's link; the rest are
      // recorded by the office from a phone call or an email reply.
      const viaPublicLink = index === 3;
      const actor = viaPublicLink
        ? null
        : index % 2 === 0
          ? owner.id
          : officeUsers[index % officeUsers.length]!.id;
      decisionRows.push({
        id: id(),
        quoteId,
        decision: status,
        note: viaPublicLink
          ? 'Accepted through the customer link from the tenant’s own device.'
          : status === QuoteStatus.ACCEPTED
            ? QUOTE_DECISION_NOTES.ACCEPTED
            : (DECLINE_REASONS[index % DECLINE_REASONS.length] ?? DECLINE_REASONS[0]),
        userId: actor,
        viaPublicLink,
        ipAddress: viaPublicLink
          ? `86.${20 + (index % 40)}.${100 + (index % 90)}.${7 + (index % 120)}`
          : null,
        createdAt: decided ?? createdAt,
      });
    }
  });

  /* Jobs ------------------------------------------------------------ */

  const jobRows: unknown[] = [];
  const eventRows: unknown[] = [];
  const attachmentRows: unknown[] = [];
  const completedJobIndexes: number[] = [];

  JOBS.forEach((plan, index) => {
    const quote = quoteMeta[plan.quoteIdx]!;
    const assignee = engineers[plan.assigneeIdx % engineers.length]!;
    const jobId = id();
    const number = `J-${year}-${String(index + 1).padStart(4, '0')}`;

    const start = at(plan.dayOffset, plan.startHour);
    let end = new Date(start.getTime() + plan.durationHours * 60 * 60 * 1000);
    let completedAt: Date | null = null;
    let completionSummary: string | null = null;

    if (plan.status === 'COMPLETED') {
      completedAt = end;
      completionSummary = COMPLETION_SUMMARIES[index % COMPLETION_SUMMARIES.length]!;
      completedJobIndexes.push(index);
    } else if (plan.status === 'IN_PROGRESS') {
      /**
       * The one job that must genuinely straddle *now* whenever this runs.
       *
       * Anchoring it to a fixed morning does not work: seeded at 17:00 the job
       * would already have finished, and the demo would open on a job marked
       * "in progress" that nothing else in the data agrees with. So the window
       * is built around the clock instead — dragged back to the start of the
       * working day if the run happens early, pushed past the end of it if the
       * run happens late, and always containing `now` in between.
       */
      const morning = at(0, 8);
      start.setTime(minDate(morning, hoursFromNow(-3)).getTime());
      // Clamp against `now` *after* the duration rather than on the planned end.
      // The run clock is not necessarily inside the working day those fixed hours
      // describe — a seed at 03:00 or 20:00 would otherwise produce a job whose
      // window has already closed, which reads as finished whatever the status
      // column says.
      end = maxDate(addMinutes(start, plan.durationHours * 60), hoursFromNow(2));
    }

    /**
     * A job is booked a few days before it is due, and the audit trail starts
     * there — the first event is the scheduling, not the first status change.
     *
     * The three clamps below keep the trail internal-consistent, which is the
     * whole point of writing it rather than leaving `statusEvents` empty:
     *
     *   - a job booked last week for next week must not claim an event that has
     *     not happened yet, so nothing is ever stamped after `now`;
     *   - a job cannot be booked after it started (the day -1 and day -2 jobs
     *     would otherwise be created at 06:00 on the day, five hours late);
     *   - events advance by at least a minute, so the timeline reads in order
     *     even where the clamp pushes two of them together.
     */
    const jobCreatedAt = minDate(daysFromNow(plan.dayOffset - 4, NOW), NOW);
    const bookedAt = minDate(
      maxDate(daysFromNow(plan.dayOffset - 4, NOW), addMinutes(jobCreatedAt, 30)),
      minDate(at(plan.dayOffset, plan.startHour), NOW),
    );

    const events: unknown[] = [
      {
        id: id(),
        jobId,
        fromStatus: null,
        toStatus: 'SCHEDULED',
        note: `Booked in for ${start.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}.`,
        actorId: officeUsers[index % officeUsers.length]!.id,
        createdAt: bookedAt,
      },
    ];

    if (plan.status === 'IN_PROGRESS') {
      events.push({
        id: id(),
        jobId,
        fromStatus: 'SCHEDULED',
        toStatus: 'IN_PROGRESS',
        note: 'On site — access gained, work started.',
        actorId: assignee.id,
        createdAt: minDate(start, NOW),
      });
    } else if (plan.status === 'COMPLETED') {
      events.push({
        id: id(),
        jobId,
        fromStatus: 'SCHEDULED',
        toStatus: 'IN_PROGRESS',
        note: 'On site and working.',
        actorId: assignee.id,
        createdAt: start,
      });
      events.push({
        id: id(),
        jobId,
        fromStatus: 'IN_PROGRESS',
        toStatus: 'COMPLETED',
        note: 'Work complete, certificates issued and area left clean.',
        actorId: assignee.id,
        createdAt: completedAt,
      });
    } else if (plan.status === 'CANCELLED') {
      events.push({
        id: id(),
        jobId,
        fromStatus: 'SCHEDULED',
        toStatus: 'CANCELLED',
        note: CANCELLED_NOTES[index % CANCELLED_NOTES.length]!,
        actorId: officeUsers[index % officeUsers.length]!.id,
        // Called off a day after it was booked, anchored to the booking rather
        // than to the wall clock: a job booked late enough would otherwise
        // acquire a cancellation that predates its own creation.
        createdAt: minDate(daysFromNow(1, jobCreatedAt), NOW),
      });
    }

    /**
     * Monotonic timestamps, never before the job existed and never after the
     * clock the seed was anchored to. A job booked today for next week has a
     * single event stamped at the booking, which is the honest record: nothing
     * has happened to it yet, so nothing should be dated in the future.
     */
    let cursor = jobCreatedAt;
    for (const event of events as { createdAt: Date }[]) {
      const stamped = minDate(maxDate(event.createdAt, addMinutes(cursor, 1)), NOW);
      event.createdAt = stamped;
      cursor = stamped;
    }

    eventRows.push(...events);

    jobRows.push({
      id: jobId,
      tenantId,
      quoteId: quote.id,
      customerId: quote.customerId,
      siteId: quote.siteId,
      assigneeId: assignee.id,
      number,
      status: plan.status,
      version: plan.status === 'SCHEDULED' ? 1 : plan.status === 'CANCELLED' ? 2 : 3,
      scheduledStart: start,
      scheduledEnd: end,
      completionSummary,
      completedAt,
      notes:
        plan.status === 'CANCELLED'
          ? WITHDRAWN_NOTE
          : index % 4 === 1
            ? 'Customer has asked to be called 30 minutes before arrival.'
            : null,
      createdAt: jobCreatedAt,
    });

    // Evidence a real engineer would attach. Completed jobs carry more of it.
    const attachmentCount = plan.status === 'COMPLETED' ? 2 : plan.status === 'IN_PROGRESS' ? 2 : 0;
    for (let n = 0; n < attachmentCount; n += 1) {
      const kind = ATTACHMENT_KINDS[(index + n) % ATTACHMENT_KINDS.length]!;
      const filename =
        kind === AttachmentKind.PHOTO
          ? PHOTO_NAMES[(index + n) % PHOTO_NAMES.length]!
          : DOCUMENT_NAMES[(index + n) % DOCUMENT_NAMES.length]!;
      attachmentRows.push({
        id: id(),
        jobId,
        kind,
        filename,
        mimeType: kind === AttachmentKind.PHOTO ? 'image/jpeg' : 'application/pdf',
        byteSize: 180_000 + ((index * 37 + n * 91) % 900) * 1_024,
        // Storage key only — the seed never writes to object storage. Shaped like
        // a real bucket key so the download route can be exercised with a stub.
        storageKey: `tenants/${tenantId}/jobs/${jobId}/${filename}`,
        note: kind === AttachmentKind.DOCUMENT ? 'Copy filed against the job record.' : null,
        createdAt: completedAt ?? start,
      });
    }
  });

  // An invoice line is a snapshot of a quote line, so every invoice needs a
  // completed job behind it and at least one such job for the minimum invoice to
  // come from. Caught here rather than as an empty INVOICES array silently
  // seeding no invoices at all.
  if (completedJobIndexes.length === 0) throw new Error('No completed jobs: invoices have no source.');

  /* Invoices -------------------------------------------------------- */

  const invoiceRows: unknown[] = [];
  const invoiceLineRows: unknown[] = [];

  INVOICES.forEach((plan, index) => {
    const job = jobRows[plan.jobIdx] as Record<string, unknown>;
    const quote = quoteMeta[JOBS[plan.jobIdx]!.quoteIdx]!;
    const sourceLines = quoteLinesByIndex.get(JOBS[plan.jobIdx]!.quoteIdx) ?? [];
    const invoiceId = id();
    const issuedAt = plan.status === InvoiceStatus.DRAFT ? null : at(plan.issuedOffsetDays, 17);
    const dueAt = plan.status === InvoiceStatus.DRAFT ? null : dayStart(plan.dueOffsetDays);
    const paidAt =
      plan.status === InvoiceStatus.PAID && issuedAt
        ? at(Math.max(plan.issuedOffsetDays + 2, plan.dueOffsetDays - 3), 10, 15)
        : null;

    const lines = sourceLines.map((line, position) => {
      const net = line.unitPrice * line.quantity;
      const tax = Math.round(net * (line.taxRateBp / 10_000));
      return {
        id: id(),
        invoiceId,
        sourceQuoteLineId: line.id,
        position: position + 1,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxRateBp: line.taxRateBp,
        netAmount: net,
        taxAmount: tax,
      };
    });

    // The same helper the API uses, so a stored total cannot drift from what the
    // invoice screen recomputes for display.
    const totals = computeTotals(
      lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: { amount: l.unitPrice, currency: 'GBP' as const },
        taxRateBp: l.taxRateBp,
      })),
      'GBP',
    );

    const storedNet = totals.net.amount;
    const storedTax = totals.tax.amount;
    const deposit = plan.depositAmount;

    if (
      lines.some(
        (l, i) => l.netAmount !== totals.lines[i]!.net.amount || l.taxAmount !== totals.lines[i]!.tax.amount,
      )
    ) {
      throw new Error(`Invoice line totals disagree with computeTotals for invoice ${index}.`);
    }

    invoiceLineRows.push(...lines);
    invoiceRows.push({
      id: invoiceId,
      tenantId,
      jobId: job.id,
      customerId: quote.customerId,
      number: `INV-${year}-${String(index + 1).padStart(4, '0')}`,
      status: plan.status,
      currency: 'GBP',
      netTotal: storedNet,
      taxTotal: storedTax,
      // The full gross of the document. A deposit does not change what the
      // invoice says it was for, only the balance, which is derived on read.
      grossTotal: storedNet + storedTax,
      depositAmount: deposit,
      issuedAt,
      dueAt,
      paidAt,
      paymentReference: plan.paymentReference ?? null,
      notes:
        plan.status === InvoiceStatus.DRAFT
          ? 'Held back until the customer confirms the final meter reading.'
          : null,
      createdAt: issuedAt ?? hoursFromNow(-6 + index),
    });
  });

  /* Clean slate + insert -------------------------------------------- */

  await prisma.$transaction(
    async (tx) => {
      // Upsert rather than delete: the tenant row is the anchor, and recreating
      // it would churn its id for anything holding a link.
      await tx.tenant.upsert({
        where: { id: tenantId },
        create: {
          id: tenantId,
          name: TENANT.name,
          slug: TENANT.slug,
          currency: TENANT.currency,
          vatNumber: TENANT.vatNumber,
        },
        update: {
          name: TENANT.name,
          slug: TENANT.slug,
          currency: TENANT.currency,
          vatNumber: TENANT.vatNumber,
        },
      });

      // Delete order follows the RESTRICT edges (invoices → jobs → quotes →
      // sites/customers). Everything else cascades from the rows above.
      await tx.invoiceLine.deleteMany({ where: { invoice: { tenantId } } });
      await tx.invoice.deleteMany({ where: { tenantId } });
      await tx.jobAttachment.deleteMany({ where: { job: { tenantId } } });
      await tx.jobStatusEvent.deleteMany({ where: { job: { tenantId } } });
      await tx.job.deleteMany({ where: { tenantId } });
      await tx.quoteDecision.deleteMany({ where: { quote: { tenantId } } });
      await tx.quoteLine.deleteMany({ where: { quote: { tenantId } } });
      await tx.quote.deleteMany({ where: { tenantId } });
      await tx.site.deleteMany({ where: { tenantId } });
      await tx.customer.deleteMany({ where: { tenantId } });
      await tx.priceBookItem.deleteMany({ where: { tenantId } });
      await tx.documentCounter.deleteMany({ where: { tenantId } });
      await tx.user.deleteMany({ where: { tenantId } });

      await tx.user.createMany({ data: users as never });
      await tx.priceBookItem.createMany({ data: priceRows as never });
      await tx.customer.createMany({ data: customers as never });
      await tx.site.createMany({ data: sites as never });
      await tx.quote.createMany({ data: quoteRows as never });
      await tx.quoteLine.createMany({ data: quoteLineRows as never });
      if (decisionRows.length > 0) await tx.quoteDecision.createMany({ data: decisionRows as never });
      await tx.job.createMany({ data: jobRows as never });
      await tx.jobStatusEvent.createMany({ data: eventRows as never });
      if (attachmentRows.length > 0) await tx.jobAttachment.createMany({ data: attachmentRows as never });
      await tx.invoice.createMany({ data: invoiceRows as never });
      await tx.invoiceLine.createMany({ data: invoiceLineRows as never });

      // The counters must line up with the seeded numbers, or the next document
      // created through the UI collides with a seeded one on the unique index.
      await tx.documentCounter.createMany({
        data: [
          { tenantId, kind: `QUOTE-${year}`, nextValue: quoteRows.length + 1 },
          { tenantId, kind: `JOB-${year}`, nextValue: jobRows.length + 1 },
          {
            tenantId,
            kind: `INVOICE-${year}`,
            nextValue: invoiceRows.length + 1,
          },
        ],
      });

    },
    // The default 5s interactive budget is tight for a full delete-and-rebuild,
    // especially over a container-to-host connection.
    { timeout: 60_000 },
  );

  const elapsed = Date.now() - startedAt;
  process.stdout.write(
    [
      `Seeded ${TENANT.name} (${TENANT.slug}) in ${elapsed} ms`,
      `  users              ${users.length}`,
      `  price book items   ${priceRows.length}`,
      `  customers          ${customers.length}`,
      `  sites              ${sites.length}`,
      `  quotes             ${quoteRows.length} (${quoteLineRows.length} lines, ${decisionRows.length} decisions)`,
      `  jobs               ${jobRows.length} (${eventRows.length} status events, ${attachmentRows.length} attachments)`,
      `  invoices           ${invoiceRows.length} (${invoiceLineRows.length} lines)`,
      `  demo password      ${DEMO_PASSWORD}`,
    ].join('\n') + '\n',
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Seed failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
