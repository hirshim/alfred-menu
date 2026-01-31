/**
 * alfred-menu: Google Apps Script Web App
 *
 * セットアップ:
 * 1. Googleスプレッドシートを開く
 * 2. 拡張機能 > Apps Script を開く
 * 3. このコードを貼り付けて保存
 * 4. デプロイ > 新しいデプロイ > ウェブアプリ
 *    - 実行ユーザー: 自分
 *    - アクセス: 全員
 * 5. 表示されたURLをAlfredのWorkflow設定にコピー
 */

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var appName = data.appName;
    var date = data.date;
    var menuItems = data.menuItems;

    var sheetName = appName + '_' + date;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // シートの取得 or 作成
    var sheet = ss.getSheetByName(sheetName);
    if (sheet) {
      sheet.clear();
    } else {
      sheet = ss.insertSheet(sheetName);
    }

    // 最大階層深度を算出
    var maxDepth = 0;
    for (var i = 0; i < menuItems.length; i++) {
      if (menuItems[i].path.length > maxDepth) {
        maxDepth = menuItems[i].path.length;
      }
    }

    // ヘッダー行
    var header = ['修飾キー', 'メインキー'];
    for (var d = 1; d <= maxDepth; d++) {
      header.push('Level' + d);
    }

    // データ行
    var rows = [header];
    for (var j = 0; j < menuItems.length; j++) {
      var item = menuItems[j];
      var row = [item.modifiers || '', item.key || ''];
      for (var k = 0; k < maxDepth; k++) {
        row.push(item.path[k] || '');
      }
      rows.push(row);
    }

    // 一括書き込み
    sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

    // ヘッダー行を太字に
    sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');

    // 列幅の自動調整
    for (var c = 1; c <= rows[0].length; c++) {
      sheet.autoResizeColumn(c);
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        sheetName: sheetName,
        count: menuItems.length
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
