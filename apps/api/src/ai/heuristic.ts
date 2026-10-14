import type { DraftQuoteSuggestion } from '@tradeflow/shared';
import type { DraftContext, DraftProvider, DraftResult, PriceBookEntry } from './types';

/**
 * Drafting by keyword and quantity matching, with no external service.
 *
 * This is the provider the demo and CI run on, so it is written to be genuinely
 * useful rather than a placeholder. Two things make it work well enough to save
 * an operator real time:
 *
 *   1. A synonym table. Customers do not say "thermostatic radiator valve"; they
 *      say "TRV" or "the valve on the radiator". Matching on the price book's own
 *      wording alone would miss most of what people actually write.
 *   2. Quantity extraction. "Three bedrooms" and "2 x downlights" both have to
 *      become a line quantity of 3 and 2, otherwise every suggestion arrives
 *      needing the same edit.
 *
 * It is deliberately conservative: an unmatched phrase is reported rather than
 * guessed at. A suggestion the operator has to delete costs more than a blank
 * line they have to add.
 */

/** Words a customer uses, mapped to the words on the price book line. */
const SYNONYMS: Record<string, string[]> = {
  trv: ['thermostatic', 'radiator', 'valve'],
  'consumer unit': ['consumer', 'unit', 'fuse', 'board'],
  fusebox: ['consumer', 'unit'],
  'fuse box': ['consumer', 'unit'],
  boiler: ['boiler'],
  radiator: ['radiator'],
  downlight: ['downlight', 'spotlight', 'light'],
  downlights: ['downlight', 'spotlight', 'light'],
  socket: ['socket', 'outlet'],
  sockets: ['socket', 'outlet'],
  'outside light': ['external', 'light', 'security'],
  'outside lights': ['external', 'light', 'security'],
  rewiring: ['rewire'],
  rewire: ['rewire'],
  'eicr': ['eicr', 'condition', 'report', 'inspection'],
  'landlord certificate': ['eicr', 'condition', 'report'],
  'gas safety': ['gas', 'safety', 'cp12'],
  cp12: ['gas', 'safety'],
  'boiler service': ['boiler', 'service'],
  immersion: ['immersion', 'heater'],
  'shower': ['shower', 'pump'],
  'extractor': ['extractor', 'fan'],
  'smoke alarm': ['smoke', 'alarm'],
  'smoke alarms': ['smoke', 'alarm'],
  'carbon monoxide': ['carbon', 'monoxide', 'alarm'],
  'earth bonding': ['bonding', 'earth'],
  'fault': ['fault', 'diagnostic'],
  'not working': ['fault', 'diagnostic'],
  'tripping': ['fault', 'diagnostic', 'rcd'],
  'leak': ['leak', 'investigation'],
  'emergency': ['emergency', 'call-out'],
  'callout': ['call-out'],
  'call out': ['call-out'],
};

/** Number words, so "three radiators" becomes quantity 3. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, a: 1, an: 1, single: 1, couple: 2, pair: 2, dozen: 12,
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'in', 'on', 'at', 'for', 'of', 'with', 'is', 'are',
  'we', 'i', 'it', 'this', 'that', 'need', 'needs', 'want', 'would', 'like', 'please',
  'can', 'you', 'our', 'us', 'have', 'has', 'get', 'got', 'some', 'new', 'also', 'but',
  'my', 'me', 'they', 'there', 'be', 'been', 'was', 'were', 'will', 'should', 'could',
]);

/** Plural and tense normalisation, so "radiators" matches "radiator". */
function normalise(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.endsWith('sses') || token.endsWith('shes') || token.endsWith('ches')) {
    return token.slice(0, -2);
  }
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  if (token.endsWith('ing')) return token.slice(0, -3);
  return token;
}

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(normalise);
}

/**
 * Quantities, written as a phrase-to-count map keyed by the noun they modify.
 *
 * "3 radiators", "three radiators" and "a radiator" all have to resolve, and the
 * count belongs to the noun that follows it rather than to the whole brief.
 */
