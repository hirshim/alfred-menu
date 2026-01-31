var OAuth2 = {};

OAuth2.SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
OAuth2.AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
OAuth2.TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Get the Workflow data directory path.
 * ~/Library/Application Support/Alfred/Workflow Data/<bundle-id>/
 */
OAuth2._getDataDir = function () {
    var home = ObjC.unwrap($.NSHomeDirectory());
    var bundleId;
    try {
        bundleId = $.getenv('alfred_workflow_bundleid');
    } catch (e) {
        bundleId = 'com.shimizu.alfred.menulist';
    }
    return home + '/Library/Application Support/Alfred/Workflow Data/' + ObjC.unwrap(bundleId);
};

/**
 * Ensure the data directory exists.
 */
OAuth2._ensureDataDir = function () {
    var dir = OAuth2._getDataDir();
    var fm = $.NSFileManager.defaultManager;
    if (!fm.fileExistsAtPath(dir)) {
        fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
            dir, true, $(), null
        );
    }
    return dir;
};

/**
 * Read a JSON file from the data directory.
 */
OAuth2._readJSON = function (filename) {
    var path = OAuth2._getDataDir() + '/' + filename;
    var error = Ref();
    var contents = $.NSString.stringWithContentsOfFileEncodingError(
        path, $.NSUTF8StringEncoding, error
    );
    if (contents.isNil()) return null;
    return JSON.parse(ObjC.unwrap(contents));
};

/**
 * Write a JSON file to the data directory.
 */
OAuth2._writeJSON = function (filename, data) {
    var dir = OAuth2._ensureDataDir();
    var path = dir + '/' + filename;
    var jsonStr = $(JSON.stringify(data, null, 2));
    jsonStr.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
};

/**
 * Load OAuth2 client credentials (client_id, client_secret).
 */
OAuth2.loadCredentials = function () {
    var creds = OAuth2._readJSON('credentials.json');
    if (!creds) {
        throw new Error(
            'credentials.json が見つかりません。Google Cloud Console で OAuth2 クライアントIDを作成し、' +
            OAuth2._getDataDir() + '/credentials.json に配置してください。'
        );
    }
    // Support Google's downloaded format: { installed: { client_id, client_secret } }
    if (creds.installed) {
        return {
            client_id: creds.installed.client_id,
            client_secret: creds.installed.client_secret
        };
    }
    return creds;
};

/**
 * Load saved tokens (access_token, refresh_token, expires_at).
 */
OAuth2.loadToken = function () {
    return OAuth2._readJSON('token.json');
};

/**
 * Save tokens to disk.
 */
OAuth2.saveToken = function (tokenData) {
    OAuth2._writeJSON('token.json', tokenData);
};

/**
 * Load workflow config (spreadsheet_id, etc.).
 */
OAuth2.loadConfig = function () {
    return OAuth2._readJSON('config.json');
};

/**
 * Execute a curl request via NSTask (avoids shell escaping issues with doShellScript).
 * Returns parsed JSON response.
 */
OAuth2._curlRequest = function (method, url, params) {
    var inputPipe = $.NSPipe.pipe;
    var outputPipe = $.NSPipe.pipe;
    var errorPipe = $.NSPipe.pipe;
    var task = $.NSTask.alloc.init;

    task.launchPath = $('/usr/bin/curl');
    var args = ['-s', '-X', method, url,
        '-H', 'Content-Type: application/x-www-form-urlencoded'];

    if (params) {
        args.push('-d', '@-');  // Read POST body from stdin
    }

    task.arguments = $(args);
    task.standardInput = inputPipe;
    task.standardOutput = outputPipe;
    task.standardError = errorPipe;
    task.launch;

    if (params) {
        // Build URL-encoded form body
        var parts = [];
        for (var key in params) {
            if (params.hasOwnProperty(key)) {
                parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
            }
        }
        var body = parts.join('&');
        var inputData = $(body).dataUsingEncoding($.NSUTF8StringEncoding);
        inputPipe.fileHandleForWriting.writeData(inputData);
        inputPipe.fileHandleForWriting.closeFile;
    } else {
        inputPipe.fileHandleForWriting.closeFile;
    }

    task.waitUntilExit;

    var outputData = outputPipe.fileHandleForReading.readDataToEndOfFile;
    var outputStr = $.NSString.alloc.initWithDataEncoding(outputData, $.NSUTF8StringEncoding);
    var result = ObjC.unwrap(outputStr);

    if (!result || result === '') {
        throw new Error('curl リクエストが空のレスポンスを返しました');
    }

    return JSON.parse(result);
};

/**
 * Check if Python3 is available.
 */
OAuth2._hasPython3 = function () {
    var task = $.NSTask.alloc.init;
    task.launchPath = $('/usr/bin/which');
    task.arguments = $(['python3']);
    var pipe = $.NSPipe.pipe;
    task.standardOutput = pipe;
    task.standardError = $.NSPipe.pipe;
    try {
        task.launch;
        task.waitUntilExit;
        return task.terminationStatus === 0;
    } catch (e) {
        return false;
    }
};

