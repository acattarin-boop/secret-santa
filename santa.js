// Secret Santa: settings, draw rules, and link sealing. Used by index.html and setup.html.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Santa = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Settings you can change at any time. Links do not need to be resent. ----
  var EVENT = {
    year: 2026,
    date: 'December 28',
    time: '10:36 AM',                 // Add the time here, for example '4:00 PM'
    place: 'Cattarin House',
    adultLimit: 'No limit',
    childLimit: 'No limit',
    organizer: 'Alec'
  };

  // ---- Who is in the draw. Nobody draws a person from their own household. ----
  var FAMILY = [
    { adults: ['Alec', 'Victoria'], children: ['Tristan', 'Claire'] },
    { adults: ['Nate', 'Lacey'], children: ['Juliet', 'Emilie'] },
    { adults: ['Stefan', 'Sarah'], children: ['Jayla', 'Harper', 'Skylar', 'Lincoln'] },
    { adults: ['Mark', 'Randi'], children: [] }
  ];

  // Same household shape as FAMILY, with made-up names for the test run.
  var TEST_FAMILY = [
    { adults: ['Dasher', 'Dancer'], children: ['Holly', 'Ivy'] },
    { adults: ['Prancer', 'Vixen'], children: ['Noel', 'Jingle'] },
    { adults: ['Comet', 'Cupid'], children: ['Tinsel', 'Pepper', 'Sugar', 'Snowball'] },
    { adults: ['Donner', 'Blitzen'], children: [] }
  ];

  function adultsOf(family) {
    return family.reduce(function (all, home) { return all.concat(home.adults); }, []);
  }

  function childrenOf(family) {
    return family.reduce(function (all, home) { return all.concat(home.children); }, []);
  }

  function homeIndex(family, name) {
    for (var i = 0; i < family.length; i++) {
      if (family[i].adults.indexOf(name) !== -1 || family[i].children.indexOf(name) !== -1) return i;
    }
    return -1;
  }

  // Unbiased random whole number from 0 up to, but not including, max.
  function randomBelow(max) {
    var limit = Math.floor(0x100000000 / max) * max;
    var value = new Uint32Array(1);
    do { crypto.getRandomValues(value); } while (value[0] >= limit);
    return value[0] % max;
  }

  function shuffled(list) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = randomBelow(i + 1);
      var held = copy[i];
      copy[i] = copy[j];
      copy[j] = held;
    }
    return copy;
  }

  // Reshuffles until no adult has someone from their own household.
  // Every valid arrangement is equally likely.
  function validShuffle(family, givers, people) {
    for (var attempt = 0; attempt < 100000; attempt++) {
      var candidate = shuffled(people);
      var ok = givers.every(function (giver, i) {
        return homeIndex(family, giver) !== homeIndex(family, candidate[i]);
      });
      if (ok) return candidate;
    }
    throw new Error('No valid draw was found.');
  }

  function createDraw(family) {
    var givers = adultsOf(family);
    var adults = validShuffle(family, givers, adultsOf(family));
    var children = validShuffle(family, givers, childrenOf(family));
    var draw = givers.map(function (giver, i) {
      return { giver: giver, adult: adults[i], child: children[i] };
    });
    var problems = checkDraw(family, draw);
    if (problems.length) throw new Error(problems.join(' '));
    return draw;
  }

  // Returns a list of broken rules. An empty list means the draw is valid.
  function checkDraw(family, draw) {
    var problems = [];
    var adults = adultsOf(family);
    var children = childrenOf(family);
    function sameSet(found, expected) {
      return found.slice().sort().join('|') === expected.slice().sort().join('|');
    }
    if (!sameSet(draw.map(function (d) { return d.giver; }), adults)) problems.push('Each adult must have one link.');
    if (!sameSet(draw.map(function (d) { return d.adult; }), adults)) problems.push('Each adult must be drawn once.');
    if (!sameSet(draw.map(function (d) { return d.child; }), children)) problems.push('Each child must be drawn once.');
    draw.forEach(function (d) {
      var home = homeIndex(family, d.giver);
      if (home === homeIndex(family, d.adult) || home === homeIndex(family, d.child)) {
        problems.push('An adult drew someone from their own household.');
      }
    });
    return problems;
  }

  // ---- Link sealing ----
  // Scrambles the names with random bytes so nothing is readable by eye.
  // Links are stored nowhere on the site. The part after # never reaches the web server.
  function toBase64Url(bytes) {
    var text = '';
    bytes.forEach(function (b) { text += String.fromCharCode(b); });
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(text) {
    var binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function seal(entry) {
    var plain = new TextEncoder().encode(JSON.stringify(entry));
    var pad = new Uint8Array(plain.length);
    crypto.getRandomValues(pad);
    var out = new Uint8Array(plain.length * 2);
    out.set(pad, 0);
    plain.forEach(function (b, i) { out[plain.length + i] = b ^ pad[i]; });
    return toBase64Url(out);
  }

  // Returns the sealed entry, or null if the link is damaged or incomplete.
  function unseal(token) {
    try {
      var bytes = fromBase64Url(token);
      if (!bytes.length || bytes.length % 2) return null;
      var half = bytes.length / 2;
      var plain = new Uint8Array(half);
      for (var i = 0; i < half; i++) plain[i] = bytes[i] ^ bytes[half + i];
      var entry = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
      if (!entry || !entry.giver || !entry.adult || !entry.child) return null;
      return entry;
    } catch (e) {
      return null;
    }
  }

  function newDrawCode() {
    var value = new Uint16Array(1);
    crypto.getRandomValues(value);
    return ('000' + value[0].toString(16).toUpperCase()).slice(-4);
  }

  // Builds one sealed token per adult. Names are not returned, only the giver and token.
  function sealDraw(draw, year, code, isTest) {
    return draw.map(function (d) {
      return {
        giver: d.giver,
        token: seal({ giver: d.giver, adult: d.adult, child: d.child, year: year, code: code, test: !!isTest })
      };
    });
  }

  return {
    EVENT: EVENT, FAMILY: FAMILY, TEST_FAMILY: TEST_FAMILY,
    adultsOf: adultsOf, childrenOf: childrenOf,
    createDraw: createDraw, checkDraw: checkDraw,
    seal: seal, unseal: unseal, sealDraw: sealDraw, newDrawCode: newDrawCode
  };
});
