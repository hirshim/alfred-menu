var SheetsWriter = {};

/**
 * POST JSON data to the GAS Web App via NSTask + curl.
 * Uses stdin pipe to pass JSON body (avoids shell escaping issues).
 * Follows redirects with -L (GAS returns 302 on doPost).
 * @param {string} url - GAS Web App URL
 * @param {Object} body - JSON payload
 * @returns {Object} Parsed JSON response
 */
SheetsWriter._post = function (url, body) {
    var inputPipe = $.NSPipe.pipe;
    var outputPipe = $.NSPipe.pipe;
    var errorPipe = $.NSPipe.pipe;
    var task = $.NSTask.alloc.init;

    task.launchPath = $('/usr/bin/curl');
    task.arguments = $([
        '-s', '-L',
        '-X', 'POST',
        '-H', 'Content-Type: application/json',
        '-d', '@-',
        url
    ]);
    task.standardInput = inputPipe;
    task.standardOutput = outputPipe;
    task.standardError = errorPipe;
    task.launch;

    var jsonStr = JSON.stringify(body);
    var inputData = $(jsonStr).dataUsingEncoding($.NSUTF8StringEncoding);
    inputPipe.fileHandleForWriting.writeData(inputData);
    inputPipe.fileHandleForWriting.closeFile;

    task.waitUntilExit;

    var outputData = outputPipe.fileHandleForReading.readDataToEndOfFile;
    var outputStr = $.NSString.alloc.initWithDataEncoding(outputData, $.NSUTF8StringEncoding);
    var result = ObjC.unwrap(outputStr);

    if (!result || result === '') {
        throw new Error('GAS Web App が空のレスポンスを返しました。URLを確認してください。');
    }

    var parsed;
    try {
        parsed = JSON.parse(result);
    } catch (e) {
        throw new Error('GAS Web App から不正なレスポンス: ' + result.substring(0, 200));
    }

    if (!parsed.success) {
        throw new Error('GAS エラー: ' + (parsed.error || 'unknown'));
    }

    return parsed;
};

/**
 * Send menu data to GAS Web App for writing to Google Sheets.
 * @param {string} gasUrl - GAS Web App URL
 * @param {string} appName - Name of the frontmost app
 * @param {Array} menuItems - Array of { path, modifiers, key }
 * @returns {{ sheetName: string, count: number }}
 */
SheetsWriter.writeMenuData = function (gasUrl, appName, menuItems) {
    var today = new Date();
    var yyyy = today.getFullYear();
    var mm = String(today.getMonth() + 1);
    if (mm.length < 2) mm = '0' + mm;
    var dd = String(today.getDate());
    if (dd.length < 2) dd = '0' + dd;
    var date = yyyy + '-' + mm + '-' + dd;

    var result = SheetsWriter._post(gasUrl, {
        appName: appName,
        date: date,
        menuItems: menuItems
    });

    return { sheetName: result.sheetName, count: result.count };
};
