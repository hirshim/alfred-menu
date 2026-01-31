var SheetsWriter = {};

SheetsWriter.BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Execute an HTTP request to Google Sheets API via NSTask + curl.
 * Uses stdin pipe for JSON body to avoid shell escaping issues.
 * @param {string} method - HTTP method
 * @param {string} url - Full URL
 * @param {Object|null} body - JSON body (or null for GET)
 * @param {string} accessToken - OAuth2 access token
 * @returns {Object} Parsed JSON response
 */
SheetsWriter._request = function (method, url, body, accessToken) {
    var inputPipe = $.NSPipe.pipe;
    var outputPipe = $.NSPipe.pipe;
    var errorPipe = $.NSPipe.pipe;
    var task = $.NSTask.alloc.init;

    task.launchPath = $('/usr/bin/curl');
    var args = ['-s', '-X', method, url,
        '-H', 'Authorization: Bearer ' + accessToken,
        '-H', 'Content-Type: application/json'];

    if (body) {
        args.push('-d', '@-');  // Read body from stdin
    }

    task.arguments = $(args);
    task.standardInput = inputPipe;
    task.standardOutput = outputPipe;
    task.standardError = errorPipe;
    task.launch;

    if (body) {
        var jsonStr = JSON.stringify(body);
        var inputData = $(jsonStr).dataUsingEncoding($.NSUTF8StringEncoding);
        inputPipe.fileHandleForWriting.writeData(inputData);
    }
    inputPipe.fileHandleForWriting.closeFile;

    task.waitUntilExit;

    var outputData = outputPipe.fileHandleForReading.readDataToEndOfFile;
    var outputStr = $.NSString.alloc.initWithDataEncoding(outputData, $.NSUTF8StringEncoding);
    var result = ObjC.unwrap(outputStr);

    if (!result || result === '') {
        throw new Error('Google Sheets API が空のレスポンスを返しました');
    }

    var parsed = JSON.parse(result);
    if (parsed.error) {
        throw new Error('Google Sheets API エラー: ' +
            (parsed.error.message || JSON.stringify(parsed.error)));
    }
    return parsed;
};

/**
 * Get spreadsheet metadata (including list of sheets).
 */
SheetsWriter.getSpreadsheet = function (spreadsheetId, accessToken) {
    var url = SheetsWriter.BASE_URL + '/' + spreadsheetId +
        '?fields=sheets.properties.title,sheets.properties.sheetId';
    return SheetsWriter._request('GET', url, null, accessToken);
};

/**
 * Check if a sheet with the given name exists.
 * Returns the sheetId if found, or null.
 */
SheetsWriter.findSheet = function (spreadsheetId, sheetName, accessToken) {
    var info = SheetsWriter.getSpreadsheet(spreadsheetId, accessToken);
    var sheets = info.sheets || [];
    for (var i = 0; i < sheets.length; i++) {
        if (sheets[i].properties.title === sheetName) {
            return sheets[i].properties.sheetId;
        }
    }
    return null;
};

/**
 * Add a new sheet to the spreadsheet.
 */
SheetsWriter.addSheet = function (spreadsheetId, sheetName, accessToken) {
    var url = SheetsWriter.BASE_URL + '/' + spreadsheetId + ':batchUpdate';
    var body = {
        requests: [{
            addSheet: {
                properties: { title: sheetName }
            }
        }]
    };
    return SheetsWriter._request('POST', url, body, accessToken);
};

/**
 * Clear all values in a sheet.
 */
SheetsWriter.clearSheet = function (spreadsheetId, sheetName, accessToken) {
    var encodedName = encodeURIComponent(sheetName);
    var url = SheetsWriter.BASE_URL + '/' + spreadsheetId +
        '/values/' + encodedName + ':clear';
    return SheetsWriter._request('POST', url, {}, accessToken);
};

/**
 * Write rows of data to a sheet starting from A1.
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @param {Array<Array<string>>} rows - 2D array of cell values
 * @param {string} accessToken
 */
SheetsWriter.writeData = function (spreadsheetId, sheetName, rows, accessToken) {
    var encodedName = encodeURIComponent(sheetName);
    var url = SheetsWriter.BASE_URL + '/' + spreadsheetId +
        '/values/' + encodedName + '!A1?valueInputOption=RAW';
    var body = {
        range: sheetName + '!A1',
        majorDimension: 'ROWS',
        values: rows
    };
    return SheetsWriter._request('PUT', url, body, accessToken);
};

/**
 * Convert menu items array to spreadsheet rows.
 * Columns: 修飾キー | メインキー | Level1 | Level2 | ...
 * @param {Array} menuItems - Array of { path: string[], modifiers: string, key: string }
 * @returns {Array<Array<string>>} 2D array including header row
 */
SheetsWriter.formatRows = function (menuItems) {
    // Determine max depth for dynamic Level columns
    var maxDepth = 0;
    for (var i = 0; i < menuItems.length; i++) {
        if (menuItems[i].path.length > maxDepth) {
            maxDepth = menuItems[i].path.length;
        }
    }

    // Header row
    var header = ['修飾キー', 'メインキー'];
    for (var d = 1; d <= maxDepth; d++) {
        header.push('Level' + d);
    }

    var rows = [header];

    // Data rows
    for (var j = 0; j < menuItems.length; j++) {
        var item = menuItems[j];
        var row = [item.modifiers, item.key];
        for (var k = 0; k < maxDepth; k++) {
            row.push(item.path[k] || '');
        }
        rows.push(row);
    }

    return rows;
};

/**
 * Main entry point: write menu data to Google Sheets.
 * Creates or clears the target sheet, then writes all data.
 * @param {string} appName - Name of the frontmost app
 * @param {Array} menuItems - Menu item data
 * @param {Object} config - Config with spreadsheet_id
 * @param {string} accessToken - OAuth2 access token
 * @returns {{ sheetName: string, count: number }}
 */
SheetsWriter.writeMenuData = function (appName, menuItems, config, accessToken) {
    var spreadsheetId = config.spreadsheet_id;

    // Build sheet name: AppName_YYYY-MM-DD
    var today = new Date();
    var yyyy = today.getFullYear();
    var mm = String(today.getMonth() + 1);
    if (mm.length < 2) mm = '0' + mm;
    var dd = String(today.getDate());
    if (dd.length < 2) dd = '0' + dd;
    var sheetName = appName + '_' + yyyy + '-' + mm + '-' + dd;

    // Check if sheet already exists
    var existingSheetId = SheetsWriter.findSheet(spreadsheetId, sheetName, accessToken);

    if (existingSheetId !== null) {
        // Clear existing sheet
        SheetsWriter.clearSheet(spreadsheetId, sheetName, accessToken);
    } else {
        // Create new sheet
        SheetsWriter.addSheet(spreadsheetId, sheetName, accessToken);
    }

    // Format and write data
    var rows = SheetsWriter.formatRows(menuItems);
    SheetsWriter.writeData(spreadsheetId, sheetName, rows, accessToken);

    return { sheetName: sheetName, count: menuItems.length };
};
