// Examples follow server/rules.php. They are teaching cards, never live hands.
export const tutorialSteps = [
  { title: 'Welcome to your table', text: 'Start with 13 cards. On your turn, draw one card and discard one. Arrange the remaining cards into sequences and sets. Play is free; profile points have no cash value.', cards: [], note: 'You can arrange your hand while another player takes their turn.' },
  { title: 'Build a pure sequence', text: 'A pure sequence is three or more consecutive cards of one suit, without a substitute joker. You need at least one to declare.', cards: [{ rank: 3, suit: 'H' }, { rank: 4, suit: 'H' }, { rank: 5, suit: 'H' }], note: 'A wild-rank card used in its natural position may still be part of a pure sequence.' },
  { title: 'Use a joker in a sequence', text: 'A joker can fill a missing card in an impure sequence. Here the printed joker stands in for the 9 of spades.', cards: [{ rank: 7, suit: 'S' }, { rank: 8, suit: 'S' }, { rank: 0, suit: 'J' }], note: 'The cut card decides the wild rank. A printed cut joker makes aces wild. Open-deck jokers cannot be picked.' },
  { title: 'Complete a set', text: 'A set contains three or four equal ranks in different suits. Two cards of the same suit do not make a valid set, even when they come from different packs.', cards: [{ rank: 9, suit: 'H' }, { rank: 9, suit: 'S' }, { rank: 9, suit: 'C' }], note: 'Jokers can fill missing cards in sets. An all-joker group is invalid.' },
  { title: 'Understand penalty scoring', text: 'Aces and face cards count 10; numbered cards count their value; jokers count 0. The king, queen and five below total 25 before any wild-rank exemption. A round loss is capped at 80.', cards: [{ rank: 13, suit: 'C' }, { rank: 12, suit: 'D' }, { rank: 5, suit: 'S' }], note: 'Without a pure sequence, all non-jokers count. With only one sequence, only pure sequences are exempt. With two sequences including a pure one, all valid groups can be exempt.' },
  { title: 'Ready to declare', text: 'After drawing, select one final discard. Your other 13 cards must form valid groups, including at least two sequences with one pure sequence. The server validates the full hand.', cards: [], note: 'You cannot immediately return a card picked from the open deck. Invalid declarations leave your hand and turn open with no penalty. Human turns last 60 seconds. First drop costs 20; later drops cost 40.' },
];

export const tutorialQuestions = [
  {prompt:'How many cards do you keep after a normal turn?',choices:['14 cards','13 cards'],correct:1,explanation:'Draw to 14, then discard one to return to 13.'},
  {prompt:'Which group is a pure sequence?',choices:['3♥, 4♥, 5♥','3♥, Joker, 5♥'],correct:0,explanation:'A pure sequence uses consecutive cards of one suit without a substitute joker.'},
  {prompt:'Can you pick a joker from the open deck?',choices:['No','Yes'],correct:0,explanation:'Open-deck jokers cannot be picked in this game.'},
  {prompt:'Is 9♥, 9♥, 9♣ a valid set?',choices:['No','Yes'],correct:0,explanation:'A set cannot repeat a suit, even when the cards come from different packs.'},
  {prompt:'What is the maximum round loss penalty?',choices:['100 points','80 points'],correct:1,explanation:'The round loss penalty is capped at 80. Profile play points are separate.'},
  {prompt:'Can you immediately discard the card just picked from the open deck?',choices:['No','Yes'],correct:0,explanation:'Choose a different final discard. The server checks the remaining 13 cards.'},
];
