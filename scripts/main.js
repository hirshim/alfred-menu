ObjC.import('stdlib');
ObjC.import('Foundation');

// Workflow path (Alfred provides this env var; fallback for CLI debugging)
var wfPath;
try {
    wfPath = ObjC.unwrap($.getenv('alfred_workflow_path'));
} catch (e) {
    // Running outside Alfred (e.g. osascript from terminal)
    wfPath = ObjC.unwrap(
        $.NSFileManager.defaultManager.currentDirectoryPath
    );
}

function loadScript(name) {
    var path = wfPath + '/scripts/' + name;
    var error = Ref();
    var contents = $.NSString.stringWithContentsOfFileEncodingError(
        path, $.NSUTF8StringEncoding, error
    );
    if (contents.isNil()) {
        throw new Error('Failed to load script: ' + name);
    }
    eval(ObjC.unwrap(contents));
}

function run(argv) {
    try {
        loadScript('menu-reader.js');
        loadScript('oauth2.js');
        loadScript('sheets-writer.js');

        // Load config
        var config = OAuth2.loadConfig();
        if (!config || !config.spreadsheet_id) {
            return 'エラー: config.json にスプレッドシートIDが設定されていません。' +
                OAuth2._getDataDir() + '/config.json を作成してください。';
        }

        // Get frontmost app's menu items
        var se = Application('System Events');
        var frontProcess = se.processes.whose({ frontmost: true })[0];
        var appName = frontProcess.name();

        // Check accessibility permission
        try {
            frontProcess.menuBars[0].menuBarItems();
        } catch (e) {
            return 'エラー: アクセシビリティ権限がありません。システム設定 > プライバシーとセキュリティ > アクセシビリティ で Alfred を許可してください。';
        }

        // Read menu items (respect include_disabled_items config)
        var includeDisabled = config.include_disabled_items || false;
        var menuItems = MenuReader.readAllMenuItems(frontProcess, includeDisabled);
        if (menuItems.length === 0) {
            return 'エラー: ' + appName + ' のメニュー項目を取得できませんでした。';
        }

        // Get access token (may trigger browser auth flow on first run)
        var accessToken = OAuth2.getAccessToken();

        // Write to Google Sheets
        var result = SheetsWriter.writeMenuData(appName, menuItems, config, accessToken);

        return appName + 'のメニュー項目をスプレッドシートに書き込みました（' + result.count + '件 → ' + result.sheetName + '）';
    } catch (e) {
        return 'エラー: ' + e.message;
    }
}
