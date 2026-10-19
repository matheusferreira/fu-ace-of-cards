# Changelog

All notable changes to this module. Each release on GitHub uses the section of its version as release notes.

## [0.1.7] - 2026-10-19

### Added
- **Card Vanguard**: when resolving Magic Cards, a selector lets you place one of the discarded cards face down as a vanguard card (only while you have two or fewer in play). A new Card Vanguard section in the hand window shows your vanguard cards; pick the damage type dealt by the source and reveal one. A joker or a card of the matching suit gives you and your allies Resistance to that type until the end of the turn (a chat proposal, following the GM's status approval mode); the card then goes on top of the discard pile. Vanguard cards return to the deck at the end of the conflict.

### Changed
- Revert now also removes the effects a proposal created (High or Low bonuses and Card Vanguard resistances).
- Rejecting a Magic Cards proposal also brings back a card that was placed as a vanguard card.

## [0.1.6] - 2026-10-19

### Changed
- **Draw specific hand**: cards are now sorted, one row per suit (A to 7, labelled with the suit's damage type) and the jokers last. Each card shows its name in the corner, so specific cards are easy to find.

## [0.1.5] - 2026-10-19

### Added
- **Draw specific hand** (GM panel): a testing tool that shows all 30 cards of a character with their current place (hand, deck, discard, vanguard). Tick the cards that should be in the hand and confirm: unticked hand cards go back into the deck, ticked cards are pulled from wherever they are, and the deck is reshuffled. The change is whispered to the GM in chat. Use it to test sets and Skills without depending on the shuffle.

## [0.1.4] - 2026-10-19

### Added
- **Mulligan**: new button in the hand window. Select 1 to SL + 1 cards to discard them and draw that many; the swap is logged in chat.
- **Trap Card**: new button in the hand window with the enemy action (Attack, Objective, Skill or Spell). Only jokers and cards of the matching suit (ice, fire, earth, air) can be chosen. Discards and draws, then reminds the free Spell action with its MP budget (SL × 5). Usable once until the start of your next turn; the module tracks it and resets it when your turn starts or the conflict ends.
- **Forbidden Rite**: after a Magic Cards resolution discards a joker, a dialog lets you choose non-joker cards from the discard pile to shuffle into the deck before drawing. The chat proposal records how many cards went back.
- **Black & White**: Double Trouble now also offers light and dark as damage types.

### Changed
- Rejecting a Magic Cards proposal now also brings back cards that Forbidden Rite shuffled into the deck.

## [0.1.3] - 2026-10-19

First public release: native Cards deck, hand and discard pile per Ace of Cards character; set detection (Jackpot, Magic Flush, Blinding Flush, Full Status, Triple Support, Double Trouble, Magic Pair, Forbidden Monarch); High or Low; chat proposals with GM approval or auto-passthrough per damage, recovery, status and MP; GM panel; Poker and Final Fantasy presets.
