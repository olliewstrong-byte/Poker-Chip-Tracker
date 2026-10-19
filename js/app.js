/*
 * Chip Tracker — UI for the poker chip engine.
 * Renders the setup form, the table, the action dock and the side sheets,
 * and saves the game to this device after every change.
 */
(function () {
  'use strict';

  var E = window.PokerEngine;
  // Storage keys keep the app's original name so games saved before the rename still load.
  var STORE_KEY = 'chip-leader:game:v1';
  var SETUP_KEY = 'chip-leader:setup:v1';
  var UNDO_LIMIT = 500;

  var app = document.getElementById('app');
  var toastEl = document.getElementById('toast');

  var game = null;
  var undoStack = []; // { s: game snapshot (JSON), label: what the change was }
  var redoStack = []; // changes that were undone, newest last
  var ui = {
    sheet: null, // 'log' | 'players' | 'menu'
    raiseOpen: false,
    raiseTo: 0,
    winners: null,
    winnersFor: null,
    confirmNew: false,
    setupError: '',
  };
  var setup = {
    count: 6,
    names: [],
    stack: 1000,
    sb: 5,
    bb: 10,
    ante: 0,
    dealer: 0,
    bbTouched: false,
  };

  // ---------- storage ----------

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && saved.game && saved.game.version === 1) {
          game = saved.game;
          undoStack = toEntries(saved.undo);
          redoStack = toEntries(saved.redo);
        }
      }
      var s = localStorage.getItem(SETUP_KEY);
      if (s) Object.assign(setup, JSON.parse(s), { bbTouched: false });
    } catch (e) { /* storage unavailable — start fresh */ }
  }

  function toEntries(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (x) { return typeof x === 'string' ? { s: x, label: '' } : x; });
  }

  // Keep as much undo/redo history as fits in storage; fall back to less if it's full.
  function save() {
    try {
      if (!game) return localStorage.removeItem(STORE_KEY);
    } catch (e) { return; }
    var keep = [400, 150, 40, 0];
    for (var k = 0; k < keep.length; k++) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          game: game,
          undo: keep[k] ? undoStack.slice(-keep[k]) : [],
          redo: keep[k] ? redoStack.slice(-keep[k]) : [],
        }));
        return;
      } catch (e) { /* too big or blocked — try smaller */ }
    }
  }

  function saveSetup() {
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify({
        count: setup.count, names: setup.names, stack: setup.stack, sb: setup.sb, bb: setup.bb, ante: setup.ante,
      }));
    } catch (e) { /* ignore */ }
  }

  // ---------- helpers ----------

  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n)); }

  var toastTimer = null;
  function toast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = kind || '';
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2800);
  }

  // Apply a change to the game; keep a full snapshot of the state before it so it can be undone.
  function commit(fn, label) {
    var snap = JSON.stringify(game);
    var beforeHand = game.hand ? game.hand.number : 0;
    var beforeLog = game.hand ? game.hand.log.length : 0;
    try {
      fn(game);
    } catch (err) {
      game = JSON.parse(snap);
      toast(err.message);
      render();
      return false;
    }
    undoStack.push({ s: snap, label: label || describeChange(beforeHand, beforeLog) });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = []; // a new action replaces anything that was undone
    ui.raiseOpen = false;
    save();
    render();
    return true;
  }

  function describeChange(beforeHand, beforeLog) {
    var h = game.hand;
    if (!h) return 'table change';
    if (h.number !== beforeHand) return 'deal hand ' + h.number;
    var entry = h.log.slice(beforeLog).filter(function (e) { return e.who; })[0] || h.log[beforeLog];
    if (!entry) return 'table change';
    return (entry.who ? entry.who + ' ' : '') + entry.text;
  }

  // Move one step back (undo) or forward (redo) through the saved snapshots.
  function step(from, to) {
    var entry = from.pop();
    to.push({ s: JSON.stringify(game), label: entry.label });
    game = JSON.parse(entry.s);
    return entry.label;
  }

  function afterTimeTravel(msg, skipSave) {
    ui.raiseOpen = false;
    ui.winnersFor = null;
    if (!skipSave) save();
    render();
    if (msg) toast(msg, 'info');
  }

  // skipSave: used while Undo/Redo is held down; the game is saved once on release.
  function undo(skipSave) {
    if (!undoStack.length) return false;
    var label = step(undoStack, redoStack);
    afterTimeTravel('Undid: ' + (label || 'last action'), skipSave === true);
    return true;
  }

  function redo(skipSave) {
    if (!redoStack.length) return false;
    var label = step(redoStack, undoStack);
    afterTimeTravel('Redid: ' + (label || 'last action'), skipSave === true);
    return true;
  }

  function redoAll() {
    var n = redoStack.length;
    while (redoStack.length) step(redoStack, undoStack);
    if (n) afterTimeTravel('Back to the latest action');
  }

  function handOf(entry) {
    var g = JSON.parse(entry.s);
    return g && g.hand ? g.hand.number : null;
  }

  // Undo back to just after this hand was dealt (blinds posted, nobody has acted).
  function rewindToHandStart() {
    if (!game.hand) return;
    var n = game.hand.number, steps = 0;
    while (undoStack.length && handOf(undoStack[undoStack.length - 1]) === n) {
      step(undoStack, redoStack);
      steps++;
    }
    afterTimeTravel(steps ? 'Back to the start of hand ' + n : 'Already at the start of hand ' + n);
  }

  function renderRewindBar() {
    if (!redoStack.length) return '';
    var n = redoStack.length;
    var atStart = !game.hand || !undoStack.length || handOf(undoStack[undoStack.length - 1]) !== game.hand.number;
    return '<div class="rewind-bar">' +
        '<div><b>Went back ' + n + ' step' + (n === 1 ? '' : 's') + '</b>' +
        '<span>Redo replays: ' + esc(redoStack[n - 1].label || 'the next action') + '. A new action replaces the undone steps.</span></div>' +
        '<div class="rewind-btns">' +
          '<button class="mini" data-do="hand-start"' + (atStart ? ' disabled' : '') + '>⏮ Hand start</button>' +
          '<button class="mini" data-do="redo">Redo 1</button>' +
          '<button class="mini gold" data-do="redo-all">Latest ⏭</button>' +
        '</div>' +
      '</div>';
  }

  var ICONS = {
    redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/></svg>',
    players: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2A6.5 6.5 0 0 1 21.5 20"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  };

  function chipEmblem(cls) {
    // A casino chip: red body, white edge spots, inner ring.
    var spots = '';
    for (var k = 0; k < 8; k++) {
      spots += '<rect x="28" y="2" width="8" height="12" rx="1.5" fill="#f3ecda" transform="rotate(' + (k * 45) + ' 32 32)"/>';
    }
    return '<svg class="chip-emblem ' + (cls || '') + '" viewBox="0 0 64 64" aria-hidden="true">' +
      '<circle cx="32" cy="32" r="30" fill="#b3262f" stroke="#5e0f15" stroke-width="2"/>' + spots +
      '<circle cx="32" cy="32" r="19" fill="#8f1b23" stroke="#f3ecda" stroke-width="2" stroke-dasharray="4 3"/>' +
      '<text x="32" y="38.5" text-anchor="middle" font-family="Limelight, Georgia, serif" font-size="17" fill="#dcb662">CT</text>' +
      '</svg>';
  }

  // ---------- setup screen ----------

  function setupName(i) { return setup.names[i] || ''; }

  function renderSetup() {
    var names = '';
    for (var i = 0; i < setup.count; i++) {
      var color = ['#b3262f', '#2f6db5', '#1d1d1d', '#2f9160', '#7b3fa0'][i % 5];
      names += '<label class="name-field"><span style="background:' + color + '">' + (i + 1) + '</span>' +
        '<input class="input" id="name-' + i + '" data-name="' + i + '" maxlength="16" autocomplete="off" ' +
        'placeholder="Player ' + (i + 1) + '" value="' + esc(setupName(i)) + '" aria-label="Seat ' + (i + 1) + ' name"></label>';
    }
    var dealerOpts = '';
    for (var d = 0; d < setup.count; d++) {
      dealerOpts += '<option value="' + d + '"' + (d === setup.dealer ? ' selected' : '') + '>' +
        esc(setupName(d) || 'Player ' + (d + 1)) + '</option>';
    }

    app.innerHTML =
      '<div class="setup">' +
        '<header class="hero">' + chipEmblem() +
          '<h1>Chip Tracker</h1>' +
          '<p>Deal real cards. The app keeps every stack, bet, raise and side pot straight.</p>' +
        '</header>' +
        '<form class="panel" id="setup-form" novalidate>' +
          '<section class="field-group">' +
            '<header><h2>Players</h2>' +
              '<div class="stepper" role="group" aria-label="Number of players">' +
                '<button type="button" data-do="count" data-by="-1" aria-label="Fewer players">−</button>' +
                '<output id="count-out">' + setup.count + '</output>' +
                '<button type="button" data-do="count" data-by="1" aria-label="More players">+</button>' +
              '</div>' +
            '</header>' +
            '<p class="hint">Enter names in seating order, going clockwise around the table.</p>' +
            '<div class="names">' + names + '</div>' +
          '</section>' +
          '<section class="field-group">' +
            '<header><h2>Chips &amp; blinds</h2></header>' +
            '<div class="grid-fields">' +
              '<div class="field"><label for="stack">Starting chips</label><input class="input" id="stack" data-setup="stack" type="number" inputmode="numeric" min="1" step="1" value="' + setup.stack + '"></div>' +
              '<div class="field"><label for="sb">Small blind</label><input class="input" id="sb" data-setup="sb" type="number" inputmode="numeric" min="1" step="1" value="' + setup.sb + '"></div>' +
              '<div class="field"><label for="bb">Big blind</label><input class="input" id="bb" data-setup="bb" type="number" inputmode="numeric" min="1" step="1" value="' + setup.bb + '"></div>' +
              '<div class="field"><label for="ante">Ante <span style="text-transform:none;letter-spacing:0">(optional)</span></label><input class="input" id="ante" data-setup="ante" type="number" inputmode="numeric" min="0" step="1" value="' + setup.ante + '"></div>' +
            '</div>' +
            '<div class="depth" id="depth">' + depthText() + '</div>' +
          '</section>' +
          '<section class="field-group">' +
            '<header><h2>Dealer button</h2></header>' +
            '<div class="field"><label for="dealer">First hand dealt by</label>' +
              '<select class="input" id="dealer" data-setup="dealer">' + dealerOpts + '</select></div>' +
          '</section>' +
          '<p class="form-error" id="setup-error" role="alert">' + esc(ui.setupError) + '</p>' +
          '<button type="submit" class="btn btn-raise btn-big">Shuffle up &amp; deal</button>' +
        '</form>' +
      '</div>';
  }

  function depthText() {
    var stack = Number(setup.stack), bb = Number(setup.bb);
    if (!(stack > 0) || !(bb > 0)) return 'Set the starting chips and blinds.';
    var depth = Math.floor((stack / bb) * 10) / 10;
    return 'Everyone starts with <b>' + fmt(depth) + '</b> big blinds · ' + fmt(stack * setup.count) + ' chips on the table';
  }

  function startGame() {
    saveSetup();
    var players = [];
    for (var i = 0; i < setup.count; i++) players.push({ name: setupName(i) || 'Player ' + (i + 1), stack: setup.stack });
    var names = players.map(function (p) { return p.name.toLowerCase(); });
    if (names.some(function (n, i) { return names.indexOf(n) !== i; })) {
      return setupError('Two players have the same name — give everyone a different one.');
    }
    try {
      game = E.createGame({ players: players, smallBlind: setup.sb, bigBlind: setup.bb, ante: setup.ante, dealer: setup.dealer });
      E.startHand(game);
    } catch (err) {
      game = null;
      return setupError(err.message);
    }
    undoStack = [];
    redoStack = [];
    ui.setupError = '';
    save();
    render();
  }

  function setupError(msg) {
    ui.setupError = msg;
    var el = document.getElementById('setup-error');
    if (el) el.textContent = msg;
  }

  // ---------- table screen ----------

  function renderTable() {
    var h = game.hand;
    var blinds = 'Blinds ' + fmt(game.smallBlind) + ' / ' + fmt(game.bigBlind) + (game.ante ? ' · Ante ' + fmt(game.ante) : '');
    var title = h ? 'Hand ' + h.number : 'Ready to deal';

    var seats = '';
    var bets = '';
    game.players.forEach(function (pl, i) {
      seats += renderSeat(i);
      var hp = h && h.p[i];
      if (hp && hp.bet > 0) {
        bets += '<div class="bet" data-bet="' + i + '"><i class="' + chipColor(hp.bet) + '"></i>' + fmt(hp.bet) + '</div>';
      }
    });

    app.innerHTML =
      '<div class="screen">' +
        '<header class="topbar">' +
          '<div class="brand">' + chipEmblem() + '<b>Chip Tracker</b></div>' +
          '<div class="hand-info"><b>' + title + '</b><span>' + blinds + '</span></div>' +
          '<nav>' +
            '<button class="icon-btn" data-do="undo" data-hold="1" ' + (undoStack.length ? '' : 'disabled') + ' aria-label="Undo">' + ICONS.undo + '<span class="lbl">Undo</span></button>' +
            '<button class="icon-btn" data-do="redo" data-hold="1" ' + (redoStack.length ? '' : 'disabled') + ' aria-label="Redo">' + ICONS.redo + '<span class="lbl">Redo</span></button>' +
            '<button class="icon-btn" data-do="sheet" data-sheet="log" aria-label="Hand log">' + ICONS.log + '<span class="lbl">Log</span></button>' +
            '<button class="icon-btn" data-do="sheet" data-sheet="players" aria-label="Players and chip counts">' + ICONS.players + '<span class="lbl">Players</span></button>' +
            '<button class="icon-btn" data-do="sheet" data-sheet="menu" aria-label="Menu">' + ICONS.menu + '</button>' +
          '</nav>' +
        '</header>' +
        '<main class="table-area" id="table-area">' +
          '<div class="table" id="table">' +
            '<div class="felt">' + renderCenter() + '</div>' +
            bets + seats +
          '</div>' +
        '</main>' +
        '<footer class="dock"><div class="dock-inner">' + renderRewindBar() + renderDock() + '</div></footer>' +
        (ui.sheet ? renderSheet() : '') +
      '</div>';
  }

  function chipColor(amount) {
    var bb = game.bigBlind;
    if (amount >= bb * 25) return 'c-black';
    if (amount >= bb * 5) return 'c-green';
    if (amount >= bb * 2) return 'c-blue';
    return '';
  }

  function renderSeat(i) {
    var pl = game.players[i];
    var h = game.hand;
    var hp = h && h.p[i];
    var cls = ['seat'];
    var status = '';
    var complete = h && h.phase === 'complete';

    if (!hp || !hp.in) {
      cls.push('out');
      status = pl.sittingOut ? 'Sitting out' : pl.stack === 0 ? 'Out of chips' : 'Next hand';
    } else if (complete) {
      var r = h.results[i];
      if (hp.folded) cls.push('folded');
      if (r.won > 0) {
        cls.push('won');
        status = 'Won ' + fmt(r.won);
      } else if (r.net < 0) {
        status = '<span class="lost">' + signed(r.net) + '</span>';
      } else {
        status = hp.folded ? 'Folded' : '—';
      }
    } else {
      if (hp.folded) { cls.push('folded'); status = 'Folded'; }
      else if (hp.allIn) { cls.push('allin'); status = 'All-in'; }
      else if (h.phase === 'betting' && h.toAct === i) { cls.push('active'); status = 'To act'; }
      else status = hp.last ? esc(hp.last) : '';
    }

    var badges = '';
    if (h && hp && hp.in) {
      if (h.dealer === i) badges += '<span class="badge badge-d" title="Dealer">D</span>';
      if (h.sb === i) badges += '<span class="badge badge-sb" title="Small blind">SB</span>';
      if (h.bb === i) badges += '<span class="badge badge-bb" title="Big blind">BB</span>';
    }

    return '<div class="' + cls.join(' ') + '" data-seat="' + i + '">' +
      (badges ? '<div class="badges">' + badges + '</div>' : '') +
      '<div class="seat-name">' + esc(pl.name) + '</div>' +
      '<div class="seat-stack">' + fmt(pl.stack) + '</div>' +
      '<div class="seat-status">' + status + '</div>' +
    '</div>';
  }

  function boardCount(h) {
    if (!h) return 0;
    return { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 }[h.street] || 0;
  }

  function renderCenter() {
    var h = game.hand;
    var cards = '';
    var dealt = boardCount(h);
    for (var c = 0; c < 5; c++) cards += '<div class="card' + (c < dealt ? ' dealt' : '') + '"></div>';

    if (!h) {
      return '<div class="felt-center"><div class="street-name">Waiting</div><div class="board">' + cards + '</div>' +
        '<div class="center-note">Deal when everyone is ready</div></div>';
    }

    var label, amount, extra = '';
    if (h.phase === 'complete') {
      var pot = h.pots.reduce(function (t, p) { return t + p.amount; }, 0);
      label = 'Hand over';
      amount = '<div class="pot-label">Pot won</div><div class="pot-amount">' + fmt(pot) + '</div>';
    } else {
      label = h.phase === 'showdown' ? 'Showdown' : E.STREET_NAMES[h.street];
      amount = '<div class="pot-label">Pot</div><div class="pot-amount">' + fmt(E.potTotal(game)) + '</div>';
      if (h.phase === 'showdown' && h.pots.length > 1) {
        extra = '<div class="pot-split"><span>' + h.pots.length + ' pots</span></div>';
      }
    }
    return '<div class="felt-center"><div class="street-name">' + label + '</div>' +
      '<div class="board">' + cards + '</div>' + amount + extra + '</div>';
  }

  // ---------- dock ----------

  function renderDock() {
    var h = game.hand;
    if (h && h.phase === 'betting') return ui.raiseOpen ? renderRaise() : renderActions();
    if (h && h.phase === 'showdown') return renderShowdown();
    return renderBetweenHands();
  }

  function renderActions() {
    var la = E.legalActions(game);
    var pl = game.players[la.player];
    var buttons = '';
    if (la.canFold) buttons += '<button class="btn btn-fold" data-do="act" data-type="fold">Fold</button>';
    if (la.canCheck) buttons += '<button class="btn btn-call" data-do="act" data-type="check">Check</button>';
    if (la.canCall) {
      buttons += '<button class="btn btn-call" data-do="act" data-type="call">' + (la.callIsAllIn ? 'Call all-in' : 'Call') +
        '<small>' + fmt(la.callAmount) + '</small></button>';
    }
    if (la.canRaise && la.minTo < la.maxTo) {
      buttons += '<button class="btn btn-raise" data-do="raise-open">' + (la.isBet ? 'Bet' : 'Raise') +
        '<small>' + (la.isBet ? 'from ' : 'to ') + fmt(la.minTo) + '+</small></button>';
    }
    if (la.canRaise) {
      buttons += '<button class="btn btn-allin" data-do="act" data-type="allin">All-in<small>' + fmt(la.stack) + '</small></button>';
    }
    return '<div class="dock-head">' +
        '<div class="actor"><span class="eyebrow">' + esc(E.STREET_NAMES[game.hand.street]) + ' · to act</span><span class="actor-name">' + esc(pl.name) + '</span></div>' +
        '<dl class="facts">' +
          '<div><dt>Stack</dt><dd>' + fmt(la.stack) + '</dd></div>' +
          '<div><dt>To call</dt><dd class="' + (la.toCall ? 'hot' : '') + '">' + fmt(la.toCall) + '</dd></div>' +
          '<div><dt>Pot</dt><dd>' + fmt(la.pot) + '</dd></div>' +
        '</dl>' +
      '</div>' +
      '<div class="actions">' + buttons + '</div>';
  }

  function raisePresets(la) {
    var base = la.pot + la.toCall;
    var make = function (frac) {
      var to = la.isBet ? Math.round(la.pot * frac) : la.currentBet + Math.round(base * frac);
      return Math.min(la.maxTo, Math.max(la.minTo, to));
    };
    return [
      { label: 'Min', to: la.minTo },
      { label: '½ Pot', to: make(0.5) },
      { label: '¾ Pot', to: make(0.75) },
      { label: 'Pot', to: make(1) },
      { label: 'All-in', to: la.maxTo },
    ];
  }

  function renderRaise() {
    var la = E.legalActions(game);
    var pl = game.players[la.player];
    var step = Math.max(1, game.smallBlind);
    var verb = la.isBet ? 'Bet' : 'Raise to';
    var presets = raisePresets(la).map(function (p) {
      return '<button type="button" class="pill" data-do="preset" data-to="' + p.to + '" aria-pressed="' + (p.to === ui.raiseTo) + '">' + p.label + '</button>';
    }).join('');
    return '<div class="dock-head">' +
        '<div class="actor"><span class="eyebrow">' + (la.isBet ? 'Bet' : 'Raise') + ' · ' + esc(pl.name) + '</span>' +
          '<span class="raise-sub" id="raise-sub">' + raiseSub(la, ui.raiseTo) + '</span></div>' +
        '<input class="input" id="raise-input" type="number" inputmode="numeric" min="' + la.minTo + '" max="' + la.maxTo + '" step="1" value="' + ui.raiseTo + '" aria-label="' + verb + ' amount">' +
      '</div>' +
      '<div class="raise-panel">' +
        '<div class="presets-row" id="raise-presets">' + presets + '</div>' +
        '<div class="slider-row">' +
          '<button type="button" data-do="nudge" data-by="' + (-step) + '" aria-label="Less">−</button>' +
          '<input type="range" id="raise-range" min="' + la.minTo + '" max="' + la.maxTo + '" step="1" value="' + ui.raiseTo + '" aria-label="' + verb + ' amount">' +
          '<button type="button" data-do="nudge" data-by="' + step + '" aria-label="More">+</button>' +
        '</div>' +
        '<div class="raise-confirm">' +
          '<button class="btn btn-ghost" data-do="raise-cancel">Back</button>' +
          '<button class="btn btn-raise" data-do="raise-confirm" id="raise-confirm">' + raiseLabel(la, ui.raiseTo) + '</button>' +
        '</div>' +
      '</div>';
  }

  function raiseSub(la, to) {
    return 'Min ' + fmt(la.minTo) + ' · puts in ' + fmt(Math.max(0, to - la.bet)) + ' of ' + fmt(la.stack);
  }

  function raiseLabel(la, to) {
    if (to >= la.maxTo) return 'All-in<small>' + fmt(la.stack) + '</small>';
    return (la.isBet ? 'Bet' : 'Raise to') + '<small>' + fmt(to) + '</small>';
  }

  function syncRaise(value, fromInput) {
    var la = E.legalActions(game);
    if (!la) return;
    var v = Math.round(Number(value));
    if (!Number.isFinite(v)) v = la.minTo;
    var clamped = Math.min(la.maxTo, Math.max(la.minTo, v));
    ui.raiseTo = clamped;
    var input = document.getElementById('raise-input');
    var range = document.getElementById('raise-range');
    if (input && !fromInput) input.value = clamped;
    if (range) range.value = clamped;
    var sub = document.getElementById('raise-sub');
    if (sub) sub.innerHTML = raiseSub(la, clamped);
    var btn = document.getElementById('raise-confirm');
    if (btn) btn.innerHTML = raiseLabel(la, clamped);
    var pills = document.querySelectorAll('#raise-presets .pill');
    Array.prototype.forEach.call(pills, function (p) { p.setAttribute('aria-pressed', String(Number(p.dataset.to) === clamped)); });
  }

  function ensureWinners() {
    var h = game.hand;
    var key = h.number + ':' + h.pots.length;
    if (ui.winnersFor !== key) {
      ui.winnersFor = key;
      ui.winners = h.pots.map(function (p) { return p.eligible.length === 1 ? [p.eligible[0]] : []; });
    }
  }

  function renderShowdown() {
    var h = game.hand;
    ensureWinners();
    var note = '';
    if (h.runout) {
      var names = h.runout.map(function (s) { return E.STREET_NAMES[s].toLowerCase(); });
      var list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
      note = '<p class="runout-note">No more betting possible. Deal the ' + list + ', then pick the winner.</p>';
    }
    var picks = h.pots.map(function (pot, k) {
      var body;
      if (pot.eligible.length === 1) {
        body = '<p class="hint">Only ' + esc(game.players[pot.eligible[0]].name) + ' is in this pot, so it goes straight back to them.</p>';
      } else {
        body = '<div class="pick-row">' + pot.eligible.map(function (i) {
          var on = ui.winners[k].indexOf(i) !== -1;
          return '<button type="button" class="pick" data-do="pick" data-pot="' + k + '" data-player="' + i + '" aria-pressed="' + on + '">' + esc(game.players[i].name) + '</button>';
        }).join('') + '</div>';
      }
      return '<div class="pot-pick"><div class="pot-pick-head"><span>' + esc(pot.label) + '</span><b>' + fmt(pot.amount) + '</b></div>' + body + '</div>';
    }).join('');
    var ready = ui.winners.every(function (w) { return w.length > 0; });
    return '<div class="dock-head"><div class="actor"><span class="eyebrow">Showdown</span><span class="actor-name">Who won?</span></div></div>' +
      note +
      '<div class="pot-picks">' + picks + '</div>' +
      '<p class="hint">Tap more than one player to split a pot.</p>' +
      '<button class="btn btn-raise btn-big" data-do="award" ' + (ready ? '' : 'disabled') + '>Award chips</button>';
  }

  function renderBetweenHands() {
    var h = game.hand;
    var out = '';
    if (h && h.phase === 'complete') {
      var winners = [];
      h.results.forEach(function (r, i) { if (r.won > 0) winners.push(i); });
      var title = winners.length === 1
        ? esc(game.players[winners[0]].name) + ' wins ' + fmt(h.results[winners[0]].won)
        : winners.map(function (i) { return esc(game.players[i].name) + ' ' + fmt(h.results[i].won); }).join(' · ');
      var nets = '';
      h.p.forEach(function (hp, i) {
        if (!hp.in) return;
        var net = h.results[i].net;
        nets += '<span class="net">' + esc(game.players[i].name) + '<b class="' + (net > 0 ? 'up' : net < 0 ? 'down' : '') + '">' + signed(net) + '</b></span>';
      });
      out += '<div class="results"><span class="eyebrow">Hand ' + h.number + ' result</span>' +
        '<div class="results-title">' + title + '</div></div>' +
        '<div class="nets">' + nets + '</div>';
    }

    var busted = [];
    game.players.forEach(function (pl, i) { if (pl.stack === 0) busted.push(i); });
    busted.forEach(function (i) {
      out += '<div class="busted-row"><span>' + esc(game.players[i].name) + ' is out of chips.</span>' +
        '<button class="mini gold" data-do="rebuy" data-player="' + i + '" data-amount="' + game.startingStack + '">Rebuy ' + fmt(game.startingStack) + '</button></div>';
    });

    var withChips = game.players.filter(function (p) { return p.stack > 0; });
    if (E.playersWithChips(game) < 2 && withChips.length >= 2) {
      out += '<p class="note">At least two players with chips need to be sitting in. Open Players to sit someone back in.</p>' +
        '<div class="dock-actions"><button class="btn btn-ghost" data-do="sheet" data-sheet="players">Players</button></div>';
    } else if (withChips.length < 2) {
      var leader = withChips[0] || game.players[0];
      out += '<div class="results"><span class="eyebrow">Game over</span><div class="results-title">' + esc(leader.name) + ' has every chip on the table</div></div>' +
        '<div class="dock-actions"><button class="btn btn-ghost" data-do="sheet" data-sheet="menu">Start a new game</button></div>';
    } else {
      out += '<div class="dock-actions"><button class="btn btn-raise btn-big" data-do="deal">Deal hand ' + (game.handNumber + 1) + '</button></div>';
    }
    return out;
  }

  // ---------- sheets ----------

  function renderSheet() {
    var title, body;
    if (ui.sheet === 'log') { title = 'Hand log'; body = renderLog(); }
    else if (ui.sheet === 'players') { title = 'Players'; body = renderPlayers(); }
    else { title = 'Menu'; body = renderMenu(); }
    return '<div class="sheet-backdrop" data-do="close-sheet" data-self="1">' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + title + '">' +
        '<div class="sheet-head"><h2>' + title + '</h2><button class="close-btn" data-do="close-sheet" aria-label="Close">×</button></div>' +
        '<div class="sheet-body" id="sheet-body">' + body + '</div>' +
      '</div></div>';
  }

  function renderLog() {
    var h = game.hand;
    var out = '';
    if (h) {
      var groups = [];
      h.log.forEach(function (entry) {
        var g = groups[groups.length - 1];
        if (!g || g.street !== entry.street) groups.push(g = { street: entry.street, items: [] });
        g.items.push(entry);
      });
      out += '<div class="log-street"><h3>Hand ' + h.number + '</h3></div>';
      groups.forEach(function (g) {
        out += '<div class="log-street"><span class="eyebrow">' + esc(E.STREET_NAMES[g.street] || g.street) + '</span><ol>' +
          g.items.map(function (e) {
            return '<li>' + (e.who ? '<b>' + esc(e.who) + '</b> ' : '') + esc(e.text) + '</li>';
          }).join('') + '</ol></div>';
      });
    }
    var past = game.history.filter(function (x) { return !h || x.number !== h.number || h.phase === 'complete'; });
    if (past.length) {
      out += '<div class="log-street"><h3>Earlier hands</h3><ol class="history">' + past.map(function (x) {
        var who = x.winners.map(function (w) { return esc(w.name) + ' ' + fmt(w.amount); }).join(', ');
        return '<li><span class="hn">#' + x.number + '</span><span>' + who + '</span><span class="he">' + esc(x.ended) + '</span></li>';
      }).join('') + '</ol></div>';
    }
    return out || '<p class="hint">Nothing has happened yet.</p>';
  }

  function renderPlayers() {
    var h = game.hand;
    var between = !h || h.phase === 'complete';
    var rows = game.players.map(function (pl, i) {
      var net = pl.stack - pl.buyIn;
      if (h && h.phase !== 'complete') net += h.p[i].total; // chips in the pot are still theirs until it's won
      var actions = '';
      if (between) {
        actions = '<div class="roster-actions">' +
          '<button class="mini gold" data-do="rebuy" data-player="' + i + '">Add chips</button>' +
          '<button class="mini" data-do="sitout" data-player="' + i + '">' + (pl.sittingOut ? 'Sit in' : 'Sit out') + '</button>' +
          '<button class="mini" data-do="dealer" data-player="' + i + '">Give button</button>' +
          '<button class="mini danger" data-do="remove" data-player="' + i + '"' + (game.players.length <= 2 ? ' disabled' : '') + '>Remove</button>' +
        '</div>';
      }
      var tags = [];
      if (pl.sittingOut) tags.push('sitting out');
      if (between && game.buttonSet && game.dealer === i) tags.push('deals next');
      return '<div class="roster-row">' +
        '<div><div class="roster-name">' + esc(pl.name) + '</div>' +
          '<div class="roster-meta">Bought in ' + fmt(pl.buyIn) + ' · <span class="' + (net > 0 ? 'up' : net < 0 ? 'down' : '') + '">' + signed(net) + '</span>' +
          (tags.length ? ' · ' + tags.join(', ') : '') + '</div></div>' +
        '<div class="roster-stack"><b>' + fmt(pl.stack) + '</b>' +
          (h && h.phase !== 'complete' && h.p[i].total ? '<span class="roster-meta">' + fmt(h.p[i].total) + ' in pot</span>' : '') + '</div>' +
        actions +
      '</div>';
    }).join('');

    var inPlay = E.chipsInPlay(game);
    var bought = E.totalBuyIns(game);
    var out = '<div class="balance"><span>' + fmt(inPlay) + ' chips in play from ' + fmt(bought) + ' bought in</span>' +
      (inPlay === bought ? '<span class="ok">✓ balanced</span>' : '') + '</div>';

    if (between) {
      out += '<div class="field"><label for="rebuy-amount">Amount for “Add chips”</label>' +
        '<input class="input" id="rebuy-amount" type="number" inputmode="numeric" min="1" step="1" value="' + game.startingStack + '"></div>';
    } else {
      out += '<p class="note">Add chips, seat or remove players, move the button and change blinds between hands.</p>';
    }
    out += '<div class="roster">' + rows + '</div>';

    if (between) {
      out += '<div class="field-group"><h3>Blinds</h3><div class="inline-form">' +
          '<div class="field"><label for="nb-sb">Small</label><input class="input" id="nb-sb" type="number" inputmode="numeric" min="1" value="' + game.smallBlind + '"></div>' +
          '<div class="field"><label for="nb-bb">Big</label><input class="input" id="nb-bb" type="number" inputmode="numeric" min="1" value="' + game.bigBlind + '"></div>' +
          '<div class="field"><label for="nb-ante">Ante</label><input class="input" id="nb-ante" type="number" inputmode="numeric" min="0" value="' + game.ante + '"></div>' +
          '<button class="btn btn-ghost" data-do="set-blinds">Update</button>' +
        '</div></div>';
      if (game.players.length < E.MAX_PLAYERS) {
        out += '<div class="field-group"><h3>Add a player</h3><div class="inline-form">' +
            '<div class="field"><label for="np-name">Name</label><input class="input" id="np-name" maxlength="16" autocomplete="off" placeholder="Name"></div>' +
            '<div class="field"><label for="np-stack">Chips</label><input class="input" id="np-stack" type="number" inputmode="numeric" min="1" value="' + game.startingStack + '"></div>' +
            '<button class="btn btn-ghost" data-do="add-player">Add</button>' +
          '</div><p class="hint">New players sit in the last seat, to the right of ' + esc(game.players[0].name) + '.</p></div>';
      }
    }
    return out;
  }

  function renderMenu() {
    var out = '';
    if (ui.confirmNew) {
      out += '<div class="confirm-box"><b>End this game?</b><span class="hint">Every stack and the hand history will be cleared.</span>' +
        '<div class="row"><button class="btn btn-ghost" data-do="new-cancel">Keep playing</button>' +
        '<button class="btn btn-fold" data-do="new-game">End game</button></div></div>';
    } else {
      out += '<button class="btn btn-ghost btn-big" data-do="new-ask">New game</button>';
    }
    if (game.hand && undoStack.length && handOf(undoStack[undoStack.length - 1]) === game.hand.number) {
      out += '<button class="btn btn-ghost btn-big" data-do="hand-start">Rewind to start of hand ' + game.hand.number + '</button>';
    }
    out += '<div class="field-group"><h3>How the math works</h3><ul class="rules">' +
      '<li>Blinds post automatically and the button moves one seat each hand. Heads-up, the dealer posts the small blind.</li>' +
      '<li>A raise must be at least the size of the last full bet or raise. An all-in for less doesn’t reopen betting for players who already acted.</li>' +
      '<li>Any part of a bet nobody can call goes straight back to the bettor.</li>' +
      '<li>When someone is all-in, the pot is split into a main pot and side pots. Each player can only win what they matched.</li>' +
      '<li>Split pots are shared evenly; an odd chip goes to the winner closest to the left of the button.</li>' +
      '<li>Made a mistake? Undo steps back one action at a time, right back to the start of the hand and beyond, restoring every stack and bet exactly. Hold Undo or Redo to move quickly. Redo, or Latest, brings everything back as long as you haven’t taken a new action since.</li>' +
      '</ul></div>';
    return out;
  }

  // ---------- table geometry ----------

  // Seat angles evenly spaced by distance around the oval, seat 1 at the bottom, going clockwise.
  function ovalAngles(n, rx, ry) {
    var N = 720, pts = [], total = 0, prevX = 0, prevY = ry;
    for (var k = 0; k <= N; k++) {
      var t = Math.PI / 2 + (2 * Math.PI * k) / N;
      var x = Math.cos(t) * rx, y = Math.sin(t) * ry;
      if (k > 0) total += Math.hypot(x - prevX, y - prevY);
      pts.push({ t: t, len: total });
      prevX = x; prevY = y;
    }
    var out = [], j = 0;
    for (var s = 0; s < n; s++) {
      var target = (total * s) / n;
      while (j < N && pts[j + 1].len < target) j++;
      out.push(pts[j].t);
    }
    return out;
  }

  function layoutTable() {
    var area = document.getElementById('table-area');
    var table = document.getElementById('table');
    if (!area || !table) return;
    var W = area.clientWidth, H = area.clientHeight;
    var n = game.players.length;
    var portrait = W < H * 1.05;
    var seatW = Math.round(Math.max(76, Math.min(118, (portrait ? W : W * 0.6) / (n > 6 ? 4.6 : 3.9))));
    var padX = seatW / 2 + 6, padY = 38;
    var availW = Math.max(120, W - padX * 2), availH = Math.max(120, H - padY * 2);
    // Stretch the oval to the space available, within sensible proportions.
    var ratio = portrait
      ? Math.max(0.5, Math.min(0.8, availW / availH))
      : Math.max(1.35, Math.min(2.1, availW / availH));
    var tw = availW, th = tw / ratio;
    if (th > availH) { th = availH; tw = th * ratio; }
    table.style.width = tw + 'px';
    table.style.height = th + 'px';
    table.style.left = (W - tw) / 2 + 'px';
    table.style.top = (H - th) / 2 + 'px';
    var minSide = Math.min(tw, th);
    table.style.setProperty('--rail-w', Math.round(Math.max(12, Math.min(26, minSide * 0.05))) + 'px');
    table.style.setProperty('--seat-w', seatW + 'px');
    table.style.setProperty('--card-w', Math.round(Math.max(18, Math.min(34, minSide * 0.075))) + 'px');
    table.style.setProperty('--pot-size', Math.round(Math.max(22, Math.min(40, minSide * 0.09))) + 'px');

    var angles = ovalAngles(n, tw / 2, th / 2);
    angles.forEach(function (t, i) {
      var sx = Math.cos(t) * tw * 0.49, sy = Math.sin(t) * th * 0.49; // seat centre, px from table centre
      var seat = table.querySelector('[data-seat="' + i + '"]');
      if (!seat) return;
      seat.style.left = tw / 2 + sx + 'px';
      seat.style.top = th / 2 + sy + 'px';
      var bet = table.querySelector('[data-bet="' + i + '"]');
      if (bet) {
        // Slide from the seat toward the centre until the chips clear the seat plaque.
        var d = Math.hypot(sx, sy) || 1;
        var ux = -sx / d, uy = -sy / d;
        var hw = seat.offsetWidth / 2 + bet.offsetWidth / 2 + 6;
        var hh = seat.offsetHeight / 2 + bet.offsetHeight / 2 + 6;
        var clear = Math.min(Math.abs(ux) > 0.01 ? hw / Math.abs(ux) : Infinity, Math.abs(uy) > 0.01 ? hh / Math.abs(uy) : Infinity);
        clear = Math.min(clear, d * 0.7);
        bet.style.left = tw / 2 + sx + ux * clear + 'px';
        bet.style.top = th / 2 + sy + uy * clear + 'px';
      }
    });
  }

  // ---------- render ----------

  function render() {
    var sheetBody = document.getElementById('sheet-body');
    var scroll = sheetBody ? sheetBody.scrollTop : 0;
    if (!game) {
      renderSetup();
      return;
    }
    renderTable();
    // While Undo/Redo is held down, keep the same button element on screen so the
    // finger-up event still reaches it after the rest of the page is redrawn.
    if (hold) {
      var fresh = app.querySelector('[data-hold][data-do="' + hold.action + '"]');
      if (fresh) {
        hold.el.disabled = fresh.disabled;
        fresh.replaceWith(hold.el);
      }
    }
    layoutTable();
    var nb = document.getElementById('sheet-body');
    if (nb) nb.scrollTop = scroll;
  }

  // ---------- events ----------

  function numberFrom(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  var handlers = {
    // setup
    count: function (d) {
      setup.count = Math.min(E.MAX_PLAYERS, Math.max(2, setup.count + Number(d.by)));
      if (setup.dealer >= setup.count) setup.dealer = 0;
      render();
    },

    // betting
    act: function (d) { commit(function (g) { E.act(g, { type: d.type }); }); },
    'raise-open': function () {
      var la = E.legalActions(game);
      ui.raiseOpen = true;
      ui.raiseTo = la.minTo;
      render();
    },
    'raise-cancel': function () { ui.raiseOpen = false; render(); },
    preset: function (d) { syncRaise(d.to); },
    nudge: function (d) { syncRaise(ui.raiseTo + Number(d.by)); },
    'raise-confirm': function () {
      var la = E.legalActions(game);
      var to = ui.raiseTo;
      commit(function (g) { E.act(g, { type: la.isBet ? 'bet' : 'raise', amount: to }); });
    },

    // showdown
    pick: function (d) {
      var k = Number(d.pot), i = Number(d.player);
      var list = ui.winners[k];
      var at = list.indexOf(i);
      if (at === -1) list.push(i); else list.splice(at, 1);
      // Whoever wins a pot also wins every smaller side pot they are part of.
      var pots = game.hand.pots;
      if (list.length) {
        for (var j = k + 1; j < pots.length; j++) {
          var all = list.every(function (w) { return pots[j].eligible.indexOf(w) !== -1; });
          if (all) ui.winners[j] = list.slice();
        }
      }
      render();
    },
    award: function () {
      var winners = ui.winners.map(function (w) { return w.slice(); });
      commit(function (g) { E.awardPots(g, winners); });
    },
    deal: function () { commit(E.startHand); },

    // menus
    undo: undo,
    redo: redo,
    'redo-all': redoAll,
    'hand-start': function () { ui.sheet = null; rewindToHandStart(); },
    sheet: function (d) { ui.sheet = d.sheet; ui.confirmNew = false; render(); },
    'close-sheet': function (d, el, e) {
      if (d.self && e.target !== el) return;
      ui.sheet = null;
      render();
    },
    'new-ask': function () { ui.confirmNew = true; render(); },
    'new-cancel': function () { ui.confirmNew = false; render(); },
    'new-game': function () {
      if (game) {
        setup.count = game.players.length;
        setup.names = game.players.map(function (p) { return p.name; });
        setup.sb = game.smallBlind;
        setup.bb = game.bigBlind;
        setup.ante = game.ante;
        setup.stack = game.startingStack;
      }
      game = null;
      undoStack = [];
      redoStack = [];
      ui.sheet = null;
      ui.confirmNew = false;
      save();
      render();
      window.scrollTo(0, 0);
    },

    // table management
    rebuy: function (d) {
      var i = Number(d.player);
      var amount = d.amount || numberFrom('rebuy-amount') || game.startingStack;
      var name = game.players[i].name;
      if (commit(function (g) { E.rebuy(g, i, amount); })) toast(name + ' added ' + fmt(amount) + ' chips', 'info');
    },
    sitout: function (d) { var i = Number(d.player); commit(function (g) { E.setSittingOut(g, i, !g.players[i].sittingOut); }); },
    dealer: function (d) {
      var i = Number(d.player);
      if (commit(function (g) { E.setDealer(g, i); })) toast(game.players[i].name + ' deals the next hand', 'info');
    },
    remove: function (d) {
      var i = Number(d.player);
      var name = game.players[i].name;
      if (commit(function (g) { E.removePlayer(g, i); })) toast(name + ' left the table — Undo brings them back', 'info');
    },
    'add-player': function () {
      var name = numberFrom('np-name').trim();
      var stack = numberFrom('np-stack');
      if (!name) return toast('Enter a name for the new player');
      var taken = game.players.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); });
      if (taken) return toast(name + ' is already at the table');
      if (commit(function (g) { E.addPlayer(g, name, stack); })) toast(name + ' joined the table', 'info');
    },
    'set-blinds': function () {
      var sb = numberFrom('nb-sb'), bb = numberFrom('nb-bb'), ante = numberFrom('nb-ante');
      if (commit(function (g) { E.setBlinds(g, sb, bb, ante); })) toast('Blinds are now ' + fmt(sb) + ' / ' + fmt(bb), 'info');
    },
  };

  // ---------- hold Undo / Redo to repeat ----------

  var hold = null; // { action, el, timer, steps }

  function holdStep() {
    if (!hold) return;
    var moved = hold.action === 'undo' ? undo(true) : redo(true);
    if (!moved) return endHold();
    hold.steps++;
    // Start at 3 steps a second and speed up to about 12 a second.
    var delay = hold.steps === 1 ? 450 : Math.max(80, 260 - hold.steps * 25);
    hold.timer = setTimeout(holdStep, delay);
  }

  function endHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    var steps = hold.steps;
    var action = hold.action;
    hold = null;
    save();
    render();
    if (steps > 1) toast((action === 'undo' ? 'Went back ' : 'Went forward ') + steps + ' steps', 'info');
  }

  function startHold(el, input) {
    if (hold) endHold();
    hold = { action: el.dataset.do, el: el, timer: null, steps: 0, input: input };
    holdStep();
  }

  // Touch screens: handle the raw touch so iOS can't turn a long press into
  // text selection, a callout menu or a cancelled gesture.
  app.addEventListener('touchstart', function (e) {
    var el = e.target.closest('[data-hold]');
    if (!el || el.disabled) return;
    e.preventDefault();
    startHold(el, 'touch');
  }, { passive: false });
  ['touchend', 'touchcancel'].forEach(function (type) {
    document.addEventListener(type, function () { if (hold && hold.input === 'touch') endHold(); });
  });

  // Mouse and pen.
  app.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch') return;
    var el = e.target.closest('[data-hold]');
    if (!el || el.disabled || e.button !== 0) return;
    e.preventDefault();
    startHold(el, 'pointer');
  });
  ['pointerup', 'pointercancel'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (hold && hold.input === 'pointer' && e.pointerType !== 'touch') endHold();
    });
  });
  window.addEventListener('blur', endHold);
  document.addEventListener('visibilitychange', endHold);
  app.addEventListener('contextmenu', function (e) {
    if (e.target.closest('[data-hold]')) e.preventDefault();
  });

  // iPhone Safari can still zoom on a quick double tap. If two taps land
  // within 350ms, cancel the second one's zoom and deliver it as a normal tap.
  var lastTouchEnd = 0;
  document.addEventListener('touchend', function (e) {
    var now = Date.now();
    var quick = now - lastTouchEnd < 350;
    lastTouchEnd = now;
    if (!quick || e.touches.length || e.changedTouches.length !== 1) return;
    var t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (!t || t.closest('input, select, textarea, [data-hold]')) return;
    e.preventDefault();
    var tap = t.closest('button, label, a, [data-do]');
    if (tap && !tap.disabled) tap.click();
  }, { passive: false });

  app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-do]');
    if (!el || el.disabled) return;
    // Taps on Undo/Redo are handled on pointerdown; keyboard presses (detail 0) still come through here.
    if (el.dataset.hold && e.detail !== 0) return;
    var fn = handlers[el.dataset.do];
    if (fn) fn(el.dataset, el, e);
  });

  app.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'setup-form') startGame();
  });

  app.addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset.name !== undefined) {
      setup.names[Number(t.dataset.name)] = t.value.trim();
      var opt = document.querySelector('#dealer option[value="' + t.dataset.name + '"]');
      if (opt) opt.textContent = t.value.trim() || 'Player ' + (Number(t.dataset.name) + 1);
      return;
    }
    var key = t.dataset.setup;
    if (key) {
      setup[key] = t.value === '' ? '' : Number(t.value);
      if (key === 'sb' && !setup.bbTouched && setup.sb > 0) {
        setup.bb = setup.sb * 2;
        document.getElementById('bb').value = setup.bb;
      }
      if (key === 'bb') setup.bbTouched = true;
      var depth = document.getElementById('depth');
      if (depth) depth.innerHTML = depthText();
      return;
    }
    if (t.id === 'raise-range') syncRaise(t.value);
    if (t.id === 'raise-input' && t.value !== '') {
      var la = E.legalActions(game);
      var v = Number(t.value);
      if (la && v >= la.minTo && v <= la.maxTo) syncRaise(v, true);
    }
  });

  app.addEventListener('change', function (e) {
    if (e.target.id === 'raise-input') syncRaise(e.target.value);
  });

  app.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'raise-input') {
      e.preventDefault();
      syncRaise(e.target.value);
      handlers['raise-confirm']();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ui.sheet) {
      ui.sheet = null;
      render();
    }
  });

  window.addEventListener('resize', function () { if (game) layoutTable(); });

  // Keep the phone screen awake during a game, where the browser allows it.
  var wakeLock = null;
  function keepAwake() {
    if (!game || wakeLock || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { /* not allowed here */ });
  }
  document.addEventListener('pointerdown', keepAwake);
  document.addEventListener('visibilitychange', keepAwake);

  // Installable app: cache the files so the tracker works offline.
  // When a new version is published, switch to it straight away. The game is
  // saved on the device, so reloading loses nothing.
  if ('serviceWorker' in navigator && /^https:|^http:\/\/localhost/.test(location.href)) {
    var hadController = !!navigator.serviceWorker.controller;
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloaded || hold) { hadController = true; return; }
      reloaded = true;
      location.reload();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') reg.update().catch(function () {});
        });
      }).catch(function () { /* not available here */ });
    });
  }

  load();
  render();
})();
