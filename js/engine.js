/*
 * Poker chip engine — No-Limit Hold'em betting rules without the cards.
 *
 * All state is plain JSON so it can be saved, cloned for undo, and restored.
 * Every function that changes the game mutates the state passed in and throws
 * an Error if the requested change is not legal.
 *
 * Chip amounts are always whole numbers.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PokerEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STREETS = ['preflop', 'flop', 'turn', 'river'];
  var STREET_NAMES = {
    preflop: 'Pre-Flop',
    flop: 'Flop',
    turn: 'Turn',
    river: 'River',
    showdown: 'Showdown',
  };
  var MAX_PLAYERS = 10;
  var HISTORY_LIMIT = 100;

  // ---------- helpers ----------

  function chips(value, label, allowZero) {
    var n = Number(value);
    if (!Number.isFinite(n) || Math.floor(n) !== n || n < 0 || (!allowZero && n === 0)) {
      throw new Error(label + ' must be a whole number' + (allowZero ? ' (0 or more)' : ' greater than 0'));
    }
    return n;
  }

  function cleanName(name, fallback) {
    var s = String(name == null ? '' : name).trim().slice(0, 16);
    return s || fallback;
  }

  // Next seat clockwise from `from` (not including `from` until a full lap) that satisfies `pred`.
  function nextIndex(n, from, pred) {
    for (var k = 1; k <= n; k++) {
      var i = (from + k) % n;
      if (pred(i)) return i;
    }
    return -1;
  }

  function sum(arr, fn) {
    var t = 0;
    for (var i = 0; i < arr.length; i++) t += fn(arr[i], i);
    return t;
  }

  function assertBetweenHands(state) {
    if (state.hand && state.hand.phase !== 'complete') {
      throw new Error('Finish the current hand first');
    }
  }

  // ---------- game setup ----------

  function validateBlinds(sb, bb, ante) {
    sb = chips(sb, 'Small blind');
    bb = chips(bb, 'Big blind');
    ante = chips(ante || 0, 'Ante', true);
    if (bb < sb) throw new Error('Big blind must be at least the small blind');
    return { smallBlind: sb, bigBlind: bb, ante: ante };
  }

  function createGame(opts) {
    var list = opts.players || [];
    if (list.length < 2) throw new Error('You need at least 2 players');
    if (list.length > MAX_PLAYERS) throw new Error('At most ' + MAX_PLAYERS + ' players can sit at a table');
    var blinds = validateBlinds(opts.smallBlind, opts.bigBlind, opts.ante);
    var players = list.map(function (p, i) {
      var stack = chips(p.stack, 'Starting chips');
      return {
        id: i + 1,
        name: cleanName(p.name, 'Player ' + (i + 1)),
        stack: stack,
        buyIn: stack,
        sittingOut: false,
      };
    });
    var dealer = Number(opts.dealer) || 0;
    if (dealer < 0 || dealer >= players.length) dealer = 0;
    return {
      version: 1,
      players: players,
      nextId: players.length + 1,
      smallBlind: blinds.smallBlind,
      bigBlind: blinds.bigBlind,
      ante: blinds.ante,
      startingStack: players[0].stack,
      dealer: dealer,
      buttonSet: true, // true = next hand uses `dealer` as-is instead of moving the button
      handNumber: 0,
      hand: null,
      history: [],
    };
  }

  function canPlay(state, i) {
    var p = state.players[i];
    return p.stack > 0 && !p.sittingOut;
  }

  function playersWithChips(state) {
    return state.players.filter(function (p, i) { return canPlay(state, i); }).length;
  }

  // ---------- hand flow ----------

  function startHand(state) {
    assertBetweenHands(state);
    var n = state.players.length;
    var inHand = function (i) { return canPlay(state, i); };
    var count = playersWithChips(state);
    if (count < 2) throw new Error('At least two players need chips to deal a hand');

    var dealer;
    if (state.buttonSet && inHand(state.dealer)) dealer = state.dealer;
    else dealer = nextIndex(n, state.dealer, inHand);
    state.dealer = dealer;
    state.buttonSet = false;

    var headsUp = count === 2;
    var sb = headsUp ? dealer : nextIndex(n, dealer, inHand);
    var bb = nextIndex(n, sb, inHand);

    var hand = {
      number: ++state.handNumber,
      street: 'preflop',
      phase: 'betting', // betting -> showdown -> complete
      dealer: dealer,
      sb: sb,
      bb: bb,
      currentBet: 0,
      minRaise: state.bigBlind,
      toAct: -1,
      p: state.players.map(function (pl, i) {
        var playing = inHand(i);
        return { in: playing, folded: !playing, allIn: false, bet: 0, total: 0, actedAt: null, last: null };
      }),
      startStacks: state.players.map(function (pl) { return pl.stack; }),
      blinds: { smallBlind: state.smallBlind, bigBlind: state.bigBlind, ante: state.ante },
      log: [],
      pots: null,
      runout: null,
      results: null,
    };
    state.hand = hand;

    if (state.ante > 0) {
      for (var i = 0; i < n; i++) {
        if (!hand.p[i].in) continue;
        var a = Math.min(state.ante, state.players[i].stack);
        state.players[i].stack -= a;
        hand.p[i].total += a;
        if (state.players[i].stack === 0) hand.p[i].allIn = true;
      }
      log(state, null, 'Antes of ' + state.ante + ' posted');
    }

    var sbAmt = putIn(state, sb, state.smallBlind);
    log(state, sb, 'posts small blind ' + sbAmt + (hand.p[sb].allIn ? ' (all-in)' : ''));
    var bbAmt = putIn(state, bb, state.bigBlind);
    log(state, bb, 'posts big blind ' + bbAmt + (hand.p[bb].allIn ? ' (all-in)' : ''));
    if (sbAmt) hand.p[sb].last = 'SB ' + sbAmt;
    if (bbAmt) hand.p[bb].last = 'BB ' + bbAmt;

    // Players must call the full big blind even if the big blind is short.
    hand.currentBet = state.bigBlind;
    hand.minRaise = state.bigBlind;

    // Pre-flop action starts left of the big blind (heads-up: the dealer/small blind).
    advance(state, bb);
    return state;
  }

  // Move chips from a player's stack into their bet for this street.
  function putIn(state, i, amount) {
    var pl = state.players[i];
    var hp = state.hand.p[i];
    var amt = Math.min(amount, pl.stack);
    pl.stack -= amt;
    hp.bet += amt;
    hp.total += amt;
    if (pl.stack === 0) hp.allIn = true;
    return amt;
  }

  function log(state, i, text) {
    state.hand.log.push({
      street: state.hand.street,
      who: i == null ? null : state.players[i].name,
      text: text,
    });
  }

  function livePlayers(state) {
    var out = [];
    state.hand.p.forEach(function (hp, i) { if (hp.in && !hp.folded) out.push(i); });
    return out;
  }

  function canStillBet(state, i) {
    var hp = state.hand.p[i];
    return hp.in && !hp.folded && !hp.allIn;
  }

  function othersWhoCanBet(state, i) {
    var n = 0;
    state.hand.p.forEach(function (hp, j) { if (j !== i && canStillBet(state, j)) n++; });
    return n;
  }

  function needsToAct(state, i) {
    var h = state.hand;
    var hp = h.p[i];
    if (!canStillBet(state, i)) return false;
    if (hp.bet < h.currentBet) return true;
    if (hp.actedAt !== null) return false;
    // Hasn't acted yet and owes nothing: only matters if someone else can still bet.
    return othersWhoCanBet(state, i) > 0;
  }

  // Find who acts next after seat `from`, or close the betting round.
  function advance(state, from) {
    var h = state.hand;
    var live = livePlayers(state);
    if (live.length === 1) return winUncontested(state, live[0]);
    var next = nextIndex(state.players.length, from, function (i) { return needsToAct(state, i); });
    if (next !== -1) {
      h.toAct = next;
      return;
    }
    endStreet(state);
  }

  // If the biggest bet this street was not fully called, give the extra back.
  function returnUncalled(state) {
    var h = state.hand;
    var top = -1, topBet = 0, second = 0;
    h.p.forEach(function (hp, i) {
      if (hp.bet > topBet) {
        second = topBet;
        topBet = hp.bet;
        top = i;
      } else if (hp.bet > second) {
        second = hp.bet;
      }
    });
    if (top === -1 || topBet <= second) return;
    var refund = topBet - second;
    var hp = h.p[top];
    hp.bet -= refund;
    hp.total -= refund;
    state.players[top].stack += refund;
    if (state.players[top].stack > 0) hp.allIn = false;
    log(state, top, 'gets uncalled ' + refund + ' back');
  }

  function clearStreetBets(state) {
    state.hand.p.forEach(function (hp) {
      hp.bet = 0;
      hp.actedAt = null;
      if (!hp.folded && !hp.allIn) hp.last = null;
    });
  }

  function endStreet(state) {
    var h = state.hand;
    returnUncalled(state);
    clearStreetBets(state);
    h.toAct = -1;
    var live = livePlayers(state);
    if (live.length === 1) return winUncontested(state, live[0]);

    var idx = STREETS.indexOf(h.street);
    if (idx === STREETS.length - 1) return goToShowdown(state);

    var bettors = live.filter(function (i) { return !h.p[i].allIn; });
    if (bettors.length <= 1) {
      // Nobody left to bet against: deal out the rest of the board.
      h.runout = STREETS.slice(idx + 1);
      return goToShowdown(state);
    }

    h.street = STREETS[idx + 1];
    h.currentBet = 0;
    h.minRaise = state.bigBlind;
    log(state, null, STREET_NAMES[h.street] + ' — pot ' + potTotal(state));
    // After the flop, action starts with the first live player left of the button.
    advance(state, h.dealer);
  }

  function winUncontested(state, winner) {
    var h = state.hand;
    returnUncalled(state);
    clearStreetBets(state);
    var pot = potTotal(state);
    state.players[winner].stack += pot;
    h.pots = [{ amount: pot, eligible: [winner], winners: [winner], label: 'Pot' }];
    log(state, winner, 'wins ' + pot + ' (everyone else folded)');
    completeHand(state);
  }

  function goToShowdown(state) {
    var h = state.hand;
    h.street = 'showdown';
    h.phase = 'showdown';
    h.toAct = -1;
    h.pots = computePots(state);
    // Pots only one player can win are awarded straight away.
    var undecided = h.pots.filter(function (p) { return p.eligible.length > 1; });
    if (undecided.length === 0) {
      awardPots(state, h.pots.map(function (p) { return p.eligible; }));
    }
  }

  /*
   * Split everything that went in this hand into a main pot and side pots.
   * Each live player's total contribution defines a level; every player
   * (folded or not) contributes to each level up to what they put in, and a
   * pot can be won only by live players who reached that level.
   */
  function computePots(state) {
    var h = state.hand;
    var contrib = h.p.map(function (hp, i) { return { i: i, total: hp.total, live: hp.in && !hp.folded }; });
    var levels = [];
    contrib.forEach(function (c) {
      if (c.live && c.total > 0 && levels.indexOf(c.total) === -1) levels.push(c.total);
    });
    levels.sort(function (a, b) { return a - b; });

    var pots = [];
    var prev = 0;
    levels.forEach(function (level) {
      var amount = sum(contrib, function (c) { return Math.max(0, Math.min(c.total, level) - prev); });
      var eligible = contrib.filter(function (c) { return c.live && c.total >= level; }).map(function (c) { return c.i; });
      if (amount > 0) pots.push({ amount: amount, eligible: eligible, winners: null });
      prev = level;
    });
    // Chips from folded players above the highest live level (rare) go to the last pot.
    var leftover = sum(contrib, function (c) { return Math.max(0, c.total - prev); });
    if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover;

    pots.forEach(function (p, k) { p.label = k === 0 ? 'Main pot' : 'Side pot ' + k; });
    return pots;
  }

  // Seat order starting left of the button — used to hand out odd chips.
  function seatOrderFromButton(state, list) {
    var n = state.players.length;
    var d = state.hand.dealer;
    return list.slice().sort(function (a, b) {
      return ((a - d - 1 + n) % n) - ((b - d - 1 + n) % n);
    });
  }

  /*
   * winnersPerPot: array (one entry per pot) of arrays of player indexes.
   * Split pots are divided evenly; odd chips go to the winners closest
   * to the left of the button.
   */
  function awardPots(state, winnersPerPot) {
    var h = state.hand;
    if (!h || h.phase !== 'showdown') throw new Error('There is no showdown to settle');
    if (!Array.isArray(winnersPerPot) || winnersPerPot.length !== h.pots.length) {
      throw new Error('Pick a winner for every pot');
    }
    winnersPerPot.forEach(function (ws, k) {
      var pot = h.pots[k];
      if (!ws || !ws.length) throw new Error('Pick a winner for the ' + pot.label.toLowerCase());
      ws.forEach(function (w) {
        if (pot.eligible.indexOf(w) === -1) {
          throw new Error(state.players[w].name + ' is not in the ' + pot.label.toLowerCase());
        }
      });
    });
    winnersPerPot.forEach(function (ws, k) {
      var pot = h.pots[k];
      var unique = seatOrderFromButton(state, ws.filter(function (w, j) { return ws.indexOf(w) === j; }));
      var share = Math.floor(pot.amount / unique.length);
      var odd = pot.amount - share * unique.length;
      pot.winners = unique;
      pot.shares = unique.map(function (w, j) {
        var amt = share + (j < odd ? 1 : 0);
        state.players[w].stack += amt;
        return amt;
      });
      var names = unique.map(function (w) { return state.players[w].name; });
      log(state, null, (unique.length > 1 ? names.join(' & ') + ' split ' : names[0] + ' wins ') +
        pot.label.toLowerCase() + ' of ' + pot.amount);
    });
    completeHand(state);
  }

  function completeHand(state) {
    var h = state.hand;
    h.phase = 'complete';
    h.toAct = -1;
    h.p.forEach(function (hp, i) {
      hp.bet = 0;
      hp.allIn = false;
    });
    h.results = state.players.map(function (pl, i) {
      var won = 0;
      (h.pots || []).forEach(function (pot) {
        var k = pot.winners ? pot.winners.indexOf(i) : -1;
        if (k !== -1) won += pot.shares ? pot.shares[k] : pot.amount;
      });
      return { won: won, net: pl.stack - h.startStacks[i] };
    });
    var winners = [];
    h.results.forEach(function (r, i) {
      if (r.won > 0) winners.push({ name: state.players[i].name, amount: r.won });
    });
    state.history.unshift({
      number: h.number,
      pot: sum(h.pots || [], function (p) { return p.amount; }),
      winners: winners,
      ended: h.runout ? 'Showdown (all-in)' : (h.street === 'showdown' ? 'Showdown' : STREET_NAMES[h.street]),
    });
    if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;
  }

  // ---------- betting ----------

  function potTotal(state) {
    if (!state.hand) return 0;
    if (state.hand.phase === 'complete') return 0;
    return sum(state.hand.p, function (hp) { return hp.total; });
  }

  // Chips already pulled into the middle (excludes bets still in front of players).
  function potCollected(state) {
    if (!state.hand || state.hand.phase === 'complete') return 0;
    return sum(state.hand.p, function (hp) { return hp.total - hp.bet; });
  }

  function legalActions(state) {
    var h = state.hand;
    if (!h || h.phase !== 'betting' || h.toAct < 0) return null;
    var i = h.toAct;
    var hp = h.p[i];
    var stack = state.players[i].stack;
    var toCall = Math.max(0, h.currentBet - hp.bet);
    var reopened = hp.actedAt === null || h.currentBet - hp.actedAt >= h.minRaise;
    var canRaise = stack > toCall && othersWhoCanBet(state, i) > 0 && reopened;
    var maxTo = hp.bet + stack;
    var minTo = Math.min(h.currentBet + h.minRaise, maxTo);
    return {
      player: i,
      stack: stack,
      toCall: toCall,
      canFold: toCall > 0,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      callAmount: Math.min(toCall, stack),
      callIsAllIn: toCall > 0 && stack <= toCall,
      canRaise: canRaise,
      isBet: h.currentBet === 0,
      minTo: minTo,
      maxTo: maxTo,
      currentBet: h.currentBet,
      bet: hp.bet,
      pot: potTotal(state),
    };
  }

  /*
   * action: { type: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin', amount }
   * For bet/raise, `amount` is the total the player's bet becomes this street ("raise to").
   */
  function act(state, action) {
    var la = legalActions(state);
    if (!la) throw new Error('Nobody is waiting to act');
    var h = state.hand;
    var i = la.player;
    var hp = h.p[i];
    var name = state.players[i].name;
    var type = action && action.type;

    if (type === 'fold') {
      if (!la.canFold) throw new Error('No bet to fold to — check instead');
      hp.folded = true;
      hp.last = 'Fold';
      log(state, i, 'folds');
    } else if (type === 'check') {
      if (!la.canCheck) throw new Error(name + ' has to call ' + la.toCall + ' or fold');
      hp.actedAt = h.currentBet;
      hp.last = 'Check';
      log(state, i, 'checks');
    } else if (type === 'call') {
      if (!la.canCall) throw new Error('Nothing to call — check instead');
      var paid = putIn(state, i, la.toCall);
      hp.actedAt = h.currentBet;
      hp.last = hp.allIn ? 'All-in' : 'Call ' + paid;
      log(state, i, 'calls ' + paid + (hp.allIn ? ' (all-in)' : ''));
    } else if (type === 'bet' || type === 'raise' || type === 'allin') {
      var to = type === 'allin' ? la.maxTo : chips(action.amount, 'Amount');
      if (type === 'allin' && la.callIsAllIn) {
        return act(state, { type: 'call' });
      }
      if (!la.canRaise) throw new Error(name + ' can only call or fold here');
      if (to > la.maxTo) throw new Error(name + ' only has ' + la.maxTo + ' including chips already bet');
      if (to < la.minTo) throw new Error('The minimum ' + (la.isBet ? 'bet' : 'raise') + ' is ' + la.minTo);
      var wasBet = la.isBet;
      var increment = to - h.currentBet;
      putIn(state, i, to - hp.bet);
      if (increment >= h.minRaise) h.minRaise = increment; // a full raise sets the new minimum
      if (to > h.currentBet) h.currentBet = to;
      hp.actedAt = h.currentBet;
      hp.last = hp.allIn ? 'All-in' : (wasBet ? 'Bet ' : 'Raise ') + to;
      log(state, i, (wasBet ? 'bets ' : 'raises to ') + to + (hp.allIn ? ' (all-in)' : ''));
    } else {
      throw new Error('Unknown action');
    }

    advance(state, i);
    return state;
  }

  // ---------- table management (between hands) ----------

  function setBlinds(state, sb, bb, ante) {
    assertBetweenHands(state);
    var b = validateBlinds(sb, bb, ante);
    state.smallBlind = b.smallBlind;
    state.bigBlind = b.bigBlind;
    state.ante = b.ante;
  }

  function rebuy(state, i, amount) {
    assertBetweenHands(state);
    amount = chips(amount, 'Rebuy amount');
    state.players[i].stack += amount;
    state.players[i].buyIn += amount;
  }

  function addPlayer(state, name, stack) {
    assertBetweenHands(state);
    if (state.players.length >= MAX_PLAYERS) throw new Error('The table is full');
    stack = chips(stack, 'Starting chips');
    var id = state.nextId++;
    state.players.push({ id: id, name: cleanName(name, 'Player ' + id), stack: stack, buyIn: stack, sittingOut: false });
    state.hand = null;
  }

  function removePlayer(state, i) {
    assertBetweenHands(state);
    if (state.players.length <= 2) throw new Error('A table needs at least 2 players');
    state.players.splice(i, 1);
    var n = state.players.length;
    if (i < state.dealer) {
      state.dealer--;
    } else if (i === state.dealer) {
      // The button moves on to whoever sat after the player who left.
      state.dealer = (i - 1 + n) % n;
      state.buttonSet = false;
    }
    state.hand = null;
  }

  function renamePlayer(state, i, name) {
    state.players[i].name = cleanName(name, state.players[i].name);
  }

  function setSittingOut(state, i, out) {
    assertBetweenHands(state);
    state.players[i].sittingOut = !!out;
  }

  function setDealer(state, i) {
    assertBetweenHands(state);
    state.dealer = i;
    state.buttonSet = true;
  }

  // Chips in play must always equal everything bought in.
  function chipsInPlay(state) {
    var stacks = sum(state.players, function (p) { return p.stack; });
    var middle = state.hand && state.hand.phase !== 'complete' ? potTotal(state) : 0;
    return stacks + middle;
  }

  function totalBuyIns(state) {
    return sum(state.players, function (p) { return p.buyIn; });
  }

  return {
    STREETS: STREETS,
    STREET_NAMES: STREET_NAMES,
    MAX_PLAYERS: MAX_PLAYERS,
    createGame: createGame,
    startHand: startHand,
    legalActions: legalActions,
    act: act,
    awardPots: awardPots,
    computePots: computePots,
    potTotal: potTotal,
    potCollected: potCollected,
    playersWithChips: playersWithChips,
    setBlinds: setBlinds,
    rebuy: rebuy,
    addPlayer: addPlayer,
    removePlayer: removePlayer,
    renamePlayer: renamePlayer,
    setSittingOut: setSittingOut,
    setDealer: setDealer,
    chipsInPlay: chipsInPlay,
    totalBuyIns: totalBuyIns,
  };
});
