import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { setTimeLang } from './lib.js';

export type Lang = 'en' | 'vi';

type Vars = Record<string, string | number>;

/**
 * English is the source of truth; Vietnamese is intentionally casual and a bit
 * cheeky (the user asked for "funnier, not formal"). Keys group by surface.
 * `{name}` placeholders are filled by `t(key, { name })`.
 */
const EN: Record<string, string> = {
  'nav.overview': 'Overview',
  'nav.grove': 'Grove',
  'nav.team': 'Team memory',
  'nav.search': 'Search',
  'wordmark.tagline': 'shared roots',
  'topbar.live': 'live updates connected',
  'topbar.disconnected': 'disconnected',
  'theme.toggle': 'Toggle theme',
  'lang.toggle': 'Switch language',
  'err.server': 'Could not reach the dashboard server: {error}',

  'ov.lede.a': 'Shared',
  'ov.lede.em': 'roots',
  'ov.lede.b': ' for your codebase.',
  'ov.sub.a':
    'Every branch, every pinned decision, every fact that graduated to repo-wide knowledge — read straight from git. This is what your team knows about ',
  'ov.sub.b': '.',
  'ov.stat.branches': 'branches with memory',
  'ov.stat.pins': 'pinned decisions',
  'ov.stat.graduated': 'graduated repo-wide',
  'ov.stat.pending': 'pins not shared yet',
  'ov.promo.a': 'Explore the ',
  'ov.promo.em': 'Grove',
  'ov.promo.lead': 'See the contributor graph — {author} is leading with {metric}.',
  'ov.promo.empty':
    'See who grew your team’s knowledge as a living graph of branches & contributors.',
  'ov.section.branchGraph': 'Branch graph',
  'ov.hint.synced': '.tre-mem/ present — shared via git',
  'ov.hint.local': 'no .tre-mem/ yet — local only',
  'ov.empty.title': 'No branch memory yet',
  'ov.empty.hint': 'Run `tre backfill` to branch-tag past observations, then pin what matters.',
  'branch.tagged': 'tagged',
  'branch.pins': 'pins',

  'metric.score': '{n} score',
  'metric.commits': '{n} commits',

  'grove.title.a': 'The ',
  'grove.title.em': 'grove',
  'grove.sub.a':
    'Every contributor, every fact they grew, every branch it lives on — the second brain of ',
  'grove.sub.b': '.',
  'grove.source.git': 'from git history — run `tre share` to attribute facts',
  'grove.unattributed': '{n} facts shared before attribution',
  'grove.unattributed.one': '1 fact shared before attribution',
  'grove.share': 'Share grove',
  'grove.share.title': 'Download a shareable grove card',
  'grove.contributors': 'Contributors',
  'grove.by.score': 'by value score',
  'grove.by.commits': 'by commits',
  'grove.empty.title': 'Nothing has grown here yet',
  'grove.empty.hint':
    'Pin a decision, then run `tre share` to grow your grove and attribute it to contributors.',
  'grove.board.empty.title': 'No contributors yet',
  'grove.board.empty.hint': 'Share attributed facts to populate the leaderboard.',
  'timelapse.now': 'now',
  'timelapse.growing': 'growing…',
  'timelapse.play': 'Play growth replay',
  'timelapse.pause': 'Pause growth replay',

  'lb.score': 'score',
  'lb.pins': 'pins',
  'lb.rooted': 'rooted',
  'lb.commits': 'commits',
  'lb.branch': 'branch',
  'lb.branches': 'branches',
  'lb.unattributed': 'unattributed',

  'badge.gardener_of_week': 'Gardener of the week',
  'badge.most_rooted': 'Most rooted',
  'badge.longest_streak': 'Longest streak',
  'badge.first_sprout': 'First sprout',

  'tm.title': 'Team memory',
  'tm.sub.a': 'What the team chose to remember about ',
  'tm.sub.b':
    ' — pinned decisions and the facts that graduated to repo-wide knowledge. Shared rows live in ',
  'tm.sub.c': ' and travel through git; run ',
  'tm.sub.d': ' to publish them.',
  'tm.callout.a': '{n} pins not shared yet — run ',
  'tm.callout.b': " to push them to your team's git.",
  'tm.empty.title': 'No shared memory yet',
  'tm.empty.hint': "Pin a decision, then run `tre share` to push it to your team's git.",
  'tm.pinned': 'Pinned decisions',
  'tm.graduated': 'Graduated facts',
  'tm.grad.empty.title': 'Nothing graduated yet',
  'tm.grad.empty.hint': 'Merge a PR (or `tre graduate`) to promote a fact repo-wide.',
  'entry.pin': 'pin',
  'entry.graduated': 'graduated',
  'entry.shared.git': 'shared via git ✓',
  'entry.notshared': 'not shared yet',
  'entry.shared': 'shared',
  'entry.local': 'local',
  'entry.note': 'note',
  'entry.from': 'from',
  'entry.pinnedfact': '(pinned fact)',
  'entry.freetext': 'free-text',
  'entry.observation': 'observation',

  'bd.back': '← branches',
  'bd.sub.a': 'Curated knowledge and tagged activity on this branch of ',
  'bd.sub.b': '.',
  'bd.notfound': 'Branch not found',
  'bd.pins.empty.title': 'No pins on this branch',
  'bd.pins.empty.hint': 'Pin a fact to share it with the team.',
  'bd.gradhere': 'Graduated from here',
  'bd.gradhere.empty': 'Nothing graduated from this branch',
  'bd.activity': 'Tagged activity',
  'bd.activity.empty': 'No tagged observations',

  's.title': 'Search',
  's.sub.a': 'Branch-aware retrieval',
  's.sub.on': ' on ',
  's.sub.b': '. Each hit shows why it ranked — semantic, branch, recency, graduated, pin.',
  's.placeholder': "Search this codebase's memory…",
  's.sharedonly': 'claude-mem not detected — searching shared pins + graduated only.',
  's.empty.type.title': 'Type to search',
  's.empty.type.hint': 'Results are reranked for the active branch.',
  's.searching': 'Searching…',
  's.nomatch.title': 'No matches',
  's.nomatch.hint': 'Try a different term or branch.',

  'card.tagline': 'shared roots · tre-mem grove',
  'card.contributors': 'contributors',
  'card.facts': 'facts',
  'card.branches': 'branches',

  'time.ago': '{v} ago',
  'time.now': 'just now',
};

