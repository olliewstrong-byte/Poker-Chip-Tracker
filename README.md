# Chip Leader

A poker chip tracker for home games. You deal real cards, and the app keeps track of every stack, bet, raise, pot and side pot, so nobody has to do the math in the Notes app.

## Features

- **Table setup**: 2–10 players, starting chips, small and big blind, an optional ante, and who deals first.
- **Real No-Limit Hold'em betting**: each player gets only the moves that are legal right now (fold, check, call, bet, raise or all-in).
  - Blinds post automatically and the button moves every hand. Heads-up, the dealer posts the small blind and acts first pre-flop.
  - Minimum raises follow the last full bet or raise.
  - An all-in for less than a full raise doesn't reopen betting for players who already acted.
  - Any part of a bet nobody can call goes back to the bettor.
- **Raise sizing**: Min, ½ Pot, ¾ Pot, Pot and All-in buttons, plus a slider and a box for typing an exact amount.
- **Side pots**: when players are all-in for different amounts, the app builds a main pot and side pots. At showdown you tap who won each pot, or tap two or more players to split it. Odd chips go to the winner closest to the left of the button.
- **Stacks update after every action**: the pot total, each player's bet and each stack are always on screen.
- **Undo** steps back one action at a time, even after a pot has been paid out.
- **Between hands**: add chips (rebuys), sit players out, add or remove players, move the button and change the blinds.
- **Hand log and history**, plus each player's buy-ins and how far up or down they are.
- **Saves automatically** on the device, so a refresh or a locked phone won't lose the game.

## Running it

It's a static site with no build step. Open `index.html` in a browser, or serve the folder:

```sh
npm start        # serves the folder at http://localhost:3000
```

To put it online for your group, turn on **GitHub Pages** for this repository (Settings → Pages → deploy from the `main` branch, root folder). On a phone, use "Add to Home Screen" to get a full-screen app.

## Tests

The betting engine (`js/engine.js`) has no dependencies and is covered by tests for side pots, uncalled bets, incomplete raises, split pots, antes, short blinds and heads-up play. A randomized test also plays thousands of hands and checks that no chip is ever created or lost.

```sh
npm test
```

## Files

- `index.html`: page shell
- `css/style.css`: the table, felt and controls
- `js/engine.js`: betting rules and pot math, with no UI code
- `js/app.js`: the interface
- `tests/engine.test.js`: engine tests (Node's built-in test runner)
