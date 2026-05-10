# Spec — what we are building

User-facing description. No technology, no implementation details. Those live in [`plan.md`](./plan.md).

## One-line pitch

A prediction market for the Czech audience where anyone can create, trade, and resolve bets on future events — politics, sports, crypto, culture, economics — and where an AI assistant helps users find markets, prepare trades, and create new ones in plain language.

## Who it is for

- **Casual users** who want to express an opinion about a future event by putting a small amount of money on it. They want to see what the market thinks the probability is, place a bet in two clicks, and forget about it until resolution.
- **Traders** who want to actively buy and sell positions, provide liquidity, and (eventually) write options on outcomes. They want classical orderbook tools and detailed market history.
- **Market creators** who see that a question is missing from the platform and want to create it. They put up a bond to discourage spam.
- **Information consumers** who do not bet but read the platform like a news source — "what does the market think about X?"

## Core user flows

### Flow 1: Discover and place a simple bet

A user lands on the home page and sees a grid of popular markets organized by category (Politics, Crypto, Sports, Economics, Other). Each market card shows the question, the current probability, and a verified/unverified badge.

The user can toggle the display between "crypto-style" prices ("$0.45 per Yes share") and "bookmaker-style" odds ("2.22x on Yes"). The toggle is global and persists across the session.

The user opens a market, sees a chart of historical probability, the resolution criteria, and a trading panel. In **Simple mode** (default), they see two big buttons — Yes and No — and an input for how much TAB (the platform token) they want to spend. They see their potential payout. They click, the wallet asks them to sign, the position lands in their portfolio. Under the hood, simple-mode taking goes through the CLOB (`TabClob`); there is no AMM.

### Flow 2: Talk to Kowalsky

A floating chat button is always available. The user opens it and types or speaks: *"I want to bet 50 TAB that Czechia loses the hockey match and Pastrňák scores a hat-trick."*

Kowalsky understands the intent, finds the relevant markets, and replies with one or more **Transaction Cards** in the chat. Each card shows: which market, which side, how much, expected payout, and an **Approve & Sign** button. The user reviews the card, clicks the button, signs in the wallet, and the bet is placed.

Kowalsky can also answer read-only questions: *"What's the current price on the election market?"*, *"Show me my open positions"*, *"What was the biggest move on the Bitcoin market this week?"* These answers do not produce transaction cards.

The AI never signs by itself. Every transaction needs an explicit click and a wallet signature.

### Flow 3: Create a new market

The user goes to a "Create" page and writes or speaks what they want to predict: *"Will it rain in Prague on June 1st?"*

Kowalsky drafts a market: a title, a description, resolution criteria (how do we decide who won), and an expiration date. The user reviews and edits the draft, then puts up a TAB bond (default 50 TAB). The market is created on-chain with status **unverified**.

A curator (in the hackathon: the admin wallet) reviews unverified markets and either verifies them — making them visible on the home page — or slashes the bond and removes them as spam.

### Flow 4: Portfolio and claiming

The user opens their portfolio and sees three sections: open positions, resolved positions with winnings to claim, and historical positions. For resolved markets where the user holds winning tokens, a **Claim** button settles the position into TAB.

### Flow 5 (stretch): Pro mode trading

On any market, a user can switch the trading panel to **Pro mode**. They see the live `TabClob` order book and can place EIP-712 signed limit orders. Hackathon scope: read-only book + a minimal order entry form; full maker tooling is post-hackathon.

## Display rules

- Probability is the source of truth. Bookmaker odds are a derived display format.
- Every market shows its **resolution criteria** prominently. A user must know how the market will be decided before they bet.
- Every market shows whether it is **verified** by a curator. Unverified markets are visible to the creator and to direct-link visitors but not on the home grid.
- All amounts are in **TAB**, the platform's own ERC-20 token. A claim button in the UI lets pre-authorized addresses claim test TAB (`CLAIM_AMOUNT` per allowance) on the local Hardhat network and on Base Sepolia. The chain is shown but not in the user's face.

## Out of scope for the hackathon

- Options (puts/calls) on outcome tokens.
- Liquidity provision UI beyond the bond posted at market creation.
- Cron-based agent notifications ("ping me when this market moves 10%").
- Correlation analysis across markets by Kowalsky.
- Real oracle resolution (UMA). Markets resolve via curator/admin in the hackathon.
- Mainnet.

These are all desirable post-hackathon. They do not exist on demo day.
