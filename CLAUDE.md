# alfred-menu

最前面のアプリケーションのメニュー項目をすべて取得し、Googleスプレッドシートに書き込むAlfred Workflow。

## 概要

- Alfred のキーワード `menulist` で起動する
- 起動時点の最前面アプリのメニューバーを走査し、全メニュー項目を再帰的に取得する
- Google Apps Script Web App を経由してスプレッドシートに書き込む

## 技術スタック

- **実装言語**: JXA (JavaScript for Automation)
  - メニュー項目の取得に System Events の Accessibility API を使用する
  - GAS Web App への通信には JXA 内から NSTask + curl で HTTP POST する
- **Alfred Workflow**: Run Script で JXA スクリプトを実行、User Configuration で設定管理
- **Google Apps Script**: スプレッドシートへの書き込みを処理する Web App

## インストール手順

1. `.alfredworkflow` をダブルクリックしてインストール
2. Googleスプレッドシートを開き、拡張機能 > Apps Script で `gas/menulist.gs` のコードを貼り付けてデプロイ
3. Alfred の Workflow 設定画面で Web App URL を入力

## メニュー項目の取得仕様

### 取得範囲

- 最前面アプリのメニューバーに含まれるすべてのメニュー項目
- サブメニューを含む全階層を再帰的に取得する
- 階層の深さに上限は設けない
- セパレーター（区切り線）はスキップする

### 取得する情報

各メニュー項目について以下を取得する:

| 情報 | 説明 |
|------|------|
| メニュー階層パス | 各階層のメニュー名（Level1, Level2, Level3, ...として列を分ける） |
| ショートカット修飾キー | ⌘ ⇧ ⌥ ⌃ の記号表記 |
| ショートカットメインキー | 修飾キー以外のキー（例: S, N, Deleteなど） |

### ショートカットキーの表記

修飾キーはmacOS標準の記号で表記する:

| 修飾キー | 記号 |
|----------|------|
| Command | ⌘ |
| Shift | ⇧ |
| Option | ⌥ |
| Control | ⌃ |

修飾キーが複数ある場合は記号を連結する（例: `⌘⇧`）。

## スプレッドシートの列構成

| 列 | 内容 | 例 |
|----|------|-----|
| A | ショートカット修飾キー | ⌘⇧ |
| B | ショートカットメインキー | S |
| C | Level 1（メニューバー項目） | ファイル |
| D | Level 2（メニュー項目） | 新規作成 |
| E | Level 3（サブメニュー項目） | ドキュメント |
| F〜 | Level 4以降（あれば） | ... |

- 階層がない列は空欄にする
- 1行目にはヘッダー行を入れる: `修飾キー`, `メインキー`, `Level1`, `Level2`, `Level3`, ...
- シート名は「アプリ名_作成日」にする（例: "Finder_2026-01-31", "Safari_2026-01-31"）
- 日付フォーマット: `YYYY-MM-DD`
- 同名のシートが既に存在する場合はクリアしてから上書きする（同日に再実行した場合）
- シートが存在しない場合は新規作成する

## Google Apps Script 連携

### 仕組み

- GAS を Web App としてデプロイし、Alfred Workflow から HTTP POST でメニューデータを送信する
- GAS 側でシートの作成・クリア・データ書き込みをすべて処理する
- OAuth2 認証やトークン管理は不要（GAS がスプレッドシートのオーナー権限で動作する）

### 送信データ形式

```json
{
  "appName": "Finder",
  "date": "2026-01-31",
  "menuItems": [
    { "path": ["ファイル", "新規Finderウインドウ"], "modifiers": "⌘", "key": "N" },
    ...
  ]
}
```

### GAS のデプロイ設定

- 実行ユーザー: 自分
- アクセス: 全員

## Alfred Workflow 構成

### トリガー

- **Keyword**: `menulist`
- 引数なし（最前面アプリを自動検出）

### Workflow の処理フロー

```
[Keyword: menulist]
    ↓
[Run Script (JXA)]  ← メニュー取得 + GAS Web App に POST
    ↓
[Post Notification]  ← 完了通知
```

### User Configuration（Workflow 設定画面）

| 変数名 | 型 | 説明 |
|--------|-----|------|
| `gas_url` | テキスト | GAS Web App の URL（必須） |
| `include_disabled` | チェックボックス | 無効メニュー項目も含めるか |

### 通知

- 成功時: 「{アプリ名}のメニュー項目をスプレッドシートに書き込みました（{件数}件 → {シート名}）」
- エラー時: エラー内容を通知に表示

## ディレクトリ構成

```
alfred-menu/
├── CLAUDE.md
├── info.plist              # Alfred Workflow定義ファイル
├── icon.png                # Workflowアイコン
├── gas/
│   └── menulist.gs         # GAS テンプレート（ユーザーがコピペ）
└── scripts/
    ├── main.js             # エントリーポイント（JXA）
    ├── menu-reader.js      # メニュー項目取得ロジック
    └── sheets-writer.js    # GAS Web App への HTTP POST
```

## 開発上の注意点

### アクセシビリティ権限

- メニュー項目の取得には「アクセシビリティ」権限が必要
- システム設定 > プライバシーとセキュリティ > アクセシビリティ で Alfred に権限を付与する必要がある
- 権限がない場合は分かりやすいエラーメッセージを表示する

### JXA での System Events アクセス

```javascript
// メニュー取得の基本パターン
const se = Application('System Events');
const frontApp = se.processes.whose({frontmost: true})[0];
const menuBar = frontApp.menuBars[0];
// menuBar.menus() で各メニューを走査
```

### パフォーマンス

- メニュー項目が多いアプリ（例: Excel, Photoshop）では取得に数秒かかる場合がある
- Alfred のスクリプト実行タイムアウトに注意する（必要に応じて延長）

### エラーハンドリング

- アクセシビリティ権限なし → ユーザーに権限付与を案内
- GAS URL 未設定 → Workflow 設定画面への案内
- GAS Web App からのエラー → エラー通知
- ネットワークエラー → エラー通知

## リリース

### .alfredworkflow ファイルの作成

`.alfredworkflow` ファイルはワークフロー構成ファイル一式をzipにまとめたもの（拡張子を変えただけ）。

```bash
cd alfred-menu
zip -r ../alfred-menu.alfredworkflow info.plist icon.png scripts/
```

### パッケージに含めるファイル

```
alfred-menu.alfredworkflow (zip)
├── info.plist
├── icon.png
└── scripts/
    ├── main.js
    ├── menu-reader.js
    └── sheets-writer.js
```

### パッケージに含めないファイル

- `CLAUDE.md` — 開発用ドキュメント
- `gas/` — GAS テンプレート（リポジトリからコピペして使う）
- `.git/` — バージョン管理
