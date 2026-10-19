# Fabula Ultima — Ace of Cards

A Foundry VTT v13 module for the **Ace of Cards** class from *Fabula Ultima — Bonus Collection vol.1* (v1.1), built on the [projectfu](https://github.com/League-of-Fabulous-Developers/FoundryVTT-Fabula-Ultima) system.

- Each Ace of Cards character gets a personal 30-card deck (28 + 2 jokers), hand, discard pile and vanguard, using Foundry's native Cards documents. Hands are visible only to their owner and the GM.
- Conflicts: shuffle and draw 5 when combat starts, recall everything when it ends; the discard pile is shuffled back when the deck runs out.
- Hand window: pick cards in discard order; the module lists every set they form (Jackpot, Magic Flush, Blinding Flush, Full Status, Triple Support, Double Trouble, Magic Pair, Forbidden Monarch), lets you choose jokers, damage types and statuses, and charges the MP.
- GM-approved automation: each resolution posts a chat card. The GM approves (applying damage, healing and statuses through projectfu), retargets, rejects (undoing the card movement and refunding MP) or reverts. Each kind of effect can be switched to automatic.
- High or Low, plus the parts of Black & White, Forbidden Rite and Duel Master that affect sets.
- GM panel (Shift+G) with every player's hand face up, deck tools and approval toggles. Hand window: Shift+H.
- Deck art presets: a built-in poker deck, or your own images (see below).

## Install

Paste this manifest URL into **Add-on Modules → Install Module**:

```
https://github.com/matheusferreira/fu-ace-of-cards/releases/latest/download/module.json
```

Requires Foundry VTT 13 and projectfu 4.16+.

## Custom deck art

Put 30 images in your Foundry user data folder at `ace-of-cards-decks/<deck>/`, named `1C`…`7C`, `1D`…`7D`, `1H`…`7H`, `1S`…`7S`, `1J`, `2J` (`.webp`). The module ships no third-party art.

## Roadmap

Rider-Waite tarot preset; per-card art editor.

See [CHANGELOG.md](CHANGELOG.md) for what each version added.

## License

Code under MIT. Fabula Ultima is © Need Games and Rooster Games; this is an unofficial fan module.
