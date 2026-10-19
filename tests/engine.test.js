'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');

function game(stacks, opts = {}) {
  return E.createGame({
    players: stacks.map((s, i) => ({ name: 'P' + i, stack: s })),
    smallBlind: opts.sb ?? 5,
    bigBlind: opts.bb ?? 10,
    ante: opts.ante ?? 0,
    dealer: opts.dealer ?? 0,
  });
}

const stacks = (g) => g.players.map((p) => p.stack);
const toAct = (g) => g.hand.toAct;

function play(g, ...actions) {
  for (const a of actions) {
    const [type, amount] = a.split(' ');
    E.act(g, { type, amount: amount && Number(amount) });
  }
}

function conserved(g) {
  assert.equal(E.chipsInPlay(g), E.totalBuyIns(g), 'chips were created or lost');
}

test('three-handed hand to showdown pays the right stacks', () => {
  const g = game([1000, 1000, 1000], { sb: 10, bb: 20 });
  E.startHand(g);
  // Dealer 0, SB 1, BB 2 — dealer acts first pre-flop three-handed.
  assert.equal(g.hand.sb, 1);
  assert.equal(g.hand.bb, 2);
  assert.equal(toAct(g), 0);
  assert.equal(E.potTotal(g), 30);
  play(g, 'raise 60', 'call', 'fold');
  assert.equal(g.hand.street, 'flop');
  assert.equal(E.potTotal(g), 140);
  assert.equal(toAct(g), 1, 'first live player left of the button acts first after the flop');
  play(g, 'check', 'bet 100', 'call');
  assert.equal(g.hand.street, 'turn');
  assert.equal(E.potTotal(g), 340);
  play(g, 'check', 'check', 'check', 'check');
  assert.equal(g.hand.phase, 'showdown');
  assert.equal(g.hand.pots.length, 1);
  assert.deepEqual(g.hand.pots[0].eligible, [0, 1]);
  assert.equal(g.hand.pots[0].amount, 340);
  E.awardPots(g, [[0]]);
  assert.deepEqual(stacks(g), [1180, 840, 980]);
  assert.equal(g.hand.results[0].net, 180);
  conserved(g);
});

test('big blind gets the option when everyone limps', () => {
  const g = game([500, 500, 500]);
  E.startHand(g);
  play(g, 'call', 'call');
  assert.equal(g.hand.street, 'preflop');
  assert.equal(toAct(g), 2);
  const la = E.legalActions(g);
  assert.ok(la.canCheck);
  assert.ok(la.canRaise);
  assert.ok(!la.canFold);
  play(g, 'raise 40');
  assert.equal(toAct(g), 0);
  assert.equal(E.legalActions(g).toCall, 30);
  play(g, 'call', 'call');
  assert.equal(g.hand.street, 'flop');
  assert.equal(E.potTotal(g), 120);
  conserved(g);
});

test('heads-up: dealer posts the small blind, acts first pre-flop and last after', () => {
  const g = game([300, 300], { dealer: 1 });
  E.startHand(g);
  assert.equal(g.hand.sb, 1);
  assert.equal(g.hand.bb, 0);
  assert.equal(toAct(g), 1);
  play(g, 'call', 'check');
  assert.equal(g.hand.street, 'flop');
  assert.equal(toAct(g), 0);
  play(g, 'bet 20', 'raise 60', 'fold');
  assert.equal(g.hand.phase, 'complete');
  // P1 wins 10 + 10 + 20 (uncalled 40 returned)
  assert.deepEqual(stacks(g), [270, 330]);
  conserved(g);
});

test('everyone folds to the big blind', () => {
  const g = game([100, 100, 100, 100]);
  E.startHand(g); // dealer 0, SB 1, BB 2, UTG 3
  play(g, 'fold', 'fold', 'fold');
  assert.equal(g.hand.phase, 'complete');
  assert.deepEqual(stacks(g), [100, 95, 105, 100]);
  conserved(g);
});

