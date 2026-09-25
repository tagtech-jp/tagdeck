"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Clipboard,
  ClipboardCheck,
  Flame,
  Gift,
  MessageSquareText,
  ShieldAlert,
  Sparkles,
  Star,
  Timer,
  UsersRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDashboardListeners } from "@/hooks/useDashboardListeners";
import { PLATFORM_LABELS } from "@/types/platform";
import type { Listener } from "@/types/listener";

type PromptMode = "welcome" | "regular" | "gift" | "quiet" | "event";
const SPONSOR_CUE_STORAGE_KEY = "tagdeck:sponsor-cue";

const MODE_CONFIG: Record<
  PromptMode,
  {
    label: string;
    icon: typeof Sparkles;
    description: string;
  }
> = {
  welcome: {
    label: "初見歓迎",
    icon: Sparkles,
    description: "新規リスナーに居場所を作る",
  },
  regular: {
    label: "常連深掘り",
    icon: UsersRound,
    description: "常連の名前と文脈を拾う",
  },
  gift: {
    label: "ギフトお礼",
    icon: Gift,
    description: "支援を次の会話につなげる",
  },
  quiet: {
    label: "沈黙打破",
    icon: MessageSquareText,
    description: "コメントが止まった時の一言",
  },
  event: {
    label: "イベント追い込み",
    icon: Flame,
    description: "順位戦の熱量を上げる",
  },
};

const FOLLOW_UP_TASKS = [
  "初見・新規の名前を CRM に残す",
  "ギフト上位 3 名へ次回冒頭で触れる",
  "盛り上がった話題をショート動画候補にする",
  "モデレーション対象コメントをタグ化する",
];

const STREAM_PLAYBOOK = [
  {
    phase: "配信前",
    lead: "入室直後の迷いを減らす",
    items: [
      "今日のゴールを1文にする",
      "初見に聞く質問を1つ決める",
      "常連の前回メモを3人分見る",
    ],
  },
  {
    phase: "配信中",
    lead: "コメントの入口を絶やさない",
    items: [
      "10分ごとに二択質問を入れる",
      "反応が薄い話題は30秒で切る",
      "盛り上がった発言を短く復唱する",
    ],
  },
  {
    phase: "荒れ防止",
    lead: "注意より先に空気を戻す",
    items: [
      "強い言葉は一度だけ柔らかく言い換える",
      "個人攻撃は読まずに話題を戻す",
      "危ない流れは次の企画に切り替える",
    ],
  },
  {
    phase: "配信後",
    lead: "次回の来場理由を作る",
    items: [
      "上位支援者と初見をメモする",
      "切り抜き候補を1つ残す",
      "次回冒頭で触れる約束を作る",
    ],
  },
];

const RESPONSE_GUARDRAILS = [
  {
    title: "個人情報に寄った時",
    intent: "公開できる範囲へ戻す",
    cue: "「そこは配信で深掘りしすぎないで、話せる範囲だけにしよう。」",
  },
  {
    title: "強い否定が続く時",
    intent: "対立を作らず話題を切る",
    cue: "「意見は受け取った。ここからは一回、別の話題に戻すね。」",
  },
  {
    title: "内輪化しすぎた時",
    intent: "初見の入口を作る",
    cue: "「初見の人にも伝わるように、今の話を30秒で説明する。」",
  },
  {
    title: "外部誘導が出た時",
    intent: "配信内の導線へ戻す",
    cue: "「リンク系は確認してからにする。今はこの枠の話を続けるね。」",
  },
];

function pickDisplayName(listener: Listener) {
  return listener.nickname ?? listener.displayName;
}

function buildRunSheet(mode: PromptMode) {
  const modeLabel = MODE_CONFIG[mode].label;

  return [
    {
      time: "0:00",
      title: "冒頭",
      action: `${modeLabel}を今日の軸にして、初見でも入れる一文から始める。`,
      metric: "最初のコメント 3 件",
    },
    {
      time: "0:10",
      title: "入口作り",
      action: "二択質問を出し、反応した人の名前を1回だけ拾う。",
      metric: "反応者 5 人",
    },
    {
      time: "0:25",
      title: "山場",
      action: "支援者・常連・初見の順に会話を回し、場の偏りを薄める。",
      metric: "会話対象 6 人",
    },
    {
      time: "0:45",
      title: "回収",
      action: "次回に持ち越す約束と切り抜き候補を1つずつ残す。",
      metric: "次回フック 1 個",
    },
  ];
}