function extractQuantities(normalised: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (let index = 0; index < normalised.length; index += 1) {
    const token = normalised[index];
    if (!token) continue;

    let quantity: number | undefined;
    let nounIndex = index + 1;

    if (/^\d+$/.test(token)) {
      quantity = Number(token);
    } else if (NUMBER_WORDS[token] !== undefined) {
      quantity = NUMBER_WORDS[token];
    } else if (token === 'x' && index > 0 && /^\d+$/.test(normalised[index - 1] ?? '')) {
      // "2 x downlights" — the count was consumed on the previous pass.
      continue;
    }

    if (quantity === undefined) continue;

    // "2 x downlights": step over the separator to reach the noun.
    if (normalised[nounIndex] === 'x') nounIndex += 1;

    const noun = normalised[nounIndex];
    if (noun) counts.set(noun, Math.max(counts.get(noun) ?? 1, quantity));
    index = nounIndex - 1;
  }

  return counts;
}

/** How many of a line's own words appear in the brief. */
function scoreEntry(entry: PriceBookEntry, briefTokens: Set<string>, phraseHits: Set<string>): number {
  const descriptionTokens = tokenise(`${entry.code} ${entry.description}`);
  if (descriptionTokens.length === 0) return 0;

  let matched = 0;
  for (const token of new Set(descriptionTokens)) {
    if (briefTokens.has(token) || phraseHits.has(token)) matched += 1;
  }

  // Length-normalised, so a four-word line is not favoured purely for having
  // more words to match.
  const coverage = matched / new Set(descriptionTokens).size;
  const specificity = matched / Math.max(4, descriptionTokens.length);

  return coverage * 0.7 + specificity * 0.3;
}

function confidenceFor(score: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (score >= 0.6) return 'HIGH';
  if (score >= 0.35) return 'MEDIUM';
  return 'LOW';
}

export class HeuristicDraftProvider implements DraftProvider {
  readonly name = 'heuristic' as const;

  async draft(context: DraftContext): Promise<DraftResult> {
    const briefTokens = tokenise(context.brief);
    const tokenSet = new Set(briefTokens);

    // Expand synonyms into extra tokens that count as hits for scoring.
    const phraseHits = new Set<string>();
    const lowerBrief = context.brief.toLowerCase();
    for (const [phrase, expansion] of Object.entries(SYNONYMS)) {
      if (lowerBrief.includes(phrase)) {
        for (const word of expansion) phraseHits.add(normalise(word));
      }
    }

    const quantities = extractQuantities(briefTokens);

    const scored = context.priceBook
      .map((entry) => ({ entry, score: scoreEntry(entry, tokenSet, phraseHits) }))
      .filter((candidate) => candidate.score > 0.2)
      .sort((a, b) => b.score - a.score);

    // One suggestion per price book line. The same item mentioned twice is a
    // quantity, not two lines.
    const seen = new Set<string>();
    const suggestions: DraftQuoteSuggestion[] = [];

    for (const { entry, score } of scored.slice(0, 12)) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);

      const entryTokens = tokenise(entry.description);
      let quantity = 1;
      for (const token of entryTokens) {
        const found = quantities.get(token);
        if (found && found > quantity) quantity = found;
      }

      suggestions.push({
        priceBookItemId: entry.id,
        code: entry.code,
        description: entry.description,
        unit: entry.unit as DraftQuoteSuggestion['unit'],
        unitPrice: { amount: entry.unitPrice, currency: 'GBP' as never },
        taxRateBp: entry.taxRateBp,
        quantity,
        rationale: rationaleFor(entry, quantity, score),
        confidence: confidenceFor(score),
      });
    }

    return {
      suggestions,
      provider: 'heuristic',
      unmatched: findUnmatched(context.brief, scored.map((s) => s.entry)),
    };
  }
}

function rationaleFor(entry: PriceBookEntry, quantity: number, score: number): string {
  const pct = Math.round(score * 100);
  const qty = quantity > 1 ? ` Matched a quantity of ${quantity}.` : '';
  return `“${entry.code}” shares ${pct}% of its wording with the brief.${qty}`;
}

/**
 * Phrases in the brief that no suggestion covers.
 *
 * Surfaced to the operator rather than hidden: the whole value of the feature is
 * that it tells you what it could not price, so you know where to look.
 */
function findUnmatched(brief: string, matched: PriceBookEntry[]): string[] {
  const covered = new Set<string>();
  for (const entry of matched) {
    for (const token of tokenise(`${entry.code} ${entry.description}`)) covered.add(token);
  }

  const unmatched: string[] = [];
  for (const clause of brief.split(/[.;\n]+/)) {
    const trimmed = clause.trim();
    if (trimmed.length < 6) continue;
    const tokens = tokenise(trimmed);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((token) => covered.has(token)).length;
    if (hits / tokens.length < 0.34) unmatched.push(trimmed);
  }

  return unmatched.slice(0, 6);
}