test('side pots are built from all-in levels and paid separately', () => {
  // P0 dealer, P1 SB, P2 BB, P3 UTG
  const g = game([1000, 100, 300, 1000]);
  E.startHand(g);
  play(g, 'raise 300'); // P3
  play(g, 'call'); // P0 calls 300
  play(g, 'call'); // P1 calls all-in for 100
  assert.ok(g.hand.p[1].allIn);
  play(g, 'call'); // P2 calls all-in for 300
  assert.equal(g.hand.street, 'flop');
  assert.equal(E.potTotal(g), 1000);
  // Only P3 and P0 can still bet. P3 is first live non-all-in left of the button.
  assert.equal(toAct(g), 3);
  play(g, 'bet 200', 'call');
  play(g, 'check', 'check', 'check', 'check');
  assert.equal(g.hand.phase, 'showdown');
  const pots = g.hand.pots;
  assert.equal(pots.length, 3);
  assert.deepEqual(pots.map((p) => p.amount), [400, 600, 400]);
  assert.deepEqual(pots[0].eligible, [0, 1, 2, 3]);
  assert.deepEqual(pots[1].eligible, [0, 2, 3]);
  assert.deepEqual(pots[2].eligible, [0, 3]);
  assert.throws(() => E.awardPots(g, [[1], [1], [0]]), /not in the side pot/);
  E.awardPots(g, [[1], [2], [3]]);
  assert.deepEqual(stacks(g), [500, 400, 600, 900]);
  conserved(g);
});

test('folded players still fund the pots they put chips into', () => {
  const g = game([1000, 1000, 50, 1000]); // P2 is BB with 50
  E.startHand(g);
  play(g, 'raise 200'); // P3
  play(g, 'call'); // P0
  play(g, 'fold'); // P1 folds 5
  play(g, 'call'); // P2 all-in 50
  // Flop: P3 bets, P0 folds
  play(g, 'bet 300', 'fold');
  // P3's 300 is uncalled -> returned; P2 is the only other live player and is all-in.
  assert.equal(g.hand.phase, 'showdown');
  assert.deepEqual(g.hand.runout, ['turn', 'river']);
  assert.deepEqual(g.hand.pots.map((p) => p.amount), [155, 300]);
  assert.deepEqual(g.hand.pots[1].eligible, [3]);
  E.awardPots(g, [[2], [3]]);
  assert.deepEqual(stacks(g), [800, 995, 155, 1100]);
  conserved(g);
});

test('a shove bigger than anyone can call has the excess returned', () => {
  const g = game([1000, 300, 1000]); // dealer 0, SB 1, BB 2
  E.startHand(g);
  play(g, 'allin'); // P0 1000
  play(g, 'allin'); // P1 all-in for 300 — a call for less
  play(g, 'fold'); // BB folds
  assert.equal(g.hand.phase, 'showdown');
  assert.deepEqual(g.hand.runout, ['flop', 'turn', 'river']);
  assert.equal(g.hand.pots.length, 1);
  assert.equal(g.hand.pots[0].amount, 610);
  assert.equal(g.players[0].stack, 700, '700 uncalled returned to the shover');
  E.awardPots(g, [[1]]);
  assert.deepEqual(stacks(g), [700, 610, 990]);
  conserved(g);
});

test('an all-in for less than a full raise does not reopen the betting', () => {
  // P0 dealer, P1 SB, P2 BB, P3 UTG with 250
  const g = game([1000, 1000, 1000, 250], { sb: 50, bb: 100 });
  E.startHand(g);
  play(g, 'call'); // P3 limps 100
  play(g, 'raise 200'); // P0 raises to 200 (raise of 100)
  play(g, 'fold'); // P1
  play(g, 'fold'); // P2
  // P3 all-in to 250: only 50 more, less than the 100 min raise
  play(g, 'allin');
  assert.equal(toAct(g), 0);
  let la = E.legalActions(g);
  assert.equal(la.toCall, 50);
  assert.equal(la.canRaise, false, 'P0 cannot re-raise an incomplete raise');
  // P3 is all-in and nobody else can bet anyway.
  play(g, 'call');
  assert.equal(g.hand.phase, 'showdown');
  conserved(g);
});

