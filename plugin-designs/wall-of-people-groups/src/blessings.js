/**
 * blessings.js — the verses the Wall's BLESS mode prints under each people group, and the poster's
 * banner / sub-banner / footer text.
 *
 * SOURCE: the World English Bible British Edition, PUBLIC DOMAIN (ebible.org/eng-webbe: "a Public Domain
 * translation"), which reads "the LORD" where the WEB reads "Yahweh". The texts were first extracted
 * mechanically from the WEB (ebible.org/eng-web, 2026-09-28) and moved to the British Edition on 2026-10-03:
 * every one was re-checked verbatim against bible.helloao.org eng_webpb (its British spellings, e.g.
 * "towards", "honour", "amongst"), never retyped or paraphrased. A card quotes a
 * whole verse, or one whole sentence of it (marked "a" = the first sentence, "b" = the last, in the reference); cards hold at most 4 lines, so longer verses are quoted by one sentence, always with its reference.
 *
 * THE DIVINE NAME: texts carry {NAME} (mid-sentence) and {Name} (sentence start), filled from DIVINE_NAME. The
 * poster uses "the LORD" (the British Edition's reading, and the one the brief prefers). Going back to the WEB's
 * "Yahweh" means switching the texts' spellings back too, verse by verse against the WEB.
 */
export const DIVINE_NAME = { mid: 'the LORD', start: 'The LORD' }

const withName = (s) => s.replace(/\{Name\}/g, DIVINE_NAME.start).replace(/\{NAME\}/g, DIVINE_NAME.mid)

// Blessings spoken over a people, then the nations' praise. Assigned by group index, so a group keeps
// its verse and neighbours alternate.
const VERSES = [
  { ref: 'Numbers 6:24', text: '{Name} bless you, and keep you.' },
  { ref: 'Numbers 6:25', text: '{Name} make his face to shine on you, and be gracious to you.' },
  { ref: 'Numbers 6:26', text: '{Name} lift up his face towards you, and give you peace.' },
  { ref: 'Psalm 134:3', text: 'May {NAME} bless you from Zion, even he who made heaven and earth.' },
  { ref: 'Psalm 115:15', text: 'Blessed are you by {NAME}, who made heaven and earth.' },
  { ref: 'Psalm 29:11', text: '{Name} will give strength to his people. {Name} will bless his people with peace.' },
  { ref: 'Psalm 121:7', text: '{Name} will keep you from all evil. He will keep your soul.' },
  { ref: 'Psalm 67:1', text: 'May God be merciful to us, bless us, and cause his face to shine on us.' },
  { ref: 'Psalm 67:7', text: 'God will bless us. All the ends of the earth shall fear him.' },
  { ref: 'Psalm 22:27a', text: 'All the ends of the earth shall remember and turn to {NAME}.' },
  { ref: 'Psalm 86:9a', text: 'All nations you have made will come and worship before you, Lord.' },
  { ref: 'Psalm 117:1', text: 'Praise {NAME}, all you nations! Extol him, all you peoples!' },
  { ref: 'Psalm 72:17b', text: 'All nations will call him blessed.' },
  { ref: 'Genesis 12:3b', text: 'All the families of the earth will be blessed through you.' },
]

/** The verse for the group at index i: { text, ref }. */
export function blessingFor(i) {
  const v = VERSES[((i % VERSES.length) + VERSES.length) % VERSES.length]
  return { text: withName(v.text), ref: v.ref }
}
export const BLESSING_COUNT = VERSES.length

// THE POSTER, top to bottom as its brief lays it out (2026-09-28): the title "Bless the nations in
// Jesus' name", a short line on what DOXA means, a table of THREE PRAYER THEMES (treasure, mountain, sea),
// each with an Old Testament and a New Testament verse, then every people group, then the FOOTER: the
// priestly blessing (Numbers 6:24-26, the blessing words only) and the priesthood of believers (1 Peter 2).
// Verses are the WEB British Edition, verbatim; {NAME}/{Name} follow DIVINE_NAME. The sea's New Testament verse is from the
// storm on the sea (Matthew 8:23-27): the verse where he rebukes the wind and the sea.
const THEMES_RAW = [
  { id: 'treasure',
    ot: { ref: 'Haggai 2:7', text: 'and I will shake all nations. The treasure of all nations will come, and I will fill this house with glory, says {NAME} of Armies.' },
    nt: { ref: 'Matthew 13:44', text: 'Again, the Kingdom of Heaven is like treasure hidden in the field, which a man found and hid. In his joy, he goes and sells all that he has and buys that field.' } },
  { id: 'mountain',
    ot: { ref: 'Isaiah 2:2', text: 'It shall happen in the latter days, that the mountain of {NAME}’s house shall be established on the top of the mountains, and shall be raised above the hills; and all nations shall flow to it.' },
    nt: { ref: 'Matthew 21:21, from 21:18–22', text: 'Jesus answered them, “Most certainly I tell you, if you have faith and don’t doubt, you will not only do what was done to the fig tree, but even if you told this mountain, ‘Be taken up and cast into the sea,’ it would be done.' } },
  { id: 'sea',
    ot: { ref: 'Habakkuk 2:14', text: 'For the earth will be filled with the knowledge of {NAME}’s glory, as the waters cover the sea.' },
    nt: { ref: 'Matthew 8:26, from 8:23–27', text: 'He said to them, “Why are you fearful, O you of little faith?” Then he got up, rebuked the wind and the sea, and there was a great calm.' } },
]
const verse = (v) => ({ ref: v.ref, text: withName(v.text) })
export const THEMES = THEMES_RAW.map((t) => ({ id: t.id, ot: verse(t.ot), nt: verse(t.nt) }))

