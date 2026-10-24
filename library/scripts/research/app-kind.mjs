// app-kind.mjs — what KIND of communication channel an App Store app is, from its name.
//
// A NAME-AND-KEYWORD HEURISTIC over a known list, recorded as such in every table that uses it.
// It lives in its own file so the fetcher (fetch-top-apps.mjs) and the table builder
// (build-tabulator-tables.mjs) classify with the SAME rule: the builder re-derives the kind from
// the stored name, so a cached fetch made with an older rule cannot carry an old answer forward.
//
// ★ A BRAND THAT IS ALSO AN ENGLISH WORD MUST BE ANCHORED. `line` matched as a bare word made
// "LINE MAN: Food Delivery & more" (Thailand) and "Malé Taxi Line" (Maldives) each country's TOP
// messaging app, ahead of WhatsApp. LINE's own app is "LINE" or "LINE: Calls & Messages", so it
// matches only as the whole name or the name before a colon.
export const KIND = [
  [/\b(whatsapp|telegram|signal|viber|imo|zalo|wechat|weixin|kakaotalk|botim|imessage|messenger|skype|hike|jio ?chat|soul|beetalk)\b|^line(?:$|\s*:)/i, 'messaging'],
  [/\b(tiktok|douyin|kwai|likee|snack ?video|moj|josh|triller|reels)\b/i, 'short-video'],
  [/\b(facebook|instagram|snapchat|x|twitter|threads|vk|odnoklassniki|weibo|qzone|xiaohongshu|little red|sharechat|koo|mastodon|bluesky)\b/i, 'social'],
  [/\b(youtube|bigo|nimo|twitch|rumble|dailymotion|vimeo)\b/i, 'video'],
  [/\b(opera|uc ?browser|chrome|firefox|brave|puffin|phoenix ?browser)\b/i, 'browser'],
];

export function classify(name) {
  for (const [re, k] of KIND) if (re.test(String(name || '').trim())) return k;
  return 'other';
}

// The kinds a reachability table keeps (everything else is not a communication channel).
export const isComms = (kind) => kind !== 'other' && kind !== 'browser';