test('incomplete all-in: players who already acted may only call, others may raise', () => {
  // dealer P0, SB P1, BB P2, P3, P4 (short)
  const g = game([2000, 2000, 2000, 2000, 450], { sb: 50, bb: 100 });
  E.startHand(g);
  play(g, 'raise 300'); // P3 raises to 300 (raise of 200)
  play(g, 'allin'); // P4 all-in 450: +150 < 200 → incomplete
  assert.equal(g.hand.currentBet, 450);
  assert.equal(g.hand.minRaise, 200);
  assert.equal(toAct(g), 0);
  let la = E.legalActions(g);
  assert.ok(la.canRaise, 'P0 has not acted yet so they may raise');
  assert.equal(la.minTo, 650);
  play(g, 'call'); // P0 calls 450
  play(g, 'fold', 'fold'); // blinds fold
  la = E.legalActions(g);
  assert.equal(toAct(g), 3);
  assert.equal(la.toCall, 150);
  assert.equal(la.canRaise, false, 'P3 already acted at 300; 150 more is not a full raise');
  play(g, 'call');
  assert.equal(g.hand.street, 'flop');
  conserved(g);
});

test('two incomplete raises that add up to a full raise reopen the betting', () => {
  const g = game([5000, 5000, 5000, 5000, 450, 520], { sb: 50, bb: 100 });
  // dealer 0, SB 1, BB 2, P3 UTG, P4, P5
  E.startHand(g);
  play(g, 'raise 300'); // P3: raise of 200
  play(g, 'allin'); // P4 → 450 (+150)
  play(g, 'allin'); // P5 → 520 (+70)
  play(g, 'call', 'fold', 'fold'); // P0 calls 520, blinds fold
  assert.equal(toAct(g), 3);
  const la = E.legalActions(g);
  assert.equal(la.toCall, 220);
  assert.ok(la.canRaise, '520 - 300 = 220 ≥ 200 so P3 may raise again');
  assert.equal(la.minTo, 720);
  conserved(g);
});

test('minimum raises follow the size of the last full raise', () => {
  const g = game([5000, 5000, 5000], { sb: 25, bb: 50 });
  E.startHand(g);
  let la = E.legalActions(g);
  assert.equal(la.minTo, 100);
  assert.throws(() => play(g, 'raise 90'), /minimum raise is 100/);
  play(g, 'raise 250'); // raise of 200
  la = E.legalActions(g);
  assert.equal(la.minTo, 450);
  play(g, 'call', 'call');
  la = E.legalActions(g);
  assert.ok(la.isBet);
  assert.equal(la.minTo, 50, 'minimum bet after the flop is the big blind');
  conserved(g);
});

test('split pots give odd chips to the first winner left of the button', () => {
  const g = game([100, 100, 100], { sb: 5, bb: 10 });
  E.startHand(g);
  play(g, 'call', 'fold', 'check'); // pot = 10 + 5 + 10 = 25
  play(g, 'check', 'check', 'check', 'check', 'check', 'check');
  assert.equal(g.hand.pots[0].amount, 25);
  E.awardPots(g, [[0, 2]]);
  // Left of button (P0) is P1 (folded) then P2 → P2 gets the odd chip.
  assert.deepEqual(stacks(g), [102, 95, 103]);
  conserved(g);
});

test('short big blind still makes others call the full blind', () => {
  const g = game([500, 500, 6], { sb: 5, bb: 10 });
  E.startHand(g); // BB P2 posts 6 all-in
  assert.ok(g.hand.p[2].allIn);
  assert.equal(E.legalActions(g).toCall, 10);
  play(g, 'call', 'call');
  assert.equal(g.hand.street, 'flop');
  assert.equal(E.potTotal(g), 26);
  play(g, 'check', 'check', 'check', 'check', 'check', 'check');
  assert.deepEqual(g.hand.pots.map((p) => p.amount), [18, 8]);
  E.awardPots(g, [[2], [1]]);
  assert.deepEqual(stacks(g), [490, 498, 18]);
  conserved(g);
});

test('antes go into the pot and side pots', () => {
  const g = game([200, 200, 200], { sb: 5, bb: 10, ante: 2 });
  E.startHand(g);
  assert.equal(E.potTotal(g), 21);
  assert.deepEqual(stacks(g), [198, 193, 188]);
  play(g, 'fold', 'fold');
  assert.deepEqual(stacks(g), [198, 193, 209]);
  conserved(g);
});

test('the button moves every hand and skips busted players', () => {
  const g = game([100, 100, 100, 100]);
  E.startHand(g);
  assert.equal(g.hand.dealer, 0);
  play(g, 'fold', 'fold', 'fold');
  E.startHand(g);
  assert.equal(g.hand.dealer, 1);
  assert.equal(g.hand.sb, 2);
  assert.equal(g.hand.bb, 3);
  g.hand.phase = 'complete';
  g.players[2].stack = 0;
  g.hand.p.forEach((hp) => { hp.total = 0; });
  E.startHand(g);
  assert.equal(g.hand.dealer, 3, 'P2 is busted so the button skips them');
  assert.equal(g.hand.sb, 0);
  assert.equal(g.hand.bb, 1);
});