function buildPrompts(mode: PromptMode, listeners: Listener[]) {
  const online = listeners.filter((listener) => listener.isOnline);
  const topSupporters = [...listeners]
    .sort((a, b) => b.totalGiftAmount - a.totalGiftAmount)
    .slice(0, 4);
  const newcomers = listeners
    .filter((listener) => listener.rank === "newcomer")
    .slice(0, 4);
  const regulars = listeners
    .filter((listener) => listener.rank === "regular" || listener.rank === "vip")
    .slice(0, 4);

  if (mode === "welcome") {
    return newcomers.map((listener) => ({
      title: `${pickDisplayName(listener)}さんを初見枠に乗せる`,
      body: `${PLATFORM_LABELS[listener.platform]} から来てくれたことに触れて、今日の配信テーマを一言で渡す。「初めてでもコメントしやすい質問」を添える。`,
      cue: `「${pickDisplayName(listener)}さん、来てくれてありがとう。今日はどこから見つけてくれた？」`,
    }));
  }

  if (mode === "regular") {
    return regulars.map((listener) => ({
      title: `${pickDisplayName(listener)}さんの文脈を拾う`,
      body: listener.notes
        ? `メモ「${listener.notes}」を会話の入口にして、前回の続きとして扱う。`
        : `累計コメント ${listener.totalCommentCount.toLocaleString()} 件の常連。近況を聞いて会話の主導権を渡す。`,
      cue: `「${pickDisplayName(listener)}さん、この前の話の続き聞いてもいい？」`,
    }));
  }

  if (mode === "gift") {
    return topSupporters.map((listener, index) => ({
      title: `支援 ${index + 1} 位: ${pickDisplayName(listener)}さん`,
      body: `累計 ${listener.totalGiftAmount.toLocaleString()} pt。金額だけで終わらせず、配信を一緒に作ってくれている感謝に変換する。`,
      cue: `「${pickDisplayName(listener)}さんの応援、本当に今日の流れを作ってくれてる。」`,
    }));
  }

  if (mode === "quiet") {
    const names = online.slice(0, 3).map(pickDisplayName).join("さん、");
    return [
      {
        title: "二択でコメントのハードルを下げる",
        body: "自由回答ではなく、A/B で答えられる問いにする。迷っている視聴者が一文字で参加できる。",
        cue: "「いまの話、Aなら続ける、Bなら別企画いく。A/B だけでも投げて。」",
      },
      {
        title: "今いる人をまとめて呼ぶ",
        body: names ? `${names}さんがオンライン。個別名を出しすぎず、場にいる感覚を作る。` : "オンライン検出が少ない時は、視聴者全体に短く投げる。",
        cue: "「今いる人だけに聞くけど、次どっち見たい？」",
      },
      {
        title: "30 秒だけ裏話を出す",
        body: "沈黙時は新情報よりも裏側の話が強い。短く区切ると離脱リスクを抑えられる。",
        cue: "「30秒だけ裏話すると、実は今日ここが一番迷ってた。」",
      },
    ];
  }

  return [
    {
      title: "次の 10 分の小目標を宣言する",
      body: "大きな最終目標ではなく、今すぐ達成できる単位に分ける。視聴者が参加しやすい。",
      cue: "「次の10分だけ、ここを一緒に取りに行きたい。」",
    },
    {
      title: "支援者を順位ではなく役割で紹介する",
      body: `${topSupporters.slice(0, 3).map(pickDisplayName).join("さん、")}さんを、場を動かしている人として紹介する。`,
      cue: "「いま流れを作ってくれてる人たち、名前だけ読ませて。」",
    },
    {
      title: "クリップ化できる一言を残す",
      body: "イベント中の熱量は後から切り抜ける形にする。短い宣言がショート動画の冒頭になる。",
      cue: "「ここから巻き返したら、今日の配信タイトルこれで決まり。」",
    },
  ];
}

