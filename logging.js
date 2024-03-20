const fs = require('fs');

exports.info = function (message) {
    let logMessage = `${new Date().toISOString()} [INFO] ${message}`
    console.log(logMessage)
    writeToFile(logMessage)
}

exports.error = function (message) {
    let logMessage = `${new Date().toISOString()} [ERROR] ${message}`
    console.log(logMessage)
    writeToFile(logMessage)
}

function writeToFile(logMessage) {
    const date = new Date();
    const filename = `logs/${date.toISOString().substr(0, 10)}.log`
    fs.appendFile(filename, logMessage+'\n', function (err) {
        if(err != null && err.code === 'ENOENT') {
            fs.writeFile(filename, '', function (err) {
                if (err) return console.log('[ERROR]',err);
                fs.appendFile(filename, logMessage+'\n', function (err) {
                    if (err) return console.log('[ERROR]',err);
                });
            });
        } else if (err != null) {
            console.log('[ERROR]',err);
        }
    });
}