test('busted players sit out and the last player standing ends the game', () => {
  const g = game([100, 100]);
  E.startHand(g);
  play(g, 'allin', 'call');
  assert.equal(g.hand.phase, 'showdown');
  E.awardPots(g, [[0]]);
  assert.deepEqual(stacks(g), [200, 0]);
  assert.equal(E.playersWithChips(g), 1);
  assert.throws(() => E.startHand(g), /two players/);
  E.rebuy(g, 1, 100);
  E.startHand(g);
  conserved(g);
});

test('illegal actions are rejected', () => {
  const g = game([100, 100, 100]);
  E.startHand(g);
  assert.throws(() => play(g, 'check'), /has to call/);
  assert.throws(() => play(g, 'raise 500'), /only has 100/);
  play(g, 'call', 'call');
  assert.throws(() => play(g, 'fold'), /check instead/);
  assert.throws(() => E.rebuy(g, 0, 50), /Finish the current hand/);
});

test('removing the dealer passes the button to the next seat', () => {
  const g = game([100, 100, 100, 100], { dealer: 2 });
  E.startHand(g);
  play(g, 'fold', 'fold', 'fold'); // P3 is... dealer 2, sb 3, bb 0, utg 1
  E.removePlayer(g, 3); // remove next dealer-to-be... P3 is SB
  E.startHand(g);
  assert.equal(g.players[g.hand.dealer].name, 'P0');
  E.act(g, { type: 'fold' });
  E.act(g, { type: 'fold' });
  E.removePlayer(g, 0); // remove the dealer
  E.startHand(g);
  assert.equal(g.players[g.hand.dealer].name, 'P1');
  conserved(g);
});

// Random legal play across many hands: chips are never created or lost.
test('fuzz: random hands always conserve chips and keep pots consistent', () => {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let gameNo = 0; gameNo < 200; gameNo++) {
    const n = 2 + Math.floor(rand() * 9);
    const g = game(
      Array.from({ length: n }, () => 20 + Math.floor(rand() * 400)),
      { sb: 1 + Math.floor(rand() * 5), bb: 6 + Math.floor(rand() * 6), ante: rand() < 0.3 ? 1 : 0, dealer: Math.floor(rand() * n) }
    );
    for (let h = 0; h < 30 && E.playersWithChips(g) >= 2; h++) {
      E.startHand(g);
      let guard = 0;
      while (g.hand.phase === 'betting') {
        assert.ok(guard++ < 500, 'betting round never ended');
        const la = E.legalActions(g);
        const r = rand();
        let a;
        if (la.canRaise && r < 0.25) {
          const amt = la.minTo + Math.floor(rand() * (la.maxTo - la.minTo + 1));
          a = { type: la.isBet ? 'bet' : 'raise', amount: amt };
        } else if (la.canRaise && r < 0.3) a = { type: 'allin' };
        else if (la.canFold && r < 0.45) a = { type: 'fold' };
        else if (la.canCheck) a = { type: 'check' };
        else a = { type: 'call' };
        E.act(g, a);
        conserved(g);
        g.players.forEach((p) => assert.ok(p.stack >= 0));
        if (g.hand.phase === 'betting') {
          const hp = g.hand.p[g.hand.toAct];
          assert.ok(!hp.folded && !hp.allIn && hp.in, 'only live players with chips may act');
        }
      }
      if (g.hand.phase === 'showdown') {
        const potSum = g.hand.pots.reduce((t, p) => t + p.amount, 0);
        assert.equal(potSum, E.potTotal(g), 'pots add up to everything put in');
        const winners = g.hand.pots.map((p) => {
          const k = 1 + Math.floor(rand() * Math.min(2, p.eligible.length));
          return p.eligible.slice(0, k);
        });
        E.awardPots(g, winners);
      }
      assert.equal(g.hand.phase, 'complete');
      conserved(g);
      assert.equal(
        g.players.reduce((t, p) => t + p.stack, 0),
        E.totalBuyIns(g),
        'after the hand every chip is back in a stack'
      );
    }
  }
});
