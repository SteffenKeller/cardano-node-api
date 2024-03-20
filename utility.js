const fs = require('fs').promises

/**
 * Returns the slot for a given date
 * @param date Date
 * @returns {number}
 */
exports.slotFromDate = function(date) {
    const ms = Math.floor(date.getTime() / 1000)
    return ms-1591566291
}

/**
 * Returns the date for a given slot
 * @param slot Slot
 * @returns {Date}
 */
exports.dateFromSlot = function(slot) {
    const ms = 1591566291+slot
    return new Date(ms * 1000)
}

/**
 * This function splits a string an any array of strings with a max length of 64. If possible words are not broken.
 * @param string Input String
 * @returns {*[]}
 */
exports.chunkString = function (string) {
    let result = []
    let chunk = ''
    const elements = string.split(' ')
    for (const element of elements) {
        if (element.length > 64) {
            let innerElements = element.match(new RegExp('.{1,' + 64 + '}', 'g'));
            for (const innerElement of innerElements) {
                if (chunk.length + innerElement.length <= 64) {
                    chunk += innerElement + ' '
                } else {
                    result.push(chunk.slice(0,-1))
                    chunk = innerElement + ' '
                }
            }
        } else {
            if (chunk.length + element.length <= 64) {
                chunk += element + ' '
            } else {
                result.push(chunk.slice(0,-1))
                chunk = element + ' '
            }
        }
    }
    result.push(chunk.slice(0,-1))
    return result
}

exports.roughSizeOfObject = function ( object ) {

    var objectList = [];
    var stack = [ object ];
    var bytes = 0;

    while ( stack.length ) {
        var value = stack.pop();

        if ( typeof value === 'boolean' ) {
            bytes += 4;
        }
        else if ( typeof value === 'string' ) {
            bytes += value.length * 2;
        }
        else if ( typeof value === 'number' ) {
            bytes += 8;
        }
        else if
        (
            typeof value === 'object'
            && objectList.indexOf( value ) === -1
        )
        {
            objectList.push( value );

            for( var i in value ) {
                stack.push( value[ i ] );
            }
        }
    }
    return bytes;
}

exports.readArrayFromFile = async function (filename) {
    const contents = await fs.readFile(filename, 'utf-8');
    return contents.split(/\s/);
}

exports.writeArrayToFile = async function (filename, array) {
    let str = ''
    for (let i = 0; i < array.length; i++) {
        str += array[i]
        if (i !== array.length-1) {
            str += ' '
        }
    }
    return fs.writeFile(filename,str)
}

exports.sleep = function (ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

exports.zeroPad = function (num, places) {
    return String(num).padStart(places, '0')
}