export default function AiPrompterPage() {
  const { listeners, loading: listenersLoading } = useDashboardListeners();
  const [mode, setMode] = useState<PromptMode>("welcome");
  const [sponsorCue, setSponsorCue] = useState(() =>
    typeof window === "undefined"
      ? ""
      : localStorage.getItem(SPONSOR_CUE_STORAGE_KEY) ?? ""
  );
  const [copiedPromptTitle, setCopiedPromptTitle] = useState<string | null>(null);
  const [checkedTasks, setCheckedTasks] = useState<string[]>([]);
  const [checkedPlaybookItems, setCheckedPlaybookItems] = useState<string[]>([]);

  useEffect(() => {
    localStorage.setItem(SPONSOR_CUE_STORAGE_KEY, sponsorCue);
  }, [sponsorCue]);

  const prompts = useMemo(() => buildPrompts(mode, listeners), [listeners, mode]);
  const runSheet = useMemo(() => buildRunSheet(mode), [mode]);
  const onlineCount = listeners.filter((listener) => listener.isOnline).length;
  const topGiftTotal = listeners.reduce((sum, listener) => sum + listener.totalGiftAmount, 0);

  const copyPrompt = async (prompt: { title: string; body: string; cue: string }) => {
    const text = `${prompt.title}\n${prompt.body}\n${prompt.cue}`;

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setCopiedPromptTitle(prompt.title);
    }
  };

  const toggleTask = (task: string) => {
    setCheckedTasks((current) =>
      current.includes(task)
        ? current.filter((item) => item !== task)
        : [...current, task]
    );
  };

  const togglePlaybookItem = (item: string) => {
    setCheckedPlaybookItems((current) =>
      current.includes(item)
        ? current.filter((checkedItem) => checkedItem !== item)
        : [...current, item]
    );
  };

  return (
    <div className="min-h-full bg-background">
      {/* ヘッダー: 主要数字はオンライン人数+累計支援の2つに絞る */}
      <div className="border-b border-border px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">攻略（AI接客カンペ）</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              CRM の文脈から、配信中にそのまま読める声かけを用意します
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <div className="rounded-lg border border-border px-3 py-2">
              <div className="text-muted-foreground">オンライン</div>
              <div className="text-lg font-semibold text-foreground">{onlineCount} 人</div>
            </div>
            <div className="rounded-lg border border-border px-3 py-2">
              <div className="text-muted-foreground">累計支援</div>
              <div className="text-lg font-semibold text-foreground">
                {topGiftTotal.toLocaleString()} pt
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {/* 配信モード: 横スクロールピル */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(Object.keys(MODE_CONFIG) as PromptMode[]).map((key) => {
            const config = MODE_CONFIG[key];
            const Icon = config.icon;
            const selected = mode === key;

            return (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors ${
                  selected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-foreground/30"
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {config.label}
              </button>
            );
          })}
        </div>

        {/* メインは「読み上げ候補」のみ常時表示。残りはTabsに格納 */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground">読み上げ候補</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              名前・支援履歴・メモを配信中の一言に変換
            </p>
          </div>
          <Badge variant="secondary">{MODE_CONFIG[mode].label}</Badge>
        </div>

        {listenersLoading ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        ) : prompts.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            該当するリスナーがまだいません。CRM にリスナーが記録されると候補が表示されます。
          </p>
        ) : (
        <div className="grid gap-3">
          {prompts.map((prompt) => (
            <article key={prompt.title} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <Star className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold text-foreground">{prompt.title}</h4>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{prompt.body}</p>
                  <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
                    {prompt.cue}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-3 min-h-11 gap-2"
                    onClick={() => void copyPrompt(prompt)}
                  >
                    {copiedPromptTitle === prompt.title ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : (
                      <Clipboard className="size-4" aria-hidden="true" />
                    )}
                    {copiedPromptTitle === prompt.title ? "コピー済み" : "コピー"}
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
        )}

        {/* 進行/対応集/メモは初期非表示。必要な時だけタブを開く */}
        <Tabs defaultValue="progress">
          <TabsList className="w-full">
            <TabsTrigger value="progress" className="flex-1">
              進行
            </TabsTrigger>
            <TabsTrigger value="guardrails" className="flex-1">
              対応集
            </TabsTrigger>
            <TabsTrigger value="memo" className="flex-1">
              メモ
            </TabsTrigger>
          </TabsList>

          <TabsContent value="progress" className="mt-3 space-y-4">
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <Timer className="size-4 text-primary" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-foreground">配信ランシート</h3>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {runSheet.map((item) => (
                  <div key={item.time} className="rounded-lg border border-border bg-muted p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-primary">{item.time}</span>
                      <span className="text-xs text-muted-foreground">{item.metric}</span>
                    </div>
                    <h4 className="mt-2 text-sm font-semibold text-foreground">{item.title}</h4>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.action}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="size-4 text-primary" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-foreground">配信プレイブック</h3>
              </div>
              <div className="mt-3 space-y-4">
                {STREAM_PLAYBOOK.map((group) => (
                  <div key={group.phase}>
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className="text-xs font-semibold text-foreground">{group.phase}</h4>
                      <span className="text-xs text-muted-foreground">{group.lead}</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {group.items.map((item) => {
                        const checked = checkedPlaybookItems.includes(item);

                        return (
                          <label
                            key={item}
                            className="flex min-h-11 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePlaybookItem(item)}
                              className="size-5 accent-primary"
                            />
                            <span className={checked ? "text-muted-foreground/60 line-through" : "text-foreground"}>
                              {item}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="size-4 text-status-success" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-foreground">配信後フォロー</h3>
              </div>
              <div className="mt-3 space-y-1">
                {FOLLOW_UP_TASKS.map((task) => {
                  const checked = checkedTasks.includes(task);

                  return (
                    <label
                      key={task}
                      className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTask(task)}
                        className="size-5 accent-primary"
                      />
                      <span className={checked ? "text-muted-foreground/60 line-through" : "text-foreground"}>
                        {task}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="guardrails" className="mt-3">
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-destructive" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-foreground">荒れ防止の即応文</h3>
              </div>
              <div className="mt-3 space-y-3">
                {RESPONSE_GUARDRAILS.map((item) => (
                  <div key={item.title} className="rounded-lg bg-muted p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-xs font-semibold text-foreground">{item.title}</h4>
                      <span className="text-xs text-muted-foreground">{item.intent}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-foreground">{item.cue}</p>
                  </div>
                ))}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="memo" className="mt-3">
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <Gift className="size-4 text-ember-pulse" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-foreground">スポンサー読み上げ</h3>
              </div>
              <textarea
                value={sponsorCue}
                onChange={(event) => setSponsorCue(event.target.value)}
                placeholder="案件名、NGワード、読み上げ順をメモ"
                className="mt-3 min-h-32 w-full resize-none rounded-sm border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring"
              />
              <Button
                type="button"
                variant="secondary"
                className="mt-3 min-h-11 w-full"
                onClick={() => setSponsorCue("")}
              >
                クリア
              </Button>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