export const POSTER = {
  banner: 'Bless the nations in Jesus’ name',
  // The closing benediction, the poster's footer across its full width: the priestly blessing, Numbers 6:24-26,
  // in the World English Bible British Edition (public domain, ebible.org/eng-webbe; read via bible.helloao.org
  // eng_webpb), verbatim, set as two lines broken at verse 25's comma. Every verse on the poster is from the same
  // translation, so the credit line names it once.
  benediction: {
    lines: ['The LORD bless you, and keep you. The LORD make his face to shine on you,',
      'and be gracious to you. The LORD lift up his face towards you, and give you peace.'],
    ref: 'Numbers 6:24–26',
    credit: 'Scripture: World English Bible British Edition (public domain).',
  },
  // The second footer: the calling to bless the nations as a journey, Abraham to the church, with Christ
  // the cornerstone at its centre (the `centre` station). Each station quotes its WHOLE passage, from the
  // poster brief's list (Gen 12:1-4, Gen 15:5-6, Gal 3:5-7, 3:13-14, 3:28-29, 1 Pet 2:4-10,
  // Luke 19:9-10): 1 Peter 2:4-10 is split at verse 9 into the cornerstone and the royal priesthood, and
  // Galatians 3:5-7 and 3:28-29 are one station, joined by " … ". Verbatim WEB, speech marks kept.
  journey: [
    { id: 'called', ref: 'Genesis 12:1–4', text: 'Now {NAME} said to Abram, “Leave your country, and your relatives, and your father’s house, and go to the land that I will show you. I will make of you a great nation. I will bless you and make your name great. You will be a blessing. I will bless those who bless you, and I will curse him who treats you with contempt. All the families of the earth will be blessed through you.” So Abram went, as {NAME} had told him. Lot went with him. Abram was seventy-five years old when he departed from Haran.' },
    { id: 'promised', ref: 'Genesis 15:5–6', text: '{Name} brought him outside, and said, “Look now towards the sky, and count the stars, if you are able to count them.” He said to Abram, “So your offspring will be.” He believed in {NAME}, who credited it to him for righteousness.' },
    { id: 'redeemed', ref: 'Galatians 3:13–14', text: 'Christ redeemed us from the curse of the law, having become a curse for us. For it is written, “Cursed is everyone who hangs on a tree,” that the blessing of Abraham might come on the Gentiles through Christ Jesus, that we might receive the promise of the Spirit through faith.' },
    { id: 'cornerstone', centre: true, ref: '1 Peter 2:4–8', text: 'Come to him, a living stone, rejected indeed by men, but chosen by God, precious. You also as living stones are built up as a spiritual house, to be a holy priesthood, to offer up spiritual sacrifices, acceptable to God through Jesus Christ. Because it is contained in Scripture, “Behold, I lay in Zion a chief cornerstone, chosen and precious. He who believes in him will not be disappointed.” For you who believe therefore is the honour, but for those who are disobedient, “The stone which the builders rejected has become the chief cornerstone,” and, “a stumbling stone and a rock of offence.” For they stumble at the word, being disobedient, to which also they were appointed.' },
    { id: 'children', ref: 'Galatians 3:5–7, 28–29', text: 'He therefore who supplies the Spirit to you and does miracles amongst you, does he do it by the works of the law, or by hearing of faith? Even so, Abraham “believed God, and it was counted to him for righteousness.” Know therefore that those who are of faith are children of Abraham. … There is neither Jew nor Greek, there is neither slave nor free man, there is neither male nor female; for you are all one in Christ Jesus. If you are Christ’s, then you are Abraham’s offspring and heirs according to promise.' },
    { id: 'priesthood', ref: '1 Peter 2:9–10', text: 'But you are a chosen race, a royal priesthood, a holy nation, a people for God’s own possession, that you may proclaim the excellence of him who called you out of darkness into his marvellous light. In the past, you were not a people, but now are God’s people, who had not obtained mercy, but now have obtained mercy.' },
    { id: 'sent', ref: 'Luke 19:9–10', text: 'Jesus said to him, “Today, salvation has come to this house, because he also is a son of Abraham. For the Son of Man came to seek and to save that which was lost.”' },
  ].map((v) => ({ ...v, text: withName(v.text) })),
  // Kept for reference: the earlier footer candidates (sheet row 99), superseded by the chosen footer.
  subBanner: { ref: 'Proverbs 18:21', text: 'Death and life are in the power of the tongue; those who love it will eat its fruit.' },
  footer: { ref: 'Proverbs 11:11', text: 'By the blessing of the upright, the city is exalted, but it is overthrown by the mouth of the wicked.' },
}

/** Greedy word wrap to at most maxLines lines of ~perLine characters (for SVG/canvas text). */
export function wrapText(text, perLine, maxLines = 4) {
  const words = String(text).split(/\s+/)
  const lines = []
  let cur = ''
  for (const w of words) {
    if (!cur) cur = w
    else if ((cur + ' ' + w).length <= perLine) cur += ' ' + w
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, '') + '…'
    return kept
  }
  return lines
}
