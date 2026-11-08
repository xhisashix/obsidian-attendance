# Obsidian Attendance

Obsidian のデイリーノートと [Dataview](https://github.com/blacksmithgu/obsidian-dataview)（DataviewJS）を活用して、日々の工数・勤怠ログの記録、JSONエクスポート、および月次集計ダッシュボードを実現するスクリプト＆テンプレート集です。

Vault 直下にそのまま `git clone` して利用できる設計になっており、既存の `Scripts/` や `Templates/` フォルダと競合しません。

---

## 主な機能

- **日次勤怠テーブル＆JSONコピー (`attendance.js`)**
  - デイリーノートに箇条書きで記録した時刻ログから、自動で「開始・終了時刻」「稼働時間」「JOBコード」「カテゴリ」「補足コメント」の明細表を生成します。
  - その日の **JOB × カテゴリ別 稼働内訳**（合計時間・タスク数・JOB内比率・日内比率）を自動集計して表示します。
  - 「📋 勤怠JSONをコピー」ボタンで、外部の勤怠・工数管理システム等へ連携しやすい JSON データをクリップボードにコピーできます。
- **月次勤怠ダッシュボード (`attendance-dashboard.js`)**
  - 指定月（デフォルトは当月）のデイリーノートを横断集計し、稼働日数・合計時間・1日平均を表示します。
  - **JOB別集計**（時間・割合・比率グラフ）、**JOB × カテゴリ別内訳**、**日別ログ一覧**（日ごとのJOB × カテゴリ別内訳付き）を自動描画します。
  - 始業 `[開始]` 抜けや記法エラーがあるノートを「⚠️ 要確認ノート」として警告表示します。
- **JOBマスタ連携 (`job-template.md`)**
  - 案件ノート等の Frontmatter に `job_code` と `job_label` を設定しておくだけで、ダッシュボードの集計表にわかりやすい案件名を表示できます（`templates/` 配下のテンプレートファイル自身は自動的に集計対象から除外されます）。

---

## ディレクトリ構成

```text
obsidian-attendance/
├── README.md
├── scripts/
│   ├── attendance.js            # デイリーノート用：日次集計＆JSONコピー
│   └── attendance-dashboard.js  # ダッシュボード用：月次集計＆グラフ表示
└── templates/
    ├── daily-template.md        # デイリーノート用テンプレート
    ├── dashboard-template.md    # 月次ダッシュボード用テンプレート
    └── job-template.md          # JOBマスタ（案件ノート）用テンプレート
```

---

## 導入手順

### 1. 前提プラグインの準備

1. Obsidian のコミュニティプラグインから **Dataview** をインストール・有効化します。
2. Dataview の設定画面で以下を有効（ON）にします：
   - **Enable JavaScript Queries**
   - **Enable Inline JavaScript Queries**

### 2. Vault 直下へ Clone

ご自身の Obsidian Vault のルートディレクトリ直下に本リポジトリを `git clone` します。

```bash
cd /path/to/<あなたのVault>
git clone <リポジトリURL> obsidian-attendance
```

配置後の Vault 構成イメージは以下のようになります。既存のフォルダにファイルを混ぜる必要はなく、更新時も `obsidian-attendance` 内で `git pull` するだけで最新化できます。

```text
<あなたのVault>/
├── obsidian-attendance/         # Cloneしたリポジトリ
│   ├── scripts/
│   │   ├── attendance.js
│   │   └── attendance-dashboard.js
│   └── templates/
│       ├── daily-template.md
│       ├── dashboard-template.md
│       └── job-template.md
└── DailyNotes/                  # デイリーノート格納フォルダ（YYYY-MM-DD.md）
```

> **Note:** もし既存のテンプレートフォルダ（例: `Templates/`）でテンプレートを一元管理している場合は、`obsidian-attendance/templates/` 内の `.md` ファイルだけをご自身の `Templates/` フォルダにコピーして使ってもそのまま動作します。

---

## 使い方

### 1. JOBマスタ（案件ノート）の作成

`obsidian-attendance/templates/job-template.md` を参考に、Vault 内の任意の場所（`templates/` 以外）に案件ノートを作成します。Frontmatter に `job_code` が含まれるノートは自動的に JOB マスタとして認識されます。

```yaml
---
job_code: "PRJ-001"
job_label: "💻 PRJ-001: 基幹システム改修"
active: true
order: 1
categories:
  - 開発
  - 設計
  - 調査
  - レビュー
  - 管理
---
```

### 2. デイリーノートでの勤怠記録

デイリーノート（例: `DailyNotes/2026-11-08.md`）に `## 勤怠ログ` 見出しを作成し、以下のように時刻と内容を箇条書きで記録します（`obsidian-attendance/templates/daily-template.md` 参照）。

````markdown
## 勤怠ログ

- 09:00 [開始]
- 10:30 [PRJ-001] [設計] API仕様書の作成
- 12:00 [PRJ-001] [開発] エンドポイント実装
- 13:00 [休憩]
- 17:30 [PRJ-001] [レビュー] コードレビュー
- 18:00 [終了]

### 勤怠集計

```dataviewjs
await dv.view("obsidian-attendance/scripts/attendance");
```

````

#### ログの記法ルール

- **基本フォーマット:** `- HH:MM [JOBコード] [カテゴリ] 補足コメント`（時刻は `9:00` のような1桁時間にも対応）
- **1つ前の行の時刻が開始時刻、その行の時刻が終了時刻**として計算されます。
  - 上記の例では `09:00 [開始]` → `10:30 [PRJ-001] [設計] API仕様書の作成` により、`09:00〜10:30 (1時間30分)` が `PRJ-001` の `設計` として集計されます。
  - 時刻順が前後して追記された場合でも、スクリプト側で自動的に時刻順へソートして計算します。
- **特殊キーワード:**
  - `[開始]`: 始業時刻（または再開時刻）の起点として扱われます。月次ダッシュボードでは先頭行が `[開始]` でない場合に警告を表示します。
  - `[休憩]`: 直前の時刻からその行の時刻までを休憩時間として扱い、稼働時間の集計から除外します（例: `12:00` にタスク終了後、`13:00 [休憩]` と書くことで 12:00〜13:00 を除外し、次のタスクの開始時刻を `13:00` に設定）。
  - `[終了]`: タスク外の時間や退勤の明示に使用でき、記法エラーの対象外になります。

#### 出力されるJSONフォーマット

デイリーノートの「📋 勤怠JSONをコピー」ボタンを押すと、以下の形式の JSON がクリップボードにコピーされます。

```json
[
  {
    "jobCode": "PRJ-001",
    "start": "09:00",
    "end": "10:30",
    "category": "設計",
    "comment": "API仕様書の作成"
  }
]
```

### 3. 月次ダッシュボードの確認

`obsidian-attendance/templates/dashboard-template.md` を使ってダッシュボード用のノートを作成します。

````markdown
---
target_month: 2026-11
---
# 勤怠ダッシュボード

```dataviewjs
await dv.view("obsidian-attendance/scripts/attendance-dashboard", {
  folder: "DailyNotes"
});
```
````

#### オプション指定

- **対象月 (`month` / `target_month`):**
  1. `dv.view("obsidian-attendance/scripts/attendance-dashboard", { folder: "DailyNotes", month: "2026-11" })` の引数 `month`
  2. ダッシュボードノートの Frontmatter `target_month`（例: `target_month: 2026-11`）
  3. 未指定（空欄）の場合は自動的に**当月 (`YYYY-MM`)** が対象になります。
- **デイリーノートフォルダ (`folder`):**
  - デフォルトは `"DailyNotes"` です。別フォルダにデイリーノートを保存している場合は `folder` 引数を変更してください。
