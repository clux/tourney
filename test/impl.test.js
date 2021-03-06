var Tourney = require('..')
  , $ = require('interlude')
  , Tournament = require('tournament')
  , Id = Tourney.Id
  , test = require('bandage');

var tid = (t, s, r, m) => new Id(t, {s, r, m});

// a silly tournament implementation to test Tourney with
var Challenge = Tournament.sub('Challenge', function (opts, initParent) {
  var ms = [];
  for (var i = 0; i < this.numPlayers/2; i += 1) {
    ms.push({ id: { s: 1, r: 1, m: i+1}, p: [2*i+1, 2*i+2] });
  }
  initParent(ms);
});
Challenge.configure({
  invalid: function (np) {
    if (np % 2 !== 0) {
      return 'Challenge can only have a multiple of two players';
    }
    return null;
  }
});
Challenge.prototype._stats = function (res, m) {
  if (m.m && m.m[0] !== m.m[1]) {
    var w = (m.m[0] > m.m[1]) ? m.p[0] : m.p[1];
    var l = (m.m[0] > m.m[1]) ? m.p[1] : m.p[0];
    Tournament.resultEntry(res, w).pos = 1;
    Tournament.resultEntry(res, l).pos = this.numPlayers/2 + 1;
  }
  return res;
};
Challenge.prototype._verify = function (m, score) {
  if (score[0] === score[1]) {
    return 'cannot draw match';
  }
  return null;
};
Challenge.prototype._safe = $.constant(true); // always allow rescore while in stage

// create a Tourney that runs 2 challenges
var Trn = Tourney.sub('Trn', function (opts, initParent) {
  Object.defineProperty(this, 'stages', { value: opts.stages });
  initParent(new Challenge(this.numPlayers, opts));
});
Trn.configure({
  defaults: function (np, opts) {
    opts.stages = (opts.stages | 0) ? (opts.stages | 0): 2;
    return opts;
  },
  invalid: function (np, opts) {
    return Challenge.invalid(np, opts);
  }
});
Trn.prototype._mustPropagate = function (stg) {
  return (stg < this.stages);
};
Trn.prototype._createNext = function () {
  return Challenge.from(this._inst, this.numPlayers / 2);
};

