#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
縦型ショート動画(1080x1920)用の ASS 字幕ジェネレーター
「毎朝トーク」風フォーマット: ピンク帯ボックス + 黒太字 + 白フチ

出力する .ass は、緑背景に焼き込んでクロマキー用オーバーレイを作るための
中間ファイル(ffmpeg の ass/subtitles フィルタが読む)。ユーザーへの納品物ではない。

台本中のタグ:
  [R]...[/R]  韻(ライミング)      → 青 + 文字拡大
  [W]...[/W]  ダブルミーニング    → 赤 + 文字拡大
  [DAY]...[/DAY] 記念日の発表部分 → 黒のまま文字拡大

タイミング:
  - 同じフォルダに timings.json ([{"start": 秒, "end": 秒}, ...] がカード数分)
    があればそれを使う(Whisper で取った実測値を貼る場所)。
  - 無ければ TOTAL_DURATION 秒に文字数比で按分した推定値を使う。

使い方:
  python3 make_subs.py            → 20260713_pommes.ass を出力
"""
import json
import os
import re

# ------------------------------------------------------------------ 設定
OUT_BASE = "20260713_pommes"
PLAY_W, PLAY_H = 1080, 1920

# 上部字幕: 固定の長方形エリア(この中に文字をセンタリング)
TOP_RECT_Y0 = 150     # 長方形の上端(FRAME_TOP と同じ値にして上フレームに密着させる)
TOP_RECT_H = 380      # 長方形の高さ(最大2行ぶん)
POS_FACE = (540, 1330)  # 「何の日」発表パネルの中心: 顔の下

# 「何の日」パネルの表示区間(秒)。
# 「är det internationella pommes frites-dagen!」の発話区間(無音検出の実測)に合わせる
DAY_START = 13.32
DAY_END = 15.90

FS_BASE = 80          # 基本の文字サイズ
FS_BIG = 108          # 仕掛け(韻・ダブルミーニング)部分のサイズ ≈1.35倍
FS_DAY = 96           # 記念日名(パネル内)のサイズ
MAX_ZENKAKU = 12      # 1行の上限(全角換算)。半角は0.5で数える

# 四方のフレーム(スクショの白い太枠を再現)
FRAME_TOP = 150       # 上枠の高さ(タイトル帯)
FRAME_BOTTOM = 200    # 下枠の高さ(日付が乗る)
FRAME_SIDE = 36       # 左右の枠の幅
COL_FRAME = "&H00FFFFFF"  # 白
TITLE_TEXT = "Dagligt snack dag 1"  # 上枠のタイトル(「毎日トーク○日目」)。日数は毎回ここを書き換える

# 「何の日」発表用の長方形パネル(テロップコーナー風)
PANEL_W = 900         # パネルの幅
PANEL_PAD = 30        # 上下の内側余白
PANEL_BORDER = 14     # パネルの白フチの太さ
PANEL_Y_OFFSET = 20   # パネル矩形を文字に対して下げる補正(視覚センタリング)

TOTAL_DURATION = 58.0  # 音声全体の推定秒数(実測が取れたら timings.json を置く)
LEAD_IN = 0.40         # 最初のカードが出るまでの秒数
GAP = 0.35             # カード間の隙間(秒)

# 色 (ASSは &H AA BB GG RR の BGR 順)
COL_TEXT = "&H00000000"   # 黒
COL_OUTLINE = "&H00FFFFFF"  # 白フチ
COL_BOX = "&H00DCC9F2"    # ピンク帯 (#F2C9DC)
COL_RHYME = "&H00FF901E"  # 韻 = 青 (#1E90FF)
COL_WPLAY = "&H00303BFF"  # ダブルミーニング = 赤 (#FF3B30)

DATE_TEXT = "13 juli 2026"

FONT = "Noto Sans CJK JP"

# ------------------------------------------------------------------ 台本
# 1要素 = 1枚のテロップ(カード)。タグで仕掛けをマーク。
CARDS = [
    "Vet ni vad det är för dag idag?",
    "Låt mig ge er en [W]frasig[/W] ledtråd.",
    "Det är något som man gärna tar ett [W]dopp[/W] med,",
    "särskilt på sommaren!",
    "Idag, den trettonde juli,",
    "är det [DAY]internationella pommes frites-dagen![/DAY]",
    "Oavsett om du gillar dem tjocka eller [R]smala[/R],",
    "är det omöjligt att bara äta en på en [R]skala[/R].",
    "Det är synd att de inte är [R]gratis[/R],",
    "för vem älskar inte friterad [R]potatis[/R]?",
    "Vilken är din favoritdipp?",
    "Kommentera här nere! Hejdå!",
]

TAG_RE = re.compile(r"\[(/?)(R|W|DAY)\]")


# ------------------------------------------------------------------ 共通処理
def visible_width(text: str) -> float:
    """全角換算の文字幅(タグ抜きで呼ぶこと)"""
    return sum(1.0 if ord(c) > 0x2E80 else 0.5 for c in text)


def strip_tags(text: str) -> str:
    return TAG_RE.sub("", text)


def wrap_words(card: str):
    """タグを保ったまま、単語区切りで MAX_ZENKAKU 以内の行に分割する"""
    words = card.split(" ")
    lines, cur = [], []
    for w in words:
        trial = " ".join(cur + [w])
        if cur and visible_width(strip_tags(trial)) > MAX_ZENKAKU:
            lines.append(" ".join(cur))
            cur = [w]
        else:
            cur.append(w)
    if cur:
        lines.append(" ".join(cur))
    return lines


def estimate_timings():
    """文字数比で TOTAL_DURATION に按分した推定タイミング"""
    weights = [len(strip_tags(c)) for c in CARDS]
    speech = TOTAL_DURATION - LEAD_IN - GAP * len(CARDS)
    unit = speech / sum(weights)
    t = LEAD_IN
    out = []
    for w in weights:
        dur = w * unit
        out.append({"start": round(t, 2), "end": round(t + dur, 2)})
        t += dur + GAP
    return out


def load_timings():
    path = os.path.join(os.path.dirname(__file__), "timings.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        assert len(data) == len(CARDS), "timings.json のカード数が台本と不一致"
        print(f"timings.json を使用 ({len(data)} カード)")
        return data
    print(f"timings.json が無いため推定タイミングを使用 (全体 {TOTAL_DURATION}s 想定)")
    return estimate_timings()


def ass_time(sec: float) -> str:
    h = int(sec // 3600)
    m = int(sec % 3600 // 60)
    s = sec % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def to_ass_text(card: str, colored: bool, base_color: str = COL_TEXT) -> str:
    """タグ → ASSインラインタグ変換。
    colored=False はボックス用レイヤー: サイズタグのみ反映(色は帯と同色のまま)"""
    lines = [render_line(l, colored, base_color) for l in wrap_words(card)]
    return "\\N".join(lines)


def render_line(line: str, colored: bool, base_color: str = COL_TEXT) -> str:
    res = ""
    pos = 0
    for m in TAG_RE.finditer(line):
        res += line[pos:m.start()]
        closing, kind = m.group(1) == "/", m.group(2)
        if not closing:
            fs = FS_DAY if kind == "DAY" else FS_BIG
            col = {"R": COL_RHYME, "W": COL_WPLAY, "DAY": base_color}[kind]
            res += f"{{\\fs{fs}}}" if not colored else f"{{\\fs{fs}\\c{col}}}"
        else:
            res += f"{{\\fs{FS_BASE}}}" if not colored else f"{{\\fs{FS_BASE}\\c{base_color}}}"
        pos = m.end()
    res += line[pos:]
    return res




# ------------------------------------------------------------------ 出力
def build_ass(timings):
    header = f"""[Script Info]