/**
 * Start the Python3 OAuth callback server and return the port.
 * Returns { task: NSTask, port: number }
 */
OAuth2._startCallbackServer = function () {
    if (!OAuth2._hasPython3()) {
        throw new Error(
            'python3 が見つかりません。Xcode Command Line Tools をインストールしてください: xcode-select --install'
        );
    }

    var scriptPath = '';
    try {
        scriptPath = ObjC.unwrap($.getenv('alfred_workflow_path')) + '/scripts/oauth-callback-server.py';
    } catch (e) {
        scriptPath = ObjC.unwrap($.NSFileManager.defaultManager.currentDirectoryPath) +
            '/scripts/oauth-callback-server.py';
    }

    var outputPipe = $.NSPipe.pipe;
    var task = $.NSTask.alloc.init;
    task.launchPath = $('/usr/bin/python3');
    task.arguments = $([scriptPath, '0']);  // Port 0 = auto-assign
    task.standardOutput = outputPipe;
    task.standardError = $.NSPipe.pipe;
    task.launch;

    // Read the first line to get the port number
    var fileHandle = outputPipe.fileHandleForReading;
    var buffer = '';
    var newlineData = $('\n').dataUsingEncoding($.NSUTF8StringEncoding);

    // Read byte by byte until we get a newline (first JSON line with port)
    while (true) {
        var chunk = fileHandle.readDataOfLength(1);
        if (chunk.length === 0) {
            throw new Error('OAuth コールバックサーバーの起動に失敗しました');
        }
        var charStr = $.NSString.alloc.initWithDataEncoding(chunk, $.NSUTF8StringEncoding);
        var ch = ObjC.unwrap(charStr);
        if (ch === '\n') break;
        buffer += ch;
    }

    var portInfo = JSON.parse(buffer);
    return { task: task, fileHandle: fileHandle, port: portInfo.port };
};

/**
 * Run the full OAuth2 authorization flow via browser.
 * Returns token data.
 */
OAuth2._startAuthFlow = function () {
    var creds = OAuth2.loadCredentials();
    var server = OAuth2._startCallbackServer();
    var redirectUri = 'http://127.0.0.1:' + server.port;

    // Build authorization URL
    var authParams = [
        'client_id=' + encodeURIComponent(creds.client_id),
        'redirect_uri=' + encodeURIComponent(redirectUri),
        'response_type=code',
        'scope=' + encodeURIComponent(OAuth2.SCOPES),
        'access_type=offline',
        'prompt=consent'
    ];
    var authUrl = OAuth2.AUTH_URL + '?' + authParams.join('&');

    // Open browser for user authentication
    var app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.openLocation(authUrl);

    // Wait for callback (server blocks until it receives the redirect)
    server.task.waitUntilExit;

    // Read the second line from stdout (the auth code JSON)
    var remainingData = server.fileHandle.readDataToEndOfFile;
    var remainingStr = $.NSString.alloc.initWithDataEncoding(
        remainingData, $.NSUTF8StringEncoding
    );
    var codeResult = JSON.parse(ObjC.unwrap(remainingStr));

    if (codeResult.error) {
        throw new Error('Google 認証エラー: ' + codeResult.error);
    }

    if (!codeResult.code) {
        throw new Error('認証コードを取得できませんでした');
    }

    // Exchange authorization code for tokens
    var tokenData = OAuth2._curlRequest('POST', OAuth2.TOKEN_URL, {
        code: codeResult.code,
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
    });

    if (tokenData.error) {
        throw new Error('トークン交換エラー: ' + (tokenData.error_description || tokenData.error));
    }

    // Add expiry timestamp
    tokenData.expires_at = Date.now() + (tokenData.expires_in * 1000);
    OAuth2.saveToken(tokenData);

    return tokenData;
};

/**
 * Refresh the access token using the refresh token.
 */
OAuth2._refreshToken = function (refreshToken) {
    var creds = OAuth2.loadCredentials();

    var tokenData = OAuth2._curlRequest('POST', OAuth2.TOKEN_URL, {
        refresh_token: refreshToken,
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        grant_type: 'refresh_token'
    });

    if (tokenData.error) {
        return null;  // Refresh failed, need re-auth
    }

    // Preserve the refresh token (refresh response may not include it)
    tokenData.refresh_token = tokenData.refresh_token || refreshToken;
    tokenData.expires_at = Date.now() + (tokenData.expires_in * 1000);
    OAuth2.saveToken(tokenData);

    return tokenData;
};

/**
 * Get a valid access token. Refreshes or re-authenticates as needed.
 * @returns {string} access_token
 */
OAuth2.getAccessToken = function () {
    var token = OAuth2.loadToken();

    if (token && token.refresh_token) {
        // Check if token is expired or about to expire (1 minute buffer)
        if (token.expires_at && Date.now() < token.expires_at - 60000) {
            return token.access_token;
        }
        // Try to refresh
        var refreshed = OAuth2._refreshToken(token.refresh_token);
        if (refreshed) {
            return refreshed.access_token;
        }
    }

    // No valid token — start auth flow
    var newToken = OAuth2._startAuthFlow();
    return newToken.access_token;
};
