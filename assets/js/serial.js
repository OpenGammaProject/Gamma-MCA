export class SerialData {
    maxSize;
    port;
    adcChannels;
    maxHistLength;
    maxLength;
    eolChar;
    orderType;
    consoleMemory;
    serInput;
    rawData;
    serData;
    baseHist;
    constructor() {
        this.maxSize = 100000;
        this.port = undefined;
        this.adcChannels = 4096;
        this.maxLength = 20;
        this.maxHistLength = 2 ** 16 * 2 * 10;
        this.eolChar = ';';
        this.orderType = 'chron';
        this.consoleMemory = 100000;
        this.rawData = '';
        this.serInput = '';
        this.serData = [];
        this.baseHist = [];
    }
    addRaw(uintArray, onlyConsole) {
        if (this.serData.length > this.maxSize) {
            console.warn('Warning: Serial buffer is saturating!');
            return;
        }
        const string = new TextDecoder("utf-8").decode(uintArray);
        this.addRawData(string);
        if (onlyConsole)
            return;
        this.rawData += string;
        if (this.orderType === 'chron') {
            let stringArr = this.rawData.split(this.eolChar);
            stringArr.pop();
            stringArr.shift();
            if (stringArr.length <= 1) {
                if (this.rawData.length > this.maxLength)
                    this.rawData = '';
                return;
            }
            else {
                for (const element of stringArr) {
                    this.rawData = this.rawData.replace(element + this.eolChar, '');
                    const trimString = element.trim();
                    if (!trimString.length || trimString.length >= this.maxLength)
                        continue;
                    const parsedInt = parseInt(trimString);
                    if (isNaN(parsedInt)) {
                        continue;
                    }
                    else {
                        if (parsedInt < 0 || parsedInt > this.adcChannels)
                            continue;
                        this.serData.push(parsedInt);
                    }
                }
            }
        }
        else if (this.orderType === 'hist') {
            let stringArr = this.rawData.split('\r\n');
            stringArr.pop();
            stringArr.shift();
            if (!stringArr.length) {
                if (this.rawData.length > this.maxHistLength)
                    this.rawData = '';
                return;
            }
            else {
                for (const element of stringArr) {
                    this.rawData = this.rawData.replaceAll(element + '\r\n', '');
                    const trimString = element.trim();
                    if (!trimString.length || trimString.length >= this.maxHistLength)
                        continue;
                    const stringHist = trimString.split(this.eolChar);
                    stringHist.pop();
                    if (stringHist.length !== this.adcChannels)
                        continue;
                    let numHist = stringHist.map(x => parseInt(x));
                    numHist = numHist.map(function (item) {
                        if (isNaN(item)) {
                            return 0;
                        }
                        else {
                            return item;
                        }
                    });
                    if (!this.baseHist.length) {
                        this.baseHist = numHist;
                        return;
                    }
                    const diffHist = numHist.map((item, index) => item - this.baseHist[index]);
                    const adcChannels = this.adcChannels;
                    for (let ch = 0; ch < adcChannels; ch++) {
                        const val = diffHist[ch];
                        for (let num = 0; num < val; num++) {
                            this.serData.push(ch);
                        }
                    }
                    this.baseHist = numHist;
                }
            }
        }
    }
    addRawData(string) {
        this.serInput += string;
        if (this.serInput.length > this.consoleMemory) {
            this.serInput = this.serInput.slice(this.serInput.length - this.consoleMemory);
        }
    }
    getRawData() {
        return this.serInput;
    }
    flushRawData() {
        this.serInput = '';
    }
    getData() {
        const copyArr = [...this.serData];
        this.serData = [];
        return copyArr;
    }
    flushData() {
        this.rawData = '';
        this.serData = [];
    }
    clearBaseHist() {
        this.baseHist = [];
    }
    updateData(oldDataArr, newDataArr) {
        if (!oldDataArr.length)
            oldDataArr = Array(this.adcChannels).fill(0);
        for (const value of newDataArr) {
            oldDataArr[value] += 1;
        }
        return oldDataArr;
    }
}