test('challengeChain', function *(t) {
  t.eq(Trn.invalid(7), 'Challenge can only have a multiple of two players', 'in');
  var errorCalls = 0; // verify that we get 1 error call further down
  var errorLog = () => { errorCalls += 1; };
  var trn = new Trn(8, { log: { error: errorLog }}); // by defaults, a 2-stage
  t.ok(trn._inst instanceof Challenge, 'Trn made a Challenge instance');

  t.eq(trn.oldMatches.length, 0, 'no cached the matches yet');
  t.eq(trn.matches.length, 4, 'matches');
  t.eq(trn.matches.map($.get('p')),
    [ [1,2], [3,4], [5,6], [7,8] ],
    'match players contents'
  );
  t.eq(trn.findMatch({s: 1, r: 1, m: 4}), $.last(trn.matches), 'findMatch');
  t.eq(trn.findMatches({r: 1}), trn.matches, 'findMatches');

  t.ok(!trn.stageDone(), 'stage not done yet - can not createNextStage');
  t.throws(trn.createNextStage, /cannot start next stage/, 'createNextStage throws');

  t.eq(trn.players(), $.range(8), 'players');
  trn.matches.forEach(function (m) {
    t.ok(trn.score(m.id, [0, 1]), 'score lowest seed winning t1');
  });

  t.ok(trn.stageDone(), 'challenge 1/2 stage complete');
  t.throws(trn.complete, /cannot complete a tourney/, 'complete throws');

  t.ok(trn.createNextStage(), 'could create next stage');
  t.ok(!trn.isDone(), 'but not yet done');

  t.ok(trn._inst instanceof Challenge, 'Trn made another Challenge instance');
  t.eq(trn.oldMatches.length, 4, 'cached the matches from first Challenge');

  t.eq(trn.players(), [2,4,6,8], 'winners forwarded');

  trn.matches.forEach(function (m) {
    t.ok(trn.score(m.id, [0,1]), 'score lowest seed winning t2');
  });

  t.ok(trn.stageDone(), 'challenge 2 stage complete');
  t.ok(!trn.createNextStage(), 'could not create any more stages - complete');

  t.ok(trn.isDone(), 'tourney done');
  var t2m1 = { s: 1, r: 1, m: 1 };
  t.ok(trn.score(t2m1, [0,2]), 'can still rescore without past access');
  t.eq(trn.unscorable(t2m1, [0, 2]), null, 'unscorable is slave to _safe');
  trn.complete(); // seal it

  t.eq(trn.oldMatches.length, 4+2, 'everything saved here now');
  t.eq(trn.matches.length, 0, 'and nothing left');

  // scoring now would log if we hadn't voided it - verify that it worked
  t.eq(errorCalls, 0, 'nothing bad yet');
  t.ok(!trn.score({s: 1, r: 1, m: 1}, [1,0]), 'cannot rescore now');
  t.eq(errorCalls, 1, 'got error event');

  t.eq(trn.oldMatches, [
    // stage 1
    { id: tid(1, 1, 1, 1), p: [1,2], m: [0,1] },
    { id: tid(1, 1, 1, 2), p: [3,4], m: [0,1] },
    { id: tid(1, 1, 1, 3), p: [5,6], m: [0,1] },
    { id: tid(1, 1, 1, 4), p: [7,8], m: [0,1] },
    // stage 2
    { id: tid(2, 1, 1, 1), p: [2,4], m: [0,2] }, // was rescored
    { id: tid(2, 1, 1, 2), p: [6,8], m: [0,1] }],
    'full match verification'
  );

  // verify results are sensible
  var expRes = [
    { seed: 4, wins: 0, for: 0, against: 0, pos: 1 },
    { seed: 8, wins: 0, for: 0, against: 0, pos: 1 },
    { seed: 2, wins: 0, for: 0, against: 0, pos: 3 },
    { seed: 6, wins: 0, for: 0, against: 0, pos: 3 },
    { seed: 1, wins: 0, for: 0, against: 0, pos: 5 },
    { seed: 3, wins: 0, for: 0, against: 0, pos: 5 },
    { seed: 5, wins: 0, for: 0, against: 0, pos: 5 },
    { seed: 7, wins: 0, for: 0, against: 0, pos: 5 }
  ];
  t.eq(trn.results(), expRes, 'full results verification');

  // verify that we can chain this into another Tourney
  var from = Trn.from(trn, 2, { stages: 1 }); // explicity specify a 1-stage
  t.eq(from.players(), [4,8], 'forwarded the top 2 from Tourney');
  t.eq(trn.upcoming(4), trn.matches, '4 is in the final');
  t.eq(from.matches[0].p, [4,8], 'and they are in m1');
  t.ok(from.score(from.matches[0].id, [1, 0]), 'score final');
  t.ok(from.isDone(), 'and it is done');
  from.complete();

  // verify results have been updated where it counts
  expRes[1].pos = 2;
  t.eq(from.results(), expRes, 'from results verification');

  // Ensure Matches in oldMatches are all Tourney style Ids with their own toString
  t.eq(from.oldMatches.length, 1, 'one match in this tourney'); // TODO: copy old?
  t.eq($.last(from.oldMatches).id + '', 'T1 S1 R1 M1', 'id relative to this trn');
});

test('emitter', function *(t) {
  var trn = new Trn(8); // by defaults, a 2-stage
  trn.matches.forEach(function (m) {
    t.ok(trn.score(m.id, [0, 1]), 'score t1');
  });
  t.ok(trn.createNextStage(), 'could create next stage');
  trn.matches.forEach(function (m) {
    t.ok(trn.score(m.id, [1,0]), 'score t2');
  });
  trn.complete();

  t.eq(trn.state, [
    { type: 'score', id: { s: 1, r: 1, m: 1 }, score: [0,1] },
    { type: 'score', id: { s: 1, r: 1, m: 2 }, score: [0,1] },
    { type: 'score', id: { s: 1, r: 1, m: 3 }, score: [0,1] },
    { type: 'score', id: { s: 1, r: 1, m: 4 }, score: [0,1] },
    { type: 'next' },
    { type: 'score', id: { s: 1, r: 1, m: 1 }, score: [1,0] },
    { type: 'score', id: { s: 1, r: 1, m: 2 }, score: [1,0] },
    { type: 'done' }],
    'everything captured'
  );

  var trn2 = Trn.restore(8, {}, trn.state);
  t.eq(trn2.oldMatches, trn.oldMatches, 'restored from state');
});

test('errorLog voided', function *(t) {
  t.plan(2); // failed scoring + reason
  var errlog = function () {
    t.pass('error log called');
  };
  var trn = new Trn(8, { log: { error: errlog }});
  trn.score(trn.matches[0].id, [1,1]);
});

test('errorLog stderr', function *(t) {
  t.pass('stderr messages should be next to this');
  var trn = new Trn(8);
  trn.score(trn.matches[0].id, [1,1]);
});
