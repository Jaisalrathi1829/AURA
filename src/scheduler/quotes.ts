/**
 * Local quote engine.
 *
 * Runs entirely offline. Quotes are one of the things AURA should never spend
 * API credit on, so these are written into the app and rotated without
 * repeating until the pool is exhausted.
 */

export type QuoteCategory =
  | "motivational"
  | "philosophical"
  | "witty"
  | "technology"
  | "mysterious"
  | "humorous";

export interface Quote {
  text: string;
  category: QuoteCategory;
}

export const QUOTES: Quote[] = [
  // motivational
  { text: "Small progress still counts. It counts more than the plan you didn't start.", category: "motivational" },
  { text: "You don't need momentum to begin. You need beginning to get momentum.", category: "motivational" },
  { text: "Done badly and fixed beats perfect and imagined.", category: "motivational" },
  { text: "The hard part is usually shorter than the dread about the hard part.", category: "motivational" },
  { text: "Consistency is just stubbornness pointed somewhere useful.", category: "motivational" },
  { text: "You've solved worse than this with less coffee.", category: "motivational" },

  // philosophical
  { text: "Every system is perfectly designed to get the results it gets.", category: "philosophical" },
  { text: "Certainty is the feeling you get right before you learn something.", category: "philosophical" },
  { text: "You can't optimise what you refuse to measure, or measure what you refuse to look at.", category: "philosophical" },
  { text: "Most problems are two problems wearing one coat.", category: "philosophical" },
  { text: "Attention is the only currency you can't earn back.", category: "philosophical" },
  { text: "The map is not the territory, but people keep arguing about the map.", category: "philosophical" },

  // witty
  { text: "Naming things is hard. Renaming them later is harder, and inevitable.", category: "witty" },
  { text: "There is no such thing as temporary code. There is only code with an optimistic comment.", category: "witty" },
  { text: "The fastest way to find a bug is to confidently tell someone there isn't one.", category: "witty" },
  { text: "Every configuration file is a small unfinished programming language.", category: "witty" },
  { text: "Documentation is a letter to a stranger who is also you.", category: "witty" },
  { text: "Nothing focuses the mind like a deadline you set yourself and now resent.", category: "witty" },

  // technology
  { text: "Caching is the art of being wrong slightly later.", category: "technology" },
  { text: "A distributed system is one where a machine you've never heard of can ruin your afternoon.", category: "technology" },
  { text: "The bug is almost never where the error message points. It's where the error message was written.", category: "technology" },
  { text: "Backwards compatibility is a promise you make to a version of yourself you'll come to dislike.", category: "technology" },
  { text: "Most performance problems are one loop that nobody meant to write.", category: "technology" },
  { text: "Version control exists because past-you was braver than present-you.", category: "technology" },

  // mysterious
  { text: "Somewhere in this machine, a process has been running since you last rebooted. It has plans.", category: "mysterious" },
  { text: "The interesting question isn't what the data says. It's what it stopped saying.", category: "mysterious" },
  { text: "Every desktop has one folder nobody opens. Yours is no exception.", category: "mysterious" },
  { text: "Patterns are easy to find. That's the problem with them.", category: "mysterious" },
  { text: "The quietest failure is the one that returns a plausible number.", category: "mysterious" },

  // humorous
  { text: "Octopuses have three hearts. Somehow they still manage to avoid meetings.", category: "humorous" },
  { text: "Honey doesn't spoil. Neither does that browser tab you opened in March.", category: "humorous" },
  { text: "Wombat droppings are cube-shaped. Nature also ships odd design decisions.", category: "humorous" },
  { text: "A group of flamingos is called a flamboyance. A group of unread emails is called Tuesday.", category: "humorous" },
  { text: "Bananas are berries. Strawberries are not. Taxonomy is having a rough time.", category: "humorous" },
  { text: "Sharks existed before trees. Somehow that's the least alarming fact about sharks.", category: "humorous" },
];

/**
 * Draws without repeating until the pool is used up, so a long-running AURA
 * doesn't say the same line twice in an afternoon.
 */
export class QuoteRotation {
  private remaining: Quote[] = [];
  private categories: Set<QuoteCategory> | null = null;

  constructor(categories?: QuoteCategory[]) {
    if (categories?.length) this.categories = new Set(categories);
    this.refill();
  }

  private refill(): void {
    const pool = this.categories
      ? QUOTES.filter((q) => this.categories!.has(q.category))
      : [...QUOTES];
    // Fisher-Yates, so the order differs every cycle.
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    this.remaining = pool;
  }

  next(): Quote {
    if (this.remaining.length === 0) this.refill();
    return this.remaining.pop() ?? QUOTES[0]!;
  }
}
