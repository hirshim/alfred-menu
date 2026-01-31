# alfred-menu

最前面のアプリケーションのメニュー項目をすべて取得し、Googleスプレッドシートに書き込むAlfred Workflow。

## 概要

- Alfred のキーワード `menulist` で起動する
- 起動時点の最前面アプリのメニューバーを走査し、全メニュー項目を再帰的に取得する
- 取得したメニュー項目をGoogle Sheets APIを使ってスプレッドシートに書き込む

## 技術スタック

- **実装言語**: JXA (JavaScript for Automation)
  - メニュー項目の取得に System Events の Accessibility API を使用する
  - Google Sheets API との通信には JXA 内から `curl` を `$.NSTask` または `app.doShellScript()` で呼び出す
- **Alfred Workflow**: Script Filter または Run Script で JXA スクリプトを実行
- **Google Sheets API v4**: OAuth2 認証でスプレッドシートに書き込む

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
- アプリ名はシート名として使用する

## Google Sheets API 連携

### 認証方式

- OAuth2 認証を使用する
- Google Cloud Console でプロジェクトを作成し、OAuth2 クライアントID（デスクトップアプリ）を発行する
- 必要なスコープ: `https://www.googleapis.com/auth/spreadsheets`

### 認証フロー

1. 初回起動時にブラウザを開いてGoogle認証を行う
2. 認証コードをリダイレクトまたは手動入力で受け取る
3. アクセストークンとリフレッシュトークンを Workflow のデータディレクトリに保存する
4. 2回目以降はリフレッシュトークンで自動的にアクセストークンを更新する

### トークン保存先

```
~/Library/Application Support/Alfred/Workflow Data/<bundle-id>/
├── credentials.json    # OAuth2クライアントID・シークレット
├── token.json          # アクセストークン・リフレッシュトークン
└── config.json         # スプレッドシートIDなどの設定
```

### 書き込み動作

- 指定されたスプレッドシートIDに対して書き込む
- シート名は「アプリ名_作成日」にする（例: "Finder_2026-01-31", "Safari_2026-01-31"）
- 日付フォーマット: `YYYY-MM-DD`
- 同名のシートが既に存在する場合はクリアしてから上書きする（同日に再実行した場合）
- シートが存在しない場合は新規作成する

## Alfred Workflow 構成

### トリガー

- **Keyword**: `menulist`
- 引数なし（最前面アプリを自動検出）

### Workflow の処理フロー

```
[Keyword: menulist]
    ↓
[Run Script (JXA)]  ← メニュー取得 + Google Sheets 書き込み
    ↓
[Post Notification]  ← 完了通知
```

### 通知

- 成功時: 「{アプリ名}のメニュー項目をスプレッドシートに書き込みました（{件数}件）」
- エラー時: エラー内容を通知に表示

## ディレクトリ構成

```
alfred-menu/
├── CLAUDE.md
├── info.plist              # Alfred Workflow定義ファイル
├── icon.png                # Workflowアイコン
├── scripts/
│   ├── main.js             # エントリーポイント（JXA）
│   ├── menu-reader.js      # メニュー項目取得ロジック
│   ├── sheets-writer.js    # Google Sheets API書き込み
│   └── oauth2.js           # OAuth2認証フロー
└── README.md               # セットアップ手順（任意）
```

## 開発上の注意点

### アクセシビリティ権限

- メニュー項目の取得には「アクセシビリティ」権限が必要
- System Preferences > Security & Privacy > Privacy > Accessibility で Alfred に権限を付与する必要がある
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
- Google認証未済 → 認証フローを開始
- トークン期限切れ → リフレッシュトークンで再取得、失敗時は再認証
- スプレッドシートIDが未設定 → 設定方法を案内
- ネットワークエラー → リトライまたはエラー通知

## 設定項目（config.json）

```json
{
  "spreadsheet_id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "include_disabled_items": false
}
```

- `spreadsheet_id`: 書き込み先のGoogleスプレッドシートのID
- `include_disabled_items`: 無効（グレーアウト）なメニュー項目も含めるかどうか

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
    ├── sheets-writer.js
    └── oauth2.js
```

### パッケージに含めないファイル

- `CLAUDE.md` — 開発用ドキュメント
- `README.md` — リポジトリ用ドキュメント
- `credentials.json`, `token.json`, `config.json` — ユーザー固有の認証・設定ファイル
- `.git/` — バージョン管理