; 毎朝トーク風 縦動画字幕 (自動生成: make_subs.py)
Title: {OUT_BASE}
ScriptType: v4.00+
PlayResX: {PLAY_W}
PlayResY: {PLAY_H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,{FONT},{FS_BASE},{COL_TEXT},&H000000FF,{COL_OUTLINE},&H00000000,1,0,0,0,100,100,0,0,1,5,0,5,40,40,40,1
Style: Panel,{FONT},{FS_BASE},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,5,0,5,40,40,40,1
Style: DateBig,{FONT},130,{COL_BOX},&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,2,0,1,7,0,2,40,40,55,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    total_end = max(t["end"] for t in timings) + 1.0
    t0, tE = ass_time(0), ass_time(total_end)
    # 四方の黒フレーム(1つの描画イベントに4本の矩形)
    rects = [
        (0, 0, PLAY_W, FRAME_TOP),                              # 上
        (0, PLAY_H - FRAME_BOTTOM, PLAY_W, PLAY_H),             # 下
        (0, FRAME_TOP, FRAME_SIDE, PLAY_H - FRAME_BOTTOM),      # 左
        (PLAY_W - FRAME_SIDE, FRAME_TOP, PLAY_W, PLAY_H - FRAME_BOTTOM),  # 右
    ]
    draw = " ".join(f"m {x1} {y1} l {x2} {y1} {x2} {y2} {x1} {y2}" for x1, y1, x2, y2 in rects)
    ev.append(
        f"Dialogue: 2,{t0},{tE},Main,,0,0,0,,"
        f"{{\\p1\\an7\\pos(0,0)\\bord0\\shad0\\c{COL_FRAME}}}{draw}"
    )
    # 上枠のタイトル(TITLE_TEXT が空なら枠のみ)
    if TITLE_TEXT:
        ev.append(
            f"Dialogue: 3,{t0},{tE},DateBig,,0,0,0,,"
            f"{{\\an5\\pos({PLAY_W // 2},{FRAME_TOP // 2})\\fs95}}{TITLE_TEXT}"
        )
    # 下枠の日付(常時表示)
    ev.append(
        f"Dialogue: 3,{t0},{tE},DateBig,,0,0,0,,"
        f"{{\\an5\\pos({PLAY_W // 2},{PLAY_H - FRAME_BOTTOM // 2})}}{DATE_TEXT}"
    )
    # 上部字幕: ピンクの長方形は常時表示(チカチカ防止)
    rect_w = PLAY_W - FRAME_SIDE * 2
    top_cx, top_cy = PLAY_W // 2, TOP_RECT_Y0 + TOP_RECT_H // 2
    ev.append(
        f"Dialogue: 0,{t0},{tE},Main,,0,0,0,,"
        f"{{\\p1\\an7\\pos({FRAME_SIDE},{TOP_RECT_Y0})\\c{COL_BOX}\\bord0\\shad0}}"
        f"m 0 0 l {rect_w} 0 {rect_w} {TOP_RECT_H} 0 {TOP_RECT_H}"
    )
    # 文字は次のカードが始まるまで表示し続ける(空白の瞬間を作らない)
    for i, (card, t) in enumerate(zip(CARDS, timings)):
        st = ass_time(t["start"])
        en = ass_time(timings[i + 1]["start"]) if i + 1 < len(timings) else ass_time(t["end"])
        plain = re.sub(r"\[/?DAY\]", "", card)  # 発表文も上部では通常の字幕として扱う
        ev.append(
            f"Dialogue: 1,{st},{en},Main,,0,0,0,,"
            f"{{\\pos({top_cx},{top_cy})}}{to_ass_text(plain, colored=True)}"
        )
    # 「何の日」パネル: 記念日名だけを、言っている間(DAY_START〜DAY_END)だけ顔の下に表示
    m = re.search(r"\[DAY\](.*?)\[/DAY\]", " ".join(CARDS))
    if m:
        day_name = m.group(1).strip()
        day_name = day_name[0].upper() + day_name[1:]
        lines = wrap_words(day_name)
        h = int(len(lines) * FS_DAY * 1.35) + PANEL_PAD * 2
        x, y = POS_FACE
        st, en = ass_time(DAY_START), ass_time(DAY_END)
        ev.append(
            f"Dialogue: 0,{st},{en},Main,,0,0,0,,"
            f"{{\\p1\\an5\\pos({x},{y + PANEL_Y_OFFSET})\\c{COL_BOX}\\3c&H00FFFFFF&"
            f"\\bord{PANEL_BORDER}\\shad0}}m 0 0 l {PANEL_W} 0 {PANEL_W} {h} 0 {h}"
        )
        ev.append(
            f"Dialogue: 1,{st},{en},Panel,,0,0,0,,"
            f"{{\\pos({x},{y})\\fs{FS_DAY}}}" + "\\N".join(lines)
        )
    return header + "\n".join(ev) + "\n"


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    # 行長・行数チェック(最大2行)
    for card in CARDS:
        lines = wrap_words(card)
        assert len(lines) <= 2, f"カードが3行以上です: {strip_tags(card)}"
        for line in lines:
            w = visible_width(strip_tags(line))
            assert w <= MAX_ZENKAKU, f"行が長すぎます ({w}): {strip_tags(line)}"
    timings = load_timings()
    ass_path = os.path.join(here, OUT_BASE + ".ass")
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(build_ass(timings))
    print(f"wrote {ass_path}")


if __name__ == "__main__":
    main()
