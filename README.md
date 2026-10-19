# Chip Leader

A poker chip tracker for home games. You deal real cards, and the app keeps track of every stack, bet, raise, pot and side pot, so nobody has to do the math in the Notes app.

## Features

- **Table setup**: 2–10 players, any exact number of starting chips, small and big blind, an optional ante, and who deals first.
- **Real No-Limit Hold'em betting**: each player gets only the moves that are legal right now (fold, check, call, bet, raise or all-in).
  - Blinds post automatically and the button moves every hand. Heads-up, the dealer posts the small blind and acts first pre-flop.
  - Minimum raises follow the last full bet or raise.
  - An all-in for less than a full raise doesn't reopen betting for players who already acted.
  - Any part of a bet nobody can call goes back to the bettor.
- **Raise sizing**: Min, ½ Pot, ¾ Pot, Pot and All-in buttons, plus a slider and a box for typing an exact amount.
- **Side pots**: when players are all-in for different amounts, the app builds a main pot and side pots. At showdown you tap who won each pot, or tap two or more players to split it. Odd chips go to the winner closest to the left of the button.
- **Stacks update after every action**: the pot total, each player's bet and each stack are always on screen.
- **Undo and redo**: every button press can be undone, all the way back to the start of the hand and earlier, and each step restores every stack, bet and pot exactly. Redo steps forward again, **Latest** jumps straight back to the most recent action, and **Rewind to start of hand** in the menu jumps back to just after the blinds were posted. The history survives closing the app. Taking a new action after undoing replaces the undone steps.
- **Between hands**: add chips (rebuys), sit players out, add or remove players, move the button and change the blinds.
- **Hand log and history**, plus each player's buy-ins and how far up or down they are.
- **Saves automatically** on the device, so a refresh or a locked phone won't lose the game.

## Put it online (free, one-time setup)

1. On GitHub, open this repository's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**. Choose the branch with this code (`claude/poker-chip-tracker-4eyav2`) and the **/ (root)** folder, then click **Save**.
3. Wait a minute or two. The site will be live at **https://olliewstrong-byte.github.io/Poker-Chip-Tracker/**

Every push to that branch updates the site automatically.

### Install it on your phone

- **iPhone (Safari):** open the link, tap **Share**, then **Add to Home Screen**.
- **Android (Chrome):** open the link, tap **⋮**, then **Install app** (or **Add to Home screen**).

It then opens full screen from its own icon, like a normal app. It also keeps working with no signal: after the first visit, the app is cached on the phone.

Games are saved on the device that's running them. The phone you hand round the table keeps the game, even if the app is closed.

### Running it locally

It's a static site with no build step. Open `index.html` in a browser, or run `npm start` to serve the folder.

## Tests

The betting engine (`js/engine.js`) has no dependencies and is covered by tests for side pots, uncalled bets, incomplete raises, split pots, antes, short blinds and heads-up play. A randomized test also plays thousands of hands and checks that no chip is ever created or lost.

```sh
npm test
```

## Files

- `index.html`: page shell
- `manifest.webmanifest`, `sw.js`, `icons/`: home-screen install and offline support
- `css/style.css`: the table, felt and controls
- `js/engine.js`: betting rules and pot math, with no UI code
- `js/app.js`: the interface
- `tests/engine.test.js`: engine tests (Node's built-in test runner)
