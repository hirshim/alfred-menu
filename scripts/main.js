ObjC.import('stdlib');
ObjC.import('Foundation');

var wfPath;
try {
    wfPath = ObjC.unwrap($.getenv('alfred_workflow_path'));
} catch (e) {
    wfPath = ObjC.unwrap($.NSFileManager.defaultManager.currentDirectoryPath);
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
        loadScript('sheets-writer.js');

        // Get config from Alfred User Configuration (environment variables)
        var gasUrl;
        try {
            gasUrl = ObjC.unwrap($.getenv('gas_url'));
        } catch (e) {
            gasUrl = '';
        }
        if (!gasUrl) {
            return 'エラー: GAS Web App URL が未設定です。Alfredの Workflow設定画面で URL を入力してください。';
        }

        var includeDisabled = false;
        try {
            includeDisabled = ObjC.unwrap($.getenv('include_disabled')) === '1';
        } catch (e) {}

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

        var menuItems = MenuReader.readAllMenuItems(frontProcess, includeDisabled);
        if (menuItems.length === 0) {
            return 'エラー: ' + appName + ' のメニュー項目を取得できませんでした。';
        }

        // Send to GAS Web App
        var result = SheetsWriter.writeMenuData(gasUrl, appName, menuItems);

        return appName + 'のメニュー項目をスプレッドシートに書き込みました（' + result.count + '件 → ' + result.sheetName + '）';
    } catch (e) {
        return 'エラー: ' + e.message;
    }
}
