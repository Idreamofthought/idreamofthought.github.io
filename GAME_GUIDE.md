# Portus — Game Guide

A Mediterranean town-building game: settle a stretch of coastline, grow
food, mine the mountains, trade with the world, raise an army, and
survive whatever the gods throw at you.

## Getting started

Tap a building in the right-hand panel, then tap a valid tile on the
map to place it. Buildings only accept certain terrain — the game
highlights the tile green (valid) or red (invalid) as you hover/tap.
Buildings need workers, drawn automatically from your population —
build faster than your population grows and everything slows down
proportionally, rather than stopping outright.

## The map

- **Grass** — buildable, most buildings go here
- **Sand** — buildable coastline, required for Docks
- **Forest** — not directly buildable, but Sawmills and Hunter's
  Lodges need to be built *next to* it
- **Mountain** — where Quarries go, and where Gold/Silver/Copper
  deposits are hidden
- **River / Sea** — not buildable, but many buildings need to be near
  one (Docks, Claypits, Wells, Fisherman's Huts)
- **Deposits** (small colored dots on the map) — Gold, Silver, Copper,
  Clay, and Salt only appear on specific tiles; the matching mine or
  pit has to be built directly on the deposit

## Resources

**Raw materials:** wood, stone, clay, ore (gold/silver/copper), salt
**Crafted goods:** tools, pottery, flour, bread, olive oil, scrolls
**Food:** wheat, olives, chickpeas, grapes, fish, deer, bread
**Currency:** coin (separate from goods — earned through trade, spent
nowhere directly but tracked for the Trade Empire goal and raids)
**Research:** banked separately, spent on permanent tech upgrades

Food and general goods each have a shared storage cap (shown at the
bottom of the screen) — Granaries raise the food cap, Storage Yards
raise the general cap.

## Buildings

### Housing
| Building | Cost | Does |
|---|---|---|
| House | 20 wood, 10 stone | +4 population capacity |
| Farmer's Hut | 20 wood | Boosts nearby Fields +20% |
| Fisherman's Hut | 20 wood | Catches fish (needs water nearby) |

### Production
| Building | Cost | Chain |
|---|---|---|
| Field | 10 wood | Grows wheat / olives / chickpeas / grapes (pick one when placing) |
| Quarry | 30 wood | Mountain tile → stone |
| Claypit | 20 wood | Clay deposit → clay |
| Potter | 30 wood, 10 stone | clay → pottery |
| Sawmill | 20 wood | Next to forest → wood |
| Workshop | 40 wood, 20 stone | wood + stone → tools |
| Blacksmith | 30 wood, 30 stone | copper + wood → tools |
| Foundry | 50 stone, 20 wood | raw ore → refined gold/silver/copper |
| Hunter's Lodge | 25 wood | Next to forest → deer |
| Docks | 40 wood | Coastal tile → fish, unlocks Boat Builder |
| Boat Builder | 60 wood, 20 stone | Near Docks → boats, boosts dock fishing |
| Mill | 35 wood, 15 stone | wheat → flour |
| Baker | 25 wood, 10 stone | flour → bread |
| Olive Press | 30 wood, 15 stone | olives → olive oil |

### Mining
| Building | Cost | Needs |
|---|---|---|
| Gold Mine 🟡 | 40 wood, 30 stone | Gold deposit |
| Silver Mine ⚪ | 40 wood, 30 stone | Silver deposit |
| Copper Mine 🟠 | 40 wood, 30 stone | Copper deposit |
| Salt Flats 🧂 | 35 wood, 25 stone | Salt deposit (coastal sand) |

### Infrastructure
| Building | Cost | Does |
|---|---|---|
| Road | 5 stone | Any building next to a road produces 15% more |
| Well | 15 stone | Needs to be near water — irrigates nearby Fields +15%, +happiness |
| Sewer | 25 stone, 5 tools | Softens the happiness hit from every disaster type, +happiness |

### Knowledge
| Building | Cost | Does |
|---|---|---|
| Scribe's House | 25 wood, 6 pottery | pottery → scrolls |
| Library | 40 wood, 20 stone, 5 tools | scrolls → research points (School nearby: +20%) |

### Trade
| Building | Cost | Does |
|---|---|---|
| Market | 30 wood, 10 stone | Auto-sells surplus goods above a comfortable buffer for coin |
| Trading Post | 50 wood, 20 stone, 5 tools | Steady caravan coin income, scales with population |
| Tax Office | 40 wood, 25 stone | Unlocks the Taxes panel — set a per-citizen tax rate for coin income (costs happiness) |

### Military
| Building | Cost | Does |
|---|---|---|
| Barracks | 40 wood, 20 stone, 10 tools | +6 soldier capacity |

### Storage
| Building | Cost | Does |
|---|---|---|
| Storage Yard | 50 wood, 30 stone | +200 general goods capacity |
| Granary | 40 wood, 20 stone | +250 food capacity |

### Services (all boost happiness)
Police Post, Fire Post, Doctor's House, Dentist, School (also boosts
Library research nearby), Bar, Temple (biggest single boost).

## Population & happiness

Population grows automatically when there's a food surplus and
happiness is above ~45%. It shrinks if food runs out. Happiness drifts
toward a target set by how many service/infrastructure buildings
you've built, minus any tax burden — it doesn't jump instantly, so
changes take a little time to show.

## Trade & the Market

Once a Market is built, any resource stockpiled above a small buffer
gets automatically sold for coin each tick — no manual selling needed.
A Trading Post adds steady passive income on top. The **Currency**
research tech boosts all trade income by 30%.

## Taxes

Build a Tax Office to unlock the Taxes panel (💰 button, top right).
Four rates: None, Low, Medium, High. Higher rates mean more coin per
tick but a real happiness penalty — there's no free lunch here.

## Research

Scrolls (from a Scribe's House) feed a Library, which slowly converts
them into research points. Spend points in the 📜 Research panel on
five permanent upgrades: Irrigation (+25% fields), Masonry (+25%
quarry), Seafaring (+25% fishing), Metallurgy (+25% foundry), Currency
(+30% trade income).

## Army

Build a Barracks to raise your soldier cap, then recruit soldiers (4
tools each) in the ⚔️ Army panel — recruiting pulls a citizen out of
the workforce, so it's a real tradeoff against production. Soldiers
determine whether an Invasion disaster is repelled or devastating. You
can also send raids (small/medium/large) for a chance at coin, at the
risk of losing troops either way.

## Disasters

Random events roll in the background as you play — more likely if
your city has the relevant exposure (mountain buildings risk volcanic
eruptions, coastal buildings risk tsunamis, river buildings risk
floods, wealthy cities attract more invasions):

- 🌍 **Earthquake** — random buildings collapse
- 🌋 **Volcano** — near mountains; destroys buildings, can cost lives
- 🌊 **Tsunami** — hits coastal buildings
- 🌧️ **Flood** — damages river-adjacent buildings, waterlogs stores
- ☀️ **Drought** — fields yield 70% less for a while
- ⚔️ **Invasion** — resolved against your army's strength

Every disaster is logged in the Army panel's Chronicle. A Sewer softens
the happiness damage from all of them.

## Goals

The 🎯 Goals panel has four scenarios to aim for — pick one to track
(switching doesn't reset your city, just what you're working toward):

- **Growth Race** — reach population 40
- **Trade Empire** — bank 300 coin
- **Master Builder** — construct 15 buildings
- **Survivor** — live through 5 disasters without happiness dropping
  below 20

## Saving your progress

If you're logged in, use the 💾 Save panel to save straight to your
account, or generate an offline save code you can copy/paste to
continue later without an account at all.
