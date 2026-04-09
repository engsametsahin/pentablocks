# PentaBlocks Monetization Roadmap

## Goal

Turn PentaBlocks from a polished prototype into a small but commercially viable puzzle product.

The most realistic path is:
- Launch free first
- Launch on the web first
- Validate retention and replay value
- Add recurring content
- Then monetize with low-friction offers

## Core Monetization Thesis

PentaBlocks is best suited for:
- Mobile-first casual puzzle players
- Short play sessions
- Repeatable daily engagement
- Lightweight monetization

The strongest monetization model is likely:
- Free base game
- Web-first free release
- Lightweight ads
- Optional paid upgrades

Less likely to work well:
- High upfront premium price on web
- Heavy competitive monetization
- Aggressive paywalls early in the game
- Showing a forced ad after every single level from day one

## Web-First Launch Strategy

Start with a public website version before mobile.

Recommended goals:
- Make the game instantly playable in browser
- Remove setup friction
- Let players share the link easily
- Measure whether people actually replay

Good first hosting options:
- Vercel
- Netlify
- Cloudflare Pages

Good first publishing channels:
- Your own domain
- itch.io
- Game portals later, after polish

## Website Monetization Recommendation

The best first website setup is:
- Free to play
- No paywall
- Light ad monetization
- Focus on retention before ad volume

### Ad Strategy

Most realistic first ad model:
- One ad opportunity after a few completed levels
- One ad opportunity when returning to level select after a session
- Optional rewarded ad for hints or bonus challenge access

### Important Product Note

Showing an ad on every new level is possible, but it is risky.

Why it is risky:
- Puzzle players are sensitive to interruption
- Short levels make ad frequency feel too aggressive
- Early churn can erase the small ad revenue gain

Safer version:
- No ad for the first 3 levels in a session
- Then show an interstitial every 2 to 3 level completions
- Never show an ad immediately after failure
- Never show an ad during onboarding

If you still want a simple rule, use this:
- First session: no forced ads
- Later sessions: one interstitial after every 3 completed levels
- Rewarded ads stay optional

## Phase 1: First 7 Days

Focus: make the game feel ready to test with real players.

### Product Tasks

- Fix any remaining gameplay bugs and edge cases
- Improve mobile drag-and-drop comfort
- Make restart and retry flows instant and reliable
- Polish win, loss, and solution-view states
- Add a small "solution mode" label when the board is auto-solved
- Prepare a public web build
- Add a landing page title, short description, and play button flow
- Add a basic privacy/analytics notice if ads or analytics will be used

### Retention Tasks

- Add daily challenge mode
- Add endless seeded puzzle mode
- Add streak tracking
- Add achievement-style milestones

### Data Tasks

- Track session starts
- Track level completions
- Track retries
- Track hint or solution usage
- Track average session length
- Track how many players return the next day
- Track ad impressions
- Track session drop-off after ad display

### Success Criteria

- Players understand the game within 30 seconds
- Players complete at least a few levels in one session
- Retry flow feels frictionless
- There is at least one reason to come back tomorrow

## Phase 2: First 30 Days

Focus: turn the game from "nice prototype" into "sticky product".

### Content Expansion

- Increase level pool beyond 100
- Add curated challenge packs
- Add themed puzzle sets
- Add rotating weekly challenge boards

### Product Expansion

- Add player profile/progression screen
- Add collectible cosmetic themes
- Add board skins and piece color packs
- Add sound design and more satisfying feedback

### Distribution

- Publish web build publicly
- Connect a custom domain if possible
- Add simple SEO metadata and social share preview
- Submit the game to a few web game communities
- Prepare Android release first
- Then evaluate iOS if retention is promising
- Add store screenshots, short gameplay trailer, and clean app description

### Analytics Milestones

Track these before serious monetization:
- D1 retention
- D7 retention
- Average levels completed per session
- Average retries per level
- Percentage of players who use "show solution"
- Percentage of players who finish 10+ levels
- Ad CTR and exit rate after interstitials

### Success Criteria

- D1 retention shows early promise
- Players replay beyond the first session
- Daily challenge gets repeat engagement
- Enough activity exists to justify monetization experiments

## Phase 3: Monetization Rollout

Focus: add revenue without hurting the core experience.

### Recommended Model

#### 1. Ads

Use ads lightly on web:
- Interstitial after every 2 to 3 completed levels
- Rewarded ad for extra hint
- Rewarded ad for one extra retry bonus
- Optional ad to unlock a daily bonus challenge

Avoid:
- Interstitial after every level
- Forced ads during early onboarding
- Ads after failed runs too often

#### 2. Paid Upgrade

Offer a small one-time purchase:
- Remove ads
- Unlock premium themes
- Unlock exclusive challenge packs

This is probably the cleanest first paid offer.

#### 3. Cosmetic IAP

Good low-friction purchases:
- Theme bundles
- Piece skin packs
- Board visual styles
- Celebration animation packs

#### 4. Puzzle Packs

Sell optional content packs:
- Expert pack
- Speedrun pack
- Chill pack
- Seasonal pack

## Phase 4: Launch-Ready Version

Focus: only ship monetization after the game feels replayable.

### Minimum Launch Checklist

- Stable mobile UX
- Fast startup and restart
- Daily challenge mode
- Endless or seeded replay mode
- Stats and progression
- Light analytics
- At least one monetization path
- Store-ready branding and screenshots

### Best First Revenue Setup

Recommended first release stack:
- Free game
- Rewarded ads only
- One paid "Supporter Pack"

Supporter Pack can include:
- Ad-free experience
- 3 exclusive visual themes
- 2 premium challenge packs

## What To Build First

If time is limited, prioritize in this order:

1. Daily challenge mode
2. Endless seeded mode
3. Better mobile UX
4. Analytics events
5. Supporter Pack
6. Rewarded hints
7. Cosmetic packs

## Risks

### Risk 1: Great core loop, weak retention

The game may feel polished but still be "one-and-done".

Mitigation:
- Add daily reason to return
- Add progression goals
- Add unlockable content

### Risk 2: Monetization too early

If ads or paywalls arrive before players care, retention drops.

Mitigation:
- Delay monetization until replay loop is proven
- Keep first monetization optional and respectful

### Risk 3: Puzzle difficulty curve feels unfair

If progression spikes too hard, players churn before monetization matters.

Mitigation:
- Improve level pacing
- Add optional assist systems
- Watch retry and abandon analytics

## Simple Revenue Strategy Recommendation

If we wanted the cleanest practical plan, it would be:

### Version 1

- Free web launch
- Light interstitial testing on web
- Rewarded ads only if they feel natural
- Validate retention and feedback

### Version 2

- Mobile launch
- Daily challenge
- Seeded endless mode
- Rewarded hints
- Better ad tuning based on web retention data

### Version 3

- Supporter Pack
- Cosmetic themes
- Premium challenge packs

## Bottom Line

Yes, PentaBlocks can make money.

The realistic opportunity is not "viral hit by default", but:
- a strong niche puzzle game
- with repeatable challenge content
- light monetization
- and careful mobile polish

If execution is strong, this can become a small but real revenue-producing game.

## Direct Recommendation For This Project

If we move right now, the clearest next step is:

1. Launch the game on a public website for free
2. Add analytics before aggressive monetization
3. Start with very light web ads
4. Measure whether ads reduce completion rate
5. Only increase ad frequency if retention stays healthy

If you want the simplest launch decision today, I would choose:
- Free website launch
- Interstitial after every 3 completed levels
- No ad in the first session onboarding
- Optional rewarded hint later