const VI: Record<string, string> = {
  'nav.overview': 'Tổng quan',
  'nav.grove': 'Khu vườn',
  'nav.team': 'Trí nhớ team',
  'nav.search': 'Lùng sục',
  'wordmark.tagline': 'rễ chung',
  'topbar.live': 'đang sống nha',
  'topbar.disconnected': 'rớt mạng rồi',
  'theme.toggle': 'Đổi sáng/tối',
  'lang.toggle': 'Đổi ngôn ngữ',
  'err.server': 'Hổng kết nối được tới server: {error}',

  'ov.lede.a': 'Rễ',
  'ov.lede.em': 'chung',
  'ov.lede.b': ' cho cả đống code của bạn 🌳',
  'ov.sub.a':
    'Mọi nhánh, mọi quyết định đã ghim, mọi điều hay ho đã "lên đời" toàn repo — đọc thẳng từ git luôn. Đây là tất tần tật những gì team biết về ',
  'ov.sub.b': '.',
  'ov.stat.branches': 'nhánh có trí nhớ',
  'ov.stat.pins': 'quyết định đã ghim',
  'ov.stat.graduated': 'đã lên đời toàn repo',
  'ov.stat.pending': 'ghim chưa kịp khoe',
  'ov.promo.a': 'Ghé thăm ',
  'ov.promo.em': 'Khu vườn',
  'ov.promo.lead': 'Ngó cái graph đóng góp coi — {author} đang dẫn đầu với {metric} đó.',
  'ov.promo.empty':
    'Coi thử ai đang trồng cây tri thức cho team — graph sống động của nhánh & người đóng góp.',
  'ov.section.branchGraph': 'Bản đồ nhánh',
  'ov.hint.synced': 'có .tre-mem/ rồi — đã chia sẻ qua git',
  'ov.hint.local': 'chưa có .tre-mem/ — máy mình thôi',
  'ov.empty.title': 'Chưa có trí nhớ nhánh nào hết',
  'ov.empty.hint': 'Gõ `tre backfill` để gắn nhánh cho mấy cái cũ, rồi ghim cái nào ngon nha.',
  'branch.tagged': 'đã gắn',
  'branch.pins': 'ghim',

  'metric.score': '{n} điểm',
  'metric.commits': '{n} commit',

  'grove.title.a': 'Khu ',
  'grove.title.em': 'vườn tre',
  'grove.sub.a': 'Mọi người đóng góp, mọi điều họ trồng, mọi nhánh nó sống — bộ não thứ hai của ',
  'grove.sub.b': '.',
  'grove.source.git': 'lấy từ lịch sử git — gõ `tre share` để ghi công nha',
  'grove.unattributed': '{n} điều được chia sẻ hồi chưa kịp ghi công',
  'grove.unattributed.one': '1 điều được chia sẻ hồi chưa kịp ghi công',
  'grove.share': 'Khoe vườn',
  'grove.share.title': 'Tải tấm hình khoe vườn về máy',
  'grove.contributors': 'Người đóng góp',
  'grove.by.score': 'theo điểm chất',
  'grove.by.commits': 'theo số commit',
  'grove.empty.title': 'Ở đây chưa mọc cái gì hết trơn 🌱',
  'grove.empty.hint':
    'Ghim một quyết định rồi gõ `tre share` cho vườn xanh tốt và ghi công cho mọi người nha.',
  'grove.board.empty.title': 'Chưa có ai trồng cây hết',
  'grove.board.empty.hint': 'Chia sẻ vài điều có ghi công đi rồi bảng vàng mới có tên nha.',
  'timelapse.now': 'bây giờ',
  'timelapse.growing': 'đang lớn…',
  'timelapse.play': 'Tua lại quá trình lớn',
  'timelapse.pause': 'Tạm dừng',

  'lb.score': 'điểm',
  'lb.pins': 'ghim',
  'lb.rooted': 'bén rễ',
  'lb.commits': 'commit',
  'lb.branch': 'nhánh',
  'lb.branches': 'nhánh',
  'lb.unattributed': 'vô danh',

  'badge.gardener_of_week': 'Nông dân của tuần 🧑‍🌾',
  'badge.most_rooted': 'Bén rễ nhất',
  'badge.longest_streak': 'Chăm nhất hệ',
  'badge.first_sprout': 'Mầm đầu tiên',

  'tm.title': 'Trí nhớ team',
  'tm.sub.a': 'Những gì team chọn để nhớ về ',
  'tm.sub.b':
    ' — quyết định đã ghim và mấy điều đã "lên đời" toàn repo. Mấy dòng chia sẻ nằm trong ',
  'tm.sub.c': ' và đi theo git; gõ ',
  'tm.sub.d': ' để khoe ra cho cả team.',
  'tm.callout.a': 'Còn {n} ghim chưa khoe — gõ ',
  'tm.callout.b': ' để đẩy lên git của team nha.',
  'tm.empty.title': 'Chưa có trí nhớ chung nào',
  'tm.empty.hint': 'Ghim một quyết định rồi gõ `tre share` để đẩy lên git của team.',
  'tm.pinned': 'Quyết định đã ghim',
  'tm.graduated': 'Điều đã lên đời',
  'tm.grad.empty.title': 'Chưa có gì lên đời',
  'tm.grad.empty.hint': 'Merge một PR (hoặc `tre graduate`) để cho điều đó lên đời toàn repo.',
  'entry.pin': 'ghim',
  'entry.graduated': 'lên đời',
  'entry.shared.git': 'đã chia sẻ qua git ✓',
  'entry.notshared': 'chưa khoe',
  'entry.shared': 'đã chia sẻ',
  'entry.local': 'máy mình',
  'entry.note': 'ghi chú',
  'entry.from': 'từ',
  'entry.pinnedfact': '(điều đã ghim)',
  'entry.freetext': 'chữ tự do',
  'entry.observation': 'quan sát',

  'bd.back': '← nhánh',
  'bd.sub.a': 'Kiến thức tuyển chọn và hoạt động đã gắn trên nhánh này của ',
  'bd.sub.b': '.',
  'bd.notfound': 'Hổng thấy nhánh này',
  'bd.pins.empty.title': 'Nhánh này chưa có ghim nào',
  'bd.pins.empty.hint': 'Ghim một điều để chia sẻ với team.',
  'bd.gradhere': 'Lên đời từ đây',
  'bd.gradhere.empty': 'Chưa có gì lên đời từ nhánh này',
  'bd.activity': 'Hoạt động đã gắn',
  'bd.activity.empty': 'Chưa có quan sát nào được gắn',

  's.title': 'Lùng sục',
  's.sub.a': 'Tìm kiếm biết phân biệt nhánh',
  's.sub.on': ' trên ',
  's.sub.b': '. Mỗi kết quả cho biết vì sao nó lọt top — ngữ nghĩa, nhánh, độ mới, lên đời, ghim.',
  's.placeholder': 'Lục trí nhớ của codebase này…',
  's.sharedonly': 'Hổng thấy claude-mem — chỉ tìm trong ghim + điều đã lên đời thôi.',
  's.empty.type.title': 'Gõ gì đó để tìm',
  's.empty.type.hint': 'Kết quả được xếp lại theo nhánh đang mở.',
  's.searching': 'Đang lùng…',
  's.nomatch.title': 'Hổng có gì khớp',
  's.nomatch.hint': 'Thử từ khác hoặc nhánh khác coi.',

  'card.tagline': 'rễ chung · vườn tre-mem',
  'card.contributors': 'người đóng góp',
  'card.facts': 'điều',
  'card.branches': 'nhánh',

  'time.ago': '{v} trước',
  'time.now': 'vừa nãy',
};

const STRINGS: Record<Lang, Record<string, string>> = { en: EN, vi: VI };

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export type TFn = (key: string, vars?: Vars) => string;

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
}

const I18nCtx = createContext<I18nValue>({ lang: 'en', setLang: () => {}, t: (k) => k });

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('tre-lang');
    if (saved === 'en' || saved === 'vi') return saved;
  } catch {
    /* private mode */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('vi')
    ? 'vi'
    : 'en';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    setTimeLang(lang);
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem('tre-lang', l);
    } catch {
      /* private mode */
    }
    setLangState(l);
  }, []);

  const t = useCallback<TFn>(
    (key, vars) => interpolate(STRINGS[lang][key] ?? STRINGS.en[key] ?? key, vars),
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nCtx);
}
