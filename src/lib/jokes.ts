/**
 * Score-based sarcastic roasts. English only, bucketed by grade A..E.
 *
 * House rules:
 *  - The joke is at the product's expense, never the person's. Nothing targets
 *    identity, and nobody gets mocked for eating it. Just mean about the label.
 *  - No slurs. Swearing at the sugar content is fair game.
 *
 * Selection is deterministic from a caller-supplied seed so server and client
 * render the same line (no Math.random in render — see hydration notes).
 */

export type Spice = "clean" | "spicy";

type Grade = "A" | "B" | "C" | "D" | "E";
type Bank = Record<Spice, Record<Grade, string[]>>;

const JOKES: Bank = {
  clean: {
    A: [
      "Look at that. A food product that has read its own label. Shocking.",
      "Damn, this is actually respectable. Eat it, don't overthink it.",
      "Your fridge just got a promotion it didn't apply for.",
      "Ingredients you can pronounce, nutrition you can defend. Chef's kiss.",
      "This is the rare snack that requires no intervention. Enjoy, weirdo.",
      "Nature really committed to this one. Suspiciously decent.",
      "No notes. Genuinely no notes. I hate having nothing to complain about.",
      "A five-star review from a very bored health inspector.",
    ],
    B: [
      "Solid B. Not a hero, definitely not a villain. Peak middle management.",
      "This will keep you alive and vaguely happy. Perfectly acceptable.",
      "Good enough that nobody at dinner will judge you. High praise.",
      "Perfectly fine. That's the highest compliment this app gives, take it.",
      "It's fine. Genuinely. Now you can stop squinting at the label, weirdo.",
      "The nutritional equivalent of a shrug, but with better marketing.",
      "Nothing to fix here. Just don't finish the bag in one sitting, yeah?",
      "This product has peaked and it peaked at 'fine'. Respect.",
    ],
    C: [
      "C. Right in the middle, where nothing interesting has ever happened.",
      "This is the food version of a shrug. Beige, loud, committed to nothing.",
      "Eating this won't kill you. Probably. I mean, probably.",
      "You can eat this. You will not be bragging about it at lunch.",
      "Perfectly acceptable, which is also perfectly forgettable.",
      "It's not bad. That's the problem. It's aggressively, safely average.",
      "The culinary equivalent of background noise with calories.",
      "Your body will process this and forget it existed. Efficient, in a sad way.",
    ],
    D: [
      "D. There is a lot of sugar in here and not much of anything else.",
      "Your pancreas is drafting a complaint about this one.",
      "This tastes incredible and treats you terribly. Textbook.",
      "Every bite is a small negotiation with your future self.",
      "Rude. The back of this label is a legal disclaimer, not a suggestion.",
      "The ingredient list is doing a lot of apologising right now.",
      "This is mostly sugar wearing a costume and hoping you don't ask questions.",
      "Your dentist is about to become a close family member.",
    ],
    E: [
      "E. This is dessert in a trench coat, hoping you won't ask questions.",
      "Reading this label is genuinely upsetting. That sugar number is a crime.",
      "Empty calories with a marketing budget. Brave, honestly.",
      "The product name is a lie and the nutrition panel is the confession.",
      "Your arteries just filed a complaint and are citing this exact package.",
      "Somebody sat in a meeting and said 'let's add more sugar' and nobody objected.",
      "Eating this regularly is basically slow-motion assisted living.",
      "This is what happens when science is used for evil and given funding.",
    ],
  },

  spicy: {
    A: [
      "Holy shit, this thing is actually healthy. Nature is showing off now.",
      "Are you kidding me? That's the whole label? Damn.",
      "Grade A on junk food? I need to sit down and rethink my life.",
      "This is annoyingly good for you. I hate it. Eat the entire bag.",
      "Nobody warned me a snack could be this decent. What the actual fuck.",
      "The bar was on the floor and this product still cleared it. Embarrassing.",
      "A healthy snack. In this economy. Are you pranking me?",
      "Fuck, this is good for you. Genuinely upset about it.",
    ],
    B: [
      "It's a B, which is the highest grade you get without being boring.",
      "This'll keep the Grim Reaper confused for another year. Nice.",
      "Solid B. Not thrilling, but your kidneys send their regards.",
      "It's fine. Actually fine. Stop reading labels like a health maniac.",
      "B is basically a compliment from this app. Don't push your luck.",
      "You'll survive this. Probably. Mostly because it isn't trying very hard.",
      "Grade B, which means 'adequate', which is a dirty word in my house.",
      "Meh, but the good kind of meh. Barely. Just about.",
    ],
    C: [
      "C. Right in the middle, where nothing interesting happens. Ever.",
      "This is the food equivalent of a shrug. So... yeah.",
      "It's not good, it's not terrible, it's just beige and loud.",
      "Eating this won't kill you. Probably. I said probably, twice now.",
      "C-grade. A participation trophy made of sugar. Pass.",
      "Neither guilty nor innocent. Just... present. Politely ruining lunch.",
      "This is the most average thing you will ever consume. Congratulations.",
      "It's giving 'fine'. Completely, devastatingly, fine.",
    ],
    D: [
      "There's so much sugar in this thing it should be classified as a weapon.",
      "D. The number is low and so is my opinion of whoever designed this.",
      "Holy shit, this is a sugar delivery system with a wrapper on it.",
      "Your dentist is about to become a close family member, actually.",
      "This stuff is a trap and you walked into it with your whole chest.",
      "Eating this is a choice. A choice you are apparently making right now.",
      "The nutrition panel is begging you. Literally begging. Read it.",
      "Wow. They put the sugar in a separate tab so you'd miss it. Genius.",
    ],
    E: [
      "E. This is what happens when science is used for evil and given funding.",
      "This label is a cry for help and the calories are the problem.",
      "Fuck this. Grade E. Even the sugar is disappointed in you.",
      "Eating this regularly is basically slow-motion assisted living.",
      "The product name is a lie and so is the nutrition panel. Honest fraud.",
      "Your arteries just sent a formal letter of complaint. It's notarized.",
      "Somebody in a lab laughed while making this. I guarantee it.",
      "Grade E. Damn. Even the wrapper is embarrassed to be associated with it.",
    ],
  },
};

/**
 * Deterministic pick. Pass a stable seed (a counter the user increments to
 * shuffle) so the same seed always yields the same line on server and client.
 */
export function getJoke(score: number, grade: string, spice: Spice = "clean", seed = 0): string {
  const bank = JOKES[spice];
  if (!bank) return "";
  const order: Grade[] = ["A", "B", "C", "D", "E"];
  let idx = order.indexOf(grade as Grade);
  // Fall back to the score when the grade is missing or unexpected.
  if (idx === -1) idx = Math.min(4, Math.max(0, Math.floor((100 - score) / 20.5)));
  const list = bank[order[idx]] ?? bank[order[4]];
  if (!list?.length) return "";
  return list[Math.abs(seed) % list.length];
}

/** Full bank for one spice level — used by tests. */
export function jokeBank(spice: Spice = "clean"): Record<Grade, string[]> {
  return JOKES[spice];
}
